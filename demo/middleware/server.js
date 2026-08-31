const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const PORT = 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/agent' });

// ─── State ───────────────────────────────────────────────────────────────────
let agentSocket = null;
const pendingRequests = new Map(); // commandId → { resolve, reject, timer }
const COMMAND_TIMEOUT_MS = 30000;

function ts() {
  return new Date().toISOString();
}

// ─── WebSocket handling ──────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  console.log(`[${ts()}] ✅ Agent connected`);
  agentSocket = ws;

  ws.on('message', (data) => {
    const raw = data.toString();
    console.log(`[${ts()}] ⬅️  Received from agent: ${raw.substring(0, 300)}${raw.length > 300 ? '...' : ''}`);

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      console.error(`[${ts()}] ❌ Failed to parse agent message as JSON:`, e.message);
      return;
    }

    const { commandId } = msg;
    if (commandId && pendingRequests.has(commandId)) {
      const pending = pendingRequests.get(commandId);
      clearTimeout(pending.timer);
      pendingRequests.delete(commandId);
      pending.resolve(msg);
    } else {
      console.log(`[${ts()}] ⚠️  No pending request for commandId=${commandId}`);
    }
  });

  ws.on('close', () => {
    console.log(`[${ts()}] ❌ Agent disconnected`);
    if (agentSocket === ws) agentSocket = null;
    // Reject all pending requests
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Agent disconnected'));
      pendingRequests.delete(id);
    }
  });

  ws.on('error', (err) => {
    console.error(`[${ts()}] ❌ Agent WS error:`, err.message);
  });
});

/**
 * Send a command to the agent and wait for the response.
 * Returns a Promise that resolves with the agent's response message.
 */
function sendCommandToAgent(command) {
  return new Promise((resolve, reject) => {
    if (!agentSocket || agentSocket.readyState !== 1) {
      return reject(new Error('Agent is not connected'));
    }

    const commandId = uuidv4();
    const payload = JSON.stringify({ commandId, ...command });

    const timer = setTimeout(() => {
      pendingRequests.delete(commandId);
      reject(new Error(`Command timed out after ${COMMAND_TIMEOUT_MS}ms`));
    }, COMMAND_TIMEOUT_MS);

    pendingRequests.set(commandId, { resolve, reject, timer });

    console.log(`[${ts()}] ➡️  Sending to agent: ${payload.substring(0, 300)}${payload.length > 300 ? '...' : ''}`);
    agentSocket.send(payload);
  });
}

// ─── REST Endpoints ──────────────────────────────────────────────────────────

// Status check — is the agent connected?
app.get('/api/status', (req, res) => {
  res.json({
    agentConnected: !!(agentSocket && agentSocket.readyState === 1),
  });
});

// List ledgers
app.get('/api/ledgers', async (req, res) => {
  try {
    const result = await sendCommandToAgent({ type: 'list_ledgers' });
    if (result.error) {
      return res.status(500).json({ error: result.error, raw: result.raw || null });
    }
    res.json({ ledgers: result.data || [] });
  } catch (e) {
    console.error(`[${ts()}] ❌ /api/ledgers error:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// Create ledger
app.post('/api/ledger', async (req, res) => {
  const { name, parent, openingBalance } = req.body;
  if (!name || !parent) {
    return res.status(400).json({ error: 'name and parent are required' });
  }
  try {
    const result = await sendCommandToAgent({
      type: 'create_ledger',
      name,
      parent,
      openingBalance: openingBalance || '0',
    });
    if (result.error) {
      return res.status(500).json({ error: result.error, raw: result.raw || null });
    }
    res.json({ success: true, data: result.data || null });
  } catch (e) {
    console.error(`[${ts()}] ❌ /api/ledger error:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// List vouchers
app.get('/api/vouchers', async (req, res) => {
  try {
    const result = await sendCommandToAgent({ type: 'list_vouchers' });
    if (result.error) {
      return res.status(500).json({ error: result.error, raw: result.raw || null });
    }
    res.json({ vouchers: result.data || [] });
  } catch (e) {
    console.error(`[${ts()}] ❌ /api/vouchers error:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[${ts()}] 🚀 Middleware server running on http://localhost:${PORT}`);
  console.log(`[${ts()}] 📡 WebSocket endpoint at ws://localhost:${PORT}/agent`);
});
