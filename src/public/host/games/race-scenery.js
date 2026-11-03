import * as THREE from 'three';
import { createSky, SKY_COLORS } from './backdrop.js';

// Synthwave backdrop for the race: the shared sky plus wireframe mountains on a neon grid.

const FLOOR_Y = -40;
const TERRAIN_SIZE = 2800;
const TERRAIN_CELLS = 110;

export function createScenery(scene, track) {
  scene.background = SKY_COLORS.horizon;
  scene.fog = new THREE.Fog(SKY_COLORS.horizon, 160, 1000);

  // The sun sits just above the horizon, straight ahead from start to finish.
  const frame = track.createFrame();
  const start = track.frameAt(track.startS, frame).position.clone();
  const sunDirection = track.frameAt(track.finishS, frame).position.clone().sub(start).setY(0).normalize();
  sunDirection.y = 0.03;
  const sky = createSky(sunDirection);

  scene.add(sky.object, createTerrain(track));
  return { update: sky.update };
}

// Flat grid under the track that rises into mountains away from it.
function createTerrain(track) {
  const frame = track.createFrame();
  const trackPoints = [];
  for (let s = 0; s <= track.length; s += 8) {
    const p = track.frameAt(s, frame).position;
    trackPoints.push([p.x, p.z]);
  }
  const xs = trackPoints.map(([x]) => x);
  const zs = trackPoints.map(([, z]) => z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;

  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_CELLS, TERRAIN_CELLS).rotateX(-Math.PI / 2);
  geometry.translate(cx, 0, cz);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    let nearest = Infinity;
    for (const [tx, tz] of trackPoints) nearest = Math.min(nearest, (tx - x) ** 2 + (tz - z) ** 2);
    const mask = THREE.MathUtils.smoothstep(Math.sqrt(nearest), 110, 420);
    position.setY(i, FLOOR_Y + mask * mountainHeight(x, z));
  }
  geometry.computeVertexNormals();

  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0x07010f, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
  );

  // Grid lines along rows and columns only (a wireframe would also draw the diagonals).
  const n = TERRAIN_CELLS + 1;
  const low = new THREE.Color('#5a1bd6');
  const high = new THREE.Color('#ff2bd6');
  const linePositions = [];
  const lineColors = [];
  const color = new THREE.Color();
  const pushVertex = (i) => {
    const y = position.getY(i);
    linePositions.push(position.getX(i), y + 0.2, position.getZ(i));
    color.lerpColors(low, high, THREE.MathUtils.clamp((y - FLOOR_Y) / 120, 0, 1));
    lineColors.push(color.r, color.g, color.b);
  };
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n - 1; col++) {
      pushVertex(row * n + col);
      pushVertex(row * n + col + 1);
      pushVertex(col * n + row);
      pushVertex((col + 1) * n + row);
    }
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
  const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ vertexColors: true }));

  const group = new THREE.Group();
  group.add(fill, lines);
  return group;
}

function mountainHeight(x, z) {
  const ridges = Math.abs(Math.sin(x * 0.009 + Math.sin(z * 0.004) * 2.5) * Math.cos(z * 0.011 + Math.sin(x * 0.006) * 2));
  const bumps = 0.5 + 0.5 * Math.sin(x * 0.043 + z * 0.021) * Math.sin(z * 0.037 - x * 0.017);
  return ridges * 110 + bumps * 25;
}
