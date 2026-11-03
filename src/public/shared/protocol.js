// Network protocol shared by server, host page and web controller.
// The Swift controller app must speak the same JSON messages (see README).

export const MSG = {
  // host -> server
  HOST_HELLO: 'host:hello', // { phase? }  a reconnecting host page sends its current phase message
  // server -> host
  LOBBY: 'lobby', // { players: [{ id, name, color, device, connected }] }
  PLAYER_JOINED: 'player:joined', // { player: { id, name, color, device, connected } }
  PLAYER_LEFT: 'player:left', // { id }
  PLAYER_STATUS: 'player:status', // { id, connected, name?, device? }  phone dropped / came back within the grace time

  // controller -> server
  JOIN: 'join', // { name, token?, device? }  token resumes an earlier player; device: iphone|ipad|phone|tablet|other
  // server -> controller
  WELCOME: 'welcome', // { id, name, color, token, hostConnected }
  HOST_STATUS: 'host:status', // { connected }
  ERROR: 'error', // { code, message }

  // controller -> server: { x, y }
  // server -> host:       { id, x, y }
  // x: -1 (left) .. 1 (right), y: -1 (back/down) .. 1 (forward/up)
  TILT: 'tilt',

  // controller -> server: { ready }      server -> host: { id, ready }
  READY: 'ready',
  // controller -> server: { game }       server -> host: { id, game }
  VOTE: 'vote',
  // controller -> server: {}             server -> host: { id }
  // only while the running game lists 'dash' in its controls (see PHASE game)
  DASH: 'dash',
  // host -> server -> every controller (also sent to phones that join later):
  //   { phase: 'lobby' }                          show the READY button
  //   { phase: 'countdown', seconds }             everyone is ready, vote starts soon
  //   { phase: 'vote', seconds, options: [{ id, name: { en, de } }] }
  //   { phase: 'game', game, controls: [] }       a minigame is running; controls: extra buttons
  //                                               the phone shows, e.g. ['dash']
  PHASE: 'phase',
};

export const PHASE = {
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  VOTE: 'vote',
  GAME: 'game',
};

export const MAX_PLAYERS = 8;
export const READY_COUNTDOWN_SECONDS = 5;
export const VOTE_SECONDS = 15;
export const DASH_COOLDOWN_SECONDS = 2; // the phone greys out DASH this long after a tap

export const PLAYER_COLORS = [
  '#00f0ff', // cyan
  '#ff2bd6', // magenta
  '#fff200', // yellow
  '#39ff14', // lime
  '#ff8a00', // orange
  '#a855ff', // purple
  '#ff3355', // red
  '#2f7bff', // blue
];
