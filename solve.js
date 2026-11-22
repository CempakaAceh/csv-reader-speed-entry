// Fast drop-in for csv-reader 1.0.0 (make.fun's own reference program).
// Same answers for every input, same error records in the same order —
// but instead of reading one character at a time it jumps delimiter to
// delimiter with regex/indexOf scans and copies whole field slices.
//
// Semantics mirrored from vendor/csv-reader (see the kit's RULES.txt):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (stray_cr).
// - A field opening with a quote runs to the next non-doubled quote; ""
//   inside it is one quote; CRLF / lone CR inside it read as LF; what
//   follows the closing quote up to the next comma or line break is
//   appended as it stands (quote_junk, when the field ends); a quote
//   that never closes is a literal character and the text after it is
//   read again as unquoted (unterminated_quote).
// - A quote inside an unquoted field is a literal character. Fields stay
//   strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows are
//   padded with "" (short_row, with fields: its count) or cut (long_row,
//   with extra: the cut fields) to the first record's width.
// - Each error is {code, line, row}: line the 1-based line its record
//   starts on, row its record's index in rows (null for the header),
//   in the order met.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  const delim = /[,\n\r]/g; // next comma / LF / CR from pos
  const breaks = /\r\n|\r|\n/g; // line breaks inside a quoted segment, for counting

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Returns the field and how it ended; `added` counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    while (pos < n) {
      delim.lastIndex = pos;
      const m = delim.exec(text);
      if (m === null) {
        value += text.slice(pos);
        added += n - pos;
        pos = n;
        return { value, ended: END, added };
      }
      const i = m.index;
      if (i > pos) {
        value += text.slice(pos, i);
        added += i - pos;
      }
      const c = m[0];
      if (c === ',') {
        pos = i + 1;
        return { value, ended: COMMA, added };
      }
      if (c === '\n') {
        pos = i + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // c === '\r'
      if (text.charCodeAt(i + 1) === 10) {
        pos = i + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      error('stray_cr');
      pos = i + 1;
    }
    return { value, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q < 0) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (q > pos) {
        const seg = text.slice(pos, q);
        if (seg.indexOf('\n') < 0 && seg.indexOf('\r') < 0) {
          value += seg;
        } else {
          // CRLF and a lone CR inside quotes are each one LF.
          breaks.lastIndex = 0;
          let count = 0;
          while (breaks.exec(seg) !== null) count += 1;
          line += count;
          value += seg.replace(/\r\n?/g, '\n');
        }
      }
      if (text.charCodeAt(q + 1) === 34) {
        value += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1;
      if (pos >= n) return { value, ended: END };
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        return { value, ended: COMMA };
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: LINE_BREAK };
      }
      // What follows the closing quote is appended as it stands, up to the next comma or line break.
      const junk = readUnquoted(value);
      if (junk.added > 0) error('quote_junk');
      return junk;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
