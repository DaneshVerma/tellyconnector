// ────────────────────────────────────────────────────────────────────
// IMPORTANT: Tally's HTTP XML parser is extremely strict:
//   1. XML must be compact (NO newlines, NO indentation between tags)
//   2. Do NOT include <VERSION> in the header — it causes "Unknown Request"
//   3. Use "Export Data" (not "Export") for <TALLYREQUEST>
//   4. Use "Import Data" for imports
//   5. Imports need <REQUESTDESC><REPORTNAME>...</REPORTNAME></REQUESTDESC>
// ────────────────────────────────────────────────────────────────────

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Envelope factories ──────────────────────────────────────────────

function importEnvelope(body: string, reportName = "All Masters") {
  return (
    `<ENVELOPE>` +
    `<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>` +
    `<BODY><IMPORTDATA>` +
    `<REQUESTDESC><REPORTNAME>${reportName}</REPORTNAME></REQUESTDESC>` +
    `<REQUESTDATA><TALLYMESSAGE>${body}</TALLYMESSAGE></REQUESTDATA>` +
    `</IMPORTDATA></BODY></ENVELOPE>`
  );
}

function exportEnvelope(reportName: string, extraStatic = "") {
  return (
    `<ENVELOPE>` +
    `<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>` +
    `<BODY><EXPORTDATA><REQUESTDESC>` +
    `<REPORTNAME>${reportName}</REPORTNAME>` +
    `<STATICVARIABLES>` +
    `<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>` +
    extraStatic +
    `</STATICVARIABLES>` +
    `</REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`
  );
}

// ── Ledger CRUD ─────────────────────────────────────────────────────

export function buildCreateLedgerXml(
  name: string,
  parent = "Sundry Debtors",
) {
  return importEnvelope(
    `<LEDGER NAME="${escapeXml(name)}" ACTION="Create">` +
    `<NAME>${escapeXml(name)}</NAME>` +
    `<PARENT>${escapeXml(parent)}</PARENT>` +
    `</LEDGER>`,
  );
}

export function buildAlterLedgerXml(
  name: string,
  newParent: string,
) {
  return importEnvelope(
    `<LEDGER NAME="${escapeXml(name)}" ACTION="Alter">` +
    `<NAME>${escapeXml(name)}</NAME>` +
    `<PARENT>${escapeXml(newParent)}</PARENT>` +
    `</LEDGER>`,
  );
}

export function buildInactivateLedgerXml(name: string) {
  return importEnvelope(
    `<LEDGER NAME="${escapeXml(name)}">` +
    `<NAME>${escapeXml(name)}</NAME>` +
    `<ISINACTIVE>Yes</ISINACTIVE>` +
    `</LEDGER>`,
  );
}

// ── Group CRUD ──────────────────────────────────────────────────────

export function buildCreateGroupXml(
  name: string,
  parent = "Primary",
) {
  return importEnvelope(
    `<GROUP NAME="${escapeXml(name)}" ACTION="Create">` +
    `<NAME>${escapeXml(name)}</NAME>` +
    `<PARENT>${escapeXml(parent)}</PARENT>` +
    `</GROUP>`,
  );
}

// ── Stock Item CRUD ─────────────────────────────────────────────────

export function buildCreateStockItemXml(
  name: string,
  group = "Primary",
  unit = "Nos",
  openingQty?: number,
  openingRate?: number,
) {
  let body =
    `<STOCKITEM NAME="${escapeXml(name)}" ACTION="Create">` +
    `<NAME>${escapeXml(name)}</NAME>`;
  if (group && group.toLowerCase() !== "primary") {
    body += `<PARENT>${escapeXml(group)}</PARENT>`;
  }
  body += `<BASEUNITS>${escapeXml(unit)}</BASEUNITS>`;
  if (openingQty !== undefined && openingRate !== undefined) {
    const openingVal = openingQty * openingRate;
    body +=
      `<OPENINGBALANCE>${openingQty} ${escapeXml(unit)}</OPENINGBALANCE>` +
      `<OPENINGVALUE>${openingVal}</OPENINGVALUE>` +
      `<OPENINGRATE>${openingRate}</OPENINGRATE>`;
  }
  body += `</STOCKITEM>`;
  return importEnvelope(body);
}

// ── Unit of Measure ─────────────────────────────────────────────────

export function buildCreateUnitXml(
  symbol: string,
  formalName?: string,
) {
  return importEnvelope(
    `<UNIT NAME="${escapeXml(symbol)}" ACTION="Create">` +
    `<NAME>${escapeXml(symbol)}</NAME>` +
    `<ORIGINALNAME>${escapeXml(formalName ?? symbol)}</ORIGINALNAME>` +
    `<ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>` +
    `</UNIT>`,
  );
}

// ── Voucher (Transaction) CRUD ──────────────────────────────────────

export type VoucherEntry = {
  ledger: string;
  amount: number; // positive = credit, negative = debit in Tally convention
  isDeemedPositive: boolean;
};

export function buildCreateVoucherXml(opts: {
  type: string; // "Sales" | "Purchase" | "Payment" | "Receipt" | "Journal" | "Contra"
  date: string; // YYYYMMDD
  narration: string;
  partyLedger?: string;
  entries: VoucherEntry[];
}) {
  let body =
    `<VOUCHER VCHTYPE="${escapeXml(opts.type)}" ACTION="Create">` +
    `<DATE>${opts.date}</DATE>` +
    `<NARRATION>${escapeXml(opts.narration)}</NARRATION>` +
    `<VOUCHERTYPENAME>${escapeXml(opts.type)}</VOUCHERTYPENAME>`;

  if (opts.partyLedger) {
    body += `<PARTYLEDGERNAME>${escapeXml(opts.partyLedger)}</PARTYLEDGERNAME>`;
  }

  for (const e of opts.entries) {
    body +=
      `<ALLLEDGERENTRIES.LIST>` +
      `<LEDGERNAME>${escapeXml(e.ledger)}</LEDGERNAME>` +
      `<ISDEEMEDPOSITIVE>${e.isDeemedPositive ? "Yes" : "No"}</ISDEEMEDPOSITIVE>` +
      `<AMOUNT>${e.amount}</AMOUNT>` +
      `</ALLLEDGERENTRIES.LIST>`;
  }

  body += `</VOUCHER>`;
  return importEnvelope(body, "Vouchers");
}

// ── Export reports ───────────────────────────────────────────────────

/** Export "List of Accounts" — all account/ledger masters */
export function buildExportListAccountsXml() {
  return exportEnvelope("List of Accounts");
}

/** Export the "Ledger" report (detailed) */
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

/** Export "Day Book" — list of vouchers/transactions */
export function buildExportDayBookXml() {
  return exportEnvelope("Day Book");
}

/** Export "Profit and Loss" */
export function buildExportProfitLossXml() {
  return exportEnvelope("Profit and Loss");
}

/** Export "Stock Summary" */
export function buildExportStockSummaryXml() {
  return exportEnvelope("Stock Summary");
}

/** Probe multiple report names */
export function buildExportVariants() {
  const reports = [
    "List of Accounts",
    "Ledger",
    "Balance Sheet",
    "Trial Balance",
    "Day Book",
    "Profit and Loss",
    "Stock Summary",
    "Cash Flow",
    "Funds Flow",
  ];
  return reports.map((name) => ({ name, xml: exportEnvelope(name) }));
}
