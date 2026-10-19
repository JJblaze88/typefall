# Typefall

**The typing test where failure has gravity.** Hit your target and you get confetti. Miss it and every letter on screen falls, tumbles and piles up on an invisible floor at the bottom of the window.

![Typefall failure: letters piled on the floor](screenshots/desktop-failure-pile.png)

## How to play

- Pick a length: **15s, 30s, 60s** or **25 words**, and a **target speed** (20, 30, 45 or 60 WPM).
- Start typing. The clock starts on your first key. Space moves to the next word, Backspace fixes the current one.
- **Pass:** finish with at least the target WPM **and** at least 90% accuracy.
- **Fail (the text falls):**
  - you finish under the target WPM, or
  - you finish under 90% accuracy, or
  - you make **10 mistakes** at any point. That collapses the text right away. The *Stability* meter shows how many you have left.

A mistake is any wrong or extra character, plus a space typed on a word that isn't right yet. Accuracy is correct keystrokes divided by all keystrokes. WPM is net: correctly typed characters (with their spaces) / 5 / minutes.

## Features

- Live WPM, accuracy, streak and a combo meter (x1 to x5, one level every 10 correct keys in a row).
- Correct letters pop in emerald, wrong letters shake in berry, and the text wobbles when you're down to 3 lives.
- Real physics on failure ([matter-js](https://brm.io/matter-js/), vendored in `vendor/`). After a fall, click or tap the pile to knock letters around.
- Confetti in the palette colours when you pass.
- A results card with WPM, raw WPM, accuracy, best streak, max combo, a character breakdown and a WPM-over-time sparkline with your mistakes marked.
- Personal best for each mode, saved in `localStorage` (passed runs only).
- **Top 10 leaderboard** for each mode (15s, 30s, 60s, 25 words). Pass a test with a Top 10 score and a *Claim your spot!* box appears: type a nickname and your entry drops onto the board. Open it any time with the **Top 10** button. See [Leaderboard](#leaderboard).
- Shortcuts: <kbd>Tab</kbd> new test, <kbd>Esc</kbd> same words again, <kbd>Shift</kbd>+<kbd>Tab</kbd> leaves the text box.
- Mobile: tap the text to bring up the keyboard (a hidden input handles typing).
- `prefers-reduced-motion`: no shaking, wobble or confetti, and the failure fall is a simple straight drop with no spin or bounce.

## Palette

| Rich Cerulean | Blaze Orange | Bright Amber | Berry Lipstick | Emerald |
|---|---|---|---|---|
| `#2274A5` | `#F75C03` | `#F1C40F` | `#D90368` | `#00CC66` |

## Leaderboard

Just a nickname and a score: no emails, accounts or personal data.

- **Backend:** one Netlify Function, `netlify/functions/leaderboard.mjs`, at `/api/leaderboard`. Scores are stored in **Netlify Blobs** (store `typefall-leaderboard`, region `eu-central-1`, one key per mode). Netlify sets Blobs up automatically, so there's nothing to configure.
  - `GET /api/leaderboard` returns the top 10 for every mode.
  - `POST /api/leaderboard` with `{ mode, name, wpm, acc, target }` submits a passed score.
- **Rules** (in `netlify/lib/leaderboard-core.mjs`, unit-tested):
  - Ranked by WPM, then accuracy, then whoever got there first.
  - Only passed tests: WPM must be at least the target, and accuracy must be 90 to 100.
  - WPM over 250, an unknown mode or a malformed body is rejected.
  - Each nickname keeps only its best score per mode. The top 50 are stored, and the top 10 are shown.
  - Nicknames: 1 to 12 Latin letters, numbers, spaces or basic symbols. A small built-in word list blocks rude names, including leetspeak (`sh1t`), spacing (`f u c k`) and stretched letters (`fuuuck`).
  - Each IP gets 5 submissions per minute. The limiter stores a salted hash of the IP, never the IP itself.
  - There's a hidden honeypot field for bots.
  - Writes use an ETag check with retries, so two scores sent at the same moment don't overwrite each other.
  - Nicknames are always rendered with `textContent`, never `innerHTML`.
- **Not tamper-proof.** The browser reports its own score, so someone determined can post a fake one with a script. The checks only stop obvious junk. To wipe a board, go to the Netlify UI → *Data & Storage → Blobs → typefall-leaderboard* and delete `board/<mode>`.
- **Offline:** if the API can't be reached (opened from `file://`, a plain static server, or an outage), the board says "Leaderboard offline" and the typing test works as normal.

## Run locally

It's static HTML, CSS and JS with no build step.

```bash
python3 -m http.server 8000   # the game only; the leaderboard shows "offline"
```

With the leaderboard (Netlify CLI, no login needed; scores go to a local sandbox in `.netlify/`, never the live site):

```bash
npm install
npx netlify-cli dev --offline   # http://localhost:8888
```

## Deploy (Netlify)

`netlify.toml` publishes the repo root (`publish = "."`) with no build command. In Netlify: **Add new site → Import an existing project → GitHub → typefall**, and keep the defaults.

Netlify installs `package.json` (just `@netlify/blobs`) and bundles the function automatically. The share-image tags use the absolute `https://typefall-play.netlify.app/og.png`. If the domain changes, update them in `index.html`.

## Tests

`tests/e2e.py` uses Playwright with headless Chrome. It plays a passing 15s run, a 10-mistake collapse, a too-slow 25-word run, a 390px mobile run and a reduced-motion run. It checks the outcomes, that the fallen letters stay in the viewport, the frame rate during the fall and that there are no console errors. Screenshots go to `screenshots/`.

```bash
pip install playwright && python3 tests/e2e.py   # CHROME=/path/to/chrome to override
node --test tests/leaderboard-core.test.mjs       # leaderboard rules: ranking, validation, nickname filter, rate limit
LEADERBOARD_RATE_LIMIT=1000 npx netlify-cli dev --offline &   # then:
python3 tests/leaderboard_e2e.py                  # API + claim flow + offline fallback, seeds fake demo names locally
```

`e2e.py` also checks that the page copes with no leaderboard API at all.

## Credits

Made by [Nebula Digital](https://nebula-digital.com). Physics by matter-js (MIT, © Liam Brummitt). Fonts: Space Grotesk and JetBrains Mono (Google Fonts, OFL).
