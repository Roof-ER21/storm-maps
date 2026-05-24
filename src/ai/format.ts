/**
 * Presentation helpers for the AI drawer — turn raw backend identifiers and
 * argument payloads into human-readable text. Pure functions, no deps.
 */

/** snake_case / camelCase tool id → human label. "append_note" → "Append note". */
export function humanizeTool(tool: string): string {
  const spaced = tool
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!spaced) return tool;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Arg key → label. "carrier_slug" → "Carrier slug". */
export function humanizeKey(key: string): string {
  return humanizeTool(key);
}

/** Render an arg value compactly for inline display next to its key. */
export function formatArgValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '""' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** True for object/array values that read better in a monospace font. */
export function isStructured(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}
