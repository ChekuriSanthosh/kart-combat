/**
 * Is the picture actually steady while driving?
 *
 * Judder is hard to see in a screenshot, so measure it: sample the camera and
 * the local kart every frame while driving, and look for the signature of
 * shake, which is acceleration reversing direction from one frame to the next.
 * Smooth motion changes direction a handful of times a second as you steer;
 * shake reverses tens of times a second.
 */

import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3100';
/**
 * Every arena, not just the first one. This used to default to `gravelPit`
 * and take no other argument in practice, so the two maps that actually had a
 * judder problem — the ones with bumpers and a spinning floor — were never
 * measured by the check that exists to catch exactly that.
 */
const MAPS = process.argv[3] ? [process.argv[3]] : ['gravelPit', 'skyPinball', 'beybladeArena'];
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };

const browser = await chromium.launch({ channel: 'chrome' });

for (const MAP of MAPS) {
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('ERR', e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click(`.map-card[data-map="${MAP}"]`);
await page.click('#btn-play');
await page.waitForSelector('#hud:not(.hidden)');
await page.waitForTimeout(1500);

// Drive forward, turning gently, for a few seconds.
await page.keyboard.down('w');
await page.evaluate(() => {
  window.__samples = [];
  const kc = window.__kc;
  const tick = () => {
    window.__samples.push({
      t: performance.now(),
      cx: kc.camera.position.x, cy: kc.camera.position.y, cz: kc.camera.position.z,
    });
    if (window.__samples.length < 600) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.waitForTimeout(1500);
await page.keyboard.down('d');
await page.waitForTimeout(1200);
await page.keyboard.up('d');
await page.waitForTimeout(2000);
await page.keyboard.up('w');

const stats = await page.evaluate(() => {
  const s = window.__samples;
  const axes = ['cx', 'cy', 'cz'];
  const out = {};
  for (const a of axes) {
    const v = [];
    for (let i = 1; i < s.length; i++) {
      const dt = (s[i].t - s[i - 1].t) / 1000;
      v.push(dt > 0 ? (s[i][a] - s[i - 1][a]) / dt : 0);
    }
    // Acceleration sign flips per second: the fingerprint of judder.
    let flips = 0;
    let prev = 0;
    for (let i = 1; i < v.length; i++) {
      const acc = v[i] - v[i - 1];
      if (prev !== 0 && Math.sign(acc) !== Math.sign(prev) && Math.abs(acc) > 0.02) flips++;
      if (Math.abs(acc) > 0.02) prev = acc;
    }
    const seconds = (s[s.length - 1].t - s[0].t) / 1000;
    out[a] = +(flips / seconds).toFixed(1);
  }
  out.frames = s.length;
  out.seconds = +((s[s.length - 1].t - s[0].t) / 1000).toFixed(1);
  return out;
});

console.log(`\n=== ${MAP} ===`);
console.log(`  ${stats.frames} frames over ${stats.seconds}s`);
console.log(`  camera direction reversals/sec — x: ${stats.cx}  y: ${stats.cy}  z: ${stats.cz}`);

// Steering and terrain account for a few reversals a second. Anything above
// roughly a third of the frame rate means the camera is vibrating.
const worst = Math.max(stats.cx, stats.cy, stats.cz);
if (worst < 20) ok(`camera is steady (worst axis ${worst}/s)`);
else fail(`camera is juddering (worst axis ${worst}/s)`);

await page.close();
}

await browser.close();
console.log(failures ? `\n${failures} map(s) juddering.` : '\nMotion is smooth.');
process.exit(failures ? 1 : 0);
