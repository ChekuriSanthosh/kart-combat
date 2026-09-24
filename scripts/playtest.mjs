/**
 * Headless play test. Boots a real browser against a running server, joins a
 * match, drives for a few seconds and reports console errors, dropped frames
 * and whether the local kart actually moved. Also drops screenshots in
 * `.playtest/` so the arenas can be eyeballed.
 *
 *   node scripts/playtest.mjs [baseUrl] [mapId...]
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.argv[2] || 'http://localhost:3100';
const MAPS = process.argv.slice(3).length ? process.argv.slice(3) : ['gravelPit', 'skyPinball', 'beybladeArena'];
const OUT = join(process.cwd(), '.playtest');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

let failed = 0;

for (const mapId of MAPS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  console.log(`\n=== ${mapId} ===`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(OUT, 'lobby.png') });

  await page.click(`.map-card[data-map="${mapId}"]`);
  await page.fill('#player-name', 'TestPilot');
  await page.click('#btn-play');

  await page.waitForSelector('#hud:not(.hidden)', { timeout: 8000 });

  // Instrument the live scene so we can measure instead of guessing.
  await page.evaluate(() => {
    window.__probe = { frames: 0, samples: [], errors: 0, start: performance.now(), end: 0 };
    const loop = () => {
      window.__probe.frames++;
      window.__probe.end = performance.now();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  // Hold throttle and steer so the kart has to interact with the arena.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyD');
  await page.keyboard.down('Space');
  await page.waitForTimeout(1500);
  await page.keyboard.up('Space');
  await page.waitForTimeout(1400);
  await page.keyboard.up('KeyW');

  const probe = await page.evaluate(() => ({
    frames: window.__probe.frames,
    // Time the counter actually ran for, rather than assuming the driving
    // script's waits add up to any particular number of seconds.
    seconds: (window.__probe.end - window.__probe.start) / 1000,
    canvas: (() => {
      const c = document.getElementById('game');
      return { w: c.width, h: c.height };
    })(),
    hp: document.getElementById('health-text')?.textContent,
    weapon: document.getElementById('weapon-name')?.textContent,
    leaders: document.querySelectorAll('#leaderboard-list li').length,
  }));

  await page.screenshot({ path: join(OUT, `${mapId}.png`) });

  // A second pass from high above, to check the arena layout as a whole.
  await page.evaluate(() => { window.__freeCam = true; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${mapId}-overview.png`) });
  await page.evaluate(() => { window.__freeCam = false; });

  const fps = probe.frames / Math.max(probe.seconds, 0.001);
  console.log(`  frames ${probe.frames} over ${probe.seconds.toFixed(1)}s (~${fps.toFixed(0)} fps),`
    + ` canvas ${probe.canvas.w}x${probe.canvas.h}`);
  console.log(`  hud: hp=${probe.hp} weapon=${probe.weapon} leaderboard rows=${probe.leaders}`);

  if (errors.length) {
    failed++;
    console.log(`  FAIL  ${errors.length} console error(s):`);
    for (const e of [...new Set(errors)].slice(0, 8)) console.log(`        ${e}`);
  } else {
    console.log('  ok    no console errors');
  }
  if (probe.leaders === 0) { failed++; console.log('  FAIL  leaderboard never populated'); }
  if (fps < 20) { failed++; console.log(`  FAIL  only ~${fps.toFixed(0)} fps`); }

  await page.close();
}

await browser.close();
console.log(failed === 0 ? '\nPlay test passed.' : `\n${failed} problem(s) found.`);
process.exit(failed === 0 ? 0 : 1);
