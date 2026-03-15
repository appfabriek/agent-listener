# Agent Listener — Instructions for AI Agents

This document helps AI agents (like OpenClaw, Claude, etc.) manage the Agent Talk To Me listener that connects them to mobile users via voice.

## Overview

The agent-listener bridges the Agent Talk To Me iOS app to your AI agent. When a user speaks into the app, their message is forwarded to you through this listener. Your response is sent back and spoken aloud via text-to-speech.

## Installation

```bash
npx agent-listener start --agent your-agent-name --json
```

This single command registers, connects, and generates a pairing code. No configuration files needed. Credentials are stored in `~/.config/agent-listener/`.

For permanent installation as a background daemon:
```bash
npx agent-listener install
```

## Creating a Pairing

To allow a user to connect their iOS app to your agent:

```bash
npx agent-listener start --agent your-agent-name --json --pair
```

Output:
```json
{"status":"running","agent":"bob","pairing_code":"847291","expires_at":"2026-03-13T12:05:00Z"}
```

The user enters the 6-digit code in the Agent Talk To Me iOS app. The code is valid for 1 hour.

## Control Messages

You can communicate with the iOS app through control messages. These are JSON messages with `content_type: "control"` that are not shown in the chat UI.

### Request device logs

Send a `request_logs` control message to get diagnostics from the connected iOS device:

```json
{"action": "request_logs", "payload": {}}
```

The device responds with a `logs` message containing:
- Device ID, pairing ID, listener ID
- WebSocket connection state
- App version and build number
- Push notification status
- Recent debug log lines (last 200 entries)
- Full log history

### Ping / Pong

Verify the device is reachable:

```json
{"action": "ping", "payload": {"source": "agent"}}
```

The device responds with:
```json
{"action": "pong", "payload": {"status": "ok", "connected": "true", "message_count": "5"}}
```

### Request reconnect

Ask the device to reconnect its WebSocket:

```json
{"action": "reconnect", "payload": {}}
```

### Request message sync

Ask the device to sync missed messages:

```json
{"action": "sync", "payload": {}}
```

### How to send control messages

Control messages are sent as regular messages with `content_type: "control"`. The listener forwards them through the same channel as text messages. To send one from your agent, reply with a JSON string as the message content and set the content type to control.

## Monitoring

Check if the listener is running and healthy:

```bash
npx agent-listener status
```

This shows: whether the daemon is running, process ID, listener identifier, API connection, and last activity.

## Configuration

View current configuration:

```bash
npx agent-listener config
```

Key settings:
- `API_URL` — The ATTM API server
- `FORWARD_MODE` — How messages reach you: `gateway` (WebSocket), `openclaw-cli`, or `webhook`
- `OPENCLAW_AGENT` — Which agent to forward messages to
- `HEALTH_PORT` — Optional HTTP health check endpoint port

## Logs

View recent log output:

```bash
npx agent-listener logs
```

Device diagnostics are saved to `device-diagnostics.json` in `~/.config/agent-listener/` whenever the iOS app sends a status report.

## Important Notes for Responses

- **No emojis**: The iOS app reads your responses aloud via text-to-speech. Emojis are spoken as descriptions (e.g. "smiling face"), which sounds unnatural. Use plain text only.
- **Keep responses concise**: Long responses take a long time to speak. Aim for 1-3 sentences.
- **Dutch language**: The app's speech recognition and TTS are configured for Dutch (nl-NL) by default.

## Troubleshooting

### Listener not running
```bash
npx agent-listener status
npx agent-listener logs
```

### No messages arriving
1. Verify the listener is running: `npx agent-listener status`
2. Check logs for connection errors: `npx agent-listener logs`
3. Request device diagnostics via `request_logs` control message
4. Check `device-diagnostics.json` for device state

### Uninstalling
```bash
npx agent-listener uninstall
```
