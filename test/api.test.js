import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register, heartbeat, getPairings, createPairingCode } from "../lib/api.js";

// Mock fetch globally
let mockFetch;

beforeEach(() => {
  mockFetch = mock.fn();
  globalThis.fetch = mockFetch;
});

describe("API client", () => {
  const baseUrl = "https://test.example.com";

  it("registers a new listener", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            identifier: "lst_abc123",
            registration_token: "reg_lst_abc123",
            type: "agent",
            name: "Test",
            status: "offline",
          }),
      })
    );

    const result = await register(baseUrl, { type: "agent", name: "Test" });

    assert.equal(result.identifier, "lst_abc123");
    assert.equal(result.registration_token, "reg_lst_abc123");

    const [url, options] = mockFetch.mock.calls[0].arguments;
    assert.equal(url, "https://test.example.com/api/v1/listeners/register");
    assert.equal(options.method, "POST");
    const body = JSON.parse(options.body);
    assert.equal(body.type, "agent");
    assert.equal(body.name, "Test");
  });

  it("sends heartbeat", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ status: "online", last_seen_at: "2026-03-08T12:00:00Z" }),
      })
    );

    const result = await heartbeat(baseUrl, "reg_token", "lst_abc");

    assert.equal(result.status, "online");
    const [url, options] = mockFetch.mock.calls[0].arguments;
    assert.equal(url, "https://test.example.com/api/v1/listeners/lst_abc/heartbeat");
    assert.equal(options.headers["Authorization"], "Bearer reg_token");
  });

  it("gets pairings", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            pairings: [
              { id: 1, status: "active", device: { identifier: "dev_xyz", name: "iPhone" } },
            ],
          }),
      })
    );

    const pairings = await getPairings(baseUrl, "reg_token", "lst_abc");

    assert.equal(pairings.length, 1);
    assert.equal(pairings[0].device.name, "iPhone");
  });

  it("creates pairing code", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ code: "482917", expires_at: "2026-03-08T12:15:00Z" }),
      })
    );

    const result = await createPairingCode(baseUrl, "reg_token", "lst_abc");

    assert.equal(result.code, "482917");
    const [url] = mockFetch.mock.calls[0].arguments;
    assert.equal(url, "https://test.example.com/api/v1/listeners/lst_abc/pair");
  });

  it("throws on API error", async () => {
    mockFetch.mock.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error":"Unauthorized"}'),
      })
    );

    await assert.rejects(() => heartbeat(baseUrl, "bad_token", "lst_abc"), {
      message: /401/,
    });
  });
});
