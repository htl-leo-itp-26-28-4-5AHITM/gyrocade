import * as THREE from 'three';
import { glowColor } from './kit.js';

// The player ball, shared by the lobby and every minigame. Styled like a pool ball: glossy
// player-colored shell with a white badge carrying the player's initial, so players find
// themselves on a projector across the room and can see the ball roll. Only the floor ring
// is a neon light; the ball itself glows softly, so bloom never washes its color out.

const GLOW = { idle: 0.12, boost: 1.1 };

// ball: the sphere (rotate it to roll); base: shadow and neon ring, lying flat at y = 0 of
// its own group, to be kept on the floor while the ball drops or bounces.
export function createBall(player, radius) {
  const texture = ballTexture(player.color, initial(player.name));
  const material = new THREE.MeshPhysicalMaterial({
    name: 'playerBall',
    map: texture,
    emissiveMap: texture,
    emissive: 0xffffff,
    emissiveIntensity: GLOW.idle,
    roughness: 0.35,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.1,
    envMapIntensity: 0.25, // the studio map's bright floor would otherwise whiten the lower half
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 20), material);
  ball.name = 'playerBall'; // badges face +z (the camera) and -z

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 3.4, radius * 3.4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false }),
  );
  shadow.position.y = 0.02;
  shadow.renderOrder = 1;

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: glowColor(player.color, 0.9), // bright, but under the bloom: no white halo
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 1.12, radius * 1.3, 48).rotateX(-Math.PI / 2), ringMaterial);
  ring.position.y = 0.04;
  ring.renderOrder = 2;

  const base = new THREE.Group();
  base.name = 'ballBase';
  base.add(shadow, ring);

  return {
    ball,
    base,
    material,
    // 0 = idle, 1 = full boost/dash glow
    setGlow(level) {
      material.emissiveIntensity = THREE.MathUtils.lerp(GLOW.idle, GLOW.boost, level);
    },
    // a player who rejoined under another name
    rename(name) {
      const old = material.map;
      material.map = material.emissiveMap = ballTexture(player.color, initial(name));
      old.dispose();
    },
  };
}

const initial = (name) => [...name.trim()][0]?.toUpperCase() ?? '?';

// Equirectangular: 512 × 256 maps 360° × 180°, so a circle drawn on the equator stays round.
// Two badges (front and back) so the initial is visible from most angles.
function ballTexture(color, letter) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(color);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 256);
  // slightly darker towards the poles: reads as a sphere even where lighting is flat
  const shade = ctx.createLinearGradient(0, 0, 0, 256);
  shade.addColorStop(0, 'rgba(0, 0, 0, 0.28)');
  shade.addColorStop(0.3, 'rgba(0, 0, 0, 0)');
  shade.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.28)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 512, 256);

  const ink = `#${base.clone().multiplyScalar(0.25).getHexString()}`;
  for (const x of [128, 384]) {
    ctx.beginPath();
    ctx.arc(x, 128, 52, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = '400 60px Bungee, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, x, 132);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// Soft round contact shadow: grounds the ball without a shadow map.
function shadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.55)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
