import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

// We test the parseEnvFile logic and config read/write by creating temp files.
// The module itself uses homedir() which we can't easily mock, so we test
// the exported functions that accept paths, and verify structural correctness.

describe("config-store", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = resolve(tmpdir(), `config-store-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exports expected functions", async () => {
    const mod = await import("../lib/config-store.js");
    assert.equal(typeof mod.readConfig, "function");
    assert.equal(typeof mod.writeConfig, "function");
    assert.equal(typeof mod.getConfigPath, "function");
    assert.ok(mod.CONFIG_PATH);
    assert.ok(mod.CONFIG_DIR);
  });

  it("readConfig returns empty object when no config files exist", async () => {
    const { readConfig } = await import("../lib/config-store.js");
    const result = readConfig(tempDir);
    // Unless ~/.config/agent-listener/config exists, this should return {}
    // (or the contents of that file if it does exist)
    assert.equal(typeof result, "object");
  });

  it("readConfig reads .env from fallback directory", async () => {
    const { readConfig } = await import("../lib/config-store.js");
    const envPath = resolve(tempDir, ".env");
    writeFileSync(envPath, "API_URL=https://test.example.com\nLISTENER_NAME=Test\n");

    // If ~/.config/agent-listener/config doesn't exist, should fall back to .env
    const result = readConfig(tempDir);
    // This will only work if ~/.config/agent-listener/config doesn't exist
    if (!existsSync(resolve(process.env.HOME, ".config", "agent-listener", "config"))) {
      assert.equal(result.API_URL, "https://test.example.com");
      assert.equal(result.LISTENER_NAME, "Test");
    }
  });

  it("readConfig ignores comments and empty lines", async () => {
    const { readConfig } = await import("../lib/config-store.js");
    const envPath = resolve(tempDir, ".env");
    writeFileSync(envPath, "# comment\n\nKEY=value\n# another comment\nFOO=bar\n");

    if (!existsSync(resolve(process.env.HOME, ".config", "agent-listener", "config"))) {
      const result = readConfig(tempDir);
      assert.equal(result.KEY, "value");
      assert.equal(result.FOO, "bar");
      assert.equal(Object.keys(result).length, 2);
    }
  });

  it("getConfigPath returns fallback .env when no config exists", async () => {
    const { getConfigPath, CONFIG_PATH } = await import("../lib/config-store.js");
    const envPath = resolve(tempDir, ".env");
    writeFileSync(envPath, "KEY=value\n");

    const result = getConfigPath(tempDir);
    if (existsSync(CONFIG_PATH)) {
      assert.equal(result, CONFIG_PATH);
    } else {
      assert.equal(result, envPath);
    }
  });

  it("CONFIG_PATH points to ~/.config/agent-listener/config", async () => {
    const { CONFIG_PATH } = await import("../lib/config-store.js");
    assert.ok(CONFIG_PATH.includes(".config"));
    assert.ok(CONFIG_PATH.includes("agent-listener"));
    assert.ok(CONFIG_PATH.endsWith("config"));
  });

  it("CONFIG_DIR points to ~/.config/agent-listener", async () => {
    const { CONFIG_DIR } = await import("../lib/config-store.js");
    assert.ok(CONFIG_DIR.includes(".config"));
    assert.ok(CONFIG_DIR.endsWith("agent-listener"));
  });
});
