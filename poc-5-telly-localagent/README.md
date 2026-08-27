# Tally Bridge Demo for a CEO Presentation

This project turns a working local TallyPrime bridge into a demo-ready prototype that can be run almost entirely from a browser. The idea is simple: keep TallyPrime open in the background, let a local Windows service keep the connection alive, and use a browser UI to create ledgers, create vouchers, and observe live updates from Tally without needing to be a Tally user.

## What this demo does

- Lets a browser create a ledger in TallyPrime
- Shows live ledgers and recent vouchers from Tally in the browser
- Lets you create sales vouchers from the browser
- Shows a live activity log of what is happening in plain language
- Keeps the agent running in the background as a Windows Service

---

## One-time setup before the first demo

### 1) Enable TallyPrime's local HTTP/XML interface

This must be done once on the Tally machine.

Open TallyPrime, then go to:

- Gateway of Tally
- F1: Help
- Settings
- Connectivity
- Client/Server configuration
- TallyPrime acts as: choose "Both" or "Server"
- Confirm the port is 9000

Important: leave TallyPrime open after this. The browser demo is designed around Tally staying open in the background while the local agent communicates with it.

You do not need to log into complicated features or know accounting terminology to use this demo. The browser handles the work.

### 2) Create or load a simple demo company in Tally

If you do not already have a company loaded, do the minimum needed:

- Open TallyPrime
- Use the company selection screen
- Create or load a basic demo company
- Leave that company open and do not close Tally

This demo expects TallyPrime to be running normally in the background with a company open.

### 3) Install the Windows agent as a service

From the `agent` folder, run:

```bash
npm install
node install-service.js
```

This registers the agent as a Windows Service so it keeps running even when no terminal window is open.

It will:

- start automatically on machine boot
- restart automatically if it crashes
- log output to `agent/agent-logs/agent.log`

### 4) Start the middleware server

From the `middleware` folder, run:

```bash
npm install express ws body-parser
node server.js
```

This starts the local browser-facing server. The browser UI is served from the middleware.

---

## Every time before a demo

### 1) Open TallyPrime and leave it open

This is the only manual step that involves Tally itself. The entire rest of the session should run from the browser.

- Open TallyPrime
- Load your demo company
- Leave it open on the desktop
- Do not close it until the demo is done

### 2) Confirm the agent service is running

There are two easy checks:

- Windows Services panel -> confirm `TallyLocalAgent` is running
- Or open http://localhost:5001/status in the browser and check the JSON response

Expected example:

```json
{
  "agentRunning": true,
  "tallyReachable": true,
  "cloudConnected": true,
  "lastActivity": "2026-08-27T10:00:00.000Z"
}
```

If `tallyReachable` is false, Tally is not open or the HTTP/XML server is not enabled.

### 3) Open the web app

Open:

```text
http://localhost:3000
```

The page should show live status and the activity feed.

---

## Suggested live demo script for the CEO

### Step 1 - Show the status bar

Point to the status badges at the top of the page.

- Agent: Connected
- Tally: Connected
- Last sync: current time

This proves the local agent is alive and Tally is reachable.

### Step 2 - Create a ledger from the browser

- Go to the Ledgers section
- Fill in a ledger name such as "Acme Traders"
- Select a parent group such as "Sundry Debtors"
- Click "Save Ledger"

Immediately switch to the TallyPrime window and open the chart of accounts or master list. The new ledger should appear there.

Switch back to the browser and point to the activity log:

- "Sent create_ledger to agent"
- "Agent wrote to Tally"
- "Ledger created in Tally"

This proves the browser action is being translated into a real Tally change.

### Step 3 - Create a voucher from the browser

- Use the Sales Voucher section
- Select a party ledger
- Enter amount, date, narration
- Click "Create Voucher"

Then switch back to Tally and show the voucher in the voucher list. The browser page should also show the voucher in the recent vouchers table.

### Step 4 - Make a manual change directly in Tally

This proves the sync works both directions.

- In TallyPrime, create or edit a voucher or a new master directly
- Return to the browser after a few seconds
- The updated data should appear in the list without manual refresh

This is the key moment: "the browser can affect Tally, and Tally can affect the browser too."

### Step 5 - Edit and delete a ledger from the browser

- Click Edit on an existing ledger row
- Change the name or opening balance
- Click Save
- Confirm the change appears in Tally
- Click Delete on a ledger with no transactions
- Confirm the ledger disappears from Tally

The UI should show the actual reason if Tally refuses a delete because the ledger has transactions.

---

## What is actually happening

This is a local bridge: the browser talks to a middleware server, the middleware sends commands to a local Windows agent, and the agent speaks directly to TallyPrime over its built-in local HTTP/XML interface. Everything remains on the same machine and does not expose the system to the internet. That means the demo is simple to understand, easy to run in a live meeting, and safe for a presentation environment.

---

## Troubleshooting

### Tally is not open

Fix: open TallyPrime, load the demo company, and confirm the local HTTP server is enabled.

### Agent service is not running

Fix: run:

```bash
cd agent
node install-service.js
```

Then check Windows Services or http://localhost:5001/status.

### Middleware is not started

Fix: run:

```bash
cd middleware
node server.js
```

Then open http://localhost:3000.

---

## Quick summary

If the CEO asks, the answer is simple:

"This is a local bridge between a browser and TallyPrime. The browser makes requests, the agent translates them into Tally's local XML format, and the updates appear live in both places. Nothing is being pushed to the internet; the system stays inside the user's machine."

That is the message to keep in mind during the presentation.
