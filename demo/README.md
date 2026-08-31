# TallyConnect — Real-Time Sync Demo

Real-time bidirectional sync between a hosted web app and TallyPrime via a local agent.

---

## Architecture

```
Browser (anywhere)  ←→  Middleware (cloud/ngrok)  ←WS→  Agent (local PC)  ←HTTP→  TallyPrime (localhost:9000)
```

---

## Prerequisites

- **Node.js** v18+ installed on both the server and the local machine
- **TallyPrime** running on the local machine with a company open
- **ngrok** installed (for exposing the middleware to the internet)

### TallyPrime Configuration

1. Open TallyPrime
2. Open a company (note the **exact company name** — you'll need it)
3. Go to: **Gateway of Tally → F1 Help → Settings → Connectivity**
4. Set **"TallyPrime acts as"** = `Server` (or `Both`)
5. Set **Port** = `9000`
6. Accept/save the settings

---

## Step-by-Step Setup

### 1. Start the Middleware Server

```bash
cd middleware
npm install
node server.js
```

You should see:
```
[...] 🚀 Middleware server running on http://localhost:3000
[...] 📡 WebSocket endpoint at ws://localhost:3000/agent
```

### 2. Expose via ngrok

In a **new terminal**:

```bash
npx ngrok http 3000
```

Note the two forwarding URLs:
- **HTTPS**: `https://xxxx-xx-xx.ngrok-free.app` → use this in the browser
- **WSS**: `wss://xxxx-xx-xx.ngrok-free.app` → use this in the agent config

> The WSS URL is just the HTTPS URL with `wss://` instead of `https://`.

### 3. Configure the Agent

Open `agent/agent.js` and edit the two config constants at the top:

```javascript
const WS_URL = 'wss://xxxx-xx-xx.ngrok-free.app/agent';  // ← your ngrok WSS URL + /agent
const COMPANY_NAME = 'Your Company Name';                  // ← exact TallyPrime company name
```

### 4. Start the Agent

```bash
cd agent
npm install
node agent.js
```

You should see:
```
[...] 🚀 Tally Agent starting...
[...] 📋 Config: WS_URL=wss://..., COMPANY_NAME=..., TALLY_HOST=http://localhost:9000
[...] 🔌 Connecting to wss://...
[...] ✅ Connected to middleware
```

### 5. Verify in Browser

1. Open the ngrok HTTPS URL in your browser
2. Confirm the status badge shows **"Agent: Connected"** (green)
3. The Ledgers table should populate with data from Tally

### 6. (Optional) Build the .exe

Once everything works, build a portable executable:

```bash
cd agent
npm run build
```

This produces `tally-agent.exe` — a standalone executable that runs without Node.js installed.

---

## Live Demo Script

> **Audience: CEO / stakeholders. Time: ~3 minutes.**

### Setup (before the demo)
- Middleware + ngrok already running
- Agent already running and connected
- Browser tab open to the ngrok URL

### Demo Steps

1. **Show the dashboard**
   - Point out the **"Agent: Connected"** green badge
   - _"This web app is hosted in the cloud. It's connected in real-time to TallyPrime running on this machine via our local agent."_

2. **Show existing ledgers**
   - Scroll to the Ledgers table
   - _"These are the actual ledgers from TallyPrime, loaded live — not a cache, not a copy."_

3. **Create a new ledger from the web**
   - Fill in the form:
     - Name: `Demo Customer`
     - Parent: `Sundry Debtors`
     - Opening Balance: `50000`
   - Click **Create**
   - Wait for the green success toast
   - _"We just created a ledger in TallyPrime from a web browser."_

4. **Verify in TallyPrime**
   - Switch to TallyPrime (Alt+Tab)
   - Gateway of Tally → Display More Reports → Account Books → Ledger → find `Demo Customer`
   - _"There it is — created instantly from the web, with the correct parent group and opening balance."_

5. **Show it in the table**
   - Switch back to the browser
   - The ledger table has already auto-refreshed with `Demo Customer` in it
   - _"The dashboard updates automatically every 5 seconds. Real-time, bidirectional sync."_

6. **Show vouchers**
   - Scroll to the Vouchers section
   - _"We can also read vouchers — the Day Book — live from the web."_

7. **Closing**
   - _"This is a proof of concept. The architecture — cloud middleware, local agent, WebSocket bridge — is production-ready and can be extended to handle any TallyPrime operation."_

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Agent shows "Disconnected" | Check ngrok is running, WSS URL is correct in agent.js (must end with `/agent`) |
| "Agent is not connected" error in browser | Start the agent, wait 5s for reconnect |
| Ledgers table shows error | Ensure TallyPrime is running with a company open and port 9000 |
| Create ledger fails | Check COMPANY_NAME in agent.js matches **exactly** (case-sensitive) |
| XML parse errors | The sanitizer handles most cases — check agent console for raw response |

---

## File Structure

```
tellyconnector/
├── middleware/
│   ├── package.json
│   ├── server.js          ← Express + WebSocket middleware
│   └── public/
│       └── index.html     ← Dashboard UI
├── agent/
│   ├── package.json
│   ├── agent.js           ← Local Tally bridge agent
│   └── tally-agent.exe    ← (after npm run build)
└── README.md              ← This file
```
