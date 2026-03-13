#!/usr/bin/env node
import dotenv from "dotenv";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { register, heartbeat, getPairings, updateAgents, registerRestart, createPairingCode } from "./lib/api.js";
import { connectCable, connectListenerChannel } from "./lib/cable.js";
import { forward } from "./lib/forward.js";
import { GatewayConnection } from "./lib/gateway.js";
import { discoverAgents, selectAgent } from "./lib/agent-discovery.js";
import { readConfig, writeConfig, CONFIG_PATH } from "./lib/config-store.js";

// Parse CLI flags
const cliFlags = parseCLIFlags(process.argv.slice(2));
const jsonMode = cliFlags.json === true;
const cliAgent = cliFlags.agent || undefined;
const pairOnStart = cliFlags.pair === true;

// Load config: prefer ~/.config/agent-listener/config, then conf, then .env
const storedConfig = readConfig(new URL(".", import.meta.url).pathname);

if (existsSync(CONFIG_PATH)) {
  dotenv.config({ path: CONFIG_PATH });
} else {
  const confPath = new URL("agent-listener.conf", import.meta.url).pathname;
  const envPath = new URL(".env", import.meta.url).pathname;
  if (existsSync(confPath)) {
    dotenv.config({ path: confPath });
  } else {
    dotenv.config({ path: envPath });
  }
}

// No mandatory env vars — API_URL has a default, and credentials are auto-generated on first run.

const config = {
  apiUrl: process.env.API_URL || "https://staging.agenttalktome.com",
  registrationToken: process.env.REGISTRATION_TOKEN,
  identifier: process.env.LISTENER_IDENTIFIER || process.env.IDENTIFIER,
  listenerType: process.env.LISTENER_TYPE || "agent",
  listenerName: process.env.LISTENER_NAME || "Agent Listener",
  forwardMode: process.env.FORWARD_MODE || "gateway",
  openclawAgent: cliAgent || process.env.OPENCLAW_AGENT || "main",
  webhookUrl: process.env.WEBHOOK_URL,
  webhookToken: process.env.WEBHOOK_TOKEN,
  gatewayUrl: process.env.GATEWAY_URL || "ws://127.0.0.1:18789",
  gatewayAuthToken: process.env.GATEWAY_AUTH_TOKEN || undefined,
  debug: process.env.DEBUG === "true",
  gateway: null, // Set at startup if forward mode is gateway
};

const debugLog = (...args) => config.debug && !jsonMode && console.log("🐛", ...args);

/**
 * Structured log helper — prefixes with ISO timestamp and level.
 * In JSON mode, outputs {"status": "log", "level": ..., "message": ...}
 * Levels: INFO, WARN, ERROR, DEBUG
 */
function log(level, message, ...extra) {
  if (jsonMode) return; // suppress human-readable logs in JSON mode
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level}]`;
  if (level === "ERROR") {
    console.error(prefix, message, ...extra);
  } else if (level === "WARN") {
    console.warn(prefix, message, ...extra);
  } else {
    console.log(prefix, message, ...extra);
  }
}

/**
 * Emit a JSON event to stdout (only in JSON mode).
 */
function emitJSON(obj) {
  if (jsonMode) {
    console.log(JSON.stringify(obj));
  }
}

/**
 * Parse CLI flags from argv.
 */
function parseCLIFlags(argv) {
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

// Track active cable connections by pairing ID
const activeCables = new Map();

// In-memory message queue for when OpenClaw is offline (max 50 per pairing)
const MESSAGE_QUEUE_MAX = 50;
const messageQueues = new Map(); // pairing_id -> [{ content, queuedAt }]

// Track device diagnostics per pairing (updated via status_report + logs)
const deviceDiagnostics = new Map();

/**
 * Persist credentials to ~/.config/agent-listener/config.
 * Falls back to .env in the install directory for backwards compatibility.
 */
function persistCredentials(token, identifier) {
  try {
    const saved = writeConfig({
      API_URL: config.apiUrl,
      REGISTRATION_TOKEN: token,
      LISTENER_IDENTIFIER: identifier,
      ...(config.listenerName !== "Agent Listener" ? { LISTENER_NAME: config.listenerName } : {}),
      ...(config.forwardMode !== "gateway" ? { FORWARD_MODE: config.forwardMode } : {}),
      ...(config.openclawAgent !== "main" ? { OPENCLAW_AGENT: config.openclawAgent } : {}),
    });
    log("INFO", `Credentials saved to ${saved}`);
    emitJSON({ status: "credentials_saved", path: saved });
  } catch (err) {
    log("WARN", `Could not save credentials to config: ${err.message}`);
    // Fall back to .env
    persistCredentialsToEnvLegacy(token, identifier);
  }
}

/**
 * Legacy: persist credentials to .env file (backwards compatibility).
 */
function persistCredentialsToEnvLegacy(token, identifier) {
  const envPath = new URL(".env", import.meta.url).pathname;
  try {
    if (existsSync(envPath)) {
      let content = readFileSync(envPath, "utf-8");
      if (content.includes("REGISTRATION_TOKEN=")) {
        content = content.replace(/^REGISTRATION_TOKEN=.*$/m, `REGISTRATION_TOKEN=${token}`);
      } else {
        content += `\nREGISTRATION_TOKEN=${token}\n`;
      }
      if (content.includes("LISTENER_IDENTIFIER=")) {
        content = content.replace(/^LISTENER_IDENTIFIER=.*$/m, `LISTENER_IDENTIFIER=${identifier}`);
      } else if (content.includes("IDENTIFIER=")) {
        content = content.replace(/^IDENTIFIER=.*$/m, `LISTENER_IDENTIFIER=${identifier}`);
      } else {
        content += `LISTENER_IDENTIFIER=${identifier}\n`;
      }
      writeFileSync(envPath, content);
    } else {
      const examplePath = new URL(".env.example", import.meta.url).pathname;
      let content;
      if (existsSync(examplePath)) {
        content = readFileSync(examplePath, "utf-8");
        content = content.replace(/^REGISTRATION_TOKEN=.*$/m, `REGISTRATION_TOKEN=${token}`);
        content = content.replace(/^LISTENER_IDENTIFIER=.*$/m, `LISTENER_IDENTIFIER=${identifier}`);
      } else {
        content = `API_URL=${config.apiUrl}\nREGISTRATION_TOKEN=${token}\nLISTENER_IDENTIFIER=${identifier}\n`;
      }
      writeFileSync(envPath, content);
    }
    log("INFO", "Credentials saved to .env (legacy)");
  } catch (err) {
    log("WARN", `Could not save credentials to .env: ${err.message}`);
    log("INFO", `Save manually: REGISTRATION_TOKEN=${token}`);
    log("INFO", `Save manually: LISTENER_IDENTIFIER=${identifier}`);
  }
}

async function main() {
  log("INFO", "Agent Listener starting...");
  log("INFO", `API: ${config.apiUrl}`);
  log("INFO", `Forward mode: ${config.forwardMode}`);

  // Step 1: Register or reconnect
  let token = config.registrationToken;
  let identifier;
  let isFirstRun = false;

  if (!token) {
    isFirstRun = true;
    log("INFO", "Registering new listener...");
    const result = await register(config.apiUrl, {
      type: config.listenerType,
      name: config.listenerName,
    });
    token = result.registration_token;
    identifier = result.identifier;
    log("INFO", `Registered: ${identifier}`);
    emitJSON({ status: "registered", identifier });

    // Auto-persist credentials
    persistCredentials(token, identifier);

    // Heartbeat to confirm online status (needed for ListenerChannel subscription)
    await heartbeat(config.apiUrl, token, identifier);
  } else {
    identifier = config.identifier;
    if (identifier) {
      const hb = await heartbeat(config.apiUrl, token, identifier);
      identifier = hb.identifier;
      log("INFO", `Reconnected: ${identifier}`);
      emitJSON({ status: "reconnected", identifier });
    } else {
      // Fallback: no identifier saved, re-register
      isFirstRun = true;
      log("WARN", "No LISTENER_IDENTIFIER found, re-registering...");
      const result = await register(config.apiUrl, {
        type: config.listenerType,
        name: config.listenerName,
      });
      token = result.registration_token;
      identifier = result.identifier;
      log("INFO", `Re-registered: ${identifier}`);
      emitJSON({ status: "registered", identifier });
      persistCredentials(token, identifier);
    }
  }

  // Step 1b: Register restart command with API
  try {
    const restartCommand = process.platform === "darwin"
      ? `launchctl kickstart -k gui/${process.getuid()}/com.appfabriek.agent-listener`
      : `systemctl --user restart agent-listener`;

    await registerRestart(config.apiUrl, token, identifier, {
      restart_command: restartCommand,
      install_path: process.cwd(),
      platform: process.platform,
    });
    log("INFO", "Restart command registered with API");
  } catch (err) {
    log("WARN", `Could not register restart command (${err.message}) — endpoint may not exist yet`);
  }

  // Step 1c: Auto-create pairing code on first run or when --pair flag is set
  let pairingCode = null;
  let pairingExpiresAt = null;
  if (isFirstRun || pairOnStart) {
    try {
      const pairingResult = await createPairingCode(config.apiUrl, token, identifier);
      pairingCode = pairingResult.code;
      pairingExpiresAt = pairingResult.expires_at;
      log("INFO", `Pairing code: ${pairingCode} (expires: ${pairingExpiresAt})`);
      if (!jsonMode) {
        console.log(`\n  Koppelcode: ${pairingCode}\n  Geldig tot: ${pairingExpiresAt}\n`);
      }
    } catch (err) {
      log("WARN", `Could not create pairing code: ${err.message}`);
      emitJSON({ status: "error", error: `Could not create pairing code: ${err.message}` });
    }
  }

  // Step 2: Discover available agents (skip if --agent was explicitly set)
  if (!cliAgent) {
    const agents = await discoverAgents();
    if (agents.length > 0) {
      const selectedId = selectAgent(agents, config.openclawAgent);
      config.openclawAgent = selectedId;
      log("INFO", `Discovered ${agents.length} agent(s), selected: ${selectedId}`);

      try {
        await updateAgents(config.apiUrl, token, identifier, agents);
      } catch (err) {
        log("WARN", `Could not sync agents with API (${err.message})`);
      }
    } else {
      log("INFO", `Using configured agent: ${config.openclawAgent}`);
    }
  } else {
    log("INFO", `Using agent from --agent flag: ${config.openclawAgent}`);
  }

  // Emit the main "running" status — this is the line the AI agent reads
  const runningStatus = {
    status: "running",
    agent: config.openclawAgent,
    identifier,
  };
  if (pairingCode) {
    runningStatus.pairing_code = pairingCode;
    runningStatus.expires_at = pairingExpiresAt;
  }
  emitJSON(runningStatus);

  // Step 3: Connect to OpenClaw Gateway (if forward mode is gateway)
  if (config.forwardMode === "gateway") {
    const gateway = new GatewayConnection(config.gatewayUrl, {
      authToken: config.gatewayAuthToken,
      debug: config.debug,
    });
    try {
      await gateway.connect();
      config.gateway = gateway;
      log("INFO", `Gateway connected: ${config.gatewayUrl}`);
    } catch (err) {
      log("WARN", `Gateway connection failed: ${err.message}`);
      log("WARN", "Falling back to openclaw-cli forward mode");
      config.forwardMode = "openclaw-cli";
      config.gateway = null;
    }
  }

  // Step 4: Get active pairings and connect
  await syncPairings(token, identifier);

  // Step 5: Subscribe to ListenerChannel for instant new-pairing notifications
  const listenerCable = connectListenerChannel(config.apiUrl, token, (event) => {
    if (event.type === "new_pairing") {
      log("INFO", `New pairing via ListenerChannel: ${event.pairing_id} (device: ${event.device?.name || "unknown"})`);
      emitJSON({ status: "new_pairing", pairing_id: event.pairing_id, device: event.device });
      if (!activeCables.has(event.pairing_id)) {
        connectPairing(config.apiUrl, token, { id: event.pairing_id, device: event.device });
      }
    } else {
      debugLog(`ListenerChannel event: ${event.type}`);
    }
  });

  // Step 6: Heartbeat every 60s
  const heartbeatInterval = setInterval(async () => {
    try {
      await heartbeat(config.apiUrl, token, identifier);
      debugLog("Heartbeat OK");
    } catch (err) {
      log("ERROR", "Heartbeat failed:", err.message);
    }
  }, 60_000);

  // Step 7: Sync pairings every 60s (fallback for missed ListenerChannel events)
  const syncInterval = setInterval(async () => {
    try {
      await syncPairings(token, identifier);
    } catch (err) {
      log("ERROR", "Pairing sync failed:", err.message);
    }
  }, 60_000);

  // Graceful shutdown
  const shutdown = () => {
    log("INFO", "Shutting down...");
    emitJSON({ status: "shutdown" });
    clearInterval(heartbeatInterval);
    clearInterval(syncInterval);
    listenerCable.disconnect();
    if (config.gateway) {
      config.gateway.disconnect();
    }
    for (const [id, cable] of activeCables) {
      cable.disconnect();
    }
    activeCables.clear();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // SIGUSR1: request diagnostics from all connected devices
  process.on("SIGUSR1", () => {
    if (!jsonMode) console.log("📊 Requesting diagnostics from all devices...");
    for (const [id, cable] of activeCables) {
      sendControlMessage(cable, "request_logs");
    }
  });

  log("INFO", "Listener running. Press Ctrl+C to stop.");
  log("INFO", "Send SIGUSR1 to request device diagnostics.");
}

/**
 * Sync pairings: connect to new ones, disconnect removed ones
 */
async function syncPairings(token, identifier) {
  const pairings = await getPairings(config.apiUrl, token, identifier);
  const currentIds = new Set(pairings.map((p) => p.id));

  // Connect new pairings
  for (const pairing of pairings) {
    if (activeCables.has(pairing.id)) continue;

    log("INFO", `New pairing detected: ${pairing.id} (device: ${pairing.device?.name || pairing.device?.identifier || "unknown"})`);
    connectPairing(config.apiUrl, token, pairing);
  }

  // Disconnect removed pairings
  for (const [id, cable] of activeCables) {
    if (!currentIds.has(id)) {
      log("INFO", `Pairing ${id} removed, disconnecting...`);
      cable.disconnect();
      activeCables.delete(id);
    }
  }

  if (activeCables.size === 0 && pairings.length === 0) {
    log("INFO", "No paired devices yet. Will check again in 60s.");
  }
}

/**
 * Connect a cable for a single pairing with message forwarding
 */
function connectPairing(apiUrl, token, pairing) {
  const cable = connectCable(apiUrl, token, pairing.id, async (message) => {
    // Only handle messages directed to us (to_listener)
    if (message.direction !== "to_listener") return;

    // Handle control messages separately
    if (message.content_type === "control") {
      handleControlResponse(pairing.id, message);
      return;
    }

    log("INFO", `Message from device (pairing ${pairing.id}): ${message.content.substring(0, 80)}`);

    try {
      // Pass pairingId for gateway mode's idempotency key + session key
      const forwardConfig = { ...config, pairingId: pairing.id };
      const response = await forward(forwardConfig, message.content);
      if (response) {
        debugLog(`Response: ${response.substring(0, 80)}`);
        const sent = cable.send({
          content: response,
          content_type: "text",
        });
        if (sent) {
          log("INFO", `Response sent to pairing ${pairing.id}`);
        } else {
          log("WARN", `Response queued (WebSocket reconnecting) for pairing ${pairing.id}`);
        }
      }
      // After successful forward, try to drain the queue
      await drainMessageQueue(cable, pairing.id);
    } catch (err) {
      log("ERROR", `Forward failed for pairing ${pairing.id}:`, err.message);
      // Queue the message for retry
      enqueueMessage(pairing.id, message.content, cable);
    }
  });

  // Send initial ping after subscribing to verify device is responsive
  cable.on("subscribed", () => {
    sendControlMessage(cable, "ping");
  });

  activeCables.set(pairing.id, cable);
  log("INFO", `Connected to pairing ${pairing.id}`);
}

/**
 * Send a control message to the device
 */
function sendControlMessage(cable, action, payload = {}) {
  const content = JSON.stringify({ action, payload });
  return cable.send({
    content,
    content_type: "control",
  });
}

/**
 * Handle control responses from the device
 */
function handleControlResponse(pairingId, message) {
  try {
    const control = JSON.parse(message.content);
    debugLog(`Control response from pairing ${pairingId}: ${control.action}`);

    switch (control.action) {
      case "ping": {
        if (!jsonMode) console.log(`📱 Pairing ${pairingId} ping received, sending pong`);
        const cable = activeCables.get(pairingId);
        if (cable) {
          sendControlMessage(cable, "pong", { status: "ok" });
        }
        break;
      }
      case "pong":
        if (!jsonMode) console.log(`📱 Pairing ${pairingId} pong: ${JSON.stringify(control.payload)}`);
        break;
      case "logs":
        if (!jsonMode) console.log(`📱 Pairing ${pairingId} device logs:`);
        if (control.payload) {
          if (!jsonMode) {
            for (const [key, value] of Object.entries(control.payload)) {
              console.log(`   ${key}: ${value}`);
            }
          }
          storeDiagnostics(pairingId, control.payload);
        }
        break;
      case "status_report":
        if (!jsonMode) console.log(`📊 Pairing ${pairingId} status: event=${control.payload?.event} ws=${control.payload?.ws_state} build=${control.payload?.build}`);
        if (control.payload) {
          storeDiagnostics(pairingId, control.payload);
        }
        break;
      case "reconnect_ack":
        if (!jsonMode) console.log(`📱 Pairing ${pairingId}: device is reconnecting`);
        break;
      case "sync_ack":
        if (!jsonMode) console.log(`📱 Pairing ${pairingId}: device is syncing messages`);
        break;
      default:
        debugLog(`Pairing ${pairingId} unknown control: ${control.action}`);
    }
  } catch {
    if (!jsonMode) console.warn(`⚠️ Invalid control response from pairing ${pairingId}`);
  }
}

/**
 * Store device diagnostics and persist to file for agent access
 */
function storeDiagnostics(pairingId, payload) {
  const entry = {
    ...payload,
    pairing_id: String(pairingId),
    received_at: new Date().toISOString(),
  };
  deviceDiagnostics.set(pairingId, entry);

  // Write all diagnostics to file for agent to read
  const diagPath = new URL("device-diagnostics.json", import.meta.url).pathname;
  try {
    const allDiag = {};
    for (const [id, diag] of deviceDiagnostics) {
      allDiag[`pairing_${id}`] = diag;
    }
    allDiag._listener = {
      active_pairings: [...activeCables.keys()],
      uptime_seconds: Math.floor(process.uptime()),
      updated_at: new Date().toISOString(),
    };
    writeFileSync(diagPath, JSON.stringify(allDiag, null, 2));
    debugLog("Diagnostics saved to device-diagnostics.json");
  } catch (err) {
    if (!jsonMode) console.warn(`⚠️ Could not write diagnostics: ${err.message}`);
  }
}

/**
 * Enqueue a message for retry when OpenClaw is offline.
 * Sends a control message to the device to notify about queuing.
 */
function enqueueMessage(pairingId, content, cable) {
  if (!messageQueues.has(pairingId)) {
    messageQueues.set(pairingId, []);
  }
  const queue = messageQueues.get(pairingId);
  if (queue.length >= MESSAGE_QUEUE_MAX) {
    queue.shift();
    log("WARN", `Message queue full (${MESSAGE_QUEUE_MAX}) for pairing ${pairingId}, dropped oldest message`);
  }
  queue.push({ content, queuedAt: new Date().toISOString() });
  log("WARN", `Message queued for retry (pairing ${pairingId}, queue size: ${queue.length})`);

  // Notify device that the message is queued
  if (cable) {
    sendControlMessage(cable, "status_update", {
      event: "message_queued",
      queue_size: queue.length,
    });
  }
}

/**
 * Drain the message queue by retrying forwarding.
 * Called after a successful forward to flush any backlog.
 */
async function drainMessageQueue(cable, pairingId) {
  const queue = messageQueues.get(pairingId);
  if (!queue || queue.length === 0) return;

  log("INFO", `Draining message queue for pairing ${pairingId} (${queue.length} messages)...`);
  const toRetry = [...queue];
  queue.length = 0; // Clear queue before retrying

  for (const item of toRetry) {
    try {
      const forwardConfig = { ...config, pairingId };
      const response = await forward(forwardConfig, item.content);
      if (response) {
        cable.send({ content: response, content_type: "text" });
        log("INFO", `Queued message forwarded successfully (pairing ${pairingId})`);
      }
    } catch (err) {
      // Re-queue failed messages
      queue.push(item);
      log("WARN", `Queued message retry failed, re-queued (pairing ${pairingId}):`, err.message);
    }
  }

  if (queue.length === 0) {
    messageQueues.delete(pairingId);
    log("INFO", `Message queue drained successfully (pairing ${pairingId})`);
  } else {
    log("WARN", `${queue.length} messages still in queue for pairing ${pairingId} after drain attempt`);
  }
}

main().catch((err) => {
  log("ERROR", "Fatal:", err.message);
  emitJSON({ status: "error", error: err.message });
  process.exit(1);
});
