import { detectDevice } from '/shared/device.js';
import { bindLanguageSwitch, onLanguageChange, pick, setOwnDevice, t } from '/shared/i18n.js';
import { DASH_COOLDOWN_SECONDS, MAX_PLAYERS, MSG, PHASE } from '/shared/protocol.js';

const MAX_TILT_DEG = 25; // tilting this far = full speed
const DEADZONE = 0.05;
const SMOOTHING_MS = 40; // low-pass time constant against sensor jitter
const CALIBRATION_MS = 400; // the neutral position is averaged over this long
const FLAT_THRESHOLD = 0.4; // tilted less than ~24° from flat: too flat to change the grip
const FIRST_GRIP_THRESHOLD = 0.25; // ~15°: enough to pick the first grip (iPads are held flat-ish)
const TURN_CONFIRM_MS = 500; // a new grip must hold this long before the axes switch
const RECONNECT_MS = 1500;
const SENSOR_WAIT_MS = 1500; // no orientation reading by then: the device has no usable sensor
const NAME_KEY = 'gyrocade:name';
const TOKEN_KEY = 'gyrocade:token'; // sessionStorage: survives a reload, not a new tab
const DEG = Math.PI / 180;

const $ = (id) => document.getElementById(id);
const els = {
  joinScreen: $('join-screen'),
  joinForm: $('join-form'),
  name: $('name'),
  joinError: $('join-error'),
  playScreen: $('play-screen'),
  playerName: $('player-name'),
  status: $('status'),
  pad: $('pad'),
  dot: $('dot'),
  motionHint: $('motion-hint'),
  phaseHint: $('phase-hint'),
  calibrate: $('calibrate'),
  ready: $('ready'),
  dash: $('dash'),
  vote: $('vote'),
  voteOptions: $('vote-options'),
  voteStatus: $('vote-status'),
};

const state = {
  x: 0,
  y: 0,
  sent: '',
  hasGyro: false,
  dragging: false,
  pitch: 0, // smoothed, + = top edge up
  roll: 0, // smoothed, + = right edge down
  smoothedAt: null, // timestamp of the last reading, null = start smoothing fresh
  neutral: null, // { pitch, roll }, null while (re)calibrating
  calibration: null, // { until, pitch, roll, count } while averaging the neutral position
  grip: null, // how the device is held: 0/90/180/270 like SCREEN_AXES, null = not known yet
  gripCandidate: null,
  gripSince: 0,
  turnedSince: false, // the other axis was clearly up since the grip was set (device turned in-plane)
  rotation: 0, // degrees the play screen is turned by us (rotation lock)
  ws: null,
  player: null,
  fatal: false,
  sendLoopRunning: false,
  wakeLock: null,
  status: null, // [state, i18n key] of the connection status, re-rendered on language change
  phase: { phase: PHASE.LOBBY }, // last phase message from the host
  phaseEndsAt: 0, // when the countdown / vote of the current phase ends (performance.now())
  ready: false,
  vote: null, // id of the minigame this phone voted for
  dashReadyAt: 0, // performance.now() when DASH can be tapped again
};

const DEVICE = detectDevice();

els.name.value = readName();
setOwnDevice(DEVICE); // also translates the page
bindLanguageSwitch($('lang-switch'));
onLanguageChange(() => {
  renderStatus();
  renderPhase();
});

els.joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!window.isSecureContext) {
    showJoinError(t('ctrl.needHttps'));
    return;
  }
  const name = els.name.value.trim();
  writeName(name);

  // iOS: the permission prompt must be triggered directly by this tap.
  const motionOk = await enableMotion();
  if (!motionOk) setMotionHint('ctrl.noMotion');
  // Some browsers (e.g. Android without a gyroscope) accept the listener but never send readings.
  else setTimeout(() => !state.hasGyro && setMotionHint('ctrl.noSensor'), SENSOR_WAIT_MS);

  els.joinScreen.hidden = true;
  els.joinError.hidden = true;
  els.playScreen.hidden = false;
  applyLayout();
  document.body.classList.add('playing');
  requestWakeLock();
  state.fatal = false;
  connect(name);
  if (!state.sendLoopRunning) {
    state.sendLoopRunning = true;
    requestAnimationFrame(sendLoop);
  }
});

els.calibrate.addEventListener('click', recalibrate);

// --- Motion -------------------------------------------------------------------

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

function setMotionHint(key) {
  els.motionHint.dataset.i18n = key;
  els.motionHint.classList.toggle('important', key !== 'ctrl.tilt');
  els.motionHint.textContent = t(key);
}

// Screen axes in device coordinates (x = device right, y = device top) per rotation.
// 90 = device turned counter-clockwise (top edge points left), 270 = clockwise.
const SCREEN_AXES = {
  0: { right: [1, 0], up: [0, 1] },
  90: { right: [0, -1], up: [1, 0] },
  180: { right: [-1, 0], up: [0, -1] },
  270: { right: [0, 1], up: [-1, 0] },
};

// Screen rotation in the SCREEN_AXES convention. window.orientation comes first: Apple documents
// 90 as "turned to the left" (counter-clockwise), and Safari's screen.orientation.angle has not
// always agreed with it. Only browsers without window.orientation use screen.orientation.
function screenAngle() {
  const angle = typeof window.orientation === 'number' ? window.orientation : (screen.orientation?.angle ?? 0);
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}

// The axes follow how the device is held (from gravity), not how the screen is rotated, so
// steering stays correct with rotation lock on. Tilt is measured as how far the right edge and
// the top edge dip below / rise above the horizon, which works at any holding angle.
function onOrientation(event) {
  if (event.beta === null || event.gamma === null) return; // desktop browsers without a sensor
  const now = event.timeStamp || performance.now();
  const firstReading = !state.hasGyro;
  state.hasGyro = true;
  if (firstReading) setMotionHint('ctrl.tilt'); // the sensor came up late: drop the "no sensor" hint

  const beta = DEG * event.beta;
  const gamma = DEG * event.gamma;
  // "world up" expressed in device coordinates
  const upX = -Math.sin(gamma) * Math.cos(beta);
  const upY = Math.sin(beta);

  if (updateGrip(upX, upY, now)) {
    // a new grip changes which way is "neutral"
    state.smoothedAt = null;
    recalibrate();
    applyLayout();
  } else if (firstReading) {
    applyLayout();
  }

  const axes = SCREEN_AXES[gripAngle()];
  const roll = -Math.asin(clampUnit(axes.right[0] * upX + axes.right[1] * upY)) / DEG;
  const pitch = Math.asin(clampUnit(axes.up[0] * upX + axes.up[1] * upY)) / DEG;
  const k = state.smoothedAt === null ? 1 : 1 - Math.exp(-Math.max(0, now - state.smoothedAt) / SMOOTHING_MS);
  state.pitch += (pitch - state.pitch) * k;
  state.roll += (roll - state.roll) * k;
  state.smoothedAt = now;

  if (!state.neutral) collectNeutral(now);
  if (state.dragging) return;
  if (state.neutral) {
    state.x = shape((state.roll - state.neutral.roll) / MAX_TILT_DEG);
    state.y = shape((state.neutral.pitch - state.pitch) / MAX_TILT_DEG); // top edge away from you = forward
  } else {
    state.x = 0;
    state.y = 0;
  }
  renderDot();
}

// Works out from gravity which way the device is held. Returns true when that changed.
// Lying flat tells nothing, and a new grip has to be clear and steady before it counts,
// so steering hard never flips the axes.
// Gravity alone can't tell "turned around" from "tilted forward past flat" (both make the top
// edge point down). So a switch to the opposite grip (90 <-> 270, 0 <-> 180) only counts if the
// device was clearly held the other way round in between, i.e. really turned in its own plane.
// Otherwise pushing an iPad far forward in a race would reverse the controls.
function updateGrip(upX, upY, now) {
  const ax = Math.abs(upX);
  const ay = Math.abs(upY);
  const planar = Math.hypot(upX, upY);
  if (planar < (state.grip === null ? FIRST_GRIP_THRESHOLD : FLAT_THRESHOLD)) return false;
  const angle = ax > ay ? (upX > 0 ? 90 : 270) : upY > 0 ? 0 : 180;
  if (state.grip === null) {
    setGrip(angle);
    return true;
  }
  const clear = Math.max(ax, ay) >= Math.min(ax, ay) * 1.5;
  if (clear && angle % 180 !== state.grip % 180) state.turnedSince = true;
  const opposite = Math.abs(angle - state.grip) === 180;
  if (angle === state.grip || !clear || (opposite && !state.turnedSince)) {
    state.gripCandidate = null;
    return false;
  }
  if (state.gripCandidate !== angle) {
    state.gripCandidate = angle;
    state.gripSince = now;
    return false;
  }
  if (now - state.gripSince < TURN_CONFIRM_MS) return false;
  setGrip(angle);
  return true;
}

function setGrip(angle) {
  state.grip = angle;
  state.gripCandidate = null;
  state.turnedSince = false;
}

// The OS turned the screen to the opposite side (rotation lock off): it measured the turn with
// its own sensors, so follow it even if the device is held too flat for us to see the turn.
function onScreenTurn() {
  const screenRotation = screenAngle();
  if (state.grip !== null && Math.abs(screenRotation - state.grip) === 180) {
    setGrip(screenRotation);
    state.smoothedAt = null;
    recalibrate();
  }
  applyLayout();
}

const gripAngle = () => state.grip ?? screenAngle();

function recalibrate() {
  state.neutral = null;
  state.calibration = null;
}

// The neutral position is the average over a short moment, not a single (shaky) reading.
function collectNeutral(now) {
  const c = (state.calibration ??= { until: now + CALIBRATION_MS, pitch: 0, roll: 0, count: 0 });
  c.pitch += state.pitch;
  c.roll += state.roll;
  c.count++;
  if (now < c.until) return;
  state.neutral = { pitch: c.pitch / c.count, roll: c.roll / c.count };
  state.calibration = null;
}

function clampUnit(v) {
  return Math.max(-1, Math.min(1, v));
}

function shape(v) {
  const clamped = Math.max(-1, Math.min(1, v));
  const magnitude = Math.max(0, (Math.abs(clamped) - DEADZONE) / (1 - DEADZONE));
  return Math.sign(clamped) * magnitude;
}

// --- Layout -------------------------------------------------------------------

// iOS reports screen.width/height in portrait whatever the rotation, and iPads claim to be Macs.
function isIOS() {
  const ua = navigator.userAgent;
  return /iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// True for phones and iPads, false for tablets whose "upright" is landscape.
function naturalPortrait() {
  if (isIOS()) return true;
  return (screenAngle() % 180 === 0) === screen.height >= screen.width;
}

// Sizes the play screen to the window and, when rotation lock keeps the screen portrait while
// the device is held sideways (or the other way round), turns it upright for the player.
// Only done across portrait/landscape, where the direction comes from gravity, not the browser.
function applyLayout() {
  const screenRotation = screenAngle();
  const grip = state.hasGyro ? gripAngle() : screenRotation;
  state.rotation = grip % 180 !== screenRotation % 180 ? (grip - screenRotation + 360) % 360 : 0;
  const turned = state.rotation % 180 !== 0;
  const width = turned ? window.innerHeight : window.innerWidth;
  const height = turned ? window.innerWidth : window.innerHeight;

  const frame = els.playScreen;
  frame.style.setProperty('--frame-width', `${width}px`);
  frame.style.setProperty('--frame-height', `${height}px`);
  frame.style.setProperty('--frame-rotation', `${state.rotation}deg`);
  frame.classList.toggle('landscape', width > height);
  frame.classList.toggle('held-portrait', state.hasGyro && (grip % 180 === 0) === naturalPortrait());
  renderDot();
}

window.addEventListener('resize', applyLayout);
screen.orientation?.addEventListener('change', onScreenTurn);
window.addEventListener('orientationchange', onScreenTurn);

// --- Touch fallback: drag on the pad (handy for testing on a laptop) -----------

els.pad.addEventListener('pointerdown', (event) => {
  state.dragging = true;
  els.pad.setPointerCapture(event.pointerId);
  dragTo(event);
});
els.pad.addEventListener('pointermove', (event) => {
  if (state.dragging) dragTo(event);
});
for (const type of ['pointerup', 'pointercancel']) {
  els.pad.addEventListener(type, () => {
    state.dragging = false;
    if (!state.hasGyro) {
      state.x = 0;
      state.y = 0;
      renderDot();
    }
  });
}

function dragTo(event) {
  const rect = els.pad.getBoundingClientRect();
  const sx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
  const sy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
  // undo our own (clockwise) rotation of the play screen; y flips to "up = positive"
  const angle = state.rotation * DEG;
  let x = sx * Math.cos(angle) + sy * Math.sin(angle);
  let y = sx * Math.sin(angle) - sy * Math.cos(angle);
  const length = Math.hypot(x, y);
  if (length > 1) {
    x /= length;
    y /= length;
  }
  state.x = x;
  state.y = y;
  renderDot();
}

function renderDot() {
  const radius = els.pad.clientWidth * 0.37; // the ball (24 % wide) stays inside the tick ring
  els.dot.style.transform = `translate(${state.x * radius}px, ${-state.y * radius}px)`;
}

// --- Network ------------------------------------------------------------------

function connect(name) {
  setStatus('connecting', 'ctrl.connecting');
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${location.host}/ws`);
  state.ws = ws;

  ws.onopen = () => ws.send(JSON.stringify({ type: MSG.JOIN, name, token: readToken(), device: DEVICE }));

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case MSG.WELCOME:
        state.player = msg;
        state.sent = '';
        writeToken(msg.token);
        document.documentElement.style.setProperty('--player', msg.color);
        els.playerName.textContent = msg.name;
        els.dot.textContent = [...msg.name.trim()][0]?.toUpperCase() ?? '?'; // the initial on the ball, as on the big screen
        setHostStatus(msg.hostConnected);
        break;
      case MSG.HOST_STATUS:
        setHostStatus(msg.connected);
        break;
      case MSG.PHASE:
        onPhase(msg);
        break;
      case MSG.ERROR:
        leaveGame(msg.code === 'lobby-full' ? t('ctrl.lobbyFull', { max: MAX_PLAYERS }) : t('ctrl.joinFailed'));
        break;
    }
  };

  ws.onclose = (event) => {
    state.player = null;
    if (event.code === 4002) leaveGame(t('ctrl.replaced'));
    if (state.fatal) return;
    setStatus('reconnecting', 'ctrl.reconnecting');
    setTimeout(() => connect(name), RECONNECT_MS);
  };
}

// Sends at most once per frame, and only when the value changed.
function sendLoop() {
  requestAnimationFrame(sendLoop);
  if (!state.player || state.ws?.readyState !== WebSocket.OPEN) return;
  const x = round3(state.x);
  const y = round3(state.y);
  const key = `${x},${y}`;
  if (key === state.sent) return;
  state.sent = key;
  state.ws.send(JSON.stringify({ type: MSG.TILT, x, y }));
}

function leaveGame(message) {
  state.fatal = true;
  els.playScreen.hidden = true;
  els.joinScreen.hidden = false;
  document.body.classList.remove('playing');
  showJoinError(message);
}

function setHostStatus(connected) {
  if (connected) setStatus('connected', 'ctrl.connected');
  else setStatus('waiting', 'ctrl.waitingScreen');
}

function setStatus(stateName, key) {
  state.status = [stateName, key];
  renderStatus();
}

function renderStatus() {
  if (!state.status) return;
  const [stateName, key] = state.status;
  els.status.dataset.state = stateName;
  els.status.textContent = t(key);
}

function send(msg) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

// --- Lobby flow: ready-up and vote (run by the host, shown here) -------------

function onPhase(msg) {
  const previous = state.phase.phase;
  state.phase = msg;
  state.phaseEndsAt = typeof msg.seconds === 'number' ? performance.now() + msg.seconds * 1000 : 0;

  if (msg.phase === PHASE.LOBBY || msg.phase === PHASE.COUNTDOWN) {
    // back from a game or vote: everyone starts un-ready
    if (previous === PHASE.GAME || previous === PHASE.VOTE) state.ready = false;
    send({ type: MSG.READY, ready: state.ready }); // also restores the state after a reconnect
  }
  if (msg.phase === PHASE.VOTE) {
    if (previous !== PHASE.VOTE) state.vote = null;
    else if (state.vote) send({ type: MSG.VOTE, game: state.vote });
  }
  renderPhase();
}

function renderPhase() {
  const { phase } = state.phase;
  const inLobby = phase === PHASE.LOBBY || phase === PHASE.COUNTDOWN;

  els.ready.hidden = !inLobby;
  els.ready.setAttribute('aria-pressed', String(state.ready));
  els.ready.textContent = t(state.ready ? 'ctrl.readyDone' : 'ctrl.ready');

  if (phase === PHASE.LOBBY) els.phaseHint.textContent = t(state.ready ? 'ctrl.readyWaiting' : 'ctrl.readyHint');
  else if (phase === PHASE.COUNTDOWN) els.phaseHint.textContent = t('ctrl.countdown', { seconds: secondsLeft() });
  else if (phase === PHASE.GAME) els.phaseHint.textContent = t('ctrl.inGame');
  else els.phaseHint.textContent = '';

  // games that use DASH say so in their phase message
  els.dash.hidden = !(phase === PHASE.GAME && state.phase.controls?.includes('dash'));

  els.vote.hidden = phase !== PHASE.VOTE;
  if (phase === PHASE.VOTE) {
    els.voteOptions.replaceChildren(
      ...(state.phase.options ?? []).map((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'vote-option';
        button.textContent = pick(option.name);
        button.setAttribute('aria-pressed', String(option.id === state.vote));
        button.addEventListener('click', () => castVote(option.id));
        return button;
      }),
    );
    renderVoteStatus();
  }
}

function renderVoteStatus() {
  const left = t('ctrl.voteSeconds', { seconds: secondsLeft() });
  els.voteStatus.textContent = state.vote ? `${t('ctrl.voted')} ${left}` : left;
}

const secondsLeft = () => Math.max(0, Math.ceil((state.phaseEndsAt - performance.now()) / 1000));

function castVote(game) {
  state.vote = game;
  send({ type: MSG.VOTE, game });
  renderPhase();
}

els.ready.addEventListener('click', () => {
  state.ready = !state.ready;
  send({ type: MSG.READY, ready: state.ready });
  navigator.vibrate?.(30);
  renderPhase();
});

// pointerdown, not click: a dash has to fire the moment the thumb lands.
els.dash.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  const now = performance.now();
  if (now < state.dashReadyAt) return;
  state.dashReadyAt = now + DASH_COOLDOWN_SECONDS * 1000;
  send({ type: MSG.DASH });
  navigator.vibrate?.(40);
  // the button drains and refills over the cooldown (see .dash-button.cooling)
  els.dash.style.setProperty('--cooldown', `${DASH_COOLDOWN_SECONDS}s`);
  els.dash.classList.remove('cooling');
  void els.dash.offsetWidth; // restart the animation
  els.dash.classList.add('cooling');
});

// Countdowns tick locally between phase messages.
setInterval(() => {
  const { phase } = state.phase;
  if (phase === PHASE.COUNTDOWN) els.phaseHint.textContent = t('ctrl.countdown', { seconds: secondsLeft() });
  if (phase === PHASE.VOTE) renderVoteStatus();
}, 250);

// --- Misc ---------------------------------------------------------------------

async function requestWakeLock() {
  try {
    state.wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // not supported or denied: the screen may dim, the game still works
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !els.playScreen.hidden) requestWakeLock();
});

function showJoinError(message) {
  els.joinError.textContent = message;
  els.joinError.hidden = false;
}

function readName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // private mode: name just isn't remembered
  }
}

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeToken(token) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // private mode: a page reload joins as a new player
  }
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}
