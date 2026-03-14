import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = resolve(homedir(), ".config", "agent-listener");
const CONFIG_PATH = resolve(CONFIG_DIR, "config");

/**
 * Get the path to the config file.
 * Returns ~/.config/agent-listener/config if it exists,
 * otherwise falls back to .env in the given directory,
 * otherwise returns the default ~/.config path (for creation).
 */
export function getConfigPath(fallbackDir) {
  if (existsSync(CONFIG_PATH)) return CONFIG_PATH;
  if (fallbackDir) {
    const envPath = resolve(fallbackDir, ".env");
    if (existsSync(envPath)) return envPath;
    const confPath = resolve(fallbackDir, "agent-listener.conf");
    if (existsSync(confPath)) return confPath;
  }
  return CONFIG_PATH;
}

/**
 * Read config as key-value pairs from the config file.
 * Checks ~/.config/agent-listener/config first, then falls back to
 * .env / agent-listener.conf in the given directory.
 */
export function readConfig(fallbackDir) {
  const paths = [CONFIG_PATH];
  if (fallbackDir) {
    paths.push(resolve(fallbackDir, "agent-listener.conf"));
    paths.push(resolve(fallbackDir, ".env"));
  }

  for (const p of paths) {
    if (existsSync(p)) {
      return parseEnvFile(p);
    }
  }
  return {};
}

/**
 * Write or update key-value pairs in the config file at ~/.config/agent-listener/config.
 * Creates the directory and file if they don't exist.
 * Merges with existing values (does not remove keys not in `values`).
 */
export function writeConfig(values) {
  mkdirSync(CONFIG_DIR, { recursive: true });

  let existing = {};
  if (existsSync(CONFIG_PATH)) {
    existing = parseEnvFile(CONFIG_PATH);
  }

  const merged = { ...existing, ...values };
  const lines = Object.entries(merged)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`);

  writeFileSync(CONFIG_PATH, lines.join("\n") + "\n");
  return CONFIG_PATH;
}

/**
 * Parse a KEY=VALUE file (like .env) into an object.
 * Ignores comments and empty lines.
 */
function parseEnvFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const result = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export { CONFIG_DIR, CONFIG_PATH };
