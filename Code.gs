/* MithaiFlow Google Apps Script backend.
 * Bind this script to the Google Spreadsheet via Extensions > Apps Script.
 */
const SPREADSHEET_ID = ''; // Leave blank when this script is bound to the spreadsheet.
const SHEETS = { USERS: 'User Sheet', ENTRIES: 'Entry sheet', TYPES: 'Type Master' };
const HEADERS = {
  USERS: ['UserID', 'Password', 'Role', 'Display Name', 'Active'],
  ENTRIES: ['Name', 'Type', 'Count', 'Remarks', 'User details', 'Timestamp', 'ID'],
  TYPES: ['Type'],
};

function doGet() { setup_(); return output_({ ok: true, service: 'MithaiFlow', message: 'Apps Script endpoint is active. Required sheets are ready.' }); }
function doPost(e) {
  try {
    const p = e.parameter || {};
    setup_();
    switch (p.action) {
      case 'login': return output_(login_(p));
      case 'submitEntry': return output_(submitEntry_(p));
      case 'getEntries': return output_(getEntries_(p));
      case 'getTypes': return output_(getTypes_());
      case 'createUser': return output_(createUser_(p));
      case 'addSweetType': return output_(addSweetType_(p));
      case 'getUsers': return output_(getUsers_());
      default: return output_({ ok: false, error: 'Unknown action.' });
    }
  } catch (err) { return output_({ ok: false, error: String(err.message || err) }); }
}
function output_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function book_() { return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); }
function setup_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const book = book_();
    // These calls make first use self-installing: no manual tab creation is needed.
    ensure_(book, SHEETS.USERS, HEADERS.USERS); ensure_(book, SHEETS.ENTRIES, HEADERS.ENTRIES); ensure_(book, SHEETS.TYPES, HEADERS.TYPES);
    const types = book.getSheetByName(SHEETS.TYPES); if (types.getLastRow() < 2) types.getRange(2, 1, 5, 1).setValues([['Kaju Katli'], ['Motichoor Ladoo'], ['Soan Papdi'], ['Rasgulla'], ['Gulab Jamun']]);
    const users = book.getSheetByName(SHEETS.USERS); if (users.getLastRow() < 2) users.getRange(2, 1, 1, 5).setValues([['admin', 'change-this-password', 'admin', 'Festival Admin', true]]);
  } finally { lock.releaseLock(); }
}
function ensure_(book, name, headers) {
  let sheet = book.getSheetByName(name); if (!sheet) sheet = book.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  else if (sheet.getLastColumn() < headers.length) sheet.insertColumnsAfter(sheet.getLastColumn(), headers.length - sheet.getLastColumn());
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  headers.forEach((header, index) => { if (String(current[index] || '').trim() !== header) sheet.getRange(1, index + 1).setValue(header); });
  sheet.setFrozenRows(1);
}
function login_(p) { const rows = book_().getSheetByName(SHEETS.USERS).getDataRange().getValues(); for (let i = 1; i < rows.length; i++) { const r = rows[i]; const active = r[4] === '' || r[4] === true || String(r[4]).toLowerCase() === 'true'; if (String(r[0]).trim().toLowerCase() === String(p.userId).trim().toLowerCase() && String(r[1]) === String(p.password) && active) return { ok: true, userId: String(r[0]), name: String(r[3] || r[0]), role: String(r[2]).toLowerCase() === 'admin' ? 'admin' : 'user' }; } return { ok: false, error: 'Invalid user ID or password.' }; }
function submitEntry_(p) {
  if (!p.userId || !p.person || !p.type || Number(p.count) <= 0 || Number(p.count) % 1 !== 0) throw new Error('Name, type and a whole-number quantity greater than zero are required.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sheet = book_().getSheetByName(SHEETS.ENTRIES); const rowId = 'DS-' + String(Math.max(0, sheet.getLastRow())).padStart(4, '0'); const stamp = new Date();
    // The lock covers ID generation and append, so simultaneous users cannot overlap.
    sheet.appendRow([String(p.person).trim(), String(p.type).trim(), Number(p.count), String(p.remarks || '').trim(), String(p.userId), stamp, rowId]);
    return { ok: true, id: rowId, timestamp: stamp.toISOString() };
  } finally { lock.releaseLock(); }
}
function getEntries_(p) { const rows = book_().getSheetByName(SHEETS.ENTRIES).getDataRange().getValues().slice(1).filter(r => r[0]); const filtered = p.userId ? rows.filter(r => String(r[4]) === String(p.userId)) : rows; return { ok: true, entries: filtered.map(r => ({ person: String(r[0]), type: String(r[1]), count: Number(r[2]), remarks: String(r[3] || ''), userId: String(r[4]), timestamp: r[5], id: String(r[6]) })) }; }
function getTypes_() { return { ok: true, types: book_().getSheetByName(SHEETS.TYPES).getDataRange().getValues().slice(1).map(r => String(r[0]).trim()).filter(Boolean) }; }
function createUser_(p) { if (!p.userId || !p.name || !p.password) throw new Error('All user fields are required.'); const sheet = book_().getSheetByName(SHEETS.USERS); const rows = sheet.getDataRange().getValues(); if (rows.slice(1).some(r => String(r[0]).toLowerCase() === String(p.userId).toLowerCase())) throw new Error('User ID already exists.'); sheet.appendRow([String(p.userId).trim(), String(p.password), 'user', String(p.name).trim(), true]); return { ok: true, userId: String(p.userId).trim() }; }
function addSweetType_(p) { if (!p.value) throw new Error('Sweet type is required.'); const sheet = book_().getSheetByName(SHEETS.TYPES); const value = String(p.value).trim(); const rows = sheet.getDataRange().getValues().slice(1).map(r => String(r[0]).toLowerCase()); if (!rows.includes(value.toLowerCase())) sheet.appendRow([value]); return { ok: true, value: value }; }
function getUsers_() { return { ok: true, users: book_().getSheetByName(SHEETS.USERS).getDataRange().getValues().slice(1).filter(r => r[0]).map(r => ({ userId: String(r[0]), name: String(r[3] || r[0]), role: String(r[2] || 'user'), lastActive: r[4] === false ? 'Inactive' : 'Active' })) }; }
