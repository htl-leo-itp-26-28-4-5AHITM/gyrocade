import { createKnockout } from './knockout.js';

// The minigame that starts once everyone in the lobby is ready (Sprint 2: only one game,
// game selection comes in Sprint 3).
// `controls` lists extra phone buttons the game uses (only 'dash' exists so far).
export const FIRST_GAME = {
  id: 'knockout',
  name: { en: 'Knockout Arena', de: 'K.-o.-Arena' },
  minPlayers: 2,
  controls: ['dash'],
  create: createKnockout,
};

export const MIN_PLAYERS_TO_START = FIRST_GAME.minPlayers;
