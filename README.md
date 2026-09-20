# gamepix-publish

AI-agent skill to **integrate the GamePix SDK** into any HTML5 game and **publish it end-to-end** on the GamePix developer dashboard — create game → Info → Assets → Editorial → Build → **Submit for Review**, 100% automated with Playwright.

Validated end-to-end (Sept 2026): game created, assets uploaded, build processed `ready`, status flipped to `review`.

## Install

```bash
npm i playwright && npx playwright install chromium
# Linux: xvfb for headed mode (Cloudflare)
sudo apt-get install -y xvfb   # or use xvfb-run from your distro
```

## Use as an agent skill

Point your agent (Claude Code, Codebuff, ...) at `SKILL.md` in this repo, e.g. with [npx skills](https://www.npmjs.com/package/skills):

```bash
npx skills add <owner>/gamepix-publish --skill gamepix-publish --yes
```

The skill instructions (`SKILL.md`) contain the full platform knowledge: Cloudflare bypass, Ionic/Angular interaction rules, exact selectors, API confirmation signals, asset specs and compliance checklist.

## Use as a one-shot CLI

```bash
export GPX_EMAIL=you@example.com
export GPX_PASSWORD='secret'
export GPX_TITLE="My Game"
export GPX_MAIN_TAG="puzzle"            # main tag (puzzle, arcade, racing, ...)
export GPX_EXTRA_TAGS="driving,simulation"  # secondary tags — REQUIRED by this workflow
export GPX_DESCRIPTION="Original 100-500 char description of the game..."
export GPX_HOW_TO_PLAY="Desktop
Arrows = Move

Mobile
Swipe = Move"
export GPX_ICON=./icon_256.png
export GPX_COVER=./cover_1360x850.png
export GPX_ZIP=./my-game-v1.0.0.zip
export GPX_RELEASE_NOTES="First release."

xvfb-run -a node scripts/publish.js
```

Generate compliant assets with FREE AI (no account, no API key — FLUX via anonymous HF Spaces API):

```bash
pip install pillow
python3 scripts/gen_assets.py \
  --prompt "a cartoon moving truck loaded with cardboard boxes driving up a sunny \
hilly road toward a new house, vibrant colors, clean vector style" \
  --out-dir ./assets
# -> assets/icon_256.png (256x256, <=1MB) + assets/cover_1360x850.png (1360x850, <=1.5MB)
```

- `--prompt` = visual description of the game only; **assets carry no text/name/logo** (a ban-suffix is appended automatically).
- If the anonymous GPU quota is busy, the script retries with backoff across two FLUX Spaces, optionally uses `HF_TOKEN` (free account), and finally falls back to PIL-drawn assets so publishing never blocks.
- To raise the anonymous quota, set `HF_TOKEN=<your free token>` or put the token in a git-ignored `scripts/.hf_token` file (never commit a raw token to a public repo — HF auto-revokes leaked tokens).

## What the script verifies

- `PUT api.gamepix.com/v3/devs/game-drafts/<ns>` 200 — form saved
- `POST api.gamepix.com/v3/devs/game-drafts/upload/asset` 200 ×2 — icon + cover
- S3 `PUT gpx-mygamepix-builds...zip` 200 — build uploaded, then "Build ready, your new version code is: X"
- `PUT api.gamepix.com/v3/devs/game-drafts/<ns>/review` 200 — submitted
- Draft state: `"status":"review"`, `"buildStatus":"ready"`, `"buildMessage":"The build is reviewable"`

## Files

- `SKILL.md` — the actual skill (platform knowledge + step-by-step)
- `scripts/publish.js` — one-shot end-to-end publisher
- `scripts/bridges/poki_bridge.js` — AD BRIDGE: PokiSDK games get REAL GamePix ads (commercialBreak→interstitialAd, rewardedBreak→rewardAd, happyTime→happyMoment)
- `scripts/bridges/snacks_bridge.js` — AD BRIDGE: GameSnacks games get REAL GamePix ads (ad.break next/reward→interstitial/reward, score.update→updateScore, levelComplete→updateLevel+happyMoment, game.ready→loaded)
- `scripts/gen_assets.py` — FREE AI asset generator (FLUX via anonymous HF Spaces API, text-free, GamePix-compliant)
- `scripts/make_assets.py` — offline PIL fallback (also text-free)

## REVIEW LOCK (important)

Once a game is submitted, the build is **server-locked** until QA answers: `build-signed-url` returns 401 "Unauthorized game state" while in review, status cannot be flipped back to edit, and there is no withdraw/delete. Therefore ALWAYS integrate the SDK **and the ad bridge** (and score/level events) BEFORE the first submission. See SKILL.md §7 for the full evidence and `--upload` watcher pattern for auto-upgrading builds when QA unlocks a game.

## Disclaimer

Use with an account you own. GamePix QA reviews every submission; games must comply with https://partners.gamepix.com/guidelines/submission (no external links/analytics, relative paths, pause during ads, etc.).
