const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const path = require('path');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

// Simple in-memory SSE clients
const sseClients = new Set();
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
    // send initial status
    res.write(`event: status\ndata: ${JSON.stringify({ agentConnected: !!agentWs })}\n\n`);
    req.on('close', () => sseClients.delete(res));
});

let agentWs = null;

app.post('/command', (req, res) => {
    const cmd = req.body;
    if (!agentWs || agentWs.readyState !== WebSocket.OPEN) {
        return res.status(503).json({ error: 'agent offline' });
    }
    agentWs.send(JSON.stringify({ type: 'command', command: cmd }));
    res.json({ status: 'sent' });
});

app.post('/agent/result', (req, res) => {
    const payload = req.body;
    console.log('Result (POST /agent/result):', JSON.stringify(payload, null, 2));
    sendSSE('result', payload);
    res.json({ status: 'ok' });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    const { url } = request;
    if (url === '/agent') {
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
    sendSSE('status', { agentConnected: true });

    ws.on('message', (msg) => {
        try {
            const parsed = JSON.parse(msg.toString());
            console.log('Message from agent:', parsed);
            // if agent sends results, broadcast to SSE clients
            sendSSE('result', parsed);
        } catch (e) {
            console.log('Non-JSON message from agent:', msg.toString());
            sendSSE('result', { raw: msg.toString() });
        }
    });

    ws.on('close', () => {
        console.log('Agent websocket disconnected');
        agentWs = null;
        sendSSE('status', { agentConnected: false });
    });
});

server.listen(PORT, () => {
    console.log(`Middleware server listening on http://localhost:${PORT}`);
});
