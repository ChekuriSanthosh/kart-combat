/**
 * Every weapon, one at a time, in a real browser against a real server.
 *
 * A private match with no bots keeps the arena quiet, then each weapon is
 * handed over with the POWERUP cheat (asking for that weapon by id) and used
 * the way a player would. For each one this checks what the HUD shows (name,
 * icon, count badge), that firing it does what the server says it does
 * (projectiles of the right kind and number, a bubble, a boost, orbiting
 * spikes, ammo running down), that the slot empties when it should, and that
 * nothing logs an error. Screenshots of each weapon held and in use land in
 * .playtest/weapons/ for eyeballing the graphics.
 *
 *   PORT=3300 ./scripts/with-server.sh node scripts/weapontest.mjs [weaponId...]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3100}`;
const OUT = join(process.cwd(), '.playtest', 'weapons');
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const check = (cond, msg, detail = '') => (cond ? ok(msg) : fail(detail ? `${msg} (${detail})` : msg));

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#player-name', 'Armourer');
  // A private match in the open farm, bots off: nothing to shoot back.
  await page.click('#btn-create');
  for (let i = 0; i < 6; i++) {
    const arena = (await page.textContent('#cr-arena output')).trim();
    if (arena === 'Harvest Hollow') break;
    await page.click('#cr-arena button:last-child');
  }
  await page.uncheck('#cr-bots');
  await page.click('#btn-create-party');
  await page.waitForSelector('#waiting:not(.hidden)', { timeout: 10000 });
  await page.click('#btn-start-match');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(3500); // let the spawn bubble wear off

  const { WEAPONS, WEAPON_IDS } = await page.evaluate(async () => {
    const w = await import('/shared/weapons.js');
    const defs = {};
    for (const [id, d] of Object.entries(w.WEAPONS)) {
      defs[id] = { name: d.name, kind: d.kind, uses: d.uses, ammo: d.ammo, duration: d.duration, count: d.count, ref: d.ref };
    }
    return { WEAPONS: defs, WEAPON_IDS: Object.keys(w.WEAPONS) };
  });
  const only = process.argv.slice(2);
  const ids = only.length ? only : WEAPON_IDS;

  // Watch the server's own view of us and of the projectiles in flight.
  await page.evaluate(() => {
    window.__wt = { me: null, shots: new Map() };
    window.__kc.socket.on('world:snapshot', (s) => {
      window.__wt.me = s.p.find((p) => p.i === window.__kc.localId) || window.__wt.me;
      for (const r of s.r || []) if (!window.__wt.shots.has(r.i)) window.__wt.shots.set(r.i, r.w);
    });
  });
  const me = () => page.evaluate(() => window.__wt.me);
  const shotsOf = (id) => page.evaluate((w) => [...window.__wt.shots.values()].filter((x) => x === w).length, id);
  const resetShots = () => page.evaluate(() => window.__wt.shots.clear());
  const visible = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
  }, sel);
  const give = (id) => page.evaluate(async (w) => {
    const { EVENT, CHEAT } = await import('/shared/constants.js');
    window.__kc.socket.emit(EVENT.CHEAT, { code: CHEAT.POWERUP, w });
  }, id);
  const tap = async () => { await page.keyboard.down('Space'); await page.waitForTimeout(90); await page.keyboard.up('Space'); };

  for (const id of ids) {
    const def = WEAPONS[id];
    console.log(`\n=== ${def.name} (${id}, ${def.kind}) ===`);
    // Drive a little so projectiles have somewhere to go and the shot frames
    // show the kart moving.
    await page.keyboard.down('KeyW');
    await give(id);
    await page.waitForTimeout(2300); // the slot's roulette settles first

    const held = await me();
    check(held?.w === id, 'server loaded the weapon', `slot holds ${held?.w}`);
    const name = (await page.textContent('#weapon-name')).trim();
    check(name === def.name, `slot is labelled "${def.name}"`, `shows "${name}"`);
    const icon = await page.evaluate(() => !!document.querySelector('#weapon-icon svg, #weapon-icon img'));
    check(icon, 'slot draws its icon');
    const expectBadge = def.kind === 'mine' ? def.uses
      : def.ammo ? def.ammo
        : def.duration ? Math.ceil(def.duration) : 0;
    const badgeShown = await visible('#weapon-count');
    const badge = badgeShown ? (await page.textContent('#weapon-count')).trim() : '';
    if (expectBadge > 1) check(badge === String(expectBadge), `count badge shows ${expectBadge}`, `badge "${badge}"`);
    else check(!badgeShown, 'no count badge for a single shot', `badge "${badge}"`);
    await page.screenshot({ path: join(OUT, `${id}-held.png`) });

    await resetShots();
    if (def.kind === 'stream') {
      await page.keyboard.down('Space');
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(OUT, `${id}-fired.png`) });
      const mid = await me();
      check(mid?.wn > 0 && mid.wn < def.ammo, 'holding fire runs the ammo down', `${mid?.wn} left`);
      await page.waitForTimeout(2200);
      await page.keyboard.up('Space');
      const n = await shotsOf(id);
      check(n === def.ammo, `fired all ${def.ammo} rounds`, `${n} bullets seen`);
    } else if (def.kind === 'mine') {
      for (let i = 0; i < def.uses; i++) { await tap(); await page.waitForTimeout(450); }
      await page.screenshot({ path: join(OUT, `${id}-fired.png`) });
      const n = await shotsOf(id);
      check(n === def.uses, `dropped all ${def.uses} mines`, `${n} seen`);
    } else {
      await tap();
      await page.waitForTimeout(id === 'bomb' ? 420 : 160);
      await page.screenshot({ path: join(OUT, `${id}-fired.png`) });
      await page.waitForTimeout(300);
      const after = await me();
      if (def.kind === 'projectile' || def.kind === 'lobbed') {
        check(await shotsOf(id) === 1, 'one projectile in flight', `${await shotsOf(id)} seen`);
      } else if (def.kind === 'burst') {
        // A burst fires ordinary projectiles of the weapon it refers to.
        const n = await shotsOf(def.ref ?? id);
        check(n === (def.count ?? 3), `a spread of ${def.count ?? 3}`, `${n} seen`);
      } else if (def.kind === 'timed') {
        check(after?.sh === 1 && after?.wt === 1, 'the shield goes up and its timer runs', `sh ${after?.sh} wt ${after?.wt}`);
      } else if (def.kind === 'orbit') {
        check(after?.wt === 1, 'the spike balls are spinning', `wt ${after?.wt}`);
        const spikes = await page.evaluate(() => {
          const k = window.__kc.karts.get(window.__kc.localId);
          let n = 0;
          k?.mesh.group.traverse((o) => { if (o.visible && /spike|orbit/i.test(o.name)) n++; });
          return n;
        });
        check(spikes > 0, 'and the kart is drawing them', `${spikes} visible spike parts`);
      } else if (id === 'boost') {
        check(after?.bt > 0, 'the turbo kicks in', `bt ${after?.bt}`);
      } else if (id === 'repair') {
        check(after?.h === 100, 'repair leaves you on full health', `h ${after?.h}`);
      }
      if (def.kind === 'timed' || def.kind === 'orbit') {
        // Timed weapons hold the slot while they run, then let it go.
        await page.waitForTimeout(def.duration * 1000 + 600);
      } else {
        await page.waitForTimeout(800);
      }
    }
    await page.keyboard.up('KeyW');
    await page.screenshot({ path: join(OUT, `${id}-after.png`) });
    const end = await me();
    check(!end?.w, 'the slot is empty again once it is used up', `still holds ${end?.w}`);
    // Out of the turbo / away from any lingering mine before the next one.
    await page.waitForTimeout(700);
  }

  if (errors.length) fail(`console errors: ${[...new Set(errors)].slice(0, 4).join(' | ')}`);
  else ok('no console errors');
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nEvery weapon works.');
process.exit(failures ? 1 : 0);
