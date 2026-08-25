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
};

const defaultResult: ResultState = {
  connection: "idle",
  statusCode: null,
  responseTimeMs: null,
  body: "",
  error: "",
  requestUrl: "http://localhost:9000",
  mockMode: false,
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
      requestUrl: "http://localhost:9000",
      mockMode: isMockEnabled,
    });

    try {
      if (isMockEnabled) {
        const { response, xml } = await buildMockBody();
        const elapsed = Date.now() - startedAt;
        const text = await response.text();

        setResult({
          connection: "success",
          statusCode: response.status,
          responseTimeMs: elapsed,
          body: text,
          error:
            "Mock mode enabled. This simulates the browser receiving a valid Tally-style XML response without needing TallyPrime installed.",
          requestUrl: "http://localhost:9000 (mock mode)",
          mockMode: true,
        });

        console.info("Mock Tally XML payload:", xml);
        return;
      }

      const payload = buildMinimalTallyXmlRequest();
      const response = await fetch("http://localhost:9000", {
        method: "POST",
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          Accept: "application/xml, text/xml, */*",
        },
        body: payload,
      });

      const elapsed = Date.now() - startedAt;
      const responseText = await response.text();
      const isXmlResponse = /<\?xml|<TALLYMESSAGE|<RESPONSE/i.test(
        responseText,
      );

      setResult({
        connection: "success",
        statusCode: response.status,
        responseTimeMs: elapsed,
        body: responseText,
        error: response.ok
          ? ""
          : `The browser reached the target and received an HTTP ${response.status} response, but the Tally endpoint rejected the request or returned an unexpected payload.`,
        requestUrl: "http://localhost:9000",
        mockMode: false,
      });

      if (!isXmlResponse && responseText.trim()) {
        setResult((current) => ({
          ...current,
          error:
            "The browser received a response, but it does not look like valid Tally XML. This is a malformed or unexpected Tally response.",
        }));
      }
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
        requestUrl: "http://localhost:9000",
        mockMode: false,
      });
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
          <h2>Raw response body</h2>
          <pre>{result.body || "<no response body>"}</pre>
        </div>

        <div className='panel error-panel'>
          <h2>Error details</h2>
          <pre>{result.error || "<no error>"}</pre>
        </div>
      </div>
    </main>
  );
}
