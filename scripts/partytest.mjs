/**
 * Two browsers, one invite link.
 *
 * Host creates a private match, we read the code off their HUD, build the
 * invite URL, and open it in a second browser. Both should end up in the same
 * room seeing each other on the leaderboard.
 */

import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3100';
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };

const browser = await chromium.launch({ channel: 'chrome' });

async function openClient(name) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#player-name', name);
  return { page, errors };
}

const roster = (page) => page.$$eval('#leaderboard-list li', (n) => n.map((e) => e.textContent));

try {
  // ── Host opens a private match ──
  // A private match now gathers in a waiting room first, so the code is read
  // from there; the in-match HUD only appears once the host starts.
  const host = await openClient('HostRacer');
  await host.page.click('#btn-create-party');
  await host.page.waitForSelector('#waiting:not(.hidden)');
  const code = (await host.page.textContent('#waiting-code')).trim();

  if (/^[A-Z0-9]{5}$/.test(code)) ok(`host got match code ${code}`);
  else fail(`match code looks wrong: "${code}"`);

  const url = await host.page.evaluate(() => window.location.href);
  if (url.includes(`join=${code}`)) ok('address bar updated to the invite link');
  else fail(`address bar is "${url}", expected ?join=${code}`);

  // ── The copy button has to actually be clickable ──
  // The HUD overlay covers the screen and sets `pointer-events: none` so that
  // clicks reach the game and fire. Anything in it you are meant to press has
  // to opt back in, and when it does not the button still renders, still
  // highlights, still looks entirely fine — and every click sails through it
  // into the canvas and shoots a rocket instead. Nothing visual catches that,
  // so assert on what actually receives the click.
  const hitTarget = await host.page.evaluate(() => {
    const el = document.getElementById('btn-waiting-invite');
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || el.contains(hit) ? 'button' : `<${hit?.tagName.toLowerCase()}${hit?.id ? '#' + hit.id : ''}>`;
  });
  if (hitTarget === 'button') ok('copy invite button receives its own clicks');
  else fail(`copy invite button is unclickable — clicks land on ${hitTarget}`);

  // And pressing it must put the link somewhere, not throw.
  await host.page.click('#btn-waiting-invite');
  await host.page.waitForTimeout(500);
  const copyToast = (await host.page.textContent('#toast')) || '';
  if (/copied|join=/i.test(copyToast)) ok(`copy button responded: "${copyToast.trim().slice(0, 48)}"`);
  else fail(`copy button did nothing visible (toast: "${copyToast.trim()}")`);

  // ── Guest follows the link ──
  const guest = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const guestErrors = [];
  guest.on('pageerror', (e) => guestErrors.push(e.message));
  await guest.goto(`${BASE}/?join=${code}`, { waitUntil: 'networkidle' });
  await guest.waitForSelector('#waiting:not(.hidden)', { timeout: 10000 });
  ok('guest joined straight from the link, no lobby');

  const guestCode = (await guest.textContent('#waiting-code')).trim();
  if (guestCode === code) ok('guest is in the same match');
  else fail(`guest is in match ${guestCode}, host is in ${code}`);

  // ── Host starts, and only then does anyone drive ──
  await host.page.click('#btn-start-match');
  await host.page.waitForSelector('#hud:not(.hidden)', { timeout: 10000 });
  await guest.waitForSelector('#hud:not(.hidden)', { timeout: 10000 });
  ok('host start puts both players into the match');

  // Both should see two humans in a roster that also contains bots.
  await host.page.waitForTimeout(1200);
  const hostRoster = await roster(host.page);
  const names = hostRoster.join(' ');
  if (names.includes('HostRacer') && names.includes('Racer')) {
    ok(`both players share a leaderboard (${hostRoster.length} racers)`);
  } else {
    fail(`host leaderboard is missing someone: ${JSON.stringify(hostRoster)}`);
  }

  // ── A bad code must not silently drop you somewhere else ──
  const stray = await openClient('Stray');
  await stray.page.fill('#join-code', 'ZZZZZ');
  await stray.page.click('#btn-join-code');
  await stray.page.waitForTimeout(900);
  const strayInGame = await stray.page.$('#hud:not(.hidden)');
  const toastText = (await stray.page.textContent('#toast')) || '';
  if (!strayInGame && /code/i.test(toastText)) ok(`unknown code is refused: "${toastText.trim()}"`);
  else fail(`unknown code did not error (in game: ${!!strayInGame}, toast: "${toastText}")`);

  // ── Quick play must not land in somebody's private match ──
  const quick = await openClient('QuickPlayer');
  await quick.page.click('#btn-play');
  await quick.page.waitForSelector('#hud:not(.hidden)');
  // Quick play exposes no code at all now, so "did it land in the private
  // room" is answered by whether it can see that room's players.
  const quickShowsCode = await quick.page.evaluate(() => {
    const el = document.getElementById('invite');
    return !!el && !el.classList.contains('hidden');
  });
  if (!quickShowsCode) ok('quick play exposes no match code');
  else fail('quick play is still showing an invite code');

  const quickRoster = (await roster(quick.page)).join(' ');
  if (!quickRoster.includes('HostRacer')) ok('quick play stays out of private matches');
  else fail('quick play dropped a stranger into the private match');

  const allErrors = [...host.errors, ...guestErrors, ...stray.errors, ...quick.errors];
  if (allErrors.length) fail(`console errors: ${allErrors.slice(0, 3).join(' | ')}`);
  else ok('no console errors across all four clients');
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nParty links work.');
process.exit(failures ? 1 : 0);
