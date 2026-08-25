# Local TallyPrime Agent — Phase 1 POC

This repository contains a minimal Node.js + TypeScript local agent that communicates with a locally running TallyPrime instance via the Tally XML HTTP interface.

Installation

1. Install dependencies:

```bash
npm install
```

Configuration

Copy `.env.example` to `.env` and adjust if necessary:

```
TALLY_HOST=127.0.0.1
TALLY_PORT=9000
TALLY_TIMEOUT_MS=5000
```

How to configure TallyPrime

- Enable the TDL/XML-HTTP server in TallyPrime (Configuration → Advanced → TDL/HTTP interface). Ensure it listens on port 9000.

Start TallyPrime

- Launch TallyPrime on the local machine. Verify it is running and configured to accept XML requests on port 9000.

Verify port 9000

From the machine running the agent, verify the port is reachable (TCP) — this does not confirm Tally semantics but ensures reachability:

```bash
# Linux / macOS
nc -vz 127.0.0.1 9000

# Windows (PowerShell)
Test-NetConnection -ComputerName 127.0.0.1 -Port 9000
```

Run the agent

```bash
npm run dev
```

CLI options

Follow the interactive menu to:

1. Test Tally connection
2. Read test ledger
3. Create test ledger
4. Update test ledger
5. Delete test ledger

Result format

All operations return a normalized result:

```
{
  success: boolean,
  status: string,
  message: string,
  rawResponse?: string
}
```

Which operations were verified

- checkConnection: implemented and tested for connectivity (sends minimal request)
- readLedger: implemented (exports list of ledgers and searches for POC_TEST_LEDGER)
- createLedger: implemented via IMPORTDATA > LEDGER import
- updateLedger: implemented as re-import with updated fields
- deleteLedger: implemented by setting `ISINACTIVE` to `Yes` (mark-inactive) — destructive delete not implemented to avoid data loss

Operations that could not be fully verified

- Some Tally REPORTNAME and filter behaviors vary by Tally version; the agent uses conservative requests. See logs for raw responses.

Common connection errors

- Connection refused — Tally not running or not listening on configured port
- Timeout — Tally unresponsive or firewall blocking
- Malformed XML — unexpected response; agent logs raw response for debugging

Troubleshooting: "Unknown Request" response

- If you see `'<RESPONSE>Unknown Request, cannot be processed</RESPONSE>'` in the `rawResponse`, Tally accepted the HTTP connection but did not understand the XML payload. Common causes:
  - The TDL/HTTP interface is disabled or not configured to accept the type of request being sent.
  - The TDL installed in your TallyPrime does not expose the requested `REPORTNAME` or import structure.
  - The XML payload needs additional `REQUESTDESC`/`STATICVARIABLES` that are specific to your Tally setup.

Next steps when you encounter this:
1. Ensure the TDL/XML-HTTP server is enabled and that Tally is set to accept import/export requests on the port in `.env`.
2. Check Tally's logs or Developer/TDL docs to see expected `REPORTNAME` values and required request structure for your version.
3. Use the `rawResponse` logged by the agent when filing a TDL/HTTP configuration issue — it shows what Tally returned verbatim.

The agent will report `status: "unknown_request"` in this case so you can differentiate network/connectivity failures from Tally-level request rejections.

Phase 1 verification checklist

[ ] Agent reaches TallyPrime
[ ] Agent can read data
[ ] Agent can create test data
[ ] Agent can update test data
[ ] Agent can delete test data (mark-inactive)
[ ] XML errors are handled
[ ] Tally being offline is handled
