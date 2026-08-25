"use client";

import { useMemo, useState } from "react";
import { buildMinimalTallyXmlRequest } from "@/lib/tallyRequest";

type ConnectionState = "idle" | "loading" | "success" | "error";

type ResultState = {
  connection: ConnectionState;
  statusCode: number | null;
  responseTimeMs: number | null;
  body: string;
  error: string;
  requestUrl: string;
  mockMode: boolean;
  parsed?: any | null;
};

const defaultResult: ResultState = {
  connection: "idle",
  statusCode: null,
  responseTimeMs: null,
  body: "",
  error: "",
  requestUrl: "http://localhost:9000",
  mockMode: false,
  parsed: null,
};

const mockResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <TALLYMESSAGE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
    </HEADER>
    <BODY>
        <IMPORTDATA>
        <REQUESTDESC>
            <REPORTNAME>Ledger</REPORTNAME>
        </REQUESTDESC>
        </IMPORTDATA>
    </BODY>
    </TALLYMESSAGE>`;

const buildMockBody = async () => {
  const xml = buildMinimalTallyXmlRequest();
  const response = new Response(mockResponse, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });

  return {
    response,
    xml,
  };
};

export default function HomePage() {
  const [result, setResult] = useState<ResultState>(defaultResult);
  const [isMockEnabled, setIsMockEnabled] = useState<boolean>(
    process.env.NEXT_PUBLIC_USE_MOCK_TALLY === "true",
  );
  const [showParsed, setShowParsed] = useState<boolean>(true);
  const [createName, setCreateName] = useState<string>("Test Ledger");
  const [updateOldName, setUpdateOldName] = useState<string>("Test Ledger");
  const [updateNewName, setUpdateNewName] = useState<string>(
    "Test Ledger Renamed",
  );
  const [groupCreateName, setGroupCreateName] = useState<string>("Test Group");
  const [groupParent, setGroupParent] = useState<string>("Primary");
  const [groupOldName, setGroupOldName] = useState<string>("Test Group");
  const [groupNewName, setGroupNewName] =
    useState<string>("Test Group Renamed");

  const summaryText = useMemo(() => {
    if (result.connection === "success") {
      if (result.statusCode !== null && result.statusCode >= 400) {
        return `The browser received a response from the target, but the HTTP status was ${result.statusCode}. That is a Tally response failure, not a network failure.`;
      }

      return `Reached TallyPrime successfully. HTTP ${result.statusCode}.`;
    }

    if (result.connection === "loading") {
      return "Request in progress...";
    }

    if (result.connection === "error") {
      return result.error || "Request failed.";
    }

    return "No request has been sent yet.";
  }, [result]);

  const handleTestConnection = async () => {
    const startedAt = Date.now();
    setResult({
      ...defaultResult,
      connection: "loading",
      requestUrl: "/api/tally/status",
      mockMode: isMockEnabled,
    });

    try {
      const resp = await fetch(`/api/tally/status?mock=${isMockEnabled}`);
      const elapsed = Date.now() - startedAt;
      const json = await resp.json();

      setResult({
        connection: resp.ok ? "success" : "error",
        statusCode: json.status ?? resp.status,
        responseTimeMs: elapsed,
        body: json.text || json.error || JSON.stringify(json),
        parsed: json.parsed ?? null,
        error: resp.ok ? "" : json.error || "Tally returned an error",
        requestUrl: "/api/tally/status",
        mockMode: isMockEnabled,
      });
    } catch (error: any) {
      const elapsed = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error during Tally connection test:", error);

      const normalizedError = (() => {
        if (
          message.includes("Failed to fetch") ||
          message.includes("ERR_CONNECTION_REFUSED") ||
          message.includes("ECONNREFUSED")
        ) {
          return "Network connectivity failure. The browser could not connect to http://localhost:9000. Check whether TallyPrime is listening on that port.";
        }
        if (message.includes("timeout")) {
          return "The request timed out. The browser reached the localhost stack, but TallyPrime either did not respond or did not accept the request in time.";
        }
        if (
          message.includes("CORS") ||
          message.includes("has been blocked by CORS policy")
        ) {
          return "Browser CORS/security blocking. This is not a TallyPrime network failure. The browser stopped the request before it could complete because the response headers do not permit cross-origin access.";
        }
        if (
          message.includes("mixed content") ||
          message.includes("insecure") ||
          message.includes("secure context")
        ) {
          return "Mixed-content / secure-context restriction. The page is being served in a way that blocks an HTTP request to localhost from a secure origin.";
        }
        if (
          message.includes("Not Found") ||
          message.includes("500") ||
          message.includes("502")
        ) {
          return "The browser reached a local endpoint, but the target returned an HTTP error. This is a Tally response-level failure.";
        }

        return message;
      })();

      setResult({
        connection: "error",
        statusCode: null,
        responseTimeMs: elapsed,
        body: "",
        error: normalizedError,
        requestUrl: "/api/tally/status",
        mockMode: false,
      });
    }
  };

  const handleGetLedger = async (name?: string) => {
    const startedAt = Date.now();
    setResult({
      ...defaultResult,
      connection: "loading",
      mockMode: isMockEnabled,
    });

    try {
      const q = new URLSearchParams();
      if (isMockEnabled) q.set("mock", "true");
      if (name) q.set("name", name);

      const resp = await fetch(`/api/tally/get-ledger?${q.toString()}`);
      const elapsed = Date.now() - startedAt;
      const json = await resp.json();

      setResult({
        connection: resp.ok ? "success" : "error",
        statusCode: json.status ?? resp.status,
        responseTimeMs: elapsed,
        body: json.text || json.error || JSON.stringify(json),
        error: resp.ok ? "" : json.error || "",
        requestUrl: "/api/tally/get-ledger",
        mockMode: isMockEnabled,
      });
    } catch (err: any) {
      setResult({ ...defaultResult, connection: "error", error: String(err) });
    }
  };

  const handleGetGroups = async () => {
    const startedAt = Date.now();
    setResult({
      ...defaultResult,
      connection: "loading",
      mockMode: isMockEnabled,
    });

    try {
      const q = new URLSearchParams();
      if (isMockEnabled) q.set("mock", "true");

      const resp = await fetch(`/api/tally/get-group?${q.toString()}`);
      const elapsed = Date.now() - startedAt;
      const json = await resp.json();

      setResult({
        connection: resp.ok ? "success" : "error",
        statusCode: json.status ?? resp.status,
        responseTimeMs: elapsed,
        body: json.text || json.error || JSON.stringify(json),
        error: resp.ok ? "" : json.error || "",
        requestUrl: "/api/tally/get-group",
        mockMode: isMockEnabled,
      });
    } catch (err: any) {
      setResult({ ...defaultResult, connection: "error", error: String(err) });
    }
  };

  const handleCreateGroup = async () => {
    const startedAt = Date.now();
    setResult({
      ...defaultResult,
      connection: "loading",
      mockMode: isMockEnabled,
    });

    try {
      const resp = await fetch(`/api/tally/create-group`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupCreateName,
          parent: groupParent,
          mock: isMockEnabled,
        }),
      });

      const elapsed = Date.now() - startedAt;
      const json = await resp.json();

      setResult({
        connection: resp.ok ? "success" : "error",
        statusCode: json.status ?? resp.status,
        responseTimeMs: elapsed,
        body: json.text || json.error || JSON.stringify(json),
        parsed: json.parsed ?? null,
        error: resp.ok ? "" : json.error || "",
        requestUrl: "/api/tally/create-group",
        mockMode: isMockEnabled,
      });
    } catch (err: any) {
      setResult({ ...defaultResult, connection: "error", error: String(err) });
    }
  };

  const handleUpdateGroup = async () => {
    const startedAt = Date.now();
    setResult({
      ...defaultResult,
      connection: "loading",
      mockMode: isMockEnabled,
    });

    try {
      const resp = await fetch(`/api/tally/update-group`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldName: groupOldName,
          newName: groupNewName,
          mock: isMockEnabled,
        }),
      });

      const elapsed = Date.now() - startedAt;
      const json = await resp.json();

      setResult({
        connection: resp.ok ? "success" : "error",
        statusCode: json.status ?? resp.status,
        responseTimeMs: elapsed,
        body: json.text || json.error || JSON.stringify(json),
        parsed: json.parsed ?? null,
        error: resp.ok ? "" : json.error || "",
        requestUrl: "/api/tally/update-group",
        mockMode: isMockEnabled,
      });
    } catch (err: any) {
      setResult({ ...defaultResult, connection: "error", error: String(err) });
    }
  };

  const handleCreateLedger = async () => {
    const startedAt = Date.now();
    setResult({
      ...defaultResult,
      connection: "loading",
      mockMode: isMockEnabled,
    });

    try {
      const resp = await fetch(`/api/tally/create-ledger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName, mock: isMockEnabled }),
      });

      const elapsed = Date.now() - startedAt;
      const json = await resp.json();

      setResult({
        connection: resp.ok ? "success" : "error",
        statusCode: json.status ?? resp.status,
        responseTimeMs: elapsed,
        body: json.text || json.error || JSON.stringify(json),
        parsed: json.parsed ?? null,
        error: resp.ok ? "" : json.error || "",
        requestUrl: "/api/tally/create-ledger",
        mockMode: isMockEnabled,
      });
    } catch (err: any) {
      setResult({ ...defaultResult, connection: "error", error: String(err) });
    }
  };

  const handleUpdateLedger = async () => {
    const startedAt = Date.now();
    setResult({
      ...defaultResult,
      connection: "loading",
      mockMode: isMockEnabled,
    });

    try {
      const resp = await fetch(`/api/tally/update-ledger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldName: updateOldName,
          newName: updateNewName,
          mock: isMockEnabled,
        }),
      });

      const elapsed = Date.now() - startedAt;
      const json = await resp.json();

      setResult({
        connection: resp.ok ? "success" : "error",
        statusCode: json.status ?? resp.status,
        responseTimeMs: elapsed,
        body: json.text || json.error || JSON.stringify(json),
        parsed: json.parsed ?? null,
        error: resp.ok ? "" : json.error || "",
        requestUrl: "/api/tally/update-ledger",
        mockMode: isMockEnabled,
      });
    } catch (err: any) {
      setResult({ ...defaultResult, connection: "error", error: String(err) });
    }
  };

  return (
    <main className='page-shell'>
      <div className='card'>
        <h1>TallyPrime Local Connectivity POC</h1>

        <div className='controls'>
          <button
            onClick={handleTestConnection}
            disabled={result.connection === "loading"}
          >
            {result.connection === "loading"
              ? "Testing..."
              : "Test Tally Connection"}
          </button>

          <label className='toggle'>
            <input
              type='checkbox'
              checked={isMockEnabled}
              onChange={(event) => setIsMockEnabled(event.target.checked)}
            />
            Enable Mock Tally mode
          </label>

          <div className='crud'>
            <div className='crud-card'>
              <h3>Ledgers</h3>
              <div className='crud-row'>
                <button onClick={() => handleGetLedger()}>Get Ledgers</button>
              </div>

              <div className='crud-row'>
                <label className='label'>Create ledger</label>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                />
                <button onClick={handleCreateLedger}>Create</button>
              </div>

              <div className='crud-row'>
                <label className='label'>Update ledger</label>
                <input
                  value={updateOldName}
                  onChange={(e) => setUpdateOldName(e.target.value)}
                  placeholder='Existing name'
                />
                <input
                  value={updateNewName}
                  onChange={(e) => setUpdateNewName(e.target.value)}
                  placeholder='New name'
                />
                <button onClick={handleUpdateLedger}>Update</button>
              </div>
            </div>

            <div className='crud-card'>
              <h3>Groups</h3>
              <div className='crud-row'>
                <button onClick={() => handleGetGroups()}>Get Groups</button>
              </div>

              <div className='crud-row'>
                <label className='label'>Create group</label>
                <input
                  value={groupCreateName}
                  onChange={(e) => setGroupCreateName(e.target.value)}
                />
                <input
                  value={groupParent}
                  onChange={(e) => setGroupParent(e.target.value)}
                  placeholder='Parent group'
                />
                <button onClick={handleCreateGroup}>Create</button>
              </div>

              <div className='crud-row'>
                <label className='label'>Update group</label>
                <input
                  value={groupOldName}
                  onChange={(e) => setGroupOldName(e.target.value)}
                  placeholder='Existing name'
                />
                <input
                  value={groupNewName}
                  onChange={(e) => setGroupNewName(e.target.value)}
                  placeholder='New name'
                />
                <button onClick={handleUpdateGroup}>Update</button>
              </div>
            </div>
          </div>
        </div>

        <div className='status-row'>
          <span className='label'>Connection status:</span>
          <strong className={`status ${result.connection}`}>
            {result.connection}
          </strong>
        </div>

        <div className='detail-grid'>
          <div>
            <span className='label'>Request URL</span>
            <p>{result.requestUrl}</p>
          </div>
          <div>
            <span className='label'>Response status</span>
            <p>{result.statusCode === null ? "—" : result.statusCode}</p>
          </div>
          <div>
            <span className='label'>Response time</span>
            <p>
              {result.responseTimeMs === null
                ? "—"
                : `${result.responseTimeMs} ms`}
            </p>
          </div>
        </div>

        <div className='summary-box'>
          <h2>Summary</h2>
          <p>{summaryText}</p>
        </div>

        <div className='panel'>
          <h2>Response body</h2>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type='checkbox'
              checked={showParsed}
              onChange={(e) => setShowParsed(e.target.checked)}
            />
            Show parsed JSON when available
          </label>

          {showParsed && result.parsed ? (
            <pre>{JSON.stringify(result.parsed, null, 2)}</pre>
          ) : (
            <pre>{result.body || "<no response body>"}</pre>
          )}
        </div>

        <div className='panel error-panel'>
          <h2>Error details</h2>
          <pre>{result.error || "<no error>"}</pre>
        </div>
      </div>
    </main>
  );
}
