import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { loadOrCreateCert } from './cert.js';
import { getLanAddresses } from './network.js';
import { MSG, PLAYER_COLORS } from '../public/shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3443;
const MOBILE = /iPhone|iPad|Android|Mobile/i;

const lanAddresses = getLanAddresses();
const hostIp = process.env.HOST_IP || lanAddresses[0] || 'localhost';
const playUrl = `https://${hostIp}:${PORT}/play`;

const app = express();
app.get('/', (req, res) => {
  // a phone that opened the bare address wants the controller, not the host screen
  if (MOBILE.test(req.get('user-agent') ?? '')) return res.redirect('/play');
  res.sendFile(path.join(PUBLIC, 'host', 'index.html'));
});
app.get('/play', (_req, res) => res.sendFile(path.join(PUBLIC, 'controller', 'index.html')));
app.get('/api/info', (_req, res) => res.json({ playUrl }));
app.use(express.static(PUBLIC));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three')));

// iOS only gives a page access to the gyroscope over HTTPS, so even the proof of concept needs it.
const certHosts = [...new Set(['localhost', '127.0.0.1', hostIp, ...lanAddresses])];
const { key, cert } = loadOrCreateCert(path.join(ROOT, 'certs'), certHosts);
const server = https.createServer({ key, cert }, app);

// --- WebSocket: relays tilt from the phones to the host screen ------------------

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
let host = null;
const players = new Map(); // id -> { id, name, color, ws }
let nextId = 1;

const send = (ws, msg) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};
const publicPlayer = ({ id, name, color }) => ({ id, name, color });

wss.on('connection', (ws) => {
  let player = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case MSG.HOST_HELLO:
        if (host) host.close(4000, 'Replaced by a new host');
        host = ws;
        for (const p of players.values()) send(host, { type: MSG.PLAYER_JOINED, player: publicPlayer(p) });
        console.log('Host connected');
        break;

      case MSG.JOIN: {
        if (player) return;
        const id = nextId++;
        const name = typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim().slice(0, 16) : `Player ${id}`;
        player = { id, name, color: PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length], ws };
        players.set(id, player);
        send(ws, { type: MSG.WELCOME, ...publicPlayer(player) });
        send(host, { type: MSG.PLAYER_JOINED, player: publicPlayer(player) });
        console.log(`Player ${id} joined: ${name}`);
        break;
      }

      case MSG.TILT: {
        if (!player) return;
        const x = clampUnit(msg.x);
        const y = clampUnit(msg.y);
        if (x === null || y === null) return;
        send(host, { type: MSG.TILT, id: player.id, x, y });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws === host) {
      host = null;
      console.log('Host disconnected');
    } else if (player) {
      players.delete(player.id);
      send(host, { type: MSG.PLAYER_LEFT, id: player.id });
      console.log(`Player ${player.id} left: ${player.name}`);
    }
  });
});

function clampUnit(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : null;
}

server.on('error', (error) => {
  console.error(`\n  Server error: ${error.message}\n`);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log('\n  GYROCADE proof of concept\n');
  console.log(`  Host screen:  https://localhost:${PORT}`);
  console.log(`  Phone:        ${playUrl}`);
  if (lanAddresses.length > 1) console.log(`  Other IPs:    ${lanAddresses.slice(1).join(', ')}  (set HOST_IP to switch)`);
  console.log('\n  The certificate is self-signed: accept the browser warning once on each device.\n');
});
