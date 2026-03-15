#!/usr/bin/env node

/**
 * Agent Listener CLI — manage the listener daemon.
 *
 * Usage:
 *   agent-listener <command>
 *
 * Commands:
 *   agents           List available OpenClaw agents
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
import { readConfig, writeConfig, CONFIG_PATH } from "../lib/config-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const installPath = resolve(__dirname, "..");

// Load config: prefer ~/.config/agent-listener/config, then agent-listener.conf, then .env
const storedConfig = readConfig(installPath);
const confPath = resolve(installPath, "agent-listener.conf");
const envPath = resolve(installPath, ".env");

// Load dotenv files for backwards compatibility (populates process.env)
if (existsSync(CONFIG_PATH)) {
  dotenv.config({ path: CONFIG_PATH });
} else if (existsSync(confPath)) {
  dotenv.config({ path: confPath });
} else if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Parse CLI flags
const args = process.argv.slice(2);
const command = args[0] || "help";
const flags = parseFlags(args.slice(1));

const LABEL = "com.appfabriek.agent-listener";

switch (command) {
  case "agents":
    await agents();
    break;

  case "init":
    await init();
    break;

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

  case "docs":
    showDocs();
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

/**
 * Parse CLI flags into an object.
 * Supports --flag, --flag value, --flag=value
 */
function parseFlags(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        result[arg.substring(2, eqIdx)] = arg.substring(eqIdx + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        result[arg.substring(2)] = argv[i + 1];
        i++;
      } else {
        result[arg.substring(2)] = true;
      }
    }
  }
  return result;
}

async function agents() {
  const { discoverAgents } = await import("../lib/agent-discovery.js");
  const agentList = await discoverAgents();

  if (flags.json) {
    console.log(JSON.stringify({ agents: agentList }));
  } else {
    if (agentList.length === 0) {
      console.log("No agents found. Is the OpenClaw gateway running?");
    } else {
      console.log(`Found ${agentList.length} agent(s):\n`);
      for (const a of agentList) {
        const emoji = a.emoji ? `${a.emoji} ` : "";
        const defaultTag = a.isDefault ? " (default)" : "";
        const model = a.model ? ` [${a.model}]` : "";
        console.log(`  ${emoji}${a.name} (id: ${a.id})${defaultTag}${model}`);
      }
    }
  }
}

async function init() {
  const targetEnv = resolve(process.cwd(), ".env");
  if (existsSync(targetEnv)) {
    console.log("✅ .env already exists in this directory.");
    console.log(`   Edit ${targetEnv} to change settings.`);
    return;
  }

  const examplePath = resolve(installPath, ".env.example");
  if (existsSync(examplePath)) {
    const content = readFileSync(examplePath, "utf-8");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(targetEnv, content);
    console.log(`✅ Created .env from template.`);
  } else {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(targetEnv, [
      "# Agent Talk To Me — Listener Configuration",
      "# See: https://agenttalktome.com",
      "",
      "# API URL (default: https://agenttalktome.com)",
      "# API_URL=https://agenttalktome.com",
      "",
      "# Display name in the iOS app",
      "LISTENER_NAME=My Agent",
      "",
      "# How to forward messages to your agent:",
      "#   gateway      — OpenClaw Gateway (default)",
      "#   openclaw-cli — openclaw CLI",
      "#   webhook      — HTTP POST to a URL",
      "# FORWARD_MODE=gateway",
      "",
      "# Credentials (auto-filled on first start)",
      "# REGISTRATION_TOKEN=",
      "# LISTENER_IDENTIFIER=",
      "",
    ].join("\n"));
    console.log(`✅ Created .env with defaults.`);
  }
  console.log(`   Edit .env to set LISTENER_NAME and FORWARD_MODE.`);
  console.log(`   Then run: agent-listener start`);
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
  const jsonMode = flags.json === true;
  const agentId = flags.agent;
  const pairFlag = flags.pair === true;

  // Check if daemon is installed — if so, start via daemon manager (only in non-json mode)
  if (!jsonMode) {
    if (process.platform === "darwin") {
      const plistPath = resolve(process.env.HOME, "Library/LaunchAgents", `${LABEL}.plist`);
      if (existsSync(plistPath)) {
        try {
          execSync(`launchctl bootout gui/${process.getuid()}/${LABEL} 2>/dev/null`, { stdio: "ignore" });
        } catch { /* not loaded, fine */ }
        try {
          execSync(`launchctl bootstrap gui/${process.getuid()} ${plistPath}`, { stdio: "inherit" });
          console.log("Agent listener started (daemon).");
          return;
        } catch {
          console.error("Daemon start failed, falling back to foreground.");
        }
      }
    } else if (process.platform === "linux") {
      try {
        execSync("systemctl --user is-enabled agent-listener 2>/dev/null", { stdio: "ignore" });
        execSync("systemctl --user start agent-listener", { stdio: "inherit" });
        console.log("Agent listener started (daemon).");
        return;
      } catch { /* not installed as service, fall through */ }
    }
  }

  // Foreground mode — works without daemon installation
  if (!jsonMode) console.log("Starting listener in foreground...");

  // Build args to pass to index.js
  // In JSON mode, always generate a pairing code (the AI agent needs it)
  const indexArgs = [];
  if (jsonMode) indexArgs.push("--json", "--pair");
  if (agentId) indexArgs.push("--agent", agentId);
  if (!jsonMode && pairFlag) indexArgs.push("--pair");

  const cwd = existsSync(resolve(process.cwd(), ".env")) ? process.cwd() : installPath;
  execSync(`node ${resolve(installPath, "index.js")} ${indexArgs.join(" ")}`, { stdio: "inherit", cwd });
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
    if (flags.json) {
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
    "HEALTH_PORT",
    "DEBUG",
  ];

  // Determine which config source is active
  let configSource;
  if (existsSync(CONFIG_PATH)) {
    configSource = CONFIG_PATH;
  } else if (existsSync(confPath)) {
    configSource = confPath;
  } else if (existsSync(envPath)) {
    configSource = envPath;
  } else {
    configSource = "(none)";
  }

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

function showDocs() {
  const docsPath = new URL("../AGENT_INSTRUCTIONS.md", import.meta.url);
  try {
    const content = readFileSync(docsPath, "utf-8");
    console.log(content);
  } catch {
    console.error("Documentation file not found. See AGENT_INSTRUCTIONS.md in the npm package.");
  }
}

function showHelp() {
  console.log(`Agent Listener CLI v${getVersion()}

Usage: agent-listener <command> [options]

Commands:
  agents           List available OpenClaw agents
  init             Create a .env config file in the current directory
  start            Start the listener (foreground, or daemon if installed)
  stop             Stop the daemon
  install          Install as daemon (launchd on macOS, systemd on Linux)
  uninstall        Remove daemon
  status           Show status (running/stopped, uptime, last heartbeat)
  create-pairing   Create a new pairing code for the iOS app
  config           Show current configuration
  logs             Show recent logs
  docs             Show full documentation for AI agents
  help             Show this help

Options:
  --json           Machine-readable JSON output
  --agent <id>     Select which OpenClaw agent to use (for start command)
  --pair           Generate a new pairing code on start

Quick start:
  agent-listener agents              # List available agents
  agent-listener start --agent bob   # Start with a specific agent
  agent-listener start --agent bob --json  # Machine-readable output

Production:
  agent-listener install         # Install as daemon (auto-start on boot)
  agent-listener start           # Start the daemon`);
}

function getVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(installPath, "package.json"), "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}
