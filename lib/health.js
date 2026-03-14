/**
 * Optional HTTP health check endpoint.
 * Only starts when HEALTH_PORT env var is set (opt-in).
 * Uses native http module — no express needed.
 */
import { createServer } from "node:http";

/**
 * Start a health check HTTP server.
 *
 * @param {number} port - Port to listen on
 * @param {function} getStatus - Callback returning current status object
 * @returns {import("node:http").Server}
 */
export function startHealthServer(port, getStatus) {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const status = getStatus();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });

  server.listen(port, () => {
    // Logged by caller
  });

  return server;
}
