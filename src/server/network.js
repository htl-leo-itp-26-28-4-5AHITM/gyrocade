import os from 'node:os';

const VIRTUAL_ADAPTER = /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|loopback|tailscale|zerotier/i;

// Returns the laptop's IPv4 addresses in the local network, most likely candidate first.
export function getLanAddresses() {
  const candidates = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      candidates.push({ address: info.address, score: score(name, info.address) });
    }
  }
  return candidates.sort((a, b) => b.score - a.score).map((c) => c.address);
}

function score(name, address) {
  let s = 0;
  if (!VIRTUAL_ADAPTER.test(name)) s += 10;
  if (/wi-?fi|wlan|wireless/i.test(name)) s += 2;
  if (address.startsWith('192.168.')) s += 3;
  else if (address.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(address)) s += 2;
  if (address.startsWith('169.254.')) s -= 20; // link-local, no DHCP
  return s;
}
