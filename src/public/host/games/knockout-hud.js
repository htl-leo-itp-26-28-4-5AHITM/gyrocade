import { onLanguageChange, t, translatePage } from '/shared/i18n.js';
import { avatar, ordinal } from './race-hud.js';

// DOM overlay for the Knockout Arena: round label, live scoreboard, knockout feed,
// announcements and the results table. Reuses the race HUD styles (announcements, panels).

const FEED_SECONDS = 4;
const FEED_MAX = 4;

export function createKnockoutHud(stage) {
  const root = document.createElement('div');
  root.className = 'race-hud';
  root.innerHTML = `
    <div class="ko-round"></div>
    <ol class="race-standings ko-scores"></ol>
    <div class="race-center"></div>
    <ul class="ko-feed"></ul>
    <div class="race-results" hidden>
      <h2></h2>
      <ol></ol>
      <p class="keys" data-i18n-html="race.keys" hidden></p>
    </div>`;
  translatePage(root);
  stage.appendChild(root);

  const round = root.querySelector('.ko-round');
  const scores = root.querySelector('.ko-scores');
  const center = root.querySelector('.race-center');
  const feed = root.querySelector('.ko-feed');
  const results = root.querySelector('.race-results');
  const resultsTitle = results.querySelector('h2');
  const resultsList = results.querySelector('ol');
  const keys = results.querySelector('.keys');

  // Texts are kept as [key, vars] so a language switch can redraw them.
  let roundText = null;
  let resultsText = null;
  let lastScores = [];
  let lastResults = [];
  let scoresKey = '';

  const offLanguage = onLanguageChange(() => {
    renderRound();
    renderScores(lastScores);
    if (resultsText) renderResults();
  });

  function renderRound() {
    round.textContent = roundText ? t(...roundText) : '';
  }

  function renderScores(rows) {
    scores.replaceChildren(
      ...rows.map((row, i) => {
        const li = line(row.player, ordinal(i + 1), [
          ['name', row.player.name],
          ['time', t('ko.points', { points: row.points })],
        ]);
        li.classList.toggle('out', row.out);
        return li;
      }),
    );
  }

  function renderResults() {
    resultsTitle.textContent = t(...resultsText);
    resultsList.replaceChildren(
      ...lastResults.map((row, i) =>
        line(row.player, ordinal(i + 1), [
          ['name', row.player.name],
          ['gain', row.gain > 0 ? `+${row.gain}` : ''],
          ['time', t('ko.points', { points: row.points })],
        ]),
      ),
    );
  }

  return {
    setRound(key, vars) {
      roundText = [key, vars];
      renderRound();
    },

    // rows: [{ player, points, out }], best first
    setScores(rows) {
      const key = rows.map((r) => `${r.player.id}:${r.player.name}:${r.points}:${r.out}`).join();
      if (key === scoresKey) return;
      scoresKey = key;
      lastScores = rows;
      renderScores(rows);
    },

    announce(text, { className = '', color = '' } = {}) {
      const element = document.createElement('div');
      element.className = `race-announce ${className}`;
      element.textContent = text;
      if (color) element.style.setProperty('--glow', color);
      center.replaceChildren(element);
    },

    // One line in the knockout feed, e.g. "Anna knocked off Ben".
    log(text, color) {
      const item = document.createElement('li');
      item.textContent = text;
      item.style.setProperty('--color', color);
      feed.prepend(item);
      while (feed.children.length > FEED_MAX) feed.lastChild.remove();
      setTimeout(() => item.remove(), FEED_SECONDS * 1000);
    },

    // rows: [{ player, gain, points }], best first. final: show the rematch / lobby keys.
    showResults(titleKey, titleVars, rows, final) {
      resultsText = [titleKey, titleVars];
      lastResults = rows;
      keys.hidden = !final;
      renderResults();
      results.hidden = false;
    },

    hideResults() {
      resultsText = null;
      results.hidden = true;
    },

    dispose() {
      offLanguage();
      root.remove();
    },
  };
}

function line(player, place, cells) {
  const li = document.createElement('li');
  li.style.setProperty('--color', player.color);
  const pos = document.createElement('span');
  pos.className = 'pos';
  pos.textContent = place;
  li.append(pos, avatar(player));
  for (const [className, text] of cells) {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    li.append(span);
  }
  return li;
}
