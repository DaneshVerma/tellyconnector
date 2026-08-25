import * as http from "http";
import { TALLY_HOST, TALLY_PORT, TALLY_TIMEOUT_MS, log } from "../config";
import { parseXml } from "./xml-parser";
import {
  buildImportLedgerXml,
  buildExportListAccountsXml,
  buildExportLedgerXml,
  buildExportBalanceSheetXml,
  buildExportTrialBalanceXml,
  buildExportVariants,
  buildInactivateLedgerXml,
} from "./xml-builder";

const BASE_URL = `http://${TALLY_HOST}:${TALLY_PORT}`;

export type PResult = {
  success: boolean;
  status: string;
  message: string;
  rawResponse?: string;
};

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
      log("http.error", {
        url: BASE_URL,
        duration: Date.now() - start,
        error: "Timeout",
      });
      resolve({ ok: false, error: "Timeout" });
    });

    req.on("error", (err) => {
      log("http.error", {
        url: BASE_URL,
        duration: Date.now() - start,
        error: err.message,
      });
      resolve({ ok: false, error: err.message });
    });

    req.write(xml);
    req.end();
  });
}

function isUnknownRequest(text: string) {
  return (
    text.includes("Unknown Request") || text.includes("cannot be processed")
  );
}

function isLineError(text: string) {
  return text.includes("LINEERROR");
}

function extractLineError(text: string): string | null {
  const m = text.match(/<LINEERROR>(.*?)<\/LINEERROR>/);
  return m ? m[1] : null;
}

/** Parse a Tally import response to extract CREATED / ALTERED / ERRORS counts */
function parseImportResponse(text: string) {
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

export class TallyClient {
  /** Quick connection test — exports "List of Accounts" which always exists */
  async checkConnection(): Promise<PResult> {
    const op = "checkConnection";
    const start = Date.now();
    const xml = buildExportListAccountsXml();
    const res = await doPost(xml);
    const duration = Date.now() - start;
    if (!res.ok) {
      log(op, { duration, success: false, error: res.error });
      return {
        success: false,
        status: "error",
        message: `Connection failed: ${res.error}`,
        rawResponse: res.error,
      };
    }

    if (isUnknownRequest(res.text)) {
      log(op, { duration, success: false, note: "unknown_request", raw: res.text });
      return {
        success: false,
        status: "unknown_request",
        message: "Tally returned 'Unknown Request' — check HTTP interface settings",
        rawResponse: res.text,
      };
    }

    if (isLineError(res.text)) {
      const err = extractLineError(res.text);
      log(op, { duration, success: false, note: "line_error", error: err });
      return {
        success: false,
        status: "line_error",
        message: `Tally error: ${err}`,
        rawResponse: res.text,
      };
    }

    log(op, { duration, success: true });
    return {
      success: true,
      status: "ok",
      message: "Tally is connected and responding",
      rawResponse: res.text,
    };
  }

  /** Export account list from Tally */
  async listAccounts(): Promise<PResult> {
    const op = "listAccounts";
    const start = Date.now();
    const xml = buildExportListAccountsXml();
    const res = await doPost(xml);
    const duration = Date.now() - start;
    if (!res.ok) {
      log(op, { duration, success: false, error: res.error });
      return { success: false, status: "error", message: "Connection failed", rawResponse: res.error };
    }

    if (isUnknownRequest(res.text)) {
      log(op, { duration, success: false, note: "unknown_request" });
      return { success: false, status: "unknown_request", message: "Export not accepted", rawResponse: res.text };
    }

    if (isLineError(res.text)) {
      const err = extractLineError(res.text);
      log(op, { duration, success: false, note: "line_error", error: err });
      return { success: false, status: "line_error", message: `Tally error: ${err}`, rawResponse: res.text };
    }

    log(op, { duration, success: true });
    return { success: true, status: "ok", message: "Accounts exported", rawResponse: res.text };
  }

  /** Export Balance Sheet */
  async getBalanceSheet(): Promise<PResult> {
    const op = "getBalanceSheet";
    const start = Date.now();
    const xml = buildExportBalanceSheetXml();
    const res = await doPost(xml);
    const duration = Date.now() - start;
    if (!res.ok) {
      log(op, { duration, success: false, error: res.error });
      return { success: false, status: "error", message: "Connection failed", rawResponse: res.error };
    }

    if (isUnknownRequest(res.text) || isLineError(res.text)) {
      log(op, { duration, success: false });
      return { success: false, status: "error", message: "Export failed", rawResponse: res.text };
    }

    log(op, { duration, success: true });
    return { success: true, status: "ok", message: "Balance Sheet exported", rawResponse: res.text };
  }

  /** Export Trial Balance */
  async getTrialBalance(): Promise<PResult> {
    const op = "getTrialBalance";
    const start = Date.now();
    const xml = buildExportTrialBalanceXml();
    const res = await doPost(xml);
    const duration = Date.now() - start;
    if (!res.ok) {
      log(op, { duration, success: false, error: res.error });
      return { success: false, status: "error", message: "Connection failed", rawResponse: res.error };
    }

    if (isUnknownRequest(res.text) || isLineError(res.text)) {
      log(op, { duration, success: false });
      return { success: false, status: "error", message: "Export failed", rawResponse: res.text };
    }

    log(op, { duration, success: true });
    return { success: true, status: "ok", message: "Trial Balance exported", rawResponse: res.text };
  }

  async probeExportVariants(): Promise<
    { name: string; success: boolean; status: string; raw: string }[]
  > {
    const variants = buildExportVariants();
    const results: {
      name: string;
      success: boolean;
      status: string;
      raw: string;
    }[] = [];
    for (const v of variants) {
      const start = Date.now();
      const res = await doPost(v.xml);
      const duration = Date.now() - start;
      if (!res.ok) {
        log("probe", { variant: v.name, duration, success: false, error: res.error });
        results.push({ name: v.name, success: false, status: "network_error", raw: res.error });
        continue;
      }

      if (isUnknownRequest(res.text)) {
        log("probe", { variant: v.name, duration, success: false, note: "unknown_request" });
        results.push({ name: v.name, success: false, status: "unknown_request", raw: res.text });
        continue;
      }

      if (isLineError(res.text)) {
        const err = extractLineError(res.text) ?? "unknown";
        log("probe", { variant: v.name, duration, success: false, note: "line_error", error: err });
        results.push({ name: v.name, success: false, status: `line_error: ${err}`, raw: res.text });
        continue;
      }

      log("probe", { variant: v.name, duration, success: true });
      results.push({ name: v.name, success: true, status: "ok", raw: res.text.substring(0, 200) });
    }

    return results;
  }

  async createLedger(ledgerName: string, parent = "Sundry Debtors"): Promise<PResult> {
    const op = "createLedger";
    const start = Date.now();
    const xml = buildImportLedgerXml(ledgerName, parent);
    const res = await doPost(xml);
    const duration = Date.now() - start;
    if (!res.ok) {
      log(op, { duration, success: false, error: res.error });
      return { success: false, status: "error", message: "Connection failed", rawResponse: res.error };
    }

    if (isUnknownRequest(res.text)) {
      log(op, { duration, success: false, note: "unknown_request", raw: res.text });
      return { success: false, status: "unknown_request", message: "Import not accepted", rawResponse: res.text };
    }

    const counts = parseImportResponse(res.text);
    const ok = counts.created > 0 || counts.altered > 0;
    log(op, { duration, success: ok, ...counts });
    return {
      success: ok,
      status: ok ? "created" : "not_created",
      message: ok
        ? `Ledger created (created=${counts.created}, altered=${counts.altered})`
        : `Tally processed but nothing created (errors=${counts.errors}, exceptions=${counts.exceptions}). Check if ledger already exists or parent group is valid.`,
      rawResponse: res.text,
    };
  }

  async readLedger(ledgerName: string): Promise<PResult> {
    const op = "readLedger";
    const start = Date.now();
    const xml = buildExportListAccountsXml();
    const res = await doPost(xml);
    const duration = Date.now() - start;
    if (!res.ok) {
      log(op, { duration, success: false, error: res.error });
      return { success: false, status: "error", message: "Connection failed", rawResponse: res.error };
    }

    if (isUnknownRequest(res.text)) {
      log(op, { duration, success: false, note: "unknown_request", raw: res.text });
      return { success: false, status: "unknown_request", message: "Export not accepted", rawResponse: res.text };
    }

    if (isLineError(res.text)) {
      const err = extractLineError(res.text);
      log(op, { duration, success: false, note: "line_error", error: err });
      return { success: false, status: "line_error", message: `Tally error: ${err}`, rawResponse: res.text };
    }

    // Attempt to find ledger by name in response
    const found = res.text.includes(ledgerName);
    log(op, { duration, success: true, found });
    return {
      success: true,
      status: found ? "found" : "not_found",
      message: found ? `Ledger '${ledgerName}' found` : `Ledger '${ledgerName}' not present in accounts list`,
      rawResponse: res.text,
    };
  }

  async updateLedger(ledgerName: string, parent = "Sundry Debtors"): Promise<PResult> {
    const op = "updateLedger";
    const start = Date.now();
    // Tally treats import of existing name as an update
    const xml = buildImportLedgerXml(ledgerName, parent);
    const res = await doPost(xml);
    const duration = Date.now() - start;
    if (!res.ok) {
      log(op, { duration, success: false, error: res.error });
      return { success: false, status: "error", message: "Connection failed", rawResponse: res.error };
    }

    if (isUnknownRequest(res.text)) {
      log(op, { duration, success: false, note: "unknown_request", raw: res.text });
      return { success: false, status: "unknown_request", message: "Update not accepted", rawResponse: res.text };
    }

    const counts = parseImportResponse(res.text);
    const ok = counts.created > 0 || counts.altered > 0;
    log(op, { duration, success: ok, ...counts });
    return {
      success: ok,
      status: ok ? "updated" : "not_updated",
      message: ok
        ? `Ledger updated (created=${counts.created}, altered=${counts.altered})`
        : `Tally processed but nothing changed (errors=${counts.errors}, exceptions=${counts.exceptions})`,
      rawResponse: res.text,
    };
  }

  async deleteLedger(ledgerName: string): Promise<PResult> {
    const op = "deleteLedger";
    const start = Date.now();
    const xml = buildInactivateLedgerXml(ledgerName);
    const res = await doPost(xml);
    const duration = Date.now() - start;
    if (!res.ok) {
      log(op, { duration, success: false, error: res.error });
      return { success: false, status: "error", message: "Connection failed", rawResponse: res.error };
    }

    if (isUnknownRequest(res.text)) {
      log(op, { duration, success: false, note: "unknown_request", raw: res.text });
      return { success: false, status: "unknown_request", message: "Delete/inactivate not accepted", rawResponse: res.text };
    }

    const counts = parseImportResponse(res.text);
    const ok = counts.altered > 0;
    log(op, { duration, success: ok, ...counts });
    return {
      success: ok,
      status: ok ? "inactivated" : "not_found",
      message: ok
        ? "Ledger marked inactive (soft delete)"
        : `Nothing changed — ledger may not exist (errors=${counts.errors}, exceptions=${counts.exceptions})`,
      rawResponse: res.text,
    };
  }
}
