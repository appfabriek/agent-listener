/**
 * Forward a message to the AI agent (OpenClaw) and return the response
 */
import { spawn } from "child_process";

/**
 * Forward message based on configured mode
 */
export async function forward(config, content) {
  switch (config.forwardMode) {
    case "gateway":
      return forwardGateway(config.gateway, config.openclawAgent, content, config.pairingId);
    case "openclaw-cli":
      return forwardCLI(content, config.openclawAgent, config.debug);
    case "webhook":
      return forwardWebhook(content, config);
    default:
      throw new Error(`Unknown forward mode: ${config.forwardMode}`);
  }
}

/**
 * Forward via OpenClaw Gateway WebSocket
 */
export async function forwardGateway(gateway, agentId, content, pairingId) {
  if (!gateway || !gateway.isConnected) {
    throw new Error("Gateway not connected");
  }
  const response = await gateway.sendMessage(agentId, content, pairingId);
  return response || null;
}

/**
 * Forward via OpenClaw CLI
 */
function forwardCLI(content, agentName, debug) {
  return new Promise((resolve, reject) => {
    const args = ["agent"];
    if (agentName) args.push("--agent", agentName);
    args.push("--message", content);

    if (debug) console.log(`🐛 Spawning: openclaw ${args.join(" ")}`);

    const proc = spawn("openclaw", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`openclaw exited with ${code}: ${stderr}`));
      } else {
        resolve(stdout.trim() || null);
      }
    });

    proc.on("error", (err) => reject(err));
  });
}

/**
 * Validate that a webhook URL is a valid HTTP(S) URL.
 * Throws if the URL is invalid.
 */
export function validateWebhookUrl(webhookUrl) {
  if (!webhookUrl) {
    throw new Error("WEBHOOK_URL is required when FORWARD_MODE=webhook");
  }
  let parsed;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error(`WEBHOOK_URL is not a valid URL: ${webhookUrl}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`WEBHOOK_URL must use http or https protocol, got: ${parsed.protocol}`);
  }
}

const WEBHOOK_MAX_RETRIES = 3;
const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Forward via webhook with retry logic (3 retries, exponential backoff).
 */
async function forwardWebhook(content, config) {
  const url = new URL(config.webhookUrl);
  if (config.webhookToken) {
    url.searchParams.set("token", config.webhookToken);
  }

  let lastError;
  for (let attempt = 0; attempt <= WEBHOOK_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: content,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      return text.trim() || null;
    } catch (err) {
      lastError = err;
      if (attempt < WEBHOOK_MAX_RETRIES) {
        // Retry on network errors and 5xx, not on 4xx client errors
        if (err.message && /\b4\d{2}\b/.test(err.message) && !err.message.includes("408")) {
          throw err; // Don't retry client errors (except 408 timeout)
        }
      }
    }
  }
  throw lastError;
}
