import * as THREE from 'three';

// Shared material roles and procedural textures, so the lobby and the minigames speak one
// visual language: dark slabs and metal trim carry the form, neon is only used for authored
// signal lines (edges, strips, emblems), and warnings use one hazard stripe.
// Materials are created per call: games dispose everything they own on exit.

export const SIGNAL = {
  cyan: '#00f0ff',
  magenta: '#ff2bd6',
  amber: '#ffb22e',
  go: '#39ff14',
  danger: '#ff3355',
  purple: '#a855ff',
};

// Bloom only picks up pixels brighter than this (linear luminance). Lit surfaces stay below
// it, so balls and floors keep their color; authored neon is pushed above it.
export const BLOOM_THRESHOLD = 1.3;

const luminanceOf = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const MAX_CHANNEL = 2.8;

// A color at a given linear luminance. Hues differ a lot in brightness (cyan is about twice as
// bright as magenta at full value), so every glow is set by luminance, not by a multiplier.
// Dark hues (magenta, blue, purple) would need channels of 4+ to get there and then flood the
// bloom; they are capped and topped up with white instead, like the hot core of a neon tube.
export function glowColor(color, luminance) {
  const c = new THREE.Color(color);
  c.multiplyScalar(luminance / Math.max(luminanceOf(c), 0.02));
  const peak = Math.max(c.r, c.g, c.b);
  if (peak <= MAX_CHANNEL) return c;
  c.multiplyScalar(MAX_CHANNEL / peak);
  const whiten = (luminance - luminanceOf(c)) / (MAX_CHANNEL - luminanceOf(c));
  return c.lerp(new THREE.Color(MAX_CHANNEL, MAX_CHANNEL, MAX_CHANNEL), THREE.MathUtils.clamp(whiten, 0, 1));
}

// Unlit neon tube that blooms. Bloom takes a pixel's whole color once it passes the threshold,
// so tubes sit just above it: every hue then glows about the same. strength 1 = standard tube.
export const NEON_LUMINANCE = 1.55;
export const neon = (color, strength = 1) => new THREE.MeshBasicMaterial({ color: glowColor(color, NEON_LUMINANCE * strength) });

// Dark brushed metal for rails, frames and posts: picks up the environment map.
export const trimMetal = (color = 0x2a2350) => new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.32 });

// Matte body of slabs and blocks.
export const slab = (color = 0x0d0a22) => new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.6 });

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// A gyroscope dial: two rings, degree ticks and a crosshair. The lobby floor, the Knockout
// platform and the phone pad share it, so the big screen and the phones look related.
export function drawGyroEmblem(ctx, cx, cy, r, color, alpha = 0.6) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = r * 0.025;
  for (const k of [1, 0.7]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let deg = 0; deg < 360; deg += 10) {
    const a = (deg * Math.PI) / 180;
    const long = deg % 30 === 0;
    const r0 = r * (long ? 0.8 : 0.86);
    ctx.lineWidth = r * (long ? 0.022 : 0.012);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r * 0.94, cy + Math.sin(a) * r * 0.94);
    ctx.stroke();
  }
  // crosshair with a gap around the centre, and a small hub
  ctx.lineWidth = r * 0.015;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * r * 0.18, cy + dy * r * 0.18);
    ctx.lineTo(cx + dx * r * 0.62, cy + dy * r * 0.62);
    ctx.stroke();
  }
  ctx.lineWidth = r * 0.02;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.08, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Floor of beveled 2×2 panels with glowing seams and the gyro emblem in the middle.
// Used as map and emissive map: the dark panels stay dark, the seams and emblem glow.
// width/depth in world units; tile = panel size in world units.
export function panelFloorTexture({ width, depth, accent = SIGNAL.cyan, seam = '#3b2a86', tile = 2, emblem = 0.33 }) {
  const ppu = 32;
  return canvasTexture(width * ppu, depth * ppu, (ctx, w, h) => {
    const t = tile * ppu;
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < h; y += t) {
      for (let x = 0; x < w; x += t) {
        const v = 16 + Math.floor(random() * 7);
        ctx.fillStyle = `rgb(${v}, ${v - 4}, ${v + 26})`;
        ctx.fillRect(x, y, t, t);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; // lit top-left bevel
        ctx.fillRect(x + 2, y + 2, t - 4, 2);
        ctx.fillRect(x + 2, y + 2, 2, t - 4);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'; // shaded bottom-right bevel
        ctx.fillRect(x + 2, y + t - 4, t - 4, 2);
        ctx.fillRect(x + t - 4, y + 2, 2, t - 4);
      }
    }
    ctx.strokeStyle = seam;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += t) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y <= h; y += t) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    if (emblem > 0) drawGyroEmblem(ctx, w / 2, h / 2, Math.min(w, h) * emblem, accent, 0.55);
  });
}

// One beveled floor panel with glowing seams, repeated over surfaces whose UVs are in world
// units (extruded platforms): set texture.repeat to 1 / panel size.
export function panelTileTexture(seam) {
  const texture = canvasTexture(64, 64, (ctx, w) => {
    ctx.fillStyle = 'rgb(18, 14, 42)';
    ctx.fillRect(0, 0, w, w);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(3, 3, w - 6, 2);
    ctx.fillRect(3, 3, 2, w - 6);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(3, w - 5, w - 6, 2);
    ctx.fillRect(w - 5, 3, 2, w - 6);
    ctx.strokeStyle = seam;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, w, w);
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// The gyro emblem alone on a transparent square, for decals on top of other floors.
export function emblemTexture(color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  drawGyroEmblem(canvas.getContext('2d'), 256, 256, 240, color, 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Diagonal warning stripes (amber on near-black), for edges that kill and blocks that hurt.
export function hazardTexture(color = SIGNAL.amber) {
  const texture = canvasTexture(128, 32, (ctx, w, h) => {
    ctx.fillStyle = '#120a06';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = color;
    for (let x = -h; x < w + h; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 16, h);
      ctx.lineTo(x + 16 + h, 0);
      ctx.lineTo(x + h, 0);
      ctx.closePath();
      ctx.fill();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

// Soft white radial falloff for additive glow cards (under-glow, halos).
export function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.35)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

// Additive glow card lying flat, e.g. light spilling under a floating board.
export function glowCard(width, depth, color, opacity = 0.5) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  mesh.renderOrder = -1;
  return mesh;
}
