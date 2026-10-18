/**
 * Shared visual tokens. Cream/dark-ink/gold/brown is the design direction;
 * every essential meaning is also carried by text markers (`>`, `•`, `[x]`),
 * so all screens stay readable without color.
 */
export const palette = {
  /** Warm off-white for primary text. */
  cream: '#F5ECD8',
  /** Muted parchment for hints and secondary text. */
  parchment: '#CFC6B4',
  /** Gold for focus and committed selections. */
  gold: '#D9A441',
  /** Brown for borders and quiet chrome. */
  brown: '#8A6D3B',
  /** Deep red-brown for errors (always paired with a text prefix). */
  clay: '#C05746',
  /** Green-brown for success (always paired with a text prefix). */
  moss: '#7A8B3F',
} as const;

export const FOCUS_MARKER = '>';
export const IDLE_MARKER = ' ';
export const COMMITTED_MARKER = '•';
export const CHECKED_MARKER = '[x]';
export const UNCHECKED_MARKER = '[ ]';

export const STEP_TITLES: Record<string, string> = {
  directory: 'Step 1 of 4 — Installation directory',
  agents: 'Step 2 of 4 — Agents and models',
  instructions: 'Step 3 of 4 — Personal instructions',
  review: 'Step 4 of 4 — Review and install',
};

export function headerTitle(step: string): string {
  return `Toady — ${STEP_TITLES[step] ?? step}`;
}
