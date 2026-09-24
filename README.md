# Kart Combat

A browser multiplayer kart brawler in the style of [Smash Karts](https://smashkarts.io/):
drive a kart around a small arena, grab mystery crates, and knock everyone else
out with whatever weapon you pull.

```bash
npm install
npm start          # http://localhost:3000
```

## How it plays

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Drive |
| `Shift` | Drift (hold through a corner for a boost) |
| `Space` / click | Fire |

Scores only ever go up. You earn a point for knocking someone out with a
weapon; bumping into people and falling off the map cost you nothing but the
respawn wait.

Weapons hit hard, the way the genre expects:

| Weapon | Effect |
| --- | --- |
| Rocket, Bomb, Mine | One hit, including anywhere inside the blast |
| Machine Gun | Four bullets |
| Freeze Ray | Halves the health you have left — never finishes you off |
| Shield, Turbo, Repair Kit | Used on yourself |

Bot skill is picked in the lobby — **Easy**, **Normal** or **Hard** — and the
match shows which is in force next to its code, because quick play drops you
into an existing game that may not be running the setting you chose.

Three arenas ship with the game: **Gravel Pit** (a walled desert bowl with
raised decks and launch ramps), **Sky Pinball** (neon platforms and bumpers over
a void), and **Beyblade Arena** (a terraced stadium dish that spins, dragging
karts toward the rim).

Empty slots are filled with bots, up to 15 racers per match.

## Playing with friends

**Play** drops you into whichever public match has the most people in it, or
opens a new one if they are all full.

**Create private match** opens a room only reachable by its code. Every match —
public or private — shows its code in the corner with a **Copy invite link**
button next to it, and the address bar tracks the match you are in, so sharing
the URL you are already looking at works too. Opening a `?join=CODE` link takes
you straight into that match without stopping at the lobby.

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
  constants.js     event names, tick rates, input packing
  collision.js     solid geometry: ground height + push-out
  physics.js       the kart simulation
  weapons.js       weapon definitions + projectile simulation
  ai.js            bot driver
  maps/            arena blueprints (data, not meshes)

server/room.js   one match: karts, crates, projectiles, scoring
server.js        express + socket.io + the fixed-step loop

public/js/
  net/Predictor.js     local prediction and reconciliation
  net/Interpolator.js  smoothing for everyone else
  render/              blueprint -> meshes, kart model, effects
```

A few consequences worth knowing about:

**Maps are data.** A map blueprint lists solids with real dimensions. The
server feeds that list straight to the physics, and `render/MapBuilder.js`
generates meshes from the very same numbers. A wall cannot be drawn somewhere
other than where it blocks, because there is only one description of it.

**Physics runs identically on both ends.** `shared/physics.js` steps at a fixed
60 Hz. The server runs it authoritatively; the client runs the same function to
predict the local kart, then replays any unacknowledged inputs when a snapshot
lands. Corrections are absorbed by a render offset that decays over a few
frames rather than snapping.

**Weapons are server-side.** Damage, blasts, knockback and crate pickups are all
decided by the server. The client receives a list of projectiles to draw and an
event stream for effects.

## Checks

```bash
npm run check      # headless simulation: geometry, spawns, ramps, bots, walls
npm run playtest   # boots a real browser, plays each map, screenshots to .playtest/
npm run party      # two browsers, one invite link: do they end up in the same match?
npm run smooth     # measures camera judder while driving
```

`npm run check` is the fast one and needs nothing but node. It drives a full
grid of bots around every arena using the shipping AI, and separately fires
karts at every wall from every angle at up to 91 m/s — well past the boost
ceiling — to prove none of them gets out of the arena or wedged in scenery.
Fast karts crossing thin walls is exactly the case that is easy to regress and
impossible to catch by playing.

The browser-based checks need Chrome installed. `npm run smooth` is worth
explaining: judder is invisible in a screenshot, so it samples the camera every
frame and counts how often acceleration reverses direction. Steering and bumps
account for a few reversals a second; vibration produces tens of them. A clean
run sits in the single digits, and injecting as little as 5 cm of shake pushes
it past 45/s, so the measurement has plenty of headroom to catch a regression.

It now runs every arena. It used to default to Gravel Pit and was never given
another, which meant the only two maps with a judder problem — the ones with
bumpers and a spinning floor — were the two it never looked at.

**Known issue:** Sky Pinball and Beyblade Arena still fail that check
(roughly 20–34 reversals/s against a threshold of 20). Both are maps where
`applyEnvironment` applies continuous forces, and the residual shake comes from
the interaction between those position-dependent forces and prediction being
re-based on a rounded snapshot twenty times a second. Gravel Pit, which has no
such forces, sits comfortably inside the threshold.
