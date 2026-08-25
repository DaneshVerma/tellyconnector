// ────────────────────────────────────────────────────────────────────
// IMPORTANT: Tally's HTTP XML parser is extremely strict:
//   1. XML must be compact (NO newlines, NO indentation between tags)
//   2. Do NOT include <VERSION> in the header — it causes "Unknown Request"
//   3. Use "Export Data" (not "Export") for <TALLYREQUEST>
//   4. Use "Import Data" for imports
//   5. Imports need <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC>
// ────────────────────────────────────────────────────────────────────

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Import helpers ──────────────────────────────────────────────────

function importEnvelope(bodyInner: string) {
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY>${bodyInner}</BODY></ENVELOPE>`;
}

export function buildImportLedgerXml(
  ledgerName: string,
  parent = "Sundry Debtors",
) {
  return importEnvelope(
    `<IMPORTDATA>` +
    `<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC>` +
    `<REQUESTDATA>` +
    `<TALLYMESSAGE>` +
    `<LEDGER NAME="${escapeXml(ledgerName)}">` +
    `<PARENT>${escapeXml(parent)}</PARENT>` +
    `</LEDGER>` +
    `</TALLYMESSAGE>` +
    `</REQUESTDATA>` +
    `</IMPORTDATA>`,
  );
}

export function buildInactivateLedgerXml(ledgerName: string) {
  return importEnvelope(
    `<IMPORTDATA>` +
    `<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC>` +
    `<REQUESTDATA>` +
    `<TALLYMESSAGE>` +
    `<LEDGER NAME="${escapeXml(ledgerName)}">` +
    `<ISINACTIVE>Yes</ISINACTIVE>` +
    `</LEDGER>` +
    `</TALLYMESSAGE>` +
    `</REQUESTDATA>` +
    `</IMPORTDATA>`,
  );
}

// ── Export helpers ───────────────────────────────────────────────────

function exportEnvelope(reportName: string, extraStatic = "") {
  return (
    `<ENVELOPE>` +
    `<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>` +
    `<BODY>` +
    `<EXPORTDATA>` +
    `<REQUESTDESC>` +
    `<REPORTNAME>${reportName}</REPORTNAME>` +
    `<STATICVARIABLES>` +
    `<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>` +
    extraStatic +
    `</STATICVARIABLES>` +
    `</REQUESTDESC>` +
    `</EXPORTDATA>` +
    `</BODY>` +
    `</ENVELOPE>`
  );
}

/** Export "List of Accounts" — returns all account/ledger masters */
export function buildExportListAccountsXml() {
  return exportEnvelope("List of Accounts");
}

/** Export the "Ledger" report */
export function buildExportLedgerXml() {
  return exportEnvelope("Ledger");
}

/** Export "Balance Sheet" */
export function buildExportBalanceSheetXml() {
  return exportEnvelope("Balance Sheet");
}

/** Export "Trial Balance" */
export function buildExportTrialBalanceXml() {
  return exportEnvelope("Trial Balance");
}

/** Probe multiple report names to see which ones Tally accepts */
export function buildExportVariants() {
  const reports = [
    "List of Accounts",
    "Ledger",
    "Balance Sheet",
    "Trial Balance",
    "Day Book",
    "List of Vouchers",
    "Stock Summary",
  ];

  return reports.map((name) => ({
    name,
    xml: exportEnvelope(name),
  }));
}
