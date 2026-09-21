/** Procedural beach-buggy mesh for CDN THREE. */
function buildBeachBuggy(THREE, bodyColor, accentColor) {
  const root = new THREE.Group();
  root.name = 'BeachBuggy';

  // Body rides on suspension group so wheels stay planted
  const body = new THREE.Group();
  body.name = 'BuggyBody';
  root.add(body);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    metalness: 0.22,
    roughness: 0.55,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    metalness: 0.45,
    roughness: 0.4,
  });
  const cageMat = new THREE.MeshStandardMaterial({
    color: 0xdfe6e9,
    metalness: 0.7,
    roughness: 0.35,
  });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
  const hubMat = new THREE.MeshStandardMaterial({
    color: 0xc0c0c0,
    metalness: 0.8,
    roughness: 0.28,
  });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2d3436, roughness: 0.85 });
  const bumperMat = new THREE.MeshStandardMaterial({
    color: 0xf1c40f,
    metalness: 0.3,
    roughness: 0.55,
  });

  const cast = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // Chunky tub / chassis
  const tub = cast(new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.45, 2.15), bodyMat));
  tub.position.set(0, 0.42, 0.05);
  body.add(tub);

  // Raised nose / hood scoop
  const nose = cast(new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.28, 0.7), bodyMat));
  nose.position.set(0, 0.55, 0.95);
  body.add(nose);

  // Side pods
  for (const x of [-0.85, 0.85]) {
    const pod = cast(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.35, 1.6), accentMat));
    pod.position.set(x, 0.4, 0.05);
    body.add(pod);
  }

  // Front brush bumper
  const bumper = cast(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 0.32), bumperMat));
  bumper.position.set(0, 0.28, 1.35);
  body.add(bumper);
  const bar = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.55, 8), cageMat));
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 0.42, 1.42);
  body.add(bar);

  // Bucket seats (open cabin)
  for (const x of [-0.32, 0.32]) {
    const seat = cast(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.48), seatMat));
    seat.position.set(x, 0.62, -0.15);
    body.add(seat);
    const back = cast(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.12), seatMat));
    back.position.set(x, 0.85, -0.35);
    back.rotation.x = -0.15;
    body.add(back);
  }

  // Steering wheel stub
  const col = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 6), cageMat));
  col.position.set(-0.28, 0.85, 0.35);
  col.rotation.x = 0.55;
  body.add(col);
  const wheelRim = cast(new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.025, 6, 12), cageMat));
  wheelRim.position.set(-0.28, 0.98, 0.48);
  wheelRim.rotation.x = Math.PI / 2 - 0.4;
  body.add(wheelRim);

  // Open roll cage
  const tube = (x1, y1, z1, x2, y2, z2, r = 0.045) => {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const len = Math.hypot(dx, dy, dz) || 0.001;
    const mesh = cast(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), cageMat));
    mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx / len, dy / len, dz / len),
    );
    body.add(mesh);
  };
  // A-pillars
  tube(-0.7, 0.55, 0.55, -0.65, 1.35, 0.15);
  tube(0.7, 0.55, 0.55, 0.65, 1.35, 0.15);
  // B-pillars / rear
  tube(-0.7, 0.55, -0.85, -0.65, 1.35, -0.55);
  tube(0.7, 0.55, -0.85, 0.65, 1.35, -0.55);
  // Roof bars
  tube(-0.65, 1.35, 0.15, 0.65, 1.35, 0.15);
  tube(-0.65, 1.35, -0.55, 0.65, 1.35, -0.55);
  tube(-0.65, 1.35, 0.15, -0.65, 1.35, -0.55);
  tube(0.65, 1.35, 0.15, 0.65, 1.35, -0.55);
  // Cross brace
  tube(-0.65, 1.35, 0.15, 0.65, 1.35, -0.55, 0.035);

  // Rear spare-ish light bar
  const lightBar = cast(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.12), accentMat));
  lightBar.position.set(0, 1.15, -1.0);
  body.add(lightBar);

  // Fat off-road tires
  const wheels = [];
  const tireGeom = new THREE.CylinderGeometry(0.42, 0.42, 0.38, 14);
  const hubGeom = new THREE.CylinderGeometry(0.18, 0.18, 0.4, 10);
  const places = [
    { x: -0.92, y: 0.42, z: 0.95, front: true },
    { x: 0.92, y: 0.42, z: 0.95, front: true },
    { x: -0.92, y: 0.42, z: -0.95, front: false },
    { x: 0.92, y: 0.42, z: -0.95, front: false },
  ];

  for (const p of places) {
    const mount = new THREE.Group(); // steer yaw
    mount.position.set(p.x, p.y, p.z);
    mount.userData.front = p.front;
    mount.userData.baseY = p.y;
    const spinner = new THREE.Group(); // spin on local X
    const tire = cast(new THREE.Mesh(tireGeom, wheelMat));
    tire.rotation.z = Math.PI / 2;
    const hub = cast(new THREE.Mesh(hubGeom, hubMat));
    hub.rotation.z = Math.PI / 2;
    // tread nubs
    for (let i = 0; i < 8; i++) {
      const nub = cast(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.1), wheelMat));
      const a = (i / 8) * Math.PI * 2;
      nub.position.set(0, Math.sin(a) * 0.4, Math.cos(a) * 0.4);
      nub.rotation.x = a;
      spinner.add(nub);
    }
    spinner.add(tire, hub);
    mount.add(spinner);
    root.add(mount);
    wheels.push({ mount, spinner, front: p.front, baseY: p.y });
  }

  let steerSmoothed = 0;
  let spinAngle = 0;

  /**
   * @param {number} speed
   * @param {number} yawRate
   * @param {number} dt
   * @param {boolean} drifting
   * @param {number} steerInput -1..1
   * @param {{ suspension?: number, steer?: number }} [visual]
   */
  function animateWheels(speed, yawRate, dt, drifting, steerInput = 0, visual = {}) {
    // Smooth spin — accumulate angle instead of jittery per-frame hops
    const spinSpeed = speed * 2.05;
    spinAngle += spinSpeed * dt;
    // Smooth steer toward input + yaw assist
    const steerTarget = THREE.MathUtils.clamp(
      steerInput * 0.55 + (-yawRate * 0.12),
      -0.55,
      0.55,
    );
    const boost = drifting ? 1.2 : 1;
    const sA = 1 - Math.exp(-10 * dt);
    steerSmoothed += (steerTarget * boost - steerSmoothed) * sA;

    const sus = visual.suspension ?? 0;
    body.position.y = sus;

    for (const w of wheels) {
      w.spinner.rotation.x = spinAngle * (w.mount.position.x > 0 ? 1 : 1);
      // slight opposite spin sign not needed — same direction for tubes on X
      if (w.front) w.mount.rotation.y = steerSmoothed;
      // wheel stays near ground; tiny compression opposite body
      w.mount.position.y = w.baseY - sus * 0.35;
    }
  }

  return { root, body, wheels, animateWheels, bodyMat, accentMat, bumperMat };
}

export function createKartMesh(THREE, opts = {}) {
  const color = opts.color ?? 0xe74c3c;
  const accent = opts.accent ?? 0x2c3e50;
  const parts = buildBeachBuggy(THREE, color, accent);
  if (opts.scale && opts.scale !== 1) parts.root.scale.setScalar(opts.scale);
  return parts;
}

export function setKartColors(kart, bodyHex, accentHex) {
  if (kart?.bodyMat) kart.bodyMat.color.setHex(bodyHex);
  if (kart?.accentMat) kart.accentMat.color.setHex(accentHex);
}

export default createKartMesh;
