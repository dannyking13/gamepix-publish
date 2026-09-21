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
- `ionic-selectable` (tag pickers): real click on `.ionic-selectable` opens a modal list of `.ionic-selectable-item`s; real click on the desired item closes it. There are TWO pickers on the Info tab: **first = Main tag (single), second = Extra/secondary tags (multi-select)** — the second one stays open after clicking items; confirm with the modal footer button (OK/Save/Done). `publish.js` automates this via `GPX_EXTRA_TAGS` (comma-separated).
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

### 2a. Games coming from Poki or GameSnacks: install the AD BRIDGE (ads are the priority!)

Most portal games call their platform SDK for ads (`PokiSDK.commercialBreak()`, `GameSnacks.ad.break(...)`) and lifecycle events. If you strip that SDK, ads silently stop working. **Never ship a no-op driver** — use the validated bridges in `scripts/bridges/` (load as the FIRST script, before any game script):

| Game calls | Bridge | Real GamePix call |
|---|---|---|
| `PokiSDK.commercialBreak()` | `bridges/poki_bridge.js` | `GamePix.interstitialAd()` |
| `PokiSDK.rewardedBreak()` | `bridges/poki_bridge.js` | `GamePix.rewardAd()` |
| `PokiSDK.happyTime()` | `bridges/poki_bridge.js` | `GamePix.happyMoment()` |
| `PokiSDK.gameLoadingProgress/Finished()` | `bridges/poki_bridge.js` | `GamePix.loading()/loaded()` |
| `GameSnacks.ad.break({type:"next"})` | `bridges/snacks_bridge.js` | `GamePix.interstitialAd()` |
| `GameSnacks.ad.break({type:"reward"})` | `bridges/snacks_bridge.js` | `GamePix.rewardAd()` (full beforeAd→beforeReward→showAdFn→adViewed→afterAd→adBreakDone flow) |
| `GameSnacks.score.update(n)` / `game.levelComplete(n)` | `bridges/snacks_bridge.js` | `GamePix.updateScore(n)` / `updateLevel(n)+happyMoment()+interstitial` |
| `GameSnacks.game.ready()` | `bridges/snacks_bridge.js` | `GamePix.loaded()` |

Both bridges keep the original game surface intact (the game never knows), pause-safety is preserved (the game already pauses during its own ad-break flow), and each call is protected by a hard timeout so gameplay can never freeze if an ad fails.

Wiring is proven: a Playwright spy test confirmed every bridge call lands on the real GamePix method (`commercialBreak→interstitialAd()`, `ad.break(reward)→rewardAd()`, `score.update(9)→updateScore(9)`, `levelComplete(2)→updateLevel(2)+happyMoment()+interstitialAd()`).

**Do this BEFORE the first submission** — while a game is in review the build is LOCKED (see §7).

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
- Assets: icon **256×256** (≤1MB), cover **1360×850** (≤1.5MB), JPG/PNG, representative of the game, and **NO text/names/logos on assets** — generate them with AI (`scripts/gen_assets.py`).
- **NEVER submit a game whose assets were not generated by AI** (see §5b — publish.js enforces this).
- Description 100–500 chars, unique, no AI boilerplate; how-to-play ≤500 chars (controls first, Desktop/Mobile sections).
- Keep the build small. One ad at a time, between levels only, never timer-based.

### Game naming rule (IMPORTANT — read before publishing)
The GitHub repo name / project folder name is just an **internal label** — the
games shipped by this workflow carry **NO name inside the build** (no title in
the zip, no text on the assets). Therefore:
- **NEVER** blindly reuse the GitHub repo/folder name as the game title.
- At publish time, the agent **chooses the game name itself**, right before
  going live: a fresh, catchy, **on-topic** title that reflects what the game
  actually does (read the code, play the game first). Not off-topic, not
  generic ("My Game", "Untitled"), not a clone of a famous title.
- The chosen title becomes `GPX_TITLE` (dashboard name + namespace slug) and
  the zip filename stays internal. Assets stay text-free (§5) — the title
  lives ONLY in the dashboard metadata.

## 4. Automated publishing via Playwright

Full working implementation: `scripts/publish.js` (this repo). Usage:

```bash
GPX_EMAIL=you@example.com GPX_PASSWORD='secret' GPX_TITLE="My Game" \
GPX_MAIN_TAG="puzzle" GPX_EXTRA_TAGS="driving,simulation" GPX_DESCRIPTION="100-500 char original description..." \
GPX_HOW_TO_PLAY="Desktop\n... Mobile\n..." GPX_ICON=assets/icon_256.png GPX_COVER=assets/cover_1360x850.png \
GPX_ZIP=game-v1.0.0.zip GPX_RELEASE_NOTES="First release." \
xvfb-run -a node scripts/publish.js
```

The script performs, in order (each step verified by an API 200 or DOM state):
1. Login (re-login if redirected to /login; saves storageState to reuse the session).
2. Games page → dismiss payment modal if present.
3. **Create New Game** modal: title, main tag (ionic-selectable → item matching the tag name), description (100–500 chars) → `Create` → game appears in list (namespace = slugified title).
4. Open `games/<ns>`; **Info tab**: fix main tag if needed, **ALSO pick the extra/secondary tags** (2nd `.ionic-selectable`, multi-select — REQUIRED by this workflow, e.g. 2-4 tags matching the genre; other optional fields can stay empty), Orientation (`ion-select[name=orientation]` → Landscape), Desktop/Mobile friendly checkboxes, Game engine (`ion-select[name=gameEngine]` → Cocos/HTML5-JS/...), SDK integration checkbox → `Save` → wait for "Successfully updated!" toast and the warning "Please set Game Orientation" to disappear.
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

## 5. Creating assets with FREE AI generation (preferred)

Use `scripts/gen_assets.py` — generates the icon and cover with **FLUX (Hugging Face Spaces anonymous Gradio API)**: no account, no API key. Validated Sept 2026.

```bash
pip install pillow
python3 scripts/gen_assets.py \
  --prompt "a cartoon moving truck loaded with cardboard boxes driving up a sunny \
hilly road toward a new house, vibrant colors, clean vector style" \
  --out-dir ./assets
# -> assets/icon_256.png (256x256, <=1MB) + assets/cover_1360x850.png (1360x850, <=1.5MB)
```

How it works / rules:
- `--prompt` is a **VISUAL description of the game only**. NEVER ask the model to render the game title or any words.
- The script appends a ban-suffix to every prompt: "no text, no letters, no words, no numbers, no logo, no watermark..." — **assets must carry no name/branding**.
- Icon is generated at 1024×1024 then downscaled to exactly 256×256 (cover-crop, LANCZOS). Cover is generated at 1360×850 directly. If a PNG exceeds the byte limit it is re-encoded as JPEG (also accepted).
- Spaces tried in order: `black-forest-labs/FLUX.1-schnell` (fast), then `black-forest-labs/FLUX.1-dev`. Anonymous ZeroGPU quota is **per-IP and rolling**: on failure the script waits (exponential backoff, default 4 rounds × 20-60s) and retries. Optional `HF_TOKEN` env var (free account token) raises the quota.
- **Provenance marker**: the script always writes an `ASSETS_SOURCE` file next to the assets — `assets_ai_generated` (real FLUX output) or `assets_pil_fallback` (PIL placeholder).
- If ALL AI attempts fail, it falls back to `scripts/make_assets.py` (PIL-drawn, also text-free) so the draft can still be completed — but such assets must NEVER be submitted (§5b).

### 5b. HARD RULE — never submit non-AI assets (enforced by publish.js)

**A game must NEVER be submitted for review with self-made/fallback assets** (PIL-drawn, hand-drawn, placeholders). GamePix QA judges store-quality visuals first; a placeholder icon/cover is an automatic reject and burns the review slot (build is server-locked while in review, §7).

`publish.js` enforces this:
- It reads the `ASSETS_SOURCE` marker written by `gen_assets.py` next to the icon/cover.
- If it is missing, unknown, or equals `assets_pil_fallback`, the script **completes everything else** (create, Info, Assets upload, Editorial, Build — all idempotent and safe to finish) but **REFUSES to click "Submit for review"**, prints the reason and a fix path, and exits with code **2**.
- The fix: wait for the rolling ZeroGPU quota window (or use another IP / an `HF_TOKEN`), regenerate with `gen_assets.py`, re-run `publish.js` — it will re-upload the now-AI assets and submit.

Agent workflow when the AI generation fails:
1. Complete the whole draft (assets tab may receive the fallback files so nothing is missing — that is allowed), BUT do not submit.
2. Retry `gen_assets.py` later (quota is rolling) until you get real AI assets.
3. Re-run `publish.js` to upload the AI assets and only then submit.

Manual one-off generation (any size) with the same API, in Python stdlib only:

```python
# POST https://black-forest-labs-flux-1-schnell.hf.space/gradio_api/call/infer
#   {"data": [prompt, seed, randomize_seed, width, height, 4]}   -> {"event_id": ...}
# GET  .../gradio_api/call/infer/<event_id>                        -> SSE stream
# "event: complete\ndata: [{"url": "https://.../image.webp"}, seed] -> download the url
```

Fallback (offline): `scripts/make_assets.py --title "MY GAME"` draws PIL assets — pass `--title ""`-equivalent (`None`) to keep them text-free. Such assets are **for draft completion only: never submit a game with them** (§5b — `publish.js` blocks the submit and exits with code 2).

## 6. What "done" looks like

- Games list shows the game with status badge **REVIEW** (was **EDIT**).
- Draft API: `status:"review"`, `buildStatus:"ready"`, `buildMessage:"The build is reviewable"`.
- Notify the user: game submitted, QA typically takes a few days; edits are locked while in review (status switches to EDIT again if changes are requested).

## 7. REVIEW LOCK — build updates are impossible while in review (server-enforced)

Validated exhaustively (Sept 2026). Once a game is submitted for review (`status:"review"`):

- The Build tab hides Browse and disables Upload — **client-side only**. Bypassing the DOM does NOT help:
  - `GET /v3/devs/game-drafts/build-signed-url/<ns>?fileType=zip` → **401 `"Unauthorized game state."`** (server refuses while in review; the SAME call returns 200 for games never submitted).
- `PUT /v3/devs/game-drafts/<ns>` with `{status:"edit"}` → **400** `must NOT have additional properties: status` (status is not editable).
- There is **no withdraw/cancel-review/delete** feature anywhere (UI, bundles, API).
- Release notes textarea becomes `readonly`; asset inputs are also locked in review.
- The build download endpoint requires AWS SigV4 signing you cannot produce (`403 Authorization header requires 'Credential' parameter...`).

**Consequences — how to plan correctly:**
1. Finish EVERYTHING (SDK + ads bridge + score/level events + compliant build) BEFORE clicking Submit for review. The first submitted build should be the one you want QA to see.
2. If the QA requests changes, the game returns to EDIT and builds unlock again — that is the supported way to update.
3. Do not submit placeholder builds "just to test" — you burn the review slot with a build you can no longer replace.
4. Auth for direct API calls: the dashboard sends a **JWT `Authorization: Bearer ey...` header** (capture it via `page.on('request')`); cookies alone give 401.

## References
- SDK doc: https://partners.gamepix.com/sdk/doc/javascript (per-engine docs: /cocos, /construct2, /construct3, /gdevelop-5, /godot-plugin, /unity-plugin)
- Submission guidelines: https://partners.gamepix.com/guidelines/submission
- Dashboard: https://my.gamepix.com (login: /login)
