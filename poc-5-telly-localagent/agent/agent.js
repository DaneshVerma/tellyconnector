const WebSocket = require('ws');
const fetch = require('node-fetch');
const xml2js = require('xml2js');

const SERVER_WS = process.env.SERVER_WS || 'ws://localhost:3000/agent';
const MIDDLEWARE_HTTP = process.env.MIDDLEWARE_HTTP || 'http://localhost:3000';
const TALLY_URL = process.env.TALLY_URL || 'http://localhost:9000';

let ws;
let reconnectTimer = null;
let lastCheckedTimestamp = new Date(0).toISOString();

function connect() {
    console.log('Connecting to middleware at', SERVER_WS);
    ws = new WebSocket(SERVER_WS);

    ws.on('open', () => {
        console.log('WebSocket connected to middleware');
        // send a hello
        ws.send(JSON.stringify({ type: 'hello', pid: process.pid, startedAt: new Date().toISOString() }));
    });

    ws.on('message', async (msg) => {
        console.log('Received message from middleware:', msg.toString());
        try {
            const data = JSON.parse(msg.toString());
            if (data.type === 'command' && data.command) {
                await handleCommand(data.command);
            }
        } catch (e) {
            console.error('Invalid message', e);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket closed, scheduling reconnect in 5s');
        scheduleReconnect();
    });

    ws.on('error', (err) => {
        console.error('WebSocket error', err.message);
        ws.close();
    });
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, 5000);
}

async function handleCommand(commandEnvelope) {
    console.log('Handling command:', JSON.stringify(commandEnvelope));
    const { action, payload } = commandEnvelope;
    if (action === 'create_ledger') {
        const xml = buildCreateLedgerXML(payload.name, payload.parent || 'Sundry Debtors');
        console.log('Posting XML to Tally:\n', xml);
        try {
            const res = await fetch(TALLY_URL, { method: 'POST', body: xml, headers: { 'Content-Type': 'application/xml' } });
            const text = await res.text();
            console.log('Tally response:', text.slice(0, 500));
            const result = { action, payload, tallyResponse: text };
            // send result back to middleware via HTTP POST
            await fetch(`${MIDDLEWARE_HTTP}/agent/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
        } catch (e) {
            console.error('Error posting to Tally:', e.message);
            await fetch(`${MIDDLEWARE_HTTP}/agent/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, error: e.message }) });
        }
    } else {
        console.log('Unknown action:', action);
    }
}

function buildCreateLedgerXML(name, parent) {
    return `<!DOCTYPE REQUEST PUBLIC "-//TallySolutions//DTD Tally//EN" "">
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES></STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="${escapeXml(name)}">
            <PARENT>${escapeXml(parent)}</PARENT>
            <CURRENCYNAME>Indian Rupee</CURRENCYNAME>
          </LEDGER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function pollTallyLoop() {
    while (true) {
        try {
            await pollForVouchers();
        } catch (e) {
            console.error('Poll error', e.message);
        }
        await new Promise(r => setTimeout(r, 10000));
    }
}

async function pollForVouchers() {
    // Simple DayBook request with FromDate/ToDate as lastCheckedTimestamp -> now
    const from = lastCheckedTimestamp.split('T')[0];
    const to = new Date().toISOString().split('T')[0];
    const xml = `<!DOCTYPE REQUEST>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Day Book</REPORTNAME>
        <STATICVARIABLES>
          <SVFROMDATE>${from}</SVFROMDATE>
          <SVTODATE>${to}</SVTODATE>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

    console.log('Polling Tally for vouchers from', from, 'to', to);
    const res = await fetch(TALLY_URL, { method: 'POST', body: xml, headers: { 'Content-Type': 'application/xml' } });
    const text = await res.text();
    // naive parse: look for <VOUCHER...> blocks
    if (text && text.indexOf('<VOUCHER') !== -1) {
        // parse XML
        const parser = new xml2js.Parser({ explicitArray: false });
        const parsed = await parser.parseStringPromise(text).catch(err => { console.error('XML parse err', err); return null; });
        if (parsed) {
            // drill to ENVELOPE > BODY > DATA > TALLYMESSAGE > VOUCHER (structure varies)
            let vouchers = [];
            try {
                const env = parsed.ENVELOPE || parsed;
                const body = env.BODY || env.Body || {};
                const data = body.DATA || body.Data || {};
                const tallyMessage = data.TALLYMESSAGE || data.TallyMessage || {};
                const v = tallyMessage.VOUCHER || tallyMessage.Voucher;
                if (Array.isArray(v)) vouchers = v; else if (v) vouchers = [v];
            } catch (e) { console.error('drill error', e.message); }

            if (vouchers.length > 0) {
                for (const voucher of vouchers) {
                    // for demo, forward voucher as-is
                    const payload = { type: 'voucher', voucher };
                    console.log('Detected voucher, forwarding to middleware');
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(payload));
                    } else {
                        // fallback: POST to /agent/result
                        await fetch(`${MIDDLEWARE_HTTP}/agent/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    }
                }
            }
        }
    }

    lastCheckedTimestamp = new Date().toISOString();
}

// start
connect();
pollTallyLoop();
