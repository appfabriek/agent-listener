/**
 * Gather sessions from Claude CLI, Codex CLI, and OpenClaw.
 * Returns a unified list sorted by last user interaction time.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

/**
 * Gather all sessions from all supported agents, sorted by lastUserMessageAt (desc).
 * @param {object} options - { gateway, openclawAgent, debug }
 * @returns {Promise<Array>} Unified session list
 */
export async function gatherSessions(options = {}) {
  const results = await Promise.allSettled([
    gatherClaudeSessions(options.debug),
    gatherCodexSessions(options.debug),
    gatherOpenClawSessions(options),
  ]);

  const sessions = [];
  for (const result of results) {
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      sessions.push(...result.value);
    } else if (result.status === "rejected" && options.debug) {
      console.log(`\u{1F41B} Session gather error: ${result.reason?.message}`);
    }
  }

  // Sort by last user message time, most recent first
  sessions.sort((a, b) => {
    const tA = new Date(a.lastUserMessageAt || 0).getTime();
    const tB = new Date(b.lastUserMessageAt || 0).getTime();
    return tB - tA;
  });

  return sessions;
}

// ─── Claude CLI Sessions ────────────────────────────────────────────

/**
 * Scan ~/.claude for sessions. Each session has an index in sessions/ and
 * conversation data in projects/<key>/<sessionId>.jsonl.
 */
async function gatherClaudeSessions(debug) {
  const claudeDir = join(homedir(), ".claude");
  const projectsDir = join(claudeDir, "projects");

  if (!existsSync(projectsDir)) return [];

  const sessions = [];

  // Scan all project directories for JSONL session files
  const projectDirs = safeReaddir(projectsDir);
  for (const projKey of projectDirs) {
    const projPath = join(projectsDir, projKey);
    if (!isDir(projPath)) continue;

    const files = safeReaddir(projPath).filter(
      (f) => f.endsWith(".jsonl") && !f.includes("subagent"),
    );

    for (const file of files) {
      try {
        const sessionId = basename(file, ".jsonl");
        const filePath = join(projPath, file);
        const stat = statSync(filePath);

        // Skip very old sessions (older than 90 days)
        if (Date.now() - stat.mtimeMs > 90 * 24 * 60 * 60 * 1000) continue;

        const session = parseClaudeSession(filePath, sessionId, projKey);
        if (session) sessions.push(session);
      } catch {
        // Skip unreadable files
      }
    }
  }

  if (debug) console.log(`\u{1F41B} Claude: found ${sessions.length} sessions`);
  return sessions;
}

/**
 * Parse a Claude JSONL session file to extract metadata + last user message.
 */
function parseClaudeSession(filePath, sessionId, projectKey) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  let firstUserText = null;
  let lastUserText = null;
  let lastUserTimestamp = null;
  let model = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      // Extract model from assistant messages
      if (!model && entry.message?.model) {
        model = entry.message.model;
      }

      // Look for user text messages (skip tool_result entries)
      if (entry.type === "user" && entry.message?.content) {
        for (const block of entry.message.content) {
          if (block.type === "text" && block.text?.trim()) {
            if (!firstUserText) firstUserText = block.text.trim();
            lastUserText = block.text.trim();
            lastUserTimestamp = entry.timestamp;
          }
        }
      }
    } catch {
      // Skip unparseable lines
    }
  }

  if (!lastUserTimestamp) return null;

  // Derive project name from project key (e.g. "-Users-geert-code-agenttalktome" → "agenttalktome")
  const projectName = projectKey.split("-").filter(Boolean).pop() || projectKey;

  return {
    id: sessionId,
    agentType: "claude",
    title: truncate(firstUserText, 80),
    lastUserMessage: truncate(lastUserText, 120),
    lastUserMessageAt: lastUserTimestamp,
    project: projectName,
    model: simplifyModel(model),
    resumable: true,
  };
}

// ─── Codex CLI Sessions ─────────────────────────────────────────────

/**
 * Scan ~/.codex/sessions for JSONL session files.
 */
async function gatherCodexSessions(debug) {
  const sessionsDir = join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsDir)) return [];

  const sessions = [];
  const jsonlFiles = findJsonlFiles(sessionsDir);

  for (const filePath of jsonlFiles) {
    try {
      const stat = statSync(filePath);
      // Skip very old sessions
      if (Date.now() - stat.mtimeMs > 90 * 24 * 60 * 60 * 1000) continue;

      const session = parseCodexSession(filePath);
      if (session) sessions.push(session);
    } catch {
      // Skip
    }
  }

  if (debug) console.log(`\u{1F41B} Codex: found ${sessions.length} sessions`);
  return sessions;
}

/**
 * Parse a Codex JSONL session file.
 */
function parseCodexSession(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  let sessionId = null;
  let sessionTimestamp = null;
  let cwd = null;
  let firstUserText = null;
  let lastUserText = null;
  let lastUserTimestamp = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      // Session metadata (first line)
      if (entry.type === "session_meta") {
        sessionId = entry.payload?.id;
        sessionTimestamp = entry.payload?.timestamp || entry.timestamp;
        cwd = entry.payload?.cwd;
      }

      // User messages
      if (entry.type === "response_item" && entry.payload?.role === "user") {
        const textContent = entry.payload.content?.find(
          (c) => c.type === "input_text" && c.text?.trim() && !c.text.startsWith("<"),
        );
        if (textContent) {
          if (!firstUserText) firstUserText = textContent.text.trim();
          lastUserText = textContent.text.trim();
          lastUserTimestamp = entry.timestamp;
        }
      }
    } catch {
      // Skip
    }
  }

  if (!sessionId || !lastUserTimestamp) return null;

  const projectName = cwd ? cwd.split("/").filter(Boolean).pop() : null;

  return {
    id: sessionId,
    agentType: "codex",
    title: truncate(firstUserText, 80),
    lastUserMessage: truncate(lastUserText, 120),
    lastUserMessageAt: lastUserTimestamp,
    project: projectName,
    model: "gpt-5",
    resumable: true,
  };
}

// ─── OpenClaw Sessions ──────────────────────────────────────────────

/**
 * Get OpenClaw sessions via the gateway (if connected) or CLI.
 */
async function gatherOpenClawSessions(options) {
  // Try gateway first
  if (options.gateway?.isConnected) {
    try {
      const sessions = await getOpenClawSessionsViaGateway(options.gateway);
      if (options.debug) console.log(`\u{1F41B} OpenClaw (gateway): found ${sessions.length} sessions`);
      return sessions;
    } catch {
      // Fall through to CLI
    }
  }

  // Fall back to CLI
  try {
    const sessions = await getOpenClawSessionsViaCLI(options.openclawAgent, options.debug);
    if (options.debug) console.log(`\u{1F41B} OpenClaw (CLI): found ${sessions.length} sessions`);
    return sessions;
  } catch {
    return [];
  }
}

/**
 * Get sessions from OpenClaw gateway.
 */
async function getOpenClawSessionsViaGateway(gateway) {
  // Gateway may support a sessions query — for now return empty
  // TODO: implement when OpenClaw gateway adds session list endpoint
  return [];
}

/**
 * Get sessions from OpenClaw CLI (openclaw message read or agent sessions).
 */
function getOpenClawSessionsViaCLI(agentName, debug) {
  return new Promise((resolve) => {
    // Try to list agent sessions
    const proc = spawn("openclaw", ["agents", "list", "--json"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });

    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.on("close", () => {
      try {
        const agents = JSON.parse(stdout);
        // Each agent is a potential "session" in OpenClaw's model
        const sessions = (Array.isArray(agents) ? agents : []).map((agent) => ({
          id: agent.id || agent.name || "openclaw-default",
          agentType: "openclaw",
          title: agent.name || "OpenClaw Agent",
          lastUserMessage: null,
          lastUserMessageAt: agent.lastActivity || new Date().toISOString(),
          project: null,
          model: "openclaw",
          resumable: true,
        }));
        resolve(sessions);
      } catch {
        resolve([]);
      }
    });
    proc.on("error", () => resolve([]));
  });
}

// ─── Helpers ────────────────────────────────────────────────────────

function truncate(str, maxLen) {
  if (!str) return null;
  return str.length > maxLen ? str.substring(0, maxLen - 1) + "\u2026" : str;
}

function simplifyModel(model) {
  if (!model) return null;
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  return model;
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recursively find all .jsonl files under a directory.
 */
function findJsonlFiles(dir, maxDepth = 4, depth = 0) {
  if (depth > maxDepth) return [];
  const results = [];
  for (const entry of safeReaddir(dir)) {
    const fullPath = join(dir, entry);
    if (isDir(fullPath)) {
      results.push(...findJsonlFiles(fullPath, maxDepth, depth + 1));
    } else if (entry.endsWith(".jsonl")) {
      results.push(fullPath);
    }
  }
  return results;
}
