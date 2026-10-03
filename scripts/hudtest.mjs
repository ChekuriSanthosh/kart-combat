/**
 * The in-match HUD and the death → spectate → respawn loop, in a real browser.
 *
 * Layout is checked by measuring, not by eye: every always-on HUD box must sit
 * inside the viewport and none may overlap another. Two of them used to (the
 * kill feed sat on the clock, the fullscreen button on the controls hint) and
 * every screenshot-based check passed regardless.
 *
 * The death loop is driven for real rather than faked: Sky Pinball is a set of
 * platforms over a drop, so holding the throttle long enough always ends in a
 * fall, and the server then walks the client through the wreck, the 3-2-1 and
 * "Press Any Key". That is the path the server and the HUD have to agree on.
 *
 *   PORT=3300 ./scripts/with-server.sh node scripts/hudtest.mjs
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || `http://localhost:${process.env.PORT || 3100}`;
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];

async function joinArena(viewport, mapId) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#player-name', 'HudPilot');
  await page.click('#btn-arena');
  await page.click(`.map-card[data-map="${mapId}"]`);
  await page.click('#btn-play');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(700);
  return page;
}

const flowOf = (page) => page.evaluate(() => ({ ...window.__kc.flow }));
const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el || el.classList.contains('hidden')) return false;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0 && r.width > 0 && r.height > 0;
}, sel);

try {
  // ── Layout: the always-on boxes fit and never overlap ──
  const BOXES = ['#rank-pill', '#leaderboard', '#health', '#match-timer', '#hud-buttons', '#net-stats', '#weapon'];
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1400, height: 820 }, { width: 1920, height: 1080 }]) {
    const page = await joinArena(viewport, 'gravelPit');
    const rects = await page.evaluate((sels) => sels.map((s) => {
      const el = document.querySelector(s);
      if (!el) return { s, missing: true };
      const r = el.getBoundingClientRect();
      return { s, x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    }), BOXES);
    const label = `${viewport.width}x${viewport.height}`;
    const missing = rects.filter((r) => r.missing || !r.w || !r.h);
    if (missing.length) fail(`${label}: HUD boxes missing or empty: ${missing.map((r) => r.s).join(', ')}`);
    const outside = rects.filter((r) => !r.missing && (r.x < 0 || r.y < 0 || r.r > viewport.width || r.b > viewport.height));
    if (outside.length) fail(`${label}: off-screen: ${outside.map((r) => r.s).join(', ')}`);
    const overlaps = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (a.missing || b.missing) continue;
        const ix = Math.min(a.r, b.r) - Math.max(a.x, b.x);
        const iy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
        if (ix > 1 && iy > 1) overlaps.push(`${a.s}/${b.s}`);
      }
    }
    if (overlaps.length) fail(`${label}: overlapping HUD boxes: ${overlaps.join(', ')}`);
    if (!missing.length && !outside.length && !overlaps.length) ok(`${label}: ${BOXES.length} HUD boxes on screen, none overlapping`);

    const clock = (await page.textContent('#match-clock')).trim();
    if (/^\d+$/.test(clock)) ok(`${label}: clock shows whole seconds (${clock})`);
    else fail(`${label}: clock reads "${clock}"`);
    await page.close();
  }

  // ── Weapon slot: icon and ammo badge, then Esc settings ──
  {
    const page = await joinArena({ width: 1400, height: 820 }, 'harvestHollow');
    // The powerup cheat rolls a random weapon; keep rolling until one with a
    // count (ammo or a timer) lands, which is most of the arsenal.
    let badge = '';
    let name = '';
    for (let i = 0; i < 8 && !badge; i++) {
      await page.keyboard.down('ShiftLeft');
      await page.keyboard.press('Digit5');
      await page.keyboard.up('ShiftLeft');
      await page.waitForTimeout(2200); // the roulette settles first
      name = (await page.textContent('#weapon-name')).trim();
      if (await visible(page, '#weapon-count')) badge = (await page.textContent('#weapon-count')).trim();
      if (!badge) { await page.keyboard.press('Space'); await page.waitForTimeout(400); }
    }
    if (name && name !== 'Empty') ok(`weapon slot names the pickup ("${name}")`);
    else fail('weapon slot never showed a weapon');
    const icon = await page.evaluate(() => {
      const el = document.getElementById('weapon-icon');
      return el.querySelector('svg, img') ? 'svg' : el.textContent.trim();
    });
    if (icon) ok('weapon slot draws an icon');
    else fail('weapon slot is empty while holding a weapon');
    if (/^\d+$/.test(badge) && +badge > 0) ok(`count badge shows ${badge} for ${name}`);
    else fail(`no count badge after several pickups (last: ${name})`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (await visible(page, '#settings')) ok('Esc opens settings');
    else fail('Esc did not open settings');
    const statsBefore = await visible(page, '#net-stats');
    await page.click('label:has(#set-stats)').catch(() => page.click('#set-stats'));
    await page.waitForTimeout(200);
    const statsAfter = await visible(page, '#net-stats');
    if (statsBefore !== statsAfter) ok('the FPS & ping toggle takes effect immediately');
    else fail('toggling FPS & ping changed nothing');
    await page.click('label:has(#set-stats)').catch(() => page.click('#set-stats'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (!(await visible(page, '#settings'))) ok('Esc closes settings again');
    else fail('settings stayed open after Esc');
    await page.close();
  }

  // ── Death → wreck → spectate 3-2-1 → press any key → respawn ──
  {
    const page = await joinArena({ width: 1400, height: 820 }, 'skyPinball');
    await page.keyboard.down('KeyW');
    let dead = false;
    for (let i = 0; i < 120 && !dead; i++) {
      await page.waitForTimeout(150);
      dead = (await flowOf(page)).life === 'dead';
      // A nudge now and then so the kart cannot sit pinned against a bumper.
      if (i % 12 === 11) { await page.keyboard.down('KeyA'); await page.waitForTimeout(150); await page.keyboard.up('KeyA'); }
    }
    await page.keyboard.up('KeyW');
    if (!dead) {
      fail('never managed to get wrecked on Sky Pinball within 18 s');
    } else {
      ok('wrecked');
      await page.waitForTimeout(250);
      const line1 = (await page.textContent('#death-line1').catch(() => '')).trim();
      const line2 = (await page.textContent('#death-line2').catch(() => '')).trim();
      if (await visible(page, '#death-msg') && /smashed|fell/i.test(`${line1} ${line2}`)) {
        ok(`death message: "${line1} / ${line2}"`);
      } else fail(`no death message (got "${line1} / ${line2}")`);

      const seen = new Set();
      let count = 0;
      for (let i = 0; i < 60; i++) {
        const f = await flowOf(page);
        seen.add(f.stage);
        if (f.stage === 'spectate') count = Math.max(count, f.count);
        if (f.stage === 'continue') break;
        await page.waitForTimeout(150);
      }
      if (seen.has('spectate') && count >= 2) ok(`spectate countdown ran (from ${count})`);
      else fail(`no spectate countdown (stages: ${[...seen].join(', ')})`);
      if (await visible(page, '#press-any-key')) ok('"Press Any Key To Continue" is up');
      else fail('press-any-key prompt missing');

      await page.keyboard.press('KeyJ');
      let alive = false;
      for (let i = 0; i < 20 && !alive; i++) {
        await page.waitForTimeout(150);
        alive = (await flowOf(page)).life === 'alive';
      }
      if (alive) ok('a key press respawns you');
      else fail('still dead after pressing a key');
      if (!(await visible(page, '#death-msg')) && !(await visible(page, '#press-any-key'))) ok('death overlays clear on respawn');
      else fail('death overlays still showing after respawn');
    }
    await page.close();
  }

  // ── Round end: ROUND OVER, then the winners, ties shared ──
  {
    const page = await joinArena({ width: 1400, height: 820 }, 'gravelPit');
    await page.evaluate(() => {
      const me = window.__kc.localId;
      const standings = [
        { i: 'zz1', n: 'Alpha', c: 0xff5533, sc: 6, k: 6, rank: 1 },
        { i: 'zz2', n: 'Bravo', c: 0x3498db, sc: 6, k: 6, rank: 1 },
        { i: me, n: 'HudPilot', c: 0x2ecc71, sc: 2, k: 2, rank: 3 },
      ];
      window.__kc.socket.listeners('match:over')
        .forEach((fn) => fn({ standings, winners: ['zz1', 'zz2'], roundOverSeconds: 1, nextIn: 13 }));
    });
    await page.waitForTimeout(250);
    if (await visible(page, '#round-over')) ok('"ROUND OVER" shows at the whistle');
    else fail('no ROUND OVER');
    await page.waitForTimeout(1400);
    const winners = (await page.textContent('#results-winner').catch(() => '')).trim();
    if (await visible(page, '#results') && /Alpha/.test(winners) && /Bravo/.test(winners)) ok(`winners shown, tie shared ("${winners}")`);
    else fail(`winners screen wrong: "${winners}"`);
    if (!(await visible(page, '#weapon'))) ok('weapon slot hidden between rounds');
    else fail('weapon slot still showing on the winners screen');
    await page.close();
  }

  if (errors.length) fail(`console errors: ${[...new Set(errors)].slice(0, 4).join(' | ')}`);
  else ok('no console errors');
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nHUD works.');
process.exit(failures ? 1 : 0);
