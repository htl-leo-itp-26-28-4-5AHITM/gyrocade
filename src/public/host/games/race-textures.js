import * as THREE from 'three';

// All race textures are drawn on canvases at startup, so there are no asset files.

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

// One tile = the full track width (u) by 16 units of track (v). Cyan left edge, magenta right edge.
export function trackTexture() {
  const texture = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#0b0820';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(140, 70, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const p = (i * w) / 16;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, h);
      ctx.moveTo(0, p);
      ctx.lineTo(w, p);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(190, 120, 255, 0.7)';
    ctx.fillRect(0, 0, w, 4);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(w / 2 - 3, 0, 6, h / 2);

    const left = ctx.createLinearGradient(0, 0, 30, 0);
    left.addColorStop(0, '#00f0ff');
    left.addColorStop(1, 'rgba(0, 240, 255, 0)');
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, 30, h);
    const right = ctx.createLinearGradient(w, 0, w - 30, 0);
    right.addColorStop(0, '#ff2bd6');
    right.addColorStop(1, 'rgba(255, 43, 214, 0)');
    ctx.fillStyle = right;
    ctx.fillRect(w - 30, 0, 30, h);
  });
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Chevrons pointing to the top of the canvas, which is "forward" on a boost pad.
export function chevronTexture() {
  const texture = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.strokeStyle = '#ffb000';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#ff6a00';
    ctx.shadowBlur = 16;
    for (const y of [h * 0.2, h * 0.7]) {
      ctx.beginPath();
      ctx.moveTo(w * 0.15, y + h * 0.22);
      ctx.lineTo(w * 0.5, y);
      ctx.lineTo(w * 0.85, y + h * 0.22);
      ctx.stroke();
    }
  });
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 2);
  return texture;
}

export function checkerTexture() {
  const texture = canvasTexture(256, 32, (ctx, w, h) => {
    const size = h / 2;
    for (let x = 0; x < w / size; x++) {
      for (let y = 0; y < 2; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
        ctx.fillRect(x * size, y * size, size, size);
      }
    }
  });
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

export function textTexture(text, color) {
  return canvasTexture(1024, 256, (ctx, w, h) => {
    ctx.font = '400 150px Bungee, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 40;
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.fillText(text, w / 2, h / 2);
  });
}

// Synthwave sun: yellow-to-magenta disc with gaps in the lower half (cut out via alphaTest).
export function sunTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#fff36b');
    gradient.addColorStop(0.55, '#ff7a3d');
    gradient.addColorStop(1, '#ff2bd6');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(0, h * 0.55 + i * 10 + i * i * 2.4, w, 3 + i * 2.2);
    }
  });
}
