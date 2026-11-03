import * as THREE from 'three';
import { glowColor, neon, SIGNAL, slab, trimMetal } from './kit.js';
import { checkerTexture, textTexture, trackTexture } from './race-textures.js';

// A floating neon track along a 3D curve. Everything on it is addressed in track space:
// s = distance along the centerline, d = sideways offset (+ = right when facing forward).

const HALF_WIDTH = 8;
const START_S = 30;
const RUNWAY = 55; // track after the finish line to roll out
const TEXTURE_LENGTH = 16; // track units per texture repeat
const WALL_HEIGHT = 1.1;
const SLAB_DEPTH = 2;
const END_WALL_DEPTH = 0.6;

// Centerline (x, y, z). The race heads towards -z, where the sun sets.
const CONTROL_POINTS = [
  [0, 0, 0],
  [0, 0, -50],
  [0, 0, -100],
  [15, 3, -160],
  [50, 6, -210],
  [60, 4, -270],
  [35, 0, -330],
  [-10, -4, -380],
  [-30, -2, -440],
  [-20, 4, -500],
  [10, 8, -550],
  [20, 4, -610],
  [5, 0, -670],
  [0, 0, -720],
  [0, 0, -780],
  [0, 0, -830],
];

export function createTrack() {
  const curve = new THREE.CatmullRomCurve3(
    CONTROL_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'centripetal',
  );
  const length = curve.getLength();
  const count = Math.ceil(length) + 1; // about one sample per unit
  const step = length / (count - 1);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const positions = [];
  const tangents = [];
  const rights = [];
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    positions.push(curve.getPointAt(u));
    const tangent = curve.getTangentAt(u);
    tangents.push(tangent);
    rights.push(new THREE.Vector3().crossVectors(tangent, worldUp).normalize());
  }

  const createFrame = () => ({
    position: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
  });

  // Position and orientation at distance s. Beyond either end the track continues straight.
  function frameAt(s, frame) {
    const last = count - 1;
    const f = THREE.MathUtils.clamp(s / step, 0, last);
    const i = Math.min(Math.floor(f), last - 1);
    const a = f - i;
    frame.position.lerpVectors(positions[i], positions[i + 1], a);
    frame.tangent.lerpVectors(tangents[i], tangents[i + 1], a).normalize();
    frame.right.lerpVectors(rights[i], rights[i + 1], a).normalize();
    frame.up.crossVectors(frame.right, frame.tangent);
    frame.position.addScaledVector(frame.tangent, s - f * step);
    return frame;
  }

  const placeFrame = createFrame();
  const basis = new THREE.Matrix4();
  const back = new THREE.Vector3();
  // Puts an object on the track surface at (s, d); its local -z points forward, +y up.
  function place(object, s, d = 0) {
    frameAt(s, placeFrame);
    object.position.copy(placeFrame.position).addScaledVector(placeFrame.right, d);
    basis.makeBasis(placeFrame.right, placeFrame.up, back.copy(placeFrame.tangent).negate());
    object.quaternion.setFromRotationMatrix(basis);
    return object;
  }

  const track = {
    length,
    halfWidth: HALF_WIDTH,
    startS: START_S,
    finishS: length - RUNWAY,
    backS: END_WALL_DEPTH, // balls can't roll behind this
    endS: length - END_WALL_DEPTH, // or beyond this
    createFrame,
    frameAt,
    place,
  };
  track.object = buildMeshes(track, count, step);
  return track;
}

function buildMeshes(track, count, step) {
  const group = new THREE.Group();
  const hw = track.halfWidth;
  const strip = (a, b, colors) => stripGeometry(track, count, step, a, b, colors);

  const surface = trackTexture();
  group.add(
    new THREE.Mesh(
      strip([-hw, 0], [hw, 0]),
      new THREE.MeshStandardMaterial({
        map: surface,
        emissiveMap: surface,
        emissive: 0xffffff,
        emissiveIntensity: 0.5,
        roughness: 0.45,
        metalness: 0.2,
        envMapIntensity: 0.4,
      }),
    ),
  );

  // Dark slab under the surface so the track looks solid from the side.
  const slab = new THREE.MeshBasicMaterial({ color: 0x07030f, side: THREE.DoubleSide });
  group.add(
    new THREE.Mesh(strip([-hw, 0], [-hw, -SLAB_DEPTH]), slab),
    new THREE.Mesh(strip([hw, 0], [hw, -SLAB_DEPTH]), slab),
    new THREE.Mesh(strip([-hw, -SLAB_DEPTH], [hw, -SLAB_DEPTH]), slab),
  );

  const barrier = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (const [side, hex] of [
    [-1, '#00f0ff'],
    [1, '#ff2bd6'],
  ]) {
    const color = new THREE.Color(hex);
    const d = side * hw;
    // a faint light curtain under the rail: it fills a lot of screen next to the camera,
    // so it stays dim and never reaches the bloom
    group.add(new THREE.Mesh(strip([d, 0], [d, WALL_HEIGHT], [color.clone().multiplyScalar(0.3), new THREE.Color(0)]), barrier));
    group.add(rail(track, d, WALL_HEIGHT, 0.12, neon(color)));
    group.add(rail(track, d, -SLAB_DEPTH, 0.08, neon(color, 0.45)));
  }

  const startLine = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 2, 0.5).rotateX(-Math.PI / 2).translate(0, 0.03, 0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.1, 1.1) }),
  );
  const finishLine = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 2, 2).rotateX(-Math.PI / 2).translate(0, 0.03, 0),
    new THREE.MeshBasicMaterial({ map: checkerTexture(), color: new THREE.Color(1.1, 1.1, 1.1) }),
  );
  group.add(
    track.place(startLine, track.startS),
    track.place(createArch(hw, 'START', SIGNAL.cyan), track.startS),
    track.place(finishLine, track.finishS),
    track.place(createArch(hw, 'FINISH', SIGNAL.magenta), track.finishS),
    track.place(endWall(hw), track.backS / 2),
    track.place(endWall(hw), track.length - END_WALL_DEPTH / 2),
  );
  return group;
}

// A strip along the whole track between two cross-section points [d, height].
function stripGeometry(track, count, step, [dA, yA], [dB, yB], colors) {
  const frame = track.createFrame();
  const position = [];
  const uv = [];
  const color = [];
  const index = [];
  const point = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const s = i * step;
    track.frameAt(s, frame);
    for (const [d, y] of [
      [dA, yA],
      [dB, yB],
    ]) {
      point.copy(frame.position).addScaledVector(frame.right, d).addScaledVector(frame.up, y);
      position.push(point.x, point.y, point.z);
    }
    uv.push(0, s / TEXTURE_LENGTH, 1, s / TEXTURE_LENGTH);
    if (colors) for (const c of colors) color.push(c.r, c.g, c.b);
    if (i < count - 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

function rail(track, d, y, radius, material) {
  const frame = track.createFrame();
  const points = [];
  for (let s = 0; s < track.length; s += 4) {
    track.frameAt(s, frame);
    points.push(frame.position.clone().addScaledVector(frame.right, d).addScaledVector(frame.up, y));
  }
  track.frameAt(track.length, frame);
  points.push(frame.position.clone().addScaledVector(frame.right, d).addScaledVector(frame.up, y));
  const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), points.length * 3, radius, 6, false);
  return new THREE.Mesh(geometry, material);
}

// Gantry over the track: two metal pylons with neon strips on their inner faces, a truss beam
// with a light bar underneath, and the sign on top. The metal carries the form; only the
// strips and the sign glow, so the arch never blooms out when the camera passes under it.
function createArch(hw, text, color) {
  const group = new THREE.Group();
  const metal = trimMetal();
  const strip = neon(color);
  const height = 7;
  for (const side of [-1, 1]) {
    const x = side * (hw + 0.8);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, height, 0.9).translate(0, height / 2, 0), metal);
    post.position.x = x;
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.12, height - 1.2, 0.3).translate(0, height / 2, 0), strip);
    light.position.x = x - side * 0.5;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.6).translate(0, 0.25, 0), metal);
    foot.position.x = x;
    group.add(post, light, foot);
  }
  const span = hw * 2 + 2.5;
  for (const y of [height - 0.2, height + 1]) {
    const chord = new THREE.Mesh(new THREE.BoxGeometry(span, 0.3, 0.5), metal);
    chord.position.y = y;
    group.add(chord);
  }
  // diagonal truss members between the two chords
  const bays = 8;
  const bay = span / bays;
  const diagonal = Math.hypot(bay, 1.2);
  for (let i = 0; i < bays; i++) {
    const member = new THREE.Mesh(new THREE.BoxGeometry(diagonal, 0.16, 0.16), metal);
    member.position.set(-span / 2 + bay * (i + 0.5), height + 0.4, 0);
    member.rotation.z = (i % 2 ? 1 : -1) * Math.atan2(1.2, bay);
    group.add(member);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(span - 1, 0.12, 0.2), strip);
  bar.position.y = height - 0.4;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 2.75),
    new THREE.MeshBasicMaterial({ map: textTexture(text, color), transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
  sign.position.y = height + 2.9;
  group.add(bar, sign);
  return group;
}

function endWall(hw) {
  const geometry = new THREE.BoxGeometry(hw * 2, 3, END_WALL_DEPTH).translate(0, 1.5, 0);
  const wall = new THREE.Mesh(geometry, slab(0x1a0b2e));
  wall.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: glowColor(SIGNAL.magenta, 1.55) })));
  return wall;
}
