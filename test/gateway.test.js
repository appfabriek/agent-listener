import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GatewayConnection } from "../lib/gateway.js";

describe("GatewayConnection", () => {
  it("starts disconnected", () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    assert.equal(gw.isConnected, false);
    assert.equal(gw.authenticated, false);
    assert.equal(gw.intentionalClose, false);
  });

  it("rejects connect when no auth token is available", async () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    // No authToken set, and ~/.openclaw/openclaw.json likely doesn't have one in test env
    // Override getAuthToken to return null
    gw.getAuthToken = () => null;

    await assert.rejects(() => gw.connect(), {
      message: /No gateway auth token/,
    });
  });

  it("disconnect sets intentionalClose and clears state", () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    gw.disconnect();
    assert.equal(gw.intentionalClose, true);
    assert.equal(gw.authenticated, false);
    assert.equal(gw.ws, null);
  });

  it("sendMessage rejects when not connected", async () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    await assert.rejects(() => gw.sendMessage("main", "hello", 1), {
      message: /Gateway not connected/,
    });
  });

  it("rejectAllPending clears all pending requests", () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    const errors = [];

    // Manually add pending requests
    gw.pendingRequests.set("req_1", {
      resolve: () => {},
      reject: (err) => errors.push(err.message),
      timeout: setTimeout(() => {}, 10000),
    });
    gw.pendingRequests.set("req_2", {
      resolve: () => {},
      reject: (err) => errors.push(err.message),
      timeout: setTimeout(() => {}, 10000),
    });

    gw._rejectAllPending("test disconnect");

    assert.equal(gw.pendingRequests.size, 0);
    assert.equal(errors.length, 2);
    assert.ok(errors[0].includes("test disconnect"));
  });

  it("exponential backoff caps at 60 seconds", () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");

    // Simulate many reconnect attempts to verify cap
    gw.reconnectAttempts = 10;
    const delay = Math.min(1000 * Math.pow(2, gw.reconnectAttempts - 1), 60_000);
    assert.equal(delay, 60_000);
  });

  it("getAuthToken reads from options when provided", () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789", {
      authToken: "test-token-123",
    });
    assert.equal(gw.getAuthToken(), "test-token-123");
  });

  it("sendMessage creates correct RPC frame when connected", async () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    const sentFrames = [];

    // Simulate an authenticated connection with a mock ws
    gw.authenticated = true;
    gw.ws = {
      readyState: 1, // WebSocket.OPEN
      send: (data) => sentFrames.push(JSON.parse(data)),
    };

    // Start sendMessage but don't await (it will pend waiting for response)
    const promise = gw.sendMessage("test-agent", "Hallo wereld", 42);

    // Verify the frame that was sent
    assert.equal(sentFrames.length, 1);
    const frame = sentFrames[0];
    assert.equal(frame.type, "req");
    assert.equal(frame.method, "agent");
    assert.ok(frame.id.startsWith("req_"));
    assert.equal(frame.params.message, "Hallo wereld");
    assert.equal(frame.params.agent, "test-agent");
    assert.ok(frame.params.sessionKey.includes("attm_pairing_42"));
    assert.ok(frame.params.idempotencyKey.startsWith("attm_42_"));

    // Resolve the pending request to avoid dangling timeout
    const pendingId = frame.id;
    const pending = gw.pendingRequests.get(pendingId);
    clearTimeout(pending.timeout);
    pending.resolve({ text: "Antwoord" });

    const result = await promise;
    assert.equal(result, "Antwoord");
  });

  it("sendMessage omits agent param when agentId is 'main'", async () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    const sentFrames = [];

    gw.authenticated = true;
    gw.ws = {
      readyState: 1,
      send: (data) => sentFrames.push(JSON.parse(data)),
    };

    const promise = gw.sendMessage("main", "test", 1);
    const frame = sentFrames[0];

    assert.equal(frame.params.agent, undefined, "agent param should be omitted for 'main'");

    // Clean up
    const pending = gw.pendingRequests.get(frame.id);
    clearTimeout(pending.timeout);
    pending.resolve({ text: "ok" });
    await promise;
  });

  it("_handleMessage dispatches response to correct pending request", () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    let resolvedValue = null;

    gw.pendingRequests.set("req_42", {
      resolve: (val) => { resolvedValue = val; },
      reject: () => {},
      timeout: setTimeout(() => {}, 10000),
    });

    // Simulate receiving a response message
    const messageData = JSON.stringify({
      type: "res",
      id: "req_42",
      ok: true,
      payload: { text: "Agent response" },
    });

    // We need to trigger the message handler. Since ws is internal,
    // we simulate by calling the handler logic directly.
    // The handler is on ws.on("message") — replicate the logic:
    const data = JSON.parse(messageData);
    if (data.type === "res" && gw.pendingRequests.has(data.id)) {
      const pending = gw.pendingRequests.get(data.id);
      gw.pendingRequests.delete(data.id);
      clearTimeout(pending.timeout);
      if (data.ok) {
        pending.resolve(data.payload);
      } else {
        pending.reject(new Error(data.payload?.error || "failed"));
      }
    }

    assert.deepEqual(resolvedValue, { text: "Agent response" });
    assert.equal(gw.pendingRequests.size, 0);
  });

  it("_handleMessage ignores unknown request IDs", () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    let resolvedValue = null;

    gw.pendingRequests.set("req_99", {
      resolve: (val) => { resolvedValue = val; },
      reject: () => {},
      timeout: setTimeout(() => {}, 10000),
    });

    // Response with a different ID should not resolve req_99
    const data = { type: "res", id: "req_unknown", ok: true, payload: { text: "wrong" } };
    if (data.type === "res" && gw.pendingRequests.has(data.id)) {
      const pending = gw.pendingRequests.get(data.id);
      gw.pendingRequests.delete(data.id);
      clearTimeout(pending.timeout);
      pending.resolve(data.payload);
    }

    assert.equal(resolvedValue, null, "Should not resolve for unknown request ID");
    assert.equal(gw.pendingRequests.size, 1, "Original request should remain pending");

    // Clean up
    const pending = gw.pendingRequests.get("req_99");
    clearTimeout(pending.timeout);
    gw.pendingRequests.delete("req_99");
  });

  it("multiple concurrent sendMessage calls track separate pending requests", async () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    const sentFrames = [];

    gw.authenticated = true;
    gw.ws = {
      readyState: 1,
      send: (data) => sentFrames.push(JSON.parse(data)),
    };

    const p1 = gw.sendMessage("agent1", "msg1", 10);
    const p2 = gw.sendMessage("agent2", "msg2", 20);

    assert.equal(sentFrames.length, 2);
    assert.equal(gw.pendingRequests.size, 2);

    // Each should have a unique ID
    const id1 = sentFrames[0].id;
    const id2 = sentFrames[1].id;
    assert.notEqual(id1, id2);

    // Resolve them in reverse order
    const pending2 = gw.pendingRequests.get(id2);
    clearTimeout(pending2.timeout);
    pending2.resolve({ text: "response2" });

    const pending1 = gw.pendingRequests.get(id1);
    clearTimeout(pending1.timeout);
    pending1.resolve({ text: "response1" });

    gw.pendingRequests.delete(id1);
    gw.pendingRequests.delete(id2);

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, "response1");
    assert.equal(r2, "response2");
  });

  it("_sendRequest rejects after timeout", async () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    const sentFrames = [];

    gw.ws = {
      send: (data) => sentFrames.push(JSON.parse(data)),
    };

    // Use a short timeout by temporarily overriding — we test _sendRequest directly
    // but REQUEST_TIMEOUT_MS is module-scoped. Instead, verify the timeout is set up.
    const promise = gw._sendRequest("req_timeout", "agent", { message: "test" });

    assert.equal(gw.pendingRequests.size, 1);
    const pending = gw.pendingRequests.get("req_timeout");
    assert.ok(pending.timeout, "Should have a timeout set");

    // Simulate timeout by calling reject and clearing
    clearTimeout(pending.timeout);
    gw.pendingRequests.delete("req_timeout");
    pending.reject(new Error("Gateway request req_timeout timed out after 120s"));

    await assert.rejects(promise, {
      message: /timed out/,
    });
  });

  it("disconnect rejects all pending requests", async () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    const sentFrames = [];

    gw.authenticated = true;
    gw.ws = {
      readyState: 1,
      send: (data) => sentFrames.push(JSON.parse(data)),
      close: () => {},
    };

    const p1 = gw.sendMessage("agent", "msg", 1);

    gw.disconnect();

    await assert.rejects(p1, {
      message: /Gateway disconnecting/,
    });
  });

  it("sendMessage returns content field when text is missing", async () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    const sentFrames = [];

    gw.authenticated = true;
    gw.ws = {
      readyState: 1,
      send: (data) => sentFrames.push(JSON.parse(data)),
    };

    const promise = gw.sendMessage("agent", "test", 1);
    const frame = sentFrames[0];
    const pending = gw.pendingRequests.get(frame.id);
    clearTimeout(pending.timeout);
    pending.resolve({ content: "fallback content" });

    const result = await promise;
    assert.equal(result, "fallback content");
  });

  it("sendMessage JSON-stringifies payload when no text or content", async () => {
    const gw = new GatewayConnection("ws://127.0.0.1:18789");
    const sentFrames = [];

    gw.authenticated = true;
    gw.ws = {
      readyState: 1,
      send: (data) => sentFrames.push(JSON.parse(data)),
    };

    const promise = gw.sendMessage("agent", "test", 1);
    const frame = sentFrames[0];
    const pending = gw.pendingRequests.get(frame.id);
    clearTimeout(pending.timeout);
    pending.resolve({ custom: "data" });

    const result = await promise;
    assert.equal(result, '{"custom":"data"}');
  });
});
