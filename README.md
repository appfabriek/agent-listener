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

Edit `.env`:

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

On first run, credentials are auto-generated and saved to `.env`.

## Generate a Pairing Code

With the listener running, open a second terminal:

```bash
./bin/create-pairing-code.sh
```

Give the 6-digit code to your user. They enter it in the iOS app to connect.

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

## Production Deployment

### PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

### launchd (macOS)

See [docs/agent-setup.md](https://agenttalktome.com/setup) for a launchd plist template.

### systemd (Linux)

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

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_URL` | Yes | — | ATTM API base URL |
| `REGISTRATION_TOKEN` | No | — | Auto-saved after first registration |
| `IDENTIFIER` | No | — | Auto-saved after first registration |
| `LISTENER_NAME` | No | `Agent Listener` | Name shown in the iOS app |
| `LISTENER_TYPE` | No | `agent` | Listener type |
| `FORWARD_MODE` | No | `webhook` | `openclaw-cli` or `webhook` |
| `OPENCLAW_AGENT` | No | `main` | OpenClaw agent name |
| `WEBHOOK_URL` | No | — | Webhook endpoint |
| `WEBHOOK_TOKEN` | No | — | Webhook auth token |
| `DEBUG` | No | `false` | Enable debug logging |

## Diagnostics

Send `SIGUSR1` to request diagnostics from all connected devices:

```bash
kill -USR1 $(pgrep -f "node.*index.js")
```

Diagnostics are saved to `device-diagnostics.json`.

## License

MIT
