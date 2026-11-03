import fs from 'node:fs';
import cloudflared from 'cloudflared';

const RETRY_MS = [5_000, 15_000, 60_000]; // then every minute

// Online mode: a Cloudflare quick tunnel (free, no account) gives the laptop a public
// https://<random>.trycloudflare.com address with a real certificate, so friends anywhere can join.
// Calls onUrl with the public origin whenever a tunnel comes up (a restarted tunnel gets a new
// address) and onDown when it is lost.
export function startTunnel(port, { onUrl, onDown }) {
  let attempt = 0;
  let current = null;
  let stopped = false;

  async function open() {
    if (!fs.existsSync(cloudflared.bin)) {
      // npm may skip the package's install script: fetch the binary on first use instead
      console.log('  Downloading cloudflared (one time)…');
      try {
        await cloudflared.install(cloudflared.bin);
      } catch (error) {
        console.error(`  Could not download cloudflared: ${error.message}`);
        return retry();
      }
    }
    // The tunnel talks to our HTTPS port; the self-signed certificate is fine for that hop.
    current = cloudflared.Tunnel.quick(`https://localhost:${port}`, { '--no-tls-verify': true });
    current.once('url', (url) => {
      attempt = 0;
      onUrl(url);
    });
    current.on('error', (error) => console.error(`  Tunnel error: ${error.message}`));
    current.once('exit', () => {
      current = null;
      if (stopped) return;
      onDown();
      retry();
    });
  }

  function retry() {
    const delay = RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)];
    console.warn(`  Online tunnel lost, retrying in ${delay / 1000} s…`);
    setTimeout(() => !stopped && open(), delay);
  }

  open();
  const stop = () => {
    stopped = true;
    current?.stop();
  };
  // don't leave a cloudflared process behind when the server stops
  process.once('exit', stop);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      stop();
      process.exit(0);
    });
  }
  return { stop };
}

// Requests that came in through the tunnel. Cloudflare's edge always sets this header and
// overwrites any value a client sends, so it can't be faked from outside; direct LAN or
// localhost connections never have it.
export function viaTunnel(req) {
  return typeof req.headers['cf-connecting-ip'] === 'string';
}
