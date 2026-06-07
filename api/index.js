const crypto = require('crypto');

const DROPBOX_URL = 'https://www.dropbox.com/scl/fi/qid5nvg1pa3i7hb5b9jui/ObxPaid.zip?rlkey=f2ozlf7yo8zjndp9g7ewsyami&st=b4ef2y8p&dl=1';
const STORE_KEY = 'obx:keys';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const DURATIONS = {
  oneMonth: { label: '1 Month', code: '1M', months: 1 },
  threeMonths: { label: '3 Months', code: '3M', months: 3 },
  oneYear: { label: '1 Year', code: '1Y', years: 1 },
  permanent: { label: 'Permanent', code: 'LIFE', permanent: true }
};

globalThis.__obxKeys = globalThis.__obxKeys || [];

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return end(res, 204);

  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const query = getQuery(req);
    const action = query.action || body.action || 'health';

    if (action === 'health') {
      return json(res, 200, {
        ok: true,
        storage: hasKv() ? 'kv' : 'memory',
        adminProtected: Boolean(process.env.ADMIN_TOKEN)
      });
    }

    if (['list', 'generate', 'revoke', 'clear'].includes(action) && !isAdmin(req)) {
      return json(res, 401, { ok: false, error: 'Unauthorized admin request.' });
    }

    if (action === 'list') {
      const keys = await readKeys();
      return json(res, 200, { ok: true, keys: keys.map(publicKey), stats: stats(keys) });
    }

    if (action === 'generate') {
      const keys = await readKeys();
      const created = makeKeys(keys, body);
      const updated = [...created, ...keys];
      await writeKeys(updated);
      return json(res, 201, { ok: true, created: created.map(publicKey), keys: updated.map(publicKey), stats: stats(updated) });
    }

    if (action === 'revoke') {
      const keys = await readKeys();
      const index = keys.findIndex((item) => item.id === body.id || item.key === normalizeKey(body.key));
      if (index === -1) return json(res, 404, { ok: false, error: 'Key not found.' });

      keys[index].revoked = typeof body.revoked === 'boolean' ? body.revoked : !keys[index].revoked;
      await writeKeys(keys);
      return json(res, 200, { ok: true, key: publicKey(keys[index]), keys: keys.map(publicKey), stats: stats(keys) });
    }

    if (action === 'clear') {
      const keys = await readKeys();
      const kept = keys.filter((item) => status(item).value !== 'revoked');
      await writeKeys(kept);
      return json(res, 200, { ok: true, deletedCount: keys.length - kept.length, keys: kept.map(publicKey), stats: stats(kept) });
    }

    if (action === 'validate') {
      const result = validate(await readKeys(), body.key || query.key);
      if (!result.ok) return json(res, result.code, { ok: false, error: result.error });
      return json(res, 200, {
        ok: true,
        key: publicKey(result.record),
        downloadPath: `/api?action=download&key=${encodeURIComponent(result.record.key)}`
      });
    }

    if (action === 'download') {
      const result = validate(await readKeys(), query.key || body.key);
      if (!result.ok) return json(res, result.code, { ok: false, error: result.error });
      res.statusCode = 302;
      res.setHeader('Location', process.env.PREMIUM_DOWNLOAD_URL || DROPBOX_URL);
      return res.end();
    }

    return json(res, 404, { ok: false, error: 'Unknown API action.' });
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message || 'API error.' });
  }
};

function getQuery(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  return Object.fromEntries(url.searchParams.entries());
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function isAdmin(req) {
  if (!process.env.ADMIN_TOKEN) return true;
  return req.headers['x-admin-token'] === process.env.ADMIN_TOKEN;
}

async function readKeys() {
  if (!hasKv()) return globalThis.__obxKeys;
  const result = await kv(['GET', STORE_KEY]);
  return result ? JSON.parse(result) : [];
}

async function writeKeys(keys) {
  if (!hasKv()) {
    globalThis.__obxKeys = keys;
    return;
  }
  await kv(['SET', STORE_KEY, JSON.stringify(keys)]);
}

function hasKv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kv(command) {
  const response = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || 'KV request failed.');
  return data.result;
}

function makeKeys(existing, options) {
  const durationKey = DURATIONS[options.durationKey] ? options.durationKey : 'oneMonth';
  const duration = DURATIONS[durationKey];
  const quantity = clamp(Number(options.quantity) || 1, 1, 50);
  const prefix = cleanPrefix(options.prefix);
  const owner = cleanText(options.owner) || 'Unassigned';
  const tag = cleanText(options.tag);
  const now = new Date();
  const seen = new Set(existing.map((item) => item.key));
  const created = [];

  for (let i = 0; i < quantity; i += 1) {
    const key = uniqueKey(seen, prefix, duration.code);
    seen.add(key);
    created.push({
      id: crypto.randomUUID(),
      key,
      durationKey,
      durationLabel: duration.label,
      owner,
      tag,
      createdAt: now.toISOString(),
      expiresAt: expiresAt(now, duration),
      revoked: false
    });
  }

  return created;
}

function uniqueKey(seen, prefix, code) {
  let key = '';
  do {
    key = `${prefix}-${code}-${segment()}-${segment()}-${segment()}-${segment()}`;
  } while (seen.has(key));
  return key;
}

function segment() {
  const bytes = crypto.randomBytes(4);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

function expiresAt(date, duration) {
  if (duration.permanent) return null;
  const expiry = new Date(date);
  if (duration.months) expiry.setMonth(expiry.getMonth() + duration.months);
  if (duration.years) expiry.setFullYear(expiry.getFullYear() + duration.years);
  return expiry.toISOString();
}

function validate(keys, rawKey) {
  const key = normalizeKey(rawKey);
  if (!key) return { ok: false, code: 400, error: 'Enter a key first.' };

  const record = keys.find((item) => item.key.toUpperCase() === key);
  if (!record) return { ok: false, code: 404, error: 'Key not found.' };

  const keyStatus = status(record).value;
  if (keyStatus === 'revoked') return { ok: false, code: 403, error: 'This key has been revoked.' };
  if (keyStatus === 'expired') return { ok: false, code: 403, error: 'This key has expired.' };

  return { ok: true, record };
}

function status(record) {
  if (record.revoked) return { value: 'revoked', label: 'Revoked' };
  if (!record.expiresAt) return { value: 'permanent', label: 'Permanent' };
  if (new Date(record.expiresAt).getTime() < Date.now()) return { value: 'expired', label: 'Expired' };
  return { value: 'active', label: 'Active' };
}

function stats(keys) {
  return keys.reduce((acc, record) => {
    const current = status(record).value;
    acc.total += 1;
    if (current === 'active') acc.active += 1;
    if (current === 'permanent') acc.permanent += 1;
    if (current === 'revoked') acc.revoked += 1;
    if (current === 'expired') acc.expired += 1;
    return acc;
  }, { total: 0, active: 0, permanent: 0, revoked: 0, expired: 0 });
}

function publicKey(record) {
  const current = status(record);
  return { ...record, status: current.value, statusLabel: current.label };
}

function cleanPrefix(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'OBX';
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeKey(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

function json(res, code, payload) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function end(res, code) {
  res.statusCode = code;
  res.end();
}
