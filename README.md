# Agent Talk To Me — Listener

Connect any AI agent to mobile voice interaction. This Node.js service bridges the Agent Talk To Me iOS app to your AI agent via WebSocket.

```
User (iOS app) ←→ ATTM API ←→ This Listener ←→ Your AI Agent
```

## Quick Start

```bash
git clone https://github.com/appfabriek/agent-listener.git
cd agent-listener
npm install
cp .env.example .env
```

Edit the configuration file (`.env`):

```bash
API_URL=https://staging.agenttalktome.com
LISTENER_NAME=Your Agent Name
FORWARD_MODE=openclaw-cli   # or "webhook"
OPENCLAW_AGENT=main          # your OpenClaw agent name
```

Start:

```bash
npm start
```

On first run, credentials are auto-generated and saved to the configuration file (`.env`).

## CLI Commands

The `agent-listener` command provides a complete management interface:

```bash
agent-listener install          # Install as daemon (launchd/systemd)
agent-listener uninstall        # Remove daemon
agent-listener start            # Start the listener
agent-listener stop             # Stop the listener
agent-listener status           # Show running status, uptime, config
agent-listener create-pairing   # Create a pairing code for the iOS app
agent-listener config           # Show current configuration
agent-listener logs             # Show recent log output
agent-listener help             # Show all commands
```

### Install as Daemon

```bash
agent-listener install
```

On macOS, this creates a launchd plist in `~/Library/LaunchAgents/` so the listener starts on login and restarts on crash. On Linux, it creates a systemd user service.

### Generate a Pairing Code

```bash
agent-listener create-pairing
```

Give the 6-digit code to your user. They enter it in the iOS app to connect.

For JSON output (useful for scripts and AI agents):
```bash
agent-listener create-pairing --json
```

## How Messages Flow

1. User speaks in the iOS app → speech-to-text
2. Text sent via WebSocket to ATTM API
3. ATTM API forwards to this listener (WebSocket)
4. Listener calls your agent (CLI or webhook)
5. Agent responds with text
6. Listener sends response back via WebSocket
7. iOS app speaks the response via text-to-speech

## Forwarding Modes

### OpenClaw CLI (default)

Set `FORWARD_MODE=openclaw-cli` and `OPENCLAW_AGENT=your-agent-name`. The listener calls:

```bash
openclaw agent --agent your-agent-name --message "user's message"
```

### Webhook

Set `FORWARD_MODE=webhook` and `WEBHOOK_URL=http://your-server/endpoint`. The listener POSTs:

```
POST http://your-server/endpoint
Content-Type: text/plain

user's message
```

Your webhook should return the agent's response as plain text.

The webhook URL is validated at startup (must be a valid HTTP/HTTPS URL). If the webhook fails, the listener retries up to 3 times with exponential backoff (1s, 2s, 4s). Client errors (4xx except 408) are not retried. Each request has a 10-second timeout.

## Production Deployment

### Recommended: CLI install

```bash
agent-listener install
```

This auto-detects your platform and installs the appropriate daemon (launchd on macOS, systemd on Linux).

### PM2 (alternative)

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

### Manual launchd (macOS)

See [docs/agent-setup.md](https://agenttalktome.com/setup) for a launchd plist template, or use `agent-listener install` which generates it automatically.

### Manual systemd (Linux)

```ini
[Unit]
Description=ATTM Listener
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/agent-listener
ExecStart=/usr/bin/node index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Or use `agent-listener install` which generates this automatically.

## Health Check

Set `HEALTH_PORT` to enable an HTTP health check endpoint (opt-in):

```bash
HEALTH_PORT=8080
```

```
GET http://localhost:8080/health
→ 200 { "status": "ok", "uptime": 1234, "connected": true, "active_pairings": 1, "listener_id": "lst_..." }
```

Useful for monitoring tools, Docker health checks, or load balancers.

## Configuration

All settings are stored in the `.env` configuration file in the project root. Copy `.env.example` to `.env` and adjust the values for your setup.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_URL` | Yes | — | ATTM API base URL |
| `REGISTRATION_TOKEN` | No | — | Auto-saved after first registration |
| `LISTENER_IDENTIFIER` | No | — | Auto-saved after first registration |
| `LISTENER_NAME` | No | `Agent Listener` | Name shown in the iOS app |
| `LISTENER_TYPE` | No | `agent` | Listener type |
| `FORWARD_MODE` | No | `webhook` | `openclaw-cli` or `webhook` |
| `OPENCLAW_AGENT` | No | `main` | OpenClaw agent name |
| `WEBHOOK_URL` | No | — | Webhook endpoint |
| `WEBHOOK_TOKEN` | No | — | Webhook auth token |
| `HEALTH_PORT` | No | — | HTTP health check port (opt-in, e.g. `8080`) |
| `DEBUG` | No | `false` | Enable debug logging |

## Diagnostics

Send `SIGUSR1` to request diagnostics from all connected devices:

```bash
kill -USR1 $(pgrep -f "node.*index.js")
```

Diagnostics are saved to `device-diagnostics.json`.

## License

MIT
