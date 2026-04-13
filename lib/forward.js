/**
 * Forward a message to the AI agent (OpenClaw, Claude CLI, or Codex CLI) and return the response
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
    case "claude-cli":
      return forwardClaudeCLI(content, config.claudeSessionId, config.claudeCwd, config.debug);
    case "codex-cli":
      return forwardCodexCLI(content, config.codexSessionId, config.codexCwd, config.debug);
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

// ─── Claude CLI ─────────────────────────────────────────────────────

const CLAUDE_CLI_TIMEOUT_MS = 120_000; // 2 minutes — LLM responses can be slow

/**
 * Forward via Claude CLI (non-interactive mode).
 * Supports session continuation via --resume.
 *
 * @param {string} content - User message
 * @param {string|null} sessionId - UUID to resume, or null for new session
 * @param {string|null} cwd - Working directory for Claude
 * @param {boolean} debug
 * @returns {Promise<string|null>}
 */
export function forwardClaudeCLI(content, sessionId, cwd, debug) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json"];

    if (sessionId) {
      args.push("--resume", sessionId);
    }

    args.push(content);

    if (debug) console.log(`\u{1F41B} Claude CLI: claude ${args.join(" ")}`);

    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: cwd || undefined,
      timeout: CLAUDE_CLI_TIMEOUT_MS,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with ${code}: ${stderr}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        // Return the session_id so caller can track it for future messages
        if (result.session_id) {
          proc._sessionId = result.session_id;
        }
        resolve(result.result || null);
      } catch {
        // If not JSON, return raw output
        resolve(stdout.trim() || null);
      }
    });

    proc.on("error", (err) => reject(err));
  });
}

/**
 * Extended version that returns both the response text and the session ID.
 */
export async function forwardClaudeCLIWithSession(content, sessionId, cwd, debug) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json", "--permission-mode", "auto"];

    if (sessionId) {
      args.push("--resume", sessionId);
    }

    args.push(content);

    if (debug) console.log(`\u{1F41B} Claude CLI: claude ${args.join(" ")}`);

    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: cwd || undefined,
      timeout: CLAUDE_CLI_TIMEOUT_MS,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with ${code}: ${stderr}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve({
          text: result.result || null,
          sessionId: result.session_id || sessionId,
          cost: result.total_cost_usd,
          durationMs: result.duration_ms,
        });
      } catch {
        resolve({ text: stdout.trim() || null, sessionId });
      }
    });

    proc.on("error", (err) => reject(err));
  });
}

// ─── Codex CLI ──────────────────────────────────────────────────────

const CODEX_CLI_TIMEOUT_MS = 120_000;

/**
 * Forward via Codex CLI (non-interactive exec mode).
 *
 * @param {string} content - User message
 * @param {string|null} sessionId - Session ID to resume, or null for new
 * @param {string|null} cwd - Working directory
 * @param {boolean} debug
 * @returns {Promise<string|null>}
 */
export function forwardCodexCLI(content, sessionId, cwd, debug) {
  return new Promise((resolve, reject) => {
    let args;

    if (sessionId) {
      args = ["exec", "resume", sessionId, content];
    } else {
      args = ["exec", "-a", "never", content];
    }

    if (debug) console.log(`\u{1F41B} Codex CLI: codex ${args.join(" ")}`);

    const proc = spawn("codex", args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: cwd || undefined,
      timeout: CODEX_CLI_TIMEOUT_MS,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`codex exited with ${code}: ${stderr}`));
        return;
      }
      resolve(stdout.trim() || null);
    });

    proc.on("error", (err) => reject(err));
  });
}

// ─── Webhook ────────────────────────────────────────────────────────

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
