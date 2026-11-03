import { createKnockout } from './knockout.js';
import { createRace } from './race.js';

// Minigames players can vote for in the lobby. To add one, add an entry here.
// `name`/`description` are { en, de }; `art` is a 16:9 inline SVG shown on the vote card.
// `controls` lists extra phone buttons the game uses (only 'dash' exists so far).
export const MINIGAMES = [
  {
    id: 'race',
    name: { en: 'Neon Race', de: 'Neon-Rennen' },
    description: {
      en: 'Tilt forward to roll, steer around obstacles. First ball over the finish line wins.',
      de: 'Nach vorne neigen zum Rollen, Hindernissen ausweichen. Wer zuerst im Ziel ist, gewinnt.',
    },
    minPlayers: 2,
    create: createRace,
    art: `
      <svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="race-sun" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff36b" />
            <stop offset="1" stop-color="#ff2bd6" />
          </linearGradient>
        </defs>
        <circle cx="80" cy="34" r="18" fill="url(#race-sun)" />
        <path d="M0 44 L22 30 L40 40 L58 26 L80 44 L104 28 L124 40 L142 30 L160 42 V48 H0 Z" fill="#0b0216" stroke="#a855ff" stroke-width="0.8" />
        <path d="M74 46 Q64 62 40 90 H120 Q96 62 86 46 Z" fill="#0b0820" />
        <path d="M74 46 Q64 62 40 90" fill="none" stroke="#00f0ff" stroke-width="2" />
        <path d="M86 46 Q96 62 120 90" fill="none" stroke="#ff2bd6" stroke-width="2" />
        <path d="M80 50 V56 M80 62 V70 M80 77 V88" stroke="#fff" stroke-width="1" opacity="0.6" />
        <circle cx="70" cy="74" r="5" fill="#39ff14" />
        <circle cx="90" cy="66" r="4" fill="#fff200" />
      </svg>`,
  },
  {
    id: 'knockout',
    name: { en: 'Knockout Arena', de: 'K.-o.-Arena' },
    description: {
      en: 'Push the others off the shrinking platform, tap DASH to ram. +1 per knockout, +2 for the last one standing. 4 rounds.',
      de: 'Schubs die anderen von der schrumpfenden Plattform, tippe DASH zum Rammen. +1 pro K.-o., +2 für den Letzten. 4 Runden.',
    },
    minPlayers: 2,
    controls: ['dash'],
    create: createKnockout,
    art: `
      <svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="80" cy="58" rx="56" ry="20" fill="#0b0820" stroke="#00f0ff" stroke-width="2.5" />
        <ellipse cx="80" cy="58" rx="40" ry="14" fill="none" stroke="#3a1f6e" stroke-width="1" />
        <circle cx="62" cy="52" r="7" fill="#ff2bd6" />
        <path d="M70 50 L84 47" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity="0.8" />
        <circle cx="93" cy="47" r="7" fill="#39ff14" />
        <circle cx="140" cy="72" r="6" fill="#fff200" opacity="0.85" />
        <path d="M128 60 Q134 62 138 66" fill="none" stroke="#fff200" stroke-width="1.2" stroke-dasharray="2 2" />
        <path d="M84 40 l3 -6 M93 37 v-7 M101 40 l4 -5" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" />
      </svg>`,
  },
];

export const MIN_PLAYERS_TO_START = Math.min(...MINIGAMES.map((g) => g.minPlayers));
