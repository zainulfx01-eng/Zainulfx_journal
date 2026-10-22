# Testing checklist (Stage 1)

Automated (run `npm test`): calculations, trade validation, filters/sort, stats, CSV parse/map/validate/duplicate, store save/reload, backup round-trip. Expected: 48 tests, 0 failing.

Manual, in a desktop browser and in Telegram:
- [ ] App loads, shows the empty dashboard with "Add your first trade".
- [ ] Add a trade with every required field. Invalid entry (zero SL distance, negative lots, bad date) shows a field error and does not save.
- [ ] Edit a trade, change P/L, confirm the dashboard totals update.
- [ ] Delete a trade and confirm the confirmation dialog appears first.
- [ ] Journal search, result filter, symbol/session/strategy filters, date range and sort all change the list.
- [ ] Dashboard period filter (today/week/month/all) changes the stats.
- [ ] Equity curve draws once 2+ closed trades exist; tapping a point shows its balance.
- [ ] Calculator plan mode: EURUSD 1.0850 / SL 1.0800 / TP 1.0950 / 1 lot shows SL 50 pips, TP 100 pips, and an estimate label.
- [ ] Calculator sizing mode: balance 10,000, risk 1%, entry/SL set, shows risk amount and suggested lots.
- [ ] Settings: change account currency and starting balance; save persists after a reload.
- [ ] Settings: edit an instrument spec; it is used in later calculator results.
- [ ] CSV: download the example template, import it, see the preview with valid/invalid/duplicate counts, confirm, see the summary.
- [ ] CSV: re-importing the same file marks rows as duplicates and imports nothing.
- [ ] Export all CSV and export filtered CSV open correctly in a spreadsheet.
- [ ] JSON backup downloads; restore after clearing data brings trades back.
- [ ] Clear local data empties the journal after confirmation.
- [ ] Reload the page: data persists.
- [ ] Light theme (if enabled) remains readable.
- [ ] Inside Telegram: the header back button appears on sub-screens; theme colours follow Telegram; the app opens without errors when initData is missing (demo mode).
- [ ] Nothing is sent to any server in Stage 1 (check the browser Network tab).

# Stage 1 done vs later

Done in Stage 1 (static, local, no backend):
- Telegram shell with theme, safe initData handling (display only, never trusted for identity), demo fallback in a browser.
- Trade CRUD with full field set, validation, delete confirmation, search, filters and sort, compact mobile cards.
- Dashboard stats computed from real records, period filter, equity curve, recent trades, empty state.
- Two-mode calculator (trade planning and position sizing), labelled as estimates.
- Configurable instrument specs (defaults are estimates; user overrides in settings).
- Local persistence (localStorage, schema versioned, flagged as unsynced local).
- CSV import (column mapping, validation, duplicate detection, preview, confirm) and export (all and filtered), plus an example template.
- JSON backup and restore.

Later:
- Stage 2: visual polish, screenshots per trade, richer analytics breakdowns.
- Stage 3: Supabase sync and Telegram initData server-side validation (HMAC with the bot token, hash and auth_date checks). Row Level Security on all tables.
- Stage 3+: broker-sourced P/L import, prop firm trackers, economic calendar, monetization, public community features.

Stage 1 itself does not validate initData on a server. Do not treat any user ID from the client as authoritative.
