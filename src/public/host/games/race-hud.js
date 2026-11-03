import { getLanguage, onLanguageChange, t, translatePage } from '/shared/i18n.js';

// DOM overlay for the race: timer, live standings, progress bar, announcements and results.

const ORDINALS = ['1st', '2nd', '3rd'];
export const ordinal = (n) => (getLanguage() === 'de' ? `${n}.` : (ORDINALS[n - 1] ?? `${n}th`));

export function createHud(stage) {
  const root = document.createElement('div');
  root.className = 'race-hud';
  root.innerHTML = `
    <div class="race-timer">0:00.00</div>
    <ol class="race-standings"></ol>
    <div class="race-center"></div>
    <div class="race-progress"></div>
    <div class="race-results" hidden>
      <h2 data-i18n="race.results"></h2>
      <ol></ol>
      <p class="keys" data-i18n-html="race.keys"></p>
    </div>`;
  translatePage(root);
  stage.appendChild(root);

  const timer = root.querySelector('.race-timer');
  const standings = root.querySelector('.race-standings');
  const center = root.querySelector('.race-center');
  const progress = root.querySelector('.race-progress');
  const results = root.querySelector('.race-results');
  const dots = new Map(); // player id -> progress bar dot
  let standingsKey = '';
  let lastStandings = [];
  let lastResults = null;

  // Static texts are re-translated by translatePage; the ordinals in the lists are redrawn here.
  const offLanguage = onLanguageChange(() => {
    standings.replaceChildren(...lastStandings.map((r, i) => row(r, i + 1, false)));
    if (lastResults) results.querySelector('ol').replaceChildren(...lastResults.map((r, i) => row(r, i + 1, true)));
  });

  return {
    setTime(seconds) {
      timer.textContent = formatTime(seconds);
    },

    announce(text, { className = '', color = '' } = {}) {
      const element = document.createElement('div');
      element.className = `race-announce ${className}`;
      element.textContent = text;
      if (color) element.style.setProperty('--glow', color);
      center.replaceChildren(element);
    },

    addRacer(racer) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.setProperty('--color', racer.player.color);
      progress.append(dot);
      dots.set(racer.player.id, dot);
    },

    removeRacer(id) {
      dots.get(id)?.remove();
      dots.delete(id);
    },

    setProgress(id, fraction) {
      const dot = dots.get(id);
      if (dot) dot.style.left = `${fraction * 100}%`;
    },

    setStandings(order) {
      const key = order.map((r) => `${r.player.id}:${r.player.name}:${r.time}`).join();
      if (key === standingsKey) return;
      standingsKey = key;
      lastStandings = [...order];
      standings.replaceChildren(...order.map((r, i) => row(r, i + 1, false)));
    },

    showResults(order) {
      lastResults = [...order];
      results.querySelector('ol').replaceChildren(...order.map((r, i) => row(r, i + 1, true)));
      results.hidden = false;
    },

    dispose() {
      offLanguage();
      root.remove();
    },
  };
}

// The player's ball, flat: shared by the race and Knockout Arena standings.
export function avatar(player) {
  const element = document.createElement('span');
  element.className = 'avatar';
  element.style.setProperty('--color', player.color);
  element.textContent = [...player.name.trim()][0]?.toUpperCase() ?? '?';
  return element;
}

function row(racer, position, final) {
  const li = document.createElement('li');
  li.style.setProperty('--color', racer.player.color);
  const pos = document.createElement('span');
  pos.className = 'pos';
  pos.textContent = ordinal(position);
  li.append(pos);
  const time = racer.time !== null ? formatTime(racer.time) : final ? t('race.dnf') : '';
  li.append(avatar(racer.player));
  for (const [className, text] of [
    ['name', racer.player.name],
    ['time', time],
  ]) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    li.append(span);
  }
  return li;
}

function formatTime(seconds) {
  const t = Math.max(0, seconds);
  const minutes = Math.floor(t / 60);
  return `${minutes}:${(t % 60).toFixed(2).padStart(5, '0')}`;
}
