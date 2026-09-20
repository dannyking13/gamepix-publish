# my.gamepix.com dashboard map (verified selectors)

## URLs
- Login: https://my.gamepix.com/login
- Dashboard: https://my.gamepix.com/dashboard
- Games list: https://my.gamepix.com/games
- Game edit: https://my.gamepix.com/games/<namespace>
- APIs: https://api.gamepix.com/v3/devs/* , https://api.partner.gamepix.com/*

## Free AI asset generation (gen_assets.py)
- FLUX via anonymous Gradio API of HF Spaces: POST `https://black-forest-labs-flux-1-schnell.hf.space/gradio_api/call/infer` {"data":[prompt,seed,rand,w,h,steps]} → event_id → SSE → image URL. Fallback space: FLUX.1-dev (data has guidance before steps).
- Anonymous ZeroGPU quota is per-IP rolling: `data: null` / "generation error: null" = quota — retry with backoff (script does 4 rounds × 20-60s) or use HF_TOKEN / scripts/.hf_token (git-ignored) to raise it.

## Login (Angular + Ionic)
- Form: `form#login-form`
- Email: `ion-input[name="email"] input.native-input`
- Password: `ion-input[name="password"] input.native-input`
- Submit: `ion-button#sign-in` (disabled until Angular validity — real keystrokes via pressSequentially)
- Session: save `ctx.storageState()` and reuse; on expiry page redirects to /login mid-flow

## Games list
- Cards: `.data-item` containing `p.title[title="<namespace>"]`
- Status chips: `.data-item span.status` (new / draft "Release" / review / live)
- Modal toasts: payment notice with `OK` button — dismiss first
- Create New Game button (text) opens modal: `ion-input[name="title"]`, `.ionic-selectable` (main tag), `textarea[name="description"]`, `Create` ion-button

## Game edit tabs (ion-segment)
- values: `info`, `assets`, `editorial`, `build`, `review` (label "Submit for Review")
- an `ion-loading` overlay appears while data loads — wait hidden before clicking

### Info tab
- Title: `ion-input[name="title"] input.native-input`
- Main tag + extra tags: `.ionic-selectable` (first = main, single-select; second = extra/secondary tags, MULTI-select — stays open after item clicks, confirm with footer OK/Save/Done button). Secondary tags are REQUIRED by the publish.js workflow (GPX_EXTRA_TAGS env var).
- Orientation: `ion-select[name="orientation"]` → `ion-popover ion-item` (All | Landscape | Portrait)
- Checkboxes: `ion-checkbox[name="allowDistribution|desktopFriendly|mobileFriendly|sdkIntegration"]`
- Game engine: `ion-select[name="gameEngine"]` → popover items: HTML5-JS, Unity/WebGL, Phaser, Construct 2, Construct 3, GameMaker, Cocos, GDevelop, Godot, Unity(.gpx), ...
- Save: enabled `ion-button` labeled Save (per tab). Success = "Successfully updated!" toast; warning "Please set Game Orientation" must disappear.

### Assets tab
- Two `Add` buttons (getByRole button name "Add" exact): [0]=icon 256x256 ≤1MB, [1]=cover 1360x850 ≤1.5MB
- Real click opens filechooser → setFiles; success = `POST api.gamepix.com/v3/devs/game-drafts/upload/asset` 200 (x2)
- After upload: header "Assets: icon, cover" and buttons become "Modify"

### Editorial tab
- `textarea[name="description"]` (100–500), `textarea[name="howToPlay"]` (≤500, controls first)
- Optional: custom sections ("Add Custom Section"), video `ion-input[name="videoUrl"]`, FAQ ("Add FAQ")
- Save = enabled Save button (PUT game-drafts/<ns> 200)

### Build tab
- "Browse File" + filechooser → zip (index.html at root); "File: <name>.zip" appears
- "Upload" button enables → click → S3 PUT 200 → "Your build is in processing, it may take several minutes..."
- Poll (reload tab) until "Build ready, your new version code is: <code>"; failure shows invalid/error text

### Review tab
- "What's new in this release?" textarea (release notes ≤500)
- "Submit for review" button → `PUT api.gamepix.com/v3/devs/game-drafts/<ns>/review` 200
- Badge switches EDIT → REVIEW

## Success verification
`GET https://api.gamepix.com/v3/devs/game-drafts/ns/<namespace>` →
`"status":"review"`, `"buildStatus":"ready"`, `"buildUploaded":true`, `"buildMessage":"The build is reviewable"`
