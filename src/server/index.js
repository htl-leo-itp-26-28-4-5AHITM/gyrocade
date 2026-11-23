import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { loadOrCreateCert } from './cert.js';
import { attachGameServer } from './game-server.js';
import { getLanAddresses } from './network.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3443;
const MOBILE = /iPhone|iPad|Android|Mobile/i;

const lanAddresses = getLanAddresses();
const hostIp = process.env.HOST_IP || lanAddresses[0] || 'localhost';
const playUrl = `https://${hostIp}:${PORT}/play`;

const app = express();
app.get('/', (req, res) => {
  // A phone that typed the bare address wants the controller, not the host screen.
  if (MOBILE.test(req.get('user-agent') ?? '')) return res.redirect('/play');
  res.sendFile(path.join(PUBLIC, 'host', 'index.html'));
});
app.get('/play', (_req, res) => res.sendFile(path.join(PUBLIC, 'controller', 'index.html')));
app.get('/api/info', (_req, res) => res.json({ playUrl }));
app.use(express.static(PUBLIC));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three')));

const certHosts = [...new Set(['localhost', '127.0.0.1', hostIp, ...lanAddresses])];
const { key, cert } = loadOrCreateCert(path.join(ROOT, 'certs'), certHosts);
const server = https.createServer({ key, cert }, app);
attachGameServer(new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 }));

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
  console.log(`  Phone:        ${playUrl}`);
  if (lanAddresses.length > 1) console.log(`  Other IPs:    ${lanAddresses.slice(1).join(', ')}  (set HOST_IP to switch)`);
  console.log('\n  The certificate is self-signed: accept the browser warning once on each device.\n');
});
