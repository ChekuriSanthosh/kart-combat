/**
 * Renders the arena picker's thumbnails: public/img/arenas/<mapId>.jpg.
 *
 * Each arena is joined for real and photographed from a high three-quarter
 * angle with the HUD hidden, so the pictures always show the arenas as they
 * are actually drawn — rerun this after restyling one. The server only offers
 * a thumbnail that exists (GET /api/arenas), so a missing file just leaves the
 * card's painted fallback in place.
 *
 *   PORT=3300 ./scripts/with-server.sh node scripts/thumbs.mjs [mapId...]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3100}`;
const OUT = join(process.cwd(), 'public', 'img', 'arenas');
const MAPS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['gravelPit', 'skyPinball', 'beybladeArena', 'harvestHollow'];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

let failed = 0;
for (const mapId of MAPS) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('#btn-arena');
  await page.click(`.map-card[data-map="${mapId}"]`);
  await page.click('#btn-play');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 10000 });

  // A three-quarter view from the south-east, high enough to read the layout
  // and low enough that the walls and scenery still look like toys.
  await page.evaluate(() => {
    const r = window.__kc.world.map.arenaRadius || 46;
    window.__freeCam = { pos: [r * 0.62, r * 0.78, r * 1.02], look: [0, -r * 0.06, -r * 0.08] };
    document.getElementById('hud').style.visibility = 'hidden';
    document.getElementById('btn-fullscreen')?.style.setProperty('visibility', 'hidden');
  });
  // Let shadows, the crate tumble and the bots settle into the shot.
  await page.waitForTimeout(1500);
  const file = join(OUT, `${mapId}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 82 });

  if (errors.length) { failed++; console.log(`  FAIL  ${mapId}: ${errors[0]}`); }
  else console.log(`  ok    ${mapId} -> public/img/arenas/${mapId}.jpg`);
  await page.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
