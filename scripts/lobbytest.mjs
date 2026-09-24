/**
 * The private-room waiting flow, driven through two real browsers.
 *
 * Covers what unit tests cannot: that creating a private match waits instead
 * of starting, that a guest arriving by link appears in the host's list, that
 * only the host can start it, and that quick play stays instant and codeless.
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3100';
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };

const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];

async function client(name) {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#player-name', name);
  return page;
}
const shown = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  return !!el && !el.classList.contains('hidden');
}, sel);

try {
  // ── Host creates a private match ──
  const host = await client('HostRacer');
  await host.click('#btn-create-party');
  await host.waitForSelector('#waiting:not(.hidden)', { timeout: 10000 });
  ok('creating a private match opens the waiting room, not a live game');

  if (!(await shown(host, '#hud'))) ok('HUD stays hidden while waiting');
  else fail('HUD is visible during the waiting room');

  const code = (await host.textContent('#waiting-code')).trim();
  if (/^[A-Z0-9]{5}$/.test(code)) ok(`waiting room shows the code (${code})`);
  else fail(`bad code in waiting room: "${code}"`);

  if (await shown(host, '#waiting-host')) ok('host sees the start controls');
  else fail('host cannot see start controls');
  if (!(await shown(host, '#waiting-guest'))) ok('host is not shown the guest message');
  else fail('host sees the "waiting for host" message');

  let names = await host.$$eval('#waiting-list li', (n) => n.map((e) => e.textContent));
  if (names.length === 1 && names[0].includes('HostRacer')) ok('host is alone and listed, no bots');
  else fail(`unexpected waiting list: ${JSON.stringify(names)}`);

  // ── Guest joins by the invite link ──
  const guest = await browser.newPage({ viewport: { width: 900, height: 640 } });
  guest.on('pageerror', (e) => errors.push(`guest: ${e.message}`));
  await guest.goto(`${BASE}/?join=${code}`, { waitUntil: 'networkidle' });
  await guest.waitForSelector('#waiting:not(.hidden)', { timeout: 10000 });
  ok('guest following the link lands in the waiting room');

  if (await shown(guest, '#waiting-guest')) ok('guest is told to wait for the host');
  else fail('guest is not shown the waiting message');
  if (!(await shown(guest, '#waiting-host'))) ok('guest cannot see the start button');
  else fail('guest can see the start button');

  await host.waitForTimeout(700);
  names = await host.$$eval('#waiting-list li', (n) => n.map((e) => e.textContent));
  if (names.length === 2) ok(`host sees the guest arrive (${names.length} players)`);
  else fail(`host list did not update: ${JSON.stringify(names)}`);

  // ── Host starts ──
  await host.click('#btn-start-match');
  await host.waitForSelector('#hud:not(.hidden)', { timeout: 10000 });
  await guest.waitForSelector('#hud:not(.hidden)', { timeout: 10000 });
  ok('host pressing start puts BOTH players into the match');
  if (!(await shown(host, '#waiting'))) ok('waiting room closes on start');
  else fail('waiting room still visible after start');

  await host.waitForTimeout(1200);
  const rows = await host.$$eval('#leaderboard-list li', (n) => n.length);
  if (rows > 2) ok(`empty seats filled with bots (${rows} racers)`);
  else fail(`bots were not added (${rows} racers)`);

  // ── Quick play: instant, and no code ──
  const quick = await client('QuickPlayer');
  await quick.click('#btn-play');
  await quick.waitForSelector('#hud:not(.hidden)', { timeout: 10000 });
  ok('quick play goes straight into a match');
  if (!(await shown(quick, '#waiting'))) ok('quick play shows no waiting room');
  else fail('quick play opened a waiting room');
  if (!(await shown(quick, '#invite'))) ok('quick play shows no match code');
  else fail('quick play is still showing an invite code');
  const url = await quick.evaluate(() => window.location.search);
  if (!url.includes('join=')) ok('quick play leaves the address bar clean');
  else fail(`quick play put a code in the URL: ${url}`);

  if (errors.length) fail(`console errors: ${errors.slice(0, 3).join(' | ')}`);
  else ok('no console errors across all clients');
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nWaiting room works.');
process.exit(failures ? 1 : 0);
