#!/usr/bin/env node
import "dotenv/config";
import { register, heartbeat, getPairings } from "./lib/api.js";
import { connectCable } from "./lib/cable.js";
import { forward } from "./lib/forward.js";

const config = {
  apiUrl: process.env.API_URL,
  registrationToken: process.env.REGISTRATION_TOKEN,
  listenerType: process.env.LISTENER_TYPE || "agent",
  listenerName: process.env.LISTENER_NAME || "Agent Listener",
  forwardMode: process.env.FORWARD_MODE || "webhook",
  webhookUrl: process.env.WEBHOOK_URL,
  webhookToken: process.env.WEBHOOK_TOKEN,
  debug: process.env.DEBUG === "true",
};

if (!config.apiUrl) {
  console.error("❌ API_URL is required");
  process.exit(1);
}

const log = (...args) => config.debug && console.log("🐛", ...args);

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
    console.log("   Save this as REGISTRATION_TOKEN in .env to reconnect later.");
  } else {
    // Get identifier from heartbeat
    const hb = await heartbeat(config.apiUrl, token);
    identifier = hb.identifier;
    console.log(`✅ Reconnected: ${identifier}`);
  }

  // Step 2: Get active pairings
  const pairings = await getPairings(config.apiUrl, token, identifier);
  console.log(`📱 Active pairings: ${pairings.length}`);

  if (pairings.length === 0) {
    console.log("⏳ No paired devices yet. Waiting for pairing...");
    console.log("   Use the pairing API to connect a device.");
  }

  // Step 3: Start heartbeat loop
  const heartbeatInterval = setInterval(async () => {
    try {
      await heartbeat(config.apiUrl, token, identifier);
      log("💓 Heartbeat OK");
    } catch (err) {
      console.error("❌ Heartbeat failed:", err.message);
    }
  }, 60_000);

  // Step 4: Connect to ActionCable for each pairing
  const cables = [];
  for (const pairing of pairings) {
    log(`Connecting cable for pairing ${pairing.id}...`);
    const cable = await connectCable(config.apiUrl, token, pairing.id, async (message) => {
      // Only handle messages directed to us (to_listener)
      if (message.direction !== "to_listener") return;

      console.log(`📨 Message from device: ${message.content.substring(0, 80)}`);

      try {
        const response = await forward(config, message.content);
        if (response) {
          log(`💬 Response: ${response.substring(0, 80)}`);
          cable.send({
            content: response,
            content_type: "text",
          });
          console.log("✅ Response sent");
        }
      } catch (err) {
        console.error("❌ Forward failed:", err.message);
      }
    });
    cables.push(cable);
    console.log(`🔌 Connected to pairing ${pairing.id} (device: ${pairing.device.name || pairing.device.identifier})`);
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log("👋 Shutting down...");
    clearInterval(heartbeatInterval);
    cables.forEach((c) => c.disconnect());
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Keep alive
  console.log("🟢 Listener running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("💥 Fatal:", err.message);
  process.exit(1);
});
