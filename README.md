# Kart combat — physics & weapons (bot-physics-kart)

Drop-in ES modules for arcade kart driving + combat. Expects Three.js (CDN or bundler) passed into factories.

## Modules

| Path | Role |
|------|------|
| `src/physics/VehicleController.js` | WASD / arrows, accel, brake, steer, Shift drift, camera-follow, status modifiers |
| `src/vehicles/KartMesh.js` | Procedural low-poly kart mesh + wheel anim |
| `src/combat/Health.js` | 100 HP, damage / heal / invuln / respawn |
| `src/combat/Weapons.js` | Banana, shells, mushroom, star, lightning, oil, custom bomb + status effects |

## Quick wire-up (architect)

```js
import * as THREE from 'three'; // or global THREE from CDN
import {
  createVehicleController,
  createKartMesh,
  createHealth,
  createWeaponSystem,
} from './src/index.js';

const vehicle = createVehicleController(THREE);
vehicle.bindKeys(window);
const kart = createKartMesh(THREE, { color: 0xe74c3c });
scene.add(kart.root);
const health = createHealth(100);
const weapons = createWeaponSystem(THREE);

// per frame
vehicle.update(dt, { statusEffects: weapons.getEffects(localId), groundY: 0 });
vehicle.syncMesh(kart.root);
kart.animateWheels(vehicle.state.speed, vehicle.state.yawRate, dt);
vehicle.updateCamera(camera, dt);
health.tick(dt);
const events = weapons.update(dt, [
  { id: localId, ...vehicle.getSnapshot(), health },
  // ...remote karts
], { bounds: arenaBounds });
```

## Status effects (consumed by VehicleController)

- `boost` — speed / accel up
- `slow` / `ink` — speed down
- `spin` / `stun` — controls locked
- `ice` — steering reduced
- `invincible` — blocks weapon damage

## Integration notes for bot-architect / bot-3d-maps

- Spawn: `vehicle.reset(x, rideHeight, z, yaw)`
- Arena bounds: pass `{ minX, maxX, minZ, maxZ }` into `weapons.update` for shell bounce
- Hazards / pads from maps can call `weapons.applyStatus(id, { type, duration, magnitude })`
