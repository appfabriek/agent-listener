import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Discover all available AI agent backends.
 * Checks for: claude, codex, openclaw CLIs.
 * Returns { backends: string[], openclawAgents: object[] }
 */
export async function discoverBackends() {
  const backends = [];
  const openclawAgents = [];

  // Check claude CLI
  try {
    await execFileAsync("claude", ["--version"], { timeout: 5000 });
    backends.push("claude");
  } catch { /* not installed */ }

  // Check codex CLI
  try {
    await execFileAsync("codex", ["--version"], { timeout: 5000 });
    backends.push("codex");
  } catch { /* not installed */ }

  // Check openclaw CLI + discover agents
  try {
    const { stdout } = await execFileAsync("openclaw", ["agents", "list", "--json"], {
      timeout: 10000,
    });
    const agents = JSON.parse(stdout);
    const mapped = agents.map((a) => ({
      id: a.id,
      name: a.identityName || a.id,
      emoji: a.identityEmoji || "",
      isDefault: a.isDefault || false,
      model: a.model || "",
    }));
    if (mapped.length > 0) {
      backends.push("openclaw");
      openclawAgents.push(...mapped);
    }
  } catch { /* not installed or no agents */ }

  return { backends, openclawAgents };
}

/**
 * Discover available OpenClaw agents via CLI.
 * @returns {Promise<{id: string, name: string, emoji: string, isDefault: boolean, model: string}[]>}
 * @deprecated Use discoverBackends() instead
 */
export async function discoverAgents() {
  try {
    const { stdout } = await execFileAsync("openclaw", ["agents", "list", "--json"], {
      timeout: 10000,
    });
    const agents = JSON.parse(stdout);
    return agents.map((a) => ({
      id: a.id,
      name: a.identityName || a.id,
      emoji: a.identityEmoji || "",
      isDefault: a.isDefault || false,
      model: a.model || "",
    }));
  } catch (e) {
    console.warn(`⚠️  Agent discovery failed: ${e.message}`);
    return [];
  }
}

/**
 * Select the best agent to use.
 * - If only one agent: use it
 * - If multiple: use the default (isDefault=true)
 * - Fallback: use OPENCLAW_AGENT from config
 */
export function selectAgent(agents, fallbackId = "main") {
  if (agents.length === 0) return fallbackId;
  if (agents.length === 1) return agents[0].id;
  const defaultAgent = agents.find((a) => a.isDefault);
  return defaultAgent ? defaultAgent.id : agents[0].id;
}
