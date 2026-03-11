#!/usr/bin/env node
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { register, heartbeat, getPairings } from "./lib/api.js";
import { connectCable, connectListenerChannel } from "./lib/cable.js";
import { forward } from "./lib/forward.js";

const config = {
  apiUrl: process.env.API_URL,
  registrationToken: process.env.REGISTRATION_TOKEN,
  identifier: process.env.IDENTIFIER || process.env.LISTENER_IDENTIFIER,
  listenerType: process.env.LISTENER_TYPE || "agent",
  listenerName: process.env.LISTENER_NAME || "Agent Listener",
  forwardMode: process.env.FORWARD_MODE || "webhook",
  openclawAgent: process.env.OPENCLAW_AGENT || "main",
  webhookUrl: process.env.WEBHOOK_URL,
  webhookToken: process.env.WEBHOOK_TOKEN,
  debug: process.env.DEBUG === "true",
};

if (!config.apiUrl) {
  console.error("❌ API_URL is required");
  process.exit(1);
}

const log = (...args) => config.debug && console.log("🐛", ...args);

// Track active cable connections by pairing ID
const activeCables = new Map();

// Track device diagnostics per pairing (updated via status_report + logs)
const deviceDiagnostics = new Map();

/**
 * Persist registration token to .env file after first registration.
 * Updates REGISTRATION_TOKEN if the file exists, or creates it from .env.example.
 */
function persistCredentialsToEnv(token, identifier) {
  const envPath = new URL(".env", import.meta.url).pathname;
  try {
    if (existsSync(envPath)) {
      let content = readFileSync(envPath, "utf-8");
      // Update or append REGISTRATION_TOKEN
      if (content.includes("REGISTRATION_TOKEN=")) {
        content = content.replace(/^REGISTRATION_TOKEN=.*$/m, `REGISTRATION_TOKEN=${token}`);
      } else {
        content += `\nREGISTRATION_TOKEN=${token}\n`;
      }
      // Update or append IDENTIFIER
      if (content.includes("IDENTIFIER=")) {
        content = content.replace(/^IDENTIFIER=.*$/m, `IDENTIFIER=${identifier}`);
      } else {
        content += `IDENTIFIER=${identifier}\n`;
      }
      writeFileSync(envPath, content);
    } else {
      // Create .env from .env.example if it exists, otherwise create minimal .env
      const examplePath = new URL(".env.example", import.meta.url).pathname;
      let content;
      if (existsSync(examplePath)) {
        content = readFileSync(examplePath, "utf-8");
        content = content.replace(/^REGISTRATION_TOKEN=.*$/m, `REGISTRATION_TOKEN=${token}`);
        content = content.replace(/^IDENTIFIER=.*$/m, `IDENTIFIER=${identifier}`);
      } else {
        content = `API_URL=${config.apiUrl}\nREGISTRATION_TOKEN=${token}\nIDENTIFIER=${identifier}\n`;
      }
      writeFileSync(envPath, content);
    }
    console.log(`💾 Credentials saved to .env`);
  } catch (err) {
    console.warn(`⚠️  Could not save credentials to .env: ${err.message}`);
    console.log(`   Save manually: REGISTRATION_TOKEN=${token}`);
    console.log(`   Save manually: IDENTIFIER=${identifier}`);
  }
}

async function main() {
  console.log("🤖 Agent Listener starting...");
  console.log(`📡 API: ${config.apiUrl}`);
  console.log(`🔧 Forward: ${config.forwardMode}`);

  // Step 1: Register or reconnect
  let token = config.registrationToken;
  let identifier;

  if (!token) {
    console.log("📝 Registering new listener...");
    const result = await register(config.apiUrl, {
      type: config.listenerType,
      name: config.listenerName,
    });
    token = result.registration_token;
    identifier = result.identifier;
    console.log(`✅ Registered: ${identifier}`);
    console.log(`🔑 Token: ${token}`);

    // Auto-persist credentials to .env
    persistCredentialsToEnv(token, identifier);
  } else {
    identifier = config.identifier;
    if (identifier) {
      const hb = await heartbeat(config.apiUrl, token, identifier);
      identifier = hb.identifier;
      console.log(`✅ Reconnected: ${identifier}`);
    } else {
      // Fallback: no identifier saved, re-register
      console.log("⚠️  No IDENTIFIER found, re-registering...");
      const result = await register(config.apiUrl, {
        type: config.listenerType,
        name: config.listenerName,
      });
      token = result.registration_token;
      identifier = result.identifier;
      console.log(`✅ Re-registered: ${identifier}`);
      persistCredentialsToEnv(token, identifier);
    }
  }

  // Step 2: Get active pairings and connect
  await syncPairings(token, identifier);

  // Step 3: Subscribe to ListenerChannel for instant new-pairing notifications
  const listenerCable = connectListenerChannel(config.apiUrl, token, (event) => {
    if (event.type === "new_pairing") {
      console.log(`📱 New pairing via ListenerChannel: ${event.pairing_id} (device: ${event.device?.name || "unknown"})`);
      if (!activeCables.has(event.pairing_id)) {
        connectPairing(config.apiUrl, token, { id: event.pairing_id, device: event.device });
      }
    } else {
      log(`📡 ListenerChannel event: ${event.type}`);
    }
  });

  // Step 4: Heartbeat every 60s
  const heartbeatInterval = setInterval(async () => {
    try {
      await heartbeat(config.apiUrl, token, identifier);
      log("💓 Heartbeat OK");
    } catch (err) {
      console.error("❌ Heartbeat failed:", err.message);
    }
  }, 60_000);

  // Step 5: Sync pairings every 60s (fallback for missed ListenerChannel events)
  const syncInterval = setInterval(async () => {
    try {
      await syncPairings(token, identifier);
    } catch (err) {
      console.error("❌ Pairing sync failed:", err.message);
    }
  }, 60_000);

  // Graceful shutdown
  const shutdown = () => {
    console.log("👋 Shutting down...");
    clearInterval(heartbeatInterval);
    clearInterval(syncInterval);
    listenerCable.disconnect();
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
    console.log("📊 Requesting diagnostics from all devices...");
    for (const [id, cable] of activeCables) {
      sendControlMessage(cable, "request_logs");
    }
  });

  console.log("🟢 Listener running. Press Ctrl+C to stop.");
  console.log("   Send SIGUSR1 to request device diagnostics.");
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

    console.log(`📱 New pairing detected: ${pairing.id} (device: ${pairing.device?.name || pairing.device?.identifier || "unknown"})`);
    connectPairing(config.apiUrl, token, pairing);
  }

  // Disconnect removed pairings
  for (const [id, cable] of activeCables) {
    if (!currentIds.has(id)) {
      console.log(`📱 Pairing ${id} removed, disconnecting...`);
      cable.disconnect();
      activeCables.delete(id);
    }
  }

  if (activeCables.size === 0 && pairings.length === 0) {
    console.log("⏳ No paired devices yet. Will check again in 60s.");
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

    console.log(`📨 Message from device (pairing ${pairing.id}): ${message.content.substring(0, 80)}`);

    try {
      const response = await forward(config, message.content);
      if (response) {
        log(`💬 Response: ${response.substring(0, 80)}`);
        const sent = cable.send({
          content: response,
          content_type: "text",
        });
        if (sent) {
          console.log("✅ Response sent");
        } else {
          console.warn("⚠️ Response queued (WebSocket reconnecting)");
        }
      }
    } catch (err) {
      console.error("❌ Forward failed:", err.message);
    }
  });

  // Send initial ping after subscribing to verify device is responsive
  cable.on("subscribed", () => {
    sendControlMessage(cable, "ping");
  });

  activeCables.set(pairing.id, cable);
  console.log(`🔌 Connected to pairing ${pairing.id}`);
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
    log(`🎛️ Control response from pairing ${pairingId}: ${control.action}`);

    switch (control.action) {
      case "ping": {
        console.log(`📱 Pairing ${pairingId} ping received, sending pong`);
        const cable = activeCables.get(pairingId);
        if (cable) {
          sendControlMessage(cable, "pong", { status: "ok" });
        }
        break;
      }
      case "pong":
        console.log(`📱 Pairing ${pairingId} pong: ${JSON.stringify(control.payload)}`);
        break;
      case "logs":
        console.log(`📱 Pairing ${pairingId} device logs:`);
        if (control.payload) {
          for (const [key, value] of Object.entries(control.payload)) {
            console.log(`   ${key}: ${value}`);
          }
          storeDiagnostics(pairingId, control.payload);
        }
        break;
      case "status_report":
        console.log(`📊 Pairing ${pairingId} status: event=${control.payload?.event} ws=${control.payload?.ws_state} build=${control.payload?.build}`);
        if (control.payload) {
          storeDiagnostics(pairingId, control.payload);
        }
        break;
      case "reconnect_ack":
        console.log(`📱 Pairing ${pairingId}: device is reconnecting`);
        break;
      case "sync_ack":
        console.log(`📱 Pairing ${pairingId}: device is syncing messages`);
        break;
      default:
        log(`📱 Pairing ${pairingId} unknown control: ${control.action}`);
    }
  } catch {
    console.warn(`⚠️ Invalid control response from pairing ${pairingId}`);
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
    log(`📁 Diagnostics saved to device-diagnostics.json`);
  } catch (err) {
    console.warn(`⚠️ Could not write diagnostics: ${err.message}`);
  }
}

main().catch((err) => {
  console.error("💥 Fatal:", err.message);
  process.exit(1);
});
