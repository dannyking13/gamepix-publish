#!/usr/bin/env node
/**
 * GamePix end-to-end publisher (validated workflow, E2E proven).
 *
 * Env vars:
 *   GPX_EMAIL, GPX_PASSWORD        (required) dashboard credentials
 *   GPX_TITLE                      (required for new games)
 *   GPX_MAIN_TAG                   (required for new games) e.g. "puzzle", "arcade", "racing"
 *   GPX_EXTRA_TAGS                 (recommended) comma-separated secondary tags, e.g. "driving,simulation"
 *   GPX_DESCRIPTION                (required for new games) 100-500 chars, original text
 *   GPX_HOW_TO_PLAY                (optional, recommended) <=500 chars, controls first
 *   GPX_ORIENTATION                (optional) Landscape|Portrait|All (default Landscape)
 *   GPX_ENGINE                     (optional) Cocos|HTML5-JS|Unity/WebGL|Phaser|... (default Cocos)
 *   GPX_ICON, GPX_COVER            (optional) PNG paths (256x256 / 1360x850)
 *   GPX_ZIP                        (optional) build zip, index.html at root
 *   GPX_RELEASE_NOTES              (optional) <=500 chars
 *   GPX_SESSION_FILE               (optional) storageState json to reuse login
 *
 * Run HEADED under xvfb:  xvfb-run -a node publish.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CFG = {
  email: process.env.GPX_EMAIL,
  password: process.env.GPX_PASSWORD,
  title: process.env.GPX_TITLE,
  mainTag: process.env.GPX_MAIN_TAG || 'puzzle',
  extraTags: (process.env.GPX_EXTRA_TAGS || '').split(',').map(s => s.trim()).filter(Boolean),
  description: process.env.GPX_DESCRIPTION,
  howToPlay: process.env.GPX_HOW_TO_PLAY || '',
  orientation: process.env.GPX_ORIENTATION || 'Landscape',
  engine: process.env.GPX_ENGINE || 'Cocos',
  icon: process.env.GPX_ICON,
  cover: process.env.GPX_COVER,
  zip: process.env.GPX_ZIP,
  releaseNotes: process.env.GPX_RELEASE_NOTES || 'First release.',
  sessionFile: process.env.GPX_SESSION_FILE || path.join(__dirname, '.gpx_session.json'),
};

// ---------- SELECT-POPOVER HELPERS ----------------------------------------
// ion-select popovers that stay open block every later click — always dismiss.
async function dismissPopover(page) {
  try {
    const vis = await page.locator('ion-popover .popover-viewport').first().isVisible();
    if (vis) {
      log('select popover still open — dismissing (Escape)');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
    }
  } catch (e) { /* no popover at all */ }
}

// pick an option in the currently open popover: exact match first, then word-prefix
async function pickOption(page, value) {
  const opts = page.locator('ion-popover ion-item');
  const on = await opts.count();
  const texts = [];
  for (let i = 0; i < on; i++) texts.push(((await opts.nth(i).textContent()) || '').trim());
  for (const pass of [new RegExp('^' + value + '$', 'i'), new RegExp('^' + value + '\\b', 'i')]) {
    for (let i = 0; i < on; i++) {
      if (pass.test(texts[i])) { await opts.nth(i).click(); await page.waitForTimeout(1800); return true; }
    }
  }
  return false;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const log = (...a) => console.log('[GPX]', ...a);
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------- AI-ASSET ENFORCEMENT -------------------------------------------
// HARD RULE: never submit a game whose icon/cover are not real AI generations
// (no PIL/hand-drawn placeholders). gen_assets.py writes an ASSETS_SOURCE file
// next to the assets: "assets_ai_generated" (OK) or "assets_pil_fallback" (blocked).
const AI_MARKER = 'ASSETS_SOURCE';
const ASSET_SOURCE_AI = 'assets_ai_generated';
const ASSET_SOURCE_PIL = 'assets_pil_fallback';

function assetSource(iconPath, coverPath) {
  for (const p of [iconPath, coverPath]) {
    if (!p) continue;
    const dir = path.dirname(path.resolve(p));
    const mf = path.join(dir, AI_MARKER);
    try {
      if (fs.existsSync(mf)) {
        const v = fs.readFileSync(mf, 'utf8').trim();
        if (v === ASSET_SOURCE_PIL) return { src: ASSET_SOURCE_PIL, marker: mf };
        if (v === ASSET_SOURCE_AI) return { src: ASSET_SOURCE_AI, marker: mf };
        return { src: 'unknown:' + v, marker: mf };
      }
    } catch (e) {}
    return { src: 'missing', marker: mf }; // assets exist but no marker -> not proven AI
  }
  return null; // no assets provided at all
}

// Called right before "Submit for review": warns on missing icon/cover/metadata,
// but REFUSES to submit when assets are not proven AI-generated.
async function warnBeforeSubmit(ctx, page, ns) {
  const notes = [];
  if (!CFG.icon || !CFG.cover) notes.push('- GPX_ICON/GPX_COVER not provided: no assets were uploaded.');
  if (!CFG.description) notes.push('- GPX_DESCRIPTION missing (Info tab may be incomplete).');
  if (!CFG.howToPlay) notes.push('- GPX_HOW_TO_PLAY missing (Editorial tab not filled).');
  if (notes.length) {
    log('WARN — incomplete submission checklist:\n' + notes.join('\n'));
    log('Continuing anyway (you may complete these later once the game is back in EDIT).');
  }
  const a = assetSource(CFG.icon, CFG.cover);
  if (a && a.src !== ASSET_SOURCE_AI) {
    const reason = a.src === ASSET_SOURCE_PIL
      ? 'assets are PIL FALLBACK (ASSETS_SOURCE=' + ASSET_SOURCE_PIL + ' in ' + a.marker + ')'
      : 'assets are not proven AI-generated (ASSETS_SOURCE=' + a.src + ')';
    log('');
    log('======================================================================');
    log('🚫 SUBMIT FOR REVIEW BLOCKED — ' + reason);
    log('======================================================================');
    log('Rule: NEVER submit a game with self-made/fallback assets.');
    log('Everything else was completed. The game is NOT submitted for review.');
    log('To finish: generate REAL AI assets, then re-run this script (it is idempotent):');
    log('  python3 gen_assets.py --prompt "<visual description of the game>" \\');
    log('    --out-dir <dir containing icon_256.png / cover_1360x850.png>');
    log('  # retry later if the HF quota is exhausted (rolling window), or use another IP / HF_TOKEN');
    await page.screenshot({ path: path.join(__dirname, 'gpx_not_submitted_' + ns + '.png'), fullPage: true });
    await ctx.storageState({ path: CFG.sessionFile });
    return false;
  }
  if (a) log('Asset provenance OK (ASSETS_SOURCE=' + a.src + ')');
  return true;
}

function reportNotSubmitted(ns) {
  log('');
  log('======================================================================');
  log('⛔ NOT SUBMITTED — ' + ns + ' has NOT been sent to review.');
  log('Reason: assets were not generated by AI (never ship self-made assets).');
  log('All other steps (create/info/assets/editorial/build) were completed;');
  log('you can complete anything missing later — but do NOT submit until');
  log('real AI-generated assets have been uploaded.');
  log('======================================================================');
}

async function main() {
  if (!CFG.email || !CFG.password) throw new Error('GPX_EMAIL and GPX_PASSWORD required');
  const hasSession = fs.existsSync(CFG.sessionFile);

  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1400 },
    userAgent: UA,
    storageState: hasSession ? CFG.sessionFile : undefined,
  });
  const page = await ctx.newPage();

  const apiHits = [];
  page.on('response', (r) => {
    const u = r.url();
    if (/game-drafts|upload\/asset|devs\/games/i.test(u)) apiHits.push(r.request().method() + ' ' + r.status() + ' ' + u.split('?')[0]);
  });

  const waitCf = async () => {
    for (let i = 0; i < 40; i++) {
      const t = await page.title().catch(() => '');
      if (!/just a moment|attention required/i.test(t)) return true;
      await page.waitForTimeout(1000);
    }
    return false;
  };

  const dismissModals = async () => {
    for (const label of ['OK', 'Accept all', 'Consent']) {
      try {
        const b = page.locator(`ion-button:has-text("${label}"), button:has-text("${label}")`).first();
        if (await b.isVisible({ timeout: 1500 })) { await b.click(); await page.waitForTimeout(1000); }
      } catch (e) {}
    }
  };

  const ensureLogin = async (targetUrl) => {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitCf();
    await page.waitForTimeout(3500);
    if (/\/login/.test(page.url())) {
      log('Logging in...');
      const em = page.locator('ion-input[name="email"] input.native-input');
      await em.click(); await em.pressSequentially(CFG.email, { delay: 12 });
      const pw = page.locator('ion-input[name="password"] input.native-input');
      await pw.click(); await pw.pressSequentially(CFG.password, { delay: 12 });
      await page.waitForTimeout(800);
      await page.locator('#sign-in').click();
      await page.waitForTimeout(7000);
      if (/\/login/.test(page.url())) throw new Error('Login failed (still on /login)');
      log('Logged in OK');
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(3500);
    }
    await dismissModals();
    try { await page.locator('ion-loading').first().waitFor({ state: 'hidden', timeout: 10000 }); } catch (e) {}
  };

  // ---------- 1) CREATE GAME (skip if namespace already exists) ----------
  if (!CFG.title) throw new Error('GPX_TITLE required');
  const ns = slugify(CFG.title);
  await ensureLogin('https://my.gamepix.com/games');
  let exists = await page.evaluate((nsArg) => !!document.querySelector('p[title="' + nsArg + '"]'), ns);
  if (!exists) {
    log('Creating new game:', CFG.title);
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('button, a, div, span, ion-button'))
        .find((x) => /^create new game$/i.test((x.textContent || '').trim()));
      if (el) el.click();
    });
    await page.waitForTimeout(4000);
    // Title (real keystrokes)
    const ti = page.locator('ion-input[name="title"] input.native-input');
    await ti.click(); await ti.pressSequentially(CFG.title, { delay: 12 });
    await page.waitForTimeout(400);
    // Main tag (ionic-selectable)
    await page.locator('.ionic-selectable').first().click();
    await page.waitForTimeout(2500);
    const items = page.locator('.ionic-selectable-item');
    const n = await items.count();
    let picked = false;
    for (let i = 0; i < n; i++) {
      const t = (await items.nth(i).textContent() || '').trim();
      if (new RegExp('^' + CFG.mainTag + '( games)?$', 'i').test(t)) { await items.nth(i).click(); picked = true; break; }
    }
    if (!picked) throw new Error('Main tag "' + CFG.mainTag + '" not found in selectable list');
    await page.waitForTimeout(2000);
    // Description
    if (!CFG.description || CFG.description.length < 100 || CFG.description.length > 500) {
      throw new Error('GPX_DESCRIPTION must be 100-500 chars, got ' + (CFG.description || '').length);
    }
    const de = page.locator('textarea[name="description"]');
    await de.click(); await de.pressSequentially(CFG.description, { delay: 3 });
    await page.waitForTimeout(800);
    // Create
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('ion-button, button'));
      const b = btns.filter((x) => /^create$/i.test((x.textContent || '').trim())).pop();
      if (b && !b.hasAttribute('disabled')) b.click();
    });
    await page.waitForTimeout(9000);
    exists = await page.evaluate((nsArg) => !!document.querySelector('p[title="' + nsArg + '"]'), ns);
    if (!exists) throw new Error('Game was not created (namespace card not found)');
    log('Game created:', ns);
  } else {
    log('Game already exists:', ns);
  }

  // ---------- 2) INFO TAB ----------
  await ensureLogin('https://my.gamepix.com/games/' + ns);
  try { await page.locator('ion-loading').first().waitFor({ state: 'hidden', timeout: 10000 }); } catch (e) {}
  await dismissModals();

  // 2a. main tag fix (if it's not the right one) — ionic-selectable modal
  const mainTagNow = await page.evaluate(() => {
    const s = document.querySelector('.ionic-selectable');
    return s ? s.textContent.trim().slice(0, 40) : null;
  });
  if (mainTagNow && !new RegExp('^' + CFG.mainTag, 'i').test(mainTagNow)) {
    await page.locator('.ionic-selectable').first().click();
    await page.waitForTimeout(2500);
    const items = page.locator('.ionic-selectable-item');
    const n = await items.count();
    for (let i = 0; i < n; i++) {
      const t = (await items.nth(i).textContent() || '').trim();
      if (new RegExp('^' + CFG.mainTag + '( games)?$', 'i').test(t)) { await items.nth(i).click(); break; }
    }
    await page.waitForTimeout(2000);
  }

  // 2a-bis. EXTRA/secondary tags (2nd ionic-selectable, multi-select) — REQUIRED by workflow
  // (main tag alone is not enough; other optional Info fields can stay empty)
  const extraNow = await page.evaluate(() => {
    const all = document.querySelectorAll('.ionic-selectable');
    const s = all[1]; // [0] = main tag, [1] = extra tags
    return s ? s.textContent.trim().slice(0, 60) : null;
  });
  if (CFG.extraTags.length && (!extraNow || extraNow.length < 2 || /^select/i.test(extraNow))) {
    await page.locator('.ionic-selectable').nth(1).click();
    await page.waitForTimeout(2500);
    const items = page.locator('.ionic-selectable-item');
    const n = await items.count();
    for (const tag of CFG.extraTags) {
      let picked = false;
      for (let i = 0; i < n; i++) {
        const t = (await items.nth(i).textContent() || '').trim();
        if (new RegExp('^' + tag + '( games)?$', 'i').test(t)) {
          await items.nth(i).click(); picked = true; await page.waitForTimeout(600); break;
        }
      }
      if (!picked) log('WARN extra tag not found in list:', tag);
    }
    // confirm the multi-select modal (ionic-selectable footer button)
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('ion-button, button'));
      const b = btns.filter((x) => /^(ok|save|select|done|apply)$/i.test((x.textContent || '').trim())).pop();
      if (b && !b.hasAttribute('disabled')) b.click();
    });
    await page.waitForTimeout(2000);
  }

  // 2b. orientation (ion-select popover)
  const needOrient = await page.evaluate(() => {
    const s = document.querySelector('ion-select[name="orientation"]');
    return s ? /select orientation/i.test(s.getAttribute('aria-label') || '') : true;
  });
  if (needOrient) {
    await page.locator('ion-select[name="orientation"]').click();
    await page.waitForTimeout(2200);
    const picked = await pickOption(page, CFG.orientation);
    if (!picked) log('WARN: orientation option not found: ' + CFG.orientation);
    await dismissPopover(page);
    await page.waitForTimeout(800);
  }

  // 2c. desktop/mobile friendly
  for (const nm of ['desktopFriendly', 'mobileFriendly']) {
    const checked = await page.evaluate((n) => {
      const c = document.querySelector('ion-checkbox[name="' + n + '"]');
      return c ? c.classList.contains('checkbox-checked') : null;
    }, nm);
    if (!checked) { await page.locator('ion-checkbox[name="' + nm + '"]').click(); await page.waitForTimeout(800); }
  }

  // 2d. game engine
  const needEngine = await page.evaluate(() => {
    const s = document.querySelector('ion-select[name="gameEngine"]');
    return s ? /select framework/i.test(s.getAttribute('aria-label') || '') : true;
  });
  if (needEngine) {
    await page.locator('ion-select[name="gameEngine"]').click();
    await page.waitForTimeout(2200);
    const picked = await pickOption(page, CFG.engine);
    if (!picked) log('WARN: engine option not found: ' + CFG.engine);
    await dismissPopover(page);
    await page.waitForTimeout(800);
  }

  // 2e. SDK integration
  const sdkChecked = await page.evaluate(() => {
    const c = document.querySelector('ion-checkbox[name="sdkIntegration"]');
    return c ? c.classList.contains('checkbox-checked') : null;
  });
  if (!sdkChecked) { await page.locator('ion-checkbox[name="sdkIntegration"]').click(); await page.waitForTimeout(800); }

  // 2f. Save (enabled ion-button named Save)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('ion-button')).filter((b) => /^save$/i.test((b.textContent || '').trim()) && !b.hasAttribute('disabled') && b.offsetParent);
    if (btns.length) btns[btns.length - 1].click();
  });
  await page.waitForTimeout(5000);
  log('Info saved. API hits so far:', apiHits.slice(-2).join(' | '));

  // ---------- 3) ASSETS TAB ----------
  const prov = assetSource(CFG.icon, CFG.cover);
  if (prov) {
    log('Asset provenance: ASSETS_SOURCE=' + prov.src + (prov.src === ASSET_SOURCE_AI ? ' (AI OK)' : ' (NOT AI — submit will be BLOCKED)'));
    if (prov.src === ASSET_SOURCE_PIL) log('⚠️  PIL fallback assets detected (' + prov.marker + '). They will be uploaded (better than nothing while completing the draft) but SUBMIT FOR REVIEW WILL BE REFUSED.');
  }
  if (CFG.icon && CFG.cover) {
    await page.locator('ion-segment-button[value="assets"]').click();
    await page.waitForTimeout(3000);
    const addBtns = page.getByRole('button', { name: 'Add', exact: true });
    const modBtns = page.getByRole('button', { name: /modify/i });
    const cnt = await addBtns.count();
    const modCnt = await modBtns.count();
    if (cnt < 2 && modCnt >= 2) {
      log('Assets already uploaded (Modify buttons present), skipping');
    } else if (cnt < 2) {
      throw new Error('Expected 2 Add buttons (icon, cover), found ' + cnt + ' (modify: ' + modCnt + ')');
    }
    const uploadAsset = async (idx, file, label) => {
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 8000 }),
        addBtns.nth(idx).click({ timeout: 8000 }),
      ]).catch(() => [null]);
      if (fc) await fc.setFiles(path.resolve(file));
      else await page.locator('input[type="file"][name="' + label.toLowerCase() + '"]').setInputFiles(path.resolve(file));
      await page.waitForTimeout(5000);
      log(label + ' uploaded (expect POST upload/asset 200)');
    };
    if (cnt >= 2) {
      await uploadAsset(0, CFG.icon, 'icon');
      await uploadAsset(1, CFG.cover, 'cover');
    }
  } else {
    log('GPX_ICON/GPX_COVER not provided, skipping assets');
  }

  // ---------- 4) EDITORIAL TAB ----------
  if (CFG.howToPlay) {
    if (CFG.howToPlay.length > 500) throw new Error('GPX_HOW_TO_PLAY must be <=500 chars');
    await page.locator('ion-segment-button[value="editorial"]').click();
    await page.waitForTimeout(3000);
    const htp = page.locator('textarea[name="howToPlay"]');
    await htp.click(); await htp.fill(''); await htp.pressSequentially(CFG.howToPlay, { delay: 3 });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('ion-button, button')).filter((b) => /^save$/i.test((b.textContent || '').trim()) && !b.hasAttribute('disabled'));
      if (btns.length) btns[btns.length - 1].click();
    });
    await page.waitForTimeout(4500);
    log('Editorial saved');
  }

  // ---------- 5) BUILD TAB ----------
  if (CFG.zip) {
    await page.locator('ion-segment-button[value="build"]').click();
    await page.waitForTimeout(3000);
    const zipBase = path.basename(CFG.zip);
    const staged = await page.evaluate((zb) => document.body.innerText.includes(zb), zipBase);
    if (!staged) {
      const browse = page.getByRole('button', { name: /browse/i }).first();
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 8000 }),
        browse.click({ timeout: 8000 }),
      ]).catch(() => [null]);
      if (fc) await fc.setFiles(path.resolve(CFG.zip));
      else await page.locator('input[type="file"][name="package"]').setInputFiles(path.resolve(CFG.zip));
      await page.waitForTimeout(2500);
    }
    const up = page.getByRole('button', { name: 'Upload', exact: true }).first();
    const dis = await up.evaluate((el) => el.hasAttribute('disabled')).catch(() => true);
    if (dis) throw new Error('Upload button disabled (zip not staged?)');
    await up.click();
    log('Build uploading (S3 PUT), processing...');
    // poll until ready (max ~8 min)
    for (let i = 0; i < 16; i++) {
      await page.waitForTimeout(30000);
      const t = await page.evaluate(() => document.body.innerText);
      if (/build ready/i.test(t)) { log('BUILD READY'); break; }
      if (/invalid|error/i.test(t)) throw new Error('Build failed: ' + t.slice(0, 300));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      try { await page.locator('ion-loading').first().waitFor({ state: 'hidden', timeout: 10000 }); } catch (e) {}
      await dismissModals();
      await page.locator('ion-segment-button[value="build"]').click();
      await page.waitForTimeout(2500);
    }
  } else {
    log('GPX_ZIP not provided, skipping build');
  }

  // ---------- 6) SUBMIT FOR REVIEW (BLOCKED if assets are not AI-generated) ----------
  if (!(await warnBeforeSubmit(ctx, page, ns))) {
    reportNotSubmitted(ns);
    await browser.close();
    process.exit(2); // 2 = everything done except submit (non-AI assets)
  }
  await page.locator('ion-segment-button:has-text("Submit for Review")').first().click();
  await page.waitForTimeout(3000);
  const ta = page.locator('textarea:visible').first();
  await ta.click(); await ta.fill(''); await ta.pressSequentially(CFG.releaseNotes, { delay: 3 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /submit for review/i }).first().click();
  await page.waitForTimeout(6000);
  // confirm dialog if any
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('ion-alert button, ion-modal button, ion-action-sheet button'));
    const c = btns.find((b) => /^(ok|yes|confirm|submit|continue)$/i.test((b.textContent || '').trim()));
    if (c) c.click();
  });
  await page.waitForTimeout(5000);

  // ---------- 7) VERIFY ----------
  const bodyTxt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 500));
  const isReview = /review/i.test(await page.locator('.status, ion-badge, h1').first().textContent().catch(() => ''));
  log('FINAL API CALLS:\n' + apiHits.join('\n'));
  log('PAGE: ' + bodyTxt);
  await page.screenshot({ path: path.join(__dirname, 'gpx_published.png'), fullPage: true });
  await ctx.storageState({ path: CFG.sessionFile });
  await browser.close();
  log('DONE. Check above for "PUT ... ' + ns + '/review" 200. Status badge should be REVIEW.');
  if (!isReview) log('NOTE: verify manually at https://my.gamepix.com/games/' + ns);
}

main().catch((e) => { console.error('[GPX FATAL]', e); process.exit(1); });
