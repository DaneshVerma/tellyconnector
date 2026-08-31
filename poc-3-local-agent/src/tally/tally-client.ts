import * as http from "http";
import { TALLY_HOST, TALLY_PORT, TALLY_TIMEOUT_MS, log } from "../config";
import {
  buildCreateLedgerXml,
  buildAlterLedgerXml,
  buildInactivateLedgerXml,
  buildCreateGroupXml,
  buildCreateStockItemXml,
  buildCreateUnitXml,
  buildCreateVoucherXml,
  buildExportListAccountsXml,
  buildExportLedgerXml,
  buildExportBalanceSheetXml,
  buildExportTrialBalanceXml,
  buildExportDayBookXml,
  buildExportProfitLossXml,
  buildExportStockSummaryXml,
  buildExportVariants,
  type VoucherEntry,
} from "./xml-builder";

const BASE_URL = `http://${TALLY_HOST}:${TALLY_PORT}`;

// ── Types ───────────────────────────────────────────────────────────

export type TallyResult = {
  success: boolean;
  status: string;
  message: string;
  rawResponse?: string;
  data?: any;
};

export type ImportCounts = {
  created: number;
  altered: number;
  deleted: number;
  errors: number;
  exceptions: number;
  cancelled: number;
};

// ── HTTP transport ──────────────────────────────────────────────────

async function doPost(
  xml: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: TALLY_HOST,
        port: TALLY_PORT,
        method: "POST",
        headers: {
          "Content-Type": "text/xml;charset=utf-8",
          "Content-Length": Buffer.byteLength(xml),
        },
        timeout: TALLY_TIMEOUT_MS,
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          const duration = Date.now() - start;
          log("http.post", { url: BASE_URL, duration, status: res.statusCode });
          resolve({ ok: true, text });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      log("http.error", { url: BASE_URL, duration: Date.now() - start, error: "Timeout" });
      resolve({ ok: false, error: "Timeout" });
    });

    req.on("error", (err) => {
      log("http.error", { url: BASE_URL, duration: Date.now() - start, error: err.message });
      resolve({ ok: false, error: err.message });
    });

    req.write(xml);
    req.end();
  });
}

// ── Response helpers ────────────────────────────────────────────────

function isUnknownRequest(text: string) {
  return text.includes("Unknown Request") || text.includes("cannot be processed");
}

function isLineError(text: string) {
  return text.includes("LINEERROR");
}

function extractLineError(text: string): string | null {
  const m = text.match(/<LINEERROR>(.*?)<\/LINEERROR>/);
  return m ? m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&") : null;
}

function parseImportCounts(text: string): ImportCounts {
  const get = (tag: string) => {
    const m = text.match(new RegExp(`<${tag}>(\\d+)</${tag}>`));
    return m ? Number(m[1]) : 0;
  };
  return {
    created: get("CREATED"),
    altered: get("ALTERED"),
    deleted: get("DELETED"),
    errors: get("ERRORS"),
    exceptions: get("EXCEPTIONS"),
    cancelled: get("CANCELLED"),
  };
}

/** Common import result handler */
async function doImport(
  xml: string,
  op: string,
  entityLabel: string,
): Promise<TallyResult & { counts?: ImportCounts }> {
  const start = Date.now();
  const res = await doPost(xml);
  const duration = Date.now() - start;

  if (!res.ok) {
    log(op, { duration, success: false, error: res.error });
    return { success: false, status: "error", message: `Connection failed: ${res.error}`, rawResponse: res.error };
  }

  if (isUnknownRequest(res.text)) {
    log(op, { duration, success: false, note: "unknown_request" });
    return { success: false, status: "unknown_request", message: `Tally rejected the ${entityLabel} request`, rawResponse: res.text };
  }

  if (isLineError(res.text)) {
    const err = extractLineError(res.text);
    log(op, { duration, success: false, note: "line_error", error: err });
    return { success: false, status: "line_error", message: `Tally error: ${err}`, rawResponse: res.text };
  }

  const counts = parseImportCounts(res.text);
  const ok = counts.created > 0 || counts.altered > 0;
  
  let exDetail = "";
  if (counts.exceptions > 0) {
    exDetail = ` (Note: Tally rejected the request due to invalid data, e.g., missing parent group or ledger. Check Tally.imp for details.)`;
  } else if (counts.errors > 0) {
    exDetail = ` (Note: Syntax or data format error.)`;
  }

  log(op, { duration, success: ok, ...counts });
  return {
    success: ok,
    status: ok ? "ok" : "no_change",
    message: ok
      ? `${entityLabel} successful — created: ${counts.created}, altered: ${counts.altered}`
      : `Failed: Tally processed but nothing changed (errors: ${counts.errors}, exceptions: ${counts.exceptions})${exDetail}`,
    rawResponse: res.text,
    counts,
  };
}

/** Common export result handler */
async function doExport(
  xml: string,
  op: string,
  label: string,
): Promise<TallyResult> {
  const start = Date.now();
  const res = await doPost(xml);
  const duration = Date.now() - start;

  if (!res.ok) {
    log(op, { duration, success: false, error: res.error });
    return { success: false, status: "error", message: `Connection failed: ${res.error}`, rawResponse: res.error };
  }

  if (isUnknownRequest(res.text)) {
    log(op, { duration, success: false, note: "unknown_request" });
    return { success: false, status: "unknown_request", message: `Tally cannot export ${label}`, rawResponse: res.text };
  }

  if (isLineError(res.text)) {
    const err = extractLineError(res.text);
    log(op, { duration, success: false, note: "line_error", error: err });
    return { success: false, status: "line_error", message: `Tally error: ${err}`, rawResponse: res.text };
  }

  log(op, { duration, success: true });
  return { success: true, status: "ok", message: `${label} exported`, rawResponse: res.text };
}

// ── TallyClient ─────────────────────────────────────────────────────

export class TallyClient {

  // ── Connection ──────────────────────────────────────────────────
  async checkConnection(): Promise<TallyResult> {
    return doExport(buildExportListAccountsXml(), "checkConnection", "Connection test");
  }

  // ── Ledger CRUD ─────────────────────────────────────────────────
  async createLedger(name: string, parent = "Sundry Debtors") {
    return doImport(buildCreateLedgerXml(name, parent), "createLedger", "Ledger create");
  }

  async updateLedger(name: string, newParent: string) {
    return doImport(buildAlterLedgerXml(name, newParent), "updateLedger", "Ledger update");
  }

  async deleteLedger(name: string) {
    return doImport(buildInactivateLedgerXml(name), "deleteLedger", "Ledger delete (inactivate)");
  }

  async readLedger(name: string): Promise<TallyResult> {
    const res = await doExport(buildExportListAccountsXml(), "readLedger", "Accounts");
    if (!res.success) return res;
    const found = res.rawResponse?.includes(name) ?? false;
    return {
      ...res,
      status: found ? "found" : "not_found",
      message: found ? `Ledger "${name}" found` : `Ledger "${name}" not found in accounts`,
    };
  }

  // ── Group CRUD ──────────────────────────────────────────────────
  async createGroup(name: string, parent = "Primary") {
    return doImport(buildCreateGroupXml(name, parent), "createGroup", "Group create");
  }

  // ── Stock Item CRUD ─────────────────────────────────────────────
  async createStockItem(name: string, group = "Primary", unit = "Nos") {
    return doImport(buildCreateStockItemXml(name, group, unit), "createStockItem", "Stock Item create");
  }

  // ── Unit of Measure ─────────────────────────────────────────────
  async createUnit(symbol: string, formalName?: string) {
    return doImport(buildCreateUnitXml(symbol, formalName), "createUnit", "Unit create");
  }

  // ── Voucher (Transaction) CRUD ──────────────────────────────────
  async createVoucher(opts: {
    type: string;
    date: string;
    narration: string;
    partyLedger?: string;
    entries: VoucherEntry[];
  }) {
    return doImport(buildCreateVoucherXml(opts), "createVoucher", `${opts.type} voucher`);
  }

  // ── Exports ─────────────────────────────────────────────────────
  async listAccounts() {
    return doExport(buildExportListAccountsXml(), "listAccounts", "List of Accounts");
  }

  async getBalanceSheet() {
    return doExport(buildExportBalanceSheetXml(), "getBalanceSheet", "Balance Sheet");
  }

  async getTrialBalance() {
    return doExport(buildExportTrialBalanceXml(), "getTrialBalance", "Trial Balance");
  }

  async getDayBook() {
    return doExport(buildExportDayBookXml(), "getDayBook", "Day Book");
  }

  async getProfitLoss() {
    return doExport(buildExportProfitLossXml(), "getProfitLoss", "Profit & Loss");
  }

  async getStockSummary() {
    return doExport(buildExportStockSummaryXml(), "getStockSummary", "Stock Summary");
  }

  async probeExportVariants() {
    const variants = buildExportVariants();
    const results: { name: string; success: boolean; status: string; raw: string }[] = [];

    for (const v of variants) {
      const start = Date.now();
      const res = await doPost(v.xml);
      const duration = Date.now() - start;
      if (!res.ok) {
        results.push({ name: v.name, success: false, status: "network_error", raw: res.error });
        continue;
      }
      if (isUnknownRequest(res.text)) {
        results.push({ name: v.name, success: false, status: "unknown_request", raw: "" });
        continue;
      }
      if (isLineError(res.text)) {
        results.push({ name: v.name, success: false, status: `error: ${extractLineError(res.text)}`, raw: "" });
        continue;
      }
      log("probe", { variant: v.name, duration, success: true });
      results.push({ name: v.name, success: true, status: "ok", raw: res.text.substring(0, 200) });
    }

    return results;
  }

  // ── Demo: Create sample data ────────────────────────────────────
  async runDemo(onProgress: (msg: string, res: TallyResult) => void) {
    const today = new Date();
    // Use the 1st of the current month to ensure it works in Tally Educational Mode!
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}01`;

    // 1. Create unit
    const u = await this.createUnit("Nos", "Numbers");
    onProgress(`Create unit "Nos"`, u);

    // 2. Create ledger groups
    const g1 = await this.createGroup("Demo Customers", "Sundry Debtors");
    onProgress(`Create group "Demo Customers" under Sundry Debtors`, g1);

    const g2 = await this.createGroup("Demo Suppliers", "Sundry Creditors");
    onProgress(`Create group "Demo Suppliers" under Sundry Creditors`, g2);

    // 3. Create ledgers
    const l1 = await this.createLedger("Acme Corp", "Demo Customers");
    onProgress(`Create ledger "Acme Corp" (customer)`, l1);

    const l2 = await this.createLedger("Widget Supply Co", "Demo Suppliers");
    onProgress(`Create ledger "Widget Supply Co" (supplier)`, l2);

    const l3 = await this.createLedger("Sales Account", "Sales Accounts");
    onProgress(`Create ledger "Sales Account"`, l3);

    const l4 = await this.createLedger("Purchase Account", "Purchase Accounts");
    onProgress(`Create ledger "Purchase Account"`, l4);

    // 4. Create stock item
    const si = await this.createStockItem("Demo Widget", "Primary", "Nos");
    onProgress(`Create stock item "Demo Widget"`, si);

    // 5. Create a purchase voucher
    const pv = await this.createVoucher({
      type: "Purchase",
      date: dateStr,
      narration: "Purchased 10 Demo Widgets from Widget Supply Co",
      partyLedger: "Widget Supply Co",
      entries: [
        { ledger: "Purchase Account", amount: 5000, isDeemedPositive: true },
        { ledger: "Widget Supply Co", amount: -5000, isDeemedPositive: false },
      ],
    });
    onProgress(`Create purchase voucher (₹5,000 from Widget Supply Co)`, pv);

    // 6. Create a sales voucher
    const sv = await this.createVoucher({
      type: "Sales",
      date: dateStr,
      narration: "Sold 5 Demo Widgets to Acme Corp",
      partyLedger: "Acme Corp",
      entries: [
        { ledger: "Acme Corp", amount: -4000, isDeemedPositive: true },
        { ledger: "Sales Account", amount: 4000, isDeemedPositive: false },
      ],
    });
    onProgress(`Create sales voucher (₹4,000 to Acme Corp)`, sv);

    // 7. Create a receipt voucher (Acme pays partial)
    const rv = await this.createVoucher({
      type: "Receipt",
      date: dateStr,
      narration: "Received partial payment from Acme Corp",
      entries: [
        { ledger: "Cash", amount: -2000, isDeemedPositive: true },
        { ledger: "Acme Corp", amount: 2000, isDeemedPositive: false },
      ],
    });
    onProgress(`Create receipt voucher (₹2,000 received from Acme Corp)`, rv);

    // 8. Create a payment voucher (pay supplier partial)
    const pmv = await this.createVoucher({
      type: "Payment",
      date: dateStr,
      narration: "Paid partial amount to Widget Supply Co",
      entries: [
        { ledger: "Widget Supply Co", amount: -3000, isDeemedPositive: true },
        { ledger: "Cash", amount: 3000, isDeemedPositive: false },
      ],
    });
    onProgress(`Create payment voucher (₹3,000 paid to Widget Supply Co)`, pmv);
  }
}
