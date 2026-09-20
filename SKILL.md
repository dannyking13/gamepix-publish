---
name: gamepix-publish
description: Integrate the GamePix SDK into any HTML5 game and publish it end-to-end on the GamePix developer dashboard (create game, fill Info/Assets/Editorial/Build tabs, upload ZIP, submit for review). Use when the user wants to "publish a game on GamePix", "integrate gamepix sdk", "submit a game to gamepix", or "release an html5 game".
---

# GamePix SDK Integration & Automated Publishing

This skill lets an AI agent take ANY HTML5 game and: (1) integrate the GamePix SDK v3 correctly, (2) package it into a compliant ZIP, and (3) publish it end-to-end on `my.gamepix.com` (dashboard) via Playwright — from login to "Submit for Review", without any human interaction.

Everything below was validated in a real end-to-end run (game created, assets uploaded, build processed `ready`, status `review`).

## 0. Prerequisites

- Node.js + Playwright (`npm i playwright` + `npx playwright install chromium`)
- `xvfb-run` available (Linux) — run the browser HEADED under Xvfb, never headless (Cloudflare)
- GamePix developer account: **email + password** (dashboard login is direct email/password at `https://my.gamepix.com/login`; the "Sign in with Xsolla" button on www.gamepix.com is NOT needed)
- User agent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36`

## 1. Hard-won platform knowledge (read first!)

### Cloudflare traps
- `www.gamepix.com` is behind Cloudflare. **Headless is blocked.** Launch headed + `--disable-blink-features=AutomationControlled` under `xvfb-run -a`.
- Wait out "Just a moment..." by polling `page.title()` up to 45s.
- **Block trackers with `page.route()`** — this is what makes the SPA boot reliably:
  `page.route(/doubleclick|criteo|tiktok|clarity|googletagmanager|google-analytics|fundingchoices|adservice|gpt\.js|pubads/, r => r.abort())`
- If the homepage renders a degraded static fallback (no `#input-search`), just reload and retry up to ~8 times; it eventually loads the full SvelteKit app.
- `curl` gets 403 on `www.gamepix.com` and its `/_app/*` chunks — use the browser for anything there. `partners.gamepix.com` and `my.gamepix.com` are friendlier.

### Dashboard architecture (verified)
- Login page: `https://my.gamepix.com/login` — Angular/Ionic form `#login-form`, fields `ion-input[name="email"] input.native-input` and `ion-input[name="password"] input.native-input`, submit button `#sign-in` (disabled until Angular detects input — use `pressSequentially` for REAL keystrokes, then click).
- Game list: `https://my.gamepix.com/games` — game cards are `.data-item` with `p.title[title="<namespace>"]`.
- Game edit: `https://my.gamepix.com/games/<namespace>` — Ionic segment tabs: `ion-segment-button[value="info" | "assets" | "editorial" | "build" | "review"]` (label "Submit for Review" = value `review`).
- APIs: `api.gamepix.com/v3/devs/*` (drafts, uploads) and `api.partner.gamepix.com` (categories/companies). Watch responses with `page.on('response')` to confirm success (`PUT .../game-drafts/<ns>` 200 = saved; `PUT .../game-drafts/<ns>/review` 200 = submitted; `POST .../upload/asset` 200 = asset OK; S3 PUT = build upload OK).

### Ionic form interactions (critical)
- **Always use real Playwright clicks** (`locator.click()`) — they pierce shadow DOM and are trusted events. `el.click()` via `page.evaluate` silently fails on Ionic/Angular components (state doesn't update, Save stays disabled).
- Text inputs: click the native `input` inside `ion-input`/`ion-textarea` and `pressSequentially`.
- `ion-select` opens an `ion-popover`; pick an option with a real click on `ion-popover ion-item` (hasText), then the popover closes itself.
- `ionic-selectable` (tag pickers): real click on `.ionic-selectable` opens a modal list of `.ionic-selectable-item`s; real click on the desired item closes it.
- `ion-checkbox`: real click toggles (verify via `classList.contains('checkbox-checked')`).
- An `ion-loading` overlay can block clicks: `await page.locator('ion-loading').first().waitFor({ state: 'hidden', timeout: 10000 })` before clicking tabs.
- A cookie/payment modal may appear on the games page: click `OK` / `Accept all` if visible before anything else.

## 2. Integrate the SDK (mandatory first script)

Insert as the FIRST script in `<head>` of `index.html`:

```html
<head>
  <script src="https://integration.gamepix.com/sdk/v3/gamepix.sdk.js"></script>
  ...
</head>
```

API (all optional except noted; errors are logged, never throw):

| Method | When to call |
|---|---|
| `GamePix.loading(pct)` | during load, number 0–100 |
| `GamePix.loaded()` | ONCE, when game is playable — MUST precede any other SDK call |
| `GamePix.localStorage.setItem/getItem/removeItem(key[, val])` | instead of native localStorage (string keys/values) |
| `GamePix.interstitialAd().then(res => {...})` | between levels — PAUSE game+audio before, RESUME in callback; call freely, fill is decided server-side |
| `GamePix.rewardAd().then(res => res.success)` | optional rewards; disclose the reward first; user must be able to skip |
| `GamePix.updateScore(n)` | every score change (positive integer) |
| `GamePix.updateLevel(n)` | every level change (positive integer) |
| `GamePix.lang()` | returns 2-letter code (`en`,`fr`,`it`,`de`,`es`,...) — default to English |
| `GamePix.happyMoment()` | unlocks/achievements/cool events |

Anti-scroll snippet (recommended):
```js
window.addEventListener("keydown", e => { if (["ArrowUp","ArrowDown"," "].includes(e.key)) e.preventDefault(); });
window.addEventListener("wheel", e => e.preventDefault(), { passive: false });
```

SDK error strings: `GAMEPIX_LOADED_NOT_CALLED`, `LOADED_ALREADY_CALLED`, `UPDATE_SCORE_VALUE_IS_NOT_A_NUMBER`, `UPDATE_LEVEL_VALUE_IS_NOT_A_NUMBER`, `LOADING_VALUE_IS_NOT_A_NUMBER`, `INTERSTITIAL_AD_CALLED_TWICE`, `REWARD_AD_CALLED_TWICE`, `KEY_OR_VALUE_FOR_LOCALSTORAGE_NOT_A_STRING`, `GAMEPIX_PLAYER_NOT_FOUND`.

## 3. Compliance checklist (review will fail otherwise)

- ZIP zipped at FILE level: `index.html` at archive root (not inside a folder). Accepts `.zip` (or `.gpx` from the Unity plugin).
- All resources relative paths; no external links/analytics/ads/third-party SDKs; no `alert`/`confirm`; no "Rotate device" prompt; no quit button; no religious/explicit content.
- Pause game AND audio during ads and on `visibilitychange`; iframe-friendly at 640×480; `<meta name="viewport" content="...user-scalable=NO...">`; `touch-action:none` on body.
- Assets: icon **256×256** (≤1MB), cover **1360×850** (≤1.5MB), JPG/PNG, representative of the game, title text on assets must match game title.
- Description 100–500 chars, unique, no AI boilerplate; how-to-play ≤500 chars (controls first, Desktop/Mobile sections).
- Keep the build small. One ad at a time, between levels only, never timer-based.

## 4. Automated publishing via Playwright

Full working implementation: `scripts/publish.js` (this repo). Usage:

```bash
GPX_EMAIL=you@example.com GPX_PASSWORD='secret' GPX_TITLE="My Game" \
GPX_MAIN_TAG="puzzle" GPX_DESCRIPTION="100-500 char original description..." \
GPX_HOW_TO_PLAY="Desktop\n... Mobile\n..." GPX_ICON=icon.png GPX_COVER=cover.png \
GPX_ZIP=game-v1.0.0.zip GPX_RELEASE_NOTES="First release." \
xvfb-run -a node scripts/publish.js
```

The script performs, in order (each step verified by an API 200 or DOM state):
1. Login (re-login if redirected to /login; saves storageState to reuse the session).
2. Games page → dismiss payment modal if present.
3. **Create New Game** modal: title, main tag (ionic-selectable → item matching the tag name), description (100–500 chars) → `Create` → game appears in list (namespace = slugified title).
4. Open `games/<ns>`; **Info tab**: fix main tag if needed, Orientation (`ion-select[name=orientation]` → Landscape), Desktop/Mobile friendly checkboxes, Game engine (`ion-select[name=gameEngine]` → Cocos/HTML5-JS/...), SDK integration checkbox → `Save` → wait for "Successfully updated!" toast and the warning "Please set Game Orientation" to disappear.
5. **Assets tab**: real-click the two `Add` buttons + `waitForEvent('filechooser')` → setFiles(icon/cover) → expect `POST .../upload/asset` 200 twice; tab text becomes "Assets: icon, cover" with "Modify" buttons.
6. **Editorial tab**: fill `textarea[name=howToPlay]` (≤500 chars) → click enabled `Save` (PUT 200).
7. **Build tab**: click `Browse File` + filechooser → setFiles(zip) → click enabled `Upload` → S3 PUT 200 → poll until "Build ready, your new version code is: <code>" (processing may take minutes; reload the tab while polling).
8. **Review tab**: fill the visible textarea (release notes) → click `Submit for review` → expect `PUT .../game-drafts/<ns>/review` 200 and the page badge to switch from EDIT to **REVIEW**.
9. Verify final state: `page.on('response')` capture of `GET api.gamepix.com/v3/devs/game-drafts/ns/<ns>` should show `"status":"review"`, `"buildStatus":"ready"`, `"buildUploaded":true`, `"buildMessage":"The build is reviewable"`.

### Gotchas that will bite you
- After clicking Create, the game list count increments (e.g. "4 Current Total") — use that + the card with `p[title="<ns>"]` to confirm.
- The Info `Save` is `ion-button` **disabled** until every required field is valid; if your synthetic state didn't register, re-do the selects with REAL clicks.
- `has-text:` filters match substrings; prefer exact regex `/^Save$/i` and check `hasAttribute('disabled')` before clicking.
- Save buttons exist per-tab (Info/Editorial); always click the last visible enabled one, or scope by the tab container.
- Processing a ~8MB zip takes 1–3 min. Poll, don't panic. Status strings: "Your build is in processing..." → "Build ready, your new version code is: X" → review.
- If a session expires mid-flow, the page redirects to `/login`; re-login (credentials typed with pressSequentially) then `goto` the target URL again.
- Never `page.evaluate(window.open=...)`-patch or JS-click Ionic components; trusted clicks only.

## 5. Creating assets programmatically (PIL)

See `scripts/make_assets.py` — draws a decent icon (256×256) and 16:9 cover (1360×850) with flat shapes + title text; keep both < 1MB (PNG optimize=True). Ensure the in-asset title matches the game title (review rule).

## 6. What "done" looks like

- Games list shows the game with status badge **REVIEW** (was **EDIT**).
- Draft API: `status:"review"`, `buildStatus:"ready"`, `buildMessage:"The build is reviewable"`.
- Notify the user: game submitted, QA typically takes a few days; edits are locked while in review (status switches to EDIT again if changes are requested).

## References
- SDK doc: https://partners.gamepix.com/sdk/doc/javascript (per-engine docs: /cocos, /construct2, /construct3, /gdevelop-5, /godot-plugin, /unity-plugin)
- Submission guidelines: https://partners.gamepix.com/guidelines/submission
- Dashboard: https://my.gamepix.com (login: /login)
