import { randomUUID } from 'node:crypto';
import { DEVICES } from '../public/shared/device.js';
import { MAX_PLAYERS, MSG, PHASE, PLAYER_COLORS } from '../public/shared/protocol.js';

const HEARTBEAT_MS = 10_000;
const RESUME_GRACE_MS = 15_000; // a dropped phone keeps its slot this long to rejoin with its token
const MAX_TILTS_PER_SECOND = 150; // phones send at most once per frame; anything above is dropped
const MIN_DASH_INTERVAL_MS = 200; // the game has its own, longer cooldown; this just stops floods

// Relays controller input to the host screen and keeps track of who is in the lobby.
// The server holds no game logic: games and the lobby flow (ready-up, vote) run on the host page.
// It only remembers the host's last phase message, so phones that join later get it too.
// canHost(req) decides which connections may become the host screen.
export function attachGameServer(wss, { canHost = () => true } = {}) {
  let host = null;
  const players = new Map(); // id -> { id, name, color, device, token, ws, leaveTimer, droppedAt }
  let nextId = 1;
  let phase = { msg: { type: MSG.PHASE, phase: PHASE.LOBBY }, at: Date.now() };

  const send = (ws, msg) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const publicPlayer = ({ id, name, color, device, ws }) => ({ id, name, color, device, connected: Boolean(ws) });
  const broadcastToPlayers = (msg) => {
    for (const p of players.values()) send(p.ws, msg);
  };

  // The stored phase with its countdown shortened by the time that has passed since.
  function currentPhase() {
    const { msg, at } = phase;
    if (typeof msg.seconds !== 'number') return msg;
    return { ...msg, seconds: Math.max(0, msg.seconds - (Date.now() - at) / 1000) };
  }

  function removePlayer(p) {
    clearTimeout(p.leaveTimer);
    players.delete(p.id);
    send(host, { type: MSG.PLAYER_LEFT, id: p.id });
    console.log(`Player ${p.id} left: ${p.name}`);
  }

  // A full lobby makes room by dropping the player who has been gone the longest.
  function evictDropped() {
    const dropped = [...players.values()].filter((p) => !p.ws).sort((a, b) => a.droppedAt - b.droppedAt);
    if (dropped.length === 0) return false;
    removePlayer(dropped[0]);
    return true;
  }

  // Ids of the minigames on offer while a vote runs, null otherwise.
  function voteOptions() {
    const { msg } = phase;
    if (msg.phase !== PHASE.VOTE || !Array.isArray(msg.options)) return null;
    return new Set(msg.options.map((o) => o?.id));
  }

  function freeColor() {
    const used = new Set([...players.values()].map((p) => p.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
  }

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));

    let role = null; // 'host' | 'player'
    let player = null;
    let tiltWindow = 0; // start of the current one-second window for the tilt rate limit
    let tiltCount = 0;
    let lastDash = 0;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      switch (msg.type) {
        case MSG.HOST_HELLO: {
          if (role) return;
          if (!canHost(req)) {
            ws.close(4003, 'Not allowed to host');
            return;
          }
          role = 'host';
          if (host) host.close(4000, 'Replaced by a new host');
          host = ws;
          // A reconnecting host page sends the phase it is in; a new one starts in the lobby.
          const resumedPhase = msg.phase && typeof msg.phase === 'object' && typeof msg.phase.phase === 'string';
          phase = { msg: resumedPhase ? { ...msg.phase, type: MSG.PHASE } : { type: MSG.PHASE, phase: PHASE.LOBBY }, at: Date.now() };
          send(ws, { type: MSG.LOBBY, players: [...players.values()].map(publicPlayer) });
          broadcastToPlayers({ type: MSG.HOST_STATUS, connected: true });
          broadcastToPlayers(phase.msg);
          console.log('Host connected');
          break;
        }

        case MSG.JOIN: {
          if (role) return;
          const resumed = typeof msg.token === 'string' && [...players.values()].find((p) => p.token === msg.token);
          if (resumed) {
            role = 'player';
            player = resumed;
            clearTimeout(player.leaveTimer);
            if (player.ws) player.ws.close(4002, 'Resumed on another connection');
            player.ws = ws;
            // the name or device may have changed since (e.g. page reloaded, another name typed)
            player.name = cleanName(msg.name) || player.name;
            if (DEVICES.includes(msg.device)) player.device = msg.device;
            send(ws, { type: MSG.WELCOME, ...publicPlayer(player), token: player.token, hostConnected: Boolean(host) });
            send(ws, currentPhase());
            send(host, { type: MSG.PLAYER_STATUS, id: player.id, connected: true, name: player.name, device: player.device });
            console.log(`Player ${player.id} reconnected: ${player.name}`);
            return;
          }
          if (players.size >= MAX_PLAYERS && !evictDropped()) {
            send(ws, { type: MSG.ERROR, code: 'lobby-full', message: `The game is full (${MAX_PLAYERS} players).` });
            ws.close(4001, 'Lobby full');
            return;
          }
          role = 'player';
          const id = nextId++;
          const device = DEVICES.includes(msg.device) ? msg.device : 'other';
          player = { id, name: cleanName(msg.name) || `Player ${id}`, color: freeColor(), device, token: randomUUID(), ws };
          players.set(id, player);
          send(ws, { type: MSG.WELCOME, ...publicPlayer(player), token: player.token, hostConnected: Boolean(host) });
          send(ws, currentPhase());
          send(host, { type: MSG.PLAYER_JOINED, player: publicPlayer(player) });
          console.log(`Player ${id} joined: ${player.name}`);
          break;
        }

        case MSG.TILT: {
          if (!player) return;
          const now = Date.now();
          if (now - tiltWindow >= 1000) {
            tiltWindow = now;
            tiltCount = 0;
          }
          if (++tiltCount > MAX_TILTS_PER_SECOND) return;
          const x = clampUnit(msg.x);
          const y = clampUnit(msg.y);
          if (x === null || y === null) return;
          send(host, { type: MSG.TILT, id: player.id, x, y });
          break;
        }

        case MSG.READY: {
          if (!player || typeof msg.ready !== 'boolean') return;
          send(host, { type: MSG.READY, id: player.id, ready: msg.ready });
          break;
        }

        case MSG.VOTE: {
          if (!player || typeof msg.game !== 'string' || !voteOptions()?.has(msg.game)) return;
          send(host, { type: MSG.VOTE, id: player.id, game: msg.game });
          break;
        }

        case MSG.DASH: {
          if (!player || Date.now() - lastDash < MIN_DASH_INTERVAL_MS) return;
          lastDash = Date.now();
          send(host, { type: MSG.DASH, id: player.id });
          break;
        }

        case MSG.PHASE: {
          if (role !== 'host' || typeof msg.phase !== 'string') return;
          phase = { msg, at: Date.now() };
          broadcastToPlayers(msg);
          break;
        }
      }
    });

    ws.on('close', () => {
      if (role === 'host' && host === ws) {
        host = null;
        broadcastToPlayers({ type: MSG.HOST_STATUS, connected: false });
        console.log('Host disconnected');
      } else if (player && player.ws === ws) {
        const p = player;
        p.ws = null;
        p.droppedAt = Date.now();
        send(host, { type: MSG.TILT, id: p.id, x: 0, y: 0 }); // don't keep rolling while gone
        send(host, { type: MSG.PLAYER_STATUS, id: p.id, connected: false });
        p.leaveTimer = setTimeout(() => removePlayer(p), RESUME_GRACE_MS);
      }
    });
  });

  // Phones that lock their screen often drop off without a clean close.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));
}

function cleanName(name) {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 16) : '';
}

function clampUnit(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : null;
}
