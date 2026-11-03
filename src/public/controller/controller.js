import { MSG } from '/shared/protocol.js';

// Phone controller of the proof of concept: reads the device orientation, turns it into
// x/y between -1 and 1 and sends it to the server. Portrait only; Sprint 2 adds landscape,
// reconnecting, the lobby and the READY button.

const MAX_TILT_DEG = 25; // tilting this far = full speed
const DEADZONE = 0.05;
const RECONNECT_MS = 1500;

const $ = (id) => document.getElementById(id);
const state = {
  x: 0,
  y: 0,
  beta: 0, // front/back tilt in degrees
  gamma: 0, // left/right tilt in degrees
  neutral: null, // { beta, gamma } of the position the player holds the phone in
  ws: null,
  joined: false,
  sent: '',
};

$('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!window.isSecureContext) return showError('Open this page via https://, otherwise the motion sensors are blocked.');
  // iOS: the permission prompt has to come directly from this tap
  if (!(await enableMotion())) return showError('Motion access was denied. Close Safari completely and try again.');
  $('join-screen').hidden = true;
  $('play-screen').hidden = false;
  connect($('name').value.trim());
  requestAnimationFrame(sendLoop);
});

$('calibrate').addEventListener('click', () => (state.neutral = null));

async function enableMotion() {
  if (typeof DeviceOrientationEvent === 'undefined') return false;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return false;
    } catch {
      return false;
    }
  }
  window.addEventListener('deviceorientation', onOrientation);
  return true;
}

function onOrientation(event) {
  if (event.beta === null || event.gamma === null) return;
  state.beta = event.beta;
  state.gamma = event.gamma;
  // the first reading after start / Recalibrate is the neutral position
  state.neutral ??= { beta: state.beta, gamma: state.gamma };
  state.x = shape((state.gamma - state.neutral.gamma) / MAX_TILT_DEG);
  state.y = shape((state.neutral.beta - state.beta) / MAX_TILT_DEG); // top edge away from you = forward
  renderDot();
}

function shape(v) {
  const clamped = Math.max(-1, Math.min(1, v));
  const magnitude = Math.max(0, (Math.abs(clamped) - DEADZONE) / (1 - DEADZONE));
  return Math.sign(clamped) * magnitude;
}

function renderDot() {
  const radius = $('pad').clientWidth * 0.37;
  $('dot').style.transform = `translate(${state.x * radius}px, ${-state.y * radius}px)`;
}

function connect(name) {
  const ws = new WebSocket(`wss://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: MSG.JOIN, name }));
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type !== MSG.WELCOME) return;
    state.joined = true;
    state.sent = '';
    document.documentElement.style.setProperty('--player', msg.color);
    $('status').textContent = `Connected as ${msg.name}`;
  };
  ws.onclose = () => {
    state.joined = false;
    $('status').textContent = 'Connection lost, reconnecting…';
    setTimeout(() => connect(name), RECONNECT_MS);
  };
}

// Sends at most once per frame, and only when the value changed.
function sendLoop() {
  requestAnimationFrame(sendLoop);
  if (!state.joined || state.ws.readyState !== WebSocket.OPEN) return;
  const x = Math.round(state.x * 1000) / 1000;
  const y = Math.round(state.y * 1000) / 1000;
  const key = `${x},${y}`;
  if (key === state.sent) return;
  state.sent = key;
  state.ws.send(JSON.stringify({ type: MSG.TILT, x, y }));
}

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = false;
}
