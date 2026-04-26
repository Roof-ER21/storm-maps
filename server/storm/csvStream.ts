/**
 * Minimal streaming CSV parser tailored to NCEI Storm Events files.
 *
 * Why inline rather than `csv-parse`: keeps the dep tree thin (no new
 * package, no Railway rebuild needed for a deploy). NCEI rows occasionally
 * carry embedded newlines inside quoted EVENT_NARRATIVE / EPISODE_NARRATIVE
 * fields, so this parser tracks quote state at the character level — naive
 * line-splitting would corrupt those rows.
 *
 * Behavior:
 *   - Yields header as the first row.
 *   - Quoted fields can contain commas + newlines + escaped quotes ("").
 *   - Trailing CR is stripped from end-of-row.
 */

export async function* parseCsvStream(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<string[]> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let prevWasQuoteInQuoted = false;

  const flushField = () => {
    row.push(field);
    field = '';
  };

  const flushRow = (): string[] | null => {
    flushField();
    const out = row;
    row = [];
    return out;
  };

  for await (const chunk of source) {
    buffer += decoder.decode(chunk, { stream: true });
    let i = 0;
    while (i < buffer.length) {
      const ch = buffer[i];
      if (inQuotes) {
        if (prevWasQuoteInQuoted) {
          // Previous char was `"` inside a quoted field. If this char is also
          // `"` it's an escaped quote → emit one literal `"`. Otherwise the
          // previous quote was the closing delimiter and we need to handle
          // the current char as out-of-quotes.
          prevWasQuoteInQuoted = false;
          if (ch === '"') {
            field += '"';
            i += 1;
            continue;
          }
          inQuotes = false;
          // fall through — re-process this char with inQuotes=false
        } else if (ch === '"') {
          prevWasQuoteInQuoted = true;
          i += 1;
          continue;
        } else {
          field += ch;
          i += 1;
          continue;
        }
      }
      // not in quotes
      if (ch === ',') {
        flushField();
        i += 1;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        // Strip CRLF: skip both \r and \n
        const out = flushRow();
        if (out !== null && out.length > 0 && !(out.length === 1 && out[0] === '')) {
          yield out;
        }
        // skip the newline + any following \n (Windows CRLF)
        if (ch === '\r' && buffer[i + 1] === '\n') i += 2;
        else i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
    }
    buffer = ''; // consumed everything we have so far
  }

  // Flush trailing
  buffer += decoder.decode();
  if (buffer.length > 0 || field.length > 0 || row.length > 0) {
    for (const ch of buffer) {
      if (inQuotes) {
        if (prevWasQuoteInQuoted) {
          prevWasQuoteInQuoted = false;
          if (ch === '"') {
            field += '"';
            continue;
          }
          inQuotes = false;
        } else if (ch === '"') {
          prevWasQuoteInQuoted = true;
          continue;
        } else {
          field += ch;
          continue;
        }
      }
      if (ch === ',') {
        flushField();
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        const out = flushRow();
        if (out !== null && out.length > 0 && !(out.length === 1 && out[0] === '')) {
          yield out;
        }
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        continue;
      }
      field += ch;
    }
    if (field.length > 0 || row.length > 0) {
      const out = flushRow();
      if (out !== null && out.length > 0 && !(out.length === 1 && out[0] === '')) {
        yield out;
      }
    }
  }
}
