// Import, duplicate detection, export round-trip and store tests (pure Node, no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImport, tradesToCSV, exampleCSV, parseCSV } from '../js/csv.js';
import { createStore, migrate, EMPTY_STATE } from '../js/storage.js';
import { validateTrade, computeStats } from '../js/trades.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

test('parseCSV handles quoted commas and escaped quotes', () => {
  const t = parseCSV('a,b\r\n"x, y","say ""hi"""\r\n');
  assert.deepEqual(t[1], ['x, y', 'say "hi"']);
});

test('example CSV imports with no invalid rows', () => {
  const r = analyzeImport(exampleCSV());
  assert.equal(r.error, null);
  assert.equal(r.counts.total, 4);
  assert.equal(r.counts.invalid, 0);
});

test('missing required column is reported, not silently imported', () => {
  const r = analyzeImport('Symbol,Direction\nEURUSD,long\n');
  assert.ok(r.error);
  assert.ok(r.missingRequired.length > 0);
});

test('invalid rows are flagged with a row-level reason', () => {
  const csvText = exampleCSV().split('\r\n');
  csvText[1] = csvText[1].replace('1.08500', 'abc'); // bad entry price
  const r = analyzeImport(csvText.join('\r\n'));
  assert.equal(r.rows[0].status, 'invalid');
  assert.ok(r.rows[0].errors.length > 0);
});

test('duplicate within the same file is detected', () => {
  const lines = exampleCSV().split('\r\n').filter(Boolean);
  const r = analyzeImport([lines[0], lines[1], lines[1]].join('\r\n'));
  assert.equal(r.counts.duplicate, 1);
});

test('row matching an existing journal trade is a duplicate', () => {
  const first = analyzeImport(exampleCSV());
  const existing = first.rows.filter((x) => x.trade).map((x) => x.trade);
  const again = analyzeImport(exampleCSV(), { existingTrades: existing });
  assert.equal(again.counts.duplicate, again.counts.total);
  assert.equal(again.counts.valid, 0);
});

test('export then re-import is lossless for the instrument/price fields', () => {
  const first = analyzeImport(exampleCSV());
  const trades = first.rows.map((x) => x.trade);
  const out = tradesToCSV(trades);
  const back = analyzeImport(out);
  assert.equal(back.counts.invalid, 0);
  assert.equal(back.rows[0].trade.instrument, trades[0].instrument);
  assert.equal(back.rows[0].trade.entryPrice, trades[0].entryPrice);
});

test('store saves, reloads, and rejects an invalid trade', () => {
  const st = createStore(memStorage());
  st.load();
  const bad = st.upsertTrade({ instrument: '' });
  assert.equal(bad.ok, false);
  const good = analyzeImport(exampleCSV()).rows[0].trade;
  const saved = st.upsertTrade(good);
  assert.equal(saved.ok, true);
  const reloaded = createStore(memStorage());
  reloaded.load();
  assert.equal(st.trades.length, 1);
});

test('backup round-trip restores trades and settings', () => {
  const a = createStore(memStorage());
  a.load();
  a.addTrades(analyzeImport(exampleCSV()).rows.map((x) => x.trade));
  a.updateSettings({ accountCurrency: 'EUR' });
  const backup = a.exportBackup();
  const b = createStore(memStorage());
  b.load();
  const r = b.importBackup(backup);
  assert.equal(r.ok, true);
  assert.equal(b.trades.length, 4);
  assert.equal(b.state.settings.accountCurrency, 'EUR');
});

test('backup from another app is rejected', () => {
  const b = createStore(memStorage());
  b.load();
  assert.equal(b.importBackup('{"app":"other","trades":[]}').ok, false);
  assert.equal(b.importBackup('not json').ok, false);
});

test('migrate fills defaults for an empty object', () => {
  const s = migrate({});
  assert.deepEqual(s.trades, []);
  assert.equal(s.schemaVersion, EMPTY_STATE().schemaVersion);
});

test('stats are zero, not NaN, with no closed trades', () => {
  const st = computeStats([], { period: 'all' });
  assert.equal(st.totalClosed, 0);
  assert.ok(!Number.isNaN(st.net));
});
