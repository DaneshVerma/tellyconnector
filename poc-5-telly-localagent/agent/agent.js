const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const xml2js = require('xml2js');

const SERVER_WS = process.env.SERVER_WS || 'ws://localhost:3000/agent';
const MIDDLEWARE_HTTP = process.env.MIDDLEWARE_HTTP || 'http://localhost:3000';
const TALLY_URL = process.env.TALLY_URL || 'http://localhost:9000';
const STATUS_PORT = Number(process.env.STATUS_PORT || 5001);

let ws;
let reconnectTimer = null;
let lastCheckedTimestamp = new Date(0).toISOString();

const agentState = {
    agentRunning: true,
    tallyReachable: false,
    cloudConnected: false,
    lastActivity: new Date().toISOString()
};

function updateStatus(partial) {
    Object.assign(agentState, partial, { lastActivity: new Date().toISOString() });
}

function sendMiddlewareStatus() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'status',
            agentRunning: true,
            tallyReachable: agentState.tallyReachable,
            cloudConnected: true,
            lastActivity: agentState.lastActivity
        }));
    }
}

function log(msg) {
    const stamp = new Date().toISOString();
    console.log(`[${stamp}] ${msg}`);
}

async function checkTallyReachable() {
    try {
        const res = await fetch(TALLY_URL, { method: 'GET', timeout: 2000 });
        const ok = res && res.status < 500;
        updateStatus({ tallyReachable: ok });
        log(ok ? 'Tally reachable on port 9000' : 'Tally not running or not reachable');
        return ok;
    } catch (e) {
        updateStatus({ tallyReachable: false });
        log('Tally not running or not reachable');
        return false;
    }
}

function connect() {
    log(`Connecting to middleware at ${SERVER_WS}`);
    ws = new WebSocket(SERVER_WS);

    ws.on('open', () => {
        log('WebSocket connected to middleware');
        updateStatus({ cloudConnected: true });
        sendMiddlewareStatus();
        ws.send(JSON.stringify({ type: 'hello', pid: process.pid, startedAt: new Date().toISOString() }));
    });

    ws.on('message', async (msg) => {
        log(`Received message from middleware: ${msg.toString()}`);
        try {
            const data = JSON.parse(msg.toString());
            if (data.type === 'command' && data.command) {
                await handleCommand(data.command);
            }
        } catch (e) {
            log(`Invalid message from middleware: ${e.message}`);
        }
    });

    ws.on('close', () => {
        log('WebSocket closed, retrying in 5s');
        updateStatus({ cloudConnected: false });
        sendMiddlewareStatus();
        scheduleReconnect();
    });

    ws.on('error', (err) => {
        log(`WebSocket error: ${err.message}`);
        updateStatus({ cloudConnected: false });
        if (ws) ws.close();
    });
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, 5000);
}

function escapeXml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
        <TALLYMESSAGE>
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

function buildCreateVoucherXML({ partyLedger, amount, date, narration }) {
    const billDate = date || new Date().toISOString().split('T')[0];
    const amountNumber = Number(amount || 0);
    return `<!DOCTYPE REQUEST>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <VOUCHER VCHTYPE="Sales" ACTION="Create">
            <DATE>${billDate}</DATE>
            <NARRATION>${escapeXml(narration || 'Demo sales voucher')}</NARRATION>
            <PARTYLEDGERNAME>${escapeXml(partyLedger || 'Cash')}</PARTYLEDGERNAME>
            <AMOUNT>${amountNumber}</AMOUNT>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function buildUpdateLedgerXML({ name, newName, openingBalance }) {
    const ledgerName = newName || name;
    return `<!DOCTYPE REQUEST PUBLIC "-//TallySolutions//DTD Tally//EN" "">
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <LEDGER NAME="${escapeXml(name)}" ACTION="Alter">
            <NAME>${escapeXml(ledgerName)}</NAME>
            <OPENINGBALANCE>${Number(openingBalance || 0)}</OPENINGBALANCE>
          </LEDGER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function buildDeleteLedgerXML(name) {
    return `<!DOCTYPE REQUEST PUBLIC "-//TallySolutions//DTD Tally//EN" "">
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <LEDGER NAME="${escapeXml(name)}" ACTION="Delete"/>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

async function postXmlToTally(xml, label) {
    log(`Sending ${label} XML to Tally`);
    const res = await fetch(TALLY_URL, {
        method: 'POST',
        body: xml,
        headers: { 'Content-Type': 'application/xml' }
    });
    const text = await res.text();
    const normalized = String(text || '').trim();
    const rejected = /(Unknown Request|cannot be processed|TallyPrime Server is Running)/i.test(normalized);
    log(`${label} response from Tally: ${normalized.slice(0, 400)}`);
    return { ok: !rejected, responseText: normalized, rejected };
}

async function getTallyData(reportName) {
    const xml = `<!DOCTYPE REQUEST>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>${reportName}</REPORTNAME>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

    return postXmlToTally(xml, `List ${reportName}`);
}

function parseLedgerList(xml) {
    const match = xml.match(/<LEDGER[^>]*NAME="([^"]+)"[^>]*>/g) || [];
    return match.map((item) => {
        const nameMatch = item.match(/NAME="([^"]+)"/);
        return { name: nameMatch ? nameMatch[1] : 'Unknown' };
    });
}

function parseVoucherList(xml) {
    const matches = [...xml.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/g)] || [];
    return matches.map((m, idx) => {
        const block = m[1];
        const voucher = {
            id: `${Date.now()}-${idx}`,
            date: (block.match(/<DATE>(.*?)<\/DATE>/) || [])[1] || '',
            narration: (block.match(/<NARRATION>(.*?)<\/NARRATION>/) || [])[1] || '',
            partyLedger: (block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/) || [])[1] || '',
            amount: (block.match(/<AMOUNT>(.*?)<\/AMOUNT>/) || [])[1] || ''
        };
        return voucher;
    }).slice(0, 30);
}

function parseGroupList(xml) {
    const matches = [...xml.matchAll(/<GROUP[^>]*NAME="([^"]+)"[^>]*>/g)] || [];
    return matches.map((m) => ({ name: m[1] }));
}

async function sendData(kind, data) {
    const payload = { type: 'data', kind, data, sentAt: new Date().toISOString() };
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    } else {
        try {
            await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            log(`Unable to send data to middleware: ${e.message}`);
        }
    }
}

async function handleCommand(commandEnvelope) {
    const { action, payload } = commandEnvelope || {};
    log(`Handling command: ${action}`);

    try {
        if (action === 'sync_tally_state') {
            const [groupsResult, ledgersResult, vouchersResult] = await Promise.all([
                getTallyData('List of Groups'),
                getTallyData('List of Accounts'),
                getTallyData('Day Book')
            ]);

            const rejected = [groupsResult, ledgersResult, vouchersResult].find((item) => !item.ok);
            if (rejected) {
                await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action,
                        kind: 'sync',
                        error: rejected.responseText || 'Tally rejected the sync request',
                        message: 'Tally rejected the sync request. Confirm TallyPrime is open and the XML interface is enabled.'
                    })
                });
                return;
            }

            const groups = parseGroupList(groupsResult.responseText);
            const ledgers = parseLedgerList(ledgersResult.responseText);
            const vouchers = parseVoucherList(vouchersResult.responseText);

            await sendData('groups', groups);
            await sendData('ledgers', ledgers);
            await sendData('vouchers', vouchers);

            await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    kind: 'sync',
                    message: 'Tally sync complete',
                    data: { groups, ledgers, vouchers }
                })
            });
            return;
        }

        if (action === 'create_ledger') {
            const xml = buildCreateLedgerXML(payload.name, payload.parent || 'Sundry Debtors');
            const result = await postXmlToTally(xml, 'Create ledger');
            if (!result.ok) {
                await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, payload, tallyResponse: result.responseText, error: result.responseText, message: `Tally rejected the ledger create request. Check that TallyPrime is open and XML import is enabled.` })
                });
                return;
            }
            await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, payload, tallyResponse: result.responseText, message: `Ledger ${payload.name} created in Tally` })
            });
            return;
        }

        if (action === 'update_ledger') {
            const xml = buildUpdateLedgerXML(payload);
            const result = await postXmlToTally(xml, 'Update ledger');
            if (!result.ok) {
                await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, payload, tallyResponse: result.responseText, error: result.responseText, message: `Tally rejected the ledger update request. Check that TallyPrime is open and XML import is enabled.` })
                });
                return;
            }
            await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, payload, tallyResponse: result.responseText, message: `Ledger ${payload.name} updated in Tally` })
            });
            return;
        }

        if (action === 'delete_ledger') {
            const xml = buildDeleteLedgerXML(payload.name);
            const result = await postXmlToTally(xml, 'Delete ledger');
            if (!result.ok) {
                await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, payload, tallyResponse: result.responseText, error: result.responseText, message: `Tally rejected the ledger delete request. Check that TallyPrime is open and XML import is enabled.` })
                });
                return;
            }
            await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, payload, tallyResponse: result.responseText, message: `Ledger ${payload.name} delete request sent to Tally` })
            });
            return;
        }

        if (action === 'create_voucher') {
            const xml = buildCreateVoucherXML(payload);
            const result = await postXmlToTally(xml, 'Create voucher');
            if (!result.ok) {
                await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, payload, tallyResponse: result.responseText, error: result.responseText, message: `Tally rejected the voucher create request. Check that TallyPrime is open and XML import is enabled.` })
                });
                return;
            }
            await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, payload, tallyResponse: result.responseText, message: `Voucher for ${payload.partyLedger} created in Tally` })
            });
            return;
        }

        if (action === 'list_ledgers' || action === 'list_groups' || action === 'list_vouchers') {
            const kind = action.replace('list_', '');
            let data = [];
            let response = null;
            if (action === 'list_ledgers') response = await getTallyData('List of Accounts');
            if (action === 'list_groups') response = await getTallyData('List of Groups');
            if (action === 'list_vouchers') response = await getTallyData('Day Book');
            if (!response || !response.ok) {
                await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, error: (response && response.responseText) || 'Tally rejected the list request', message: `Tally rejected the ${kind} list request.` })
                });
                return;
            }
            if (action === 'list_ledgers') data = parseLedgerList(response.responseText);
            if (action === 'list_groups') data = parseGroupList(response.responseText);
            if (action === 'list_vouchers') data = parseVoucherList(response.responseText);
            await sendData(kind + 's', data);
            await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, kind: kind + 's', data, message: `${kind} refreshed` })
            });
            return;
        }

        log(`Unknown action received: ${action}`);
        await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, error: `Unsupported action: ${action}` })
        });
    } catch (e) {
        log(`Error handling command ${action}: ${e.message}`);
        await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, error: e.message, message: `Failed while running ${action}` })
        });
    }
}

async function pollTallyLoop() {
    while (true) {
        try {
            const reachable = await checkTallyReachable();
            if (reachable) {
                const voucherText = await getTallyData('Day Book');
                const vouchers = parseVoucherList(voucherText);
                if (vouchers.length > 0) {
                    const newPayload = { type: 'voucher', kind: 'vouchers', data: vouchers, message: 'New vouchers detected in Tally' };
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(newPayload));
                    } else {
                        await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(newPayload)
                        });
                    }
                }
            }
        } catch (e) {
            log(`Poll error: ${e.message}`);
        }

        await new Promise((r) => setTimeout(r, 10000));
    }
}

function startStatusServer() {
    const statusServer = http.createServer((req, res) => {
        if (req.url === '/status') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
                agentRunning: true,
                tallyReachable: agentState.tallyReachable,
                cloudConnected: agentState.cloudConnected,
                lastActivity: agentState.lastActivity
            }));
            return;
        }
        res.statusCode = 404;
        res.end('Not found');
    });

    statusServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            log(`Status port ${STATUS_PORT} already in use; retrying in 5s`);
            setTimeout(startStatusServer, 5000);
            return;
        }
        log(`Status server error: ${err.message}`);
    });

    statusServer.listen(STATUS_PORT, '127.0.0.1', () => {
        log(`Status endpoint listening on http://localhost:${STATUS_PORT}/status`);
    });
}

startStatusServer();
connect();
checkTallyReachable();
pollTallyLoop();
