import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { forward, forwardGateway, validateWebhookUrl } from "../lib/forward.js";

let mockFetch;

beforeEach(() => {
  mockFetch = mock.fn();
  globalThis.fetch = mockFetch;
});

describe("forward", () => {
  it("forwards via webhook", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve("Hello from Lena!"),
      })
    );

    const config = {
      forwardMode: "webhook",
      webhookUrl: "http://localhost:18888/hooks/wake",
      webhookToken: "test-token",
      debug: false,
    };

    const result = await forward(config, "Hoi Lena");

    assert.equal(result, "Hello from Lena!");
    const [url, options] = mockFetch.mock.calls[0].arguments;
    assert.ok(url.includes("/hooks/wake"));
    assert.ok(url.includes("token=test-token"));
    assert.equal(options.method, "POST");
    assert.equal(options.body, "Hoi Lena");
  });

  it("returns null for empty webhook response", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
      })
    );

    const config = {
      forwardMode: "webhook",
      webhookUrl: "http://localhost:18888/hooks/wake",
      debug: false,
    };

    const result = await forward(config, "test");
    assert.equal(result, null);
  });

  it("throws on webhook error", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
    );

    const config = {
      forwardMode: "webhook",
      webhookUrl: "http://localhost:18888/hooks/wake",
      debug: false,
    };

    await assert.rejects(() => forward(config, "test"), {
      message: /500/,
    });
  });

  it("throws on unknown forward mode", async () => {
    await assert.rejects(() => forward({ forwardMode: "unknown" }, "test"), {
      message: /Unknown forward mode/,
    });
  });

  it("forwards via gateway when connected", async () => {
    const mockGateway = {
      isConnected: true,
      sendMessage: mock.fn(() => Promise.resolve("Gateway response")),
    };

    const config = {
      forwardMode: "gateway",
      gateway: mockGateway,
      openclawAgent: "main",
      pairingId: 42,
    };

    const result = await forward(config, "Hoi agent");

    assert.equal(result, "Gateway response");
    assert.equal(mockGateway.sendMessage.mock.calls.length, 1);
    const [agentId, content, pairingId] = mockGateway.sendMessage.mock.calls[0].arguments;
    assert.equal(agentId, "main");
    assert.equal(content, "Hoi agent");
    assert.equal(pairingId, 42);
  });

  it("throws when gateway is not connected", async () => {
    const mockGateway = { isConnected: false };

    const config = {
      forwardMode: "gateway",
      gateway: mockGateway,
      openclawAgent: "main",
      pairingId: 42,
    };

    await assert.rejects(() => forward(config, "test"), {
      message: /Gateway not connected/,
    });
  });

  it("throws when gateway is null", async () => {
    const config = {
      forwardMode: "gateway",
      gateway: null,
      openclawAgent: "main",
      pairingId: 42,
    };

    await assert.rejects(() => forward(config, "test"), {
      message: /Gateway not connected/,
    });
  });

  it("forwardGateway returns null for empty response", async () => {
    const mockGateway = {
      isConnected: true,
      sendMessage: mock.fn(() => Promise.resolve("")),
    };

    const result = await forwardGateway(mockGateway, "main", "test", 1);
    assert.equal(result, null);
  });

  it("passes AbortSignal timeout to webhook fetch", async () => {
    let capturedOptions;
    mockFetch.mock.mockImplementation((_url, options) => {
      capturedOptions = options;
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve("ok"),
      });
    });

    const config = {
      forwardMode: "webhook",
      webhookUrl: "http://localhost:18888/hooks/wake",
      debug: false,
    };

    await forward(config, "test");

    // Verify AbortSignal is present (timeout)
    assert.ok(capturedOptions.signal, "fetch should have an AbortSignal");
  });

  it("retries webhook on server error (5xx)", async () => {
    let callCount = 0;
    mockFetch.mock.mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
        });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve("success after retry"),
      });
    });

    const config = {
      forwardMode: "webhook",
      webhookUrl: "http://localhost:18888/hooks/wake",
      debug: false,
    };

    const result = await forward(config, "test");
    assert.equal(result, "success after retry");
    assert.equal(callCount, 3, "should have retried twice before success");
  });

  it("does not retry webhook on 4xx client error", async () => {
    let callCount = 0;
    mockFetch.mock.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      });
    });

    const config = {
      forwardMode: "webhook",
      webhookUrl: "http://localhost:18888/hooks/wake",
      debug: false,
    };

    await assert.rejects(() => forward(config, "test"), {
      message: /400/,
    });
    assert.equal(callCount, 1, "should not retry on 4xx");
  });

  it("retries webhook on network error", async () => {
    let callCount = 0;
    mockFetch.mock.mockImplementation(() => {
      callCount++;
      if (callCount < 2) {
        return Promise.reject(new Error("fetch failed: ECONNREFUSED"));
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve("recovered"),
      });
    });

    const config = {
      forwardMode: "webhook",
      webhookUrl: "http://localhost:18888/hooks/wake",
      debug: false,
    };

    const result = await forward(config, "test");
    assert.equal(result, "recovered");
    assert.equal(callCount, 2);
  });
});

describe("validateWebhookUrl", () => {
  it("accepts valid http URL", () => {
    assert.doesNotThrow(() => validateWebhookUrl("http://localhost:18888/hooks/wake"));
  });

  it("accepts valid https URL", () => {
    assert.doesNotThrow(() => validateWebhookUrl("https://example.com/webhook"));
  });

  it("rejects missing URL", () => {
    assert.throws(() => validateWebhookUrl(null), { message: /WEBHOOK_URL is required/ });
    assert.throws(() => validateWebhookUrl(undefined), { message: /WEBHOOK_URL is required/ });
    assert.throws(() => validateWebhookUrl(""), { message: /WEBHOOK_URL is required/ });
  });

  it("rejects invalid URL", () => {
    assert.throws(() => validateWebhookUrl("not-a-url"), { message: /not a valid URL/ });
  });

  it("rejects non-http protocol", () => {
    assert.throws(() => validateWebhookUrl("ftp://example.com/file"), { message: /http or https/ });
  });
});
