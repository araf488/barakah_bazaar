/**
 * A small RFC 4180 CSV reader.
 *
 * Hand-written rather than pulled from npm: the format is small and fully specified, this is
 * the only place the project needs it, and a supply-chain dependency for ~60 lines is a poor
 * trade on a pre-launch project. What it must get right is the part `split(',')` gets wrong:
 * quoted fields containing commas, newlines and escaped quotes — a product called
 * `Almonds, Premium ("Kashmiri")` is ordinary grocery data, not an edge case.
 */

export interface CsvRow {
  /** 1-based line number in the source, for error messages a human can act on. */
  readonly line: number;
  readonly values: Readonly<Record<string, string>>;
}

export interface CsvParseResult {
  readonly headers: readonly string[];
  readonly rows: readonly CsvRow[];
}

/**
 * Consumes one quoted field, starting at its opening quote.
 *
 * Extracted from the main scanner so neither is hard to follow: interleaving the
 * inside-quotes and outside-quotes states in one loop pushed it to a cognitive complexity of
 * 22, and the quoting rules are the subtle half.
 *
 * An unterminated quote yields everything to end of input rather than throwing — a truncated
 * upload should surface as a validation error about the row, not a parser crash.
 */
const readQuotedField = (input: string, start: number): { value: string; next: number } => {
  let value = '';
  let index = start + 1;

  while (index < input.length) {
    const char = input[index];

    if (char !== '"') {
      value += char;
      index += 1;
      continue;
    }

    // A doubled quote inside a quoted field is a literal quote.
    if (input[index + 1] === '"') {
      value += '"';
      index += 2;
      continue;
    }

    return { value, next: index + 1 };
  }

  return { value, next: index };
};

/** Splits one CSV document into records of fields, honouring quotes. */
const tokenise = (input: string): string[][] => {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let index = 0;

  const endField = (): void => {
    record.push(field);
    field = '';
  };

  const endRecord = (): void => {
    endField();
    records.push(record);
    record = [];
  };

  while (index < input.length) {
    const char = input[index];

    if (char === '"' && field.length === 0) {
      const quoted = readQuotedField(input, index);
      field += quoted.value;
      index = quoted.next;
      continue;
    }

    if (char === ',') {
      endField();
      index += 1;
      continue;
    }

    if (char === '\r' || char === '\n') {
      endRecord();
      // Consume CRLF as one line ending, not two.
      index += char === '\r' && input[index + 1] === '\n' ? 2 : 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field.length > 0 || record.length > 0) {
    endRecord();
  }

  return records;
};

const isBlank = (record: readonly string[]): boolean =>
  record.every((value) => value.trim().length === 0);

export const Csv = {
  /**
   * Reads a document whose first non-blank line is the header.
   *
   * Header names are trimmed and lowercased so `Price Poysha`, `price_poysha` and
   * `pricePoysha` all reach the caller the same way — spreadsheet exports are inconsistent
   * about this and a rejected import over capitalisation helps nobody.
   */
  parse(input: string): CsvParseResult {
    // A BOM survives every Excel "Save as CSV" and would otherwise corrupt the first header.
    const text = input.replace(/^\uFEFF/, '');
    const records = tokenise(text);

    if (records.length === 0 || isBlank(records[0])) {
      return { headers: [], rows: [] };
    }

    const headers = records[0].map((header) => Csv.normaliseHeader(header));
    const rows: CsvRow[] = [];

    records.slice(1).forEach((record, offset) => {
      if (isBlank(record)) {
        return;
      }

      const values: Record<string, string> = {};
      headers.forEach((header, column) => {
        values[header] = (record[column] ?? '').trim();
      });

      rows.push({ line: offset + 2, values });
    });

    return { headers, rows };
  },

  /** `Price Poysha` / `price_poysha` / `pricePoysha` all normalise to `pricepoysha`. */
  normaliseHeader(header: string): string {
    return header
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]/g, '');
  },
} as const;
