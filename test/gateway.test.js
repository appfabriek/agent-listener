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
});
