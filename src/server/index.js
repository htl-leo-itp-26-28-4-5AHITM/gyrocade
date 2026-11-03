import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { loadOrCreateCert } from './cert.js';
import { attachGameServer } from './game-server.js';
import { getLanAddresses } from './network.js';
import { qrSvg as makeQrSvg } from './qr.js';
import { startTunnel, viaTunnel } from './tunnel.js';
import { getWifiName } from './wifi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3443;
const MOBILE = /iPhone|iPad|Android|Mobile/i;
// npm run online: also reachable from the internet through a Cloudflare tunnel
const ONLINE = process.argv.includes('--online') || /^(1|true|yes)$/i.test(process.env.ONLINE ?? '');

const lanAddresses = getLanAddresses();
const hostIp = process.env.HOST_IP || lanAddresses[0] || 'localhost';
const lanAddress = `${hostIp}:${PORT}`; // what players type by hand: http + / are handled below

// What the lobby shows. Online, the public address replaces the LAN one as soon as the tunnel is up.
let join;
function setJoinAddress(origin, typeAddress) {
  const joinUrl = `${origin}/play`;
  join = { joinUrl, typeAddress, qrSvg: makeQrSvg(joinUrl) };
}
setJoinAddress(`https://${lanAddress}`, lanAddress);
let online = ONLINE ? 'starting' : null; // null | 'starting' | 'up' | 'down'

const app = express();
app.get('/', (req, res) => {
  // A phone that typed the bare address wants the controller, not the host screen. Visitors from
  // the internet are always players: only the laptop itself shows the host screen.
  if (viaTunnel(req) || MOBILE.test(req.get('user-agent') ?? '')) return res.redirect('/play');
  res.sendFile(path.join(PUBLIC, 'host', 'index.html'));
});
app.get('/play', (_req, res) => res.sendFile(path.join(PUBLIC, 'controller', 'index.html')));
app.get('/api/info', async (req, res) => {
  // only for the host screen: no LAN address or Wi-Fi name for the internet
  if (viaTunnel(req)) return res.sendStatus(404);
  res.json({ ...join, online, wifi: online === 'up' ? null : await getWifiName() });
});
app.use(express.static(PUBLIC));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three')));
// self-hosted fonts: the game must work without internet (school Wi-Fi, phone hotspot)
app.use('/vendor/fonts', express.static(path.join(ROOT, 'node_modules', '@fontsource')));

const certHosts = [...new Set(['localhost', '127.0.0.1', hostIp, ...lanAddresses])];
const { key, cert } = loadOrCreateCert(path.join(ROOT, 'certs'), certHosts);
const httpsServer = https.createServer({ key, cert }, app);
attachGameServer(new WebSocketServer({ server: httpsServer, path: '/ws', maxPayload: 16 * 1024 }), {
  canHost: (req) => !viaTunnel(req), // nobody on the internet can take over the host screen
});

// Browsers default to http:// when an address is typed by hand. Both protocols share one port:
// a TLS connection starts with byte 0x16, anything else gets redirected to https.
// Only a plain host[:port] is echoed back, anything odd in the Host header falls back to our address.
const SAFE_HOST = /^[\w.-]+(:\d{1,5})?$|^\[[\da-f:.]+\](:\d{1,5})?$/i;
const redirectServer = http.createServer((req, res) => {
  const target = SAFE_HOST.test(req.headers.host ?? '') ? req.headers.host : lanAddress;
  res.writeHead(301, { Location: `https://${target}${req.url}` });
  res.end();
});

const server = net.createServer((socket) => {
  const idle = () => socket.destroy(); // connections that never send anything
  socket.setTimeout(10_000, idle);
  socket.once('data', (chunk) => {
    socket.setTimeout(0); // from here on the HTTP(S) server handles timeouts
    socket.off('timeout', idle);
    socket.pause();
    socket.unshift(chunk);
    (chunk[0] === 0x16 ? httpsServer : redirectServer).emit('connection', socket);
    process.nextTick(() => socket.resume());
  });
  socket.on('error', () => {}); // clients vanishing mid-handshake are not our problem
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Is Gyrocade already running? Stop it or start with PORT=<other port>.\n`);
  } else {
    console.error(`\n  Server error: ${error.message}\n`);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log('\n  GYROCADE server running\n');
  console.log(`  Host screen:  https://localhost:${PORT}`);
  console.log(`  Controllers:  scan the QR code or type ${lanAddress}`);
  if (lanAddresses.length > 1) console.log(`  Other IPs:    ${lanAddresses.slice(1).join(', ')}  (set HOST_IP to switch)`);
  console.log('\n  The certificate is self-signed: accept the browser warning once on each device.\n');
  if (!ONLINE) return;
  console.log('  Going online…');
  startTunnel(PORT, {
    onUrl(url) {
      online = 'up';
      setJoinAddress(url, new URL(url).host);
      console.log(`\n  ONLINE: friends anywhere join at ${join.joinUrl}`);
      console.log('  Share your screen (e.g. on Discord) so they can watch.\n');
    },
    onDown() {
      // LAN players keep playing; the lobby shows the local address until the tunnel is back
      online = 'down';
      setJoinAddress(`https://${lanAddress}`, lanAddress);
    },
  });
});
