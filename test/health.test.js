import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHealthServer } from "../lib/health.js";

describe("health check server", () => {
  let server;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  it("responds 200 with status on GET /health", async () => {
    const getStatus = () => ({
      status: "ok",
      uptime: 42,
      connected: true,
      listener_id: "lst_test",
    });

    server = startHealthServer(0, getStatus); // port 0 = random available port
    await new Promise((resolve) => server.on("listening", resolve));

    const port = server.address().port;
    const res = await fetch(`http://localhost:${port}/health`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.uptime, 42);
    assert.equal(body.connected, true);
    assert.equal(body.listener_id, "lst_test");
  });

  it("responds 404 on unknown paths", async () => {
    server = startHealthServer(0, () => ({ status: "ok" }));
    await new Promise((resolve) => server.on("listening", resolve));

    const port = server.address().port;
    const res = await fetch(`http://localhost:${port}/unknown`);
    assert.equal(res.status, 404);
  });

  it("responds 404 on non-GET methods", async () => {
    server = startHealthServer(0, () => ({ status: "ok" }));
    await new Promise((resolve) => server.on("listening", resolve));

    const port = server.address().port;
    const res = await fetch(`http://localhost:${port}/health`, { method: "POST" });
    assert.equal(res.status, 404);
  });

  it("returns fresh status data on each request", async () => {
    let callCount = 0;
    const getStatus = () => ({ status: "ok", call: ++callCount });

    server = startHealthServer(0, getStatus);
    await new Promise((resolve) => server.on("listening", resolve));

    const port = server.address().port;

    const res1 = await fetch(`http://localhost:${port}/health`);
    const body1 = await res1.json();
    assert.equal(body1.call, 1);

    const res2 = await fetch(`http://localhost:${port}/health`);
    const body2 = await res2.json();
    assert.equal(body2.call, 2);
  });
});
