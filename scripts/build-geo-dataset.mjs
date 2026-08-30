// Merges four verified sources into the vendored Bangladesh geography dataset.
//
//   node scripts/build-geo-dataset.mjs <sources-dir>
//
// Sources, in precedence order for a given name:
//   1. nuhil/bangladesh-geocode  — division/district/upazila/union, bilingual (en + bn)
//   2. bn.wikipedia union list   — adds metro development circles (e.g. Tejgaon) and their
//                                  unions; Bengali only, English recovered by dictionary
//   3. Bangladesh post office    — thana + area + postcode + lat/lon; English only
//   4. Dhaka Metropolitan Police — the 50 city thanas; English only
//
// Fails loudly rather than guessing. Bengali is NEVER transliterated: it comes from a
// verified source or it is null.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/build-geo-dataset.mjs <sources-dir>');

const norm = (s) => String(s ?? '').normalize('NFC').replace(/[‌‍]/g, '').replace(/\s+/g, ' ').trim();
const SUFFIX = /\s*(ইউনিয়ন|উপজেলা|উন্নয়ন সার্কেল|সার্কেল|থানা|পৌরসভা)\s*$/;
const bnKey = (s) => norm(norm(s).replace(SUFFIX, ''));

/**
 * Match-only key collapsing the ONE Bengali variation two sources routinely disagree on:
 * vowel length (ি/ী, ু/ূ) and the nukta. Used only to decide whether two rows are the same
 * place; the displayed name always keeps its source spelling. Without it, আদমদিঘি and
 * আদমদীঘি score 0.75 and ship as two separate upazilas.
 *
 * Deliberately NOT collapsing the nasal (ণ/ন) or sibilant (শ/ষ/স) sets: that made
 * genuinely different places in different districts collide and merge.
 */
const bnFuzzy = (s) =>
  bnKey(s)
    .replace(/[\u09BF\u09C0]/g, '\u09BF')
    .replace(/[\u09C1\u09C2]/g, '\u09C1')
    .replace(/\u09BC/g, '');

const enKey = (s) => {
  const n = norm(s).toLowerCase().replace(/\s+(thana|upazila|union|model|sadar)$/i, '');
  const latin = n.replace(/[^a-z0-9]/g, '');
  // A Bengali-only name strips to '' under the Latin filter, which would make every such
  // name collide with every other. Fall back to the normalised form so they stay distinct.
  return latin || n;
};

const table = (file) => {
  const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const t = Array.isArray(parsed) ? parsed.find((e) => e?.type === 'table') : null;
  const rows = t?.data ?? parsed;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`no rows in ${file}`);
  return rows;
};

const divisionRows = table('divisions.json');
const districtRows = table('districts.json');
const upazilaRows = table('upazilas.json');
const unionRows = table('unions.json');
if (divisionRows.length !== 8) throw new Error(`expected 8 divisions, got ${divisionRows.length}`);
if (districtRows.length !== 64) throw new Error(`expected 64 districts, got ${districtRows.length}`);

// Current official English spellings; the source still carries pre-2018 forms.
const RENAMES = { Barisal: 'Barishal', Chattagram: 'Chattogram', Comilla: 'Cumilla', Coxsbazar: "Cox's Bazar" };
const usedRenames = new Set();
const rename = (n) => { const c = norm(n); if (c in RENAMES) { usedRenames.add(c); return RENAMES[c]; } return c; };

// ── Bilingual dictionaries built ONLY from the verified source ──────────────
const bnToEn = new Map();
const enToBn = new Map();
for (const rows of [divisionRows, districtRows, upazilaRows, unionRows]) {
  for (const r of rows) {
    const en = norm(r.name), bn = norm(r.bn_name);
    if (!bn) throw new Error(`missing bn_name for ${en}`);
    if (!bnToEn.has(bnKey(bn))) bnToEn.set(bnKey(bn), en);
    if (!enToBn.has(enKey(en))) enToBn.set(enKey(en), bn);
  }
}

// English names no source provides, supplied and verified by the product owner (a Dhaka
// resident) rather than transliterated. Keyed by the Bengali name without its label suffix.
const USER_VERIFIED_EN = new Map([['দনিয়া', 'Donia']]);

/** A wiki cell that leaked table markup, or names an abolished unit, is not a place. */
const isJunkName = (value) => /[|{}\[\]]/.test(value) || /বিলুপ্ত/.test(value);

const stats = { wikiUnits: 0, wikiAreas: 0, dmpThanas: 0, postcodeUnits: 0, postcodeAreas: 0, noEn: 0, noBn: 0, dupAreas: 0, mergedUnits: 0, junkSkipped: 0 };

// ── Level 1-2: divisions and districts from the verified source ─────────────
const districtsById = new Map();
const divisions = divisionRows.map((d) => ({ nameEn: rename(d.name), nameBn: norm(d.bn_name), _id: String(d.id), districts: [] }));
const divById = new Map(divisions.map((d) => [d._id, d]));
for (const d of districtRows) {
  const rec = { nameEn: rename(d.name), nameBn: norm(d.bn_name), _id: String(d.id), units: [] };
  districtsById.set(rec._id, rec);
  divById.get(String(d.division_id)).districts.push(rec);
}

// ── Helpers to find/create units and areas ─────────────────────────────────
const districtByEn = new Map();
for (const dv of divisions) for (const ds of dv.districts) districtByEn.set(enKey(ds.nameEn), ds);

const findUnit = (district, nameEn) => district.units.find((u) => enKey(u.nameEn) === enKey(nameEn));
const addArea = (unit, area) => {
  if (unit.areas.some((a) => enKey(a.nameEn) === enKey(area.nameEn))) { stats.dupAreas++; return false; }
  unit.areas.push(area);
  return true;
};

// ── Level 3: upazilas, and level 4: unions ─────────────────────────────────
const upaById = new Map();
for (const u of upazilaRows) {
  const rec = { nameEn: norm(u.name), nameBn: norm(u.bn_name), kind: 'upazila', _id: String(u.id), _src: 'geocode', areas: [] };
  upaById.set(rec._id, rec);
  districtsById.get(String(u.district_id)).units.push(rec);
}
for (const u of unionRows) {
  const unit = upaById.get(String(u.upazilla_id));
  if (!unit) throw new Error(`orphan union ${u.name}`);
  // Through addArea, so the "no duplicate area name within one unit" rule covers the
  // verified source as well — it contains 4 genuine same-name collisions.
  addArea(unit, { nameEn: norm(u.name), nameBn: norm(u.bn_name), kind: 'union', postCode: null, latitude: null, longitude: null });
}

const unusedRenames = Object.keys(RENAMES).filter((k) => !usedRenames.has(k));
if (unusedRenames.length) throw new Error(`stale rename map: ${unusedRenames.join(', ')}`);

// ── Source 2: bn.wikipedia — add units and unions the source lacks ─────────
const wiki = JSON.parse(readFileSync(join(dir, 'wiki_parsed.json'), 'utf8'));
const districtByBn = new Map();
for (const dv of divisions) for (const ds of dv.districts) districtByBn.set(bnKey(ds.nameBn), ds);

for (const [distBn, units] of Object.entries(wiki)) {
  const district = districtByBn.get(bnKey(distBn));
  if (!district) continue;
  for (const { unit, unions } of units) {
    if (isJunkName(unit)) {
      stats.junkSkipped++;
      continue;
    }
    // Kind comes from the RAW string: the label is exactly what identifies a circle or a
    // thana, so it must be read before the next line strips it.
    const kind = /সার্কেল/.test(unit) ? 'circle' : /থানা/.test(unit) ? 'thana' : 'upazila';
    // Strip the label ("আদমদীঘি উপজেলা" = "Adamdighi upazila"); the name is the part before it.
    const unitBn = bnKey(unit);
    const unitEn = bnToEn.get(unitBn) ?? USER_VERIFIED_EN.get(unitBn) ?? null;
    let rec = district.units.find((u) => bnKey(u.nameBn ?? '') === bnKey(unitBn))
           ?? (unitEn ? findUnit(district, unitEn) : undefined);
    if (!rec) {
      if (!unitEn) stats.noEn++;
      rec = { nameEn: unitEn ?? unitBn, nameBn: unitBn, kind, areas: [], _src: 'wikipedia', _enMissing: !unitEn };
      district.units.push(rec);
      stats.wikiUnits++;
    }
    for (const u of unions) {
      // Wikipedia appends a label ("দনিয়া ইউনিয়ন" = "Donia union"); the name is the part before it.
      if (isJunkName(u)) {
        stats.junkSkipped++;
        continue;
      }
      const bn = bnKey(u);
      const en = bnToEn.get(bn) ?? USER_VERIFIED_EN.get(bn) ?? null;
      if (!en) stats.noEn++;
      if (addArea(rec, { nameEn: en ?? bn, nameBn: bn, kind: 'union', postCode: null, latitude: null, longitude: null, _enMissing: !en })) stats.wikiAreas++;
    }
  }
}

// ── Source 4: DMP thanas (Dhaka district) ──────────────────────────────────
const dmp = JSON.parse(readFileSync(join(dir, 'dmp_thanas.json'), 'utf8'));
const dhaka = districtByEn.get(enKey('Dhaka'));
if (!dhaka) throw new Error('Dhaka district not found');
for (const t of dmp) {
  if (findUnit(dhaka, t)) continue;
  dhaka.units.push({ nameEn: norm(t), nameBn: enToBn.get(enKey(t)) ?? null, kind: 'thana', _src: 'dmp', areas: [] });
  stats.dmpThanas++;
}

// ── Source 3: post office areas — postcode + coordinates ───────────────────
const csv = readFileSync(join(dir, 'postcodes.csv'), 'utf8').trim().split(/\r?\n/);
const head = csv[0].split(',');
const col = (n) => {
  const index = head.indexOf(n);
  // The JSON sources throw on an unexpected shape; this one used to yield NaN forever.
  if (index === -1) throw new Error(`postcodes.csv is missing the '${n}' column`);
  return index;
};
for (const line of csv.slice(1)) {
  const c = line.split(',');
  const district = districtByEn.get(enKey(c[col('district')]));
  if (!district) continue;
  const thana = norm(c[col('thana')]);
  // A few post-office rows carry a blank thana or area; an empty name would surface as a
  // nameless option in the address form.
  if (!thana) continue;
  let unit = findUnit(district, thana);
  if (!unit) {
    unit = { nameEn: thana, nameBn: enToBn.get(enKey(thana)) ?? null, kind: 'thana', _src: 'postcode', areas: [] };
    district.units.push(unit);
    stats.postcodeUnits++;
  }
  const area = norm(c[col('area')]);
  if (!area) continue;
  const lat = Number(c[col('latitude')]), lon = Number(c[col('longitude')]);
  const existing = unit.areas.find((a) => enKey(a.nameEn) === enKey(area));
  if (existing) {
    existing.postCode ??= norm(c[col('postal_code')]) || null;
    existing.latitude ??= Number.isFinite(lat) ? lat : null;
    existing.longitude ??= Number.isFinite(lon) ? lon : null;
  } else {
    unit.areas.push({ nameEn: area, nameBn: enToBn.get(enKey(area)) ?? null, kind: 'postcode-area',
      postCode: norm(c[col('postal_code')]) || null,
      latitude: Number.isFinite(lat) ? lat : null, longitude: Number.isFinite(lon) ? lon : null });
    stats.postcodeAreas++;
  }
}


// ── Reconcile spelling variants between sources ────────────────────────────
// The post-office and DMP lists use older or looser English spellings than the
// geocode source ("Pathorghata" vs "Patharghata"). Two entries for one place is a
// visible defect in a dropdown, so a close match folds into the verified spelling.
// Deliberately conservative: only a postcode/DMP entry folds into a geocode one, and
// only above a high similarity, so genuinely distinct places (Uttara East vs Uttara
// West) are never merged.
const similarity = (a, b) => {
  a = a.toLowerCase(); b = b.toLowerCase();
  if (a === b) return 1;
  const rows = Array.from({ length: b.length + 1 }, (_, i) => [i, ...Array(a.length).fill(0)]);
  for (let j = 1; j <= a.length; j++) rows[0][j] = j;
  for (let i = 1; i <= b.length; i++)
    for (let j = 1; j <= a.length; j++)
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (b[i - 1] === a[j - 1] ? 0 : 1));
  return 1 - rows[b.length][a.length] / Math.max(a.length, b.length);
};

const MERGE_THRESHOLD = 0.87;
// Trust order: the geocode source is bilingual and verified, Wikipedia is the authority on
// which units exist, the DMP list is official for Dhaka city, and the post-office file has
// the loosest spellings. A lower-trust entry folds into a higher-trust one, never the reverse.
const TRUST = { geocode: 0, wikipedia: 1, dmp: 2, postcode: 3 };
const isBn = (v) => /[\u0980-\u09FF]/.test(v ?? '');

for (const dv of divisions) for (const ds of dv.districts) {
  const ordered = [...ds.units].sort((a, b) => TRUST[a._src] - TRUST[b._src]);
  const keep = [];
  for (const unit of ordered) {
    const target = keep.find((k) => {
      // `keep` is filled in ascending trust order, so anything already kept is at least as
      // trusted as `unit`; a same-source pair is never merged, since two distinct units of
      // one source with similar names are two real places.
      if (k._src === unit._src) return false;
      // A development circle is its own thing and never folds into an upazila or thana.
      // Upazila-vs-thana is NOT a blocker: the post-office source labels every unit a
      // "thana", Savar included, so its kind carries no information.
      if ((k.kind === 'circle') !== (unit.kind === 'circle')) return false;
      // English side, when both actually have Latin names
      if (!isBn(k.nameEn) && !isBn(unit.nameEn) && similarity(k.nameEn, unit.nameEn) >= MERGE_THRESHOLD) return true;
      // Bengali side, which is how a Wikipedia-only unit finds its geocode twin
      if (k.nameBn && unit.nameBn && similarity(bnFuzzy(k.nameBn), bnFuzzy(unit.nameBn)) >= MERGE_THRESHOLD) return true;
      return false;
    });
    if (!target) { keep.push(unit); continue; }
    for (const a of unit.areas) addArea(target, a);
    target.nameBn ??= unit.nameBn;
    if (isBn(target.nameEn) && !isBn(unit.nameEn)) target.nameEn = unit.nameEn;
    stats.mergedUnits++;
  }
  ds.units = keep;
}

// ── Finalise: sort, strip internals, count gaps ────────────────────────────
const byEn = (a, b) => a.nameEn.localeCompare(b.nameEn);
for (const dv of divisions) {
  delete dv._id;
  dv.districts.sort(byEn);
  for (const ds of dv.districts) {
    delete ds._id;
    ds.units.sort(byEn);
    for (const u of ds.units) {
      delete u._id; delete u._enMissing; delete u._src;
      u.areas.sort(byEn);
      for (const a of u.areas) { delete a._enMissing; if (!a.nameBn) stats.noBn++; }
      if (!u.nameBn) stats.noBn++;
    }
  }
}
divisions.sort(byEn);

const count = (fn) => divisions.reduce((t, dv) => t + dv.districts.reduce((s, ds) => s + fn(ds), 0), 0);
const units = count((ds) => ds.units.length);
const areas = count((ds) => ds.units.reduce((s, u) => s + u.areas.length, 0));

const header = `// GENERATED FILE — do not edit by hand.
// Regenerate with: node scripts/build-geo-dataset.mjs <sources-dir> && npm run format
// (prettier rewrites this file's quoting; skipping it leaves a 57k-line whitespace diff)
//
// Merged from four verified sources, none of them invented:
//   1. github.com/nuhil/bangladesh-geocode @5622f68 — division/district/upazila/union, bilingual
//   2. bn.wikipedia.org "বাংলাদেশের ইউনিয়নের তালিকা" — metro development circles and their
//      unions the geocode source omits entirely (e.g. তেজগাঁও উন্নয়ন সার্কেল)
//   3. Bangladesh post office area dataset — thana/area with post code and coordinates
//   4. en.wikipedia.org "Dhaka Metropolitan Police" — the 50 Dhaka city thanas
//
// Captured: ${new Date().toISOString().slice(0, 10)}
// Contents: ${divisions.length} divisions, ${count((d) => 1)} districts, ${units} units, ${areas} areas
//
// Bengali names are NEVER transliterated. A name is Bengali only when a source supplied it or
// it matched a verified English↔Bengali pair; otherwise nameBn is null and the UI falls back
// to English. Inventing Bengali spellings would be visibly wrong to Bangla readers.
//
// Vendored rather than fetched at runtime: an address form that breaks because a third-party
// endpoint is down is not acceptable.

/** How a unit is administered. Rural areas have upazilas; cities have thanas and circles. */
export type GeoUnitKind = 'upazila' | 'thana' | 'circle';

/** How a leaf area is defined. */
export type GeoAreaKind = 'union' | 'postcode-area';

/** The level a customer actually picks. */
export interface GeoAreaData {
  readonly nameEn: string;
  readonly nameBn: string | null;
  readonly kind: GeoAreaKind;
  readonly postCode: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export interface GeoUnitData {
  readonly nameEn: string;
  readonly nameBn: string | null;
  readonly kind: GeoUnitKind;
  readonly areas: readonly GeoAreaData[];
}

export interface GeoDistrictData {
  readonly nameEn: string;
  readonly nameBn: string;
  readonly units: readonly GeoUnitData[];
}

export interface GeoDivisionData {
  readonly nameEn: string;
  readonly nameBn: string;
  readonly districts: readonly GeoDistrictData[];
}

export const BANGLADESH_DIVISIONS: readonly GeoDivisionData[] = `;

writeFileSync('src/modules/geo/bangladesh-geo.data.ts', `${header}${JSON.stringify(divisions, null, 2)} as const;\n`);

console.log(`divisions=${divisions.length} districts=${count(() => 1)} units=${units} areas=${areas}`);
console.log(`added: wiki units=${stats.wikiUnits} wiki areas=${stats.wikiAreas} dmp thanas=${stats.dmpThanas} postcode units=${stats.postcodeUnits} postcode areas=${stats.postcodeAreas}`);
console.log(`merged spelling-variant units: ${stats.mergedUnits}, junk/abolished skipped: ${stats.junkSkipped}`);
console.log(`gaps: no english=${stats.noEn} no bengali=${stats.noBn} duplicate areas skipped=${stats.dupAreas}`);
