/**
 * Can a kart get outside the arena?
 *
 * Fires karts at every wall in every map, from every angle, at speeds up to
 * and beyond the boost ceiling, and checks none of them ends up on the far
 * side. Thin walls and high speeds are the interesting combination: a kart can
 * cover more ground in one step than a rail is thick.
 */

import { MAP_IDS, getMap } from '../shared/maps/index.js';
import { createKartState, createInput, stepKart, KART } from '../shared/physics.js';
import { SIM_DT } from '../shared/constants.js';
import { topAt } from '../shared/collision.js';

let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };

/**
 * Furthest a kart can legitimately get from the centre. Driving out to the
 * perimeter wall is fine; ending up beyond it is not.
 */
function playableRadius(map) {
  let far = map.arenaRadius || 0;
  for (const p of [...map.spawns, ...map.boxes]) far = Math.max(far, Math.hypot(p.x, p.z));
  for (const s of map.solids) {
    if (s.noStand) continue;
    far = Math.max(far, Math.hypot(s.x, s.z) + (s._reach || 0));
  }
  return far;
}

for (const id of MAP_IDS) {
  const map = getMap(id);
  const ctx = { solids: map.solids, floorY: map.floorY };
  const limit = playableRadius(map) + 12;
  console.log(`\n=== ${map.name} ===`);

  // Drive outward from the centre at every angle and every speed, including
  // speeds above the boost cap to cover knockback and ramp launches.
  const escapes = [];
  const speeds = [KART.maxSpeed, KART.boostSpeed, KART.boostSpeed * 1.6, KART.boostSpeed * 2.4];
  for (const speed of speeds) {
    for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2;
      const k = createKartState({ x: 0, y: 4, z: 0, yaw: ang });
      const input = createInput();
      input.forward = true;
      k.vx = Math.sin(ang) * speed;
      k.vz = Math.cos(ang) * speed;

      for (let n = 0; n < 240; n++) {
        k.vx += Math.sin(ang) * 260 * SIM_DT; // keep shoving outward
        k.vz += Math.cos(ang) * 260 * SIM_DT;
        const sp = Math.hypot(k.vx, k.vz);
        if (sp > speed) { k.vx = (k.vx / sp) * speed; k.vz = (k.vz / sp) * speed; }
        stepKart(k, input, ctx, SIM_DT);

        const r = Math.hypot(k.x, k.z);
        if (r > limit && k.y > map.killY) {
          escapes.push({ speed: speed.toFixed(0), ang: ((ang * 180) / Math.PI).toFixed(0), r: r.toFixed(1) });
          break;
        }
      }
    }
  }

  if (escapes.length) {
    const s = escapes.slice(0, 4).map((e) => `${e.ang}° @${e.speed}m/s -> r=${e.r}`).join(', ');
    fail(`${escapes.length}/${48 * speeds.length} karts escaped the arena: ${s}`);
  } else {
    ok(`no escapes in ${48 * speeds.length} wall impacts (up to ${(KART.boostSpeed * 2.4).toFixed(0)} m/s)`);
  }

  // Nothing should end up inside a solid after a step, either. Slam karts into
  // each individual solid and check they settle outside it.
  let embedded = 0;
  let tested = 0;
  for (const s of map.solids) {
    if (s.t === 'ring' || s.noStand) continue;
    const top = s._top ?? 0;
    if (top <= 0.6) continue; // drive-over, not a wall
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const reach = (s._reach || 2) + 6;
      const k = createKartState({
        x: s.x + Math.sin(ang) * reach,
        y: Math.max(s.y, 0),
        z: s.z + Math.cos(ang) * reach,
        yaw: ang + Math.PI,
      });
      const input = createInput();
      input.forward = true;
      k.vx = -Math.sin(ang) * KART.boostSpeed * 1.5;
      k.vz = -Math.cos(ang) * KART.boostSpeed * 1.5;
      tested++;

      for (let n = 0; n < 60; n++) stepKart(k, input, ctx, SIM_DT);
      // Only a kart that has come to rest can be wedged in something. One
      // still falling is a kart that drove off the map, even though it passes
      // under plenty of geometry on the way down.
      if (!k.grounded) continue;

      // Inside the footprint and below the top means it is in the solid.
      const dx = k.x - s.x;
      const dz = k.z - s.z;
      let inside;
      if (s.t === 'cyl') {
        const d = Math.hypot(dx, dz);
        inside = d < s.r - 0.15 && (!s.inner || d > s.inner + 0.15);
      } else {
        const c = Math.cos(s.rotY || 0);
        const sn = Math.sin(s.rotY || 0);
        const u = dx * c - dz * sn;
        const v = dx * sn + dz * c;
        const hw = s.w * 0.5;
        const hd = (s.t === 'ramp' ? s.len : s.d) * 0.5;
        inside = Math.abs(u) < hw - 0.15 && Math.abs(v) < hd - 0.15;
      }
      // Resting on a ramp's slope is not being stuck inside it, so compare
      // against the surface under the kart rather than the solid's high point.
      const surface = topAt(s, k.x, k.z);
      if (inside && k.y < (surface ?? top) - 0.2) {
        embedded++;
        if (embedded <= 4) {
          console.log(`        inside ${s.t}:${s.mat} at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`
            + ` from ${((ang * 180) / Math.PI).toFixed(0)}° — kart at (${k.x.toFixed(1)}, ${k.z.toFixed(1)}, y=${k.y.toFixed(1)})`);
        }
      }
    }
  }
  if (embedded) fail(`${embedded}/${tested} karts ended up inside a solid`);
  else ok(`no karts embedded in scenery across ${tested} impacts`);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll walls hold.');
process.exit(failures ? 1 : 0);
