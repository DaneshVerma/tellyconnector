# TallyPrime Local Integration POC (Minimal)

This repository contains a minimal technical feasibility proof-of-concept demonstrating a Next.js frontend and backend communicating with a locally running TallyPrime instance via Tally's HTTP/XML interface.

Purpose: Prove these flows on a single Windows machine where TallyPrime is installed and running:

- Browser -> Backend
- Backend -> TallyPrime (HTTP/XML)
- Backend receives Tally response and returns it to the Browser

This POC purposely stays small and focused — it is NOT production-ready.

---

**Architecture**

Browser (Next.js React) -> Next.js API routes (server) -> TallyPrime HTTP/XML (localhost:9000) -> TallyPrime

- The browser never talks directly to `http://localhost:9000`; it calls backend API routes under `/api/tally/*`.
- The backend is responsible for building the XML envelope, sending it to Tally, and returning raw response details to the frontend.

**Where to find the implementation**

- Frontend UI: `app/page.tsx`
- Tally XML helpers and HTTP proxy: `lib/tallyProxy.ts`
- Minimal (older) test XML helper: `lib/tallyRequest.ts`
- API routes: `app/api/tally/status`, `app/api/tally/get-ledger`, `app/api/tally/create-ledger`, `app/api/tally/update-ledger`

---

Getting started (developer)

1. Install dependencies from `poc1-browser-client-to-telly`:

```bash
cd poc1-browser-client-to-telly
npm install
```

2. Start the dev server:

```bash
npm run dev
```

3. Open the UI:

http://localhost:3000

---

What the UI provides

- Connection status (Connected / Disconnected / Error)
- READ: `Get Test Ledger` — requests ledger listing from Tally (raw XML returned)
- CREATE: Input a ledger name and click `Create Ledger` — backend builds an IMPORT XML with a minimal `<LEDGER>` and posts to Tally
- UPDATE: Provide an existing ledger `oldName` and a `newName` to rename via an ALTER `<LEDGER>` import
- RAW DEBUG: For every operation the app shows the request XML sent and the raw response body returned by Tally, plus HTTP status and errors

Mock mode

The frontend includes a Mock mode toggle. When enabled, the backend endpoints return canned XML responses so you can exercise the UI without TallyPrime.

---

TallyPrime configuration (what you must enable in Tally)

The POC uses TallyPrime's built-in HTTP/XML interface on port `9000`. Typical steps on a Windows machine with TallyPrime:

1. Open TallyPrime on the machine where you will run the browser and the Next.js server.
2. In TallyPrime, enable the HTTP/XML server. (In many Tally versions this appears under `Gateway of Tally -> F12: Configure -> Advanced Configuration` or a similar configuration area; enable XML/HTTP server and note the listening port — default `9000`.)
3. Ensure TallyPrime is running and the HTTP server is listening on `localhost:9000`.

If you cannot find the exact UI in your TallyPrime build, consult Tally's official documentation for enabling the HTTP/XML interface for your specific TallyPrime version.

Minimal network checks

From the same Windows machine:

```powershell
netstat -ano | findstr :9000
curl.exe -v -X POST http://localhost:9000 -H "Content-Type: application/xml; charset=utf-8" --data "<ENVELOPE></ENVELOPE>"
```

If `curl` returns a response, TallyPrime is accepting HTTP/XML requests and the POC can be exercised.

---

TDL (Tally Definition Language)

This POC does not ship any TDL files. The operations demonstrated (exporting lists, importing masters using `<IMPORTDATA>` and `<TALLYMESSAGE>` with `<LEDGER>` elements) use Tally's documented XML import/export mechanism and should work with a default TallyPrime installation that has the HTTP/XML server enabled.

If your Tally installation requires custom reports or data fields, you would add the smallest possible TDL fragments on the Tally side to expose those reports or accept custom fields. For basic ledger create/read/update via XML import/export, no TDL was created for this POC.

---

Examples (what the code sends)

 - Export (list of ledgers): built in `lib/tallyProxy.ts` as `buildExportLedgersRequest()` — an `EXPORTDATA` envelope requesting the `Ledger` report (safer default across Tally installations).
- Create ledger:

```xml
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE>
          <LEDGER NAME="Test Ledger" ACTION="Create">
            <NAME>Test Ledger</NAME>
            <PARENT>Sundry Debtors</PARENT>
          </LEDGER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
```

- Update ledger (rename): similar `IMPORTDATA` with `<LEDGER NAME="OldName" ACTION="Alter"><NAME>NewName</NAME></LEDGER>`.

These examples are implemented in `lib/tallyProxy.ts`.

---

How to test each flow

1. Start TallyPrime and confirm port 9000 is listening (or enable Mock mode if not testing with Tally).
2. Start the Next.js app (`npm run dev`).
3. Open `http://localhost:3000`.
4. Toggle Mock mode OFF to test against a local TallyPrime; leave ON to test without Tally.
5. Click each button and observe the Raw Response and Error panels. The backend returns a JSON payload containing the raw `request` XML, the raw `text` response from Tally, and the HTTP `status`.

Example API requests the frontend makes (backend proxies them to Tally):

- `GET /api/tally/status` — sends a small export request and returns raw response
- `GET /api/tally/get-ledger?name=...` — requests ledger list (server returns raw XML)
- `POST /api/tally/create-ledger` with JSON `{ name: string, parent?: string }` — posts an IMPORT XML to create the ledger
- `POST /api/tally/update-ledger` with JSON `{ oldName: string, newName: string }` — posts an ALTER import to update the ledger

---

Known limitations

- This POC is unencrypted HTTP on localhost and only intended for local testing.
- No authentication, tenancy, or production-grade error handling is present.
- The POC returns raw XML strings from Tally — it does not parse or validate fields beyond simple client-side checks.
- This repo does not include automated tests against a live TallyPrime instance.

---

## FEASIBILITY RESULT

The answers below are based on the code implemented in this POC. They describe what the prototype implements and what you can expect when you run it against a properly configured local TallyPrime instance. They should be experimentally verified by running the steps above on a Windows machine with TallyPrime installed.

- Can the web application communicate with TallyPrime?
  - Implementation: Yes — the backend implements HTTP POSTs with XML payloads to `http://localhost:9000` via `lib/tallyProxy.ts`.
  - Note: This is a code-level demonstration. To confirm network-level connectivity, run the app and perform the `Test Tally Connection` flow.

- Can we read data?
  - Implementation: Yes — the endpoint `/api/tally/get-ledger` sends an `EXPORTDATA` request for the `Ledger` report and returns the raw XML response. The POC shows the raw response in the UI.

- Can we create data?
  - Implementation: Yes — the endpoint `/api/tally/create-ledger` constructs an `IMPORTDATA` envelope with a minimal `<LEDGER ACTION="Create">` and posts it to Tally.

- Can we update data?
  - Implementation: Yes — the endpoint `/api/tally/update-ledger` constructs an `IMPORTDATA` envelope with `<LEDGER ACTION="Alter">` to update an existing ledger.

- Is TDL required?
  - Implementation: For the minimal operations demonstrated (exporting ledger lists and importing master `<LEDGER>` items) the POC did not require any TDL file. These operations use Tally's documented XML import/export mechanism.
  - Caveat: Some Tally configurations or custom fields/reports may require TDL on the Tally side. If you need custom reports or custom fields, add only the minimal TDL that exposes them — do not implement business logic in TDL.

- What TDL functionality was required?
  - Implementation: None for the basic create/read/update ledger flows in this POC.

- What TallyPrime configuration was required?
  - Implementation: The only required configuration is enabling TallyPrime's HTTP/XML interface and ensuring it listens on `localhost:9000` (or adjust `TALLY_URL` environment variable accordingly). Exact menu labels may vary by TallyPrime release; consult Tally's official docs if the UI differs.

- Does this work without any additional local software?
  - Implementation: Yes — provided you have TallyPrime installed and configured to accept HTTP/XML requests on the same machine. No other local agents or software are required for the minimal flows.

- What prevents this from being deployed directly as a cloud-only application?
  - Constraint: TallyPrime is typically a desktop application that listens on a local port. A cloud-hosted web application cannot directly access a user's local TallyPrime instance unless that instance exposes a network-accessible endpoint (e.g., via port forwarding, VPN, or a locally installed agent that bridges to the cloud).

- What would be required to connect a cloud-hosted web application to a user's locally running TallyPrime?
  - Options:
    1. Local agent: run a small trusted agent on the user's machine that proxies requests between cloud backend and local TallyPrime (requires installation and security considerations).
    2. Port forwarding / VPN: network-level exposure of the local Tally port to the cloud (typically undesirable for security reasons).
    3. Secure reverse tunnel: the user's machine establishes an outbound reverse tunnel to a broker service; the cloud app communicates via that broker.
  - Each option requires additional engineering around security, discovery, and user consent.

---

If you want, I can now:

- Run the Next.js server here and exercise the mock flows automatically, or
- Help you test against your local TallyPrime instance step-by-step and interpret results, or
- Add minimal unit tests and a small e2e script that exercises the API routes in mock mode.

Which would you like me to do next?
