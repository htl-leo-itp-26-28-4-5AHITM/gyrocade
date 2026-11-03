import { execFile } from 'node:child_process';

const COMMANDS = {
  // "    SSID                   : HTL-Guest" (the key is not translated on German Windows either)
  win32: ['netsh', ['wlan', 'show', 'interfaces'], /^\s*SSID\s*:\s*(.+?)\s*$/m],
  // "Current Wi-Fi Network: HTL-Guest"
  darwin: ['networksetup', ['-getairportnetwork', 'en0'], /Network:\s*(.+?)\s*$/m],
  linux: ['iwgetid', ['-r'], /^(.+?)\s*$/m],
};
const CACHE_MS = 15_000;

let cached = { name: null, at: 0 };

// Name of the Wi-Fi the laptop is on, or null (LAN cable, hotspot without Wi-Fi, no permission, ...).
// Shown in the lobby so players know which network to join.
export async function getWifiName() {
  if (Date.now() - cached.at < CACHE_MS) return cached.name;
  cached = { name: await detect(), at: Date.now() };
  return cached.name;
}

function detect() {
  const command = COMMANDS[process.platform];
  if (!command) return Promise.resolve(null);
  const [file, args, pattern] = command;
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 3000, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : (pattern.exec(stdout)?.[1] ?? null));
    });
  });
}
