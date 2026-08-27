import { useEffect, useMemo, useState } from "react";

const demoGroups = [
  "Sundry Debtors",
  "Sundry Creditors",
  "Cash-in-hand",
  "Bank Accounts",
  "Sales Accounts",
  "Purchase Accounts",
  "Capital Account",
];

const demoLedgers = [
  { name: "Cash", group: "Cash-in-hand", openingBalance: 0 },
  { name: "Bank", group: "Bank Accounts", openingBalance: 0 },
  { name: "Acme Traders", group: "Sundry Debtors", openingBalance: 0 },
  { name: "Office Supplies", group: "Purchase Accounts", openingBalance: 0 },
  { name: "Sales Revenue", group: "Sales Accounts", openingBalance: 0 },
];

function normalizeGroupNames(input, fallback = demoGroups) {
  if (!Array.isArray(input) || !input.length) return fallback;
  return input
    .map((group) => {
      if (typeof group === "string") return group;
      if (group && typeof group.name === "string") return group.name;
      return "";
    })
    .filter(Boolean);
}

function formatLabel(value) {
  if (!value) return "--";
  return new Date(value).toLocaleTimeString();
}

function StatusBadge({ label, ok, value }) {
  return (
    <div className={`badge ${ok ? "success" : "error"}`}>
      <div className='label'>{label}</div>
      <div className='value'>{value}</div>
    </div>
  );
}

function ActivityLog({ logs }) {
  return (
    <div className='card log-panel'>
      <h2 className='section-title'>Activity Log</h2>
      <div>
        {logs.map((item, idx) => (
          <div key={`${item.time}-${idx}`} className='log-item'>
            <div>
              <strong>{item.time}</strong>
            </div>
            <div>{item.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LedgerTable({ ledgers, onEdit, onDelete }) {
  return (
    <div className='table-wrap' style={{ marginTop: "16px" }}>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Group</th>
            <th>Opening Balance</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {ledgers.map((ledger) => (
            <tr key={ledger.name}>
              <td>{ledger.name}</td>
              <td>{ledger.group || "—"}</td>
              <td>{ledger.openingBalance || 0}</td>
              <td>
                <div className='row-actions'>
                  <button
                    type='button'
                    className='tiny-button'
                    onClick={() => onEdit(ledger)}
                  >
                    Edit
                  </button>
                  <button
                    type='button'
                    className='tiny-button danger'
                    onClick={() => onDelete(ledger.name)}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VoucherTable({ vouchers }) {
  return (
    <div className='table-wrap' style={{ marginTop: "16px" }}>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Party</th>
            <th>Narration</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {vouchers.slice(0, 20).map((voucher, idx) => (
            <tr
              key={`${voucher.date}-${voucher.partyLedger || voucher.party}-${idx}`}
            >
              <td>{voucher.date || "—"}</td>
              <td>{voucher.party || voucher.partyLedger || "—"}</td>
              <td>{voucher.narration || "—"}</td>
              <td>{voucher.amount || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState({
    agentRunning: false,
    tallyReachable: false,
    lastActivity: null,
  });
  const [groups, setGroups] = useState(demoGroups);
  const [ledgers, setLedgers] = useState(demoLedgers);
  const [vouchers, setVouchers] = useState([]);
  const [logs, setLogs] = useState([
    {
      time: new Date().toLocaleTimeString(),
      text: "Demo defaults loaded for a fresh Tally company",
    },
  ]);
  const [ledgerDraft, setLedgerDraft] = useState({
    name: "",
    group: demoGroups[0],
    openingBalance: 0,
  });
  const [voucherDraft, setVoucherDraft] = useState({
    partyLedger: demoLedgers[0]?.name || "Cash",
    amount: 0,
    date: new Date().toISOString().split("T")[0],
    narration: "On account of sales",
  });
  const [editingLedger, setEditingLedger] = useState(null);
  const [toastMessage, setToastMessage] = useState("");

  const selectedGroupOptions = useMemo(
    () => normalizeGroupNames(groups, demoGroups),
    [groups],
  );
  const selectedLedgerOptions = useMemo(
    () => (ledgers.length ? ledgers : demoLedgers),
    [ledgers],
  );

  const addLog = (text) => {
    const entry = { time: new Date().toLocaleTimeString(), text };
    setLogs((current) => [entry, ...current].slice(0, 40));
  };

  const showResultToast = (data) => {
    if (!data) return;
    if (data.error) {
      showToast(data.error, true);
      return;
    }
    if (data.message) {
      showToast(data.message);
    }
  };

  const showToast = (text, isError = false) => {
    setToastMessage(text);
    const toastEl = document.getElementById("toast");
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.toggle("error", isError);
    toastEl.style.display = "block";
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toastEl.style.display = "none";
    }, 3500);
  };

  const fetchStatus = async () => {
    try {
      const response = await fetch("/api/status");
      const data = await response.json();
      setStatus({
        agentRunning: !!data.agentRunning,
        tallyReachable: !!data.tallyReachable,
        lastActivity: data.lastActivity || null,
      });
    } catch (error) {
      setStatus({
        agentRunning: false,
        tallyReachable: false,
        lastActivity: null,
      });
    }
  };

  const fetchData = async () => {
    try {
      const response = await fetch("/api/data");
      const data = await response.json();
      const nextGroups = normalizeGroupNames(data.groups, demoGroups);
      const nextLedgers =
        Array.isArray(data.ledgers) && data.ledgers.length
          ? data.ledgers
          : demoLedgers;
      setGroups(nextGroups);
      setLedgers(nextLedgers);
      setVouchers(Array.isArray(data.vouchers) ? data.vouchers : []);
      setLogs(Array.isArray(data.logs) && data.logs.length ? data.logs : logs);
      if (nextLedgers.length && !voucherDraft.partyLedger) {
        setVoucherDraft((current) => ({
          ...current,
          partyLedger: nextLedgers[0].name,
        }));
      }
    } catch (error) {
      setGroups(demoGroups);
      setLedgers(demoLedgers);
    }
  };

  const refreshAll = async () => {
    addLog("Refreshing Tally data from the agent");
    try {
      await fetch("/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_tally_state" }),
      });
    } catch (error) {
      showToast("Refresh failed: " + error.message, true);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchData();

    const eventSource = new EventSource("/events");
    eventSource.addEventListener("status", (event) => {
      const data = JSON.parse(event.data);
      setStatus({
        agentRunning: !!data.agentConnected,
        tallyReachable: !!data.tallyReachable,
        lastActivity: data.lastActivity || null,
      });
    });

    eventSource.addEventListener("result", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.message) addLog(data.message);
        showResultToast(data);
      } catch (error) {
        // ignore invalid stream payloads
      }
    });

    eventSource.addEventListener("log", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.text) addLog(data.text);
      } catch (error) {
        // ignore invalid stream payloads
      }
    });

    const interval = setInterval(fetchStatus, 4000);
    const refreshTimer = setInterval(refreshAll, 15000);

    return () => {
      eventSource.close();
      clearInterval(interval);
      clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    if (!selectedLedgerOptions.length) return;
    setVoucherDraft((current) => ({
      ...current,
      partyLedger: current.partyLedger || selectedLedgerOptions[0].name,
    }));
  }, [selectedLedgerOptions]);

  const handleLedgerSubmit = async (event) => {
    event.preventDefault();
    const action = editingLedger ? "update_ledger" : "create_ledger";
    const payload = editingLedger
      ? {
          name: editingLedger.name,
          newName: ledgerDraft.name,
          parent: ledgerDraft.group,
          openingBalance: Number(ledgerDraft.openingBalance || 0),
        }
      : {
          name: ledgerDraft.name,
          parent: ledgerDraft.group,
          openingBalance: Number(ledgerDraft.openingBalance || 0),
        };

    try {
      const response = await fetch("/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(body.error || "Ledger action failed", true);
        return;
      }
      addLog(
        `Queued ${action} for ${ledgerDraft.name}; waiting for Tally confirmation`,
      );
      setLedgerDraft({
        name: "",
        group: selectedGroupOptions[0] || demoGroups[0],
        openingBalance: 0,
      });
      setEditingLedger(null);
      refreshAll();
    } catch (error) {
      showToast("Ledger update failed: " + error.message, true);
    }
  };

  const handleVoucherSubmit = async (event) => {
    event.preventDefault();
    try {
      const response = await fetch("/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_voucher",
          payload: {
            partyLedger: voucherDraft.partyLedger,
            amount: Number(voucherDraft.amount || 0),
            date: voucherDraft.date,
            narration: voucherDraft.narration,
          },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(body.error || "Voucher creation failed", true);
        return;
      }
      addLog(
        `Voucher request queued for ${voucherDraft.partyLedger}; waiting for Tally confirmation`,
      );
      setVoucherDraft((current) => ({
        ...current,
        amount: 0,
        narration: "On account of sales",
      }));
      refreshAll();
    } catch (error) {
      showToast("Voucher creation failed: " + error.message, true);
    }
  };

  const handleDeleteLedger = async (name) => {
    try {
      const response = await fetch("/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_ledger", payload: { name } }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(body.error || "Delete failed", true);
        return;
      }
      addLog(
        `Delete request queued for ledger ${name}; waiting for Tally confirmation`,
      );
      refreshAll();
    } catch (error) {
      showToast("Delete failed: " + error.message, true);
    }
  };

  const handleEditLedger = (ledger) => {
    setEditingLedger(ledger);
    setLedgerDraft({
      name: ledger.name,
      group: ledger.group || selectedGroupOptions[0] || demoGroups[0],
      openingBalance: ledger.openingBalance || 0,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className='container'>
      <div className='topbar'>
        <div className='title-wrap'>
          <h1>Tally Bridge Demo</h1>
          <small>Local agent + middleware + TallyPrime</small>
        </div>
        <button type='button' className='secondary' onClick={refreshAll}>
          Refresh data
        </button>
      </div>

      <div className='status-strip'>
        <StatusBadge
          label='Agent'
          ok={status.agentRunning}
          value={status.agentRunning ? "Connected" : "Disconnected"}
        />
        <StatusBadge
          label='Tally'
          ok={status.tallyReachable}
          value={status.tallyReachable ? "Connected" : "Not running"}
        />
        <StatusBadge
          label='Last Sync'
          ok={!!status.lastActivity}
          value={formatLabel(status.lastActivity)}
        />
      </div>

      <div className='layout'>
        <div>
          <div className='card' style={{ marginBottom: "24px" }}>
            <h2 className='section-title'>Ledgers</h2>
            <form onSubmit={handleLedgerSubmit}>
              <div className='grid-2'>
                <div>
                  <label htmlFor='ledgerName'>Ledger Name</label>
                  <input
                    id='ledgerName'
                    value={ledgerDraft.name}
                    onChange={(event) =>
                      setLedgerDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div>
                  <label htmlFor='ledgerParent'>Parent Group</label>
                  <select
                    id='ledgerParent'
                    value={ledgerDraft.group}
                    onChange={(event) =>
                      setLedgerDraft((current) => ({
                        ...current,
                        group: event.target.value,
                      }))
                    }
                  >
                    {selectedGroupOptions.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor='ledgerOpeningBalance'>Opening Balance</label>
                  <input
                    id='ledgerOpeningBalance'
                    type='number'
                    min='0'
                    step='0.01'
                    value={ledgerDraft.openingBalance}
                    onChange={(event) =>
                      setLedgerDraft((current) => ({
                        ...current,
                        openingBalance: event.target.value,
                      }))
                    }
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button type='submit'>
                    {editingLedger ? "Update Ledger" : "Save Ledger"}
                  </button>
                </div>
              </div>
            </form>
            <LedgerTable
              ledgers={selectedLedgerOptions}
              onEdit={handleEditLedger}
              onDelete={handleDeleteLedger}
            />
          </div>

          <div className='card'>
            <h2 className='section-title'>Sales Vouchers</h2>
            <form onSubmit={handleVoucherSubmit}>
              <div className='grid-2'>
                <div>
                  <label htmlFor='voucherParty'>Party Ledger</label>
                  <select
                    id='voucherParty'
                    value={voucherDraft.partyLedger}
                    onChange={(event) =>
                      setVoucherDraft((current) => ({
                        ...current,
                        partyLedger: event.target.value,
                      }))
                    }
                  >
                    {selectedLedgerOptions.map((ledger) => (
                      <option key={ledger.name} value={ledger.name}>
                        {ledger.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor='voucherAmount'>Amount</label>
                  <input
                    id='voucherAmount'
                    type='number'
                    min='0'
                    step='0.01'
                    value={voucherDraft.amount}
                    onChange={(event) =>
                      setVoucherDraft((current) => ({
                        ...current,
                        amount: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div>
                  <label htmlFor='voucherDate'>Date</label>
                  <input
                    id='voucherDate'
                    type='date'
                    value={voucherDraft.date}
                    onChange={(event) =>
                      setVoucherDraft((current) => ({
                        ...current,
                        date: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div>
                  <label htmlFor='voucherNarration'>Narration</label>
                  <input
                    id='voucherNarration'
                    type='text'
                    value={voucherDraft.narration}
                    placeholder='On account of sales'
                    onChange={(event) =>
                      setVoucherDraft((current) => ({
                        ...current,
                        narration: event.target.value,
                      }))
                    }
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <button type='submit'>Create Voucher</button>
                </div>
              </div>
            </form>
            <VoucherTable vouchers={vouchers} />
          </div>
        </div>

        <ActivityLog logs={logs} />
      </div>

      <div
        id='toast'
        className='toast'
        style={{ display: toastMessage ? "block" : "none" }}
      >
        {toastMessage}
      </div>
    </div>
  );
}
