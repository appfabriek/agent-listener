# Agent Listener — Instructions for AI Agents

This document helps AI agents (like OpenClaw, Claude, etc.) manage the Agent Talk To Me listener that connects them to mobile users via voice.

## Overview

The agent-listener bridges the Agent Talk To Me iOS app to your AI agent. When a user speaks into the app, their message is forwarded to you through this listener. Your response is sent back and spoken aloud via text-to-speech.

## Installation

```bash
npm install -g @appfabriek/agent-listener
agent-listener install
```

This installs the listener as a background daemon that starts automatically on login.

## Creating a Pairing

To allow a user to connect their iOS app to your agent:

```bash
agent-listener create-pairing
```

This returns a 6-digit code. The user enters this code in the Agent Talk To Me iOS app. The code is valid for 10 minutes.

For machine-readable output:
```bash
agent-listener create-pairing --json
```

## Monitoring

Check if the listener is running and healthy:

```bash
agent-listener status
```

This shows:
- Whether the daemon is running
- Process ID and uptime
- Listener identifier
- API connection details
- Last activity timestamp

## Configuration

View current configuration:

```bash
agent-listener config
```

Configuration is stored in `agent-listener.conf` (or `.env`) in the install directory. Key settings:
- `API_URL` — The ATTM API server
- `FORWARD_MODE` — How messages reach you: `gateway` (WebSocket), `openclaw-cli`, or `webhook`
- `OPENCLAW_AGENT` — Which agent to forward messages to

## Starting and Stopping

```bash
agent-listener start    # Start the daemon
agent-listener stop     # Stop the daemon
```

## Logs

View recent log output:

```bash
agent-listener logs
```

Logs include connection events, message forwarding, errors, and heartbeat status.

## Troubleshooting

### Listener not running
```bash
agent-listener status     # Check if installed and running
agent-listener install    # Reinstall if needed
agent-listener logs       # Check for errors
```

### No messages arriving
1. Verify the listener is running: `agent-listener status`
2. Check that a pairing exists: `agent-listener create-pairing` if needed
3. Check logs for connection errors: `agent-listener logs`
4. Verify the API is reachable: `agent-listener config` shows the API URL

### Device diagnostics
The file `device-diagnostics.json` in the install directory contains diagnostic data from connected iOS devices, including connection state, app version, and last communication timestamps.

## Uninstalling

```bash
agent-listener uninstall
```

This removes the daemon configuration. The listener files remain on disk.
