"""Headless Chrome check for Typefall: passing run, failing run, mobile, reduced motion.
Run from the repo root:  python3 tests/e2e.py   (serves the folder on :8765)"""
import http.server, threading, functools, os, sys, time, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'screenshots')
os.makedirs(SHOTS, exist_ok=True)
PORT = 8765
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{PORT}/'
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
errors, results = [], {}

def watch(page, tag):
    # A plain static server has no /api/leaderboard, so its 404 is expected here (the page shows "Leaderboard offline").
    page.on('console', lambda m: m.type in ('error',) and '/api/leaderboard' not in (m.location or {}).get('url', '')
            and errors.append(f'[{tag}] console: {m.text}'))
    page.on('pageerror', lambda e: errors.append(f'[{tag}] pageerror: {e}'))

def words(page):
    return page.evaluate('() => window.__typefall.state.words.map(w => w.t)')

def state(page, expr):
    return page.evaluate(f'() => {{ const s = window.__typefall.state; return {expr}; }}')

def fps(page, ms=1500):
    return page.evaluate('''ms => new Promise(r => { let n = 0, t0 = performance.now();
      const f = t => { n++; if (t - t0 < ms) requestAnimationFrame(f); else r(n / ((t - t0) / 1000)); }; requestAnimationFrame(f); })''', ms)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])

    # ---------- desktop ----------
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
    page = ctx.new_page(); watch(page, 'desktop')
    page.goto(URL); page.wait_for_load_state('networkidle')
    page.click('button[data-mode="time"][data-value="15"]')
    page.click('button[data-target="30"]')
    page.wait_for_timeout(300)
    assert page.evaluate('document.activeElement.id') == 'input', 'input should auto-focus'
    page.screenshot(path=f'{SHOTS}/desktop-idle.png')

    # passing run: 15 s, fast and accurate, one typo for realism
    ws = words(page)
    i = 0; t0 = time.time(); shot_mid = False
    while not state(page, 's.finished'):
        w = ws[i]
        if i == 4:
            page.keyboard.type(w[:-1] + 'q', delay=160); page.keyboard.press('Backspace'); page.keyboard.type(w[-1], delay=160)
        else:
            page.keyboard.type(w, delay=150)
        page.keyboard.press('Space')
        i += 1
        if not shot_mid and time.time() - t0 > 5:
            page.screenshot(path=f'{SHOTS}/desktop-mid-test.png'); shot_mid = True
        if i >= len(ws) - 1: ws = words(page)
    page.wait_for_timeout(700)
    page.screenshot(path=f'{SHOTS}/desktop-success.png')
    results['pass'] = page.evaluate('() => ({...window.__typefall.state.result, samples: undefined, errSecs: undefined, chars: undefined})')
    results['pass_title'] = page.inner_text('#r-title')
    results['pb_text'] = page.inner_text('#pb')
    # no leaderboard API on a static server: the results card says so and the test keeps working
    page.wait_for_selector('#lb-note:not([hidden])', timeout=8000)
    results['offline_note'] = page.inner_text('#lb-note')
    results['claim_hidden'] = page.evaluate("document.getElementById('claim').hidden")
    page.wait_for_timeout(2500)
    page.screenshot(path=f'{SHOTS}/desktop-success-card.png')

    # failing run: Tab restarts, then 10 mistakes collapse the text
    page.keyboard.press('Tab'); page.wait_for_timeout(300)
    assert state(page, '!s.started && !s.finished'), 'Tab should restart'
    ws = words(page)
    page.keyboard.type(' '.join(ws[:9]) + ' ', delay=150)
    for k in range(10):
        page.keyboard.type('x', delay=40)
    page.wait_for_timeout(150)
    results['fail_fps'] = round(fps(page, 1500), 1)
    page.wait_for_timeout(1800)
    results['fallen'] = page.evaluate("document.querySelectorAll('#fall-layer .fallen').length")
    results['fail'] = page.evaluate('() => ({...window.__typefall.state.result, samples: undefined, errSecs: undefined, chars: undefined})')
    results['fail_title'] = page.inner_text('#r-title')
    # every fallen letter should be inside the viewport and resting near the floor
    results['pile'] = page.evaluate('''() => { const r = [...document.querySelectorAll('#fall-layer .fallen')].map(e => e.getBoundingClientRect());
      return { maxBottom: Math.max(...r.map(x => x.bottom)), minTop: Math.min(...r.map(x => x.top)), offscreen: r.filter(x => x.bottom > innerHeight + 12 || x.right < 0 || x.left > innerWidth).length, vh: innerHeight }; }''')
    page.screenshot(path=f'{SHOTS}/desktop-failure-pile.png')
    # poke the pile
    page.mouse.click(720, 880); page.wait_for_timeout(250)
    page.screenshot(path=f'{SHOTS}/desktop-failure-poke.png')
    page.wait_for_timeout(1500)

    # slow-run fail (time runs out under target) in words mode, then Esc reset
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    page.click('button[data-mode="words"]'); page.click('button[data-target="60"]'); page.wait_for_timeout(200)
    ws = words(page)
    page.keyboard.type(' '.join(ws), delay=330)
    page.wait_for_timeout(2600)
    results['words_mode'] = page.evaluate('() => ({pass: window.__typefall.state.result.pass, wpm: window.__typefall.state.result.wpm, reasons: window.__typefall.state.result.reasons})')
    page.screenshot(path=f'{SHOTS}/desktop-failure-too-slow.png')
    page.click('button[data-mode="time"][data-value="30"]'); page.click('button[data-target="30"]')
    ctx.close()

    # ---------- mobile 390 ----------
    mctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    m = mctx.new_page(); watch(m, 'mobile')
    m.goto(URL); m.wait_for_load_state('networkidle'); m.wait_for_timeout(300)
    m.tap('#arena')
    m.screenshot(path=f'{SHOTS}/mobile-390-idle.png')
    ws = words(m)
    m.keyboard.type(' '.join(ws[:9]) + ' ', delay=170)
    m.screenshot(path=f'{SHOTS}/mobile-390-mid-test.png')
    for k in range(10): m.keyboard.type('z', delay=40)
    m.wait_for_timeout(3000)
    m.screenshot(path=f'{SHOTS}/mobile-390-failure.png')
    results['mobile_overflow'] = m.evaluate('document.documentElement.scrollWidth > innerWidth')
    mctx.close()

    # ---------- reduced motion ----------
    rctx = b.new_context(viewport={'width': 1280, 'height': 800}, reduced_motion='reduce')
    r = rctx.new_page(); watch(r, 'reduced')
    r.goto(URL); r.wait_for_load_state('networkidle'); r.wait_for_timeout(200)
    ws = words(r)
    r.keyboard.type(' '.join(ws[:6]) + ' ', delay=150)
    for k in range(10): r.keyboard.type('x', delay=30)
    r.wait_for_timeout(1500)
    r.screenshot(path=f'{SHOTS}/reduced-motion-failure.png')
    results['reduced_fallen'] = r.evaluate("document.querySelectorAll('#fall-layer .fallen').length")
    rctx.close()
    b.close()

srv.shutdown()
print(json.dumps(results, indent=2))
print('ERRORS:', errors or 'none')
ok = ('offline' in results['offline_note'].lower() and results['claim_hidden'] and results['pass']['pass'] and not results['fail']['pass'] and results['fallen'] > 20
      and results['pile']['offscreen'] == 0 and not results['words_mode']['pass'] and not results['mobile_overflow'] and not errors)
print('RESULT:', 'OK' if ok else 'PROBLEMS')
sys.exit(0 if ok else 1)
