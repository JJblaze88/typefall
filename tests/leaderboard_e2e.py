"""Leaderboard checks against a running `netlify dev` (function + local Blobs sandbox).

  LEADERBOARD_RATE_LIMIT=1000 netlify dev --offline     # in one terminal (higher limit so the test can seed)
  python3 tests/leaderboard_e2e.py                      # in another (BASE=http://localhost:8888 to override)

Seeds the LOCAL board with obviously fake demo names (nothing here touches the live site),
then checks the API rules, the claim flow, ranking, the profanity filter and the offline fallback.
Screenshots go to screenshots/leaderboard-*.png and claim-spot-desktop.png."""
import json, os, sys, time, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:8888')
API = BASE + '/api/leaderboard'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'screenshots')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
checks, errors = {}, []

def req(method, body=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(API, data=data, method=method, headers={'content-type': 'application/json'} if data else {})
    try:
        with urllib.request.urlopen(r) as res: return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')

def check(name, cond, info=''):
    checks[name] = bool(cond)
    if not cond: print('FAIL', name, info)

# ---------- API ----------
st, d = req('GET')
check('get_shape', st == 200 and set(d['boards']) == {'time-15', 'time-30', 'time-60', 'words-25'}, d)
DEMO = [('Demo Dash', 131, 99), ('Fake Fox', 118, 97), ('Test Turtle', 104, 98), ('Mock Moth', 88, 96), ('Sample Sam', 76, 95),
        ('Dummy Duck', 63, 94), ('Lorem Lynx', 52, 93), ('Ipsum Owl', 44, 92), ('Fakey Fern', 33, 91)]
for mode in ('time-15', 'time-30', 'time-60', 'words-25'):
    for i, (n, w, a) in enumerate(DEMO):
        st, d = req('POST', {'mode': mode, 'name': n, 'wpm': w - (0 if mode == 'time-15' else i), 'acc': a, 'target': 20})
        assert st == 201, (st, d)
# tiebreaker: same WPM, higher accuracy ranks first
req('POST', {'mode': 'time-60', 'name': 'Tie Low', 'wpm': 70, 'acc': 91, 'target': 30})
st, d = req('POST', {'mode': 'time-60', 'name': 'Tie High', 'wpm': 70, 'acc': 99, 'target': 30})
names = [e['name'] for e in d['board']]
check('tiebreak_accuracy', names.index('Tie High') < names.index('Tie Low'), names)
check('board_sorted', all((a['wpm'], a['acc']) >= (b['wpm'], b['acc']) for a, b in zip(d['board'], d['board'][1:])))
check('top10_only', len(d['board']) == 10, len(d['board']))
st, d = req('POST', {'mode': 'time-30', 'name': 'Cheaty', 'wpm': 400, 'acc': 99, 'target': 30})
check('reject_400_wpm', st == 400 and 'WPM' in d['error'], (st, d))
st, d = req('POST', {'mode': 'time-30', 'name': 'Sloppy', 'wpm': 60, 'acc': 85, 'target': 30})
check('reject_low_acc', st == 400, (st, d))
st, d = req('POST', {'mode': 'time-30', 'name': 'Over', 'wpm': 60, 'acc': 101, 'target': 30})
check('reject_acc_over_100', st == 400, (st, d))
st, d = req('POST', {'mode': 'time-45', 'name': 'Moder', 'wpm': 60, 'acc': 99, 'target': 30})
check('reject_bad_mode', st == 400, (st, d))
st, d = req('POST', raw=b'{"mode": "time-30", ')
check('reject_malformed', st == 400, (st, d))
st, d = req('POST', {'mode': 'time-30', 'name': 'fuuuck', 'wpm': 60, 'acc': 99, 'target': 30})
check('reject_profanity', st == 400 and d.get('code') == 'rude', (st, d))
st, d = req('POST', {'mode': 'time-30', 'name': '<img src=x>', 'wpm': 60, 'acc': 99, 'target': 30})
check('reject_html_name', st == 400, (st, d))
st, d = req('POST', {'mode': 'time-30', 'name': 'Bot', 'wpm': 99, 'acc': 99, 'target': 30, 'website': 'spam.example'})
st2, d2 = req('GET')
check('honeypot_not_stored', st == 200 and 'Bot' not in [e['name'] for e in d2['boards']['time-30']], d2['boards']['time-30'])

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])

    # ---------- desktop: board, play, claim, fresh entry ----------
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    # the deliberate rude-nickname submit returns 400, which Chrome logs; that one is expected
    page.on('console', lambda m: m.type == 'error' and not ('/api/leaderboard' in (m.location or {}).get('url', '') and '400' in m.text)
            and errors.append(f'console: {m.text}'))
    page.goto(BASE + '/'); page.wait_for_load_state('networkidle')
    page.click('button[data-mode="time"][data-value="15"]'); page.click('button[data-target="30"]')
    page.click('#lb-open')
    page.wait_for_selector('#lb-list .lb-row'); page.wait_for_timeout(900)
    check('dialog_tab_matches_mode', page.get_attribute('#lbt-time-15', 'aria-selected') == 'true')
    check('dialog_rows', page.locator('#lb-list .lb-row').count() == 9)
    page.screenshot(path=f'{SHOTS}/leaderboard-desktop.png')
    # keyboard: arrow to the next tab, Esc closes and returns to the test
    page.focus('#lbt-time-15'); page.keyboard.press('ArrowRight'); page.wait_for_timeout(300)
    check('tabs_arrow_keys', page.get_attribute('#lbt-time-30', 'aria-selected') == 'true')
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    check('esc_closes_dialog', not page.evaluate("document.getElementById('lb').open"))
    check('focus_back_to_input', page.evaluate('document.activeElement.id') == 'input')

    ws = page.evaluate('() => window.__typefall.state.words.map(w => w.t)'); i = 0
    while not page.evaluate('window.__typefall.state.finished'):
        page.keyboard.type(ws[i], delay=150); page.keyboard.press('Space'); i += 1
        if i >= len(ws) - 1: ws = page.evaluate('() => window.__typefall.state.words.map(w => w.t)')
    res = page.evaluate('({wpm: window.__typefall.state.result.wpm, acc: window.__typefall.state.result.acc, pass: window.__typefall.state.result.pass})')
    page.wait_for_selector('#claim:not([hidden])', timeout=8000)
    expect_rank = 1 + sum(1 for n, w, a in DEMO if (w, a) >= (res['wpm'], res['acc']))
    check('claim_shows_rank', f'#{expect_rank}' in page.inner_text('#claim-sub'), (page.inner_text('#claim-sub'), expect_rank, res))
    # Tab from the results title goes into the nickname box (doesn't restart while claim is open)
    page.focus('#r-title'); page.keyboard.press('Tab')
    check('tab_to_nickname', page.evaluate('document.activeElement.id') == 'nick')
    # profanity filter through the UI
    page.fill('#nick', 'B1tch'); page.click('#claim-btn')
    page.wait_for_function("document.getElementById('claim-msg').textContent.includes('friendlier')", timeout=6000)
    check('ui_profanity_message', True)
    page.fill('#nick', 'Demo Pip')
    page.wait_for_timeout(2600)  # let confetti settle
    page.screenshot(path=f'{SHOTS}/claim-spot-desktop.png')
    page.click('#claim-btn')
    page.wait_for_selector('#lb[open] .lb-row.fresh'); page.wait_for_timeout(1900)
    fresh = page.evaluate("""() => { const r = document.querySelector('.lb-row.fresh');
      return { rank: +r.querySelector('.lb-rank').textContent, name: r.querySelector('.lb-name').textContent, cls: r.className }; }""")
    check('fresh_entry_highlighted', fresh['name'] == 'Demo Pip' and fresh['rank'] == expect_rank, fresh)
    check('nickname_not_html', page.evaluate("[...document.querySelectorAll('.lb-name')].every(n => !n.querySelector('img,script'))"))
    page.screenshot(path=f'{SHOTS}/leaderboard-fresh-entry.png')
    page.keyboard.press('Escape'); page.wait_for_timeout(200)
    check('note_after_claim', f'#{expect_rank}' in page.inner_text('#lb-note'), page.inner_text('#lb-note'))
    check('nick_remembered', page.evaluate("localStorage.getItem('typefall:nick')") == 'Demo Pip')
    st, d = req('GET')
    check('api_has_entry', any(e['name'] == 'Demo Pip' and e['wpm'] == res['wpm'] for e in d['boards']['time-15']))
    # next pass pre-fills the remembered nickname
    page.keyboard.press('Tab'); page.wait_for_timeout(200)
    check('tab_restarts_after_claim', page.evaluate('!window.__typefall.state.started'))
    ctx.close()

    # ---------- mobile 390 ----------
    m = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True).new_page()
    m.on('pageerror', lambda e: errors.append(f'mobile pageerror: {e}'))
    m.goto(BASE + '/'); m.wait_for_load_state('networkidle')
    m.tap('#lb-open'); m.wait_for_selector('#lb-list .lb-row'); m.wait_for_timeout(900)
    check('mobile_no_overflow', not m.evaluate('document.documentElement.scrollWidth > innerWidth'))
    check('mobile_dialog_fits', m.evaluate("document.getElementById('lb').getBoundingClientRect().right <= innerWidth"))
    m.screenshot(path=f'{SHOTS}/leaderboard-mobile-390.png')
    m.context.close()

    # ---------- reduced motion: no drop animation classes ----------
    rc = b.new_context(viewport={'width': 1280, 'height': 800}, reduced_motion='reduce'); r = rc.new_page()
    r.goto(BASE + '/'); r.wait_for_load_state('networkidle')
    r.click('#lb-open'); r.wait_for_selector('#lb-list .lb-row')
    check('reduced_motion_no_anim', r.locator('.lb-row.in, .lb-row.drop').count() == 0)
    rc.close()

    # ---------- offline fallback: API unreachable ----------
    oc = b.new_context(viewport={'width': 1280, 'height': 800}); o = oc.new_page()
    o.route('**/api/leaderboard*', lambda route: route.abort())
    o.goto(BASE + '/'); o.wait_for_load_state('domcontentloaded'); o.wait_for_timeout(500)
    o.click('#lb-open'); o.wait_for_selector('.lb-status.off')
    check('offline_dialog', 'Leaderboard offline' in o.inner_text('#lb-status'))
    o.screenshot(path=f'{SHOTS}/leaderboard-offline.png')
    o.keyboard.press('Escape'); o.wait_for_timeout(200)
    o.keyboard.type('the', delay=60)
    check('offline_test_still_works', o.evaluate('window.__typefall.state.started'))
    oc.close()
    b.close()

print(json.dumps(checks, indent=2))
print('ERRORS:', errors or 'none')
ok = all(checks.values()) and not errors
print('RESULT:', 'OK' if ok else 'PROBLEMS')
sys.exit(0 if ok else 1)
