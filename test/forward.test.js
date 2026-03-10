import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { forward } from "../lib/forward.js";

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
});
