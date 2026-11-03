import * as THREE from 'three';
import { MSG } from '/shared/protocol.js';

// Host screen of the proof of concept: one ball per connected phone rolls around a square
// floor. Tilt is an acceleration, the walls bounce the ball back.

const FLOOR_SIZE = 20;
const BALL_RADIUS = 0.6;
const ACCELERATION = 28; // units/s² at full tilt
const FRICTION = 1.5; // velocity decay per second
const BOUNCE = 0.6;
const RECONNECT_MS = 1000;

const $ = (id) => document.getElementById(id);
const stage = $('stage');

// --- Scene --------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#07051a');

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 24, 14);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight('#ffffff', '#30206a', 1.2));
const sun = new THREE.DirectionalLight('#ffffff', 2);
sun.position.set(5, 12, 6);
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.BoxGeometry(FLOOR_SIZE, 0.4, FLOOR_SIZE),
  new THREE.MeshStandardMaterial({ color: '#1a1240', roughness: 0.8 }),
);
floor.position.y = -0.2;
scene.add(floor);
const grid = new THREE.GridHelper(FLOOR_SIZE, 20, '#00f0ff', '#3a2a80');
grid.position.y = 0.01;
scene.add(grid);

function resize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// --- Players ------------------------------------------------------------------

const players = new Map(); // id -> { id, name, color, tilt, velocity, mesh }
const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 32, 16);

function addPlayer({ id, name, color }) {
  if (players.has(id)) return;
  const mesh = new THREE.Mesh(ballGeometry, new THREE.MeshStandardMaterial({ color, roughness: 0.3 }));
  mesh.position.set((Math.random() - 0.5) * 6, BALL_RADIUS, (Math.random() - 0.5) * 6);
  scene.add(mesh);
  players.set(id, { id, name, color, tilt: { x: 0, y: 0 }, velocity: new THREE.Vector2(), mesh });
  renderPlayers();
}

function removePlayer(id) {
  const player = players.get(id);
  if (!player) return;
  scene.remove(player.mesh);
  player.mesh.material.dispose();
  players.delete(id);
  renderPlayers();
}

function renderPlayers() {
  const names = [...players.values()].map((p) => p.name);
  $('players').textContent = names.length ? `Connected: ${names.join(', ')}` : 'No phone connected yet';
}

// --- Loop ---------------------------------------------------------------------

const limit = FLOOR_SIZE / 2 - BALL_RADIUS;

function update(dt) {
  for (const p of players.values()) {
    // tilting forward (y > 0) rolls the ball up the screen, i.e. towards -z
    p.velocity.x += p.tilt.x * ACCELERATION * dt;
    p.velocity.y += -p.tilt.y * ACCELERATION * dt;
    p.velocity.multiplyScalar(Math.exp(-FRICTION * dt));

    const pos = p.mesh.position;
    pos.x += p.velocity.x * dt;
    pos.z += p.velocity.y * dt;
    if (Math.abs(pos.x) > limit) {
      pos.x = Math.sign(pos.x) * limit;
      p.velocity.x *= -BOUNCE;
    }
    if (Math.abs(pos.z) > limit) {
      pos.z = Math.sign(pos.z) * limit;
      p.velocity.y *= -BOUNCE;
    }
    // roll: rotate around the axis perpendicular to the movement
    p.mesh.rotation.z -= (p.velocity.x * dt) / BALL_RADIUS;
    p.mesh.rotation.x += (p.velocity.y * dt) / BALL_RADIUS;
  }
}

const timer = new THREE.Timer();
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  update(Math.min(timer.getDelta(), 0.05));
  renderer.render(scene, camera);
});

// --- Network ------------------------------------------------------------------

function connect() {
  const ws = new WebSocket(`wss://${location.host}/ws`);
  ws.onopen = () => {
    $('banner').hidden = true;
    ws.send(JSON.stringify({ type: MSG.HOST_HELLO }));
  };
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case MSG.PLAYER_JOINED:
        addPlayer(msg.player);
        break;
      case MSG.PLAYER_LEFT:
        removePlayer(msg.id);
        break;
      case MSG.TILT: {
        const player = players.get(msg.id);
        if (player) player.tilt = { x: msg.x, y: msg.y };
        break;
      }
    }
  };
  ws.onclose = () => {
    $('banner').hidden = false;
    $('banner').textContent = 'Connection lost, reconnecting…';
    for (const id of [...players.keys()]) removePlayer(id); // the server sends them again
    setTimeout(connect, RECONNECT_MS);
  };
}

fetch('/api/info')
  .then((r) => r.json())
  .then((info) => ($('play-url').textContent = info.playUrl))
  .catch(() => {});
connect();
