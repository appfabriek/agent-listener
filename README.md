# Agent Talk To Me — Listener

Connect any AI agent to mobile voice interaction.

## What is this?

The **Listener** is a lightweight service that connects your AI agent to the [Agent Talk To Me](https://agenttalktome.com) mobile app. It polls the API for incoming voice messages and forwards them to your agent.

## Quick Install

```bash
curl -sL https://agenttalktome.com/install.sh | PAIRING_CODE=<your-code> AGENT_TOKEN=<your-token> sh
```

Get your pairing code and token by visiting [agenttalktome.com](https://agenttalktome.com).

## Manual Install

```bash
git clone https://github.com/appfabriek/agenttalktomelistener.git
cd agenttalktomelistener
npm install
cp .env.example .env
# Edit .env with your AGENT_TOKEN
npm start
```

## Run with PM2 (recommended)

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

## Configuration

Copy `.env.example` to `.env` and set:

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENT_TOKEN` | Yes | Your agent token from pairing |
| `API_URL` | No | API URL (default: `https://api.agenttalktome.com`) |
| `POLL_TIMEOUT` | No | Long-poll timeout in seconds (default: 30) |
| `USE_OPENCLAW_CLI` | No | Use OpenClaw CLI for message processing (default: true) |
| `DEBUG` | No | Enable debug logging (default: false) |

## How it works

1. Visit [agenttalktome.com](https://agenttalktome.com) — get a pairing code
2. Enter the code in the mobile app
3. The Listener polls the API for voice messages
4. Messages are forwarded to your AI agent (via OpenClaw CLI or webhook)
5. Responses are sent back to the app

## Requirements

- Node.js 18+
- npm
- PM2 (recommended for production)

## License

MIT — Made by [Appfabriek](https://appfabriek.com)
