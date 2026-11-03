import * as THREE from 'three';
import { glowColor, hazardTexture, NEON_LUMINANCE, neon, SIGNAL, slab } from './kit.js';
import { chevronTexture } from './race-textures.js';

// Random obstacle course between start and finish, new for every race.
// Collisions happen in track space (s along the track, d sideways), like the ball physics.

const BLOCK_HEIGHT = 1.6;
const SLIDER_WIDTH = 4.5;
const SLIDER_LENGTH = 2;
const GATE_GAP = 5;
const BUMPER_RADIUS = 1.1;
const BOOST_WIDTH = 4;
const BOOST_LENGTH = 7;
const WALL_RESTITUTION = 0.4;
const BUMPER_RESTITUTION = 0.9;
const BUMPER_KICK = 9;

export function createObstacles(track) {
  const list = layout(track);
  const solids = list.filter((o) => o.type !== 'boost');
  const sliders = list.filter((o) => o.type === 'slider');
  const bumpers = list.filter((o) => o.type === 'bumper');
  const pads = list.filter((o) => o.type === 'boost');

  // Static blocks are amber, moving sliders yellow: stripes on the faces racers run into,
  // a dark top, and a neon line along the edges so they read from far down the track.
  const top = slab(0x1a0b2e);
  const blockSide = hazardSide(SIGNAL.amber);
  const sliderSide = hazardSide('#fff200');
  const blockEdges = new THREE.LineBasicMaterial({ color: glowColor(SIGNAL.amber, NEON_LUMINANCE) });
  const sliderEdges = new THREE.LineBasicMaterial({ color: glowColor('#fff200', NEON_LUMINANCE) });
  const ringMaterial = neon(SIGNAL.cyan);
  const boostTexture = chevronTexture();
  const boostMaterial = new THREE.MeshBasicMaterial({
    map: boostTexture,
    color: new THREE.Color(1.25, 1.25, 1.25),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const object = new THREE.Group();
  for (const o of list) {
    o.mesh = buildMesh(o);
    object.add(o.mesh);
    place(o);
  }

  function buildMesh(o) {
    if (o.type === 'block' || o.type === 'slider') {
      const slider = o.type === 'slider';
      const width = slider ? SLIDER_WIDTH : o.d1 - o.d0;
      const geometry = new THREE.BoxGeometry(width, BLOCK_HEIGHT, o.s1 - o.s0).translate(0, BLOCK_HEIGHT / 2, 0);
      prepareBlock(geometry, width, o.s1 - o.s0);
      const mesh = new THREE.Mesh(geometry, [slider ? sliderSide : blockSide, top]);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), slider ? sliderEdges : blockEdges));
      return mesh;
    }
    if (o.type === 'bumper') {
      o.material = new THREE.MeshStandardMaterial({ color: 0x2a0838, emissive: SIGNAL.magenta, emissiveIntensity: 0.35, roughness: 0.3, metalness: 0.4 });
      const group = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(o.radius, o.radius, 1.4, 28).translate(0, 0.7, 0), o.material);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(o.radius, 0.1, 8, 40), ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.45;
      group.add(post, ring);
      return group;
    }
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(BOOST_WIDTH, BOOST_LENGTH).rotateX(-Math.PI / 2).translate(0, 0.04, 0),
      boostMaterial,
    );
    pad.renderOrder = 1;
    return pad;
  }

  function place(o) {
    if (o.type === 'bumper') track.place(o.mesh, o.s, o.d);
    else track.place(o.mesh, (o.s0 + o.s1) / 2, (o.d0 + o.d1) / 2);
  }

  function update(dt, time) {
    for (const o of sliders) {
      const angle = time * o.speed + o.phase;
      const center = o.amplitude * Math.sin(angle);
      o.vd = o.amplitude * o.speed * Math.cos(angle);
      o.d0 = center - SLIDER_WIDTH / 2;
      o.d1 = center + SLIDER_WIDTH / 2;
      place(o);
    }
    for (const o of bumpers) {
      if (o.flash === 0) continue;
      o.flash = Math.max(0, o.flash - dt * 3);
      o.material.emissiveIntensity = 0.35 + o.flash * 1.6; // a hit flashes just past the bloom
    }
    boostTexture.offset.y -= dt * 1.5; // chevrons flow forward
  }

  // Pushes a ball (s, d, vs, vd) out of anything it overlaps and bounces it off.
  function collide(ball, radius) {
    for (const o of solids) {
      if (Math.abs(o.sMid - ball.s) > o.reach + radius) continue;
      if (o.type === 'bumper') hitBumper(ball, o, radius);
      else hitRect(ball, o, radius);
    }
  }

  const boostAt = (s, d) => pads.some((o) => s >= o.s0 && s <= o.s1 && d >= o.d0 && d <= o.d1);

  return { object, update, collide, boostAt };
}

function hazardSide(color) {
  const stripes = hazardTexture(color);
  stripes.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshStandardMaterial({ map: stripes, emissiveMap: stripes, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 0.5 });
}

// Box UVs run 0..1 on every face whatever its size: rescale them so the stripes keep the
// same width (one 128 × 32 tile per 4 × 1 units) on a 16-wide gate and a 2-long slider.
// Then regroup the faces into sides (material 0) and top + bottom (material 1): two draw
// calls per block instead of six. BoxGeometry face order: +x, -x, +y, -y, +z, -z.
function prepareBlock(geometry, width, length) {
  const uv = geometry.attributes.uv;
  const faceU = [length, length, width, width, width, width];
  for (let face = 0; face < 6; face++) {
    for (let v = face * 4; v < face * 4 + 4; v++) uv.setXY(v, (uv.getX(v) * faceU[face]) / 4, uv.getY(v) * BLOCK_HEIGHT);
  }
  const index = geometry.index.array;
  const faces = (list) => list.flatMap((face) => Array.from(index.slice(face * 6, face * 6 + 6)));
  geometry.setIndex([...faces([0, 1, 4, 5]), ...faces([2, 3])]);
  geometry.clearGroups();
  geometry.addGroup(0, 24, 0);
  geometry.addGroup(24, 12, 1);
}

function hitRect(ball, o, radius) {
  let ns = ball.s - THREE.MathUtils.clamp(ball.s, o.s0, o.s1);
  let nd = ball.d - THREE.MathUtils.clamp(ball.d, o.d0, o.d1);
  let distance = Math.hypot(ns, nd);
  if (distance >= radius) return;
  if (distance === 0) {
    // center inside the box (e.g. a slider moved onto the ball): leave through the nearest side
    const exits = [
      [ball.s - o.s0, -1, 0],
      [o.s1 - ball.s, 1, 0],
      [ball.d - o.d0, 0, -1],
      [o.d1 - ball.d, 0, 1],
    ];
    const [depth, es, ed] = exits.reduce((a, b) => (b[0] < a[0] ? b : a));
    ns = es;
    nd = ed;
    distance = -depth;
  } else {
    ns /= distance;
    nd /= distance;
  }
  ball.s += ns * (radius - distance);
  ball.d += nd * (radius - distance);
  bounce(ball, ns, nd, o.vd ?? 0, WALL_RESTITUTION);
}

function hitBumper(ball, o, radius) {
  let ns = ball.s - o.s;
  let nd = ball.d - o.d;
  const minDistance = o.radius + radius;
  const distance = Math.hypot(ns, nd);
  if (distance >= minDistance) return;
  if (distance === 0) {
    ns = -1;
    nd = 0;
  } else {
    ns /= distance;
    nd /= distance;
  }
  ball.s += ns * (minDistance - distance);
  ball.d += nd * (minDistance - distance);
  if (bounce(ball, ns, nd, 0, BUMPER_RESTITUTION)) {
    ball.vs += ns * BUMPER_KICK;
    ball.vd += nd * BUMPER_KICK;
    o.flash = 1;
  }
}

// Reflects the velocity along the normal (relative to a moving obstacle). Returns true on impact.
function bounce(ball, ns, nd, obstacleVd, restitution) {
  const vn = ball.vs * ns + (ball.vd - obstacleVd) * nd;
  if (vn >= 0) return false;
  const impulse = -(1 + restitution) * vn;
  ball.vs += impulse * ns;
  ball.vd += impulse * nd;
  return true;
}

function layout(track) {
  const hw = track.halfWidth;
  const rand = THREE.MathUtils.randFloat;
  const list = [];
  const block = (s0, s1, d0, d1) => list.push({ type: 'block', s0, s1, d0, d1 });
  const bumper = (s, d) => list.push({ type: 'bumper', s, d, radius: BUMPER_RADIUS, flash: 0 });
  const boost = (s, d) =>
    list.push({ type: 'boost', s0: s, s1: s + BOOST_LENGTH, d0: d - BOOST_WIDTH / 2, d1: d + BOOST_WIDTH / 2 });
  const slider = (s, phase) =>
    list.push({
      type: 'slider',
      s0: s,
      s1: s + SLIDER_LENGTH,
      d0: 0,
      d1: 0,
      vd: 0,
      amplitude: hw - SLIDER_WIDTH / 2 - 1.2,
      speed: rand(1.1, 1.9),
      phase,
    });

  // Each pattern places its obstacles starting at s and returns where it ends.
  const patterns = {
    slalom(s) {
      const side = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < 5; i++) bumper(s + i * 13, (i % 2 ? side : -side) * rand(2, 4.5));
      return s + 52;
    },
    gates(s) {
      for (const at of [s, s + 20]) {
        const gap = rand(-hw + 3.5, hw - 3.5);
        block(at, at + 1.5, -hw, gap - GATE_GAP / 2);
        block(at, at + 1.5, gap + GATE_GAP / 2, hw);
      }
      return s + 22;
    },
    sliders(s) {
      for (let i = 0; i < 3; i++) slider(s + i * 13, i * 2.1);
      return s + 28;
    },
    pinball(s) {
      const placed = [];
      for (let tries = 0; placed.length < 7 && tries < 100; tries++) {
        const p = [s + rand(0, 40), rand(-hw + 2, hw - 2)];
        if (placed.some(([ps, pd]) => Math.hypot(ps - p[0], pd - p[1]) < 5)) continue;
        placed.push(p);
        bumper(...p);
      }
      return s + 40;
    },
    chicane(s) {
      const side = Math.random() < 0.5 ? -1 : 1;
      for (const [at, dir] of [
        [s, side],
        [s + 20, -side],
      ]) {
        if (dir < 0) block(at, at + 8, -hw, 1.5);
        else block(at, at + 8, -1.5, hw);
      }
      return s + 28;
    },
    boostAlley(s) {
      const d = rand(-hw + 3, hw - 3);
      boost(s, d);
      boost(s + 14, THREE.MathUtils.clamp(-d, -hw + 3, hw - 3));
      return s + 22;
    },
  };

  const names = Object.keys(patterns);
  let s = track.startS + 55;
  let last = null;
  for (;;) {
    let name;
    do name = names[Math.floor(Math.random() * names.length)];
    while (name === last);
    last = name;
    const before = list.length;
    const end = patterns[name](s);
    if (end > track.finishS - 20) {
      list.length = before;
      break;
    }
    s = end + rand(16, 26);
    if (Math.random() < 0.35) boost(s - 12, rand(-hw + 3, hw - 3));
  }

  for (const o of list) {
    if (o.type === 'bumper') {
      o.sMid = o.s;
      o.reach = o.radius;
    } else {
      o.sMid = (o.s0 + o.s1) / 2;
      o.reach = (o.s1 - o.s0) / 2;
    }
  }
  return list;
}
