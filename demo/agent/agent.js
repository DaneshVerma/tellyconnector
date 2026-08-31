const WebSocket = require('ws');
const http = require('http');
const { parseStringPromise } = require('xml2js');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG — Edit these two values before running
// ═══════════════════════════════════════════════════════════════════════════════
const WS_URL = 'ws://localhost:3000/agent';   // ← Replace with your ngrok wss:// URL
const COMPANY_NAME = 'Testlmited';            // ← Replace with your TallyPrime company name
const TALLY_HOST = 'http://localhost:9000';
// ═══════════════════════════════════════════════════════════════════════════════

function ts() {
  return new Date().toISOString();
}

// ─── XML Sanitizer — strips invalid control-character entity references ──────
function sanitizeTallyXML(raw) {
  return raw.replace(/&#x?([0-9A-Fa-f]+);/g, (match, code) => {
    const isHex = match.includes('x') || match.includes('X');
    const cp = parseInt(code, isHex ? 16 : 10);
    const valid = cp === 0x9 || cp === 0xA || cp === 0xD ||
      (cp >= 0x20 && cp <= 0xD7FF) || (cp >= 0xE000 && cp <= 0xFFFD) ||
      (cp >= 0x10000 && cp <= 0x10FFFF);
    return valid ? match : '';
  });
}

// ─── XML Request Templates ──────────────────────────────────────────────────

function buildListLedgersXML() {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>EXPORT</TALLYREQUEST><TYPE>Collection</TYPE><ID>Ledger</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>`;
}

function buildListVouchersXML() {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>EXPORT</TALLYREQUEST><TYPE>DATA</TYPE><ID>Day Book</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>`;
}

function buildCreateLedgerXML(name, parent, openingBalance) {
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${COMPANY_NAME}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${name}" ACTION="Create"><NAME>${name}</NAME><PARENT>${parent}</PARENT><OPENINGBALANCE>${openingBalance}</OPENINGBALANCE></LEDGER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

// ─── HTTP POST to Tally ─────────────────────────────────────────────────────

function postToTally(xmlBody) {
  return new Promise((resolve, reject) => {
    const url = new URL(TALLY_HOST);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'Content-Length': Buffer.byteLength(xmlBody, 'utf-8'),
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });

    req.on('error', (err) => {
      const msg = `Tally HTTP request to ${TALLY_HOST} failed: ${err.message || err.code || String(err)}`;
      reject(new Error(msg));
    });
    req.write(xmlBody);
    req.end();
  });
}

// ─── Parse helpers ──────────────────────────────────────────────────────────

async function parseXML(raw) {
  const sanitized = sanitizeTallyXML(raw);
  console.log(`[${ts()}] 🧹 Sanitized XML (first 500 chars): ${sanitized.substring(0, 500)}`);
  const result = await parseStringPromise(sanitized, {
    explicitArray: true,
    ignoreAttrs: false,
    trim: true,
  });
  return result;
}

function extractLedgers(parsed) {
  try {
    // Navigate the parsed XML structure
    const envelope = parsed.ENVELOPE || parsed.Envelope;
    if (!envelope) {
      throw new Error('No ENVELOPE in response. Full parsed: ' + JSON.stringify(parsed).substring(0, 500));
    }

    const body = envelope.BODY || envelope.Body;
    if (!body || !body[0]) {
      throw new Error('No BODY in response. Full parsed: ' + JSON.stringify(parsed).substring(0, 500));
    }

    console.log(`[${ts()}] 🔍 BODY keys: ${JSON.stringify(Object.keys(body[0]))}`);

    const data = body[0].DATA || body[0].Data;
    if (!data || !data[0]) {
      console.log(`[${ts()}] ⚠️  No DATA in BODY. Returning empty ledger list.`);
      return [];
    }

    console.log(`[${ts()}] 🔍 DATA keys: ${JSON.stringify(Object.keys(data[0]))}`);

    // Tally Collection responses: DATA > COLLECTION > LEDGER
    let ledgers = [];
    const collection = data[0].COLLECTION || data[0].Collection;
    if (collection && collection[0]) {
      console.log(`[${ts()}] 🔍 COLLECTION keys: ${JSON.stringify(Object.keys(collection[0]))}`);
      ledgers = collection[0].LEDGER || collection[0].Ledger || [];
    }

    // Fallback: LEDGER directly under DATA (some response shapes)
    if (ledgers.length === 0) {
      ledgers = data[0].LEDGER || data[0].Ledger || [];
    }

    // Fallback: TALLYMESSAGE > LEDGER
    if (ledgers.length === 0) {
      const tallyMsg = data[0].TALLYMESSAGE || data[0].TallyMessage;
      if (tallyMsg && tallyMsg[0]) {
        ledgers = tallyMsg[0].LEDGER || tallyMsg[0].Ledger || [];
      }
    }

    console.log(`[${ts()}] 📊 Found ${ledgers.length} raw ledger entries`);

    return ledgers.map((l) => {
      const attrs = l.$ || {};
      // NAME can be a direct field, in NAME.LIST, or in attributes
      let name = '';
      if (l.NAME && l.NAME[0]) {
        name = typeof l.NAME[0] === 'string' ? l.NAME[0] : (l.NAME[0]._ || String(l.NAME[0]));
      } else if (l['NAME.LIST'] && l['NAME.LIST'][0] && l['NAME.LIST'][0].NAME && l['NAME.LIST'][0].NAME[0]) {
        name = typeof l['NAME.LIST'][0].NAME[0] === 'string' ? l['NAME.LIST'][0].NAME[0] : String(l['NAME.LIST'][0].NAME[0]);
      } else if (attrs.NAME) {
        name = attrs.NAME;
      }

      let parent = '';
      if (l.PARENT && l.PARENT[0]) {
        parent = typeof l.PARENT[0] === 'string' ? l.PARENT[0] : (l.PARENT[0]._ || String(l.PARENT[0]));
      }

      let openingBalance = '0';
      if (l.OPENINGBALANCE && l.OPENINGBALANCE[0]) {
        openingBalance = typeof l.OPENINGBALANCE[0] === 'string' ? l.OPENINGBALANCE[0] : (l.OPENINGBALANCE[0]._ || String(l.OPENINGBALANCE[0]));
      }

      return { name, parent, openingBalance };
    });
  } catch (e) {
    console.error(`[${ts()}] ❌ extractLedgers error:`, e.message);
    throw e;
  }
}

function extractVouchers(parsed) {
  try {
    const envelope = parsed.ENVELOPE || parsed.Envelope;
    if (!envelope) {
      throw new Error('No ENVELOPE in response. Full parsed: ' + JSON.stringify(parsed).substring(0, 500));
    }

    const body = envelope.BODY || envelope.Body;
    if (!body || !body[0]) {
      throw new Error('No BODY in response. Full parsed: ' + JSON.stringify(parsed).substring(0, 500));
    }

    // Day Book returns TALLYMESSAGE containing VOUCHER elements
    let tallymessage = null;

    // Try DATA path
    const data = body[0].DATA || body[0].Data;
    if (data && data[0]) {
      tallymessage = data[0].TALLYMESSAGE || data[0].TallyMessage;
    }

    // Try direct TALLYMESSAGE in body
    if (!tallymessage) {
      tallymessage = body[0].TALLYMESSAGE || body[0].TallyMessage;
    }

    if (!tallymessage || !tallymessage[0]) {
      console.log(`[${ts()}] ⚠️  No TALLYMESSAGE found. Body keys: ${JSON.stringify(Object.keys(body[0]))}`);
      return [];
    }

    const vouchers = tallymessage[0].VOUCHER || tallymessage[0].Voucher || [];
    return vouchers.map((v) => {
      const attrs = v.$ || {};

      let date = attrs.DATE || '';
      // Tally date format is YYYYMMDD, convert to readable
      if (date.length === 8) {
        date = `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
      }

      let voucherType = '';
      if (v.VOUCHERTYPENAME && v.VOUCHERTYPENAME[0]) {
        voucherType = typeof v.VOUCHERTYPENAME[0] === 'string' ? v.VOUCHERTYPENAME[0] : (v.VOUCHERTYPENAME[0]._ || '');
      }

      let voucherNumber = '';
      if (v.VOUCHERNUMBER && v.VOUCHERNUMBER[0]) {
        voucherNumber = typeof v.VOUCHERNUMBER[0] === 'string' ? v.VOUCHERNUMBER[0] : (v.VOUCHERNUMBER[0]._ || '');
      }

      let party = '';
      if (v.PARTYLEDGERNAME && v.PARTYLEDGERNAME[0]) {
        party = typeof v.PARTYLEDGERNAME[0] === 'string' ? v.PARTYLEDGERNAME[0] : (v.PARTYLEDGERNAME[0]._ || '');
      }

      return { date, voucherType, voucherNumber, party };
    });
  } catch (e) {
    console.error(`[${ts()}] ❌ extractVouchers error:`, e.message);
    throw e;
  }
}

function extractImportResult(parsed) {
  try {
    // Tally import responses come as <RESPONSE> (not <ENVELOPE>)
    const response = parsed.RESPONSE || parsed.Response;
    if (response) {
      // Check for LINEERROR first
      const lineError = response.LINEERROR || response.LineError;
      if (lineError && lineError[0]) {
        throw new Error('Tally import error: ' + (Array.isArray(lineError) ? lineError.join('; ') : String(lineError)));
      }

      const created = (response.CREATED && response.CREATED[0]) || '0';
      const altered = (response.ALTERED && response.ALTERED[0]) || '0';
      const deleted = (response.DELETED && response.DELETED[0]) || '0';
      const errors  = (response.ERRORS && response.ERRORS[0]) || '0';
      const lastvchid = (response.LASTVCHID && response.LASTVCHID[0]) || '';
      const lastmid = (response.LASTMID && response.LASTMID[0]) || (response.LASTMASTERID && response.LASTMASTERID[0]) || '';

      // If errors > 0 but no LINEERROR, flag it
      if (parseInt(errors) > 0) {
        throw new Error('Tally reported errors: ' + JSON.stringify(response).substring(0, 500));
      }

      console.log(`[${ts()}] ✅ Import result: created=${created}, altered=${altered}, deleted=${deleted}`);
      return { created, altered, deleted, lastvchid, lastmasterid: lastmid };
    }

    // Fallback: ENVELOPE shape (some Tally versions)
    const envelope = parsed.ENVELOPE || parsed.Envelope;
    if (envelope) {
      const body = envelope.BODY || envelope.Body;
      if (body && body[0]) {
        const importResult = body[0].IMPORTRESULT || body[0].ImportResult;
        if (importResult && importResult[0]) {
          const created = importResult[0].CREATED?.[0] || '0';
          const altered = importResult[0].ALTERED?.[0] || '0';
          const deleted = importResult[0].DELETED?.[0] || '0';
          const lastvchid = importResult[0].LASTVCHID?.[0] || '';
          const lastmasterid = importResult[0].LASTMASTERID?.[0] || '';
          return { created, altered, deleted, lastvchid, lastmasterid };
        }
      }
    }

    // Unknown shape — log and return what we have
    console.log(`[${ts()}] ⚠️  Unexpected import response shape: ${JSON.stringify(parsed).substring(0, 1000)}`);
    return { created: 'unknown', message: 'Unexpected response shape — check agent logs' };
  } catch (e) {
    console.error(`[${ts()}] ❌ extractImportResult error:`, e.message);
    throw e;
  }
}

// ─── Command Handler ────────────────────────────────────────────────────────

async function handleCommand(command) {
  const { type, commandId } = command;
  console.log(`[${ts()}] 📥 Command received: type=${type}, commandId=${commandId}`);

  try {
    switch (type) {
      case 'list_ledgers': {
        const xml = buildListLedgersXML();
        console.log(`[${ts()}] 📤 XML to Tally:\n${xml}`);

        const rawResponse = await postToTally(xml);
        console.log(`[${ts()}] 📥 Raw response from Tally (first 1000 chars):\n${rawResponse.substring(0, 1000)}`);

        const parsed = await parseXML(rawResponse);
        const ledgers = extractLedgers(parsed);
        console.log(`[${ts()}] ✅ Parsed ${ledgers.length} ledgers`);

        return { commandId, data: ledgers };
      }

      case 'list_vouchers': {
        const xml = buildListVouchersXML();
        console.log(`[${ts()}] 📤 XML to Tally:\n${xml}`);

        const rawResponse = await postToTally(xml);
        console.log(`[${ts()}] 📥 Raw response from Tally (first 1000 chars):\n${rawResponse.substring(0, 1000)}`);

        const parsed = await parseXML(rawResponse);
        const vouchers = extractVouchers(parsed);
        console.log(`[${ts()}] ✅ Parsed ${vouchers.length} vouchers`);

        return { commandId, data: vouchers };
      }

      case 'create_ledger': {
        const { name, parent, openingBalance } = command;
        const xml = buildCreateLedgerXML(name, parent, openingBalance || '0');
        console.log(`[${ts()}] 📤 XML to Tally:\n${xml}`);

        const rawResponse = await postToTally(xml);
        console.log(`[${ts()}] 📥 Raw response from Tally:\n${rawResponse}`);

        const parsed = await parseXML(rawResponse);
        const result = extractImportResult(parsed);
        console.log(`[${ts()}] ✅ Import result:`, JSON.stringify(result));

        return { commandId, data: result };
      }

      default:
        throw new Error(`Unknown command type: ${type}`);
    }
  } catch (e) {
    const errMsg = e.message || e.code || String(e) || 'Unknown error (no message)';
    console.error(`[${ts()}] ❌ Command failed: ${errMsg}`);
    console.error(`[${ts()}] ❌ Stack trace:`, e.stack || 'no stack');
    return { commandId, error: errMsg };
  }
}

// ─── WebSocket Connection ───────────────────────────────────────────────────

let ws = null;
let reconnectTimer = null;

function connect() {
  console.log(`[${ts()}] 🔌 Connecting to ${WS_URL}...`);

  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log(`[${ts()}] ✅ Connected to middleware`);
  });

  ws.on('message', async (data) => {
    const raw = data.toString();
    console.log(`[${ts()}] ⬅️  Received from middleware: ${raw}`);

    let command;
    try {
      command = JSON.parse(raw);
    } catch (e) {
      console.error(`[${ts()}] ❌ Failed to parse message as JSON:`, e.message);
      return;
    }

    const response = await handleCommand(command);
    const responseStr = JSON.stringify(response);
    console.log(`[${ts()}] ➡️  Sending to middleware: ${responseStr.substring(0, 500)}${responseStr.length > 500 ? '...' : ''}`);
    ws.send(responseStr);
  });

  ws.on('close', () => {
    console.log(`[${ts()}] ❌ Disconnected from middleware. Reconnecting in 5s...`);
    ws = null;
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error(`[${ts()}] ❌ WebSocket error:`, err.message);
    // 'close' event will fire after this
  });
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connect();
  }, 5000);
}

// ─── Start ───────────────────────────────────────────────────────────────────
console.log(`[${ts()}] 🚀 Tally Agent starting...`);
console.log(`[${ts()}] 📋 Config: WS_URL=${WS_URL}, COMPANY_NAME=${COMPANY_NAME}, TALLY_HOST=${TALLY_HOST}`);
connect();
