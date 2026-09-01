export type Command = 'up' | 'down' | 'left' | 'right' | 'quit' | 'restart' | 'invalid';

const UP_KEYS = new Set(['w', 'W', '\u001b[A', 'ArrowUp', 'up', 'k']);
const DOWN_KEYS = new Set(['s', 'S', '\u001b[B', 'ArrowDown', 'down', 'j']);
const LEFT_KEYS = new Set(['a', 'A', '\u001b[D', 'ArrowLeft', 'left', 'h']);
const RIGHT_KEYS = new Set(['d', 'D', '\u001b[C', 'ArrowRight', 'right', 'l']);
const QUIT_KEYS = new Set(['q', 'Q', 'x', 'X']);
const RESTART_KEYS = new Set(['r', 'R']);

export function normalizeKey(key: string): Command {
  if (UP_KEYS.has(key)) return 'up';
  if (DOWN_KEYS.has(key)) return 'down';
  if (LEFT_KEYS.has(key)) return 'left';
  if (RIGHT_KEYS.has(key)) return 'right';
  if (QUIT_KEYS.has(key)) return 'quit';
  if (RESTART_KEYS.has(key)) return 'restart';
  return 'invalid';
}

export function directionToCommand(direction: 'up' | 'down' | 'left' | 'right'): Command {
  return direction;
}
