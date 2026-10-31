# Connect — Audit & Fix Report (31 Oct 2026)

Scope: sections 7–9 of the request (audit, bug fixing, QA, preservation). The message contained no sections 1–6, so **no new features were implemented**; nothing was invented.
Architecture, design, layout, colors, navigation and employee workflow are unchanged. No functions were removed. Existing sheet data is read as-is (old plaintext passwords, numeric codes, Date cells all still work).

## 1–3. Problems found, root cause, files

| # | Problem | Root cause | Files |
|---|---|---|---|
| 1 | Editing an item/device with an auto-generated code failed with "code already used" | Sheets stores `123456` as a number; server compared `"123456" !== 123456` then found the item itself as a duplicate | Code.gs |
| 2 | Barcodes and customer phones lost leading zeros (`0100…` → `100…`) so scans of codes starting with 0 never matched | Sheets converts numeric-looking strings on write | Code.gs |
| 3 | Dates came back as UTC ISO strings after refresh (wrong day after midnight, different format online vs offline, broke sorting/accounting by day) | Sheets converts "yyyy-MM-dd HH:mm:ss" to a real date; JSON serialises it in UTC | Code.gs |
| 4 | Dashboard "today" was wrong between 00:00–02:00/03:00 | `toISOString()` is UTC, records are local time | app.js |
| 5 | Dashboard profit after returns had the wrong sign and ignored non-restocked returns (disagreed with Accounting screen) | Added the return's profit instead of subtracting the loss | app.js |
| 6 | Double-clicking "confirm sale" / "save edit" recorded two sales | No busy guard on 4 forms; each click generated a new id | app.js |
| 7 | Editing price/name overwrote stock with a stale number, undoing sales made on another device | Edit form always sent absolute quantity | app.js |
| 8 | Stored XSS and broken forms: names containing `<`, `"` truncated edit fields (saving corrupted the name) and could run script | Data inserted into `innerHTML` unescaped (~54 places) | app.js, offline.js |
| 9 | Anyone with the API URL could read/add users and all data; passwords plain text | No server-side auth | Code.gs, app.js |
| 10 | Text like `=HYPERLINK(...)` typed as a customer name became a live sheet formula | Values written without text format | Code.gs |
| 11 | No server/client validation (negative stock, 0 or text amounts, empty names, fractional quantities) | Missing checks | Code.gs, offline.js |
| 12 | Slow saves/batch sync | Every cell update and header check was a separate Sheets call; sheets re-read many times per request | Code.gs |
| 13 | Two offline devices adding the same model left items pointing to a model id that doesn't exist (items invisible) | Server returned the existing model but later queued ops kept the local id | Code.gs |
| 14 | Server busy (lock timeout) surfaced as a hard error and lost the entry | Lock failure treated as a normal error | Code.gs, app.js |
| 15 | Scanner while a form was open navigated away and destroyed it; typed customer data was lost on scan | Global key handler ignored open modals and re-rendered | app.js |
| 16 | Sorting by date broken on iPhone/Safari | `new Date("yyyy-mm-dd hh:mm:ss")` is Invalid Date there | app.js |
| 17 | New category with empty name, or duplicate categories after a failed retry | No check / no reuse | app.js, Code.gs |
| 18 | Site updates could be delayed ~10 min | GitHub Pages HTTP cache in front of network-first SW | sw.js, index.html |
| 19 | Stock deducted before the sale row was written (crash in between = stock lost without invoice) | Order of writes | Code.gs |

## 4. New features
None (not in the request text received).

## 5. Tests performed
- Apps Script logic (Node, in-memory Sheets mock that imitates Sheets' number/date/formula auto-conversion): **41/41 passed** — login, hash upgrade, forged token, role checks, barcode/phone zeros, date round-trip, numeric-code edit, stock edit, duplicate sale id, oversell, batch replay, model merge, returns, accounting, formula text.
- Offline layer (Node, fake server): **9/9 passed** — validation, online write, offline queue + local stock, offline oversell rejection, IndexedDB persistence, reconnect flush with a replayed (lost-response) op, no duplicate deduction.
- Syntax check of app.js, offline.js, sw.js, Code.gs.

## 6. Not verified / remaining
- **No real browser or live Google Sheet was available.** The DOM code in app.js (forms, printing, receipts) was reviewed and syntax-checked, but not run. Please test one sale + print, one offline sale, and one reconnect on the real site.
- Old rows whose phone/code Sheets already turned into numbers cannot be recovered (zeros are gone); new rows are correct.
- Offline stock edits remain absolute values; if two devices edit the same item's quantity while offline, the last one uploaded wins (sales are unaffected).
- Receipt printing logic was audited; the only defect found was unescaped names (fixed). Printer behaviour depends on the browser/printer driver.
- Keep the spreadsheet time zone set to Africa/Cairo (File > Settings), since stored times are local strings.
- Files not changed: style.css, manifest.json, config.js.
