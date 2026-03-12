import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Discover available OpenClaw agents via CLI.
 * @returns {Promise<{id: string, name: string, emoji: string, isDefault: boolean, model: string}[]>}
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
