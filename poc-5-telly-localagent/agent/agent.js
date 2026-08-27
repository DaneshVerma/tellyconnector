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

function asArray(value) {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function isAllowedXmlCodePoint(codePoint) {
    return (
        codePoint === 0x9 ||
        codePoint === 0xA ||
        codePoint === 0xD ||
        (codePoint >= 0x20 && codePoint <= 0xD7FF) ||
        (codePoint >= 0xE000 && codePoint <= 0xFFFD) ||
        (codePoint >= 0x10000 && codePoint <= 0x10FFFF)
    );
}

function sanitizeTallyXML(rawXmlString) {
    if (rawXmlString === undefined || rawXmlString === null) return '';

    let xml = String(rawXmlString);

    xml = xml.replace(/&#x([0-9A-Fa-f]+);|&#([0-9]+);/g, (match, hex, dec) => {
        const rawValue = hex !== undefined ? hex : dec;
        const base = hex !== undefined ? 16 : 10;
        const codePoint = Number.parseInt(rawValue, base);
        if (!Number.isFinite(codePoint)) return match;
        return isAllowedXmlCodePoint(codePoint) ? match : '';
    });

    xml = xml.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
    return xml;
}

const sanitizeTallyXml = sanitizeTallyXML;

function extractTagText(xml, tagName) {
    if (!xml || !tagName) return '';
    const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = String(xml).match(pattern);
    if (!match) return '';
    return String(match[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function extractTagValue(xml, tagName) {
    if (!xml || !tagName) return '';
    const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = String(xml).match(pattern);
    return match ? String(match[1]).trim() : '';
}

async function parseXmlSafely(xml) {
    const cleaned = sanitizeTallyXML(xml);
    try {
        return await xml2js.parseStringPromise(cleaned, {
            explicitArray: true,
            trim: true,
            explicitRoot: false,
            charkey: '_',
            attrkey: '$',
        });
    } catch (error) {
        log(`Tally XML parse failed, using fallback parsing: ${error.message}`);
        return {};
    }
}

function firstText(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) {
        for (const item of value) {
            const text = firstText(item);
            if (text) return text;
        }
        return '';
    }
    if (typeof value === 'object') {
        if (typeof value._ === 'string') return value._.trim();
        if (value.$ && typeof value.$.NAME === 'string') return value.$.NAME.trim();
        for (const child of Object.values(value)) {
            const text = firstText(child);
            if (text) return text;
        }
        return '';
    }
    return String(value).trim();
}

function buildFetchCollectionXML(collectionId) {
    const collection = String(collectionId || 'Ledger');
    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>EXPORT</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>${escapeXml(collection)}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function buildFetchReportXML(reportName) {
    const report = String(reportName || 'Day Book');
    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>EXPORT</TALLYREQUEST>
    <TYPE>DATA</TYPE>
    <ID>${escapeXml(report)}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function buildCreateLedgerXML(name, parent, openingBalance, companyName) {
    const ledgerName = escapeXml(String(name || ''));
    const parentName = escapeXml(String(parent || 'Sundry Debtors'));
    const company = escapeXml(String(companyName || process.env.COMPANY_NAME || 'Testlmited'));
    const opening = Number(openingBalance || 0);

    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="${ledgerName}" ACTION="Create">
            <NAME>${ledgerName}</NAME>
            <PARENT>${parentName}</PARENT>
            <OPENINGBALANCE>${opening}</OPENINGBALANCE>
          </LEDGER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function buildAlterLedgerXML(oldName, newName, parent, openingBalance, companyName) {
    const currentName = escapeXml(String(oldName || ''));
    const updatedName = escapeXml(String(newName || oldName || ''));
    const parentName = escapeXml(String(parent || 'Sundry Debtors'));
    const company = escapeXml(String(companyName || process.env.COMPANY_NAME || 'Testlmited'));
    const opening = Number(openingBalance || 0);

    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="${currentName}" ACTION="Alter">
            <NAME>${updatedName}</NAME>
            <PARENT>${parentName}</PARENT>
            <OPENINGBALANCE>${opening}</OPENINGBALANCE>
          </LEDGER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function buildDeleteLedgerXML(name, companyName) {
    const ledgerName = escapeXml(String(name || ''));
    const company = escapeXml(String(companyName || process.env.COMPANY_NAME || 'Testlmited'));

    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="${ledgerName}" ACTION="Delete" />
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function buildCreateSalesVoucherXML(partyLedger, amount, date, narration, salesLedger, companyName) {
    const party = escapeXml(String(partyLedger || 'Cash'));
    const sales = escapeXml(String(salesLedger || 'Sales Accounts'));
    const company = escapeXml(String(companyName || process.env.COMPANY_NAME || 'Testlmited'));
    const narrationText = escapeXml(String(narration || 'Sale'));
    const billDate = String(date || new Date().toISOString().split('T')[0]).replace(/-/g, '');
    const amountNumber = Number(amount || 0);
    const debitAmount = -Math.abs(amountNumber);
    const creditAmount = Math.abs(amountNumber);

    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Sales" ACTION="Create">
            <DATE>${billDate}</DATE>
            <NARRATION>${narrationText}</NARRATION>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${party}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>${debitAmount}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${sales}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${creditAmount}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

async function parseCollectionResponse(xml) {
    if (!xml || !String(xml).includes('<COLLECTION')) return [];

    const result = await parseXmlSafely(xml);
    const collectionNode = result && result.COLLECTION ? result.COLLECTION[0] : (result || {});
    const ledgerNodes = asArray(collectionNode && collectionNode.LEDGER);
    const groupNodes = asArray(collectionNode && collectionNode.GROUP);

    if (ledgerNodes.length) {
        return ledgerNodes.map((ledger) => {
            const name = firstText(ledger && ledger.$ && ledger.$.NAME) || firstText(ledger && ledger.NAME);
            const parent = firstText(ledger && ledger.PARENT);
            const closingBalance = firstText(ledger && ledger.CLOSINGBALANCE) || firstText(ledger && ledger.TBALOPENING) || '0';
            return { name, parent, closingBalance };
        });
    }

    if (groupNodes.length) {
        return groupNodes.map((group) => {
            const name = firstText(group && group.$ && group.$.NAME) || firstText(group && group.NAME);
            const aliasList = asArray(group && group['NAME.LIST']);
            const aliases = aliasList.flatMap((item) => asArray(item && item.NAME).map((alias) => firstText(alias))).filter(Boolean);
            return { name, aliases };
        });
    }

    const fallbackLedgerPattern = /<LEDGER\b[^>]*NAME=["']([^"']+)["'][^>]*>([\s\S]*?)<\/LEDGER>/gi;
    const fallbackGroupPattern = /<GROUP\b[^>]*NAME=["']([^"']+)["'][^>]*>([\s\S]*?)<\/GROUP>/gi;

    if (String(xml).match(fallbackLedgerPattern)) {
        return Array.from(String(xml).matchAll(fallbackLedgerPattern)).map((match) => ({
            name: match[1] || 'Unknown',
            parent: extractTagText(match[2] || '', 'PARENT'),
            closingBalance: extractTagText(match[2] || '', 'CLOSINGBALANCE') || extractTagText(match[2] || '', 'TBALOPENING') || '0'
        }));
    }

    if (String(xml).match(fallbackGroupPattern)) {
        return Array.from(String(xml).matchAll(fallbackGroupPattern)).map((match) => ({
            name: match[1] || 'Unknown',
            aliases: []
        }));
    }

    return [];
}

async function parseWriteResponse(xml) {
    if (!xml) {
        return { created: 0, altered: 0, deleted: 0, errors: 1, lineError: 'Empty response from Tally' };
    }

    const result = await parseXmlSafely(xml);
    const responseNode = result && result.RESPONSE ? result.RESPONSE[0] : (result || {});
    const created = Number(firstText(responseNode && responseNode.CREATED) || 0);
    const altered = Number(firstText(responseNode && responseNode.ALTERED) || 0);
    const deleted = Number(firstText(responseNode && responseNode.DELETED) || 0);
    const errors = Number(firstText(responseNode && responseNode.ERRORS) || 0);
    const lineError = firstText(responseNode && responseNode.LINEERROR) || firstText(responseNode && responseNode.ERROR);

    if (lineError || errors || created || altered || deleted) {
        return { created, altered, deleted, errors, lineError };
    }

    const normalized = sanitizeTallyXml(xml);
    const fallbackCreated = Number(extractTagText(normalized, 'CREATED') || 0);
    const fallbackAltered = Number(extractTagText(normalized, 'ALTERED') || 0);
    const fallbackDeleted = Number(extractTagText(normalized, 'DELETED') || 0);
    const fallbackErrors = Number(extractTagText(normalized, 'ERRORS') || 0);
    const fallbackLineError = extractTagText(normalized, 'LINEERROR') || extractTagText(normalized, 'ERROR') ||
        (/(Unknown Request|cannot be processed|Could not find Report|Invalid character entity)/i.test(normalized) ? 'Tally rejected the request or returned malformed XML' : '');

    return {
        created: fallbackCreated || created,
        altered: fallbackAltered || altered,
        deleted: fallbackDeleted || deleted,
        errors: fallbackErrors || errors || (fallbackLineError ? 1 : 0),
        lineError: fallbackLineError || lineError
    };
}

async function postXmlToTally(xml, label) {
    console.log(`[TALLY ${label}] REQUEST XML:\n${xml}`);
    const res = await fetch(TALLY_URL, {
        method: 'POST',
        body: xml,
        headers: { 'Content-Type': 'application/xml', Accept: 'application/xml' }
    });
    const text = await res.text();
    const normalized = sanitizeTallyXML(String(text || '')).trim();
    console.log(`[TALLY ${label}] RESPONSE XML:\n${normalized}`);
    const rejected = /(Unknown Request|cannot be processed|Could not find Report|TallyPrime Server is Running)/i.test(normalized);
    return { ok: !rejected, responseText: normalized, rejected };
}

async function getCurrentCompanyName() {
    // Future enhancement: query a CompanyInfo collection once Tally exposes it reliably via the XML interface.
    // For this demo, we only need a single known company and keep it fixed in the local environment.
    return process.env.COMPANY_NAME || 'Testlmited';
}

async function getTallyCollection(collectionId) {
    const xml = buildFetchCollectionXML(collectionId);
    return postXmlToTally(xml, `Collection:${collectionId}`);
}

async function getTallyReport(reportName) {
    const xml = buildFetchReportXML(reportName);
    return postXmlToTally(xml, `Report:${reportName}`);
}

async function parseLedgerList(xml) {
    const rows = await parseCollectionResponse(xml);
    return rows.map((row) => ({ name: row.name || 'Unknown' }));
}

async function parseVoucherList(xml) {
    if (!xml || !String(xml).includes('<VOUCHER')) return [];

    const result = await parseXmlSafely(xml);
    const messageNodes = asArray(result && result.TALLYMESSAGE);
    const voucherRows = [];

    for (const messageNode of messageNodes) {
        const vouchers = asArray(messageNode && messageNode.VOUCHER);
        for (const voucher of vouchers) {
            voucherRows.push({
                id: `${Date.now()}-${voucherRows.length}`,
                date: firstText(voucher && voucher.DATE),
                narration: firstText(voucher && voucher.NARRATION),
                partyLedger: firstText(voucher && voucher.PARTYLEDGERNAME),
                amount: firstText(voucher && voucher.ALLLEDGERENTRIES && voucher.ALLLEDGERENTRIES[0] && voucher.ALLLEDGERENTRIES[0].AMOUNT),
            });
        }
    }

    if (voucherRows.length) return voucherRows.slice(0, 30);

    const fallbackPattern = /<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/gi;
    const fallbackMatches = Array.from(String(xml).matchAll(fallbackPattern));
    for (const match of fallbackMatches) {
        const block = match[1] || '';
        voucherRows.push({
            id: `${Date.now()}-${voucherRows.length}`,
            date: extractTagText(block, 'DATE'),
            narration: extractTagText(block, 'NARRATION'),
            partyLedger: extractTagText(block, 'PARTYLEDGERNAME'),
            amount: extractTagText(block, 'AMOUNT') || extractTagText(block, 'ALLLEDGERENTRIES')
        });
    }

    return voucherRows.slice(0, 30);
}

async function parseGroupList(xml) {
    const rows = await parseCollectionResponse(xml);
    return rows.map((row) => ({ name: row.name || 'Unknown' }));
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
        const companyName = await getCurrentCompanyName();

        if (action === 'sync_tally_state') {
            const [groupsResult, ledgersResult, vouchersResult] = await Promise.all([
                getTallyCollection('Group'),
                getTallyCollection('Ledger'),
                getTallyReport('Day Book')
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

            const groups = await parseGroupList(groupsResult.responseText);
            const ledgers = await parseLedgerList(ledgersResult.responseText);
            const vouchers = await parseVoucherList(vouchersResult.responseText);

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
            const xml = buildCreateLedgerXML(payload.name, payload.parent || 'Sundry Debtors', payload.openingBalance || 0, companyName);
            const result = await postXmlToTally(xml, 'Create ledger');
            const parsed = await parseWriteResponse(result.responseText);
            if (!result.ok || parsed.errors > 0) {
                await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, payload, tallyResponse: result.responseText, error: parsed.lineError || result.responseText, message: parsed.lineError ? `Cannot create ledger: ${parsed.lineError}` : 'Tally rejected the ledger create request.' })
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
            const xml = buildAlterLedgerXML(payload.name, payload.newName || payload.name, payload.parent || 'Sundry Debtors', payload.openingBalance || 0, companyName);
            const result = await postXmlToTally(xml, 'Update ledger');
            const parsed = await parseWriteResponse(result.responseText);
            if (!result.ok || parsed.errors > 0) {
                await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, payload, tallyResponse: result.responseText, error: parsed.lineError || result.responseText, message: parsed.lineError ? `Cannot update ledger: ${parsed.lineError}` : 'Tally rejected the ledger update request.' })
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
            const xml = buildDeleteLedgerXML(payload.name, companyName);
            const result = await postXmlToTally(xml, 'Delete ledger');
            const parsed = await parseWriteResponse(result.responseText);
            if (!result.ok || parsed.errors > 0) {
                await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, payload, tallyResponse: result.responseText, error: parsed.lineError || result.responseText, message: parsed.lineError ? `Cannot delete: ${parsed.lineError}` : 'Tally rejected the ledger delete request.' })
                });
                return;
            }
            await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, payload, tallyResponse: result.responseText, message: `Ledger ${payload.name} delete request accepted by Tally` })
            });
            return;
        }

        if (action === 'create_voucher') {
            const xml = buildCreateSalesVoucherXML(payload.partyLedger, payload.amount, payload.date, payload.narration, 'Sales Accounts', companyName);
            const result = await postXmlToTally(xml, 'Create voucher');
            const parsed = await parseWriteResponse(result.responseText);
            if (!result.ok || parsed.errors > 0) {
                await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, payload, tallyResponse: result.responseText, error: parsed.lineError || result.responseText, message: parsed.lineError ? `Cannot create voucher: ${parsed.lineError}` : 'Tally rejected the voucher create request.' })
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
            if (action === 'list_ledgers') response = await getTallyCollection('Ledger');
            if (action === 'list_groups') response = await getTallyCollection('Group');
            if (action === 'list_vouchers') response = await getTallyReport('Day Book');
            if (!response || !response.ok) {
                await fetch(`${MIDDLEWARE_HTTP}/agent/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, error: (response && response.responseText) || 'Tally rejected the list request', message: `Tally rejected the ${kind} list request.` })
                });
                return;
            }
            if (action === 'list_ledgers') data = await parseLedgerList(response.responseText);
            if (action === 'list_groups') data = await parseGroupList(response.responseText);
            if (action === 'list_vouchers') data = await parseVoucherList(response.responseText);
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
                const voucherResult = await getTallyReport('Day Book');
                const vouchers = await parseVoucherList(voucherResult && voucherResult.responseText ? voucherResult.responseText : '');
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
