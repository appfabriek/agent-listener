/**
 * Forward a message to the AI agent (OpenClaw) and return the response
 */
import { spawn } from "child_process";

/**
 * Forward message based on configured mode
 */
export async function forward(config, content) {
  switch (config.forwardMode) {
    case "openclaw-cli":
      return forwardCLI(content, config.debug);
    case "webhook":
      return forwardWebhook(content, config);
    default:
      throw new Error(`Unknown forward mode: ${config.forwardMode}`);
  }
}

/**
 * Forward via OpenClaw CLI
 */
function forwardCLI(content, debug) {
  return new Promise((resolve, reject) => {
    if (debug) console.log("🐛 Spawning: openclaw agent --message ...");

    const proc = spawn("openclaw", ["agent", "--message", content], {
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
 * Forward via webhook
 */
async function forwardWebhook(content, config) {
  const url = new URL(config.webhookUrl);
  if (config.webhookToken) {
    url.searchParams.set("token", config.webhookToken);
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: content,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return text.trim() || null;
}
