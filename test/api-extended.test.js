import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  register,
  heartbeat,
  sendMessage,
  updateAgents,
  registerRestart,
} from "../lib/api.js";

let mockFetch;

beforeEach(() => {
  mockFetch = mock.fn();
  globalThis.fetch = mockFetch;
});

describe("API client — extended", () => {
  const baseUrl = "https://test.example.com";

  it("sendMessage posts to correct URL with content and content_type", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 99, status: "sent" }),
      })
    );

    const result = await sendMessage(baseUrl, "reg_token", 42, "Hallo!", "text");

    assert.equal(result.id, 99);
    const [url, options] = mockFetch.mock.calls[0].arguments;
    assert.equal(url, "https://test.example.com/api/v1/pairings/42/messages");
    assert.equal(options.method, "POST");
    const body = JSON.parse(options.body);
    assert.equal(body.content, "Hallo!");
    assert.equal(body.content_type, "text");
  });

  it("sendMessage defaults content_type to text", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 100 }),
      })
    );

    await sendMessage(baseUrl, "reg_token", 42, "test");

    const [, options] = mockFetch.mock.calls[0].arguments;
    const body = JSON.parse(options.body);
    assert.equal(body.content_type, "text");
  });

  it("sendMessage sends control messages", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 101 }),
      })
    );

    const controlContent = JSON.stringify({ action: "pong", payload: {} });
    await sendMessage(baseUrl, "reg_token", 42, controlContent, "control");

    const [, options] = mockFetch.mock.calls[0].arguments;
    const body = JSON.parse(options.body);
    assert.equal(body.content_type, "control");
    const parsed = JSON.parse(body.content);
    assert.equal(parsed.action, "pong");
  });

  it("updateAgents puts agents to correct URL", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: "ok" }),
      })
    );

    const agents = [
      { id: "lena", name: "Lena", emoji: "🌸", isDefault: true, model: "gpt-4" },
    ];
    const result = await updateAgents(baseUrl, "reg_token", "lst_abc", agents);

    assert.equal(result.status, "ok");
    const [url, options] = mockFetch.mock.calls[0].arguments;
    assert.equal(url, "https://test.example.com/api/v1/listeners/lst_abc/agents");
    assert.equal(options.method, "PUT");
    assert.equal(options.headers["Authorization"], "Bearer reg_token");
    const body = JSON.parse(options.body);
    assert.equal(body.agents.length, 1);
    assert.equal(body.agents[0].id, "lena");
  });

  it("registerRestart sends restart command info", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: "ok" }),
      })
    );

    const result = await registerRestart(baseUrl, "reg_token", "lst_abc", {
      restart_command: "launchctl kickstart gui/501/com.appfabriek.agent-listener",
      install_path: "/Users/test/agent-listener",
      platform: "macOS",
    });

    assert.equal(result.status, "ok");
    const [url, options] = mockFetch.mock.calls[0].arguments;
    assert.equal(url, "https://test.example.com/api/v1/listeners/lst_abc/restart_command");
    assert.equal(options.method, "PUT");
    const body = JSON.parse(options.body);
    assert.ok(body.restart_command.includes("launchctl"));
    assert.equal(body.platform, "macOS");
  });

  it("register includes publicKey when provided", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            identifier: "lst_new",
            registration_token: "reg_new",
          }),
      })
    );

    await register(baseUrl, { type: "agent", name: "Test", publicKey: "ssh-ed25519 AAAA..." });

    const [, options] = mockFetch.mock.calls[0].arguments;
    const body = JSON.parse(options.body);
    assert.equal(body.public_key, "ssh-ed25519 AAAA...");
  });

  it("register omits publicKey when not provided", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            identifier: "lst_new",
            registration_token: "reg_new",
          }),
      })
    );

    await register(baseUrl, { type: "agent", name: "Test" });

    const [, options] = mockFetch.mock.calls[0].arguments;
    const body = JSON.parse(options.body);
    assert.equal(body.public_key, undefined);
  });

  it("heartbeat throws when identifier is missing", async () => {
    await assert.rejects(() => heartbeat(baseUrl, "token", null), {
      message: /Identifier required/,
    });
    await assert.rejects(() => heartbeat(baseUrl, "token", undefined), {
      message: /Identifier required/,
    });
    await assert.rejects(() => heartbeat(baseUrl, "token", ""), {
      message: /Identifier required/,
    });
  });

  it("all requests include AbortSignal timeout", async () => {
    let capturedOptions;
    mockFetch.mock.mockImplementation((_url, options) => {
      capturedOptions = options;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    await heartbeat(baseUrl, "token", "lst_abc");

    assert.ok(capturedOptions.signal, "fetch should have an AbortSignal");
  });

  it("all requests include Content-Type header", async () => {
    let capturedOptions;
    mockFetch.mock.mockImplementation((_url, options) => {
      capturedOptions = options;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    await heartbeat(baseUrl, "token", "lst_abc");

    assert.equal(capturedOptions.headers["Content-Type"], "application/json");
  });

  it("error includes method, path, and status code", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 422,
        text: () => Promise.resolve('{"error":"Validation failed"}'),
      })
    );

    await assert.rejects(() => sendMessage(baseUrl, "token", 42, "test"), (err) => {
      assert.ok(err.message.includes("422"));
      assert.ok(err.message.includes("POST"));
      assert.ok(err.message.includes("/pairings/42/messages"));
      return true;
    });
  });
});
