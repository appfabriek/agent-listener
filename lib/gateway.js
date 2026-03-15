/**
 * OpenClaw Gateway WebSocket client with auto-reconnect.
 * Connects to the local OpenClaw Gateway for agent RPC calls,
 * replacing the CLI-spawn-per-message approach.
 */
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

const MAX_BACKOFF_MS = 60_000;
const REQUEST_TIMEOUT_MS = 120_000;

export class GatewayConnection extends EventEmitter {
  constructor(url = "ws://127.0.0.1:18789", options = {}) {
    super();
    this.url = url;
    this.authToken = options.authToken || null;
    this.debug = options.debug || false;
    this.ws = null;
    this.authenticated = false;
    this.pendingRequests = new Map(); // id -> {resolve, reject, timeout}
    this.requestCounter = 0;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.intentionalClose = false;
    this._connectPromise = null;
  }

  _debugLog(...args) {
    if (this.debug) console.log("🐛 [gateway]", ...args);
  }

  /**
   * Read the gateway auth token from ~/.openclaw/openclaw.json
   */
  getAuthToken() {
    if (this.authToken) return this.authToken;
    try {
      const configPath = join(homedir(), ".openclaw", "openclaw.json");
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      return config.gateway?.auth?.token || null;
    } catch {
      return null;
    }
  }

  /**
   * Connect to the Gateway WebSocket and complete the auth handshake.
   * Resolves when authenticated, rejects on auth failure or connection error.
   */
  connect() {
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = new Promise((resolve, reject) => {
      this.intentionalClose = false;
      this.authenticated = false;

      const token = this.getAuthToken();
      if (!token) {
        this._connectPromise = null;
        reject(new Error("No gateway auth token found (checked GATEWAY_AUTH_TOKEN and ~/.openclaw/openclaw.json)"));
        return;
      }

      this._debugLog(`Connecting to ${this.url}...`);

      let settled = false;

      try {
        this.ws = new WebSocket(this.url);
      } catch (err) {
        this._connectPromise = null;
        reject(new Error(`WebSocket creation failed: ${err.message}`));
        return;
      }

      // Timeout for the entire connect+auth handshake (3s — fast fallback to CLI)
      const authTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this._connectPromise = null;
          this.ws?.close();
          reject(new Error("Gateway auth handshake timed out"));
        }
      }, 3_000);

      this.ws.on("open", () => {
        this._debugLog("WebSocket connected, waiting for challenge...");
      });

      this.ws.on("message", (raw) => {
        let data;
        try {
          data = JSON.parse(raw.toString());
        } catch {
          return;
        }

        this._debugLog("Received:", JSON.stringify(data));

        // Auth handshake: server sends connect.challenge event
        if (data.type === "event" && data.event === "connect.challenge") {
          this._debugLog("Challenge received, responding with token...");
          this.ws.send(JSON.stringify({
            type: "req",
            id: "auth",
            method: "connect.respond",
            params: { token },
          }));
          return;
        }

        // Auth handshake: server confirms auth
        if (data.type === "res" && data.id === "auth") {
          clearTimeout(authTimeout);
          if (data.ok) {
            this.authenticated = true;
            if (this.reconnectAttempts > 0) {
              console.log(`🌐 Gateway backoff reset (was attempt ${this.reconnectAttempts})`);
            }
            this.reconnectAttempts = 0;
            console.log("🌐 Gateway authenticated");
            this.emit("authenticated");
            if (!settled) {
              settled = true;
              this._connectPromise = null;
              resolve();
            }
          } else {
            console.error("🌐 Gateway auth rejected:", data.payload?.error || "unknown error");
            this.intentionalClose = true; // Don't reconnect on auth rejection
            this.ws.close();
            if (!settled) {
              settled = true;
              this._connectPromise = null;
              reject(new Error(`Gateway auth rejected: ${data.payload?.error || "unknown"}`));
            }
          }
          return;
        }

        // Response to a pending request
        if (data.type === "res" && this.pendingRequests.has(data.id)) {
          const pending = this.pendingRequests.get(data.id);
          this.pendingRequests.delete(data.id);
          clearTimeout(pending.timeout);
          if (data.ok) {
            pending.resolve(data.payload);
          } else {
            pending.reject(new Error(data.payload?.error || `Request ${data.id} failed`));
          }
          return;
        }

        // Generic events after auth
        if (data.type === "event") {
          this.emit("event", data.event, data.payload);
          return;
        }
      });

      this.ws.on("error", (err) => {
        console.error("🌐 Gateway WebSocket error:", err.message);
        if (!settled) {
          settled = true;
          clearTimeout(authTimeout);
          this._connectPromise = null;
          reject(err);
        }
      });

      this.ws.on("close", (code) => {
        this.authenticated = false;
        this._rejectAllPending("Gateway connection closed");

        if (!settled) {
          settled = true;
          clearTimeout(authTimeout);
          this._connectPromise = null;
          reject(new Error(`Gateway WebSocket closed during handshake (code ${code})`));
          // Still schedule reconnect if not intentional
          if (!this.intentionalClose) {
            this._scheduleReconnect();
          }
          return;
        }

        if (this.intentionalClose) {
          console.log("🌐 Gateway disconnected intentionally");
          return;
        }

        console.warn(`🌐 Gateway WebSocket closed (code ${code}), reconnecting...`);
        this._scheduleReconnect();
      });
    });

    return this._connectPromise;
  }

  /**
   * Send an agent message via the Gateway RPC protocol.
   * Returns the response payload text.
   */
  async sendMessage(agentId, message, pairingId) {
    if (!this.authenticated || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Gateway not connected");
    }

    const id = `req_${++this.requestCounter}_${randomUUID().slice(0, 8)}`;
    const idempotencyKey = `attm_${pairingId}_${Date.now()}_${randomUUID().slice(0, 8)}`;

    const payload = await this._sendRequest(id, "agent", {
      idempotencyKey,
      message,
      sessionKey: `attm_pairing_${pairingId}`,
      ...(agentId && agentId !== "main" ? { agent: agentId } : {}),
    });

    // Extract text from response payload
    return payload?.text || payload?.content || JSON.stringify(payload);
  }

  /**
   * Send a raw RPC request and wait for the response.
   */
  _sendRequest(id, method, params) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Gateway request ${id} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.ws.send(JSON.stringify({
        type: "req",
        id,
        method,
        params,
      }));

      this._debugLog(`Sent request ${id}: ${method}`);
    });
  }

  /**
   * Reject all pending requests (called on disconnect).
   */
  _rejectAllPending(reason) {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  /**
   * Clean disconnect from the Gateway.
   */
  disconnect() {
    this.intentionalClose = true;
    clearTimeout(this.reconnectTimer);
    this._rejectAllPending("Gateway disconnecting");
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.authenticated = false;
    this._connectPromise = null;
  }

  /**
   * Whether the gateway is connected and authenticated.
   */
  get isConnected() {
    return this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Schedule a reconnect with exponential backoff.
   */
  _scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), MAX_BACKOFF_MS);
    console.log(`🌐 Gateway reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        console.error("🌐 Gateway reconnect failed:", err.message);
        // _scheduleReconnect will be called from the close handler
      });
    }, delay);
  }
}
