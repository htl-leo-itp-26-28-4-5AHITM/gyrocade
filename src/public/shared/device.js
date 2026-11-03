// What kind of device the controller runs on, so texts can say "iPad" instead of "phone".
// Also sent in `join` so the host can address the players correctly.
export const DEVICES = ['iphone', 'ipad', 'phone', 'tablet', 'other'];

export function detectDevice() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iphone';
  // iPadOS Safari claims to be a Mac; Macs have no touchscreen
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'phone' : 'tablet';
  if (/Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Phone/i.test(ua)) return 'phone';
  return 'other';
}

export const isTablet = (device) => device === 'ipad' || device === 'tablet';
export const isPhone = (device) => device === 'iphone' || device === 'phone';
