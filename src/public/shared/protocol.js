// Network protocol shared by server, host page and web controller (Sprint 1: tilt only).

export const MSG = {
  // host -> server
  HOST_HELLO: 'host:hello', // {}
  // server -> host
  PLAYER_JOINED: 'player:joined', // { player: { id, name, color } }
  PLAYER_LEFT: 'player:left', // { id }

  // controller -> server
  JOIN: 'join', // { name }
  // server -> controller
  WELCOME: 'welcome', // { id, name, color }

  // controller -> server: { x, y }
  // server -> host:       { id, x, y }
  // x: -1 (left) .. 1 (right), y: -1 (back/down) .. 1 (forward/up)
  TILT: 'tilt',
};

export const PLAYER_COLORS = ['#00f0ff', '#ff2bd6', '#fff200', '#39ff14'];
