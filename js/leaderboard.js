/* Typefall Top 10 leaderboard (client).
   Talks to /api/leaderboard (netlify/functions/leaderboard.mjs). Nicknames are only ever
   written with textContent, never innerHTML. If the API is unreachable (file://, plain
   static server, outage) it shows "Leaderboard offline" and the typing test carries on. */
window.Leaderboard = (() => {
  'use strict';
  const API = '/api/leaderboard';
  const MODES = ['time-15', 'time-30', 'time-60', 'words-25'];
  const LABELS = { 'time-15': '15s', 'time-30': '30s', 'time-60': '60s', 'words-25': '25 words' };
  const NAME_MAX = 12;
  const NAME_RE = /^[\p{Script=Latin}0-9 _.\-!?#*+&@'~]+$/u;
  const NICK_KEY = 'typefall:nick';
  const CACHE_MS = 20000;
  const PALETTE = ['#2274A5', '#F75C03', '#F1C40F', '#D90368', '#00CC66'];

  const $ = id => document.getElementById(id);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const nickStore = {
    get() { try { return localStorage.getItem(NICK_KEY) || ''; } catch { return ''; } },
    set(v) { try { localStorage.setItem(NICK_KEY, v); } catch { /* private mode */ } },
  };

  let cache = null, cacheAt = 0, offline = false, current = null, viewMode = 'time-30', highlightId = null;
  const ui = {
    dlg: $('lb'), list: $('lb-list'), status: $('lb-status'), panel: $('lb-panel'),
    tabs: [...document.querySelectorAll('[data-lb-mode]')],
    claim: $('claim'), nick: $('nick'), hp: $('website'), btn: $('claim-btn'), msg: $('claim-msg'), sub: $('claim-sub'),
    note: $('lb-note'), again: $('again'),
  };

  /* ---------- API ---------- */
  async function call(method, body) {
    if (location.protocol === 'file:') throw new Error('offline');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 7000);
    try {
      const res = await fetch(API, {
        method, signal: ctl.signal, cache: 'no-store',
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;
      if (!data) throw new Error('offline');
      if (res.status >= 500) throw new Error('offline');
      return { status: res.status, data };
    } finally { clearTimeout(t); }
  }

  async function boards(force) {
    if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
    try {
      const { status, data } = await call('GET');
      if (status !== 200 || !data.boards) throw new Error('offline');
      cache = data.boards; cacheAt = Date.now(); offline = false;
      return cache;
    } catch { offline = true; return null; }
  }

  const better = (a, b) => (a.wpm - b.wpm) || (a.acc - b.acc);
  function wouldRank(list, wpm, acc) {
    const n = list.filter(e => better(e, { wpm, acc }) >= 0).length; // ties go to the earlier score
    return n < 10 ? n + 1 : null;
  }

  /* ---------- results-card claim ---------- */
  function reset() {
    current = null;
    ui.claim.hidden = true; ui.note.hidden = true;
    ui.msg.textContent = ''; ui.msg.className = 'claim-msg';
    ui.btn.disabled = false;
    ui.again.classList.remove('no-kbd');
  }

  async function onResult(r) {
    reset();
    if (!r.pass) return;
    const token = current = { ...r };
    const all = await boards(true);
    if (current !== token) return; // a new test started meanwhile
    if (!all) { showNote('Leaderboard offline. Your score is saved on this device only.', 'off'); return; }
    const list = all[r.mode] || [];
    const rank = wouldRank(list, r.wpm, r.acc);
    if (!rank) {
      const last = list[list.length - 1];
      showNote(`Top 10 for ${LABELS[r.mode]} starts at ${last.wpm} wpm. So close. Go again!`, 'miss');
      return;
    }
    ui.sub.textContent = rank === 1 ? `That's #1 on the ${LABELS[r.mode]} board!` : `That's good for #${rank} on the ${LABELS[r.mode]} board.`;
    ui.nick.value = nickStore.get();
    ui.claim.hidden = false;
    ui.claim.classList.toggle('gold', rank === 1);
    ui.again.classList.add('no-kbd');
  }
  function showNote(text, kind) { ui.note.textContent = text; ui.note.className = 'lb-note ' + kind; ui.note.hidden = false; }

  function checkName(v) {
    const name = v.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!name) return { error: 'Type a nickname first.' };
    if ([...name].length > NAME_MAX) return { error: `Keep it to ${NAME_MAX} characters.` };
    if (!NAME_RE.test(name) || !/[\p{L}0-9]/u.test(name)) return { error: 'Letters, numbers, spaces and basic symbols only.' };
    return { name };
  }

  function say(text, kind) { ui.msg.textContent = text; ui.msg.className = 'claim-msg ' + (kind || ''); }

  ui.nick.addEventListener('input', () => { if (ui.msg.classList.contains('err')) say(''); });

  ui.claim.addEventListener('submit', async e => {
    e.preventDefault();
    if (!current || ui.btn.disabled) return;
    const c = checkName(ui.nick.value);
    if (c.error) { say(c.error, 'err'); ui.nick.focus(); return; }
    ui.btn.disabled = true; say('Sending…');
    const r = current;
    try {
      const { status, data } = await call('POST', { mode: r.mode, name: c.name, wpm: r.wpm, acc: r.acc, target: r.target, website: ui.hp.value });
      if (status === 201 || status === 200) {
        nickStore.set(c.name);
        if (cache && data.board) cache[r.mode] = data.board;
        ui.claim.hidden = true;
        ui.again.classList.remove('no-kbd');
        const msg = data.rank
          ? (data.improved ? `You're #${data.rank} on the ${LABELS[r.mode]} board, ${c.name}!` : `Your earlier score is still better: #${data.rank}.`)
          : 'Saved, but someone slipped past you. Not in the Top 10 this time.';
        showNote(msg, data.rank ? 'win' : 'miss');
        open(r.mode, data.improved && data.entry ? data.entry.id : null, data.board);
      } else {
        ui.btn.disabled = false;
        say(status === 429 ? 'Whoa, speedy. Wait a minute and try again.' : (data.error || 'That did not work.'), 'err');
        if (data.code === 'rude') ui.nick.select();
      }
    } catch {
      ui.btn.disabled = false;
      say('Leaderboard offline. Try again in a bit.', 'err');
    }
  });

  /* ---------- dialog ---------- */
  function selectTab(mode, focus) {
    viewMode = mode;
    ui.tabs.forEach(t => {
      const on = t.dataset.lbMode === mode;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    ui.panel.setAttribute('aria-labelledby', 'lbt-' + mode);
  }

  function render(list, freshId) {
    ui.list.textContent = '';
    ui.status.textContent = ''; ui.status.className = 'lb-status';
    if (!list) {
      ui.status.className = 'lb-status off';
      ui.status.append(el('strong', null, 'Leaderboard offline'), el('span', null, 'The typing test still works. Scores will show here when it’s back.'));
      const retry = el('button', 'btn', 'Try again'); retry.type = 'button';
      retry.addEventListener('click', () => load(true));
      ui.status.append(retry);
      return;
    }
    if (!list.length) {
      ui.status.className = 'lb-status empty';
      ui.status.append(el('strong', null, 'No scores yet'), el('span', null, `Pass a ${LABELS[viewMode]} test and be the first up here.`));
      return;
    }
    const anim = !reduced();
    list.forEach((e, i) => {
      const li = el('li', 'lb-row r' + (i + 1));
      li.style.setProperty('--i', i);
      li.style.setProperty('--accent', PALETTE[i % PALETTE.length]);
      const rank = el('span', 'lb-rank', String(i + 1));
      const name = el('span', 'lb-name');
      const fresh = freshId && e.id === freshId;
      if (fresh && anim) {
        // letters drop in one by one, like the falling text
        [...e.name].forEach((ch, k) => {
          const s = el('span', 'lb-ch', ch);
          s.style.setProperty('--k', k);
          s.style.setProperty('--r', ((Math.random() * 60) - 30).toFixed(0) + 'deg');
          s.style.color = PALETTE[(k + 1) % PALETTE.length];
          name.append(s);
        });
        name.setAttribute('aria-label', e.name);
      } else name.textContent = e.name;
      const wpm = el('span', 'lb-wpm'); wpm.append(String(e.wpm), el('small', null, ' wpm'));
      const acc = el('span', 'lb-acc', (Math.round(e.acc * 10) / 10) + '%');
      li.append(rank, name, wpm, acc);
      if (fresh) { li.classList.add('fresh'); if (anim) li.classList.add('drop'); li.append(el('span', 'lb-you', 'you')); }
      else if (anim && freshId == null) li.classList.add('in');
      ui.list.append(li);
    });
  }

  async function load(force, freshId) {
    ui.list.textContent = '';
    ui.status.className = 'lb-status loading'; ui.status.textContent = 'Loading…';
    const all = await boards(force);
    render(all ? (all[viewMode] || []) : null, freshId);
  }

  function open(mode, freshId, board) {
    selectTab(MODES.includes(mode) ? mode : viewMode);
    highlightId = freshId || null;
    if (!ui.dlg.open) { if (typeof ui.dlg.showModal === 'function') ui.dlg.showModal(); else ui.dlg.setAttribute('open', ''); }
    if (board) render(board, highlightId); else load(false, highlightId);
    $('lb-close').focus();
  }
  function close() { if (ui.dlg.open) ui.dlg.close(); }

  ui.tabs.forEach((t, i) => {
    t.addEventListener('click', () => { selectTab(t.dataset.lbMode); load(false, highlightId); });
    t.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      let j = d ? (i + d + ui.tabs.length) % ui.tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? ui.tabs.length - 1 : -1;
      if (j < 0) return;
      e.preventDefault();
      selectTab(ui.tabs[j].dataset.lbMode, true); load(false, highlightId);
    });
  });
  $('lb-close').addEventListener('click', close);
  ui.dlg.addEventListener('click', e => { if (e.target === ui.dlg) close(); }); // backdrop
  ui.dlg.addEventListener('close', () => document.dispatchEvent(new CustomEvent('leaderboard:close')));
  const openFromButton = () => {
    const s = window.__typefall && window.__typefall.state;
    const mode = window.__typefall ? `${window.__typefall.settings.mode}-${window.__typefall.settings.value}` : viewMode;
    open(mode, s && s.finished ? highlightId : null);
  };
  $('lb-open').addEventListener('click', openFromButton);
  $('lb-open-2').addEventListener('click', openFromButton);

  return { onResult, reset, open, close, get isOpen() { return ui.dlg.open; }, get offline() { return offline; }, _check: checkName };
})();
