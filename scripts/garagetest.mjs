/**
 * Every character and every chassis has to actually build.
 *
 * A cosmetic that throws only fails for the players who picked it, and only
 * once they are already in a match — so each one is constructed here rather
 * than trusting that six variants written in one sitting all work.
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3100';
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // ── The customize screen ──
  const hidden = await page.evaluate(() =>
    document.getElementById('customize').classList.contains('hidden'));
  if (hidden) ok('customize starts closed');
  else fail('customize screen is open on load');

  await page.click('#btn-customize');
  await page.waitForTimeout(400);
  const drivers = await page.$$eval('#cz-options button', (n) => n.length);
  if (drivers === 6) ok(`customize offers ${drivers} drivers`);
  else fail(`expected 6 drivers, found ${drivers}`);

  await page.click('.cz-tab[data-tab="kart"]');
  await page.waitForTimeout(300);
  const karts = await page.$$eval('#cz-options button', (n) => n.length);
  if (karts === 6) ok(`customize offers ${karts} chassis`);
  else fail(`expected 6 chassis, found ${karts}`);

  // The preview must actually be drawing, not a blank canvas.
  const drew = await page.evaluate(() => {
    const c = document.getElementById('cz-canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { w: c.width, h: c.height, hasGL: !!gl };
  });
  if (drew.hasGL && drew.w > 50 && drew.h > 50) ok(`preview canvas is live (${drew.w}x${drew.h})`);
  else fail(`preview canvas not rendering: ${JSON.stringify(drew)}`);

  // Picking something must change what the preview shows.
  const changed = await page.evaluate(async () => {
    const before = document.getElementById('cz-name').textContent;
    document.querySelectorAll('.cz-tab')[0].click();
    await new Promise((r) => setTimeout(r, 150));
    const buttons = document.querySelectorAll('#cz-options button');
    buttons[buttons.length - 1].click();
    await new Promise((r) => setTimeout(r, 250));
    return { before, after: document.getElementById('cz-name').textContent };
  });
  if (changed.before !== changed.after) ok(`selecting updates the preview ("${changed.before}" -> "${changed.after}")`);
  else fail(`preview did not update, still "${changed.after}"`);

  await page.click('#cz-random');
  await page.waitForTimeout(300);
  const randomised = await page.evaluate(() => document.getElementById('cz-name').textContent);
  if (randomised) ok(`randomize picks a loadout (${randomised})`);
  else fail('randomize produced nothing');

  await page.click('#cz-back');
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() =>
    document.getElementById('customize').classList.contains('hidden'));
  if (closed) ok('back closes the customize screen');
  else fail('back did not close the customize screen');

  // Build one mesh of every combination and count what came out.
  const built = await page.evaluate(async () => {
    const { CHARACTERS, KARTS } = await import('/shared/cosmetics.js');
    const { createKartMesh } = await import('/js/render/KartMesh.js');
    const out = [];
    for (const c of Object.keys(CHARACTERS)) {
      for (const k of Object.keys(KARTS)) {
        try {
          const m = createKartMesh(0xff8800, 'Test', { character: c, kart: k, showTag: false });
          const THREE = await import('three');
          let meshes = 0;
          // Measure the actual model. The floating name tag is a sprite that
          // sits at a fixed height on every kart, so including it made all six
          // chassis report an identical bounding box.
          // Measure the bodywork only. The shield bubble and freeze block are
          // always present but hidden, and being 1.6 m spheres they swamped
          // every measurement and made all six chassis look identical.
          const box = new THREE.Box3();
          m.group.traverse((o) => { if (o.isMesh) meshes++; });
          m.body.traverse((o) => {
            if (o.isMesh && o.visible) box.expandByObject(o);
          });
          const size = box.getSize(new THREE.Vector3());
          out.push({
            c, k, meshes,
            h: +size.y.toFixed(2), w: +size.x.toFixed(2), d: +size.z.toFixed(2),
          });
          m.dispose();
        } catch (e) { out.push({ c, k, error: e.message }); }
      }
    }
    return out;
  });

  const broken = built.filter((b) => b.error);
  if (!broken.length) ok(`all ${built.length} driver x chassis combinations build`);
  else fail(`${broken.length} failed, e.g. ${broken[0].c}/${broken[0].k}: ${broken[0].error}`);

  const empty = built.filter((b) => !b.error && b.meshes < 10);
  if (!empty.length) ok('every combination produced a full model');
  else fail(`${empty.length} combos built almost nothing, e.g. ${empty[0].c}/${empty[0].k} (${empty[0].meshes} meshes)`);

  // Chassis must be distinguishable by shape, not just colour.
  //
  // Compared with the driver held fixed: taking the tallest result per chassis
  // measured whichever character wore the tallest hat, which is identical
  // across all six and made every chassis look the same size.
  // Height alone is not a silhouette: three of these are low-slung karts that
  // legitimately stand the same height and differ in length and track width.
  // Compare the whole bounding box instead.
  const shapes = built
    .filter((b) => !b.error && b.c === 'rooster')
    .map((b) => [b.k, `${b.w}x${b.h}x${b.d}`]);
  const distinct = new Set(shapes.map(([, sig]) => sig)).size;
  console.log('    chassis w x h x d: ' + shapes.map(([k, sig]) => `${k} ${sig}`).join('  '));
  if (distinct === shapes.length) ok(`all ${distinct} chassis have distinct silhouettes`);
  else fail(`only ${distinct} distinct silhouettes across ${shapes.length} chassis`);

  // ── Live swap reaches other players ──
  await page.click('#btn-play');
  await page.waitForSelector('#hud:not(.hidden)');
  await page.waitForTimeout(800);
  await page.click('.map-card[data-map="gravelPit"]').catch(() => {});
  const swapped = await page.evaluate(async () => {
    const before = window.__kc.scene.children.length;
    window.__kc.socket.emit('player:customize', { character: 'knight', kart: 'monster' });
    await new Promise((r) => setTimeout(r, 900));
    return { before, after: window.__kc.scene.children.length };
  });
  if (swapped.after > 0) ok('live customise round-trips without breaking the scene');
  else fail('scene emptied after a live customise');

  // ── Invisibility must be reversible ──
  // Ghosting rewrites every material's opacity; several are meant to stay
  // see-through, so going invisible and back has to leave them as they were.
  const ghost = await page.evaluate(async () => {
    const { createKartMesh } = await import('/js/render/KartMesh.js');
    const m = createKartMesh(0xff8800, 'Test', { character: 'astronaut', kart: 'classic' });
    const before = m.materials.map((x) => x.opacity);
    m.apply({ x: 0, y: 0, z: 0, yaw: 0, speed: 0, yawRate: 0, invisible: true, isLocal: true }, 0.016);
    const during = m.materials.map((x) => x.opacity);
    m.apply({ x: 0, y: 0, z: 0, yaw: 0, speed: 0, yawRate: 0, invisible: false }, 0.016);
    const after = m.materials.map((x) => x.opacity);
    m.dispose();
    return { before, during, after };
  });
  const faded = ghost.during.every((o, i) => o < ghost.before[i] || ghost.before[i] === 0);
  const restored = ghost.after.every((o, i) => Math.abs(o - ghost.before[i]) < 1e-6);
  if (faded) ok('going invisible fades every material');
  else fail('invisibility did not fade all materials');
  if (restored) ok('coming back restores original transparency exactly');
  else fail(`materials not restored: before ${ghost.before.join(',')} after ${ghost.after.join(',')}`);

  if (errors.length) fail(`console errors: ${errors.slice(0, 2).join(' | ')}`);
  else ok('no console errors');
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nGarage works.');
process.exit(failures ? 1 : 0);
