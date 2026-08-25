# TallyPrime Browser Connectivity POC

This project is a minimal proof-of-concept for checking whether a browser running on the same Windows machine can send an HTTP POST directly to a local TallyPrime instance at `http://localhost:9000`.

The application intentionally avoids any Next.js API route. The browser makes the HTTP request directly.

## What this app does

- Starts a simple Next.js UI
- Shows a `Test Tally Connection` button
- Sends a direct browser-side `fetch()` to `http://localhost:9000`
- Displays:
  - connection status
  - HTTP status code
  - request time
  - raw response body
  - detailed error text
- Allows a mock mode so the frontend can be verified without TallyPrime installed

## Install dependencies

From the project root:

```bash
npm install
```

## Run the app

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

To run in production mode after building:

```bash
npm run build
npm run start
```

## Mock Tally mode

To test the frontend without TallyPrime installed, create a `.env.local` file with:

```env
NEXT_PUBLIC_USE_MOCK_TALLY=true
```

Then restart the Next.js app. The UI will simulate a valid Tally-like XML response and let you verify the frontend behavior independent of the Windows Tally setup.

## Important design note

This POC intentionally does not use a Next.js route such as `/api/test-tally`. The browser request is direct:

```text
Browser -> http://localhost:9000 -> TallyPrime
```

## TallyPrime configuration requirements

TallyPrime must be configured to accept local HTTP/XML requests on port `9000` and must be running on the same Windows machine as the browser. In practice, you need to check the TallyPrime HTTP/XML integration settings for:

- enabled HTTP server or XML interface
- HTTP port binding to `localhost` or `127.0.0.1`
- whether the service is listening on port `9000`
- whether the XML request format is actually accepted by that enabled interface
- whether the request is restricted to specific local addresses or local services

This is a Tally-side configuration issue, not a Next.js issue.

## How to determine whether TallyPrime is listening on localhost:9000

From the same Windows machine, try one of the following:

### 1) Check the port listener

```powershell
netstat -ano | findstr :9000
```

If there is a listener, you should see a row showing the port is in use. You may also use:

```powershell
Get-NetTCPConnection -LocalPort 9000
```

### 2) Test with curl

```powershell
curl.exe -v -X POST http://localhost:9000 -H "Content-Type: application/xml; charset=utf-8" --data "<?xml version='1.0' encoding='UTF-8'?><TALLYMESSAGE></TALLYMESSAGE>"
```

If TallyPrime is listening and accepting XML requests, curl will show a response. If the port is closed, you will see a connection error.

### 3) Test via Postman

- Create a new POST request
- URL: `http://localhost:9000`
- Header: `Content-Type: application/xml; charset=utf-8`
- Body: a minimal XML payload matching Tally's expected format
- Send it from the same machine

This gives a comparison point for the browser request.

## What the browser error means

The browser error tells you which layer is failing:

- `Failed to fetch` / `ERR_CONNECTION_REFUSED`
  - network connectivity failure
  - the browser could not reach `localhost:9000` at all
  - usually means no Tally listener is active or the port is not bound

- `CORS policy ... has been blocked by CORS policy`
  - browser security block
  - the request reached the network stack or the target, but the browser refused to expose the result due to cross-origin policy
  - this is not proof that Tally is not listening

- `Mixed Content` / `secure context`
  - the page was served in a way that prevents an insecure HTTP request from a secure origin
  - often happens when the page is loaded from `https://...` instead of `http://localhost:3000`

- HTTP status response like `500`, `400`, or `200` with unexpected XML
  - Tally responded, but the request was rejected or malformed
  - this is a Tally response-level issue, not a browser connection failure

## XML payload used by this POC

The XML payload is isolated in one helper file so it is easy to replace:

- `lib/tallyRequest.ts`

The exported function:

```ts
buildMinimalTallyXmlRequest()
```

returns the minimal XML request body used by the browser.

This is intentionally a placeholder test payload, not a claimed working Tally API contract. You should replace it with the exact request format required by your TallyPrime configuration.

## Exact experiment to run after TallyPrime is installed

1. Start TallyPrime with the HTTP/XML interface enabled.
2. Confirm the Windows service is listening on `localhost:9000` using `netstat` or `curl`.
3. Start the Next app:

```bash
npm run dev
```

4. Open `http://localhost:3000` in the browser on the same machine.
5. Open DevTools and go to the `Network` tab.
6. Click `Test Tally Connection`.
7. Look for the request to `http://localhost:9000`.

### Evidence to collect from DevTools

You should record these details:

- request name and URL: `http://localhost:9000`
- request method: `POST`
- status code: `200`, `500`, `404`, etc.
- response headers
- timing information: `Waiting`, `Content Download`, `Total`
- the response body
- any Console errors such as:
  - `Failed to fetch`
  - `Access to fetch at ... has been blocked by CORS policy`
  - `Mixed Content` errors

### How to distinguish the failure modes

- Network connectivity failure
  - no request entry appears in Network at all,
  - or the request fails immediately with `ERR_CONNECTION_REFUSED`,
  - or `curl` also fails to connect

- Tally response failure
  - the request appears in Network,
  - it has an HTTP status like `400`, `500`, or similar,
  - the browser receives a response body that is empty, malformed, or not expected XML

- Browser CORS/security blocking
  - the request appears or fails at the browser security layer,
  - the Console shows CORS or mixed-content errors,
  - the Network request is blocked before the response is exposed to JS

This is the core distinction this POC is designed to make visible.

## Comparison: curl/Postman

To compare the browser behavior to a non-browser client:

```powershell
curl.exe -v -X POST http://localhost:9000 -H "Content-Type: application/xml; charset=utf-8" --data @payload.xml
```

If curl succeeds while the browser fails, then the issue is often browser policy, not local network reachability.

If both fail, then the likely problem is one of:

- TallyPrime not listening on port `9000`
- Tally HTTP/XML interface disabled
- incorrect XML payload for the installed Tally configuration
- firewall or local binding restrictions

## Disclaimer

This project is strictly a connectivity proof-of-concept. It does not claim any official TallyPrime API contract or production-ready integration.
