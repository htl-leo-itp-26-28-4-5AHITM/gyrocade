// English/German texts for the host screen and the web controller. Every device picks its own
// language: the browser language at first, then whatever was chosen with the EN/DE switch.

const STORAGE_KEY = 'gyrocade:lang';
export const LANGUAGES = ['en', 'de'];

const STRINGS = {
  en: {
    // host lobby
    'lobby.joinTitle': 'Join the game',
    'lobby.orType': 'or type in your browser',
    'lobby.wifi': 'Wi-Fi: {name}',
    'lobby.wifiGeneric': 'Connect to the same Wi-Fi as this laptop',
    'lobby.step1': 'Scan the code',
    'lobby.step2': 'Accept the security warning',
    'lobby.step3': 'Enter your name, tap Play',
    'lobby.players': 'Players',
    'lobby.readyCount': '{ready}/{total} ready',
    'lobby.freeSlot': 'Free',
    'lobby.ready': 'Ready',
    'lobby.notReady': 'Not ready',
    'lobby.reconnecting': 'Reconnecting…',
    'lobby.needPlayers': 'Waiting for {count} more players…',
    'lobby.needPlayers.one': 'Waiting for 1 more player…',
    'lobby.needReady': 'Everyone taps READY on their {device} to start',
    'lobby.countdown': 'Game starts in {seconds}…',
    'lobby.keys': '<kbd>Q</kbd> big QR&emsp;<kbd>L</kbd> panel&emsp;<kbd>F</kbd> fullscreen',
    'lobby.qrHint': 'Press Q to close',
    'lobby.stageHint': 'Scan the code on the right to join',
    'host.connecting': 'Connecting to server…',
    'host.reconnecting': 'Connection lost, reconnecting…',
    'host.replaced': 'Another host screen took over.',
    'host.countdownTitle': 'Everyone is ready!',
    'host.countdownSub': 'Game starts in',
    'game.keys': '<kbd>R</kbd> rematch &nbsp; <kbd>Space</kbd> back to lobby',
    // knockout arena
    'ko.round': 'Round {n}/{total}',
    'ko.suddenDeath': 'Sudden death',
    'ko.tie': 'Tie! Sudden death: {names}',
    'ko.fight': 'FIGHT!',
    'ko.shrinking': 'The platform is shrinking!',
    'ko.collapse': 'The platform is collapsing!',
    'ko.knockedOff': '{attacker} knocked off {victim}',
    'ko.fell': '{name} fell off',
    'ko.survivor': '{name} survives! +{points}',
    'ko.noSurvivor': 'Nobody survived!',
    'ko.winner': '{name} wins!',
    'ko.sharedWin': '{names} share the win!',
    'ko.roundResults': 'Round {n} results',
    'ko.finalResults': 'Final results',
    'ko.points': '{points} pts',
    // controller
    'ctrl.name': 'Your name',
    'ctrl.namePlaceholder': 'Player',
    'ctrl.play': 'Play',
    'ctrl.tilt': 'Tilt your {device} to move.',
    'ctrl.recalibrate': 'Recalibrate',
    'ctrl.dash': 'Dash',
    'ctrl.turn': 'Turn your {device} sideways',
    'ctrl.connecting': 'Connecting…',
    'ctrl.connected': 'Connected',
    'ctrl.waitingScreen': 'Waiting for screen…',
    'ctrl.reconnecting': 'Reconnecting…',
    'ctrl.ready': 'Ready',
    'ctrl.readyDone': 'Ready ✓',
    'ctrl.readyHint': 'Tap READY when you want to play.',
    'ctrl.readyWaiting': 'Waiting for the others…',
    'ctrl.countdown': 'Game starts in {seconds}…',
    'ctrl.inGame': 'Game on! Watch the big screen.',
    'ctrl.needHttps': 'This page must be opened via https:// for motion sensors to work.',
    'ctrl.noMotion': 'Motion access unavailable. Drag the pad to play, or close Safari completely and allow motion access.',
    'ctrl.noSensor': 'No motion sensor found on this {device}. Drag the pad to play.',
    'ctrl.lobbyFull': 'The game is full ({max} players).',
    'ctrl.joinFailed': 'Could not join the game. Please try again.',
    'ctrl.replaced': 'You joined from another tab or device.',
    // {device}
    'device.iphone': 'iPhone',
    'device.ipad': 'iPad',
    'device.phone': 'phone',
    'device.tablet': 'tablet',
    'device.other': 'device',
    'device.mixed': 'phone or tablet',
  },
  de: {
    'lobby.joinTitle': 'Mitspielen',
    'lobby.orType': 'oder im Browser eingeben',
    'lobby.wifi': 'WLAN: {name}',
    'lobby.wifiGeneric': 'Verbinde dich mit demselben WLAN wie dieser Laptop',
    'lobby.step1': 'Code scannen',
    'lobby.step2': 'Sicherheitswarnung akzeptieren',
    'lobby.step3': 'Namen eingeben, Spielen tippen',
    'lobby.players': 'Spieler',
    'lobby.readyCount': '{ready}/{total} bereit',
    'lobby.freeSlot': 'Frei',
    'lobby.ready': 'Bereit',
    'lobby.notReady': 'Nicht bereit',
    'lobby.reconnecting': 'Verbindet neu…',
    'lobby.needPlayers': 'Warte auf {count} weitere Spieler…',
    'lobby.needPlayers.one': 'Warte auf einen weiteren Spieler…',
    'lobby.needReady': 'Alle tippen am {device} auf BEREIT, um zu starten',
    'lobby.countdown': 'Spiel startet in {seconds}…',
    'lobby.keys': '<kbd>Q</kbd> großer QR&emsp;<kbd>L</kbd> Leiste&emsp;<kbd>F</kbd> Vollbild',
    'lobby.qrHint': 'Q zum Schließen',
    'lobby.stageHint': 'Scanne den Code rechts, um mitzuspielen',
    'host.connecting': 'Verbinde mit Server…',
    'host.reconnecting': 'Verbindung verloren, verbinde neu…',
    'host.replaced': 'Ein anderer Bildschirm hat übernommen.',
    'host.countdownTitle': 'Alle sind bereit!',
    'host.countdownSub': 'Spiel startet in',
    'game.keys': '<kbd>R</kbd> Revanche &nbsp; <kbd>Leertaste</kbd> zurück zur Lobby',
    'ko.round': 'Runde {n}/{total}',
    'ko.suddenDeath': 'Entscheidungsrunde',
    'ko.tie': 'Gleichstand! Entscheidungsrunde: {names}',
    'ko.fight': 'LOS!',
    'ko.shrinking': 'Die Plattform schrumpft!',
    'ko.collapse': 'Die Plattform zerfällt!',
    'ko.knockedOff': '{attacker} hat {victim} runtergestoßen',
    'ko.fell': '{name} ist runtergefallen',
    'ko.survivor': '{name} überlebt! +{points}',
    'ko.noSurvivor': 'Niemand hat überlebt!',
    'ko.winner': '{name} gewinnt!',
    'ko.sharedWin': '{names} teilen sich den Sieg!',
    'ko.roundResults': 'Ergebnis Runde {n}',
    'ko.finalResults': 'Endergebnis',
    'ko.points': '{points} Pkt.',
    'ctrl.name': 'Dein Name',
    'ctrl.namePlaceholder': 'Spieler',
    'ctrl.play': 'Spielen',
    'ctrl.tilt': 'Neige dein {device}, um dich zu bewegen.',
    'ctrl.recalibrate': 'Neu kalibrieren',
    'ctrl.dash': 'Dash',
    'ctrl.turn': 'Dreh dein {device} quer',
    'ctrl.connecting': 'Verbinde…',
    'ctrl.connected': 'Verbunden',
    'ctrl.waitingScreen': 'Warte auf Bildschirm…',
    'ctrl.reconnecting': 'Verbinde neu…',
    'ctrl.ready': 'Bereit',
    'ctrl.readyDone': 'Bereit ✓',
    'ctrl.readyHint': 'Tippe auf BEREIT, wenn du spielen willst.',
    'ctrl.readyWaiting': 'Warte auf die anderen…',
    'ctrl.countdown': 'Spiel startet in {seconds}…',
    'ctrl.inGame': 'Los geht’s! Schau auf den großen Bildschirm.',
    'ctrl.needHttps': 'Diese Seite muss über https:// geöffnet werden, damit die Bewegungssensoren funktionieren.',
    'ctrl.noMotion': 'Kein Zugriff auf Bewegungssensoren. Zieh das Steuerfeld zum Spielen, oder schließe Safari ganz und erlaube den Zugriff.',
    'ctrl.noSensor': 'Kein Bewegungssensor an diesem {device} gefunden. Zieh das Steuerfeld zum Spielen.',
    'ctrl.lobbyFull': 'Das Spiel ist voll ({max} Spieler).',
    'ctrl.joinFailed': 'Beitreten hat nicht geklappt. Bitte versuch es noch einmal.',
    'ctrl.replaced': 'Du bist auf einem anderen Tab oder Gerät beigetreten.',
    // {device}: all neuter, so "dein ..." / "am ..." fit every one
    'device.iphone': 'iPhone',
    'device.ipad': 'iPad',
    'device.phone': 'Handy',
    'device.tablet': 'Tablet',
    'device.other': 'Gerät',
    'device.mixed': 'Handy oder Tablet',
  },
};

const listeners = new Set();
let current = detectLanguage();
let ownDevice = null; // fills {device} when a text doesn't get one explicitly (controller)

function detectLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.includes(stored)) return stored;
  } catch {
    // storage blocked: fall through to the browser language
  }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export const getLanguage = () => current;

export function setLanguage(lang) {
  if (!LANGUAGES.includes(lang) || lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // not remembered, still switched
  }
  document.documentElement.lang = lang;
  translatePage();
  for (const listener of listeners) listener(lang);
}

// Returns a function that removes the listener again.
export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The controller's own device (see device.js), used for {device} in its texts.
export function setOwnDevice(device) {
  ownDevice = device;
  translatePage();
}

// Device word for {device}: a kind from device.js, or 'mixed'.
export const deviceWord = (device) => t(`device.${device}`);

// t('lobby.wifi', { name: 'HTL' }) -> 'Wi-Fi: HTL'
// With { count: 1 } a '<key>.one' text is used if there is one (singular).
export function t(key, vars = {}) {
  if (vars.count === 1 && `${key}.one` in STRINGS[current]) key = `${key}.one`;
  const text = STRINGS[current][key] ?? STRINGS.en[key] ?? key;
  if (ownDevice && !('device' in vars)) vars = { device: STRINGS[current][`device.${ownDevice}`], ...vars };
  return text.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
}

// Picks the current language from a { en, de } object (e.g. minigame names).
export const pick = (texts) => texts[current] ?? texts.en;

// Fills every element with data-i18n (text) or data-i18n-html (trusted markup from STRINGS),
// and data-i18n-placeholder.
export function translatePage(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
}

document.documentElement.lang = current;
