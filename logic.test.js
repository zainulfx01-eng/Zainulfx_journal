import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as calc from '../js/calc.js';
import * as trades from '../js/trades.js';
import * as csv from '../js/csv.js';
import { createStore, migrate, EMPTY_STATE } from '../js/storage.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} ~ ${b}`);

// ---------- calc ----------
test('EURUSD pip value per lot on USD account is 10', () => {
  const spec = calc.resolveInstrument('eur/usd');
  assert.equal(spec.symbol, 'EURUSD');
  const { pipValuePerLot } = calc.pipValuePerLot({ spec, accountCurrency: 'USD', price: 1.085 });
  assert.equal(pipValuePerLot, 10);
});

test('USDJPY pip value per lot on USD account is ~ 1000/price', () => {
  const spec = calc.resolveInstrument('USDJPY');
  const { pipValuePerLot } = calc.pipValuePerLot({ spec, accountCurrency: 'USD', price: 150 });
  near(pipValuePerLot, 100000 * 0.01 / 150, 0.001); // 6.67
});

test('GBPJPY on USD account needs a JPY rate', () => {
  const spec = calc.resolveInstrument('GBPJPY');
  const r = calc.pipValuePerLot({ spec, accountCurrency: 'USD', price: 190 });
  assert.equal(r.needsRate, true);
  const r2 = calc.pipValuePerLot({ spec, accountCurrency: 'USD', price: 190, rate: 0.0067 });
  near(r2.pipValuePerLot, 1000 * 0.0067, 0.0001);
});

test('XAUUSD: 1 pip = 0.1 move, 100 oz/lot -> $10 per pip per lot', () => {
  const spec = calc.resolveInstrument('XAUUSD');
  assert.equal(calc.pipValuePerLot({ spec, accountCurrency: 'USD', price: 2330 }).pipValuePerLot, 10);
});

test('custom instrument spec overrides default', () => {
  const spec = calc.resolveInstrument('EURUSD', { EURUSD: { pipSize: 0.0001, contractSize: 50000, quoteCurrency: 'USD' } });
  assert.equal(spec.source, 'custom');
  assert.equal(calc.pipValuePerLot({ spec, accountCurrency: 'USD', price: 1.1 }).pipValuePerLot, 5);
});

test('unknown instrument is not known', () => {
  assert.equal(calc.resolveInstrument('FOOBAR').known, false);
});

test('planTrade: EURUSD long 1 lot, 20 pip SL, 40 pip TP', () => {
  const r = calc.planTrade({ symbol: 'EURUSD', accountCurrency: 'USD', direction: 'long', entry: 1.085, stopLoss: 1.083, takeProfit: 1.089, lots: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.result.slPips, 20);
  assert.equal(r.result.tpPips, 40);
  assert.equal(r.result.riskMoney, 200);
  assert.equal(r.result.rewardMoney, 400);
  assert.equal(r.result.plannedRR, 2);
  assert.equal(r.estimate, true);
});

test('planTrade rejects zero-distance SL and wrong-side SL/TP', () => {
  const zero = calc.planTrade({ symbol: 'EURUSD', accountCurrency: 'USD', direction: 'long', entry: 1.1, stopLoss: 1.1, lots: 1 });
  assert.equal(zero.ok, false);
  assert.match(zero.errors.join(' '), /zero risk|cannot equal/);
  const wrong = calc.planTrade({ symbol: 'EURUSD', accountCurrency: 'USD', direction: 'long', entry: 1.1, stopLoss: 1.11, lots: 1 });
  assert.equal(wrong.ok, false);
  const negLots = calc.planTrade({ symbol: 'EURUSD', accountCurrency: 'USD', direction: 'long', entry: 1.1, stopLoss: 1.09, lots: -1 });
  assert.equal(negLots.ok, false);
});

test('planTrade asks for a rate when needed (GBPJPY on USD)', () => {
  const r = calc.planTrade({ symbol: 'GBPJPY', accountCurrency: 'USD', direction: 'long', entry: 190, stopLoss: 189.5, lots: 1 });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /conversion rate/);
});

test('sizePosition: $10,000 at 1% risk, EURUSD, 25 pip stop -> 0.40 lots', () => {
  const r = calc.sizePosition({ balance: 10000, riskPercent: 1, symbol: 'EURUSD', accountCurrency: 'USD', entry: 1.085, stopLoss: 1.0825 });
  assert.equal(r.ok, true);
  assert.equal(r.result.riskAmount, 100);
  assert.equal(r.result.slPips, 25);
  assert.equal(r.result.suggestedLots, 0.4);
  assert.equal(r.result.actualRisk, 100);
});

test('sizePosition rounds DOWN to 0.01 lot so risk never exceeds target', () => {
  const r = calc.sizePosition({ balance: 1000, riskPercent: 1, symbol: 'EURUSD', accountCurrency: 'USD', entry: 1.085, stopLoss: 1.0825 });
  // raw = 10 / (25*10) = 0.04 lots
  assert.equal(r.result.suggestedLots, 0.04);
  assert.ok(r.result.actualRisk <= r.result.riskAmount + 1e-9);
});

test('sizePosition with TP computes reward and RR', () => {
  const r = calc.sizePosition({ balance: 10000, riskPercent: 1, symbol: 'EURUSD', accountCurrency: 'USD', entry: 1.085, stopLoss: 1.0825, takeProfit: 1.09 });
  assert.equal(r.result.tpPips, 50);
  assert.equal(r.result.plannedRR, 2);
});

test('sizePosition rejects negative/zero balance and risk, and zero-distance SL', () => {
  assert.equal(calc.sizePosition({ balance: -5, riskPercent: 1, symbol: 'EURUSD', accountCurrency: 'USD', entry: 1.1, stopLoss: 1.09 }).ok, false);
  assert.equal(calc.sizePosition({ balance: 100, riskPercent: 0, symbol: 'EURUSD', accountCurrency: 'USD', entry: 1.1, stopLoss: 1.09 }).ok, false);
  assert.equal(calc.sizePosition({ balance: 100, riskPercent: 1, symbol: 'EURUSD', accountCurrency: 'USD', entry: 1.1, stopLoss: 1.1 }).ok, false);
});

test('computeNetPL: gross minus costs, swap signed', () => {
  assert.equal(calc.computeNetPL({ grossPL: 300, commission: 3.5, swap: -1, otherCosts: 0 }), 295.5);
  assert.equal(calc.computeNetPL({ grossPL: -100, commission: -2, swap: 0.5, otherCosts: 1 }), -102.5);
});

test('classifyResult threshold for break-even', () => {
  assert.equal(calc.classifyResult(0), 'breakeven');
  assert.equal(calc.classifyResult(0.001), 'breakeven');
  assert.equal(calc.classifyResult(10), 'profit');
  assert.equal(calc.classifyResult(-10), 'loss');
});

// ---------- trades ----------
const base = {
  instrument: 'eurusd', direction: 'long', status: 'closed', entryTime: '2026-10-05T08:30', exitTime: '2026-10-05T11:10',
  entryPrice: '1.085', exitPrice: '1.091', stopLoss: '1.082', takeProfit: '1.098', lots: '0.5', accountCurrency: 'usd',
  initialRisk: '50', grossPL: '300', commission: '3.5', swap: '0', otherCosts: '0',
};

test('validateTrade accepts a valid closed trade and derives fields', () => {
  const { valid, trade, errors } = trades.validateTrade(base);
  assert.equal(valid, true, JSON.stringify(errors));
  assert.equal(trade.instrument, 'EURUSD');
  assert.equal(trade.netPL, 296.5);
  assert.equal(trade.result, 'profit');
  assert.equal(trade.realizedR, 5.93);
  assert.equal(trade.plannedRR, 4.33); // 130 pip TP / 30 pip SL
});

test('validateTrade catches bad lots, stop side, bad dates, and missing exit', () => {
  const r = trades.validateTrade({ ...base, lots: '0.505' });
  assert.ok(r.errors.lots);
  assert.ok(trades.validateTrade({ ...base, lots: '-1' }).errors.lots);
  assert.ok(trades.validateTrade({ ...base, stopLoss: '1.09' }).errors.stopLoss);
  assert.ok(trades.validateTrade({ ...base, entryTime: 'not a date' }).errors.entryTime);
  assert.ok(trades.validateTrade({ ...base, exitTime: '2026-10-04T10:00' }).errors.exitTime);
  assert.ok(trades.validateTrade({ ...base, exitTime: '' }).errors.exitTime);
  assert.ok(trades.validateTrade({ ...base, instrument: 'EUR USD!!' }).errors.instrument);
});

test('open trade must not have exit or P/L', () => {
  const r = trades.validateTrade({ ...base, status: 'open', exitTime: '', exitPrice: '', grossPL: '', netPL: '' });
  assert.equal(r.valid, true, JSON.stringify(r.errors));
  assert.equal(r.trade.result, 'open');
  assert.ok(trades.validateTrade({ ...base, status: 'open' }).errors.exitTime);
});

test('break-even result classification end-to-end', () => {
  const r = trades.validateTrade({ ...base, grossPL: '0', commission: '0' });
  assert.equal(r.trade.result, 'breakeven');
});

test('filterTrades: result, symbol, search, date range', () => {
  const list = [
    trades.validateTrade(base).trade,
    trades.validateTrade({ ...base, id: 'b', grossPL: '-100', commission: '0', instrument: 'GBPJPY', entryTime: '2026-09-01T10:00', exitTime: '2026-09-01T12:00', entryReason: 'FOMC retest' }).trade,
    trades.validateTrade({ ...base, id: 'c', status: 'open', exitTime: '', exitPrice: '', grossPL: '', instrument: 'XAUUSD', entryTime: '2026-10-20T09:00' }).trade,
  ];
  list[0].id = 'a'; list[0].entryReason = '';
  assert.equal(trades.filterTrades(list, { result: 'profit' }).length, 1);
  assert.equal(trades.filterTrades(list, { result: 'loss' }).length, 1);
  assert.equal(trades.filterTrades(list, { result: 'open' }).length, 1);
  assert.equal(trades.filterTrades(list, { symbol: 'gbp/jpy' }).length, 1);
  assert.equal(trades.filterTrades(list, { search: 'fomc' }).length, 1);
  assert.equal(trades.filterTrades(list, { from: '2026-10-01', to: '2026-10-31' }).length, 2);
});

test('sortTrades by pl and date', () => {
  const list = [
    { instrument: 'A', entryTime: '2026-01-01T00:00:00Z', netPL: 5, result: 'profit' },
    { instrument: 'B', entryTime: '2026-02-01T00:00:00Z', netPL: -3, result: 'loss' },
  ];
  assert.equal(trades.sortTrades(list, 'pl-desc')[0].instrument, 'A');
  assert.equal(trades.sortTrades(list, 'date-desc')[0].instrument, 'B');
  assert.equal(trades.sortTrades(list, 'symbol-asc')[0].instrument, 'A');
});

test('computeStats: totals, win rate, profit factor, drawdown, balance', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const mk = (id, pl, day, risk = 50) => ({ id, status: 'closed', netPL: pl, initialRisk: risk, entryTime: `2026-10-${day}T09:00:00Z`, exitTime: `2026-10-${day}T10:00:00Z`, instrument: 'EURUSD', result: pl > 0 ? 'profit' : pl < 0 ? 'loss' : 'breakeven' });
  const list = [mk('1', 100, '05'), mk('2', -50, '06'), mk('3', -50, '07'), mk('4', 0, '08'), mk('5', 200, '09')];
  const s = trades.computeStats(list, { period: 'all', startingBalance: 1000, now });
  assert.equal(s.totalClosed, 5);
  assert.equal(s.net, 200);
  assert.equal(s.winners, 2);
  assert.equal(s.losers, 2);
  assert.equal(s.breakeven, 1);
  assert.equal(s.winRate, 40);
  assert.equal(s.profitFactor, 3); // 300 gross win / 100 gross loss
  assert.equal(s.currentBalance, 1200);
  assert.equal(s.maxDrawdownAbs, 100);
  assert.equal(s.curve.at(-1).y, 1200);
  assert.equal(s.avgR, 0.8); // R = 2, -1, -1, 0, 4 -> mean 0.8
});

test('computeStats excludes open trades and empty state is safe', () => {
  const s = trades.computeStats([], { period: 'all', now: new Date() });
  assert.equal(s.totalClosed, 0);
  assert.equal(s.winRate, null);
  assert.equal(s.profitFactor, null);
  assert.equal(s.avgR, null);
  assert.equal(s.curve.length, 1);
});

test('periodRange week starts Monday', () => {
  const r = trades.periodRange('week', new Date(2026, 9, 22, 15)); // Thu 22 Oct 2026 local
  assert.equal(new Date(r.from).getDay(), 1);
  assert.equal(new Date(r.from).getDate(), 19);
});

// ---------- csv ----------
test('parseCSV handles quotes, embedded commas/newlines, BOM and CRLF', () => {
  const t = csv.parseCSV('\uFEFFa,b,c\r\n1,"x, y","line1\nline2"\r\n2,"he said ""hi""",3\r\n');
  assert.deepEqual(t[0], ['a', 'b', 'c']);
  assert.equal(t[1][1], 'x, y');
  assert.equal(t[1][2], 'line1\nline2');
  assert.equal(t[2][1], 'he said "hi"');
});

test('parseCSV throws on unclosed quote', () => {
  assert.throws(() => csv.parseCSV('a,"b\n1,2'));
});

test('example CSV round-trips: 4 rows, 1 open, 1 break-even', () => {
  const a = csv.analyzeImport(csv.exampleCSV(), { existingTrades: [] });
  assert.equal(a.error, null);
  assert.equal(a.counts.total, 4, JSON.stringify(a.rows.map((r) => r.errors)));
  assert.equal(a.counts.valid, 4);
  assert.equal(a.counts.duplicate, 0);
  const be = a.rows.find((r) => r.trade.instrument === 'USDJPY');
  assert.equal(be.trade.result, 'breakeven');
});

test('auto-mapping recognises common broker headers', () => {
  const { mapping } = csv.autoMap(['Symbol', 'Side', 'Open Time', 'Open Price', 'Close Price', 'Volume', 'Profit', 'SL', 'TP']);
  assert.equal(mapping.instrument, 0);
  assert.equal(mapping.direction, 1);
  assert.equal(mapping.entryTime, 2);
  assert.equal(mapping.entryPrice, 3);
  assert.equal(mapping.exitPrice, 4);
  assert.equal(mapping.lots, 5);
  assert.equal(mapping.grossPL, 6);
});

test('import flags missing required mapping, invalid rows and duplicates', () => {
  const text = [
    'Symbol,Direction,Entry Time,Entry Price,Lots,Status,Exit Time,Exit Price,Net P/L,Stop Loss',
    'EURUSD,buy,2026-10-05T08:30,1.085,0.5,closed,2026-10-05T10:00,1.09,50,1.082',
    'EURUSD,buy,2026-10-05T08:30,1.085,0.5,closed,2026-10-05T10:00,1.09,50,1.082',
    'EURUSD,buy,not-a-date,1.085,0.5,closed,2026-10-05T10:00,1.09,50,1.082',
    'EURUSD,buy,2026-10-05T08:30,abc,0.5,closed,2026-10-05T10:00,1.09,50,1.082',
  ].join('\n');
  const a = csv.analyzeImport(text, { existingTrades: [] });
  assert.equal(a.counts.total, 4);
  assert.equal(a.counts.valid, 1);
  assert.equal(a.counts.duplicate, 1);
  assert.equal(a.counts.invalid, 2);
  assert.equal(a.rows[0].trade.direction, 'long'); // buy -> long

  const existing = [a.rows[0].trade];
  const b = csv.analyzeImport(text, { existingTrades: existing });
  assert.equal(b.rows[0].status, 'duplicate');

  const missing = csv.analyzeImport('Foo,Bar\n1,2\n', {});
  assert.ok(missing.error);
});

test('tradesToCSV exports and re-imports losslessly for core fields', () => {
  const t1 = trades.validateTrade({ ...base, id: 'x1' }).trade;
  const out = csv.tradesToCSV([t1]);
  const back = csv.analyzeImport(out, { existingTrades: [] });
  assert.equal(back.counts.valid, 1, JSON.stringify(back.rows[0]?.errors));
  assert.equal(back.rows[0].trade.instrument, 'EURUSD');
  assert.equal(back.rows[0].trade.netPL, 296.5);
});

test('CSV injection-looking values with commas are quoted on export', () => {
  const t = trades.validateTrade({ ...base, strategy: 'a, "b"' }).trade;
  const out = csv.tradesToCSV([t]);
  assert.match(out, /"a, ""b"""/);
});

// ---------- storage ----------
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

test('store: upsert, persist, reload, delete', () => {
  const s1 = memStorage();
  const store = createStore(s1, 'k');
  store.load();
  const r = store.upsertTrade(base);
  assert.equal(r.ok, true);
  const id = r.trade.id;
  const store2 = createStore(s1, 'k');
  store2.load();
  assert.equal(store2.trades.length, 1);
  assert.equal(store2.trades[0].id, id);
  const upd = store2.upsertTrade({ ...base, id, grossPL: '100', commission: '0' });
  assert.equal(upd.trade.netPL, 100);
  assert.equal(store2.trades.length, 1);
  assert.equal(store2.deleteTrade(id).ok, true);
  assert.equal(store2.trades.length, 0);
});

test('store: corrupt data is preserved in a side key and the app still loads', () => {
  const s = memStorage();
  s.setItem('k', '{not json');
  const store = createStore(s, 'k');
  const r = store.load();
  assert.equal(r.ok, false);
  assert.ok([...s._m.keys()].some((k) => k.startsWith('k:corrupt-')));
  assert.equal(store.trades.length, 0);
});

test('store: rejects newer schema', () => {
  assert.throws(() => migrate({ schemaVersion: 99, trades: [] }), /newer app/);
});

test('backup export then import replaces data and validates', () => {
  const s = memStorage();
  const store = createStore(s, 'k');
  store.load();
  store.upsertTrade(base);
  const backup = store.exportBackup();
  const other = createStore(memStorage(), 'k2');
  other.load();
  const res = other.importBackup(backup);
  assert.equal(res.ok, true);
  assert.equal(other.trades.length, 1);
  assert.equal(other.importBackup('{"app":"zainul-fx-journal","trades":[{"instrument":"","direction":"x"}]}').ok, false);
  assert.equal(other.importBackup('garbage').ok, false);
  assert.equal(other.importBackup('{"app":"other","trades":[]}').ok, false);
});

test('EMPTY_STATE has no demo trades', () => {
  assert.equal(EMPTY_STATE().trades.length, 0);
});
