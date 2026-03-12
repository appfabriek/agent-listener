/**
 * AgentTalkToMe Pairing API client
 */

async function apiRequest(baseUrl, method, path, { token, body } = {}) {
  const url = `${baseUrl}/api/v1${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${method} ${path} failed: ${response.status} ${text}`);
  }

  return response.json();
}

/**
 * Register a new listener
 */
export async function register(baseUrl, { type, name, publicKey }) {
  const body = { type, name };
  if (publicKey) body.public_key = publicKey;

  return apiRequest(baseUrl, "POST", "/listeners/register", { body });
}

/**
 * Send heartbeat and get listener status
 */
export async function heartbeat(baseUrl, token, identifier) {
  if (!identifier) {
    // If we don't have identifier yet, we need to get it from pairings or store it
    throw new Error("Identifier required for heartbeat. Register first.");
  }
  return apiRequest(baseUrl, "PUT", `/listeners/${identifier}/heartbeat`, { token });
}

/**
 * Get active pairings for this listener
 */
export async function getPairings(baseUrl, token, identifier) {
  const result = await apiRequest(baseUrl, "GET", `/listeners/${identifier}/pairings`, { token });
  return result.pairings || [];
}

/**
 * Create a pairing code
 */
export async function createPairingCode(baseUrl, token, identifier) {
  return apiRequest(baseUrl, "POST", `/listeners/${identifier}/pair`, { token });
}

/**
 * Send a message via REST (alternative to ActionCable)
 */
export async function sendMessage(baseUrl, token, pairingId, content, contentType = "text") {
  return apiRequest(baseUrl, "POST", `/pairings/${pairingId}/messages`, {
    token,
    body: { content, content_type: contentType },
  });
}

/**
 * Update the list of discovered agents for this listener.
 * The Rails endpoint may not exist yet — caller should handle 404 gracefully.
 */
export async function updateAgents(baseUrl, token, identifier, agents) {
  return apiRequest(baseUrl, "PUT", `/listeners/${identifier}/agents`, {
    token,
    body: { agents },
  });
}

/**
 * Register restart command and install info with the API.
 * Allows the Rails backend to remotely restart the listener.
 */
export async function registerRestart(baseUrl, token, identifier, { restart_command, install_path, platform }) {
  return apiRequest(baseUrl, "PUT", `/listeners/${identifier}/restart_command`, {
    token,
    body: { restart_command, install_path, platform },
  });
}
