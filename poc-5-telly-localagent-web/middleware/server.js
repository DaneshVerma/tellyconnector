import express from 'express';
import http from 'http';
import fs from 'fs';
import WebSocket, { WebSocketServer } from 'ws';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

const defaultGroups = [
    'Sundry Debtors',
    'Sundry Creditors',
    'Cash-in-hand',
    'Bank Accounts',
    'Sales Accounts',
    'Purchase Accounts',
    'Capital Account'
];

const defaultLedgers = [
    { name: 'Cash', group: 'Cash-in-hand', openingBalance: 0 },
    { name: 'Bank', group: 'Bank Accounts', openingBalance: 0 },
    { name: 'Acme Traders', group: 'Sundry Debtors', openingBalance: 0 },
    { name: 'Office Supplies', group: 'Purchase Accounts', openingBalance: 0 },
    { name: 'Sales Revenue', group: 'Sales Accounts', openingBalance: 0 }
];

const app = express();
app.use(bodyParser.json());

const sseClients = new Set();
const state = {
    agentConnected: false,
    tallyReachable: false,
    cloudConnected: false,
    lastActivity: new Date().toISOString(),
    ledgers: [...defaultLedgers],
    groups: [...defaultGroups],
    vouchers: [],
    logs: [
        { time: new Date().toISOString(), text: 'Demo defaults loaded for a fresh Tally company' }
    ]
};

let agentWs = null;

function sanitizeData() {
    if (!state.groups || state.groups.length === 0) state.groups = [...defaultGroups];
    if (!state.ledgers || state.ledgers.length === 0) state.ledgers = [...defaultLedgers];
}

function setLastActivity() {
    state.lastActivity = new Date().toISOString();
}

function pushLog(text) {
    state.logs.unshift({ time: new Date().toISOString(), text });
    state.logs = state.logs.slice(0, 80);
    console.log(text);
    for (const res of sseClients) {
        try {
            res.write(`event: log\ndata: ${JSON.stringify({ text })}\n\n`);
        } catch (e) { /* ignore */ }
    }
}

function sendSSE(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
        try { res.write(payload); } catch (e) { /* ignore */ }
    }
}

app.get('/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('\n');
    sseClients.add(res);
    res.write(`event: status\ndata: ${JSON.stringify({
        agentConnected: state.agentConnected,
        tallyReachable: state.tallyReachable,
        cloudConnected: state.cloudConnected,
        lastActivity: state.lastActivity
    })}\n\n`);
    req.on('close', () => sseClients.delete(res));
});

app.get('/api/status', (req, res) => {
    sanitizeData();
    res.json({
        agentRunning: state.agentConnected,
        tallyReachable: state.tallyReachable,
        cloudConnected: state.cloudConnected,
        lastActivity: state.lastActivity
    });
});

app.get('/api/data', (req, res) => {
    sanitizeData();
    res.json({
        ledgers: state.ledgers,
        groups: state.groups,
        vouchers: state.vouchers,
        logs: state.logs
    });
});

app.post('/command', (req, res) => {
    const cmd = req.body || {};
    if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
        return res.status(503).json({ error: 'agent offline' });
    }

    setLastActivity();
    pushLog(`Sent ${cmd.action || 'command'} to agent`);
    agentWs.send(JSON.stringify({ type: 'command', command: cmd }));
    res.json({ ok: true, status: 'sent' });
});

app.post('/agent/result', (req, res) => {
    const payload = req.body || {};
    setLastActivity();
    console.log('Result from agent:', JSON.stringify(payload, null, 2));

    if (payload.type === 'status') {
        state.tallyReachable = !!payload.tallyReachable;
        state.cloudConnected = !!payload.cloudConnected;
        state.agentConnected = !!payload.cloudConnected;
        sendSSE('status', {
            agentConnected: state.agentConnected,
            tallyReachable: state.tallyReachable,
            cloudConnected: state.cloudConnected,
            lastActivity: state.lastActivity
        });
    }

    if (payload.kind === 'ledgers' && Array.isArray(payload.data)) {
        state.ledgers = payload.data.length ? payload.data : [...defaultLedgers];
        pushLog(`Synced ${state.ledgers.length} ledgers from Tally`);
    }

    if (payload.kind === 'groups' && Array.isArray(payload.data)) {
        state.groups = payload.data.length
            ? payload.data.map((group) => typeof group === 'string' ? group : (group && group.name) || 'Unknown').filter(Boolean)
            : [...defaultGroups];
    }

    if (payload.kind === 'vouchers' && Array.isArray(payload.data)) {
        state.vouchers = payload.data;
        pushLog(`Synced ${payload.data.length} vouchers from Tally`);
    }

    if (payload.action) {
        pushLog(`${payload.action} result received from agent`);
    }

    if (payload.message) {
        pushLog(payload.message);
    }

    sendSSE('result', payload);
    res.json({ ok: true });
});

const distPath = path.join(__dirname, 'dist');

if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get(/^\/(?!api|command|agent|events).*/, (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
} else {
    app.get('/', (req, res) => {
        res.status(503).send('Frontend build not found. Run "npm run build" or "npm run dev" on port 5173.');
    });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    if (request.url === '/agent') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

wss.on('connection', (ws) => {
    console.log('Agent websocket connected');
    agentWs = ws;
    state.agentConnected = true;
    state.cloudConnected = true;
    sendSSE('status', {
        agentConnected: true,
        tallyReachable: state.tallyReachable,
        cloudConnected: true,
        lastActivity: state.lastActivity
    });
    pushLog('Agent connected via WebSocket');

    ws.on('message', (msg) => {
        try {
            const parsed = JSON.parse(msg.toString());
            if (parsed.type === 'status') {
                state.tallyReachable = !!parsed.tallyReachable;
                state.cloudConnected = !!parsed.cloudConnected;
                state.agentConnected = !!parsed.cloudConnected;
                setLastActivity();
                sendSSE('status', {
                    agentConnected: state.agentConnected,
                    tallyReachable: state.tallyReachable,
                    cloudConnected: state.cloudConnected,
                    lastActivity: state.lastActivity
                });
            }

            if (parsed.type === 'data') {
                if (parsed.kind === 'ledgers') state.ledgers = parsed.data && parsed.data.length ? parsed.data : [...defaultLedgers];
                if (parsed.kind === 'groups') state.groups = parsed.data && parsed.data.length
                    ? parsed.data.map((group) => typeof group === 'string' ? group : (group && group.name) || 'Unknown').filter(Boolean)
                    : [...defaultGroups];
                if (parsed.kind === 'vouchers') state.vouchers = parsed.data || [];
                pushLog(`Live ${parsed.kind || 'data'} update received from agent`);
            }

            if (parsed.message) {
                pushLog(parsed.message);
            }

            sendSSE('result', parsed);
        } catch (e) {
            console.log('Non-JSON message from agent:', msg.toString());
            sendSSE('result', { raw: msg.toString() });
        }
    });

    ws.on('close', () => {
        console.log('Agent websocket disconnected');
        agentWs = null;
        state.agentConnected = false;
        state.cloudConnected = false;
        sendSSE('status', {
            agentConnected: false,
            tallyReachable: state.tallyReachable,
            cloudConnected: false,
            lastActivity: state.lastActivity
        });
        pushLog('Agent disconnected from WebSocket');
    });
});

setInterval(() => {
    if (agentWs && agentWs.readyState === WebSocket.OPEN) {
        agentWs.send(JSON.stringify({ type: 'command', command: { action: 'sync_tally_state' } }));
    }
}, 15000);

server.listen(PORT, () => {
    console.log(`Middleware server listening on http://localhost:${PORT}`);
    pushLog(`Middleware started on port ${PORT}`);
});
