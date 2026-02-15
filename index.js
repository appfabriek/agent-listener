#!/usr/bin/env node
import 'dotenv/config';
import { spawn } from 'child_process';

// Configuration
const AGENT_TOKEN = process.env.AGENT_TOKEN;
const API_URL = process.env.API_URL || 'https://api.agenttalktome.com';
const POLL_TIMEOUT = parseInt(process.env.POLL_TIMEOUT || '30');
const USE_OPENCLAW_CLI = process.env.USE_OPENCLAW_CLI !== 'false'; // Default true
const OPENCLAW_WEBHOOK_URL = process.env.OPENCLAW_WEBHOOK_URL || 'http://localhost:18888/hooks/wake';
const OPENCLAW_WEBHOOK_TOKEN = process.env.OPENCLAW_WEBHOOK_TOKEN || 'lena-voice-hook-2026';
const DEBUG = process.env.DEBUG === 'true';

// Validation
if (!AGENT_TOKEN) {
  console.error('❌ ERROR: AGENT_TOKEN environment variable is required');
  console.error('Set it in .env file or export AGENT_TOKEN=oc_agent_xxxxx');
  process.exit(1);
}

console.log('🤖 OpenVoice Agent Poller starting...');
console.log(`📡 API: ${API_URL}`);
console.log(`⏱️  Poll timeout: ${POLL_TIMEOUT}s`);
console.log(`🔧 Mode: ${USE_OPENCLAW_CLI ? 'OpenClaw CLI' : 'Webhook'}`);
if (DEBUG) console.log('🐛 Debug mode enabled');

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Forward message to OpenClaw using CLI
 */
async function forwardToOpenClawCLI(message) {
  return new Promise((resolve, reject) => {
    if (DEBUG) console.log('🔧 Spawning: openclaw agent --message ...');
    
    const openclaw = spawn('openclaw', ['agent', '--message', message], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    openclaw.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    openclaw.stderr.on('data', (data) => {
      stderr += data.toString();
      if (DEBUG) console.error('📢 stderr:', data.toString());
    });

    openclaw.on('close', (code) => {
      if (code !== 0) {
        console.error(`❌ openclaw agent exited with code ${code}`);
        if (stderr) console.error('stderr:', stderr);
        reject(new Error(`openclaw agent failed with code ${code}`));
      } else {
        const response = stdout.trim();
        if (DEBUG) console.log('✅ OpenClaw response:', response.substring(0, 100) + '...');
        resolve(response);
      }
    });

    openclaw.on('error', (err) => {
      console.error('❌ Failed to spawn openclaw:', err.message);
      reject(err);
    });
  });
}

/**
 * Forward message to OpenClaw using webhook
 */
async function forwardToOpenClawWebhook(message) {
  const url = `${OPENCLAW_WEBHOOK_URL}?token=${OPENCLAW_WEBHOOK_TOKEN}`;
  
  if (DEBUG) console.log(`🔧 POST ${url}`);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain'
    },
    body: message
  });

  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
  }

  const responseText = await response.text();
  if (DEBUG) console.log('✅ Webhook response:', responseText.substring(0, 100) + '...');
  return responseText;
}

/**
 * Forward message to OpenClaw (auto-select method)
 */
async function forwardToOpenClaw(message) {
  if (USE_OPENCLAW_CLI) {
    return await forwardToOpenClawCLI(message);
  } else {
    return await forwardToOpenClawWebhook(message);
  }
}

/**
 * Send response back to agent API
 */
async function sendResponse(messageId, responseText) {
  const url = `${API_URL}/v1/agent/respond`;
  
  if (DEBUG) console.log(`📤 Sending response for message ${messageId}`);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AGENT_TOKEN}`
    },
    body: JSON.stringify({
      messageId: messageId,
      text: responseText
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send response: ${response.status} ${error}`);
  }

  const result = await response.json();
  if (DEBUG) console.log('✅ Response sent:', result);
  return result;
}

/**
 * Poll for messages from API
 */
async function pollMessages() {
  const url = `${API_URL}/v1/agent/poll?timeout=${POLL_TIMEOUT}`;
  
  try {
    if (DEBUG) console.log(`🔄 Polling ${url}...`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${AGENT_TOKEN}`
      }
    });

    if (!response.ok) {
      throw new Error(`Poll failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.messages && data.messages.length > 0) {
      console.log(`📬 Received ${data.messages.length} message(s)`);
      
      for (const msg of data.messages) {
        await handleMessage(msg);
      }
    } else {
      if (DEBUG) console.log('⏳ No messages (timeout)');
    }
    
  } catch (error) {
    console.error('❌ Poll error:', error.message);
    throw error;
  }
}

/**
 * Handle a single message
 */
async function handleMessage(msg) {
  try {
    console.log(`📨 Message from ${msg.deviceName} (${msg.deviceId}): ${msg.content.substring(0, 50)}...`);
    
    // Forward to OpenClaw
    const response = await forwardToOpenClaw(msg.content);
    
    if (!response || response.trim().length === 0) {
      console.warn('⚠️  Empty response from OpenClaw, skipping...');
      return;
    }
    
    console.log(`💬 Response: ${response.substring(0, 50)}...`);
    
    // Send response back
    await sendResponse(msg.id, response);
    
    console.log(`✅ Message ${msg.id} handled successfully`);
    
  } catch (error) {
    console.error(`❌ Failed to handle message ${msg.id}:`, error.message);
  }
}

/**
 * Main poll loop
 */
async function pollLoop() {
  console.log('🔁 Starting poll loop...');
  
  while (true) {
    try {
      await pollMessages();
    } catch (error) {
      console.error('❌ Poll loop error:', error.message);
      console.log('⏳ Waiting 5s before retry...');
      await sleep(5000);
    }
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received, shutting down...');
  process.exit(0);
});

// Start
pollLoop().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
