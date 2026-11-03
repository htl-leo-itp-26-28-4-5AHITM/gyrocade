import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { isPhone, isTablet } from '/shared/device.js';
import { bindLanguageSwitch, deviceWord, onLanguageChange, pick, t, translatePage } from '/shared/i18n.js';
import { MAX_PLAYERS, MSG, PHASE, READY_COUNTDOWN_SECONDS, VOTE_SECONDS } from '/shared/protocol.js';
import { createArena } from './games/arena.js';
import { MIN_PLAYERS_TO_START, MINIGAMES } from './games/index.js';

// Host screen: owns the renderer, the server connection and the lobby panel, and runs one game
// at a time. Lobby flow: players join (arena toy) -> everyone taps READY on their phone ->
// short countdown -> phones vote for a minigame (tie: roulette) -> the minigame runs.
// A game is { kind, scene, camera, background?, bloom, exposure?, over?, addPlayer, removePlayer,
// renamePlayer?, dash?, update, resize, dispose }. create() gets { stage, environment }.

const RECONNECT_MS = 1000;
const WIFI_REFRESH_MS = 30_000;
const ONLINE_POLL_MS = 2000; // while the online tunnel is starting or reconnecting
const COPIED_MS = 2500;
const ROULETTE_MS = 2600;
const WINNER_MS = 1800;

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const els = {
  lobby: $('lobby'),
  qr: $('qr'),
  qrBig: $('qr-big'),
  qrOverlay: $('qr-overlay'),
  joinCard: $('join-card'),
  joinUrl: $('join-url'),
  joinUrlBig: $('join-url-big'),
  wifi: $('wifi'),
  step2: $('step2'),
  step3: $('step3'),
  playerCount: $('player-count'),
  readyCount: $('ready-count'),
  slots: $('slots'),
  lobbyStatus: $('lobby-status'),
  countdown: $('countdown'),
  countdownNumber: $('countdown-number'),
  countdownProgress: $('countdown-progress'),
  vote: $('vote'),
  voteTitle: $('vote-title'),
  voteSeconds: $('vote-seconds'),
  voteProgress: $('vote-progress'),
  voteCards: $('vote-cards'),
  banner: $('banner'),
  stageHint: $('stage-hint'),
};

translatePage();
bindLanguageSwitch($('lang-switch'));

// Canvas textures (ball initials, track signs) are drawn once, so the display font has to be
// there first. Without it (offline cache miss) they fall back to a system font after a moment.
await Promise.race([
  Promise.all(['400 60px Bungee', '700 20px "Barlow Semi Condensed"'].map((font) => document.fonts.load(font))),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]).catch(() => {});

// --- Rendering ----------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// Neutral keeps hues: ACES bleached the lit tops of the balls to pastel in the top-down views.
renderer.toneMapping = THREE.NeutralToneMapping;
stage.appendChild(renderer.domElement);

// Neutral studio reflections for glossy balls and metal trim (one bake at startup, no files).
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environment = pmrem.fromScene(room, 0.04).texture;
room.dispose();
pmrem.dispose();

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
stage.appendChild(labelRenderer.domElement);

// Optional background layer (the lobby's vista), drawn first from its own camera.
const backgroundPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.3, 0.6); // strength, radius, threshold
const composer = new EffectComposer(renderer);
composer.addPass(backgroundPass);
composer.addPass(renderPass);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height);
  labelRenderer.setSize(width, height);
  composer.setSize(width, height);
  game?.resize(width, height);
}
new ResizeObserver(resize).observe(stage);

// --- Games --------------------------------------------------------------------

const players = new Map(); // id -> { id, name, color, tilt, ready, connected, card }
let game = null;
let minigame = null; // MINIGAMES entry that is running, for rematches

function startGame(create) {
  game?.dispose();
  game = create({ stage, environment });
  renderer.toneMappingExposure = game.exposure ?? 1;
  for (const player of players.values()) game.addPlayer(player);

  const background = game.background;
  backgroundPass.enabled = Boolean(background);
  if (background) {
    backgroundPass.scene = background.scene;
    backgroundPass.camera = background.camera;
  }
  renderPass.clear = !background; // draw on top of the background, only reset depth
  renderPass.clearDepth = Boolean(background);
  renderPass.scene = game.scene;
  renderPass.camera = game.camera;
  Object.assign(bloom, game.bloom);
  els.lobby.hidden = game.kind !== 'arena';
  renderStageHint();
  resize();
  fitQrCodes(); // the panel was hidden during the game: the QR code may have been sized to nothing
}

function backToLobby() {
  startGame(createArena);
  enterLobby();
}

function launch(entry) {
  minigame = entry;
  setPhase({ phase: PHASE.GAME, game: entry.id, controls: entry.controls ?? [] });
  startGame(entry.create);
}

// --- Lobby flow: ready-up -> countdown -> vote ------------------------------------

const flow = {
  phase: PHASE.LOBBY, // also 'roulette' while the tie-breaker spins (host only)
  endsAt: 0, // performance.now() when the countdown / vote ends
  options: [], // MINIGAMES entries that can be voted for
  votes: new Map(), // player id -> minigame id
  lastPhaseMsg: { type: MSG.PHASE, phase: PHASE.LOBBY },
};

// Tells the phones (via the server) what to show.
function setPhase(msg) {
  flow.phase = msg.phase;
  flow.lastPhaseMsg = { type: MSG.PHASE, ...msg };
  send(flow.lastPhaseMsg);
}

function enterLobby() {
  for (const p of players.values()) p.ready = false;
  flow.votes.clear();
  setPhase({ phase: PHASE.LOBBY });
  renderOverlays();
  renderPanel();
}

const connectedPlayers = () => [...players.values()].filter((p) => p.connected);
const allReady = () =>
  players.size >= MIN_PLAYERS_TO_START && [...players.values()].every((p) => p.connected && p.ready);

// Called whenever players, ready or connection state change.
function checkReady() {
  if (flow.phase === PHASE.LOBBY && allReady()) {
    flow.endsAt = performance.now() + READY_COUNTDOWN_SECONDS * 1000;
    setPhase({ phase: PHASE.COUNTDOWN, seconds: READY_COUNTDOWN_SECONDS });
  } else if (flow.phase === PHASE.COUNTDOWN && !allReady()) {
    setPhase({ phase: PHASE.LOBBY }); // someone un-readied, left or dropped: cancel
  }
  renderOverlays();
  renderPanel();
}

function startVote() {
  flow.options = MINIGAMES.filter((g) => players.size >= g.minPlayers);
  if (flow.options.length === 0) return enterLobby();
  flow.votes.clear();
  flow.endsAt = performance.now() + VOTE_SECONDS * 1000;
  setPhase({
    phase: PHASE.VOTE,
    seconds: VOTE_SECONDS,
    options: flow.options.map(({ id, name }) => ({ id, name })),
  });
  renderOverlays();
  renderPanel();
}

function onVote(id, gameId) {
  if (flow.phase !== PHASE.VOTE || !players.has(id) || !flow.options.some((o) => o.id === gameId)) return;
  flow.votes.set(id, gameId);
  renderVoteCards();
  checkVoteDone();
}

// The vote ends early once every connected player has voted (dropped phones aren't waited for).
function checkVoteDone() {
  if (flow.phase !== PHASE.VOTE) return;
  const connected = connectedPlayers();
  if (connected.length > 0 && connected.every((p) => flow.votes.has(p.id))) finishVote();
}

// Too few players left for any game on offer (e.g. someone left during the vote or roulette).
const tooFewForVote = () => players.size < Math.min(...flow.options.map((o) => o.minPlayers));

// Most votes wins; a tie (or no votes at all) is decided by a roulette.
function finishVote() {
  const counts = new Map(flow.options.map((o) => [o.id, 0]));
  for (const gameId of flow.votes.values()) counts.set(gameId, counts.get(gameId) + 1);
  const best = Math.max(...counts.values());
  const candidates = flow.options.filter((o) => counts.get(o.id) === best);
  flow.phase = 'roulette';

  if (candidates.length === 1) return revealWinner(candidates[0]);
  els.voteTitle.textContent = t('host.rouletteTitle');
  const winner = candidates[Math.floor(Math.random() * candidates.length)];
  // the spotlight hops between the candidates, slowing down, and stops on the winner
  const hops = candidates.length * 6 + candidates.indexOf(winner);
  let hop = 0;
  const step = () => {
    if (flow.phase !== 'roulette') return; // cancelled meanwhile
    spotlight(candidates[hop % candidates.length].id);
    if (hop === hops) return setTimeout(() => revealWinner(winner), 300);
    hop++;
    setTimeout(step, 60 + (ROULETTE_MS / hops) * (hop / hops) * 1.6);
  };
  step();
}

function spotlight(gameId) {
  for (const card of els.voteCards.children) card.classList.toggle('spotlight', card.dataset.game === gameId);
}

function revealWinner(entry) {
  if (flow.phase !== 'roulette') return; // cancelled meanwhile
  els.voteTitle.textContent = `${t('host.winner')}: ${pick(entry.name)}`;
  for (const card of els.voteCards.children) {
    card.classList.remove('spotlight');
    card.classList.toggle('winner', card.dataset.game === entry.id);
    card.classList.toggle('loser', card.dataset.game !== entry.id);
  }
  setTimeout(() => {
    if (flow.phase !== 'roulette') return; // cancelled meanwhile (e.g. everyone left)
    if (players.size < entry.minPlayers) return enterLobby();
    launch(entry);
    renderOverlays();
  }, WINNER_MS);
}

// Countdown and vote timers, called every frame.
function tickFlow() {
  const left = Math.max(0, (flow.endsAt - performance.now()) / 1000);
  if (flow.phase === PHASE.COUNTDOWN) {
    els.countdownNumber.textContent = Math.ceil(left);
    els.countdownProgress.style.strokeDashoffset = 100 - (left / READY_COUNTDOWN_SECONDS) * 100;
    els.lobbyStatus.textContent = t('lobby.countdown', { seconds: Math.ceil(left) });
    if (left === 0) startVote();
  } else if (flow.phase === PHASE.VOTE) {
    els.voteSeconds.textContent = Math.ceil(left);
    els.voteProgress.style.strokeDashoffset = 100 - (left / VOTE_SECONDS) * 100;
    if (left === 0) finishVote();
  }
}

// --- Players ------------------------------------------------------------------

function addPlayer({ id, name, color, device = 'other', connected = true }) {
  if (players.has(id)) return;
  const card = document.createElement('li');
  card.className = 'slot joined';
  card.style.setProperty('--color', color);
  card.innerHTML = `<span class="avatar"></span>
    <span class="slot-text"><span class="slot-name"></span><span class="slot-state"></span></span>`;
  card.querySelector('.avatar').textContent = initial(name);
  card.querySelector('.slot-name').textContent = name;
  card.addEventListener('animationend', () => card.classList.remove('joined'), { once: true });

  const player = { id, name, color, device, tilt: { x: 0, y: 0 }, ready: false, connected, card };
  players.set(id, player);
  game.addPlayer(player);
  checkReady();
}

function removePlayer(id) {
  if (!players.has(id)) return;
  players.delete(id);
  flow.votes.delete(id);
  game.removePlayer(id);
  if (players.size === 0) return game.kind === 'arena' ? enterLobby() : backToLobby();
  if ((flow.phase === PHASE.VOTE || flow.phase === 'roulette') && tooFewForVote()) return enterLobby();
  if (flow.phase === PHASE.VOTE) {
    renderVoteCards();
    checkVoteDone();
  }
  checkReady();
}

// A player who rejoined under another name: the lobby card and the name tags in the game follow.
function renamePlayer(player, name) {
  player.name = name;
  player.card.querySelector('.avatar').textContent = initial(name);
  player.card.querySelector('.slot-name').textContent = name;
  for (const label of stage.querySelectorAll(`.name-tag[data-player="${player.id}"] .label`)) label.textContent = name;
  game.renamePlayer?.(player.id, name); // the initial on the ball
  if (flow.phase === PHASE.VOTE) renderVoteCards();
}

const initial = (name) => [...name.trim()][0]?.toUpperCase() ?? '?';

// What to call the players' devices in host texts: "iPad" if everyone has one, "tablet" if all
// are tablets, "phone or tablet" if mixed, "phone" otherwise.
function playersDevice() {
  const devices = [...players.values()].map((p) => p.device).filter((d) => d !== 'other');
  if (devices.length === 0) return deviceWord('phone');
  if (devices.every((d) => d === devices[0])) return deviceWord(devices[0]);
  if (devices.every(isTablet)) return deviceWord('tablet');
  if (devices.every(isPhone)) return deviceWord('phone');
  return deviceWord('mixed');
}

function renderPanel() {
  const list = [...players.values()];
  const ready = list.filter((p) => p.ready && p.connected).length;
  els.playerCount.textContent = `${list.length}/${MAX_PLAYERS}`;
  els.readyCount.textContent = list.length ? t('lobby.readyCount', { ready, total: list.length }) : '';

  for (const p of list) {
    p.card.classList.toggle('ready', p.ready && p.connected);
    p.card.classList.toggle('offline', !p.connected);
    p.card.querySelector('.slot-state').textContent = !p.connected
      ? t('lobby.reconnecting')
      : t(p.ready ? 'lobby.ready' : 'lobby.notReady') + (p.ready ? ' ✓' : '');
  }
  // Free slots only up to the next full row (at least two rows), so the panel grows with the
  // lobby and fits short screens; the count above still shows the maximum.
  const shown = Math.min(MAX_PLAYERS, Math.max(4, Math.ceil((list.length + 1) / 2) * 2));
  const empty = Array.from({ length: shown - list.length }, () => {
    const slot = document.createElement('li');
    slot.className = 'slot empty';
    slot.textContent = t('lobby.freeSlot');
    return slot;
  });
  els.slots.replaceChildren(...list.map((p) => p.card), ...empty);
  // once a few players are in, the room has seen how joining works: the steps make room
  els.lobby.classList.toggle('crowded', list.length >= 4);
  renderStageHint();

  const missing = MIN_PLAYERS_TO_START - list.length;
  els.lobbyStatus.classList.toggle('counting', flow.phase === PHASE.COUNTDOWN);
  if (flow.phase === PHASE.COUNTDOWN) tickFlow();
  else if (flow.phase === PHASE.VOTE || flow.phase === 'roulette') {
    els.lobbyStatus.textContent = t('host.voteTitle', { device: playersDevice() });
  }
  else if (missing > 0) els.lobbyStatus.textContent = t('lobby.needPlayers', { count: missing });
  else els.lobbyStatus.textContent = t('lobby.needReady', { device: playersDevice() });
}

// Only while the lobby is empty and the panel it points at is on screen.
function renderStageHint() {
  els.stageHint.hidden = players.size > 0 || game?.kind !== 'arena' || els.lobby.hidden;
}

function renderOverlays() {
  els.countdown.hidden = flow.phase !== PHASE.COUNTDOWN;
  const voting = flow.phase === PHASE.VOTE || flow.phase === 'roulette';
  els.vote.hidden = !voting;
  if (flow.phase === PHASE.VOTE) {
    els.voteTitle.textContent = t('host.voteTitle', { device: playersDevice() });
    renderVoteCards();
  }
}

function renderVoteCards() {
  const total = Math.max(1, flow.votes.size);
  els.voteCards.replaceChildren(
    ...flow.options.map((entry) => {
      const voters = [...flow.votes].filter(([, g]) => g === entry.id).map(([id]) => players.get(id)).filter(Boolean);
      const card = document.createElement('div');
      card.className = 'vote-card';
      card.dataset.game = entry.id;
      card.innerHTML = `<span class="game-art">${entry.art}</span>
        <div class="vote-info">
          <span class="vote-name"></span>
          <span class="vote-description"></span>
          <div class="vote-bar"><span></span></div>
          <div class="vote-meta"><span class="vote-count"></span></div>
        </div>`;
      card.querySelector('.vote-name').textContent = pick(entry.name);
      card.querySelector('.vote-description').textContent = pick(entry.description);
      card.querySelector('.vote-count').textContent = t('host.votes', { count: voters.length });
      const meta = card.querySelector('.vote-meta');
      for (const voter of voters) {
        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        avatar.style.setProperty('--color', voter.color);
        avatar.textContent = initial(voter.name);
        meta.append(avatar);
      }
      // let the bar grow from its previous width
      const bar = card.querySelector('.vote-bar span');
      const previous = els.voteCards.querySelector(`[data-game="${entry.id}"] .vote-bar span`)?.style.width ?? '0%';
      bar.style.width = previous;
      requestAnimationFrame(() => (bar.style.width = `${(voters.length / total) * 100}%`));
      return card;
    }),
  );
}

onLanguageChange(() => {
  renderPanel();
  renderWifi();
  if (flow.phase === PHASE.VOTE) renderOverlays();
});

// --- Loop ---------------------------------------------------------------------

startGame(createArena);
renderPanel();

const timer = new THREE.Timer();
renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  game.update(Math.min(timer.getDelta(), 0.05));
  tickFlow();
  composer.render();
  labelRenderer.render(game.scene, game.camera);
});

// ?diag: renderer counts for checking the render budget (draw calls, triangles, memory).
if (new URLSearchParams(location.search).has('diag')) {
  window.__gyro = { renderer, bloom, backgroundPass, get game() { return game; } };
  window.__gyroDiag = () => {
    renderer.info.autoReset = false;
    renderer.info.reset();
    composer.render();
    const { render, memory, programs } = renderer.info;
    renderer.info.autoReset = true;
    return { game: game.kind, calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures, programs: programs?.length };
  };
}

// --- Network ------------------------------------------------------------------

let socket = null;

function send(msg) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${location.host}/ws`);
  socket = ws;

  ws.onopen = () => {
    els.banner.hidden = true;
    // The server forgets the phase when we reconnect, so the hello carries it (with the time left).
    const phase = { ...flow.lastPhaseMsg };
    if (typeof phase.seconds === 'number') phase.seconds = Math.max(0, (flow.endsAt - performance.now()) / 1000);
    ws.send(JSON.stringify({ type: MSG.HOST_HELLO, phase }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case MSG.LOBBY: {
        const ids = new Set(msg.players.map((p) => p.id));
        for (const id of players.keys()) if (!ids.has(id)) removePlayer(id);
        msg.players.forEach(addPlayer);
        break;
      }
      case MSG.PLAYER_JOINED:
        addPlayer(msg.player);
        break;
      case MSG.PLAYER_LEFT:
        removePlayer(msg.id);
        break;
      case MSG.PLAYER_STATUS: {
        const player = players.get(msg.id);
        if (!player) break;
        player.connected = msg.connected;
        if (typeof msg.device === 'string') player.device = msg.device;
        if (typeof msg.name === 'string' && msg.name !== player.name) renamePlayer(player, msg.name);
        checkReady();
        checkVoteDone();
        break;
      }
      case MSG.READY: {
        const player = players.get(msg.id);
        if (!player || (flow.phase !== PHASE.LOBBY && flow.phase !== PHASE.COUNTDOWN)) break;
        player.ready = msg.ready;
        checkReady();
        break;
      }
      case MSG.VOTE:
        onVote(msg.id, msg.game);
        break;
      case MSG.DASH:
        game.dash?.(msg.id);
        break;
      case MSG.TILT: {
        const player = players.get(msg.id);
        if (player) {
          player.tilt.x = msg.x;
          player.tilt.y = msg.y;
        }
        break;
      }
    }
  };

  ws.onclose = (event) => {
    els.banner.hidden = false;
    if (event.code === 4000) {
      els.banner.dataset.i18n = 'host.replaced';
      els.banner.textContent = t('host.replaced');
      return;
    }
    els.banner.dataset.i18n = 'host.reconnecting';
    els.banner.textContent = t('host.reconnecting');
    setTimeout(connect, RECONNECT_MS);
  };
}

// online: null (LAN only) | 'starting' | 'up' | 'down' (see server/index.js)
let joinInfo = { joinUrl: null, typeAddress: '', qrSvg: '', wifi: null, online: null };
let joinInfoTimer = 0;
let copiedTimer = 0;

async function loadJoinInfo() {
  clearTimeout(joinInfoTimer);
  try {
    const info = await fetch('/api/info').then((r) => r.json());
    if (info.qrSvg !== joinInfo.qrSvg) {
      els.qr.innerHTML = info.qrSvg;
      els.qrBig.innerHTML = info.qrSvg;
    }
    joinInfo = info;
    for (const el of [els.joinUrl, els.joinUrlBig]) {
      el.textContent = info.typeAddress;
      el.classList.toggle('long', info.typeAddress.length > 22); // a public hostname, not ip:port
    }
    renderWifi();
    fitQrCodes();
  } catch {
    // server restarting: try again on the next refresh
  }
  const waiting = joinInfo.online === 'starting' || joinInfo.online === 'down';
  joinInfoTimer = setTimeout(loadJoinInfo, waiting ? ONLINE_POLL_MS : WIFI_REFRESH_MS);
}

// Online, friends far away get the link through a chat: clicking the address copies it.
els.joinUrl.addEventListener('click', async () => {
  if (joinInfo.online !== 'up') return;
  try {
    await navigator.clipboard.writeText(joinInfo.joinUrl);
  } catch {
    return;
  }
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedTimer = 0;
    renderWifi();
  }, COPIED_MS);
  renderWifi();
});

// Sizes each QR code so every module is a whole number of screen pixels: no blurry or uneven
// squares on scaled displays (125 %, 150 %) or projectors.
function fitQrCodes() {
  const panelMax = Math.min(els.qr.parentElement.clientWidth - 48, window.innerHeight * 0.25);
  fitQr(els.qr, panelMax);
  fitQr(els.qrBig, Math.min(window.innerWidth, window.innerHeight) * 0.75);
}

function fitQr(container, maxCss) {
  const svg = container.querySelector('svg');
  if (!svg || maxCss <= 0) return;
  const modules = svg.viewBox.baseVal.width;
  const dpr = window.devicePixelRatio || 1;
  const module = Math.max(1, Math.floor((maxCss * dpr) / modules)) / dpr;
  svg.style.width = svg.style.height = `${module * modules}px`;
}

window.addEventListener('resize', fitQrCodes);

function renderWifi() {
  const { online, wifi } = joinInfo;
  const up = online === 'up';
  els.joinCard.classList.toggle('online', up);
  els.joinUrl.title = up ? t('lobby.copyLink') : '';
  if (up) els.wifi.textContent = t(copiedTimer ? 'lobby.copied' : 'lobby.online');
  else if (online === 'starting') els.wifi.textContent = t('lobby.goingOnline');
  else if (online === 'down') els.wifi.textContent = t('lobby.onlineDown');
  else els.wifi.textContent = wifi ? t('lobby.wifi', { name: wifi }) : t('lobby.wifiGeneric');
  // online there is no certificate warning to accept (Cloudflare's certificate is trusted)
  setText(els.step2, up ? 'lobby.step3' : 'lobby.step2');
  setText(els.step3, up ? 'lobby.step3Online' : 'lobby.step3');
}

// Text that translatePage() keeps up to date on language changes.
function setText(el, key) {
  el.dataset.i18n = key;
  el.textContent = t(key);
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  switch (event.key.toLowerCase()) {
    case 'q':
      els.qrOverlay.hidden = !els.qrOverlay.hidden;
      fitQrCodes();
      break;
    case 'l':
      els.lobby.hidden = !els.lobby.hidden;
      renderStageHint();
      fitQrCodes();
      break;
    case 'f':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
      break;
    case ' ':
    case 'enter':
      event.preventDefault();
      if (game.kind !== 'arena' && game.over) backToLobby();
      break;
    case 'r':
      if (game.kind !== 'arena' && game.over && players.size >= minigame.minPlayers) launch(minigame);
      break;
    case 'escape':
      if (!els.qrOverlay.hidden) els.qrOverlay.hidden = true;
      else if (game.kind !== 'arena') backToLobby();
      break;
  }
});
els.qrOverlay.addEventListener('click', () => (els.qrOverlay.hidden = true));

renderWifi();
loadJoinInfo();
connect();
