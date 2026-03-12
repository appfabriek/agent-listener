import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

// getStatus depends on fs and execSync — test with a real temp dir
// but the launchctl/systemd calls will fail (not installed), which is fine.
import { getStatus } from "../lib/status.js";

describe("getStatus", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = resolve(tmpdir(), `listener-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns structured status object with expected keys", () => {
    const status = getStatus(tempDir);

    // The temp dir has no diagnostics, so lastHeartbeat should be null
    assert.ok("running" in status);
    assert.ok("pid" in status);
    assert.ok("uptime" in status);
    assert.ok("installed" in status);
    assert.ok("platform" in status);
    assert.ok("identifier" in status);
    assert.ok("apiUrl" in status);
    assert.ok("lastHeartbeat" in status);
    assert.ok(status.platform); // macOS or Linux
  });

  it("reads identifier from LISTENER_IDENTIFIER env", () => {
    const original = process.env.LISTENER_IDENTIFIER;
    process.env.LISTENER_IDENTIFIER = "lst_test123";

    try {
      const status = getStatus(tempDir);
      assert.equal(status.identifier, "lst_test123");
    } finally {
      if (original !== undefined) {
        process.env.LISTENER_IDENTIFIER = original;
      } else {
        delete process.env.LISTENER_IDENTIFIER;
      }
    }
  });

  it("reads API_URL from env", () => {
    const original = process.env.API_URL;
    process.env.API_URL = "https://staging.agenttalktome.com";

    try {
      const status = getStatus(tempDir);
      assert.equal(status.apiUrl, "https://staging.agenttalktome.com");
    } finally {
      if (original !== undefined) {
        process.env.API_URL = original;
      } else {
        delete process.env.API_URL;
      }
    }
  });

  it("reads lastHeartbeat from device-diagnostics.json", () => {
    const diagPath = resolve(tempDir, "device-diagnostics.json");
    writeFileSync(
      diagPath,
      JSON.stringify({
        _listener: { updated_at: "2026-03-12T10:00:00Z" },
      })
    );

    const status = getStatus(tempDir);
    assert.equal(status.lastHeartbeat, "2026-03-12T10:00:00Z");
  });

  it("falls back to log file mtime for lastHeartbeat", () => {
    const logsDir = resolve(tempDir, "logs");
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(resolve(logsDir, "stdout.log"), "test output\n");

    const status = getStatus(tempDir);
    // Should have a lastHeartbeat from the log file mtime
    assert.ok(status.lastHeartbeat, "should read mtime from stdout.log");
    assert.ok(status.lastHeartbeat.includes("T"), "should be ISO format");
  });

  it("handles corrupt diagnostics file gracefully", () => {
    const diagPath = resolve(tempDir, "device-diagnostics.json");
    writeFileSync(diagPath, "not json{{{");

    // Should not throw
    const status = getStatus(tempDir);
    // Main check: no exception thrown, status object is returned
    assert.ok(status);
    assert.ok("running" in status);
  });

  it("handles diagnostics file without _listener key", () => {
    const diagPath = resolve(tempDir, "device-diagnostics.json");
    writeFileSync(diagPath, JSON.stringify({ some: "data" }));

    const status = getStatus(tempDir);
    assert.equal(status.lastHeartbeat, null);
  });

  it("reports correct platform string", () => {
    const status = getStatus(tempDir);
    if (process.platform === "darwin") {
      assert.equal(status.platform, "macOS (launchd)");
    } else if (process.platform === "linux") {
      assert.equal(status.platform, "Linux (systemd)");
    }
  });
});
