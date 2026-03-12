#!/usr/bin/env node

/**
 * Agent Listener CLI — manage the listener daemon.
 *
 * Usage:
 *   agent-listener <command>
 *
 * Commands:
 *   install          Install as daemon (launchd on macOS, systemd on Linux)
 *   uninstall        Remove daemon
 *   start            Start the listener
 *   stop             Stop the listener
 *   status           Show status (running/stopped, uptime, last heartbeat)
 *   create-pairing   Create a new pairing code
 *   config           Show current configuration
 *   logs             Show recent logs
 *   help             Show this help
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const installPath = resolve(__dirname, "..");

// Load config
const confPath = resolve(installPath, "agent-listener.conf");
const envPath = resolve(installPath, ".env");
if (existsSync(confPath)) {
  dotenv.config({ path: confPath });
} else if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const command = process.argv[2] || "help";

const LABEL = "com.appfabriek.agent-listener";

switch (command) {
  case "install":
    await install();
    break;

  case "uninstall":
    await uninstall();
    break;

  case "start":
    await start();
    break;

  case "stop":
    await stop();
    break;

  case "status":
    await status();
    break;

  case "create-pairing":
    await createPairing();
    break;

  case "config":
    showConfig();
    break;

  case "logs":
    showLogs();
    break;

  case "help":
  case "--help":
  case "-h":
    showHelp();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "agent-listener help" for available commands.');
    process.exit(1);
}

async function install() {
  if (process.platform === "darwin") {
    const { installLaunchd } = await import("../lib/install.js");
    installLaunchd(installPath);
  } else if (process.platform === "linux") {
    const { installSystemd } = await import("../lib/install.js");
    installSystemd(installPath);
  } else {
    console.error(`Unsupported platform: ${process.platform}`);
    console.error("Supported: macOS (launchd), Linux (systemd)");
    process.exit(1);
  }
}

async function uninstall() {
  if (process.platform === "darwin") {
    const { uninstallLaunchd } = await import("../lib/install.js");
    uninstallLaunchd();
  } else if (process.platform === "linux") {
    const { uninstallSystemd } = await import("../lib/install.js");
    uninstallSystemd();
  } else {
    console.error(`Unsupported platform: ${process.platform}`);
    process.exit(1);
  }
}

async function start() {
  if (process.platform === "darwin") {
    try {
      execSync(`launchctl bootout gui/${process.getuid()}/${LABEL} 2>/dev/null`, { stdio: "ignore" });
    } catch { /* not loaded, fine */ }
    const plistPath = resolve(process.env.HOME, "Library/LaunchAgents", `${LABEL}.plist`);
    if (!existsSync(plistPath)) {
      console.error("Daemon not installed. Run 'agent-listener install' first.");
      process.exit(1);
    }
    try {
      execSync(`launchctl bootstrap gui/${process.getuid()} ${plistPath}`, { stdio: "inherit" });
      console.log("Agent listener started.");
    } catch {
      console.error("Failed to start. Check 'agent-listener logs' for details.");
      process.exit(1);
    }
  } else if (process.platform === "linux") {
    try {
      execSync("systemctl --user start agent-listener", { stdio: "inherit" });
      console.log("Agent listener started.");
    } catch {
      console.error("Failed to start. Run 'agent-listener install' first if not installed.");
      process.exit(1);
    }
  } else {
    console.log("Starting listener in foreground...");
    execSync(`node ${resolve(installPath, "index.js")}`, { stdio: "inherit", cwd: installPath });
  }
}

async function stop() {
  if (process.platform === "darwin") {
    try {
      execSync(`launchctl bootout gui/${process.getuid()}/${LABEL}`, { stdio: "inherit" });
      console.log("Agent listener stopped.");
    } catch {
      console.error("Listener is not running or not installed.");
    }
  } else if (process.platform === "linux") {
    try {
      execSync("systemctl --user stop agent-listener", { stdio: "inherit" });
      console.log("Agent listener stopped.");
    } catch {
      console.error("Listener is not running or not installed.");
    }
  } else {
    console.error("Use Ctrl+C to stop the foreground listener.");
  }
}

async function status() {
  const { getStatus } = await import("../lib/status.js");
  const s = getStatus(installPath);

  console.log("Agent Listener Status");
  console.log("---------------------");
  console.log(`Running:       ${s.running ? "Yes" : "No"}`);
  if (s.pid) console.log(`PID:           ${s.pid}`);
  if (s.uptime) console.log(`Uptime:        ${s.uptime}`);
  console.log(`Installed:     ${s.installed ? "Yes" : "No"}`);
  console.log(`Platform:      ${s.platform}`);
  if (s.identifier) console.log(`Identifier:    ${s.identifier}`);
  if (s.apiUrl) console.log(`API:           ${s.apiUrl}`);
  if (s.lastHeartbeat) console.log(`Last activity: ${s.lastHeartbeat}`);
}

async function createPairing() {
  const apiUrl = process.env.API_URL;
  const token = process.env.REGISTRATION_TOKEN;
  const identifier = process.env.LISTENER_IDENTIFIER || process.env.IDENTIFIER;

  if (!apiUrl || !token || !identifier) {
    console.error("Missing configuration. Run 'npm start' first to register.");
    console.error("Required: API_URL, REGISTRATION_TOKEN, LISTENER_IDENTIFIER");
    process.exit(1);
  }

  const { createPairingCode } = await import("../lib/api.js");
  try {
    const result = await createPairingCode(apiUrl, token, identifier);
    const jsonFlag = process.argv[3] === "--json";
    if (jsonFlag) {
      console.log(JSON.stringify({ code: result.code, expires_at: result.expires_at }));
    } else {
      console.log(`Koppelcode: ${result.code} (geldig tot ${result.expires_at})`);
      console.log("");
      console.log("De gebruiker voert deze code in de Agent Talk To Me iOS-app in.");
      console.log("De code is 10 minuten geldig.");
    }
  } catch (err) {
    console.error(`Failed to create pairing code: ${err.message}`);
    process.exit(1);
  }
}

function showConfig() {
  const configVars = [
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
    "DEBUG",
  ];

  const configSource = existsSync(confPath) ? confPath : existsSync(envPath) ? envPath : "(none)";
  console.log(`Config file: ${configSource}`);
  console.log(`Install path: ${installPath}`);
  console.log("");

  for (const key of configVars) {
    const value = process.env[key];
    if (value) {
      // Mask sensitive values
      if (key === "REGISTRATION_TOKEN" || key === "WEBHOOK_TOKEN" || key === "GATEWAY_AUTH_TOKEN") {
        console.log(`${key}=${value.substring(0, 8)}...`);
      } else {
        console.log(`${key}=${value}`);
      }
    }
  }
}

function showLogs() {
  const logFiles = [
    resolve(installPath, "logs/stdout.log"),
    resolve(installPath, "logs/stderr.log"),
  ];

  let shown = false;
  for (const logFile of logFiles) {
    if (existsSync(logFile)) {
      const label = logFile.endsWith("stdout.log") ? "stdout" : "stderr";
      console.log(`=== ${label} (${logFile}) ===`);
      try {
        const output = execSync(`tail -50 "${logFile}"`, { encoding: "utf-8" });
        console.log(output);
      } catch {
        console.log("(could not read)");
      }
      shown = true;
    }
  }

  if (!shown) {
    console.log("No log files found.");
    console.log(`Expected at: ${resolve(installPath, "logs/")}`);
    console.log("");
    console.log("If running via launchd/systemd, logs may be in the system journal:");
    if (process.platform === "darwin") {
      console.log(`  log show --predicate 'processImagePath CONTAINS "node"' --last 5m`);
    } else {
      console.log("  journalctl --user -u agent-listener --since '5 min ago'");
    }
  }
}

function showHelp() {
  console.log(`Agent Listener CLI v${getVersion()}

Usage: agent-listener <command>

Commands:
  install          Install as daemon (launchd on macOS, systemd on Linux)
  uninstall        Remove daemon
  start            Start the listener
  stop             Stop the listener
  status           Show status (running/stopped, uptime, last heartbeat)
  create-pairing   Create a new pairing code for the iOS app
  config           Show current configuration
  logs             Show recent logs
  help             Show this help

Examples:
  agent-listener install        # Install and start as daemon
  agent-listener create-pairing # Get a code for the iOS app
  agent-listener status         # Check if listener is running
  agent-listener logs           # View recent log output`);
}

function getVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(installPath, "package.json"), "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}
