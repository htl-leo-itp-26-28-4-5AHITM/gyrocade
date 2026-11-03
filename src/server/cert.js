import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import selfsigned from 'selfsigned';

// iOS only exposes the gyroscope to pages in a secure context, so the server needs HTTPS.
// If certs/key.pem + certs/cert.pem exist without hosts.json (e.g. created with mkcert),
// they are used as-is. Otherwise a self-signed certificate is generated and regenerated
// whenever the laptop's IP address changes or it is about to expire.
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

export function loadOrCreateCert(dir, hosts) {
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  const metaPath = path.join(dir, 'hosts.json');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const generated = fs.existsSync(metaPath);
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    const expiresAt = certExpiry(cert);
    if (!generated) {
      if (expiresAt !== null && expiresAt < Date.now()) {
        console.warn('  Warning: the certificate in certs/ has expired. Create a new one (e.g. with mkcert).');
      }
      return { key, cert, selfSigned: false };
    }
    const fresh = expiresAt !== null && expiresAt - Date.now() > RENEW_BEFORE_MS;
    if (fresh && sameHostList(readHosts(metaPath), hosts)) return { key, cert, selfSigned: true };
  }

  const pems = selfsigned.generate([{ name: 'commonName', value: 'Gyrocade Dev' }], {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true }, // required by iOS
      {
        name: 'subjectAltName',
        altNames: hosts.map((h) => (net.isIP(h) ? { type: 7, ip: h } : { type: 2, value: h })),
      },
    ],
  });

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(metaPath, JSON.stringify(hosts));
  return { key: pems.private, cert: pems.cert, selfSigned: true };
}

// null if hosts.json is unreadable or corrupt: then the certificate is simply generated again.
function readHosts(metaPath) {
  try {
    const hosts = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return Array.isArray(hosts) ? hosts : null;
  } catch {
    return null;
  }
}

function sameHostList(a, b) {
  if (!a) return false;
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((h) => set.has(h));
}

// Expiry time in ms, null if the certificate can't be parsed.
function certExpiry(pem) {
  try {
    return Date.parse(new X509Certificate(pem).validTo);
  } catch {
    return null;
  }
}
