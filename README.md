# Kart Combat

A browser multiplayer kart brawler in the style of [Smash Karts](https://smashkarts.io/):
drive a chibi animal around a toy-box arena, grab mystery boxes, and smash
everyone else with whatever weapon you pull.

```bash
npm install
npm start          # http://localhost:3000
```

## How it plays

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Drive |
| `Shift` | Drift (hold through a corner for a boost) |
| `Space` / click | Fire — hold it for the machine gun |
| `Esc` | Settings, and Quit back to the menu |
| any key | Respawn, once "Press Any Key To Continue" is up |

Rounds last three minutes. You score by smashing someone with a weapon;
bumping into people and falling off the map cost you nothing but the respawn.
The clock in the top centre counts the seconds left.

When you are smashed, the screen tells you who did it and with what ("You were
smashed by **Rusty's** rocket"). After a moment the camera follows your killer
through a 3-2-1, then "Press Any Key To Continue" puts you back in, inside a
green bubble that keeps you safe for three seconds. Nobody is kept waiting on
the prompt for ever: after ten seconds you respawn anyway.

At the whistle the arena freezes on **ROUND OVER**, then **Winners Are …**
names everyone tied on the top score, with confetti, and counts down to the
next round. When it starts you sit out with the scoreboard until you press
`Space` to join, so nobody is dropped back in while they are away.

Weapons come out of the tumbling **?** boxes. The slot in the bottom-right
shows what you are holding, and its badge counts what is left of it:

| Weapon | Effect |
| --- | --- |
| Rocket | One hit, including anywhere inside the blast |
| Triple Rocket | Three rockets in a spread |
| Machine Gun | 20 rounds while you hold fire; bullets curve onto the nearest kart ahead |
| Mine | Three, dropped behind you |
| Bomb | Lobbed ahead; one hit inside the blast |
| Spike Balls | Four spiked balls orbit you for 6 s and smash anyone they touch |
| Freeze Ray | Halves the health you have left — never finishes you off |
| Shield | 6.5 s of protection |
| Turbo, Repair Kit | Used on yourself |

Your own explosives only knock you about; they never smash you.

Bot skill is picked when creating a private match — **Easy**, **Normal** or
**Hard** — and the in-match settings show which is in force, because quick
play drops you into an existing game that may be running a different setting.

Four arenas ship with the game: **Gravel Pit** (a sunny toy desert with
striped mesas, raised decks and launch ramps), **Sky Pinball** (candy
platforms and bumpers floating over the clouds), **Beyblade Arena** (a
terraced stadium dish that spins, dragging karts toward the rim) and
**Harvest Hollow** (a cartoon farm with a barn you can drive through).

Eight drivers and six karts are on the **Customize** screen: Dumpling the
panda, Sir Ribbit, Squeakers, Captain Whiskers, Hopscotch, Rusty, Bananas and
Waddles, in the Runabout, Stomper, Flatline, Pod, Harvester or Sledge.

Empty slots are filled with bots, up to 15 racers per match.

## Playing with friends

**PLAY** drops you into whichever public match on the chosen arena has the
most people in it, or opens a new one. The **▲** beside it opens the arena
picker, which shows how many people are playing each one.

**Create** opens a private match. Pick the arena, round length, player cap,
bot skill and whether bots fill the empty seats, and you land in a waiting
room with a five-character room code and a **Copy Link** button. The host
presses `Space` (or Start) when everyone is in. **Join** takes a code.

The address bar tracks the private match you are in, so sharing the URL you
are already looking at works too, and opening a `?join=CODE` link takes you
straight into that match without stopping at the menu.

Codes are five characters from an alphabet that leaves out every confusable
pair (no `O`/`0`, no `I`/`1`, no `S`/`5`), so they survive being read aloud.
A code that does not match a live room is refused rather than fuzzy-matched
onto a different one. Private rooms outlive their last player by two minutes,
so a host who refreshes keeps their code.

## Architecture

The guiding rule is that **there is exactly one implementation of anything that
matters**. The server is authoritative; the client sends button presses and
draws what it is told.

```
shared/          imported unchanged by BOTH the server and the browser
  constants.js     event names, timings, input packing
  collision.js     solid geometry: ground height + push-out
  physics.js       the kart simulation
  weapons.js       weapon definitions + projectile simulation
  cosmetics.js     drivers and karts
  ai/              bot driver: nav grid, aiming, difficulty
  maps/            arena blueprints (data, not meshes)

server/room.js   one match: karts, crates, projectiles, scoring, the round loop
server.js        express + socket.io + the fixed-step loop

public/
  css/base.css         design tokens and the shared chunky-blue components
  css/menu.css         menu, modals, waiting room, Customize
  css/hud.css          in-match HUD and overlays
  js/main.js           client entry: input, prediction, camera, screens
  js/settings.js       player preferences (leaderboard size, camera tilt, stats)
  js/ui/               HUD pieces: leaderboard, weapon slot, modals, confetti
  js/net/Predictor.js  local prediction and reconciliation
  js/net/Interpolator.js  smoothing for everyone else
  js/render/           lighting, toy materials, arena meshes and backdrop,
                       kart and driver models, effects
```

A few consequences worth knowing about:

**Maps are data.** A map blueprint lists solids with real dimensions. The
server feeds that list straight to the physics, and `render/MapBuilder.js`
generates meshes from the very same numbers. A wall cannot be drawn somewhere
other than where it blocks, because there is only one description of it. The
rounded caps, scenery ring and props around an arena are decoration only and
never collide.

**Physics runs identically on both ends.** `shared/physics.js` steps at a fixed
60 Hz. The server runs it authoritatively; the client runs the same function to
predict the local kart, then replays any unacknowledged inputs when a snapshot
lands. Corrections are absorbed by a render offset that decays over a few
frames rather than snapping. A wrecked kart is the server's to place, so the
client stops predicting while you are dead.

**Weapons are server-side.** Damage, blasts, knockback, ammo, crate pickups and
the death → respawn timing are all decided by the server. The client receives a
list of projectiles to draw and an event stream for effects and messages.

**One look.** `render/lighting.js` is the only place renderer colour handling
and the light rig are set, and every game-world material is flat Lambert, so
the arenas, karts and the menu turntables all come out in the same bright toy
palette.

## Checks

```bash
npm run check      # headless: geometry, spawns, ramps, bots, walls, the round loop
npm run playtest   # boots a real browser, plays each arena, screenshots to .playtest/
npm run hud        # HUD layout, weapon slot, settings, death → respawn, round end
npm run lobby      # private match waiting room, quick play, clock, results
npm run party      # two browsers, one invite link: do they end up in the same match?
npm run garage     # every driver × kart builds; Customize works
npm run smooth     # measures camera judder while driving
npm run thumbs     # re-renders the arena picker's thumbnails
```

Every browser script starts its own server on `PORT` (default 3100) and stops
it afterwards, so `PORT=3300 npm run hud` can run alongside another check.

`npm run check` is the fast one and needs nothing but node. It drives a full
grid of bots around every arena using the shipping AI, fires karts at every
wall from every angle at up to 91 m/s — well past the boost ceiling — to prove
none of them gets out of the arena or wedged in scenery, and runs a real room
through its rules: who gets credited with a kill and with which weapon, that
explosives spare their owner, the respawn gating, spike balls, ties, and the
round over → winners → next round → join loop.

The browser-based checks need Chrome installed. `npm run hud` measures the HUD
rather than eyeballing it: every always-on box must be on screen and none may
overlap another, at three window sizes. It then gets itself wrecked for real on
Sky Pinball and follows the death message, the 3-2-1 and the respawn.

`npm run smooth` is worth explaining: judder is invisible in a screenshot, so it
samples the camera every frame and counts how often acceleration reverses
direction. Steering and bumps account for a few reversals a second; vibration
produces tens of them. A clean run sits in the single digits to low teens, and
injecting as little as 5 cm of shake pushes it past 45/s, so the measurement
has plenty of headroom to catch a regression.

**Known issue:** Sky Pinball and Beyblade Arena still fail that check
(roughly 20–34 reversals/s against a threshold of 20). Both are maps where
`applyEnvironment` applies continuous forces, and the residual shake comes from
the interaction between those position-dependent forces and prediction being
re-based on a rounded snapshot twenty times a second. Gravel Pit, which has no
such forces, sits comfortably inside the threshold; Harvest Hollow hovers
around it from run to run.
