/* Typefall Top 10 leaderboard.
     GET  /api/leaderboard  -> { boards: { "time-15": [...top 10], "time-30": [...], "time-60": [...], "words-25": [...] } }
     POST /api/leaderboard  {mode, name, wpm, acc, target}  -> { ok, rank, improved, entry, board }

   Scores live in Netlify Blobs (store "typefall-leaderboard", one key per mode, top 50 kept).
   No emails, accounts or IP addresses are stored: the rate limiter keys on a salted hash of the IP
   and forgets it after a minute.

   NOT TAMPER-PROOF: the browser reports its own score, so a determined person can post a fake one.
   The checks below only stop obvious junk. See netlify/lib/leaderboard-core.mjs. */
import { getStore } from '@netlify/blobs';
import { createHash, randomUUID } from 'node:crypto';
import { MODES, KEEP_N, MAX_BODY_BYTES, validateSubmission, insert, top, publicEntry, rateCheck } from '../lib/leaderboard-core.mjs';

const STORE = 'typefall-leaderboard';
const REGION = 'eu-central-1'; // Frankfurt, closest Blobs region to Malta. Keep it the same on every call.
const RATE_LIMIT = Number(process.env.LEADERBOARD_RATE_LIMIT) || 5; // submissions per IP per minute

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});

/* In-memory stand-in, used ONLY under `netlify dev` if the local Blobs sandbox is unavailable. */
const mem = new Map();
const memStore = {
  async getWithMetadata(k) { return mem.has(k) ? { data: structuredClone(mem.get(k).v), etag: mem.get(k).e } : null; },
  async setJSON(k, v, o = {}) {
    const cur = mem.get(k);
    if (o.onlyIfNew && cur) return { modified: false };
    if (o.onlyIfMatch && (!cur || cur.e !== o.onlyIfMatch)) return { modified: false };
    const e = randomUUID(); mem.set(k, { v: structuredClone(v), e }); return { modified: true, etag: e };
  },
};
const isLocalDev = context => process.env.NETLIFY_DEV === 'true' || context?.deploy?.context === 'dev';

function openStore(context) {
  try { return getStore({ name: STORE, region: REGION, consistency: 'strong' }); }
  catch (err) {
    if (isLocalDev(context)) { console.warn('[leaderboard] Blobs unavailable, using in-memory store (local dev only)'); return memStore; }
    throw err;
  }
}

const boardKey = mode => `board/${mode}`;

async function readBoard(store, mode) {
  const r = await store.getWithMetadata(boardKey(mode), { type: 'json' });
  return r ? { exists: true, list: Array.isArray(r.data) ? r.data : [], etag: r.etag } : { exists: false, list: [], etag: null };
}

/* Read-modify-write with an ETag check, retried a few times so two simultaneous
   submissions don't silently overwrite each other (best effort). */
async function updateBoard(store, mode, fn) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { exists, list, etag } = await readBoard(store, mode);
    const result = fn(list);
    if (!result.changed) return result;
    // Production Blobs returns an ETag on reads. The local `netlify dev` sandbox doesn't,
    // so there we fall back to a plain write (last write wins).
    const opts = etag ? { onlyIfMatch: etag } : exists ? {} : { onlyIfNew: true };
    const { modified } = await store.setJSON(boardKey(mode), result.list.slice(0, KEEP_N), opts);
    if (modified) return result;
    await new Promise(r => setTimeout(r, 40 + Math.random() * 120));
  }
  throw new Error('Board busy');
}

async function limited(store, ip) {
  const id = createHash('sha256').update('typefall:' + (ip || 'unknown')).digest('hex').slice(0, 32);
  const key = `rate/${id}`;
  const now = Date.now();
  const prev = await store.getWithMetadata(key, { type: 'json' }).catch(() => null);
  const r = rateCheck(prev?.data, now, RATE_LIMIT);
  if (r.allowed) await store.setJSON(key, r.stamps).catch(() => {});
  return r;
}

export default async (req, context) => {
  let store;
  try { store = openStore(context); }
  catch { return json({ error: 'Leaderboard offline' }, 503); }

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const only = url.searchParams.get('mode');
      if (only && !MODES.includes(only)) return json({ error: 'Invalid mode' }, 400);
      const modes = only ? [only] : MODES;
      const boards = {};
      await Promise.all(modes.map(async m => { boards[m] = top((await readBoard(store, m)).list); }));
      return json({ boards });
    }

    if (req.method === 'POST') {
      if (!(req.headers.get('content-type') || '').includes('application/json')) return json({ error: 'Send JSON' }, 415);
      const text = await req.text();
      if (text.length > MAX_BODY_BYTES) return json({ error: 'Body too large' }, 413);
      let body;
      try { body = JSON.parse(text); } catch { return json({ error: 'Malformed body' }, 400); }

      const rl = await limited(store, context.ip);
      if (!rl.allowed) return json({ error: 'Too many scores, slow down a little' }, 429, { 'retry-after': String(rl.retryAfter) });

      const v = validateSubmission(body);
      if (v.error) return json({ error: v.error, code: v.code }, 400);
      const { mode } = v.value;

      // Honeypot: real players never see this field. Pretend it worked, store nothing.
      if (body && typeof body.website === 'string' && body.website.trim()) {
        return json({ ok: true, rank: null, improved: false, entry: null, board: top((await readBoard(store, mode)).list) });
      }

      const entry = { id: randomUUID().slice(0, 12), name: v.value.name, wpm: v.value.wpm, acc: v.value.acc, at: Date.now() };
      const res = await updateBoard(store, mode, list => {
        const r = insert(list, entry);
        return { ...r, changed: r.improved };
      });
      const rank = res.rank && res.rank <= 10 ? res.rank : null;
      return json({ ok: true, mode, rank, improved: res.improved, entry: publicEntry(res.entry), board: top(res.list) }, 201);
    }

    return json({ error: 'Method not allowed' }, 405, { allow: 'GET, POST' });
  } catch (err) {
    console.error('[leaderboard]', err);
    return json({ error: 'Leaderboard offline' }, 503);
  }
};

export const config = { path: '/api/leaderboard' };
