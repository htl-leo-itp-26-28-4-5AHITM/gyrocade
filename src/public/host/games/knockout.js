import * as THREE from 'three';
import { t } from '/shared/i18n.js';
import { DASH_COOLDOWN_SECONDS } from '/shared/protocol.js';
import { createNameTag, disposeTree } from '../util.js';
import { createBall } from './ball.js';
import { createAbyss, createSparks, createWaves } from './effects.js';
import { BLOOM_THRESHOLD, emblemTexture, glowColor, hazardTexture, neon, NEON_LUMINANCE, panelTileTexture, trimMetal } from './kit.js';
import { createKnockoutHud } from './knockout-hud.js';

// Knockout Arena: push the others off a floating platform that shrinks over time.
// 4 rounds on platforms of changing shape (square, hexagon, two islands). +1 point for every player you knock off
// (whoever touched them last), +2 for the last one standing. A tie for first place after
// round 4 is decided by sudden-death rounds between the tied players (if the last of them
// keep falling off together, only those go again, and after a few draws they share the win).
// Tilt to roll, tap DASH on the phone for a short, heavy burst of speed.

const ROUNDS = 4;
const SHAPE_NAMES = ['square', 'hexagon', 'islands']; // see SHAPES
const KO_POINTS = 1;
const SURVIVOR_POINTS = 2;
const MAX_SUDDEN_DEATHS = 3; // still no single survivor after this many: the tied players share the win

const BALL_RADIUS = 0.8;
const ACCELERATION = 34; // units/s² at full tilt
const DAMPING = 1.3; // velocity decay per second
const MAX_SPEED = 40;
const HIT = { minSpeed: 4, boost: 1.5, kick: 5 }; // hard hits launch balls apart (like the lobby)
const DASH = {
  speed: 22, // added in the tilt direction
  seconds: 0.35, // heavy while dashing: wins every collision
  mass: 3,
  cooldown: DASH_COOLDOWN_SECONDS * 0.9, // a bit shorter than the phone's, so network jitter never eats a press
};
const GRAVITY = 40;
const FALL_DEPTH = 80; // fallen balls sink into the glowing pit and are hidden below this
const DROP_HEIGHT = 12; // balls drop onto the platform at the start of a round

const INTRO_SECONDS = 4.5; // round title, then 3-2-1
const ROUND_END_SECONDS = 2; // after the last knockout, before the scores
const SCORES_SECONDS = 5;
// Platform size over the round (seconds since FIGHT): full size, shrink, hold, collapse.
const SHRINK = { start: 6, minAt: 36, min: 0.4, collapseAt: 50, goneAt: 62 };

const CAMERA_DIRECTION = new THREE.Vector3(0, 1, 0.8).normalize();
const SLAB_DEPTH = 1.2;

export function createKnockout({ stage, environment }) {
  const scene = new THREE.Scene(); // no background: the abyss shows through
  scene.environment = environment;
  scene.environmentIntensity = 0.7;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500); // far enough for the whole abyss dome
  scene.add(new THREE.HemisphereLight(0xb9a8ff, 0x2a0b3a, 0.45));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(-6, 20, 12);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xff2bd6, 0.8); // separates the balls from the floor
  rim.position.set(4, 6, -14);
  scene.add(rim);

  const abyss = createAbyss(); // drawn with this game's camera, so the pit lies under the platform
  const sparks = createSparks(BALL_RADIUS);
  scene.add(sparks.points);
  const waves = createWaves(scene);
  const hud = createKnockoutHud(stage);

  const balls = new Map(); // id -> ball (one per player, kept across rounds with the points)
  const shapes = shapeOrder();
  const cameraBase = new THREE.Vector3();
  const edgeColor = new THREE.Color();
  const viewport = { width: 1, height: 1 };
  const axis = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const spin = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  let platform = null; // { group, shape, edgeMaterial, color }
  let phase = 'start'; // 'start' | 'intro' | 'fight' | 'roundEnd' | 'scores' | 'over'
  let phaseTime = 0;
  let time = 0;
  let round = 0; // 0-based index of the regular round, ROUNDS while in sudden death
  let suddenDeath = null; // ids of the tied players while sudden death runs
  let suddenDeaths = 0;
  let survivor = null; // last one standing of the round that just ended
  let lastFallen = []; // balls that fell in the frame that ended the round (all went down together)
  let scale = 1;
  let lastCount = null;
  let shrinkAnnounced = false;
  let collapseAnnounced = false;
  let shake = 0;

  // --- Players ------------------------------------------------------------------

  function addPlayer(player) {
    if (balls.has(player.id)) return;
    const parts = createBall(player, BALL_RADIUS);
    const { ball } = parts;
    const ring = parts.base; // shadow + neon ring, kept on the platform
    const tag = createNameTag(player);
    tag.position.y = BALL_RADIUS + 1.1;

    const group = new THREE.Group();
    group.add(ball, ring, tag);
    group.visible = false; // joins in the next round
    scene.add(group);

    balls.set(player.id, {
      player,
      group,
      ball,
      ring,
      tag,
      parts,
      rank: tag.element.querySelector('.rank'),
      points: 0,
      gain: 0, // points earned this round
      inRound: false,
      alive: false,
      x: 0,
      z: 0,
      y: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      dashTime: 0,
      cooldown: 0,
      lastHitBy: null,
    });
  }

  function removePlayer(id) {
    const b = balls.get(id);
    if (!b) return;
    if (b.alive) burst(b, 40, 10);
    scene.remove(b.group);
    disposeTree(b.group);
    balls.delete(id);
  }

  function renamePlayer(id, name) {
    balls.get(id)?.parts.rename(name);
  }

  function dash(id) {
    const b = balls.get(id);
    if (!b || !b.alive || phase !== 'fight' || b.cooldown > 0) return;
    // in the tilt direction, or straight on when the phone is held level
    let dx = b.player.tilt.x;
    let dz = -b.player.tilt.y;
    let length = Math.hypot(dx, dz);
    if (length < 0.2) {
      dx = b.vx;
      dz = b.vz;
      length = Math.hypot(dx, dz);
      if (length < 0.5) return;
    }
    b.vx += (dx / length) * DASH.speed;
    b.vz += (dz / length) * DASH.speed;
    b.dashTime = DASH.seconds;
    b.cooldown = DASH.cooldown;
    burst(b, 24, 6);
    waves.spawn(b.group.position, b.player.color, 2.5, 0.3);
  }

  // --- Rounds -------------------------------------------------------------------

  function startRound() {
    const participants = [...balls.values()].filter((b) => !suddenDeath || suddenDeath.includes(b.player.id));
    if (participants.length < 2) return finish(participants[0] ?? null);

    setPlatform(suddenDeath ? 'square' : shapes[round]);
    const spawns = platform.shape.spawn(participants.length);
    for (const b of balls.values()) {
      b.gain = 0;
      b.inRound = participants.includes(b);
      b.alive = b.inRound;
      b.group.visible = b.inRound;
      b.lastHitBy = null;
      b.dashTime = 0;
      b.cooldown = 0;
      b.vx = b.vz = b.vy = 0;
    }
    shuffle(participants).forEach((b, i) => {
      [b.x, b.z] = spawns[i];
      b.y = DROP_HEIGHT + Math.random() * 3;
    });

    scale = 1;
    phase = 'intro';
    phaseTime = 0;
    lastCount = null;
    shrinkAnnounced = collapseAnnounced = false;
    hud.hideResults();
    if (suddenDeath) {
      hud.setRound('ko.suddenDeath');
      const names = participants.map((b) => b.player.name).join(' vs ');
      hud.announce(t('ko.tie', { names }), { className: 'small' });
    } else {
      hud.setRound('ko.round', { n: round + 1, total: ROUNDS });
      hud.announce(t('ko.round', { n: round + 1, total: ROUNDS }), { className: 'small' });
    }
  }

  // The last one standing gets the bonus (in sudden death: wins the game).
  function endRound() {
    phase = 'roundEnd';
    phaseTime = 0;
    survivor = [...balls.values()].find((b) => b.alive) ?? null;
    for (const b of balls.values()) {
      // the round is decided: everyone rolls to a stop
      b.vx *= 0.3;
      b.vz *= 0.3;
    }
    if (!survivor) {
      hud.announce(t('ko.noSurvivor'), { className: 'small' });
    } else if (suddenDeath) {
      hud.announce(t('ko.winner', { name: survivor.player.name }), { className: 'small', color: survivor.player.color });
    } else {
      award(survivor, SURVIVOR_POINTS);
      hud.announce(t('ko.survivor', { name: survivor.player.name, points: SURVIVOR_POINTS }), {
        className: 'small',
        color: survivor.player.color,
      });
    }
  }

  function showScores() {
    phase = 'scores';
    phaseTime = 0;
    hud.showResults('ko.roundResults', { n: round + 1 }, ranking(), false);
  }

  function nextRound() {
    if (suddenDeath) {
      // a survivor wins; if nobody survived, the ones who fell last go again
      if (survivor && balls.has(survivor.player.id)) return finish(survivor);
      const again = lastFallen.filter((b) => balls.has(b.player.id));
      if (again.length < 2 || suddenDeaths >= MAX_SUDDEN_DEATHS) return finish(again.length === 1 ? again[0] : null, again);
      suddenDeath = again.map((b) => b.player.id);
      suddenDeaths++;
      return startRound();
    }
    round++;
    if (round < ROUNDS) return startRound();

    const list = [...balls.values()];
    const best = Math.max(...list.map((b) => b.points));
    const leaders = list.filter((b) => b.points === best);
    if (leaders.length === 1) return finish(leaders[0]);
    suddenDeath = leaders.map((b) => b.player.id);
    suddenDeaths = 1;
    startRound();
  }

  // winner: a ball or null; shared: balls that share the win instead
  function finish(winner, shared = []) {
    phase = 'over';
    phaseTime = 0;
    for (const b of balls.values()) b.gain = 0;
    const order = ranking();
    if (winner) {
      order.splice(order.indexOf(winner), 1);
      order.unshift(winner);
    } else if (shared.length > 1) {
      for (const b of [...shared].reverse()) {
        order.splice(order.indexOf(b), 1);
        order.unshift(b);
      }
    }
    hud.setRound('ko.finalResults');
    // the winner is the title of the results table (an announcement would be hidden behind it)
    if (winner) hud.showResults('ko.winner', { name: winner.player.name }, order, true);
    else if (shared.length > 1) hud.showResults('ko.sharedWin', { names: shared.map((b) => b.player.name).join(' & ') }, order, true);
    else hud.showResults('ko.finalResults', {}, order, true);
  }

  function award(b, points) {
    b.points += points;
    b.gain += points;
  }

  const ranking = () => [...balls.values()].sort((a, b) => b.points - a.points);

  // --- Simulation ---------------------------------------------------------------

  function update(dt) {
    time += dt;
    phaseTime += dt;

    // the host adds the players after creating the game, so the first round starts here
    if (phase === 'start') startRound();

    if (phase === 'intro') {
      const count = Math.ceil(INTRO_SECONDS - phaseTime);
      if (count <= 3 && count > 0 && count !== lastCount) {
        lastCount = count;
        hud.announce(String(count), { className: 'count' });
      }
      if (phaseTime >= INTRO_SECONDS) {
        phase = 'fight';
        phaseTime = 0;
        hud.announce(t('ko.fight'), { className: 'go' });
      }
    } else if (phase === 'fight') {
      updateShrink();
    } else if (phase === 'roundEnd' && phaseTime >= ROUND_END_SECONDS) {
      if (suddenDeath) nextRound(); // no scores table in sudden death
      else showScores();
    } else if (phase === 'scores' && phaseTime >= SCORES_SECONDS) {
      nextRound();
    }

    for (const b of balls.values()) simulate(b, dt);
    if (phase === 'fight' || phase === 'roundEnd') {
      collideBalls();
      checkFalls();
    }

    for (const b of balls.values()) render(b, dt);
    if (platform) renderPlatform();
    sparks.update(dt);
    waves.update(dt);
    abyss.update(dt, time);
    updateHud();

    // screen shake: jitter around the fitted camera position, decaying quickly
    shake = Math.max(0, shake - dt * 2.5);
    const amount = shake * shake * 1.2;
    camera.position.copy(cameraBase).add(new THREE.Vector3(rand(amount), rand(amount), rand(amount)));
  }

  function updateShrink() {
    const s = phaseTime;
    if (s < SHRINK.start) scale = 1;
    else if (s < SHRINK.minAt) scale = THREE.MathUtils.lerp(1, SHRINK.min, (s - SHRINK.start) / (SHRINK.minAt - SHRINK.start));
    else if (s < SHRINK.collapseAt) scale = SHRINK.min;
    else scale = Math.max(0, SHRINK.min * (1 - (s - SHRINK.collapseAt) / (SHRINK.goneAt - SHRINK.collapseAt)));

    if (s >= SHRINK.start && !shrinkAnnounced) {
      shrinkAnnounced = true;
      hud.announce(t('ko.shrinking'), { className: 'small', color: '#ff3355' });
    }
    if (s >= SHRINK.collapseAt && !collapseAnnounced) {
      collapseAnnounced = true;
      hud.announce(t('ko.collapse'), { className: 'small', color: '#ff3355' });
    }
  }

  function simulate(b, dt) {
    if (!b.inRound) return;
    b.dashTime = Math.max(0, b.dashTime - dt);
    b.cooldown = Math.max(0, b.cooldown - dt);

    if (!b.alive) {
      // off the edge: keeps drifting outwards and drops into the void
      b.vy -= GRAVITY * dt;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.y += b.vy * dt;
      if (b.y < -FALL_DEPTH) b.group.visible = false;
      return;
    }

    if (b.y > 0 || b.vy > 0) {
      // dropping onto the platform at the start of a round, with a small bounce
      b.vy -= GRAVITY * 1.6 * dt;
      b.y += b.vy * dt;
      if (b.y <= 0) {
        b.y = 0;
        if (b.vy < -8) {
          waves.spawn(b.group.position, b.player.color, 4, 0.6);
          burst(b, 40, 10);
          shake = Math.min(1, shake + 0.25);
        }
        b.vy = b.vy < -6 ? -b.vy * 0.3 : 0;
      }
    }

    const steering = phase === 'fight' && b.player.connected !== false;
    if (steering) {
      b.vx += b.player.tilt.x * ACCELERATION * dt;
      b.vz += -b.player.tilt.y * ACCELERATION * dt; // forward tilt = up on screen = -z
    }
    const damping = phase === 'fight' ? DAMPING : DAMPING * 2; // coast to a stop between rounds
    b.vx *= Math.exp(-damping * dt);
    b.vz *= Math.exp(-damping * dt);
    const speed = Math.hypot(b.vx, b.vz);
    if (speed > MAX_SPEED) {
      b.vx *= MAX_SPEED / speed;
      b.vz *= MAX_SPEED / speed;
    }
    b.x += b.vx * dt;
    b.z += b.vz * dt;
  }

  // Elastic bounce between balls, amplified on hard hits. A dashing ball is heavier, so it
  // barely slows down while the other one flies. Every touch marks who hit whom last.
  function collideBalls() {
    const list = [...balls.values()].filter((b) => b.alive && b.y < BALL_RADIUS);
    const minDistance = BALL_RADIUS * 2;
    const contact = new THREE.Vector3();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const distance = Math.hypot(dx, dz);
        if (distance >= minDistance || distance === 0) continue;

        const nx = dx / distance;
        const nz = dz / distance;
        const push = (minDistance - distance) / 2;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;

        const relative = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (relative <= 0) continue;
        a.lastHitBy = b.player.id;
        b.lastHitBy = a.player.id;

        const massA = a.dashTime > 0 ? DASH.mass : 1;
        const massB = b.dashTime > 0 ? DASH.mass : 1;
        const hard = relative > HIT.minSpeed;
        const impulse = ((2 * relative) / (1 / massA + 1 / massB)) * (hard ? HIT.boost : 1) + (hard ? HIT.kick : 0);
        a.vx -= (impulse / massA) * nx;
        a.vz -= (impulse / massA) * nz;
        b.vx += (impulse / massB) * nx;
        b.vz += (impulse / massB) * nz;

        if (hard) {
          contact.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
          const count = Math.round(relative * 3);
          sparks.emit(contact, new THREE.Color(a.player.color), count, relative);
          sparks.emit(contact, new THREE.Color(b.player.color), count, relative);
          waves.spawn(contact, '#ffffff', 2 + relative * 0.15, 0.35);
          shake = Math.min(1, shake + relative * 0.05);
        }
      }
    }
  }

  // A ball whose centre leaves the platform is out. Whoever touched it last gets the point.
  // After the round is decided, balls can still roll off, but that no longer counts.
  function checkFalls() {
    const fallen = [];
    for (const b of balls.values()) {
      if (!b.alive || b.y > 0 || (scale > 0 && platform.shape.inside(b.x / scale, b.z / scale))) continue;
      b.alive = false;
      b.vy = 0;
      fallen.push(b);
      burst(b, 60, 14);
      shake = Math.min(1, shake + 0.5);
      if (phase !== 'fight') continue;
      const attacker = b.lastHitBy !== null ? balls.get(b.lastHitBy) : null;
      if (attacker && attacker !== b) {
        if (!suddenDeath) award(attacker, KO_POINTS);
        hud.log(t('ko.knockedOff', { attacker: attacker.player.name, victim: b.player.name }), attacker.player.color);
      } else {
        hud.log(t('ko.fell', { name: b.player.name }), b.player.color);
      }
    }
    if (phase === 'fight' && [...balls.values()].filter((b) => b.alive).length <= 1) {
      lastFallen = fallen;
      endRound();
    }
  }

  function burst(b, count, speed) {
    sparks.emit(b.group.position, new THREE.Color(b.player.color), count, speed);
  }

  // --- Rendering ----------------------------------------------------------------

  function render(b, dt) {
    if (!b.inRound) return;
    b.group.position.set(b.x, b.y + BALL_RADIUS, b.z);
    // the shadow ring stays on the platform while the ball drops in, and goes when it falls off
    b.ring.position.y = -b.y - BALL_RADIUS;
    b.ring.visible = b.alive;
    b.tag.visible = b.y > -4;

    velocity.set(b.vx, 0, b.vz);
    const speed = velocity.length();
    if (speed > 0.01) {
      axis.crossVectors(UP, velocity).normalize();
      spin.setFromAxisAngle(axis, (speed * dt) / BALL_RADIUS);
      b.ball.quaternion.premultiply(spin);
    }
    b.parts.setGlow(b.dashTime > 0 ? 1 : 0);
  }

  function setPlatform(kind) {
    if (platform) {
      scene.remove(platform.group);
      disposeTree(platform.group);
    }
    platform = buildPlatform(SHAPES[kind]);
    scene.add(platform.group);
    fitCamera();
  }

  // Shrinks with the round; the edge flashes red while it does.
  function renderPlatform() {
    platform.group.scale.set(Math.max(scale, 0.0001), 1, Math.max(scale, 0.0001));
    platform.group.visible = scale > 0;
    const shrinking = phase === 'fight' && phaseTime >= SHRINK.start && (phaseTime < SHRINK.minAt || phaseTime >= SHRINK.collapseAt);
    const pulse = shrinking ? 0.5 + 0.5 * Math.sin(time * 10) : 0;
    edgeColor.copy(platform.color).lerp(DANGER, pulse);
    platform.edgeMaterial.color.copy(glowColor(edgeColor, NEON_LUMINANCE));
    platform.hazardMaterial.emissiveIntensity = 0.35 + pulse * 0.9;
  }

  function updateHud() {
    const order = ranking();
    hud.setScores(order.map((b) => ({ player: b.player, points: b.points, out: !b.alive && phase !== 'over' })));
    order.forEach((b, i) => {
      const text = String(i + 1);
      if (b.rank.textContent !== text) b.rank.textContent = text;
    });
  }

  function resize(width, height) {
    viewport.width = width;
    viewport.height = height;
    fitCamera();
  }

  // Moves the camera as close as possible while the whole platform (at full size) stays on screen.
  function fitCamera() {
    if (!platform) return;
    camera.aspect = viewport.width / viewport.height;
    const corners = platform.outline.map(([x, z]) => new THREE.Vector3(x, 0, z));
    // room for name tags above balls at the far edge
    const farZ = Math.min(...platform.outline.map(([, z]) => z));
    corners.push(new THREE.Vector3(0, BALL_RADIUS * 4, farZ));
    const fits = (distance) => {
      camera.position.copy(CAMERA_DIRECTION).multiplyScalar(distance);
      camera.lookAt(0, -2, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      return corners.every((c) => {
        const p = c.clone().project(camera);
        return Math.abs(p.x) <= 0.8 && p.y <= 0.62 && p.y >= -0.88; // keep clear of the HUD corners
      });
    };
    let near = 5;
    let far = 300;
    for (let i = 0; i < 24; i++) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
    fits(far);
    cameraBase.copy(camera.position);
  }

  return {
    kind: 'knockout',
    scene,
    camera,
    background: { scene: abyss.scene, camera },
    bloom: { strength: 0.65, radius: 0.3, threshold: BLOOM_THRESHOLD },
    get over() {
      return phase === 'over';
    },
    addPlayer,
    removePlayer,
    renamePlayer,
    dash,
    update,
    resize,
    dispose() {
      disposeTree(scene);
      disposeTree(abyss.scene);
      hud.dispose();
    },
  };
}

// --- Platform shapes ---------------------------------------------------------------
// Sizes at full scale. inside(x, z) gets coordinates already divided by the current scale.

const DANGER = new THREE.Color('#ff3355');

const SHAPES = {
  square: {
    color: '#39ff14',
    build: () => polygon([[-16, -16], [16, -16], [16, 16], [-16, 16]]),
    inside: (x, z) => Math.abs(x) <= 16 && Math.abs(z) <= 16,
    spawn: (n) => around(n, 11),
    emblems: [[0, 0, 9]], // [x, z, radius]
    pods: [[-9, -9], [9, -9], [-9, 9], [9, 9]],
  },
  hexagon: {
    color: '#00f0ff',
    // corners pointing left and right, 18 from the centre
    build: () => polygon(Array.from({ length: 6 }, (_, i) => [18 * Math.cos((i * Math.PI) / 3), 18 * Math.sin((i * Math.PI) / 3)])),
    inside: (x, z) => Math.abs(z) <= 9 * Math.sqrt(3) && Math.sqrt(3) * Math.abs(x) + Math.abs(z) <= 18 * Math.sqrt(3),
    spawn: (n) => around(n, 11),
    emblems: [[0, 0, 10]],
    pods: [[-9, -7], [9, -7], [-9, 7], [9, 7]],
  },
  islands: {
    color: '#ff2bd6',
    // two 12×12 islands joined by a 4 wide bridge
    build: () =>
      polygon([
        [-19, -6], [-7, -6], [-7, -2], [7, -2], [7, -6], [19, -6],
        [19, 6], [7, 6], [7, 2], [-7, 2], [-7, 6], [-19, 6],
      ]),
    inside: (x, z) => (Math.abs(x) >= 7 && Math.abs(x) <= 19 && Math.abs(z) <= 6) || (Math.abs(x) <= 7 && Math.abs(z) <= 2),
    // half the players on each island
    spawn: (n) => {
      const left = Math.ceil(n / 2);
      const onIsland = (count, cx) => (count === 1 ? [[cx, 0]] : around(count, 3.5).map(([x, z]) => [cx + x, z]));
      return [...onIsland(left, -13), ...(n > left ? onIsland(n - left, 13) : [])];
    },
    emblems: [[-13, 0, 4.6], [13, 0, 4.6]],
    pods: [[-13, 0], [13, 0]],
  },
};

function polygon(points) {
  const shape = new THREE.Shape();
  shape.moveTo(...points[0]);
  for (const p of points.slice(1)) shape.lineTo(...p);
  shape.lineTo(...points[0]);
  return shape;
}

// n points evenly around a circle, starting on the left.
function around(n, radius) {
  return Array.from({ length: n }, (_, i) => {
    const angle = Math.PI + (i / n) * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

// The platform: an extruded slab with beveled floor panels in the shape's color, warning
// stripes along its sides (the edge is what kills you; they flash while it shrinks), a neon
// tube along the top edge and a dim one along the bottom, the gyro emblem on the floor and
// hover pods underneath that hold it above the abyss.
function buildPlatform(def) {
  const outline = def.build();
  const color = new THREE.Color(def.color);
  const geometry = new THREE.ExtrudeGeometry(outline, { depth: SLAB_DEPTH, bevelEnabled: false, curveSegments: 64 });
  geometry.rotateX(-Math.PI / 2); // shape y -> -z, extruded upwards
  geometry.translate(0, -SLAB_DEPTH, 0); // top face at y = 0

  // cap and side UVs are in world units
  const tiles = panelTileTexture(`#${color.clone().multiplyScalar(0.3).getHexString()}`);
  tiles.repeat.set(0.5, 0.5);
  const top = new THREE.MeshStandardMaterial({
    color: 0x8a86ad,
    map: tiles,
    emissiveMap: tiles,
    emissive: 0xffffff,
    emissiveIntensity: 1,
    roughness: 0.5,
    metalness: 0.1,
    envMapIntensity: 0.35,
  });
  const stripes = hazardTexture();
  stripes.wrapT = THREE.RepeatWrapping;
  stripes.repeat.set(0.25, 1 / SLAB_DEPTH);
  const side = new THREE.MeshStandardMaterial({ map: stripes, emissiveMap: stripes, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.55 });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, [top, side]));

  const edgeMaterial = neon(color);
  const lowerEdge = neon(color, 0.5); // just under the bloom: outlines the slab without glare
  for (const path of [outline, ...outline.holes]) {
    const points = path.getSpacedPoints(160).map((p) => new THREE.Vector3(p.x, 0, -p.y));
    if (points[0].distanceTo(points.at(-1)) < 1e-3) points.pop();
    const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
    const upper = new THREE.Mesh(new THREE.TubeGeometry(curve, 320, 0.2, 6, true), edgeMaterial);
    upper.position.y = 0.02;
    const lower = new THREE.Mesh(new THREE.TubeGeometry(curve, 320, 0.1, 5, true), lowerEdge);
    lower.position.y = -SLAB_DEPTH;
    group.add(upper, lower);
  }

  const emblem = emblemTexture('#ffffff');
  for (const [x, z, radius] of def.emblems) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: emblem, color: glowColor(def.color, 0.7), transparent: true, opacity: 0.8, depthWrite: false }),
    );
    decal.position.set(x, 0.03, z);
    decal.renderOrder = 1;
    group.add(decal);
  }

  const metal = trimMetal();
  const jet = neon(color);
  const beam = beamMaterial(color);
  for (const [x, z] of def.pods) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.1, 1.4, 24), metal);
    pod.position.set(x, -SLAB_DEPTH - 0.7, z);
    const nozzle = new THREE.Mesh(new THREE.CircleGeometry(1.2, 24).rotateX(Math.PI / 2), jet);
    nozzle.position.set(x, -SLAB_DEPTH - 1.42, z);
    const thrust = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3.6, 26, 24, 1, true).translate(0, -13, 0), beam);
    thrust.position.set(x, -SLAB_DEPTH - 1.42, z);
    group.add(pod, nozzle, thrust);
  }

  const points = outline.getPoints().map((p) => [p.x, -p.y]); // [x, z] for fitting the camera
  return { group, shape: def, outline: points, edgeMaterial, hazardMaterial: side, color };
}

// Light cone of a hover pod: bright at the nozzle, fading out downwards.
function beamMaterial(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 64);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)'); // top of the texture = nozzle end (uv.y = 1)
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 64);
  return new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(canvas),
    color: glowColor(color, 0.5),
    transparent: true,
    opacity: 0.32,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

const rand = (amount) => (Math.random() * 2 - 1) * amount;

// 4 rounds from 3 shapes: each shape once in random order, then one again (not the same twice in a row).
function shapeOrder() {
  const order = shuffle([...SHAPE_NAMES]);
  const last = order.at(-1);
  const repeats = SHAPE_NAMES.filter((name) => name !== last);
  return [...order, repeats[Math.floor(Math.random() * repeats.length)]].slice(0, ROUNDS);
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
