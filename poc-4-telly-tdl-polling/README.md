# Tally <> Middleware POC

This repository contains a small proof-of-concept for a bidirectional sync pattern between TallyPrime and a cloud-style middleware. The middleware runs locally and exposes simple endpoints; the TDL module demonstrates how Tally could push vouchers and poll for commands.

Deliverable structure

- /middleware
  - `package.json` - npm manifest
  - `server.js` - Express server with endpoints
  - `index.html` - single-file frontend to queue commands and view received vouchers
- /tdl
  - `sync_module.tdl` - TDL sample module (commented)

Requirements

- Node.js (14+ recommended) to run the middleware
- TallyPrime with TDL support for loading local TDLs

Run the middleware

1. Open a terminal and run:

```bash
cd middleware
npm install
npm start
```

2. Open http://localhost:3000 in your browser. Use the button "Queue: Create Test Ledger" to enqueue a sample `create_ledger` command.

How it works (brief)

- POST /tally/push — Tally sends voucher JSON to this endpoint; the server stores it in-memory in `receivedVouchers`.
- GET /tally/received — frontend polls this endpoint every 3s to display received vouchers.
- POST /tally/queue-command — frontend or external app can add a command to the queue.
- GET /tally/poll — Tally polls this endpoint; the server returns the first pending command (or empty object).
- POST /tally/ack — Tally posts back the result of executing a command; the server marks it completed.

Load the TDL into TallyPrime (testing steps)

1. Save `tdl/sync_module.tdl` to a location accessible to Tally.
2. In Tally: F1 > Settings > TDL & Add-On > F4: Manage Local TDLs > Add the file > enable "Load on startup" > Restart Tally.
3. Open the custom report "Tally Sync Monitor" (created by the TDL). Keep this screen open to enable the timer/polling.

Test script

1. Start middleware and open http://localhost:3000
2. Load TDL into Tally and open the `Sync Monitor` report screen to activate polling.
3. In Tally: Create and save a Sales voucher. The TDL's push function will POST to `/tally/push`.
   - Confirm the voucher appears on the web page under "Received Vouchers" within a few seconds.
4. In the browser, click "Queue: Create Test Ledger".
   - The server will add a `create_ledger` command to the queue.
   - Within ~20s (timer interval), the TDL's poll will GET `/tally/poll`, create the ledger via XML import, and POST an ack to `/tally/ack`.
   - Confirm the ledger appears in Tally's ledger list and the middleware logs show the ack.

Notes and adaptation guidance

- TDL and TallyPrime versions vary. The `sync_module.tdl` file includes placeholders and explanatory comments. You may need to adapt the precise HTTP request and XML import function names to match your Tally build's supported TDL primitives.
- This POC uses in-memory queues and no authentication. Do not use this pattern in production without proper security and reliability improvements.

If you want, I can:

- Attempt to fine-tune `sync_module.tdl` to the exact HTTP/XML function syntax for your TallyPrime version if you provide the Tally build number.
- Convert the middleware to use SQLite instead of in-memory arrays.
