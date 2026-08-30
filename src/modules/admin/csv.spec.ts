import { Csv } from './csv';

describe('Csv.parse', () => {
  it('reads a simple document', () => {
    const result = Csv.parse('slug,name\nalmonds,Almonds\ncashews,Cashews');

    expect(result.headers).toEqual(['slug', 'name']);
    expect(result.rows.map((row) => row.values)).toEqual([
      { slug: 'almonds', name: 'Almonds' },
      { slug: 'cashews', name: 'Cashews' },
    ]);
  });

  it('reports 1-based source line numbers, so an error names the row a human sees', () => {
    const result = Csv.parse('slug\na\nb');

    expect(result.rows.map((row) => row.line)).toEqual([2, 3]);
  });

  it('keeps a comma inside a quoted field', () => {
    // The case split(',') gets wrong, and ordinary grocery data.
    const result = Csv.parse('slug,name\nalmonds,"Almonds, Premium"');

    expect(result.rows[0].values.name).toBe('Almonds, Premium');
  });

  it('unescapes a doubled quote', () => {
    const result = Csv.parse('slug,name\nalmonds,"Almonds ""Kashmiri"""');

    expect(result.rows[0].values.name).toBe('Almonds "Kashmiri"');
  });

  it('keeps a newline inside a quoted field', () => {
    const result = Csv.parse('slug,description\na,"line one\nline two"');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].values.description).toBe('line one\nline two');
  });

  it('treats CRLF as one line ending', () => {
    const result = Csv.parse('slug,name\r\na,A\r\nb,B');

    expect(result.rows).toHaveLength(2);
    expect(result.rows[1].values.name).toBe('B');
  });

  it('strips the byte order mark Excel writes', () => {
    const result = Csv.parse('﻿slug,name\na,A');

    expect(result.headers[0]).toBe('slug');
  });

  it.each([
    ['spaces', 'Price Poysha'],
    ['underscores', 'price_poysha'],
    ['camel case', 'pricePoysha'],
    ['hyphens', 'price-poysha'],
  ])('normalises a header written with %s', (_label, header) => {
    const result = Csv.parse(`${header}\n1`);

    expect(result.headers).toEqual(['pricepoysha']);
    expect(result.rows[0].values.pricepoysha).toBe('1');
  });

  it('skips blank lines rather than importing empty products', () => {
    const result = Csv.parse('slug,name\na,A\n\n\nb,B\n');

    expect(result.rows.map((row) => row.values.slug)).toEqual(['a', 'b']);
  });

  it('pads a short row rather than shifting later columns', () => {
    const result = Csv.parse('slug,name,brand\na,A');

    expect(result.rows[0].values).toEqual({ slug: 'a', name: 'A', brand: '' });
  });

  it('trims surrounding whitespace from values', () => {
    const result = Csv.parse('slug,name\n  a  ,  A  ');

    expect(result.rows[0].values).toEqual({ slug: 'a', name: 'A' });
  });

  it('returns nothing for an empty document', () => {
    expect(Csv.parse('')).toEqual({ headers: [], rows: [] });
  });

  it('returns headers but no rows for a header-only document', () => {
    const result = Csv.parse('slug,name\n');

    expect(result.headers).toEqual(['slug', 'name']);
    expect(result.rows).toEqual([]);
  });
});
