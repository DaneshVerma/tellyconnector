import readline from "readline";
import { TallyClient } from "../tally/tally-client";
import { parseXml } from "../tally/xml-parser";

// ── ANSI colors ─────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", magenta: "\x1b[35m", white: "\x1b[37m", blue: "\x1b[34m",
  bgCyan: "\x1b[46m", bgGreen: "\x1b[42m", bgYellow: "\x1b[43m", bgRed: "\x1b[41m",
};

const ok = (m: string) => console.log(`  ${c.green}✔${c.reset} ${m}`);
const fail = (m: string) => console.log(`  ${c.red}✘${c.reset} ${m}`);
const info = (m: string) => console.log(`  ${c.cyan}ℹ${c.reset} ${m}`);
const warn = (m: string) => console.log(`  ${c.yellow}⚠${c.reset} ${m}`);
const heading = (m: string) => console.log(`\n  ${c.bold}${c.cyan}${m}${c.reset}`);
const divider = () => console.log(`  ${c.dim}${"─".repeat(56)}${c.reset}`);
const blank = () => console.log();

function fmtDuration(start: number) {
  const ms = Date.now() - start;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ── XML data extractors ─────────────────────────────────────────────

function extractAccounts(rawXml: string): { name: string; parent: string }[] {
  const parsed = parseXml(rawXml);
  if (!parsed.success) return [];
  const accs: { name: string; parent: string }[] = [];
  function walk(obj: any) {
    if (!obj || typeof obj !== "object") return;
    if (obj["DSPDISPNAME"] && typeof obj["DSPDISPNAME"] === "string") {
      accs.push({ name: obj["DSPDISPNAME"], parent: "" });
    }
    if (obj["@_NAME"] && typeof obj["@_NAME"] === "string") {
      accs.push({ name: obj["@_NAME"], parent: typeof obj["PARENT"] === "string" ? obj["PARENT"] : "" });
    }
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === "object") walk(v);
    }
  }
  walk(parsed.data);
  const seen = new Set<string>();
  return accs.filter((a) => { if (seen.has(a.name)) return false; seen.add(a.name); return true; });
}

function extractBalanceSheet(rawXml: string): { group: string; amount: string }[] {
  const parsed = parseXml(rawXml);
  if (!parsed.success) return [];
  const items: { group: string; amount: string }[] = [];
  function walk(obj: any) {
    if (!obj || typeof obj !== "object") return;
    if (obj["DSPDISPNAME"] && typeof obj["DSPDISPNAME"] === "string") {
      items.push({ group: obj["DSPDISPNAME"], amount: "" });
    }
    if (obj["BSMAINAMT"] && typeof obj["BSMAINAMT"] === "string" && items.length > 0) {
      items[items.length - 1].amount = obj["BSMAINAMT"].trim();
    }
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === "object") walk(v);
    }
  }
  walk(parsed.data);
  return items;
}

function isEmptyEnvelope(raw?: string) {
  if (!raw) return true;
  const t = raw.trim();
  return t === "<ENVELOPE></ENVELOPE>" || t === "<ENVELOPE>\r\n</ENVELOPE>" || t.length < 30;
}

// ── Menu renderer ───────────────────────────────────────────────────

function showMenu() {
  blank();
  divider();
  console.log(`  ${c.bold}${c.white}  TALLYPRIME LOCAL AGENT${c.reset}  ${c.dim}— Interactive CLI${c.reset}`);
  divider();
  blank();
  console.log(`  ${c.bold}${c.cyan}CONNECTION${c.reset}`);
  console.log(`    ${c.cyan}1${c.reset}  Test connection`);
  blank();
  console.log(`  ${c.bold}${c.green}CREATE (Masters)${c.reset}`);
  console.log(`    ${c.green}2${c.reset}  Create a Ledger        ${c.dim}(customer, supplier, expense, etc.)${c.reset}`);
  console.log(`    ${c.green}3${c.reset}  Create a Group         ${c.dim}(categorize ledgers)${c.reset}`);
  console.log(`    ${c.green}4${c.reset}  Create a Stock Item    ${c.dim}(inventory product)${c.reset}`);
  blank();
  console.log(`  ${c.bold}${c.yellow}TRANSACTIONS${c.reset}`);
  console.log(`    ${c.yellow}5${c.reset}  Create a Voucher       ${c.dim}(Sales / Purchase / Receipt / Payment)${c.reset}`);
  blank();
  console.log(`  ${c.bold}${c.magenta}REPORTS (Read)${c.reset}`);
  console.log(`    ${c.magenta}6${c.reset}  List all Accounts & Ledgers`);
  console.log(`    ${c.magenta}7${c.reset}  Balance Sheet`);
  console.log(`    ${c.magenta}8${c.reset}  Profit & Loss`);
  console.log(`    ${c.magenta}9${c.reset}  Day Book               ${c.dim}(recent transactions)${c.reset}`);
  console.log(`    ${c.magenta}10${c.reset} Stock Summary`);
  console.log(`    ${c.magenta}11${c.reset} Trial Balance`);
  blank();
  console.log(`  ${c.bold}${c.blue}DEMO${c.reset}`);
  console.log(`    ${c.blue}99${c.reset} Run full demo          ${c.dim}(auto-creates sample data in Tally)${c.reset}`);
  blank();
  console.log(`  ${c.bold}${c.red}EXIT${c.reset}`);
  console.log(`    ${c.red}0${c.reset}  Quit`);
  divider();
}

// ── Main loop ───────────────────────────────────────────────────────

export async function ledgerMenu() {
  const client = new TallyClient();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));
  const prompt = (label: string, def?: string) =>
    ask(`    ${c.cyan}${label}${def ? ` ${c.dim}(${def})${c.reset}` : ""}${c.cyan}:${c.reset} `).then(
      (v) => v.trim() || def || ""
    );

  // Banner
  blank();
  console.log(`  ${c.bgCyan}${c.bold} TallyPrime Local Agent ${c.reset}  ${c.dim}Phase 1 POC${c.reset}`);
  info(`Connecting to Tally at 127.0.0.1:9000`);

  while (true) {
    showMenu();
    const choice = (await ask(`\n  ${c.bold}Enter choice ▸${c.reset} `)).trim();

    try {
      switch (choice) {

        // ── 1. Test connection ────────────────────────────────────
        case "1": {
          heading("Testing connection...");
          const t = Date.now();
          const res = await client.checkConnection();
          res.success
            ? ok(`TallyPrime is online ${c.dim}(${fmtDuration(t)})${c.reset}`)
            : fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
          break;
        }

        // ── 2. Create Ledger ──────────────────────────────────────
        case "2": {
          heading("Create a new Ledger");
          info("Common parent groups: Sundry Debtors, Sundry Creditors,");
          info("  Sales Accounts, Purchase Accounts, Indirect Expenses,");
          info("  Bank Accounts, Cash-in-Hand, Capital Account");
          blank();
          const name = await prompt("Ledger name");
          if (!name) { warn("Cancelled."); break; }
          const parent = await prompt("Parent group", "Sundry Debtors");
          heading(`Creating ledger "${name}" under "${parent}"...`);
          const t = Date.now();
          const res = await client.createLedger(name, parent);
          res.success
            ? ok(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`)
            : fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
          break;
        }

        // ── 3. Create Group ───────────────────────────────────────
        case "3": {
          heading("Create a new Group");
          info("Groups organize your ledgers. Common parents:");
          info("  Primary, Sundry Debtors, Sundry Creditors,");
          info("  Current Assets, Current Liabilities");
          blank();
          const name = await prompt("Group name");
          if (!name) { warn("Cancelled."); break; }
          const parent = await prompt("Parent group", "Primary");
          heading(`Creating group "${name}" under "${parent}"...`);
          const t = Date.now();
          const res = await client.createGroup(name, parent);
          res.success
            ? ok(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`)
            : fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
          break;
        }

        // ── 4. Create Stock Item ──────────────────────────────────
        case "4": {
          heading("Create a new Stock Item");
          info("Stock Items are inventory/products you buy and sell.");
          blank();
          const name = await prompt("Item name");
          if (!name) { warn("Cancelled."); break; }
          const group = await prompt("Stock group", "Primary");
          const unit = await prompt("Unit of measure", "Nos");
          heading(`Creating stock item "${name}"...`);
          const t = Date.now();
          // Ensure the unit exists first
          await client.createUnit(unit);
          const res = await client.createStockItem(name, group, unit);
          res.success
            ? ok(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`)
            : fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
          break;
        }

        // ── 5. Create Voucher (Transaction) ───────────────────────
        case "5": {
          heading("Create a Voucher (Transaction)");
          blank();
          console.log(`    ${c.yellow}a${c.reset}  Sales       ${c.dim}(you sold something)${c.reset}`);
          console.log(`    ${c.yellow}b${c.reset}  Purchase    ${c.dim}(you bought something)${c.reset}`);
          console.log(`    ${c.yellow}c${c.reset}  Receipt     ${c.dim}(you received money)${c.reset}`);
          console.log(`    ${c.yellow}d${c.reset}  Payment     ${c.dim}(you paid money)${c.reset}`);
          console.log(`    ${c.yellow}e${c.reset}  Journal     ${c.dim}(adjusting entry)${c.reset}`);
          blank();
          const vt = (await prompt("Voucher type (a/b/c/d/e)")).toLowerCase();
          const typeMap: Record<string, string> = { a: "Sales", b: "Purchase", c: "Receipt", d: "Payment", e: "Journal" };
          const voucherType = typeMap[vt];
          if (!voucherType) { warn("Invalid type. Cancelled."); break; }

          const narration = await prompt("Description / narration");
          const amtStr = await prompt("Amount (₹)");
          const amount = Number(amtStr);
          if (!amount || isNaN(amount)) { warn("Invalid amount. Cancelled."); break; }

          let debitLedger = "";
          let creditLedger = "";

          if (voucherType === "Sales") {
            debitLedger = await prompt("Customer / debit ledger", "Cash");
            creditLedger = await prompt("Income / credit ledger", "Sales Account");
          } else if (voucherType === "Purchase") {
            debitLedger = await prompt("Expense / debit ledger", "Purchase Account");
            creditLedger = await prompt("Supplier / credit ledger", "Cash");
          } else if (voucherType === "Receipt") {
            debitLedger = await prompt("Receive into (debit)", "Cash");
            creditLedger = await prompt("From whom (credit)");
          } else if (voucherType === "Payment") {
            debitLedger = await prompt("Pay to (debit)");
            creditLedger = await prompt("Pay from (credit)", "Cash");
          } else {
            debitLedger = await prompt("Debit ledger");
            creditLedger = await prompt("Credit ledger");
          }

          if (!debitLedger || !creditLedger) { warn("Missing ledger names. Cancelled."); break; }

          const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

          heading(`Creating ${voucherType} voucher for ₹${amount.toLocaleString()}...`);
          const t = Date.now();
          const res = await client.createVoucher({
            type: voucherType,
            date: today,
            narration: narration || `${voucherType} entry`,
            partyLedger: voucherType === "Sales" || voucherType === "Purchase" ? debitLedger : undefined,
            entries: [
              { ledger: debitLedger, amount: -amount, isDeemedPositive: true },
              { ledger: creditLedger, amount: amount, isDeemedPositive: false },
            ],
          });
          res.success
            ? ok(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`)
            : fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
          break;
        }

        // ── 6. List Accounts & Ledgers ────────────────────────────
        case "6": {
          heading("Fetching all accounts & ledgers...");
          const t = Date.now();
          const res = await client.listAccounts();
          if (res.success && res.rawResponse) {
            const accs = extractAccounts(res.rawResponse);
            if (accs.length === 0) {
              warn(`No accounts found ${c.dim}(${fmtDuration(t)})${c.reset}`);
              info("Your company may be empty. Try creating ledgers first.");
            } else {
              ok(`Found ${c.bold}${accs.length}${c.reset} accounts ${c.dim}(${fmtDuration(t)})${c.reset}`);
              blank();
              const mw = Math.max(...accs.map((a) => a.name.length), 12);
              console.log(`  ${c.bold}${"#".padEnd(5)}${"Account Name".padEnd(mw + 2)}Parent Group${c.reset}`);
              console.log(`  ${c.dim}${"─".repeat(mw + 25)}${c.reset}`);
              accs.forEach((a, i) => {
                console.log(`  ${c.dim}${String(i + 1).padEnd(5)}${c.reset}${a.name.padEnd(mw + 2)}${c.dim}${a.parent || "—"}${c.reset}`);
              });
            }
          } else {
            fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
          }
          break;
        }

        // ── 7. Balance Sheet ──────────────────────────────────────
        case "7": {
          heading("Exporting Balance Sheet...");
          const t = Date.now();
          const res = await client.getBalanceSheet();
          if (res.success && res.rawResponse) {
            const items = extractBalanceSheet(res.rawResponse);
            if (items.length === 0) {
              ok(`Balance Sheet is empty ${c.dim}(no transactions yet)${c.reset}`);
            } else {
              ok(`Balance Sheet ${c.dim}(${fmtDuration(t)})${c.reset}`);
              blank();
              const mw = Math.max(...items.map((i) => i.group.length), 10);
              console.log(`  ${c.bold}${"Group".padEnd(mw + 2)}Amount${c.reset}`);
              console.log(`  ${c.dim}${"─".repeat(mw + 20)}${c.reset}`);
              for (const i of items) {
                console.log(`  ${i.group.padEnd(mw + 2)}${c.cyan}${i.amount || "—"}${c.reset}`);
              }
            }
          } else { fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`); }
          break;
        }

        // ── 8. Profit & Loss ──────────────────────────────────────
        case "8": {
          heading("Exporting Profit & Loss...");
          const t = Date.now();
          const res = await client.getProfitLoss();
          if (res.success && res.rawResponse) {
            if (isEmptyEnvelope(res.rawResponse)) {
              ok(`Profit & Loss is empty ${c.dim}(no transactions yet)${c.reset}`);
            } else {
              ok(`Profit & Loss ${c.dim}(${fmtDuration(t)})${c.reset}`);
              const parsed = parseXml(res.rawResponse);
              if (parsed.success) {
                const json = JSON.stringify(parsed.data, null, 2);
                const lines = json.split("\n").slice(0, 40);
                lines.forEach((l) => console.log(`  ${c.dim}${l}${c.reset}`));
                if (json.split("\n").length > 40) console.log(`  ${c.dim}... (truncated)${c.reset}`);
              }
            }
          } else { fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`); }
          break;
        }

        // ── 9. Day Book ───────────────────────────────────────────
        case "9": {
          heading("Exporting Day Book (recent transactions)...");
          const t = Date.now();
          const res = await client.getDayBook();
          if (res.success && res.rawResponse) {
            if (isEmptyEnvelope(res.rawResponse)) {
              ok(`Day Book is empty ${c.dim}(no transactions today)${c.reset}`);
            } else {
              ok(`Day Book ${c.dim}(${fmtDuration(t)})${c.reset}`);
              const parsed = parseXml(res.rawResponse);
              if (parsed.success) {
                const json = JSON.stringify(parsed.data, null, 2);
                const lines = json.split("\n").slice(0, 50);
                lines.forEach((l) => console.log(`  ${c.dim}${l}${c.reset}`));
                if (json.split("\n").length > 50) console.log(`  ${c.dim}... (truncated)${c.reset}`);
              }
            }
          } else { fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`); }
          break;
        }

        // ── 10. Stock Summary ─────────────────────────────────────
        case "10": {
          heading("Exporting Stock Summary...");
          const t = Date.now();
          const res = await client.getStockSummary();
          if (res.success && res.rawResponse) {
            if (isEmptyEnvelope(res.rawResponse)) {
              ok(`Stock Summary is empty ${c.dim}(no stock items)${c.reset}`);
            } else {
              ok(`Stock Summary ${c.dim}(${fmtDuration(t)})${c.reset}`);
              const parsed = parseXml(res.rawResponse);
              if (parsed.success) {
                const json = JSON.stringify(parsed.data, null, 2);
                const lines = json.split("\n").slice(0, 40);
                lines.forEach((l) => console.log(`  ${c.dim}${l}${c.reset}`));
                if (json.split("\n").length > 40) console.log(`  ${c.dim}... (truncated)${c.reset}`);
              }
            }
          } else { fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`); }
          break;
        }

        // ── 11. Trial Balance ─────────────────────────────────────
        case "11": {
          heading("Exporting Trial Balance...");
          const t = Date.now();
          const res = await client.getTrialBalance();
          if (res.success && res.rawResponse) {
            if (isEmptyEnvelope(res.rawResponse)) {
              ok(`Trial Balance is empty ${c.dim}(no transactions yet)${c.reset}`);
            } else {
              ok(`Trial Balance ${c.dim}(${fmtDuration(t)})${c.reset}`);
              const parsed = parseXml(res.rawResponse);
              if (parsed.success) {
                const json = JSON.stringify(parsed.data, null, 2);
                const lines = json.split("\n").slice(0, 40);
                lines.forEach((l) => console.log(`  ${c.dim}${l}${c.reset}`));
                if (json.split("\n").length > 40) console.log(`  ${c.dim}... (truncated)${c.reset}`);
              }
            }
          } else { fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`); }
          break;
        }

        // ── 99. Full Demo ─────────────────────────────────────────
        case "99": {
          blank();
          console.log(`  ${c.bgGreen}${c.bold} DEMO MODE ${c.reset}`);
          info("This will create sample data in your Tally company:");
          info("  • 2 ledger groups (Demo Customers, Demo Suppliers)");
          info("  • 4 ledgers (customer, supplier, sales, purchase)");
          info("  • 1 stock item (Demo Widget)");
          info("  • 4 vouchers (purchase, sale, receipt, payment)");
          blank();
          const confirm = await prompt("Proceed? (y/n)", "y");
          if (confirm.toLowerCase() !== "y") { warn("Demo cancelled."); break; }

          heading("Running demo...");
          blank();
          const t = Date.now();

          await client.runDemo((msg, res) => {
            if (res.success) {
              ok(msg);
            } else {
              fail(`${msg}\n      ${c.dim}↳ ${res.message}${c.reset}`);
            }
          });

          blank();
          divider();
          ok(`Demo complete! ${c.dim}(${fmtDuration(t)})${c.reset}`);
          info("Open Tally and check: Gateway of Tally → Day Book");
          info("You should see the transactions created by this demo.");
          info(`Use option ${c.magenta}6${c.reset} to list accounts, ${c.magenta}7${c.reset} for Balance Sheet, ${c.magenta}9${c.reset} for Day Book.`);
          break;
        }

        // ── 0. Exit ───────────────────────────────────────────────
        case "0": {
          blank();
          info("Goodbye! 👋");
          blank();
          rl.close();
          return;
        }

        default:
          warn("Invalid option. Enter a number from the menu.");
      }
    } catch (err) {
      fail(`Error: ${(err as Error).message}`);
    }
  }

  rl.close();
}
