/**
 * ActionCable WebSocket client with auto-reconnect
 */
import WebSocket from "ws";
import { EventEmitter } from "events";

const MAX_BACKOFF_MS = 60_000;

/**
 * Connect to ActionCable and subscribe to a pairing's message channel.
 * Auto-reconnects on close/error with exponential backoff.
 *
 * @param {string} baseUrl - API base URL (https://...)
 * @param {string} token - Registration token for auth
 * @param {number} pairingId - Pairing ID to subscribe to
 * @param {function} onMessage - Callback for incoming messages
 * @returns {CableConnection} - Object with send(), disconnect(), and event emitter
 */
export function connectCable(baseUrl, token, pairingId, onMessage) {
  const wsUrl = baseUrl.replace(/^http/, "ws") + "/cable";
  const channelIdentifier = JSON.stringify({
    channel: "MessageChannel",
    pairing_id: pairingId,
    token: token,
  });

  const connection = new CableConnection(wsUrl, channelIdentifier, pairingId, onMessage);
  connection.connect();
  return connection;
}

class CableConnection extends EventEmitter {
  constructor(wsUrl, channelIdentifier, pairingId, onMessage) {
    super();
    this.wsUrl = wsUrl;
    this.channelIdentifier = channelIdentifier;
    this.pairingId = pairingId;
    this.onMessage = onMessage;
    this.ws = null;
    this.subscribed = false;
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
  }

  connect() {
    this.intentionalClose = false;
    this.subscribed = false;

    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (err) {
      console.error(`🔌 WebSocket creation failed for pairing ${this.pairingId}:`, err.message);
      this._scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      // ActionCable handshake — subscribe after welcome
    });

    this.ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (data.type === "welcome") {
        this.ws.send(JSON.stringify({
          command: "subscribe",
          identifier: this.channelIdentifier,
        }));
        return;
      }

      if (data.type === "confirm_subscription") {
        this.subscribed = true;
        this.reconnectAttempts = 0;
        console.log(`🔌 Subscribed to pairing ${this.pairingId}`);
        this.emit("subscribed");
        return;
      }

      if (data.type === "reject_subscription") {
        console.error(`🔌 Subscription rejected for pairing ${this.pairingId}`);
        this.emit("rejected");
        // Don't reconnect on rejection — credentials are wrong
        this.intentionalClose = true;
        this.ws.close();
        return;
      }

      if (data.type === "ping") return;

      if (data.type === "disconnect") {
        console.warn(`🔌 Server requested disconnect for pairing ${this.pairingId}`);
        // Let close handler trigger reconnect
        return;
      }

      // Regular message
      if (data.message && this.subscribed) {
        this.onMessage(data.message);
      }
    });

    this.ws.on("error", (err) => {
      console.error(`🔌 WebSocket error (pairing ${this.pairingId}):`, err.message);
    });

    this.ws.on("close", (code) => {
      this.subscribed = false;
      if (this.intentionalClose) {
        console.log(`🔌 WebSocket closed intentionally (pairing ${this.pairingId})`);
        return;
      }
      console.warn(`🔌 WebSocket closed (${code}) for pairing ${this.pairingId}, reconnecting...`);
      this._scheduleReconnect();
    });
  }

  send(messageData) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.subscribed) {
      console.warn(`🔌 Cannot send: WebSocket not ready (pairing ${this.pairingId})`);
      return false;
    }
    this.ws.send(JSON.stringify({
      command: "message",
      identifier: this.channelIdentifier,
      data: JSON.stringify(messageData),
    }));
    return true;
  }

  disconnect() {
    this.intentionalClose = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected() {
    return this.subscribed && this.ws?.readyState === WebSocket.OPEN;
  }

  _scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), MAX_BACKOFF_MS);
    console.log(`🔌 Reconnecting pairing ${this.pairingId} in ${delay / 1000}s (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
