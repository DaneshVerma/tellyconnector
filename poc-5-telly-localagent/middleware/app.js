const { useEffect, useMemo, useState } = React;

const demoGroups = [
    'Sundry Debtors',
    'Sundry Creditors',
    'Cash-in-hand',
    'Bank Accounts',
    'Sales Accounts',
    'Purchase Accounts',
    'Capital Account'
];

const demoLedgers = [
    { name: 'Cash', group: 'Cash-in-hand', openingBalance: 0 },
    { name: 'Bank', group: 'Bank Accounts', openingBalance: 0 },
    { name: 'Acme Traders', group: 'Sundry Debtors', openingBalance: 0 },
    { name: 'Office Supplies', group: 'Purchase Accounts', openingBalance: 0 },
    { name: 'Sales Revenue', group: 'Sales Accounts', openingBalance: 0 }
];

function formatLabel(value) {
    if (!value) return '--';
    return new Date(value).toLocaleTimeString();
}

function StatusBadge({ label, ok, value }) {
    return React.createElement(
        'div',
        { className: 'badge ' + (ok ? 'success' : 'error') },
        React.createElement('div', { className: 'label' }, label),
        React.createElement('div', { className: 'value' }, value)
    );
}

function ActivityLog({ logs }) {
    return React.createElement(
        'div',
        { className: 'card log-panel' },
        React.createElement('h2', { className: 'section-title' }, 'Activity Log'),
        React.createElement(
            'div',
            null,
            logs.map((item, idx) =>
                React.createElement(
                    'div',
                    { key: idx, className: 'log-item' },
                    React.createElement('div', null, React.createElement('strong', null, item.time)),
                    React.createElement('div', null, item.text)
                )
            )
        )
    );
}

function LedgerTable({ ledgers, onEdit, onDelete }) {
    return React.createElement(
        'div',
        { className: 'table-wrap', style: { marginTop: '16px' } },
        React.createElement(
            'table',
            null,
            React.createElement(
                'thead',
                null,
                React.createElement('tr', null,
                    React.createElement('th', null, 'Name'),
                    React.createElement('th', null, 'Group'),
                    React.createElement('th', null, 'Opening Balance'),
                    React.createElement('th', null, 'Actions')
                )
            ),
            React.createElement(
                'tbody',
                null,
                ledgers.map((ledger) =>
                    React.createElement(
                        'tr',
                        { key: ledger.name },
                        React.createElement('td', null, ledger.name),
                        React.createElement('td', null, ledger.group || '—'),
                        React.createElement('td', null, ledger.openingBalance || 0),
                        React.createElement(
                            'td',
                            null,
                            React.createElement('div', { className: 'row-actions' },
                                React.createElement('button', {
                                    type: 'button',
                                    className: 'tiny-button',
                                    onClick: () => onEdit(ledger)
                                }, 'Edit'),
                                React.createElement('button', {
                                    type: 'button',
                                    className: 'tiny-button danger',
                                    onClick: () => onDelete(ledger.name)
                                }, 'Delete')
                            )
                        )
                    )
                )
            )
        )
    );
}

function VoucherTable({ vouchers }) {
    return React.createElement(
        'div',
        { className: 'table-wrap', style: { marginTop: '16px' } },
        React.createElement(
            'table',
            null,
            React.createElement(
                'thead',
                null,
                React.createElement('tr', null,
                    React.createElement('th', null, 'Date'),
                    React.createElement('th', null, 'Party'),
                    React.createElement('th', null, 'Narration'),
                    React.createElement('th', null, 'Amount')
                )
            ),
            React.createElement(
                'tbody',
                null,
                vouchers.slice(0, 20).map((voucher, idx) =>
                    React.createElement(
                        'tr',
                        { key: idx },
                        React.createElement('td', null, voucher.date || '—'),
                        React.createElement('td', null, voucher.party || voucher.partyLedger || '—'),
                        React.createElement('td', null, voucher.narration || '—'),
                        React.createElement('td', null, voucher.amount || 0)
                    )
                )
            )
        )
    );
}

function App() {
    const [status, setStatus] = useState({
        agentRunning: false,
        tallyReachable: false,
        lastActivity: null
    });
    const [groups, setGroups] = useState(demoGroups);
    const [ledgers, setLedgers] = useState(demoLedgers);
    const [vouchers, setVouchers] = useState([]);
    const [logs, setLogs] = useState([
        { time: new Date().toLocaleTimeString(), text: 'Demo defaults loaded for a fresh Tally company' }
    ]);
    const [ledgerDraft, setLedgerDraft] = useState({
        name: '',
        group: demoGroups[0],
        openingBalance: 0
    });
    const [voucherDraft, setVoucherDraft] = useState({
        partyLedger: demoLedgers[0]?.name || 'Cash',
        amount: 0,
        date: new Date().toISOString().split('T')[0],
        narration: 'On account of sales'
    });
    const [editingLedger, setEditingLedger] = useState(null);
    const [toastMessage, setToastMessage] = useState('');

    const selectedGroupOptions = useMemo(() => groups.length ? groups : demoGroups, [groups]);
    const selectedLedgerOptions = useMemo(() => ledgers.length ? ledgers : demoLedgers, [ledgers]);

    const addLog = (text) => {
        const entry = { time: new Date().toLocaleTimeString(), text };
        setLogs((current) => [entry, ...current].slice(0, 40));
    };

    const showToast = (text, isError = false) => {
        setToastMessage(text);
        const toastEl = document.getElementById('toast');
        if (!toastEl) return;
        toastEl.textContent = text;
        toastEl.classList.toggle('error', isError);
        toastEl.style.display = 'block';
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => {
            toastEl.style.display = 'none';
        }, 3500);
    };

    const fetchStatus = async () => {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();
            setStatus({
                agentRunning: !!data.agentRunning,
                tallyReachable: !!data.tallyReachable,
                lastActivity: data.lastActivity || null
            });
        } catch (error) {
            setStatus({ agentRunning: false, tallyReachable: false, lastActivity: null });
        }
    };

    const fetchData = async () => {
        try {
            const response = await fetch('/api/data');
            const data = await response.json();
            const nextGroups = Array.isArray(data.groups) && data.groups.length ? data.groups : demoGroups;
            const nextLedgers = Array.isArray(data.ledgers) && data.ledgers.length ? data.ledgers : demoLedgers;
            setGroups(nextGroups);
            setLedgers(nextLedgers);
            setVouchers(Array.isArray(data.vouchers) ? data.vouchers : []);
            setLogs(Array.isArray(data.logs) && data.logs.length ? data.logs : logs);
            if (nextLedgers.length && !voucherDraft.partyLedger) {
                setVoucherDraft((current) => ({ ...current, partyLedger: nextLedgers[0].name }));
            }
        } catch (error) {
            setGroups(demoGroups);
            setLedgers(demoLedgers);
        }
    };

    const refreshAll = async () => {
        addLog('Refreshing Tally data from the agent');
        try {
            await fetch('/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'sync_tally_state' })
            });
        } catch (error) {
            showToast('Refresh failed: ' + error.message, true);
        }
    };

    useEffect(() => {
        fetchStatus();
        fetchData();

        const eventSource = new EventSource('/events');
        eventSource.addEventListener('status', (event) => {
            const data = JSON.parse(event.data);
            setStatus({
                agentRunning: !!data.agentConnected,
                tallyReachable: !!data.tallyReachable,
                lastActivity: data.lastActivity || null
            });
        });

        eventSource.addEventListener('result', (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data && data.message) addLog(data.message);
                if (data && data.error) showToast(data.error, true);
            } catch (error) {
                // ignore invalid stream payloads
            }
        });

        eventSource.addEventListener('log', (event) => {
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
            partyLedger: current.partyLedger || selectedLedgerOptions[0].name
        }));
    }, [selectedLedgerOptions]);

    const handleLedgerSubmit = async (event) => {
        event.preventDefault();
        const action = editingLedger ? 'update_ledger' : 'create_ledger';
        const payload = editingLedger
            ? {
                name: editingLedger.name,
                newName: ledgerDraft.name,
                parent: ledgerDraft.group,
                openingBalance: Number(ledgerDraft.openingBalance || 0)
            }
            : {
                name: ledgerDraft.name,
                parent: ledgerDraft.group,
                openingBalance: Number(ledgerDraft.openingBalance || 0)
            };

        try {
            const response = await fetch('/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, payload })
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                showToast(body.error || 'Ledger action failed', true);
                return;
            }
            const message = editingLedger ? 'updated' : 'created';
            showToast(`Ledger "${ledgerDraft.name}" ${message} in Tally`);
            addLog(`Sent ${action} to agent for ${ledgerDraft.name}`);
            setLedgerDraft({ name: '', group: selectedGroupOptions[0] || demoGroups[0], openingBalance: 0 });
            setEditingLedger(null);
            refreshAll();
        } catch (error) {
            showToast('Ledger update failed: ' + error.message, true);
        }
    };

    const handleVoucherSubmit = async (event) => {
        event.preventDefault();
        try {
            const response = await fetch('/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_voucher',
                    payload: {
                        partyLedger: voucherDraft.partyLedger,
                        amount: Number(voucherDraft.amount || 0),
                        date: voucherDraft.date,
                        narration: voucherDraft.narration
                    }
                })
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                showToast(body.error || 'Voucher creation failed', true);
                return;
            }
            showToast(`Voucher for ${voucherDraft.partyLedger} created in Tally`);
            addLog(`Voucher created for ${voucherDraft.partyLedger}`);
            setVoucherDraft((current) => ({
                ...current,
                amount: 0,
                narration: 'On account of sales'
            }));
            refreshAll();
        } catch (error) {
            showToast('Voucher creation failed: ' + error.message, true);
        }
    };

    const handleDeleteLedger = async (name) => {
        try {
            const response = await fetch('/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete_ledger', payload: { name } })
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                showToast(body.error || 'Delete failed', true);
                return;
            }
            showToast(`Delete request sent for ${name}`);
            addLog(`Delete request sent for ledger ${name}`);
            refreshAll();
        } catch (error) {
            showToast('Delete failed: ' + error.message, true);
        }
    };

    const handleEditLedger = (ledger) => {
        setEditingLedger(ledger);
        setLedgerDraft({
            name: ledger.name,
            group: ledger.group || selectedGroupOptions[0] || demoGroups[0],
            openingBalance: ledger.openingBalance || 0
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const ledgerFormMarkup = React.createElement(
        'form',
        { onSubmit: handleLedgerSubmit },
        React.createElement('div', { className: 'grid-2' },
            React.createElement('div', null,
                React.createElement('label', { htmlFor: 'ledgerName' }, 'Ledger Name'),
                React.createElement('input', {
                    id: 'ledgerName',
                    value: ledgerDraft.name,
                    onChange: (event) => setLedgerDraft((current) => ({ ...current, name: event.target.value })),
                    required: true
                })
            ),
            React.createElement('div', null,
                React.createElement('label', { htmlFor: 'ledgerParent' }, 'Parent Group'),
                React.createElement('select', {
                    id: 'ledgerParent',
                    value: ledgerDraft.group,
                    onChange: (event) => setLedgerDraft((current) => ({ ...current, group: event.target.value }))
                },
                    selectedGroupOptions.map((group) =>
                        React.createElement('option', { key: group, value: group }, group)
                    )
                )
            ),
            React.createElement('div', null,
                React.createElement('label', { htmlFor: 'ledgerOpeningBalance' }, 'Opening Balance'),
                React.createElement('input', {
                    id: 'ledgerOpeningBalance',
                    type: 'number',
                    value: ledgerDraft.openingBalance,
                    min: '0',
                    step: '0.01',
                    onChange: (event) => setLedgerDraft((current) => ({ ...current, openingBalance: event.target.value }))
                })
            ),
            React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end' } },
                React.createElement('button', { type: 'submit' }, editingLedger ? 'Update Ledger' : 'Save Ledger')
            )
        )
    );

    const voucherFormMarkup = React.createElement(
        'form',
        { onSubmit: handleVoucherSubmit },
        React.createElement('div', { className: 'grid-2' },
            React.createElement('div', null,
                React.createElement('label', { htmlFor: 'voucherParty' }, 'Party Ledger'),
                React.createElement('select', {
                    id: 'voucherParty',
                    value: voucherDraft.partyLedger,
                    onChange: (event) => setVoucherDraft((current) => ({ ...current, partyLedger: event.target.value }))
                },
                    selectedLedgerOptions.map((ledger) =>
                        React.createElement('option', { key: ledger.name, value: ledger.name }, ledger.name)
                    )
                )
            ),
            React.createElement('div', null,
                React.createElement('label', { htmlFor: 'voucherAmount' }, 'Amount'),
                React.createElement('input', {
                    id: 'voucherAmount',
                    type: 'number',
                    min: '0',
                    step: '0.01',
                    value: voucherDraft.amount,
                    onChange: (event) => setVoucherDraft((current) => ({ ...current, amount: event.target.value })),
                    required: true
                })
            ),
            React.createElement('div', null,
                React.createElement('label', { htmlFor: 'voucherDate' }, 'Date'),
                React.createElement('input', {
                    id: 'voucherDate',
                    type: 'date',
                    value: voucherDraft.date,
                    onChange: (event) => setVoucherDraft((current) => ({ ...current, date: event.target.value })),
                    required: true
                })
            ),
            React.createElement('div', null,
                React.createElement('label', { htmlFor: 'voucherNarration' }, 'Narration'),
                React.createElement('input', {
                    id: 'voucherNarration',
                    type: 'text',
                    value: voucherDraft.narration,
                    placeholder: 'On account of sales',
                    onChange: (event) => setVoucherDraft((current) => ({ ...current, narration: event.target.value }))
                })
            ),
            React.createElement('div', { style: { gridColumn: '1 / -1' } },
                React.createElement('button', { type: 'submit' }, 'Create Voucher')
            )
        )
    );

    return React.createElement(
        'div',
        { className: 'container' },
        React.createElement(
            'div',
            { className: 'topbar' },
            React.createElement('div', { className: 'title-wrap' },
                React.createElement('h1', null, 'Tally Bridge Demo'),
                React.createElement('small', null, 'Local agent + middleware + TallyPrime')
            ),
            React.createElement('button', { type: 'button', className: 'secondary', onClick: refreshAll }, 'Refresh data')
        ),
        React.createElement(
            'div',
            { className: 'status-strip' },
            React.createElement(StatusBadge, {
                label: 'Agent',
                ok: status.agentRunning,
                value: status.agentRunning ? 'Connected' : 'Disconnected'
            }),
            React.createElement(StatusBadge, {
                label: 'Tally',
                ok: status.tallyReachable,
                value: status.tallyReachable ? 'Connected' : 'Not running'
            }),
            React.createElement(StatusBadge, {
                label: 'Last Sync',
                ok: !!status.lastActivity,
                value: formatLabel(status.lastActivity)
            })
        ),
        React.createElement(
            'div',
            { className: 'layout' },
            React.createElement(
                'div',
                null,
                React.createElement(
                    'div',
                    { className: 'card', style: { marginBottom: '24px' } },
                    React.createElement('h2', { className: 'section-title' }, 'Ledgers'),
                    ledgerFormMarkup,
                    React.createElement(LedgerTable, {
                        ledgers: selectedLedgerOptions,
                        onEdit: handleEditLedger,
                        onDelete: handleDeleteLedger
                    })
                ),
                React.createElement(
                    'div',
                    { className: 'card' },
                    React.createElement('h2', { className: 'section-title' }, 'Sales Vouchers'),
                    voucherFormMarkup,
                    React.createElement(VoucherTable, { vouchers })
                )
            ),
            React.createElement(ActivityLog, { logs })
        ),
        React.createElement('div', {
            id: 'toast',
            className: 'toast',
            style: { display: toastMessage ? 'block' : 'none' }
        }, toastMessage)
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
