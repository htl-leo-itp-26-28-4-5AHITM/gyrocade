import * as THREE from 'three';
import { t } from '/shared/i18n.js';
import { createNameTag, disposeTree } from '../util.js';
import { createBall } from './ball.js';
import { BLOOM_THRESHOLD } from './kit.js';
import { createHud, ordinal } from './race-hud.js';
import { createObstacles } from './race-obstacles.js';
import { createScenery } from './race-scenery.js';
import { createTrack } from './race-track.js';

// Race to the finish line. Tilt forward to roll, left/right to steer. There is no reverse.
// Ball physics run in track space: s = distance along the track, d = sideways offset (+ = right).

const BALL_RADIUS = 0.8;
const FORWARD_ACCEL = 22; // units/s² at full forward tilt
const FORWARD_DRAG = 0.6; // top speed = FORWARD_ACCEL / FORWARD_DRAG
const SIDE_ACCEL = 42;
const SIDE_DRAG = 3;
const SLOPE_GRAVITY = 18; // hills slow you down, descents speed you up
const BOOST_ACCEL = 90;
const FINISHED_DRAG = 2.5;
const WALL_BOUNCE = 0.5;
const CATCH_UP_GAP = 55; // stragglers further behind the leader get pulled forward
const GHOST_SECONDS = 1.5; // after being pulled forward, a ball passes through everything
const INTRO_SECONDS = 4; // camera swoop, then 3-2-1
const FINISH_TIMEOUT = 20; // seconds the others get after the winner finishes
const RESULTS_DELAY = 2;
const GRID_COLUMNS = 4;
const TRAIL_POINTS = 36;

export function createRace({ stage, environment }) {
  const scene = new THREE.Scene();
  scene.environment = environment;
  scene.environmentIntensity = 0.6;
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);

  const track = createTrack();
  const obstacles = createObstacles(track);
  const scenery = createScenery(scene, track);
  scene.add(track.object, obstacles.object);
  scene.add(new THREE.HemisphereLight(0x9a6bff, 0x12041f, 0.8));
  const light = new THREE.DirectionalLight(0xffe0f4, 1.2);
  light.position.set(-0.4, 1, -0.6);
  scene.add(light);

  const hud = createHud(stage);
  const racers = new Map(); // id -> racer
  const frame = track.createFrame();
  const velocity = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const spin = new THREE.Quaternion();
  const trailHead = new THREE.Vector3();

  let phase = 'countdown'; // 'countdown' | 'racing' | 'over'
  let clock = -INTRO_SECONDS; // race time, negative during the countdown
  let time = 0; // animation time, always running
  let finishCount = 0;
  let firstFinishAt = null;
  let overAt = null;
  let resultsShown = false;
  let lastCount = null;

  // The camera starts high above the grid and swoops in behind the racers during the countdown.
  const cameraPosition = track.frameAt(track.startS + 50, frame).position.clone().add(new THREE.Vector3(0, 45, 0));
  const cameraTarget = track.frameAt(track.startS, frame).position.clone();
  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();

  hud.announce(t('race.getReady'), { className: 'small' });

  // --- Players ------------------------------------------------------------------

  function addPlayer(player) {
    if (racers.has(player.id)) return;
    const parts = createBall(player, BALL_RADIUS);
    const { ball } = parts;
    const ring = parts.base;
    ring.position.y = -BALL_RADIUS;
    const tag = createNameTag(player);
    tag.position.y = BALL_RADIUS + 1.1;

    const group = new THREE.Group();
    group.add(ball, ring, tag);
    const trail = createTrail(player.color);
    scene.add(group, trail.mesh);

    const racer = {
      player,
      slot: freeSlot(),
      s: 0,
      d: 0,
      vs: 0,
      vd: 0,
      group,
      ball,
      parts,
      trail,
      rank: tag.element.querySelector('.rank'),
      finished: false,
      place: 0,
      time: null,
      ghost: 0,
      boost: 0,
    };
    if (phase === 'countdown') placeOnGrid(racer);
    else respawn(racer, Math.max(track.startS, leaderS() - CATCH_UP_GAP * 0.6));
    racers.set(player.id, racer);
    hud.addRacer(racer);
  }

  function removePlayer(id) {
    const racer = racers.get(id);
    if (!racer) return;
    scene.remove(racer.group, racer.trail.mesh);
    disposeTree(racer.group);
    disposeTree(racer.trail.mesh);
    racers.delete(id);
    hud.removeRacer(id);
  }

  function renamePlayer(id, name) {
    racers.get(id)?.parts.rename(name);
  }

  function freeSlot() {
    const used = new Set([...racers.values()].map((r) => r.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    return slot;
  }

  function placeOnGrid(racer) {
    const row = Math.floor(racer.slot / GRID_COLUMNS);
    const column = racer.slot % GRID_COLUMNS;
    racer.s = track.startS - 3 - row * 3.5;
    racer.d = (column - (GRID_COLUMNS - 1) / 2) * 3.4;
  }

  function respawn(racer, s) {
    racer.s = s;
    racer.d = THREE.MathUtils.randFloatSpread(6);
    racer.vs = 18;
    racer.vd = 0;
    racer.ghost = GHOST_SECONDS;
    racer.trail.points.length = 0;
  }

  // Furthest unfinished racer, or -Infinity if there is none.
  function leaderS() {
    let best = -Infinity;
    for (const r of racers.values()) if (!r.finished) best = Math.max(best, r.s);
    return best;
  }

  function standings() {
    return [...racers.values()].sort((a, b) => {
      if (a.finished && b.finished) return a.place - b.place;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.s - a.s;
    });
  }

  // --- Simulation ---------------------------------------------------------------

  function update(dt) {
    time += dt;
    if (phase === 'countdown') {
      clock += dt;
      const count = Math.ceil(-clock);
      if (count <= 3 && count > 0 && count !== lastCount) {
        lastCount = count;
        hud.announce(String(count), { className: 'count' });
      }
      if (clock >= 0) {
        phase = 'racing';
        hud.announce(t('race.go'), { className: 'go' });
      }
    } else if (phase === 'racing') {
      clock += dt;
    }

    obstacles.update(dt, time);
    if (phase !== 'countdown') {
      for (const r of racers.values()) simulate(r, dt);
      collideRacers();
    }
    if (phase === 'racing') {
      catchUp();
      checkFinish();
    }
    if (phase === 'over' && !resultsShown && time - overAt > RESULTS_DELAY) {
      resultsShown = true;
      hud.showResults(standings());
    }

    for (const r of racers.values()) render(r, dt);
    updateCamera(dt);
    scenery.update(camera);
    updateHud();
  }

  function simulate(r, dt) {
    track.frameAt(r.s, frame);
    const done = r.finished || phase === 'over';
    const { tilt } = r.player;
    const throttle = done ? 0 : Math.max(0, tilt.y); // forward only
    const boosting = !done && obstacles.boostAt(r.s, r.d);
    if (boosting) r.boost = 0.5;

    r.vs += (throttle * FORWARD_ACCEL - SLOPE_GRAVITY * frame.tangent.y + (boosting ? BOOST_ACCEL : 0)) * dt;
    r.vs *= Math.exp(-(done ? FINISHED_DRAG : FORWARD_DRAG) * dt);
    r.vd += tilt.x * SIDE_ACCEL * dt;
    r.vd *= Math.exp(-SIDE_DRAG * dt);
    r.s += r.vs * dt;
    r.d += r.vd * dt;

    const limit = track.halfWidth - BALL_RADIUS;
    if (Math.abs(r.d) > limit) {
      r.d = Math.sign(r.d) * limit;
      r.vd *= -WALL_BOUNCE;
    }
    if (r.s < track.backS + BALL_RADIUS) {
      r.s = track.backS + BALL_RADIUS;
      r.vs = Math.abs(r.vs) * WALL_BOUNCE;
    }
    if (r.s > track.endS - BALL_RADIUS) {
      r.s = track.endS - BALL_RADIUS;
      r.vs = -Math.abs(r.vs) * WALL_BOUNCE;
    }

    if (r.ghost > 0) r.ghost = Math.max(0, r.ghost - dt);
    else obstacles.collide(r, BALL_RADIUS);
    r.boost = Math.max(0, r.boost - dt);
  }

  // Equal-mass elastic bounce between balls, in track space.
  function collideRacers() {
    const list = [...racers.values()].filter((r) => r.ghost === 0);
    const minDistance = BALL_RADIUS * 2;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const ds = b.s - a.s;
        const dd = b.d - a.d;
        const distance = Math.hypot(ds, dd);
        if (distance >= minDistance || distance === 0) continue;

        const ns = ds / distance;
        const nd = dd / distance;
        const push = (minDistance - distance) / 2;
        a.s -= ns * push;
        a.d -= nd * push;
        b.s += ns * push;
        b.d += nd * push;

        const relative = (a.vs - b.vs) * ns + (a.vd - b.vd) * nd;
        if (relative <= 0) continue;
        a.vs -= relative * ns;
        a.vd -= relative * nd;
        b.vs += relative * ns;
        b.vd += relative * nd;
      }
    }
  }

  // Keeps everyone on one screen: whoever falls too far behind is pulled up to the pack.
  function catchUp() {
    const lead = leaderS();
    for (const r of racers.values()) {
      if (!r.finished && r.s < lead - CATCH_UP_GAP) respawn(r, lead - CATCH_UP_GAP * 0.6);
    }
  }

  function checkFinish() {
    for (const r of racers.values()) {
      if (r.finished || r.s < track.finishS) continue;
      r.finished = true;
      r.time = clock;
      r.place = ++finishCount;
      firstFinishAt ??= clock;
      hud.announce(t('race.finished', { name: r.player.name, place: ordinal(r.place) }), {
        className: 'small',
        color: r.player.color,
      });
    }
    const all = [...racers.values()];
    const timedOut = firstFinishAt !== null && clock - firstFinishAt > FINISH_TIMEOUT;
    if (all.length > 0 && (all.every((r) => r.finished) || timedOut)) {
      phase = 'over';
      overAt = time;
    }
  }

  // --- Rendering ----------------------------------------------------------------

  function render(r, dt) {
    track.frameAt(r.s, frame);
    r.group.position.copy(frame.position).addScaledVector(frame.right, r.d).addScaledVector(frame.up, BALL_RADIUS);

    velocity.copy(frame.tangent).multiplyScalar(r.vs).addScaledVector(frame.right, r.vd);
    const speed = velocity.length();
    if (speed > 0.01) {
      axis.crossVectors(frame.up, velocity).normalize();
      spin.setFromAxisAngle(axis, (speed * dt) / BALL_RADIUS);
      r.ball.quaternion.premultiply(spin);
    }

    r.ball.visible = r.ghost === 0 || Math.floor(time * 12) % 2 === 0;
    r.parts.setGlow(r.boost > 0 ? 1 : 0);
    trailHead.copy(r.group.position).addScaledVector(frame.up, -0.3);
    updateTrail(r.trail, trailHead, r.boost > 0 ? 2.4 : 1);
  }

  // Follows the pack from behind and zooms out as it spreads.
  function updateCamera(dt) {
    const all = [...racers.values()];
    const running = all.filter((r) => !r.finished);
    const focus = running.length ? running : all;
    let lead = track.startS;
    let tail = track.startS;
    let side = 0;
    if (focus.length) {
      lead = Math.max(...focus.map((r) => r.s));
      tail = Math.max(Math.min(...focus.map((r) => r.s)), lead - CATCH_UP_GAP);
      side = (focus.reduce((sum, r) => sum + r.d, 0) / focus.length) * 0.4;
    }
    const spread = lead - tail;
    const target = (lead + tail) / 2 + 4;

    if (phase === 'over') {
      // high above the finish arch, looking down the runway where the balls roll out
      track.frameAt(track.finishS - 12, frame);
      desiredPosition.copy(frame.position);
      desiredPosition.y += 22;
      track.frameAt(track.finishS + 30, frame);
      desiredTarget.copy(frame.position);
    } else {
      track.frameAt(target - (20 + spread * 0.6), frame);
      desiredPosition.copy(frame.position).addScaledVector(frame.right, side);
      desiredPosition.y += 8 + spread * 0.4;
      track.frameAt(target + 6, frame);
      desiredTarget.copy(frame.position).addScaledVector(frame.right, side);
      desiredTarget.y += 1;
    }

    const k = 1 - Math.exp(-(phase === 'countdown' ? 1.6 : 3.5) * dt);
    cameraPosition.lerp(desiredPosition, k);
    cameraTarget.lerp(desiredTarget, k);
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraTarget);
  }

  function updateHud() {
    hud.setTime(clock);
    const order = standings();
    hud.setStandings(order);
    order.forEach((r, i) => {
      const text = String(i + 1);
      if (r.rank.textContent !== text) r.rank.textContent = text;
    });
    for (const r of racers.values()) {
      const fraction = (r.s - track.startS) / (track.finishS - track.startS);
      hud.setProgress(r.player.id, THREE.MathUtils.clamp(fraction, 0, 1));
    }
  }

  function resize(width, height) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return {
    kind: 'race',
    scene,
    camera,
    bloom: { strength: 0.6, radius: 0.3, threshold: BLOOM_THRESHOLD },
    exposure: 0.95,
    get over() {
      return phase === 'over';
    },
    addPlayer,
    removePlayer,
    renamePlayer,
    update,
    resize,
    dispose() {
      disposeTree(scene);
      hud.dispose();
    },
  };
}

// --- Trails -----------------------------------------------------------------------

function createTrail(color) {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'color']) {
    const attribute = new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 2 * 3), 3);
    geometry.setAttribute(name, attribute.setUsage(THREE.DynamicDrawUsage));
  }
  const index = [];
  for (let i = 0; i < TRAIL_POINTS - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.frustumCulled = false;
  return { mesh, points: [], color: new THREE.Color(color) };
}

const UP = new THREE.Vector3(0, 1, 0);
const trailDirection = new THREE.Vector3();
const trailSide = new THREE.Vector3();

// A flat ribbon through the last positions that narrows and fades towards the end.
function updateTrail(trail, head, brightness) {
  const { points } = trail;
  if (points.length < 2 || points[1].distanceToSquared(head) > 0.25) {
    points.unshift(points.length === TRAIL_POINTS ? points.pop().copy(head) : head.clone());
  } else {
    points[0].copy(head);
  }

  const position = trail.mesh.geometry.attributes.position;
  const color = trail.mesh.geometry.attributes.color;
  const n = points.length;
  for (let i = 0; i < TRAIL_POINTS; i++) {
    const p = points[Math.min(i, n - 1)];
    trailDirection.subVectors(points[Math.max(0, Math.min(i, n - 1) - 1)], points[Math.min(n - 1, i + 1)]);
    trailSide.crossVectors(trailDirection, UP);
    const length = trailSide.length();
    const fade = i < n ? 1 - i / (TRAIL_POINTS - 1) : 0;
    const width = length > 1e-6 ? (BALL_RADIUS * 0.85 * fade) / length : 0;
    position.setXYZ(2 * i, p.x + trailSide.x * width, p.y + trailSide.y * width, p.z + trailSide.z * width);
    position.setXYZ(2 * i + 1, p.x - trailSide.x * width, p.y - trailSide.y * width, p.z - trailSide.z * width);
    const c = fade * fade * brightness;
    color.setXYZ(2 * i, trail.color.r * c, trail.color.g * c, trail.color.b * c);
    color.setXYZ(2 * i + 1, trail.color.r * c, trail.color.g * c, trail.color.b * c);
  }
  position.needsUpdate = true;
  color.needsUpdate = true;
}
