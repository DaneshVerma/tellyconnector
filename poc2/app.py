from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("tally_poc")

app = FastAPI(title="TallyPrime Cloud Probe", version="0.1.0")

latest_request: dict[str, Any] = {}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "tallyprime-cloud-probe",
        "timestamp_utc": utc_now_iso(),
    }


@app.get("/api/tally/latest")
async def latest() -> dict[str, Any]:
    return {"latest_request": latest_request or None}


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>TallyPrime Cloud Probe</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 2rem; background: #f5f7fb; color: #1d2433; }
        .wrap { max-width: 980px; margin: 0 auto; }
        h1 { margin-bottom: 0.5rem; }
        .meta { color: #4b5563; margin-bottom: 1.5rem; }
        .card { background: white; border-radius: 12px; padding: 1rem 1.25rem; box-shadow: 0 2px 8px rgba(0,0,0,0.05); margin-bottom: 1rem; }
        pre { white-space: pre-wrap; word-break: break-word; background: #0f172a; color: #f8fafc; padding: 1rem; border-radius: 8px; overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; vertical-align: top; padding: 0.5rem 0.75rem; border-bottom: 1px solid #e5e7eb; }
        th { width: 220px; }
        .empty { color: #6b7280; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <h1>TallyPrime Cloud Probe</h1>
        <div class="meta">Latest request received from TallyPrime, if any.</div>
        <div id="payload" class="card">Loading...</div>
      </div>

      <script>
        async function loadLatest() {
          const response = await fetch('/api/tally/latest');
          const data = await response.json();
          const payload = document.getElementById('payload');
          if (!data.latest_request) {
            payload.innerHTML = '<div class="empty">No request received yet.</div>';
            return;
          }

          const request = data.latest_request;
          const rows = [
            ['Timestamp (UTC)', request.timestamp_utc || ''],
            ['Method', request.method || ''],
            ['Path', request.path || ''],
            ['Content-Type', request.content_type || ''],
            ['Client IP', request.client_ip || ''],
            ['Forwarded For', request.forwarded_for || ''],
            ['User-Agent', request.user_agent || ''],
            ['Remote Address', request.source?.remote_addr || ''],
            ['Host', request.source?.host || ''],
            ['Full URL', request.source?.full_url || ''],
          ];

          payload.innerHTML = `
            <table>
              ${rows.map(([label, value]) => `<tr><th>${label}</th><td>${value || '—'}</td></tr>`).join('')}
            </table>
            <h3>Headers</h3>
            <pre>${JSON.stringify(request.headers || {}, null, 2)}</pre>
            <h3>Raw Body</h3>
            <pre>${request.body_text || '(empty body)'}</pre>
          `;
        }

        loadLatest();
        setInterval(loadLatest, 3000);
      </script>
    </body>
    </html>
    """


@app.post("/api/tally/webhook")
async def tally_webhook(request: Request) -> JSONResponse:
    headers = dict(request.headers)
    content_type = request.headers.get("content-type", "")
    raw_body = await request.body()
    body_text = raw_body.decode("utf-8", errors="replace")

    client_ip = request.client.host if request.client else None
    forwarded_for = request.headers.get("x-forwarded-for")
    real_ip = request.headers.get("x-real-ip")
    source_info = {
        "remote_addr": forwarded_for.split(",")[0].strip() if forwarded_for else real_ip or client_ip,
        "host": request.headers.get("host"),
        "scheme": request.url.scheme,
        "full_url": str(request.url),
    }

    timestamp_utc = utc_now_iso()
    record: dict[str, Any] = {
        "timestamp_utc": timestamp_utc,
        "method": request.method,
        "path": request.url.path,
        "content_type": content_type,
        "headers": headers,
        "client_ip": client_ip,
        "forwarded_for": forwarded_for,
        "real_ip": real_ip,
        "user_agent": request.headers.get("user-agent"),
        "source": source_info,
        "content_length": request.headers.get("content-length"),
        "body_text": body_text,
        "body_preview": body_text[:2000],
        "body_bytes": len(raw_body),
    }

    latest_request.clear()
    latest_request.update(record)

    logger.info("Request received")
    logger.info("Headers: %s", headers)
    logger.info("Content-Type: %s", content_type)
    logger.info("Raw body: %s", body_text)

    response_payload = {
        "status": "success",
        "message": "Tally webhook received",
        "received_at_utc": timestamp_utc,
    }
    logger.info("Response returned: %s", response_payload)
    return JSONResponse(content=response_payload)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
