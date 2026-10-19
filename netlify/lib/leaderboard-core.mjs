/* Typefall leaderboard: pure logic (validation, nickname filter, ranking).
   No I/O here, so it can be unit-tested and reused by the Netlify Function.

   NOT TAMPER-PROOF. The browser reports its own score, so anyone determined
   can post a fake one with a script. These checks only stop the obvious
   cases (impossible speeds, bad accuracy, junk, spam, rude nicknames). */

export const MODES = ['time-15', 'time-30', 'time-60', 'words-25'];
export const TARGETS = [20, 30, 45, 60];
export const MAX_WPM = 250;
export const MIN_ACC = 90;
export const NAME_MAX = 12;
export const TOP_N = 10;      // shown
export const KEEP_N = 50;     // stored per mode (headroom for races / dedupe)
export const MAX_BODY_BYTES = 2048;

/* ---------- nickname ---------- */
// Latin letters (incl. accents), digits, spaces and a few basic symbols.
const NAME_RE = /^[\p{Script=Latin}0-9 _.\-!?#*+&@'~]+$/u;

export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!name || [...name].length > NAME_MAX) return null;
  if (!NAME_RE.test(name)) return null;
  if (!/[\p{L}0-9]/u.test(name)) return null; // not just symbols
  return name;
}

/* Small built-in list (English-centric, best effort).
   ROOTS match anywhere in the name once spaces/symbols are removed.
   WORDS only match the whole name or a whole word in it, so innocent names
   like "Grape", "Spice", "Nigel" or "Dickens" are not flagged. */
const ROOTS = [
  'fuck', 'fuk', 'fck', 'phuck', 'shit', 'cunt', 'nigg', 'nigga', 'faggot', 'bitch', 'whore', 'slut',
  'rapist', 'wank', 'twat', 'pussy', 'penis', 'vagina', 'porn', 'dildo', 'cocksuck', 'retard', 'spastic',
  'tranny', 'kike', 'chink', 'wetback', 'nazi', 'hitler', 'jizz', 'boob', 'tits', 'bollock', 'bastard',
  'motherf', 'pedo', 'paedo', 'incest', 'molest', 'asshole', 'dickhead', 'blowjob', 'handjob', 'orgasm',
];
const WORDS = ['ass', 'arse', 'fag', 'tit', 'sex', 'sexy', 'nob', 'knob', 'prick', 'piss', 'hoe', 'cum', 'anal',
  'dick', 'cock', 'coon', 'spic', 'paki', 'gook', 'rape', 'kkk', 'nsfw', 'xxx', 'milf', 'horny'];
// Innocent words that contain a ROOT; masked out before matching.
const ALLOW = ['scunthorpe', 'shitake', 'shiitake', 'cockatoo', 'peacock', 'hancock', 'tits' + 'worth'];

const LEET = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's',
  '7': 't', '+': 't', '8': 'b', '9': 'g', '6': 'g', '2': 'z', '€': 'e', '£': 'l' };

const deaccent = s => s.normalize('NFD').replace(/\p{M}+/gu, '');
const leet = s => [...s].map(c => LEET[c] ?? c).join('');
const letters = s => s.replace(/[^a-z]/g, '');
const squash = s => s.replace(/(.)\1+/g, '$1');             // "fuuuck" -> "fuck"
// Squashed roots are only used when still distinctive ("boob" -> "bob" would hit "Bob").
const ROOT_FORMS = ROOTS.flatMap(r => { const q = squash(r); return q === r || q.length >= 4 ? [r, q] : [r]; });
const WORD_FORMS = new Set(WORDS.flatMap(w => { const q = squash(w); return q.length >= 3 ? [w, q] : [w]; }));

function mask(s) { for (const a of ALLOW) s = s.split(a).join('_'); return s; }

export function isRude(name) {
  const base = deaccent(String(name).toLowerCase());
  // Read digits/symbols both as leetspeak and as noise ("b1tch", "sh*t", "f.u.c.k").
  const joined = [letters(leet(base)), letters(base)];
  const forms = new Set(joined.flatMap(j => [mask(j), mask(squash(j))]));
  for (const f of forms) if (ROOT_FORMS.some(r => f.includes(r))) return true;
  const tokens = base.split(/[\s_.\-#&~'?]+/).filter(Boolean);
  for (const t of [...tokens, base.replace(/[\s_.\-]+/g, '')]) {
    for (const v of [letters(leet(t)), letters(t)]) {
      if (WORD_FORMS.has(v) || WORD_FORMS.has(squash(v)) || WORD_FORMS.has(v.replace(/(.)\1{2,}/g, '$1$1'))) return true;
    }
  }
  return false;
}

/* ---------- score payload ---------- */
export function validateSubmission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Malformed body' };
  const { mode, wpm, acc, target } = body;
  if (!MODES.includes(mode)) return { error: 'Invalid mode' };
  if (!Number.isFinite(wpm) || !Number.isInteger(wpm)) return { error: 'Invalid wpm' };
  if (!Number.isFinite(acc)) return { error: 'Invalid accuracy' };
  if (wpm < 1 || wpm > MAX_WPM) return { error: `WPM must be between 1 and ${MAX_WPM}` };
  if (acc < MIN_ACC || acc > 100) return { error: `Accuracy must be between ${MIN_ACC} and 100` };
  if (!TARGETS.includes(target)) return { error: 'Invalid target' };
  if (wpm < target) return { error: 'Only passed tests can be submitted' };
  const name = cleanName(body.name);
  if (!name) return { error: `Nickname: 1 to ${NAME_MAX} letters, numbers, spaces or basic symbols` };
  if (isRude(name)) return { error: 'Please pick a friendlier nickname', code: 'rude' };
  return { value: { mode, wpm, acc: Math.round(acc * 10) / 10, name } };
}

/* ---------- ranking ---------- */
export function compare(a, b) {
  return (b.wpm - a.wpm) || (b.acc - a.acc) || (a.at - b.at);
}

/* Insert an entry, keep each nickname's best only, sort and trim. */
export function insert(list, entry, keep = KEEP_N) {
  const key = entry.name.toLowerCase();
  const prev = list.find(e => e.name.toLowerCase() === key);
  let out = list;
  let improved = true;
  if (prev) {
    if (compare(entry, prev) < 0) out = list.filter(e => e !== prev);
    else improved = false;
  }
  if (improved) out = [...out, entry];
  out = out.slice().sort(compare).slice(0, keep);
  const winner = improved ? entry : prev;
  const idx = out.findIndex(e => e.id === winner.id);
  return { list: out, rank: idx >= 0 ? idx + 1 : null, improved, entry: winner };
}

export function publicEntry(e) {
  return { id: e.id, name: e.name, wpm: e.wpm, acc: e.acc, at: e.at };
}
export function top(list, n = TOP_N) {
  return (Array.isArray(list) ? list : []).slice().sort(compare).slice(0, n).map(publicEntry);
}

/* ---------- rate limit ---------- */
/* Sliding window: returns the kept timestamps and whether this hit is allowed. */
export function rateCheck(stamps, now, limit = 5, windowMs = 60_000) {
  const recent = (Array.isArray(stamps) ? stamps : []).filter(t => Number.isFinite(t) && now - t < windowMs);
  if (recent.length >= limit) {
    return { allowed: false, stamps: recent, retryAfter: Math.max(1, Math.ceil((windowMs - (now - Math.min(...recent))) / 1000)) };
  }
  return { allowed: true, stamps: [...recent, now] };
}
