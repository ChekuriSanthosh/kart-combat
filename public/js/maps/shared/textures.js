/**
 * Procedural canvas textures — no external images.
 * Browser-only (uses document.createElement).
 */

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

function noise(ctx, w, h, scale = 0.35) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 255 * scale;
    d[i] = Math.min(255, Math.max(0, d[i] + n));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

export function createGravelTexture(THREE, size = 512) {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#6b5a45';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 8000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.5 + Math.random() * 2.5;
    const shade = 80 + Math.floor(Math.random() * 90);
    ctx.fillStyle = `rgb(${shade},${shade - 15},${shade - 35})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(40,30,20,${0.08 + Math.random() * 0.12})`;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 10 + Math.random() * 40, 0, Math.PI * 2);
    ctx.fill();
  }
  noise(ctx, size, size, 0.25);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createDirtTexture(THREE, size = 256) {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#5c4634';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2000; i++) {
    const shade = 60 + Math.floor(Math.random() * 70);
    ctx.fillStyle = `rgb(${shade},${shade - 20},${shade - 40})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  noise(ctx, size, size, 0.35);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createTireTexture(THREE, size = 128) {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, size, size);
  const stripeH = size / 6;
  for (let y = 0; y < size; y += stripeH * 2) {
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(0, y, size, stripeH);
  }
  ctx.strokeStyle = 'rgba(80,80,80,0.5)';
  ctx.lineWidth = 2;
  for (let x = 0; x < size; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createRockTexture(THREE, size = 256) {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#6e6a66';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 120; i++) {
    const shade = 70 + Math.floor(Math.random() * 80);
    ctx.fillStyle = `rgba(${shade},${shade - 5},${shade - 10},0.5)`;
    ctx.beginPath();
    ctx.ellipse(
      Math.random() * size,
      Math.random() * size,
      5 + Math.random() * 30,
      (5 + Math.random() * 30) * (0.6 + Math.random() * 0.5),
      Math.random() * Math.PI,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  noise(ctx, size, size, 0.4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createNeonPanelTexture(THREE, base = '#1a2030', accent = '#00e5ff', size = 256) {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.35;
  const step = size / 8;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  ctx.fillStyle = accent;
  const c = 16;
  [[0, 0], [size - c, 0], [0, size - 3], [size - c, size - 3]].forEach(([x, y]) => {
    ctx.fillRect(x, y, c, 3);
  });
  [[0, 0], [size - 3, 0], [0, size - c], [size - 3, size - c]].forEach(([x, y]) => {
    ctx.fillRect(x, y, 3, c);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createMetalTexture(THREE, size = 256) {
  const { canvas, ctx } = makeCanvas(size, size);
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#e8ecf0');
  grad.addColorStop(0.25, '#9aa3ad');
  grad.addColorStop(0.5, '#d4d9de');
  grad.addColorStop(0.75, '#7a8490');
  grad.addColorStop(1, '#c8ced6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  for (let y = 0; y < size; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(40,50,70,0.2)';
  ctx.lineWidth = 2;
  for (let r = 20; r < size; r += 28) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createBumperTexture(THREE, color = '#ff2d95', size = 128) {
  const { canvas, ctx } = makeCanvas(size, size);
  const cx = size / 2;
  const cy = size / 2;
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, size / 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, color);
  g.addColorStop(1, '#0a0a12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 4, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGiftBoxTexture(THREE, bodyColor = '#ff3d6e', ribbonColor = '#ffe066', size = 256) {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = bodyColor;
  ctx.fillRect(0, 0, size, size);

  // Ribbon cross
  const band = size * 0.18;
  ctx.fillStyle = ribbonColor;
  ctx.fillRect((size - band) / 2, 0, band, size);
  ctx.fillRect(0, (size - band) / 2, size, band);

  // Soft highlight
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // Big question mark
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = size * 0.04;
  ctx.font = `bold ${Math.floor(size * 0.55)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText('?', size / 2, size / 2 + size * 0.02);
  ctx.fillText('?', size / 2, size / 2 + size * 0.02);

  const tex = new THREE.CanvasTexture(canvas);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGiftLidTexture(THREE, lidColor = '#ff6b9a', ribbonColor = '#ffe066', size = 128) {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = lidColor;
  ctx.fillRect(0, 0, size, size);
  const band = size * 0.22;
  ctx.fillStyle = ribbonColor;
  ctx.fillRect((size - band) / 2, 0, band, size);
  ctx.fillRect(0, (size - band) / 2, size, band);
  // Bow hint
  ctx.fillStyle = ribbonColor;
  ctx.beginPath();
  ctx.arc(size * 0.35, size * 0.35, size * 0.14, 0, Math.PI * 2);
  ctx.arc(size * 0.65, size * 0.35, size * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.12, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createNetTexture(THREE, lineColor = '#a8d8ff', size = 256) {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(40,80,120,0.08)';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.55;
  const step = size / 10;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 4);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
