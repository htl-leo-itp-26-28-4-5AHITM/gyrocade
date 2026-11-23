import * as THREE from 'three';
import { createNameTag, disposeTree } from '../util.js';
import { createBall } from './ball.js';
import { createSpaceVista, createSparks, createWaves } from './effects.js';
import { BLOOM_THRESHOLD, glowCard, neon, panelFloorTexture, SIGNAL, slab, trimMetal } from './kit.js';

// Pre-lobby toy while players join: every phone rolls a ball around a neon arena.
// "Bumper chaos": hard hits launch balls apart with sparks, shockwaves and screen shake.
// The arena floats like a game board in calm space (drifting nebula, twinkling stars),
// which is drawn first from its own camera (see `background`).

const ARENA = { width: 32, depth: 18 };
const BALL_RADIUS = 0.8;
const ACCELERATION = 45; // units/s² at full tilt
const DAMPING = 2.2; // velocity decay per second
const WALL_BOUNCE = 0.6;
const CAMERA_DIRECTION = new THREE.Vector3(0, 1, 0.45).normalize();
const VIEW_STRETCH = 1.35; // render the top part of a taller image, so the arena sits low and the sky shows
const CHAOS = {
  minSpeed: 4, // closing speed needed for a "hard" hit
  boost: 1.8, // extra bounce on hard hits (1 = normal elastic bounce)
  kick: 7, // extra push apart on hard hits
  sparksPerSpeed: 3,
  shakePerSpeed: 0.05,
};
const DROP_HEIGHT = 16;
const GRAVITY = 70;

export function createArena({ environment }) {
  // --- Arena (the game board) ----------------------------------------------------
  const scene = new THREE.Scene(); // no background: space shows through
  scene.environment = environment;
  scene.environmentIntensity = 0.7;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
  scene.add(new THREE.HemisphereLight(0xb9a8ff, 0x1a0b33, 0.4));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(-6, 20, 12);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xff2bd6, 0.9); // magenta from behind separates balls from the floor
  rim.position.set(4, 6, -14);
  scene.add(rim);
  buildArena(scene);

  const sparks = createSparks(BALL_RADIUS);
  scene.add(sparks.points);
  const waves = createWaves(scene);

  // --- Space (background) -----------------------------------------------------------
  const vista = createSpaceVista();

  const balls = new Map(); // id -> { player, velocity, mesh, ball, parts, drop }
  let shake = 0;
  let time = 0;
  const cameraBase = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const spin = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  function addPlayer(player) {
    if (balls.has(player.id)) return;
    const parts = createBall(player, BALL_RADIUS);
    const { ball } = parts;
    const mesh = new THREE.Group();
    // the ball drops in, the shadow and ring wait on the floor; the label rides on a holder
    // that follows the ball's height but not its spin
    const holder = new THREE.Group();
    holder.position.y = BALL_RADIUS + DROP_HEIGHT;
    holder.add(ball);
    const label = createNameTag(player);
    label.position.set(0, BALL_RADIUS * 2, -BALL_RADIUS * 1.8); // above the ball as seen from the camera
    holder.add(label);

    mesh.add(holder, parts.base);
    const angle = player.id * 2.39996; // golden angle spreads spawns out
    mesh.position.set(Math.cos(angle) * 5, 0, Math.sin(angle) * 3);
    scene.add(mesh);

    // Falls in from above and lands with a bang.
    balls.set(player.id, { player, velocity: new THREE.Vector2(), mesh, ball: holder, sphere: ball, parts, drop: { velocity: 0, bounces: 0 } });
  }

  function renamePlayer(id, name) {
    balls.get(id)?.parts.rename(name);
  }

  function removePlayer(id) {
    const b = balls.get(id);
    if (!b) return;
    burst(b.mesh.position, b.player.color, 40, 10);
    scene.remove(b.mesh);
    disposeTree(b.mesh);
    balls.delete(id);
  }

  function update(dt) {
    time += dt;
    const limitX = ARENA.width / 2 - BALL_RADIUS;
    const limitZ = ARENA.depth / 2 - BALL_RADIUS;

    for (const b of balls.values()) {
      const { tilt } = b.player;
      b.velocity.x += tilt.x * ACCELERATION * dt;
      b.velocity.y += -tilt.y * ACCELERATION * dt; // forward tilt = up on screen = -z
      b.velocity.multiplyScalar(Math.exp(-DAMPING * dt));

      const pos = b.mesh.position;
      pos.x += b.velocity.x * dt;
      pos.z += b.velocity.y * dt;

      if (Math.abs(pos.x) > limitX) {
        wallHit(b, Math.abs(b.velocity.x));
        pos.x = Math.sign(pos.x) * limitX;
        b.velocity.x *= -WALL_BOUNCE;
      }
      if (Math.abs(pos.z) > limitZ) {
        wallHit(b, Math.abs(b.velocity.y));
        pos.z = Math.sign(pos.z) * limitZ;
        b.velocity.y *= -WALL_BOUNCE;
      }
      updateDrop(b, dt);

      // roll: the badge with the initial turns with the movement
      const speed = b.velocity.length();
      if (speed > 0.01) {
        axis.set(b.velocity.y, 0, -b.velocity.x).divideScalar(speed);
        spin.setFromAxisAngle(axis, (speed * dt) / BALL_RADIUS);
        b.sphere.quaternion.premultiply(spin);
      }
    }

    collideBalls();
    sparks.update(dt);
    waves.update(dt);
    vista.update(dt, time);

    // screen shake: jitter around the fitted camera position, decaying quickly
    shake = Math.max(0, shake - dt * 2.5);
    const amount = shake * shake * 1.2;
    camera.position.copy(cameraBase).add(new THREE.Vector3(rand(amount), rand(amount), rand(amount)));
  }

  function updateDrop(b, dt) {
    if (!b.drop) return;
    b.drop.velocity -= GRAVITY * dt;
    b.ball.position.y += b.drop.velocity * dt;
    if (b.ball.position.y > BALL_RADIUS) return;
    b.ball.position.y = BALL_RADIUS;
    if (b.drop.bounces === 0) {
      // first touchdown: shockwave, sparks and a jolt
      wave(b.mesh.position, b.player.color, 5, 0.7);
      burst(b.mesh.position, b.player.color, 60, 14);
      shake = Math.min(1, shake + 0.6);
    }
    b.drop.bounces++;
    b.drop.velocity = -b.drop.velocity * 0.35;
    if (b.drop.bounces >= 3 || b.drop.velocity < 2) b.drop = null;
  }

  function wallHit(b, speed) {
    if (speed < 8) return;
    burst(b.mesh.position, b.player.color, Math.round(speed), speed * 0.6);
    shake = Math.min(1, shake + speed * 0.015);
  }

  // Elastic bounce between balls, amplified on hard hits.
  function collideBalls() {
    const list = [...balls.values()];
    const minDistance = BALL_RADIUS * 2;
    const contact = new THREE.Vector3();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.mesh.position.x - a.mesh.position.x;
        const dz = b.mesh.position.z - a.mesh.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance >= minDistance || distance === 0) continue;

        const nx = dx / distance;
        const nz = dz / distance;
        const push = (minDistance - distance) / 2;
        a.mesh.position.x -= nx * push;
        a.mesh.position.z -= nz * push;
        b.mesh.position.x += nx * push;
        b.mesh.position.z += nz * push;

        const relative = (a.velocity.x - b.velocity.x) * nx + (a.velocity.y - b.velocity.y) * nz;
        if (relative <= 0) continue;
        const hard = relative > CHAOS.minSpeed;
        const impulse = relative * (hard ? CHAOS.boost : 1) + (hard ? CHAOS.kick : 0);
        a.velocity.x -= impulse * nx;
        a.velocity.y -= impulse * nz;
        b.velocity.x += impulse * nx;
        b.velocity.y += impulse * nz;

        if (hard) {
          contact.copy(a.mesh.position).lerp(b.mesh.position, 0.5);
          const count = Math.round(relative * CHAOS.sparksPerSpeed);
          burst(contact, a.player.color, count, relative);
          burst(contact, b.player.color, count, relative);
          wave(contact, '#ffffff', 2 + relative * 0.15, 0.35);
          shake = Math.min(1, shake + relative * CHAOS.shakePerSpeed);
        }
      }
    }
  }

  function burst(position, color, count, speed) {
    sparks.emit(position, new THREE.Color(color), count, speed);
  }

  function wave(position, color, maxScale, duration) {
    waves.spawn(position, color, maxScale, duration);
  }

  // Fits the arena into the lower part of the screen for any aspect ratio.
  function resize(width, height) {
    const fullHeight = height * VIEW_STRETCH;
    camera.aspect = width / fullHeight;
    camera.setViewOffset(width, fullHeight, 0, 0, width, height);
    const corners = [];
    for (const x of [-1, 1]) for (const z of [-1, 1]) corners.push(new THREE.Vector3((x * ARENA.width) / 2, 0, (z * ARENA.depth) / 2));
    corners.push(new THREE.Vector3(0, BALL_RADIUS * 4, -ARENA.depth / 2)); // room for name tags at the far wall
    const fits = (distance) => {
      camera.position.copy(CAMERA_DIRECTION).multiplyScalar(distance);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      return corners.every((c) => {
        const p = c.clone().project(camera);
        return Math.abs(p.x) <= 0.9 && p.y <= 0.55 && p.y >= -0.92;
      });
    };
    let near = 5;
    let far = 200;
    for (let i = 0; i < 24; i++) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
    fits(far);
    cameraBase.copy(camera.position);

    vista.resize(width, height);
  }

  return {
    kind: 'arena',
    scene,
    camera,
    background: { scene: vista.scene, camera: vista.camera },
    bloom: { strength: 0.65, radius: 0.3, threshold: BLOOM_THRESHOLD },
    exposure: 1,
    addPlayer,
    removePlayer,
    renamePlayer,
    update,
    resize,
    dispose() {
      disposeTree(scene);
      disposeTree(vista.scene);
    },
  };
}

const rand = (amount) => (Math.random() * 2 - 1) * amount;

// A floating game board: panel floor with the gyro emblem, a thick slab underneath, a metal
// rail with a neon strip along its inner edge, and corner posts. Balls bounce off the rail's
// inner face (the ARENA size), so all of it sits just outside the play area.
const RAIL = { width: 0.7, height: 0.55 };

function buildArena(scene) {
  const halfW = ARENA.width / 2;
  const halfD = ARENA.depth / 2;
  const outerW = ARENA.width + RAIL.width * 2;
  const outerD = ARENA.depth + RAIL.width * 2;

  const floorTexture = panelFloorTexture({ width: ARENA.width, depth: ARENA.depth });
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA.width, ARENA.depth).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0x8a86ad, // darkens the panels; the seams and the emblem still glow
      map: floorTexture,
      emissiveMap: floorTexture,
      emissive: 0xffffff,
      emissiveIntensity: 1,
      roughness: 0.5,
      metalness: 0.1,
      envMapIntensity: 0.35,
    }),
  );
  floor.name = 'arenaFloor';

  const body = new THREE.Mesh(new THREE.BoxGeometry(outerW, 1.4, outerD).translate(0, -0.72, 0), slab());
  body.name = 'arenaSlab';
  scene.add(floor, body);

  const metal = trimMetal();
  const long = neon(SIGNAL.cyan);
  const short = long; // magenta only on the corner lights: it blooms much wider than cyan
  // [length, along x?, offset from centre, strip material]
  const sides = [
    [outerW, true, halfD, long],
    [outerW, true, -halfD, long],
    [ARENA.depth, false, halfW, short],
    [ARENA.depth, false, -halfW, short],
  ];
  for (const [length, alongX, offset, stripMaterial] of sides) {
    const sign = Math.sign(offset);
    const rail = new THREE.Mesh(
      alongX ? new THREE.BoxGeometry(length, RAIL.height, RAIL.width) : new THREE.BoxGeometry(RAIL.width, RAIL.height, length),
      metal,
    );
    const out = offset + sign * (RAIL.width / 2);
    rail.position.set(alongX ? 0 : out, RAIL.height / 2, alongX ? out : 0);
    const strip = new THREE.Mesh(
      alongX ? new THREE.BoxGeometry(length - RAIL.width * 2, 0.09, 0.09) : new THREE.BoxGeometry(0.09, 0.09, length),
      stripMaterial,
    );
    const inner = offset + sign * 0.045;
    strip.position.set(alongX ? 0 : inner, RAIL.height, alongX ? inner : 0);
    scene.add(rail, strip);
  }

  const cap = neon(SIGNAL.magenta);
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 1.2), metal);
      post.position.set(x * (halfW + RAIL.width / 2), 0.5, z * (halfD + RAIL.width / 2));
      const light = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.14, 1.26), cap);
      light.position.set(post.position.x, 1, post.position.z);
      scene.add(post, light);
    }
  }

  // light spilling out under the board, so it floats instead of sitting on the nebula
  const spill = glowCard(outerW * 1.6, outerD * 2, SIGNAL.purple, 0.45);
  spill.position.y = -1.8;
  scene.add(spill);
}
