## Architecture Design Document: TallyPrime Cloud SaaS & HRMS Sync Engine

### 1. System Overview

This document outlines the architecture for connecting an on-premise TallyPrime instance with a multi-tenant cloud backend and a mobile HRMS application.

Because TallyPrime runs locally on raw HTTP without CORS or public endpoints, a lightweight **Desktop Sync Agent** acts as an authenticated bidirectional bridge.

---

### 2. High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    MOBILE HRMS APP                          │
│     (React Native / Flutter — iOS & Android)                │
│     - Employee Management, Attendance, Payroll Approvals    │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS (REST / GraphQL)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               CLOUD BACKEND (AWS / Render)                  │
│                                                             │
│   ┌───────────────────────┐     ┌───────────────────────┐   │
│   │ API Gateway & Auth    │     │ Sync Queue (BullMQ)   │   │
│   │ (Express / NestJS)    │     │ + Redis Cache         │   │
│   └───────────┬───────────┘     └───────────▲───────────┘   │
│               │                             │               │
│   ┌───────────▼───────────┐     ┌───────────┴───────────┐   │
│   │ Multi-Tenant Database │     │ WebSocket Gateway     │   │
│   │ (PostgreSQL + JSONB)  │     │ (Socket.io / ws)      │   │
│   └───────────────────────┘     └───────────▲───────────┘   │
└─────────────────────────────────────────────┼───────────────┘
                                              │ WSS (Persistent Encrypted Socket)
                                              │ (Auth via Organization API Key)
                                              ▼
┌─────────────────────────────────────────────────────────────┐
│             CLIENT LOCAL MACHINE (Windows)                  │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ DESKTOP SYNC AGENT (.exe)                           │   │
│   │ (Tauri / Electron Tray Application)                 │   │
│   │ - Local XML Generator & Parser                      │   │
│   │ - Socket Client & Job Consumer                      │   │
│   └──────────────────────────┬──────────────────────────┘   │
│                              │ Local HTTP (Port 9000)       │
│                              ▼                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ TALLYPRIME (Running locally)                        │   │
│   │ - Active Company Open                               │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

```

---

### 3. Component Breakdown

#### A. Mobile HRMS Client

* **Role:** Primary interface for HR administrators and employees.
* **Interactions:** Makes standard JSON API calls to the Cloud Backend. It **never** interacts directly with Tally or the desktop machine.

#### B. Cloud Backend & Sync Queue

* **API Layer (NestJS/Express):** Handles authentication, tenant management, and HR business logic.
* **Database (PostgreSQL):** Stores HRMS entities (employees, attendance, salary slips) and cached Tally masters (ledgers, groups, cost centres).
* **Sync & Job Queue (Redis + BullMQ):** Sequentially queues voucher creation and ledger sync jobs. Queued jobs survive network disconnects when the client's PC is shut down.
* **WebSocket Gateway:** Maintains long-lived bi-directional connections with connected Desktop Agents using mutual organization tokens.

#### C. Desktop Sync Agent (.exe)

* **Technology:** Tauri (Rust + TypeScript) or Electron.
* **Operation:** Runs silently in the Windows system tray.
* **Capabilities:**
* Connects outbound to `wss://api.yourcloud.com` (no router configuration or port forwarding needed).
* Executes scheduled read cron jobs against `[http://127.0.0.1:9000](http://127.0.0.1:9000)` to extract updated masters.
* Consumes queued write jobs pushed over the WebSocket, converts JSON payloads to Tally XML envelopes, submits them to port 9000, and reports status back.



---

### 4. Data Flow & Communication Patterns

#### Pattern 1: Outbound Sync (Tally $\rightarrow$ Cloud Backend)

1. The Desktop Agent queries Tally every $N$ minutes for modified masters (Employees, Payroll Ledgers):

$$\text{Agent} \xrightarrow{\text{POST XML}} \text{Tally (Port 9000)} \xrightarrow{\text{XML Response}} \text{Agent}$$


2. The Agent parses XML into JSON using `fast-xml-parser`.
3. The Agent pushes the batch payload to the Cloud API with tenant authentication headers:

$$\text{Agent} \xrightarrow{\text{HTTPS POST /api/v1/sync/masters}} \text{Cloud Backend} \rightarrow \text{PostgreSQL}$$



#### Pattern 2: Inbound CRUD (Mobile HRMS $\rightarrow$ TallyPrime)

1. An admin approves payroll in the Mobile HRMS app.
2. The Cloud Backend records the transaction as `PENDING_SYNC` in PostgreSQL and pushes a job to Redis.
3. The WebSocket Gateway dispatches the event to the tenant's connected Desktop Agent.
4. The Desktop Agent constructs the Tally XML envelope and posts it locally to port 9000.
5. Tally returns `<CREATED>1</CREATED>` or an `<ERRORS>` tag.
6. The Agent sends an execution receipt back over the WebSocket. The cloud updates the record status to `SYNCED`.

---

### 5. Multi-Tenant Pairing Strategy

To pair a client's local Tally instance with their SaaS organization:

1. Admin registers on the Cloud Dashboard and receives a secure **Pairing Token / Secret Key**.
2. The user installs the lightweight `TallySyncAgent.exe` on their Tally Windows PC.
3. On first launch, the user pastes their Pairing Token.
4. The Agent stores the token securely in the local Windows Credential Vault and establishes the WebSocket connection with the cloud server.

---

### 6. Roadmap: Minimum Viable Demo (POC Draft)

We will implement the demo in two streamlined parts:

```
[Phase 1: Local Bridge Engine]
├── Build a local Node.js engine to execute raw XML CRUD operations on TallyPrime (Port 9000)
│   ├── Create Company / Read Ledgers (Read)
│   ├── Create Ledger / Employee Group (Create)
│   ├── Alter Ledger / Update Balance (Update)
│   └── Create Payroll / Payment Voucher (Write)

[Phase 2: Cloud Relay & WebSocket Interface]
├── Build an Express / WebSocket Relay server
└── Connect the local engine to simulate remote CRUD dispatch from an external UI

```