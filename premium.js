lucide.createIcons();

const SESSION_KEY = 'oblivionx-premium-session';

const elements = {
    locked: document.getElementById('lockedState'),
    unlocked: document.getElementById('unlockedState'),
    form: document.getElementById('downloadKeyForm'),
    input: document.getElementById('downloadKeyInput'),
    message: document.getElementById('lockedMessage'),
    unlockedKey: document.getElementById('unlockedKey'),
    unlockedMeta: document.getElementById('unlockedMeta'),
    buildMeta: document.getElementById('buildMeta'),
    download: document.getElementById('downloadBtn'),
    copyDownload: document.getElementById('copyDownloadBtn'),
    signOut: document.getElementById('signOutBtn'),
    toast: document.getElementById('toast')
};

let activeDownloadPath = '';

elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = normalizeAccessKey(elements.input.value);
    await unlockWithKey(key);
});

elements.copyDownload.addEventListener('click', () => {
    if (!activeDownloadPath) {
        showToast('Unlock with a key first');
        return;
    }

    copyText(new URL(activeDownloadPath, window.location.href).href, 'Download link copied');
});

elements.signOut.addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    activeDownloadPath = '';
    showLocked('Download locked.');
    showToast('Download locked');
});

async function init() {
    const queryKey = new URLSearchParams(window.location.search).get('key');
    const session = readSession();
    const requestedKey = normalizeAccessKey(queryKey || session?.key || '');

    if (!requestedKey) {
        showLocked('Enter a key first.');
        return;
    }

    await unlockWithKey(requestedKey, { quiet: true });
}

async function unlockWithKey(key, options = {}) {
    try {
        const data = await apiRequest('validate', {
            method: 'POST',
            body: { key }
        });

        saveSession(data.key);
        showUnlocked(data.key, data.downloadPath);
        if (!options.quiet) showToast('Download unlocked');
    } catch (error) {
        showLocked(error.message);
        if (!options.quiet) showToast(error.message);
    }
}

async function apiRequest(action, options = {}) {
    const response = await fetch(`/api?action=${encodeURIComponent(action)}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
        throw new Error(data.error || `API request failed with ${response.status}.`);
    }

    return data;
}

function readSession() {
    try {
        return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch {
        return null;
    }
}

function saveSession(record) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        id: record.id,
        key: record.key,
        unlockedAt: new Date().toISOString()
    }));
}

function showLocked(message) {
    elements.unlocked.classList.add('hidden');
    elements.locked.classList.remove('hidden');
    setLockedMessage(message, 'neutral');
    lucide.createIcons();
}

function showUnlocked(record, downloadPath) {
    activeDownloadPath = downloadPath;
    elements.locked.classList.add('hidden');
    elements.unlocked.classList.remove('hidden');
    elements.unlockedKey.textContent = record.key;
    elements.buildMeta.textContent = `${record.durationLabel} Access`;
    elements.download.href = downloadPath;
    elements.unlockedMeta.innerHTML = `
        <span class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1">${escapeHtml(record.statusLabel || 'Active')}</span>
        <span class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1">${escapeHtml(record.owner || 'Unassigned')}</span>
        <span class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1">${record.expiresAt ? `Expires ${escapeHtml(formatDate(record.expiresAt))}` : 'Never Expires'}</span>
    `;
    lucide.createIcons();
}

function normalizeAccessKey(value) {
    return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function setLockedMessage(message, tone) {
    const color = {
        error: 'text-red-300',
        neutral: 'text-zinc-500'
    }[tone] || 'text-zinc-500';
    elements.message.className = `mt-4 min-h-5 text-center text-sm font-bold ${color}`;
    elements.message.textContent = message;
}

function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(new Date(value));
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

init();
