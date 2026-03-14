import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, "..", "bin", "cli.js");

/**
 * Tests for bin/cli.js
 *
 * The CLI uses top-level await and process.exit, so we cannot import it
 * directly. Instead we verify structural properties by reading the source
 * and test the package.json bin mapping.
 */

describe("CLI", () => {
  const cliSource = readFileSync(cliPath, "utf-8");

  it("defines the correct LABEL constant", () => {
    assert.ok(
      cliSource.includes('"com.appfabriek.agent-listener"'),
      "CLI should define the com.appfabriek.agent-listener label"
    );
  });

  it("handles all expected commands in the switch statement", () => {
    const expectedCommands = [
      "agents",
      "install",
      "uninstall",
      "start",
      "stop",
      "status",
      "create-pairing",
      "config",
      "logs",
      "help",
    ];
    for (const cmd of expectedCommands) {
      assert.ok(
        cliSource.includes(`case "${cmd}"`),
        `CLI should handle the "${cmd}" command`
      );
    }
  });

  it("defines a getVersion function", () => {
    assert.ok(
      cliSource.includes("function getVersion()"),
      "CLI should define getVersion"
    );
  });

  it("defines a showHelp function with usage text", () => {
    assert.ok(cliSource.includes("function showHelp()"));
    assert.ok(cliSource.includes("Usage: agent-listener <command>"));
  });

  it("config variable list includes all expected keys", () => {
    const expectedVars = [
      "API_URL",
      "REGISTRATION_TOKEN",
      "LISTENER_IDENTIFIER",
      "LISTENER_NAME",
      "LISTENER_TYPE",
      "FORWARD_MODE",
      "OPENCLAW_AGENT",
      "GATEWAY_URL",
      "GATEWAY_AUTH_TOKEN",
      "WEBHOOK_URL",
      "WEBHOOK_TOKEN",
      "HEALTH_PORT",
      "DEBUG",
    ];
    for (const v of expectedVars) {
      assert.ok(
        cliSource.includes(`"${v}"`),
        `Config should include ${v}`
      );
    }
  });

  it("masks sensitive config values (tokens)", () => {
    // The showConfig function should mask REGISTRATION_TOKEN, WEBHOOK_TOKEN, GATEWAY_AUTH_TOKEN
    const sensitiveKeys = ["REGISTRATION_TOKEN", "WEBHOOK_TOKEN", "GATEWAY_AUTH_TOKEN"];
    for (const key of sensitiveKeys) {
      assert.ok(
        cliSource.includes(`key === "${key}"`),
        `showConfig should mask ${key}`
      );
    }
  });

  it("package.json maps bin to cli.js", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"));
    assert.ok(
      pkg.bin["agent-listener"].endsWith("bin/cli.js"),
      `bin should point to bin/cli.js, got: ${pkg.bin["agent-listener"]}`
    );
  });

  it("defaults to help command when no argument is given", () => {
    assert.ok(
      cliSource.includes('args[0] || "help"'),
      "CLI should default to help when no command is provided"
    );
  });

  it("defines a parseFlags function", () => {
    assert.ok(
      cliSource.includes("function parseFlags("),
      "CLI should define parseFlags for --json, --agent etc."
    );
  });

  it("supports --json flag in agents command", () => {
    assert.ok(
      cliSource.includes("flags.json"),
      "CLI should check flags.json for JSON output mode"
    );
  });

  it("supports --agent flag in start command", () => {
    assert.ok(
      cliSource.includes("flags.agent"),
      "CLI should check flags.agent for agent selection"
    );
  });

  it("imports config-store for config management", () => {
    assert.ok(
      cliSource.includes("config-store.js"),
      "CLI should import config-store for ~/.config/agent-listener/config"
    );
  });

  it("help text includes agents command", () => {
    assert.ok(
      cliSource.includes("agents"),
      "Help should mention the agents command"
    );
  });

  it("help text includes --json and --agent options", () => {
    assert.ok(
      cliSource.includes("--json"),
      "Help should mention --json flag"
    );
    assert.ok(
      cliSource.includes("--agent"),
      "Help should mention --agent flag"
    );
  });
});
