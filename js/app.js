/* Typefall: main game logic. */
(() => {
  'use strict';
  const MISTAKE_LIMIT = 10;
  const ACC_TARGET = 90;
  const COMBO_STEP = 10;
  const MAX_COMBO = 5;

  const $ = id => document.getElementById(id);
  const els = {
    arena: $('arena'), wrap: $('words-wrap'), words: $('words'), caret: $('caret'), input: $('input'),
    hint: $('hint-start'), time: $('s-time'), timeLbl: $('s-time-lbl'), wpm: $('s-wpm'), acc: $('s-acc'),
    streak: $('s-streak'), combo: $('combo'), comboX: $('combo-x'), comboFill: $('combo-fill'), comboBar: $('combo-bar'),
    stability: $('stability'), stabN: $('stab-n'), pips: $('pips'), rules: $('rules'), ruleWpm: $('rule-wpm'),
    results: $('results'), pb: $('pb'), sr: $('sr'),
  };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const settings = Object.assign({ mode: 'time', value: 30, target: 30 }, store.get('typefall:settings', {}));
  const modeKey = () => `${settings.mode}-${settings.value}`;
  const modeLabel = () => settings.mode === 'time' ? `${settings.value}s` : `${settings.value} words`;

  let S = null, wordEls = [], raf = null;

  for (let i = 0; i < MISTAKE_LIMIT; i++) els.pips.appendChild(document.createElement('i'));

  /* ---------- run lifecycle ---------- */
  function newRun(sameWords) {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    Gravity.clear(false);
    Confetti.stop();
    let texts;
    if (sameWords && S) texts = S.words.map(w => w.t);
    else texts = WordBank.generate(settings.mode === 'words' ? settings.value : 90);
    if (settings.mode === 'words') texts = texts.slice(0, settings.value);
    S = {
      words: texts.map(t => ({ t, typed: '', done: false })), idx: 0,
      started: false, finished: false, t0: 0, elapsed: 0,
      correctKeys: 0, errorKeys: 0, mistakes: 0, streak: 0, bestStreak: 0, combo: 1, maxCombo: 1,
      committedCorrect: 0, samples: [], errSecs: [],
    };
    els.input.value = '';
    els.results.hidden = true;
    els.results.classList.remove('pass', 'fail');
    els.arena.hidden = false;
    els.rules.hidden = false;
    els.arena.classList.remove('running', 'collapsed', 'unstable');
    els.caret.style.visibility = '';
    document.body.classList.remove('has-pile');
    if (window.Leaderboard) Leaderboard.reset();
    renderAll();
    updateHud();
    updatePb();
    focusInput();
  }

  function start() {
    S.started = true;
    S.t0 = performance.now();
    els.arena.classList.add('running');
    raf = requestAnimationFrame(loop);
  }

  function loop(now) {
    if (!S.started || S.finished) return;
    S.elapsed = (now - S.t0) / 1000;
    while (S.samples.length < Math.floor(S.elapsed)) S.samples.push(Math.round(netWpm(S.samples.length + 1)));
    if (settings.mode === 'time' && S.elapsed >= settings.value) {
      S.elapsed = settings.value;
      while (S.samples.length < settings.value) S.samples.push(Math.round(netWpm(S.samples.length + 1)));
      finish('time');
      return;
    }
    updateHud();
    raf = requestAnimationFrame(loop);
  }

  /* ---------- rendering ---------- */
  function makeWordEl(w) {
    const el = document.createElement('span');
    el.className = 'word';
    for (const ch of w.t) { const s = document.createElement('span'); s.className = 'ch'; s.textContent = ch; el.appendChild(s); }
    return el;
  }
  function renderAll() {
    els.words.querySelectorAll('.word').forEach(n => n.remove());
    const frag = document.createDocumentFragment();
    wordEls = S.words.map(w => { const el = makeWordEl(w); frag.appendChild(el); return el; });
    els.words.appendChild(frag);
    els.words.style.transform = 'translateY(0)';
    paintWord(0);
    placeCaret();
  }
  function appendWords(n) {
    const frag = document.createDocumentFragment();
    WordBank.generate(n).forEach(t => {
      const w = { t, typed: '', done: false };
      S.words.push(w);
      const el = makeWordEl(w); wordEls.push(el); frag.appendChild(el);
    });
    els.words.appendChild(frag);
  }
  function paintWord(i) {
    const w = S.words[i], el = wordEls[i];
    if (!w || !el) return;
    const n = Math.max(w.t.length, w.typed.length);
    while (el.children.length < n) { const s = document.createElement('span'); s.className = 'ch'; el.appendChild(s); }
    while (el.children.length > n) el.lastChild.remove();
    for (let k = 0; k < n; k++) {
      const s = el.children[k];
      let cls = 'ch', text;
      if (k < w.t.length) {
        text = w.t[k];
        if (k < w.typed.length) cls += w.typed[k] === w.t[k] ? ' ok' : ' bad';
        else if (w.done) cls += ' miss';
      } else { text = w.typed[k]; cls += ' extra'; }
      if (s.textContent !== text) s.textContent = text;
      if (s.className !== cls) s.className = cls;
    }
    el.classList.toggle('wrong', w.done && w.typed !== w.t);
  }
  function placeCaret() {
    const el = wordEls[S.idx];
    if (!el) return;
    const k = S.words[S.idx].typed.length;
    const ch = el.children[k];
    let x, y, h;
    if (ch) { x = ch.offsetLeft; y = ch.offsetTop; h = ch.offsetHeight; }
    else { const l = el.lastElementChild; x = l.offsetLeft + l.offsetWidth; y = l.offsetTop; h = l.offsetHeight; }
    const ch_ = els.caret.offsetHeight;
    els.caret.style.left = (x - 1) + 'px';
    els.caret.style.top = (y + (h - ch_) / 2) + 'px';
    // keep the current line as the second visible line
    const lineH = el.offsetHeight;
    const shift = Math.max(0, el.offsetTop - lineH);
    els.words.style.transform = `translateY(${-shift}px)`;
  }

  /* ---------- stats ---------- */
  function currentPrefixCorrect() {
    const w = S.words[S.idx];
    if (!w) return 0;
    let c = 0;
    for (let k = 0; k < w.typed.length && k < w.t.length; k++) { if (w.typed[k] === w.t[k]) c++; else break; }
    return c;
  }
  function netWpm(sec) {
    const t = sec ?? S.elapsed;
    if (t <= 0) return 0;
    return ((S.committedCorrect + currentPrefixCorrect()) / 5) / (t / 60);
  }
  function rawWpm(sec) {
    const t = sec ?? S.elapsed;
    return t > 0 ? ((S.correctKeys + S.errorKeys) / 5) / (t / 60) : 0;
  }
  function accuracy() {
    const total = S.correctKeys + S.errorKeys;
    return total ? (S.correctKeys / total) * 100 : 100;
  }
  function charBreakdown() {
    let correct = 0, incorrect = 0, extra = 0, missed = 0;
    const upto = Math.min(S.idx, S.words.length - 1);
    for (let i = 0; i <= upto; i++) {
      const w = S.words[i];
      if (i === S.idx && !w.typed) break;
      for (let k = 0; k < Math.max(w.t.length, w.typed.length); k++) {
        if (k >= w.t.length) extra++;
        else if (k >= w.typed.length) { if (w.done) missed++; }
        else if (w.typed[k] === w.t[k]) correct++;
        else incorrect++;
      }
    }
    return { correct, incorrect, extra, missed };
  }

  function updateHud() {
    if (settings.mode === 'time') {
      els.time.textContent = Math.max(0, Math.ceil(settings.value - S.elapsed));
      els.timeLbl.textContent = 'seconds';
    } else {
      els.time.textContent = `${S.idx}/${S.words.length}`;
      els.timeLbl.textContent = 'words';
    }
    els.wpm.textContent = S.started && S.elapsed > 0.8 ? Math.round(netWpm()) : 0;
    els.acc.textContent = Math.floor(accuracy()) + '%';
    els.streak.textContent = S.streak;
    els.comboX.textContent = 'x' + S.combo;
    const fill = S.combo >= MAX_COMBO ? 100 : ((S.streak % COMBO_STEP) / COMBO_STEP) * 100;
    els.comboFill.style.width = fill + '%';
    els.comboBar.setAttribute('aria-valuenow', Math.round(fill));
    els.combo.classList.toggle('max', S.combo >= MAX_COMBO);
    const left = MISTAKE_LIMIT - S.mistakes;
    els.stabN.textContent = `${Math.max(0, left)}/${MISTAKE_LIMIT}`;
    [...els.pips.children].forEach((p, i) => {
      const lost = i >= left;
      if (lost && !p.classList.contains('lost')) { p.classList.add('lost', 'just-lost'); setTimeout(() => p.classList.remove('just-lost'), 450); }
      if (!lost) p.classList.remove('lost');
    });
    els.stability.classList.toggle('warn', left <= 6 && left > 3);
    els.stability.classList.toggle('danger', left <= 3);
    els.arena.classList.toggle('unstable', left <= 3 && S.started && !S.finished && !reduced());
  }

  function updatePb() {
    const pb = store.get('typefall:pb:' + modeKey(), null);
    els.pb.innerHTML = pb ? `Best ${modeLabel()}: <b>${pb.wpm} wpm</b> · ${pb.acc}%` : `No best yet for ${modeLabel()}`;
  }

  /* ---------- typing ---------- */
  function keystroke(ok) {
    if (ok) {
      S.correctKeys++; S.streak++;
      S.bestStreak = Math.max(S.bestStreak, S.streak);
      const combo = Math.min(MAX_COMBO, 1 + Math.floor(S.streak / COMBO_STEP));
      if (combo > S.combo) comboUp(combo);
      S.combo = combo;
      S.maxCombo = Math.max(S.maxCombo, combo);
    } else {
      S.errorKeys++; S.mistakes++; S.streak = 0; S.combo = 1;
      S.errSecs.push(S.started ? (performance.now() - S.t0) / 1000 : 0);
      if (S.mistakes >= MISTAKE_LIMIT) { updateHud(); finish('mistakes'); }
    }
  }
  function comboUp(combo) {
    els.combo.classList.remove('bump'); void els.combo.offsetWidth; els.combo.classList.add('bump');
    if (reduced()) return;
    const pop = document.createElement('span');
    pop.className = 'combo-pop';
    pop.textContent = combo >= MAX_COMBO ? `x${combo} MAX!` : `x${combo} combo!`;
    const c = els.caret.getBoundingClientRect(), a = els.arena.getBoundingClientRect();
    pop.style.left = (c.left - a.left) + 'px';
    pop.style.top = Math.max(6, c.top - a.top - 24) + 'px';
    els.arena.appendChild(pop);
    setTimeout(() => pop.remove(), 950);
  }

  function applyTyped(nv) {
    const w = S.words[S.idx];
    const prev = w.typed;
    if (nv === prev) return;
    if (nv.length > prev.length && nv.startsWith(prev)) {
      for (let k = prev.length; k < nv.length && !S.finished; k++) keystroke(k < w.t.length && nv[k] === w.t[k]);
    } else if (!(nv.length < prev.length && prev.startsWith(nv))) {
      // replacement (autocorrect, selection overwrite): count the changed tail
      let d = 0; while (d < nv.length && d < prev.length && nv[d] === prev[d]) d++;
      for (let k = d; k < nv.length && !S.finished; k++) keystroke(k < w.t.length && nv[k] === w.t[k]);
    }
    w.typed = nv;
    paintWord(S.idx);
  }

  function commitWord() {
    const w = S.words[S.idx];
    w.done = true;
    const correct = w.typed === w.t;
    if (correct) S.committedCorrect += w.t.length + 1;
    keystroke(correct); // the space
    paintWord(S.idx);
    if (S.finished) return;
    S.idx++;
    if (settings.mode === 'words' && S.idx >= S.words.length) { finish('words'); return; }
    if (settings.mode === 'time' && S.idx > S.words.length - 30) appendWords(50);
    paintWord(S.idx);
  }

  function onInput() {
    if (!S || S.finished) { els.input.value = ''; return; }
    let v = els.input.value;
    if (!S.started && v.trim().length) start();
    if (v.includes(' ')) {
      const parts = v.split(' ');
      for (let p = 0; p < parts.length - 1; p++) {
        applyTyped(parts[p]);
        if (S.finished) break;
        if (S.words[S.idx].typed.length) commitWord();
        if (S.finished) break;
      }
      v = parts[parts.length - 1];
      els.input.value = S.finished ? '' : v;
    }
    if (!S.finished) {
      applyTyped(v);
      const w = S.words[S.idx];
      // in word mode the last word finishes as soon as it is typed exactly
      if (!S.finished && settings.mode === 'words' && S.idx === S.words.length - 1 && w.typed === w.t) {
        w.done = true; S.committedCorrect += w.t.length; S.idx++; finish('words'); return;
      }
    }
    if (!S.finished) { placeCaret(); updateHud(); }
  }

  /* ---------- end of test ---------- */
  function finish(cause) {
    if (S.finished) return;
    S.finished = true;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (cause !== 'time') {
      S.elapsed = Math.max(0.5, (performance.now() - S.t0) / 1000);
      if (S.elapsed - S.samples.length > 0.35) S.samples.push(Math.round(netWpm(S.elapsed)));
    }
    if (!S.samples.length) S.samples.push(Math.round(netWpm()));
    const wpm = Math.round(netWpm());
    const acc = Math.floor(accuracy());
    const reasons = [];
    if (cause === 'mistakes') reasons.push(`${MISTAKE_LIMIT} mistakes and the text gave way`);
    else {
      if (acc < ACC_TARGET) reasons.push(`accuracy ${acc}% (needs ${ACC_TARGET}%)`);
      if (wpm < settings.target) reasons.push(`${wpm} WPM (needs ${settings.target})`);
    }
    const r = {
      pass: reasons.length === 0, cause, wpm, acc, raw: Math.round(rawWpm()), reasons,
      chars: charBreakdown(), time: S.elapsed, samples: S.samples.slice(), errSecs: S.errSecs.slice(),
    };
    els.arena.classList.remove('running', 'unstable');
    updateHud();
    els.input.blur();
    if (r.pass) succeed(r); else collapse(r);
  }

  function succeed(r) {
    showResults(r);
    if (!reduced()) Confetti.burst();
  }

  function collapse(r) {
    const letters = [...els.words.querySelectorAll('.ch')];
    const clip = els.wrap.getBoundingClientRect();
    const c = els.caret.getBoundingClientRect();
    els.caret.style.visibility = 'hidden';
    const n = Gravity.drop(letters, clip, { x: c.left, y: c.top + c.height / 2 }, reduced());
    els.arena.classList.add('collapsed');
    document.body.classList.add('has-pile');
    if (!reduced()) {
      document.body.classList.add('quake');
      setTimeout(() => document.body.classList.remove('quake'), 500);
    }
    r.fallen = n;
    setTimeout(() => { if (S.finished) showResults(r); }, reduced() ? 450 : 1250);
  }

  function showResults(r) {
    const res = els.results;
    res.classList.toggle('pass', r.pass);
    res.classList.toggle('fail', !r.pass);
    $('r-kicker').textContent = `${modeLabel()} test · target ${settings.target} wpm`;
    const failTitles = ['Collapsed!', 'Timber!', 'It all fell down', 'Gravity wins'];
    $('r-title').textContent = r.pass ? (r.wpm >= settings.target * 1.5 ? 'Blazing!' : 'Passed!') :
      (r.cause === 'mistakes' ? 'Collapsed!' : failTitles[(Math.random() * failTitles.length) | 0]);
    $('r-reason').textContent = r.pass
      ? `You beat ${settings.target} WPM at ${ACC_TARGET}%+ accuracy. The letters stay up. For now.`
      : `Failed on ${r.reasons.join(' and ')}.`;
    $('r-wpm').textContent = r.wpm;
    $('r-acc').textContent = r.acc + '%';
    $('r-raw').textContent = r.raw;
    $('r-streak').textContent = S.bestStreak;
    $('r-combo').textContent = 'x' + S.maxCombo;
    $('r-chars').textContent = `${r.chars.correct}/${r.chars.incorrect}/${r.chars.extra}/${r.chars.missed}`;
    $('r-time').textContent = (Math.round(r.time * 10) / 10) + 's';
    let isPb = false;
    if (r.pass) {
      const key = 'typefall:pb:' + modeKey();
      const pb = store.get(key, null);
      if (!pb || r.wpm > pb.wpm) { store.set(key, { wpm: r.wpm, acc: r.acc, at: Date.now() }); isPb = true; }
    }
    $('r-pb').hidden = !isPb;
    $('poke-hint').hidden = r.pass || reduced() || !window.Matter;
    $('poke-hint').textContent = matchMedia('(hover: none)').matches ? 'Psst: tap the pile.' : 'Psst: click the pile.';
    renderSpark(r.samples, r.errSecs, settings.target);
    els.arena.hidden = true;
    els.rules.hidden = true;
    res.hidden = false;
    S.result = r;
    updatePb();
    if (window.Leaderboard) Leaderboard.onResult({ pass: r.pass, wpm: r.wpm, acc: r.acc, mode: modeKey(), target: settings.target });
    els.sr.textContent = `${$('r-title').textContent} ${r.wpm} words per minute, ${r.acc} percent accuracy. ${$('r-reason').textContent} Press Tab to try again.`;
    $('r-title').focus({ preventScroll: true });
  }

  function renderSpark(samples, errSecs, target) {
    const svg = $('spark');
    const W = 320, H = 90, P = 6;
    const data = samples.length >= 2 ? samples : [samples[0] || 0, samples[0] || 0];
    const max = Math.max(target * 1.25, ...data) * 1.08 || 1;
    const x = i => P + i * (W - 2 * P) / (data.length - 1);
    const y = v => H - P - (v / max) * (H - 2 * P);
    const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const area = `M${x(0)},${H - P} L${pts.join(' L')} L${x(data.length - 1)},${H - P} Z`;
    const ty = y(target).toFixed(1);
    const dots = errSecs.map(t => {
      const i = Math.min(data.length - 1, Math.max(0, Math.round(t) - 1));
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(data[i]).toFixed(1)}" r="3.2" fill="#D90368" stroke="#0B0E13" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
    }).join('');
    const lastI = data.length - 1;
    svg.innerHTML = `
      <defs>
        <linearGradient id="sl" x1="0" x2="1"><stop offset="0" stop-color="#2274A5"/><stop offset="1" stop-color="#00CC66"/></linearGradient>
        <linearGradient id="sa" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#00CC66" stop-opacity=".28"/><stop offset="1" stop-color="#2274A5" stop-opacity="0"/></linearGradient>
      </defs>
      <line x1="${P}" x2="${W - P}" y1="${ty}" y2="${ty}" stroke="#F1C40F" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" opacity=".85"/>
      <path d="${area}" fill="url(#sa)"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="url(#sl)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      ${dots}
      <circle cx="${x(lastI).toFixed(1)}" cy="${y(data[lastI]).toFixed(1)}" r="4.5" fill="#00CC66" stroke="#0B0E13" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    svg.setAttribute('aria-label', `WPM over time: started at ${data[0]}, peaked at ${Math.max(...data)}, ended at ${data[lastI]}. Target ${target}.`);
  }

  /* ---------- focus & controls ---------- */
  function focusInput() {
    if (S && S.finished) return;
    els.input.focus({ preventScroll: true });
  }
  els.input.addEventListener('input', onInput);
  els.input.addEventListener('focus', () => els.arena.classList.remove('blurred'));
  els.input.addEventListener('blur', () => {
    setTimeout(() => { if (S && !S.finished && document.activeElement !== els.input) els.arena.classList.add('blurred'); }, 120);
  });
  els.arena.addEventListener('click', focusInput);

  document.addEventListener('keydown', e => {
    if (window.Leaderboard && Leaderboard.isOpen) return; // the dialog handles its own keys (Esc closes it)
    const claimOpen = !$('claim').hidden;
    if (e.key === 'Escape' && document.activeElement && document.activeElement.closest('#claim')) return;
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const a = document.activeElement;
      // while "Claim your spot" is showing, Tab from the title moves into the nickname box instead
      if (a === els.input || a === document.body || (a === $('r-title') && !claimOpen) || a == null) {
        e.preventDefault(); newRun(false); return;
      }
    }
    if (e.key === 'Escape') { e.preventDefault(); newRun(true); return; }
    // typing anywhere refocuses the text box
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && S && !S.finished && document.activeElement !== els.input
        && !(document.activeElement && document.activeElement.closest('button, a'))) {
      focusInput();
    }
  });

  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    settings.mode = b.dataset.mode; settings.value = +b.dataset.value;
    store.set('typefall:settings', settings); syncControls(); newRun(false);
  }));
  document.querySelectorAll('[data-target]').forEach(b => b.addEventListener('click', () => {
    settings.target = +b.dataset.target;
    store.set('typefall:settings', settings); syncControls(); newRun(false);
  }));
  function syncControls() {
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === settings.mode && +b.dataset.value === settings.value)));
    document.querySelectorAll('[data-target]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.target === settings.target)));
    els.ruleWpm.textContent = `${settings.target}+ WPM`;
  }

  $('again').addEventListener('click', () => newRun(false));
  $('copy').addEventListener('click', async () => {
    const r = S && S.result; if (!r) return;
    const text = `Typefall ${modeLabel()}: ${r.wpm} WPM, ${r.acc}% accuracy, ${r.pass ? 'passed' : 'collapsed'} (target ${settings.target}). ${location.href.split('#')[0]}`;
    const btn = $('copy');
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied!'; }
    catch { btn.textContent = 'Copy failed'; }
    setTimeout(() => { btn.textContent = 'Copy result'; }, 1600);
  });

  // poke the pile
  document.addEventListener('pointerdown', e => {
    if (e.target.closest('button, a, input, dialog, .results, .arena, .top, .hud')) return;
    Gravity.poke(e.clientX, e.clientY);
  });

  document.addEventListener('leaderboard:close', () => { if (S && !S.finished) focusInput(); });

  addEventListener('resize', () => { if (S && !S.finished) placeCaret(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (S && !S.finished) placeCaret(); });

  syncControls();
  newRun(false);

  // test hook
  window.__typefall = { get state() { return S; }, settings, MISTAKE_LIMIT, ACC_TARGET };
})();
