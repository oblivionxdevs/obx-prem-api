lucide.createIcons();

const SESSION_KEY = 'oblivionx-premium-session';
const ADMIN_TOKEN_KEY = 'oblivionx-admin-token';

const state = {
    keys: [],
    latestId: null,
    filter: 'all',
    search: ''
};

const elements = {
    adminToken: document.getElementById('adminTokenInput'),
    form: document.getElementById('keyForm'),
    prefix: document.getElementById('prefixInput'),
    quantity: document.getElementById('quantityInput'),
    owner: document.getElementById('ownerInput'),
    tag: document.getElementById('tagInput'),
    redeemForm: document.getElementById('redeemForm'),
    redeemKey: document.getElementById('redeemKeyInput'),
    redeemMessage: document.getElementById('redeemMessage'),
    useLatest: document.getElementById('useLatestBtn'),
    latestKey: document.getElementById('latestKey'),
    latestMeta: document.getElementById('latestMeta'),
    copyLatest: document.getElementById('copyLatestBtn'),
    activeCount: document.getElementById('activeCount'),
    permanentCount: document.getElementById('permanentCount'),
    soonCount: document.getElementById('soonCount'),
    revokedCount: document.getElementById('revokedCount'),
    table: document.getElementById('keysTable'),
    empty: document.getElementById('emptyState'),
    search: document.getElementById('searchInput'),
    statusFilter: document.getElementById('statusFilter'),
    export: document.getElementById('exportBtn'),
    clear: document.getElementById('clearBtn'),
    toast: document.getElementById('toast')
};

elements.adminToken.value = localStorage.getItem(ADMIN_TOKEN_KEY) || '';

elements.adminToken.addEventListener('change', () => {
    localStorage.setItem(ADMIN_TOKEN_KEY, elements.adminToken.value.trim());
    refreshKeys();
});

elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(elements.form);
    const quantity = clamp(Number(elements.quantity.value) || 1, 1, 50);
    const prefix = normalizePrefix(elements.prefix.value);

    elements.quantity.value = String(quantity);
    elements.prefix.value = prefix;

    try {
        const data = await apiRequest('generate', {
            method: 'POST',
            body: {
                durationKey: formData.get('duration') || 'oneMonth',
                quantity,
                prefix,
                owner: cleanText(elements.owner.value) || 'Unassigned',
                tag: cleanText(elements.tag.value)
            }
        });

        state.keys = data.keys || [];
        state.latestId = data.created?.[0]?.id || null;
        render();
        showToast(`${data.created?.length || 0} key${data.created?.length === 1 ? '' : 's'} generated`);
    } catch (error) {
        showToast(error.message);
        setRedeemMessage(error.message, 'error');
    }
});

elements.redeemForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const requestedKey = normalizeAccessKey(elements.redeemKey.value);

    try {
        const data = await apiRequest('validate', {
            method: 'POST',
            body: { key: requestedKey },
            admin: false
        });

        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            key: data.key.key,
            id: data.key.id,
            unlockedAt: new Date().toISOString()
        }));
        setRedeemMessage('Access granted. Opening download...', 'success');
        showToast('Access granted');
        window.location.href = `premium-download.html?key=${encodeURIComponent(data.key.key)}`;
    } catch (error) {
        setRedeemMessage(error.message, 'error');
        showToast(error.message);
    }
});

elements.useLatest.addEventListener('click', () => {
    const latest = getLatestKey();
    if (!latest) {
        setRedeemMessage('Generate a key first.', 'error');
        showToast('Generate a key first');
        return;
    }

    elements.redeemKey.value = latest.key;
    setRedeemMessage('Latest key inserted.', 'success');
});

elements.copyLatest.addEventListener('click', () => {
    const latest = getLatestKey();
    if (!latest) {
        showToast('No key to copy');
        return;
    }
    copyText(latest.key, 'Latest key copied');
});

elements.search.addEventListener('input', (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderTable();
});

elements.statusFilter.addEventListener('change', (event) => {
    state.filter = event.target.value;
    renderTable();
});

elements.export.addEventListener('click', () => {
    const rows = getFilteredKeys();
    if (!rows.length) {
        showToast('No rows to export');
        return;
    }

    const header = ['key', 'limit', 'owner', 'tag', 'created_at', 'expires_at', 'status'];
    const csv = [
        header.join(','),
        ...rows.map((record) => [
            record.key,
            record.durationLabel,
            record.owner,
            record.tag || '',
            record.createdAt,
            record.expiresAt || 'Permanent',
            getStatus(record).label
        ].map(csvEscape).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `oblivionx-keys-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('CSV exported');
});

elements.clear.addEventListener('click', async () => {
    try {
        const data = await apiRequest('clear', { method: 'POST' });
        state.keys = data.keys || [];
        if (state.latestId && !state.keys.some((record) => record.id === state.latestId)) {
            state.latestId = state.keys[0]?.id || null;
        }
        render();
        showToast(data.deletedCount ? 'Revoked keys cleared' : 'No revoked keys to clear');
    } catch (error) {
        showToast(error.message);
    }
});

elements.table.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;

    const record = state.keys.find((item) => item.id === actionButton.dataset.id);
    if (!record) return;

    if (actionButton.dataset.action === 'copy') {
        copyText(record.key, 'Key copied');
    }

    if (actionButton.dataset.action === 'json') {
        copyText(JSON.stringify(record, null, 2), 'Key JSON copied');
    }

    if (actionButton.dataset.action === 'revoke') {
        try {
            const data = await apiRequest('revoke', {
                method: 'PATCH',
                body: { id: record.id, revoked: !record.revoked }
            });
            state.keys = data.keys || [];
            render();
            showToast(data.key.revoked ? 'Key revoked' : 'Key restored');
        } catch (error) {
            showToast(error.message);
        }
    }
});

async function refreshKeys() {
    try {
        const data = await apiRequest('list', { method: 'GET' });
        state.keys = data.keys || [];
        state.latestId = state.keys[0]?.id || null;
        render();
        if (data.storage === 'local-file') {
            setRedeemMessage('API is using local file storage. Add KV env vars on Vercel for production.', 'neutral');
        }
    } catch (error) {
        state.keys = [];
        render();
        setRedeemMessage(error.message, 'error');
        showToast(error.message);
    }
}

async function apiRequest(action, options = {}) {
    const headers = {
        Accept: 'application/json'
    };

    if (options.body) {
        headers['Content-Type'] = 'application/json';
    }

    if (options.admin !== false) {
        const token = elements.adminToken.value.trim();
        if (token) headers['X-Admin-Token'] = token;
    }

    const response = await fetch(`/api?action=${encodeURIComponent(action)}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
        throw new Error(data.error || `API request failed with ${response.status}.`);
    }

    return data;
}

function render() {
    renderLatest();
    renderStats();
    renderTable();
    renderRedeemHint();
    lucide.createIcons();
}

function renderLatest() {
    const latest = getLatestKey();
    if (!latest) {
        elements.latestKey.textContent = 'No key generated';
        elements.latestMeta.innerHTML = '';
        return;
    }

    const status = getStatus(latest);
    elements.latestKey.textContent = latest.key;
    elements.latestMeta.innerHTML = `
        <span class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1">${escapeHtml(latest.durationLabel)}</span>
        <span class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1">${escapeHtml(latest.owner)}</span>
        <span class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1">${escapeHtml(status.label)}</span>
    `;
}

function renderStats() {
    const stats = state.keys.reduce((acc, record) => {
        const status = getStatus(record).value;
        if (status === 'active') acc.active += 1;
        if (status === 'permanent') acc.permanent += 1;
        if (status === 'revoked') acc.revoked += 1;
        if (isExpiringSoon(record)) acc.soon += 1;
        return acc;
    }, { active: 0, permanent: 0, soon: 0, revoked: 0 });

    elements.activeCount.textContent = String(stats.active);
    elements.permanentCount.textContent = String(stats.permanent);
    elements.soonCount.textContent = String(stats.soon);
    elements.revokedCount.textContent = String(stats.revoked);
}

function renderTable() {
    const rows = getFilteredKeys();
    elements.empty.classList.toggle('hidden', rows.length > 0);
    elements.table.innerHTML = rows.map((record) => {
        const status = getStatus(record);
        return `
            <tr class="align-middle text-zinc-300">
                <td class="max-w-[310px] px-3 py-4">
                    <div class="key-text font-mono text-sm font-extrabold text-white">${escapeHtml(record.key)}</div>
                    ${record.tag ? `<div class="mt-1 text-xs font-semibold text-zinc-500">${escapeHtml(record.tag)}</div>` : ''}
                </td>
                <td class="px-3 py-4 font-bold text-zinc-200">${escapeHtml(record.durationLabel)}</td>
                <td class="px-3 py-4 font-semibold">${escapeHtml(record.owner)}</td>
                <td class="px-3 py-4 font-semibold">${formatDate(record.createdAt)}</td>
                <td class="px-3 py-4 font-semibold">${record.expiresAt ? formatDate(record.expiresAt) : 'Never'}</td>
                <td class="px-3 py-4"><span class="status-pill ${status.className}">${status.label}</span></td>
                <td class="px-3 py-4">
                    <div class="flex justify-end gap-2">
                        <button class="soft-button flex h-9 w-9 items-center justify-center text-zinc-200" type="button" data-action="copy" data-id="${record.id}" title="Copy key">
                            <i data-lucide="copy" class="h-4 w-4"></i>
                        </button>
                        <button class="soft-button flex h-9 w-9 items-center justify-center text-zinc-200" type="button" data-action="json" data-id="${record.id}" title="Copy JSON">
                            <i data-lucide="braces" class="h-4 w-4"></i>
                        </button>
                        <button class="soft-button flex h-9 w-9 items-center justify-center ${record.revoked ? 'text-emerald-200' : 'text-red-200'}" type="button" data-action="revoke" data-id="${record.id}" title="${record.revoked ? 'Restore key' : 'Revoke key'}">
                            <i data-lucide="${record.revoked ? 'rotate-ccw' : 'ban'}" class="h-4 w-4"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    lucide.createIcons();
}

function renderRedeemHint() {
    const unlockableCount = state.keys.filter((record) => {
        const status = getStatus(record).value;
        return status === 'active' || status === 'permanent';
    }).length;

    if (!unlockableCount && !elements.redeemKey.value) {
        setRedeemMessage('Generate an active key to unlock premium.', 'neutral');
    }
}

function getFilteredKeys() {
    return state.keys.filter((record) => {
        const status = getStatus(record).value;
        const matchesStatus = state.filter === 'all' || status === state.filter;
        const haystack = `${record.key} ${record.durationLabel} ${record.owner} ${record.tag || ''}`.toLowerCase();
        return matchesStatus && haystack.includes(state.search);
    });
}

function getLatestKey() {
    if (state.latestId) {
        return state.keys.find((record) => record.id === state.latestId) || null;
    }
    return state.keys[0] || null;
}

function getStatus(record) {
    if (record.revoked || record.status === 'revoked') return { value: 'revoked', label: 'Revoked', className: 'status-revoked' };
    if (!record.expiresAt || record.status === 'permanent') return { value: 'permanent', label: 'Permanent', className: 'status-permanent' };
    if (new Date(record.expiresAt).getTime() < Date.now() || record.status === 'expired') {
        return { value: 'expired', label: 'Expired', className: 'status-expired' };
    }
    return { value: 'active', label: 'Active', className: 'status-active' };
}

function isExpiringSoon(record) {
    if (record.revoked || !record.expiresAt) return false;
    const msLeft = new Date(record.expiresAt).getTime() - Date.now();
    return msLeft > 0 && msLeft <= 1000 * 60 * 60 * 24 * 14;
}

function normalizePrefix(value) {
    const cleaned = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return cleaned || 'OBX';
}

function cleanText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeAccessKey(value) {
    return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function setRedeemMessage(message, tone) {
    const color = {
        error: 'text-red-300',
        success: 'text-emerald-300',
        neutral: 'text-zinc-500'
    }[tone] || 'text-zinc-500';

    elements.redeemMessage.className = `min-h-5 text-sm font-bold ${color}`;
    elements.redeemMessage.textContent = message;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(new Date(value));
}

function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function copyText(value, message) {
    try {
        await navigator.clipboard.writeText(value);
        showToast(message);
    } catch {
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        showToast(message);
    }
}

let toastTimer = null;
function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        elements.toast.classList.remove('show');
    }, 2200);
}

render();
refreshKeys();
