# Tally <> Middleware POC

This proof-of-concept demonstrates a local agent bridging TallyPrime (local HTTP/XML) and a simple middleware over WebSockets.

## Structure

```
/middleware
  server.js (Express + ws)
  index.html (simple frontend)
/agent
  agent.js (node agent)
  package.json
```

## How to run

### 1. Start the middleware server

```bash
cd middleware
npm install express ws body-parser
node server.js
```

### 2. Start the agent

```bash
cd agent
npm install
node agent.js
```

### 3. Enable Tally HTTP server if not already enabled

Gateway of Tally > F1: Help > Settings > Connectivity > Client/Server configuration > TallyPrime acts as > Server, port 9000

## Test script

1. Start middleware, open http://localhost:3000 in browser, confirm status shows "offline".
2. Start the agent (`node agent.js`), confirm browser status flips to "connected".
3. Click "Send: Create Test Ledger" in the web UI — this will POST a `create_ledger` command to the agent which posts XML to Tally. Check Tally Masters for the new ledger.
4. Create/save a voucher in Tally; within ~10s the agent's poll will detect and forward the voucher to the middleware and it will appear in the UI log.
5. Stop the agent process, click "Send" again — middleware should return 503 "agent offline".
6. Restart the agent — it should reconnect automatically.

## Notes

- This is a simple POC: no auth, no durable queueing, naive XML parsing.
- If Tally is not running or not accepting XML on port 9000, the agent will log errors when posting to Tally.
