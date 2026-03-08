# Agent Listener

Node.js service that registers as an `agent` listener on the AgentTalkToMe pairing API and bridges messages to an AI agent (OpenClaw).

## How it works

1. Registers as a listener via the pairing API
2. Connects to ActionCable WebSocket for each paired device
3. Forwards incoming messages to the AI agent (via webhook or CLI)
4. Sends the response back through the WebSocket

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your settings
npm start
```

## First run

On first run (no `REGISTRATION_TOKEN`), the listener registers itself and prints the token. Save it in `.env` to reconnect on restart.

## Pairing a device

After the listener is running, create a pairing code via the API:

```bash
curl -X POST https://your-domain.com/api/v1/listeners/LST_ID/pair \
  -H "Authorization: Bearer REG_TOKEN"
```

Enter the 6-digit code in the Agent iOS app to pair.

## Production

```bash
# PM2
pm2 start ecosystem.config.cjs

# systemd
# See docs for systemd service file
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_URL` | Yes | — | AgentTalkToMe API base URL |
| `REGISTRATION_TOKEN` | No | — | Saved token from registration |
| `LISTENER_TYPE` | No | `agent` | Listener type |
| `LISTENER_NAME` | No | `Agent Listener` | Display name |
| `FORWARD_MODE` | No | `webhook` | `webhook` or `openclaw-cli` |
| `WEBHOOK_URL` | No | — | Webhook endpoint for forwarding |
| `WEBHOOK_TOKEN` | No | — | Bearer token for webhook |
| `DEBUG` | No | `false` | Enable debug logging |
