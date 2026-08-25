import readline from "readline";
import { TallyClient } from "../tally/tally-client";
import { parseXml } from "../tally/xml-parser";

const TEST_LEDGER = "POC_TEST_LEDGER";

// ── ANSI helpers ────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
  bgGreen: "\x1b[42m",
  bgRed: "\x1b[41m",
  bgCyan: "\x1b[46m",
};

const ok = (msg: string) => console.log(`  ${c.green}✔${c.reset} ${msg}`);
const fail = (msg: string) => console.log(`  ${c.red}✘${c.reset} ${msg}`);
const info = (msg: string) => console.log(`  ${c.cyan}ℹ${c.reset} ${msg}`);
const warn = (msg: string) => console.log(`  ${c.yellow}⚠${c.reset} ${msg}`);
const heading = (msg: string) =>
  console.log(`\n  ${c.bold}${c.cyan}${msg}${c.reset}`);
const divider = () =>
  console.log(`  ${c.dim}${"─".repeat(50)}${c.reset}`);
const blank = () => console.log();

// ── Pretty-print helpers ────────────────────────────────────────────

/** Print a simple key-value table from an object */
function printTable(rows: [string, string][]) {
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  for (const [key, val] of rows) {
    console.log(
      `  ${c.dim}│${c.reset} ${c.bold}${key.padEnd(maxKey)}${c.reset}  ${val}`
    );
  }
}

/** Extract account/ledger names from the List of Accounts XML response */
function extractAccounts(rawXml: string): { name: string; parent: string }[] {
  const parsed = parseXml(rawXml);
  if (!parsed.success) return [];

  const accounts: { name: string; parent: string }[] = [];

  function walk(obj: any) {
    if (!obj || typeof obj !== "object") return;

    // Tally returns DSPACCNAME > DSPDISPNAME pairs
    if (obj["DSPDISPNAME"] && typeof obj["DSPDISPNAME"] === "string") {
      accounts.push({ name: obj["DSPDISPNAME"], parent: "" });
    }

    // Also look for LEDGER entries with NAME attributes
    if (obj["@_NAME"] && typeof obj["@_NAME"] === "string") {
      const parent =
        typeof obj["PARENT"] === "string" ? obj["PARENT"] : "";
      accounts.push({ name: obj["@_NAME"], parent });
    }

    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (Array.isArray(val)) {
        val.forEach(walk);
      } else if (typeof val === "object") {
        walk(val);
      }
    }
  }

  walk(parsed.data);

  // Deduplicate by name
  const seen = new Set<string>();
  return accounts.filter((a) => {
    if (seen.has(a.name)) return false;
    seen.add(a.name);
    return true;
  });
}

/** Extract balance sheet items from the Balance Sheet XML response */
function extractBalanceSheet(
  rawXml: string
): { group: string; amount: string }[] {
  const parsed = parseXml(rawXml);
  if (!parsed.success) return [];

  const items: { group: string; amount: string }[] = [];

  function walk(obj: any) {
    if (!obj || typeof obj !== "object") return;

    if (obj["DSPDISPNAME"] && typeof obj["DSPDISPNAME"] === "string") {
      items.push({ group: obj["DSPDISPNAME"], amount: "" });
    }

    if (obj["BSMAINAMT"] && typeof obj["BSMAINAMT"] === "string") {
      if (items.length > 0) {
        items[items.length - 1].amount = obj["BSMAINAMT"].trim();
      }
    }

    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (Array.isArray(val)) {
        val.forEach(walk);
      } else if (typeof val === "object") {
        walk(val);
      }
    }
  }

  walk(parsed.data);
  return items;
}

/** Format a duration in ms into a human-readable string */
function fmtDuration(start: number) {
  const ms = Date.now() - start;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ── Menu ────────────────────────────────────────────────────────────

export async function ledgerMenu() {
  const client = new TallyClient();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  function question(q: string) {
    return new Promise<string>((resolve) => rl.question(q, resolve));
  }

  // Header
  console.log(blank());
  console.log(
    `  ${c.bgCyan}${c.bold} TallyPrime Local Agent ${c.reset}  ${c.dim}Phase 1 POC${c.reset}`
  );
  console.log(
    `  ${c.dim}Connecting to Tally at 127.0.0.1:9000${c.reset}`
  );

  while (true) {
    blank();
    divider();
    console.log(
      `  ${c.bold}${c.white}MAIN MENU${c.reset}`
    );
    divider();
    console.log(
      `  ${c.cyan}[1]${c.reset} Test connection`
    );
    console.log(
      `  ${c.cyan}[2]${c.reset} List all accounts & ledgers`
    );
    console.log(
      `  ${c.cyan}[3]${c.reset} Find test ledger ${c.dim}("${TEST_LEDGER}")${c.reset}`
    );
    console.log(
      `  ${c.cyan}[4]${c.reset} Create test ledger`
    );
    console.log(
      `  ${c.cyan}[5]${c.reset} Update test ledger`
    );
    console.log(
      `  ${c.cyan}[6]${c.reset} Delete test ledger ${c.dim}(mark inactive)${c.reset}`
    );
    divider();
    console.log(
      `  ${c.magenta}[7]${c.reset} Export Balance Sheet`
    );
    console.log(
      `  ${c.magenta}[8]${c.reset} Export Trial Balance`
    );
    console.log(
      `  ${c.magenta}[9]${c.reset} Probe all export report names`
    );
    divider();
    console.log(
      `  ${c.red}[0]${c.reset} Exit`
    );
    divider();

    const ans = await question(`\n  ${c.bold}Select>${c.reset} `);
    if (!ans) continue;
    const choice = ans.trim();

    try {
      // ── 1. Test connection ──────────────────────────────────────
      if (choice === "1") {
        heading("Testing connection...");
        const t = Date.now();
        const res = await client.checkConnection();
        if (res.success) {
          ok(`Connected to TallyPrime ${c.dim}(${fmtDuration(t)})${c.reset}`);
        } else {
          fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
        }

        // ── 2. List accounts ────────────────────────────────────────
      } else if (choice === "2") {
        heading("Fetching accounts & ledgers...");
        const t = Date.now();
        const res = await client.listAccounts();
        if (res.success && res.rawResponse) {
          const accounts = extractAccounts(res.rawResponse);
          if (accounts.length === 0) {
            warn(
              `Tally responded but no accounts found in the parsed data ${c.dim}(${fmtDuration(t)})${c.reset}`
            );
            info("Your company may be empty. Try creating a ledger first.");
          } else {
            ok(
              `Found ${c.bold}${accounts.length}${c.reset} accounts ${c.dim}(${fmtDuration(t)})${c.reset}`
            );
            blank();
            const maxName = Math.max(
              ...accounts.map((a) => a.name.length),
              4
            );
            console.log(
              `  ${c.bold}${"#".padEnd(4)} ${"Account Name".padEnd(maxName)}  Parent Group${c.reset}`
            );
            console.log(`  ${c.dim}${"─".repeat(maxName + 20)}${c.reset}`);
            accounts.forEach((a, i) => {
              const num = String(i + 1).padEnd(4);
              console.log(
                `  ${c.dim}${num}${c.reset} ${a.name.padEnd(maxName)}  ${c.dim}${a.parent || "—"}${c.reset}`
              );
            });
          }
        } else {
          fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
        }

        // ── 3. Read test ledger ─────────────────────────────────────
      } else if (choice === "3") {
        heading(`Searching for "${TEST_LEDGER}"...`);
        const t = Date.now();
        const res = await client.readLedger(TEST_LEDGER);
        if (res.status === "found") {
          ok(
            `Ledger ${c.bold}"${TEST_LEDGER}"${c.reset} exists in Tally ${c.dim}(${fmtDuration(t)})${c.reset}`
          );
        } else if (res.status === "not_found") {
          warn(
            `Ledger "${TEST_LEDGER}" not found ${c.dim}(${fmtDuration(t)})${c.reset}`
          );
          info(`Use option ${c.cyan}[4]${c.reset} to create it.`);
        } else {
          fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
        }

        // ── 4. Create test ledger ───────────────────────────────────
      } else if (choice === "4") {
        heading(`Creating ledger "${TEST_LEDGER}"...`);
        const t = Date.now();
        const res = await client.createLedger(TEST_LEDGER);
        if (res.success) {
          ok(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
        } else {
          fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
          if (res.rawResponse) {
            info(`Tip: The ledger may already exist, or the parent group "Sundry Debtors" might not be valid in your company.`);
          }
        }

        // ── 5. Update test ledger ───────────────────────────────────
      } else if (choice === "5") {
        heading(`Updating ledger "${TEST_LEDGER}"...`);
        const t = Date.now();
        const res = await client.updateLedger(TEST_LEDGER);
        if (res.success) {
          ok(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
        } else {
          fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
        }

        // ── 6. Delete (inactivate) test ledger ──────────────────────
      } else if (choice === "6") {
        heading(`Soft-deleting ledger "${TEST_LEDGER}"...`);
        const t = Date.now();
        const res = await client.deleteLedger(TEST_LEDGER);
        if (res.success) {
          ok(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
        } else {
          fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
        }

        // ── 7. Balance Sheet ────────────────────────────────────────
      } else if (choice === "7") {
        heading("Exporting Balance Sheet...");
        const t = Date.now();
        const res = await client.getBalanceSheet();
        if (res.success && res.rawResponse) {
          const items = extractBalanceSheet(res.rawResponse);
          if (items.length === 0) {
            ok(
              `Balance Sheet is empty ${c.dim}(new company, no transactions)${c.reset}`
            );
          } else {
            ok(
              `Balance Sheet ${c.dim}(${fmtDuration(t)})${c.reset}`
            );
            blank();
            const maxGroup = Math.max(...items.map((i) => i.group.length), 5);
            console.log(
              `  ${c.bold}${"Group".padEnd(maxGroup)}  Amount${c.reset}`
            );
            console.log(`  ${c.dim}${"─".repeat(maxGroup + 15)}${c.reset}`);
            for (const item of items) {
              console.log(
                `  ${item.group.padEnd(maxGroup)}  ${c.cyan}${item.amount || "—"}${c.reset}`
              );
            }
          }
        } else {
          fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
        }

        // ── 8. Trial Balance ────────────────────────────────────────
      } else if (choice === "8") {
        heading("Exporting Trial Balance...");
        const t = Date.now();
        const res = await client.getTrialBalance();
        if (res.success && res.rawResponse) {
          if (
            res.rawResponse.trim() === "<ENVELOPE></ENVELOPE>" ||
            res.rawResponse.trim() ===
              "<ENVELOPE>\r\n</ENVELOPE>"
          ) {
            ok(
              `Trial Balance is empty ${c.dim}(new company, no transactions)${c.reset}`
            );
          } else {
            ok(`Trial Balance ${c.dim}(${fmtDuration(t)})${c.reset}`);
            // Show raw in a readable way
            const parsed = parseXml(res.rawResponse);
            if (parsed.success) {
              console.log(
                JSON.stringify(parsed.data, null, 2)
                  .split("\n")
                  .map((l) => `  ${c.dim}${l}${c.reset}`)
                  .join("\n")
              );
            }
          }
        } else {
          fail(`${res.message} ${c.dim}(${fmtDuration(t)})${c.reset}`);
        }

        // ── 9. Probe export variants ────────────────────────────────
      } else if (choice === "9") {
        heading("Probing export report names...");
        const t = Date.now();
        const res = await client.probeExportVariants();
        blank();
        const maxName = Math.max(...res.map((r) => r.name.length), 4);
        console.log(
          `  ${c.bold}${"Report Name".padEnd(maxName)}  Status${c.reset}`
        );
        console.log(`  ${c.dim}${"─".repeat(maxName + 20)}${c.reset}`);
        for (const r of res) {
          const icon = r.success ? `${c.green}✔` : `${c.red}✘`;
          const status = r.success
            ? `${c.green}OK${c.reset}`
            : `${c.dim}${r.status}${c.reset}`;
          console.log(
            `  ${icon}${c.reset} ${r.name.padEnd(maxName)}  ${status}`
          );
        }
        blank();
        info(`Completed in ${fmtDuration(t)}`);

        // ── 0. Exit ─────────────────────────────────────────────────
      } else if (choice === "0") {
        blank();
        info("Goodbye!");
        blank();
        break;
      } else {
        warn("Unknown option. Please enter a number from the menu.");
      }
    } catch (err) {
      fail(`Unhandled error: ${(err as Error).message}`);
    }
  }

  rl.close();
}
