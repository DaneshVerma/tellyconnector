const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// In-memory stores for this POC
const receivedVouchers = []; // stored vouchers pushed FROM Tally
const commandQueue = []; // queued commands for Tally to poll
const completedCommands = [];

// Serve the frontend single-file page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// POST /tally/push - Tally pushes a voucher here
app.post('/tally/push', (req, res) => {
    const payload = req.body || {};
    const record = {
        id: uuidv4(),
        receivedAt: new Date().toISOString(),
        payload,
    };
    receivedVouchers.push(record);
    console.log('Received voucher from Tally:', record);
    res.json({ status: 'ok', id: record.id });
});

// GET /tally/received - return all received vouchers (for frontend polling)
app.get('/tally/received', (req, res) => {
    res.json(receivedVouchers);
});

// POST /tally/queue-command - add a command into the queue (simulates cloud enqueue)
app.post('/tally/queue-command', (req, res) => {
    const { action, payload } = req.body || {};
    if (!action) return res.status(400).json({ error: 'action required' });
    const command = {
        commandId: uuidv4(),
        action,
        payload: payload || {},
        queuedAt: new Date().toISOString(),
        status: 'pending',
    };
    commandQueue.push(command);
    console.log('Queued command:', command);
    res.json({ status: 'queued', commandId: command.commandId });
});

// GET /tally/poll - Tally polls for next command. Return the first pending command or empty object
app.get('/tally/poll', (req, res) => {
    const next = commandQueue.find(c => c.status === 'pending');
    if (!next) return res.json({});
    // Return the command but do not mark completed until /tally/ack
    res.json(next);
});

// POST /tally/ack - Tally acknowledges a command
app.post('/tally/ack', (req, res) => {
    const { commandId, status, resultPayload } = req.body || {};
    if (!commandId) return res.status(400).json({ error: 'commandId required' });
    const cmd = commandQueue.find(c => c.commandId === commandId);
    if (!cmd) return res.status(404).json({ error: 'command not found' });
    cmd.status = status || 'completed';
    cmd.completedAt = new Date().toISOString();
    cmd.resultPayload = resultPayload;
    completedCommands.push(cmd);
    // Optionally remove from queue
    const idx = commandQueue.findIndex(c => c.commandId === commandId);
    if (idx !== -1) commandQueue.splice(idx, 1);
    console.log('Command acked:', cmd);
    res.json({ status: 'acknowledged', commandId });
});

// extra endpoints for debugging
app.get('/tally/queue', (req, res) => res.json(commandQueue));
app.get('/tally/completed', (req, res) => res.json(completedCommands));

app.listen(PORT, () => console.log(`Tally middleware POC running on http://localhost:${PORT}`));
