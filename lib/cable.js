/**
 * ActionCable WebSocket client for message streaming
 */
import WebSocket from "ws";

/**
 * Connect to ActionCable and subscribe to a pairing's message channel
 *
 * @param {string} baseUrl - API base URL (https://...)
 * @param {string} token - Registration token for auth
 * @param {number} pairingId - Pairing ID to subscribe to
 * @param {function} onMessage - Callback for incoming messages
 * @returns {{ send, disconnect }}
 */
export async function connectCable(baseUrl, token, pairingId, onMessage) {
  const wsUrl = baseUrl.replace(/^http/, "ws") + "/cable";

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let subscribed = false;
    const channelIdentifier = JSON.stringify({
      channel: "MessageChannel",
      pairing_id: pairingId,
      token: token,
    });

    ws.on("open", () => {
      // ActionCable handshake — subscribe after welcome
    });

    ws.on("message", (raw) => {
      const data = JSON.parse(raw.toString());

      if (data.type === "welcome") {
        // Subscribe to MessageChannel
        ws.send(JSON.stringify({
          command: "subscribe",
          identifier: channelIdentifier,
        }));
        return;
      }

      if (data.type === "confirm_subscription") {
        subscribed = true;
        resolve({
          send: (messageData) => {
            ws.send(JSON.stringify({
              command: "message",
              identifier: channelIdentifier,
              data: JSON.stringify(messageData),
            }));
          },
          disconnect: () => ws.close(),
        });
        return;
      }

      if (data.type === "reject_subscription") {
        reject(new Error(`Subscription rejected for pairing ${pairingId}`));
        ws.close();
        return;
      }

      if (data.type === "ping") return;

      // Regular message
      if (data.message && subscribed) {
        onMessage(data.message);
      }
    });

    ws.on("error", (err) => {
      if (!subscribed) reject(err);
      else console.error("🔌 WebSocket error:", err.message);
    });

    ws.on("close", (code) => {
      if (!subscribed) reject(new Error(`WebSocket closed before subscribe: ${code}`));
      else console.log(`🔌 WebSocket closed (${code}) for pairing ${pairingId}`);
    });
  });
}
