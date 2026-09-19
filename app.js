/* MithaiFlow - plain HTML/CSS/JS build for GitHub Pages + Google Apps Script. */
const CONFIG = {
  // Replace this with your deployed Apps Script /exec URL.
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwgHHNrdIPy4SDnakc65k9GdWS9zyM11F7T46mbX_UkVfB1AgnWCPjqqoqFHsEIRbau1A/exec",
  SESSION_HOURS: 8,
};

let session = loadSession();
let entries = [];
let sweetTypes = [];
let users = [];
let currentView = "overview";
let timer;

const $ = (id) => document.getElementById(id);
const isLive = () => CONFIG.APPS_SCRIPT_URL && !CONFIG.APPS_SCRIPT_URL.includes("PASTE_YOUR");

function loadSession() {
  try {
    const value = JSON.parse(localStorage.getItem("mithaiflow-session"));
    return value && value.expiresAt > Date.now() ? value : null;
  } catch { return null; }
}
function saveSession(value) { session = value; localStorage.setItem("mithaiflow-session", JSON.stringify(value)); }
function clearSession() { session = null; localStorage.removeItem("mithaiflow-session"); }
function initials(name) { return name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase(); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function showToast(message) { const toast = $("toast"); toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 3500); }
function showError(message) { $("loginError").textContent = message; }

async function api(action, payload = {}) {
  if (!isLive()) throw new Error("Apps Script URL is not configured in app.js.");
  const body = new URLSearchParams({ action, ...payload });
  const response = await fetch(CONFIG.APPS_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body });
  if (!response.ok) throw new Error(`Apps Script returned ${response.status}`);
  const data = await response.json();
  if (data.ok === false) throw new Error(data.error || "Request failed");
  return data;
}

async function login(event) {
  event.preventDefault(); showError("");
  const userId = $("loginUserId").value.trim().toLowerCase(); const password = $("loginPassword").value;
  try {
    const result = await api("login", { userId, password });
    if (!result || result.ok === false) throw new Error(result && result.error ? result.error : "Invalid user ID or password.");
    saveSession({ userId: result.userId, name: result.name, role: result.role, expiresAt: Date.now() + CONFIG.SESSION_HOURS * 3600000 });
  } catch (error) { showError(error.message || "Could not connect to Google Sheets."); return; }
  openApp(); showToast(`Welcome back, ${session.name.split(" ")[0]}.`);
}

function openApp() {
  $("loginScreen").classList.add("hidden"); $("appScreen").classList.remove("hidden");
  $("userName").textContent = session.name; $("userRole").textContent = session.role === "admin" ? "Administrator" : "Department contributor"; $("userInitials").textContent = initials(session.name);
  $("settingsNav").classList.toggle("hidden", session.role !== "admin"); $("newEntryNav").classList.toggle("hidden", session.role === "admin");
  startSessionClock(); loadData().then(() => renderView(currentView)); renderView("overview");
}
async function loadData() {
  try {
    const types = await api("getTypes"); if (Array.isArray(types.types) && types.types.length) sweetTypes = types.types;
    if (session.role === "admin") { const result = await api("getEntries"); if (Array.isArray(result.entries)) entries = result.entries; const account = await api("getUsers"); if (Array.isArray(account.users)) users = account.users; }
    else { const result = await api("getEntries", { userId: session.userId }); if (Array.isArray(result.entries)) entries = result.entries; }
  } catch (error) { showToast(error.message || "Could not load data from Google Sheets."); }
}
function startSessionClock() { clearInterval(timer); timer = setInterval(() => { if (!session || session.expiresAt <= Date.now()) { clearSession(); clearInterval(timer); $("appScreen").classList.add("hidden"); $("loginScreen").classList.remove("hidden"); showToast("Your session expired. Please sign in again."); return; } updateSessionClock(); }, 30000); updateSessionClock(); }
function updateSessionClock() { const minutes = Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 60000)); const hours = Math.min(CONFIG.SESSION_HOURS, Math.ceil(minutes / 60)); $("sessionHours").textContent = `${hours}h remaining`; $("sessionProgress").style.width = `${Math.min(100, (minutes / (CONFIG.SESSION_HOURS * 60)) * 100)}%`; }

function changeView(view) { currentView = view; document.querySelectorAll(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.view === view)); ["overview", "entry", "settings"].forEach(name => $(name + "View").classList.toggle("hidden", name !== view)); $("viewLabel").textContent = view === "settings" ? "Admin portal" : session.role === "admin" ? "Admin portal" : "My workspace"; $("pageTitle").textContent = view === "entry" ? "Add a sweet requirement" : view === "settings" ? "Portal settings" : session.role === "admin" ? "Procurement overview" : `Good morning, ${session.name.split(" ")[0]}`; $("pageSubtitle").textContent = view === "entry" ? "One entry per person or distribution group. Keep quantities precise." : view === "settings" ? "Control who can access the portal and what sweet types appear in the form." : session.role === "admin" ? "A live view of every department's Diwali requirement." : "Your department's Diwali sweets plan, in one place."; renderView(view); }

function renderView(view) { if (view === "overview") renderOverview(); if (view === "entry") renderEntry(); if (view === "settings") renderSettings(); }
function visibleEntries() { return session.role === "admin" ? entries : entries.filter(entry => entry.userId === session.userId); }
function renderOverview() {
  const rows = visibleEntries(); const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0); const counts = rows.reduce((acc, row) => { acc[row.type] = (acc[row.type] || 0) + Number(row.count || 0); return acc; }, {}); const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]; const departments = new Set(entries.map(row => row.userId)).size;
  $("overviewView").innerHTML = `<div class="stats"><div class="stat"><div class="stat-icon">◉</div><small>${session.role === "admin" ? "Total pieces requested" : "My requested pieces"}</small><b>${total.toLocaleString()}</b><span>${session.role === "admin" ? "Across all departments" : "Across your entries"}</span></div><div class="stat"><div class="stat-icon">♧</div><small>${session.role === "admin" ? "Departments active" : "My entries"}</small><b>${String(session.role === "admin" ? departments : rows.length).padStart(2, "0")}</b><span>${session.role === "admin" ? "Contributing this season" : "Submitted this season"}</span></div><div class="stat"><div class="stat-icon">▥</div><small>Most requested</small><b>${escapeHtml(top ? top[0] : "—")}</b><span>${top ? `${top[1]} pieces requested` : "Awaiting first entry"}</span></div></div><div class="content-grid"><div class="panel"><div class="panel-head"><div><small class="kicker">${session.role === "admin" ? "All submissions" : "Your submissions"}</small><h2>Requirement ledger</h2></div><button class="small-button" id="refreshButton">↻ Refresh</button></div><div class="toolbar"><input id="searchInput" class="search" placeholder="Search entries…"><span style="color:var(--muted);font-size:11px">${rows.length} rows</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Person details</th><th>Sweet type</th><th>Quantity</th><th>Remarks</th><th>${session.role === "admin" ? "Submitted by" : "Time"}</th></tr></thead><tbody>${rows.length ? rows.map(entryRow).join("") : `<tr><td colspan="5" style="padding:45px;text-align:center;color:var(--muted)">No entries yet. Add your first requirement.</td></tr>`}</tbody></table></div></div><div class="note-column"><div class="note-card"><small class="kicker" style="color:var(--orange)">Planning note</small><h3>Small details make the celebration feel personal.</h3><p>Add a clear remark when an entry needs a special packing or dispatch note.</p><p style="color:var(--orange);font-weight:700">⌁ Thoughtful planning, less waste</p></div><div class="sync-card"><b>✓ &nbsp; Sheet sync ready</b><p>New records append safely</p></div></div></div>`;
  $("refreshButton").onclick = async () => { await loadData(); renderOverview(); showToast("Dashboard refreshed."); }; $("searchInput").oninput = event => { const query = event.target.value.toLowerCase(); document.querySelectorAll(".data-table tbody tr").forEach(row => row.style.display = row.textContent.toLowerCase().includes(query) ? "" : "none"); };
}
function entryRow(entry) { return `<tr><td><div class="person"><span class="avatar">${escapeHtml(initials(entry.person))}</span><div><b>${escapeHtml(entry.person)}</b><small style="display:block;color:var(--muted);font-size:10px">${escapeHtml(entry.id || "New entry")}</small></div></div></td><td><span class="chip"><i></i>${escapeHtml(entry.type)}</span></td><td><b style="font:700 17px 'Playfair Display',serif">${escapeHtml(entry.count)}</b> <small style="color:var(--muted);font-size:10px">pcs</small></td><td style="color:var(--muted);max-width:160px">${escapeHtml(entry.remarks || "—")}</td><td>${session.role === "admin" ? escapeHtml(entry.userName || entry.userId) : escapeHtml(entry.timestamp || "Just now")}</td></tr>`; }

function renderEntry() { $("entryView").innerHTML = `<div class="panel form-panel"><div class="panel-head"><div><small class="kicker">New requirement</small><h2>Who are we celebrating?</h2><p style="color:var(--muted);font-size:12px;line-height:1.7">Add the person or group details, choose the sweet, and enter the exact number of pieces needed.</p></div><b style="font:700 22px 'Playfair Display',serif;color:var(--orange)">01 <small style="font:12px 'DM Sans';color:#aaa">/ 01</small></b></div><form id="entryForm" class="form-body"><div class="form-grid"><div class="field"><label>Person details <em>*</em><input id="entryPerson" placeholder="e.g. Ananya Sharma"></label><small id="personError"></small></div><div class="field"><label>Sweet type <em>*</em><select id="entryType"><option value="">Choose a sweet</option>${sweetTypes.map(type => `<option>${escapeHtml(type)}</option>`).join("")}</select></label><small id="typeError"></small></div></div><div class="form-grid"><div class="field"><label>Quantity <em>*</em><input id="entryCount" type="number" min="1" step="1" placeholder="0"></label><small id="countError"></small></div><div class="field"><label>Remarks <span>(optional)</span><input id="entryRemarks" placeholder="Packing, dispatch, or dietary note"></label></div></div><div class="field"><label>Additional context <span>(optional)</span><textarea id="entryNotes" placeholder="Anything the procurement team should know?"></textarea></label></div><div class="form-actions"><span>✓ &nbsp; Saved to your department view and central ledger.</span><button type="submit">✓ &nbsp; Save requirement</button></div></form></div>`; $("entryForm").onsubmit = submitEntry; }
async function submitEntry(event) { event.preventDefault(); ["personError", "typeError", "countError"].forEach(id => $(id).textContent = ""); const person = $("entryPerson").value.trim(), type = $("entryType").value, count = Number($("entryCount").value), remarks = $("entryRemarks").value.trim() || $("entryNotes").value.trim(); let valid = true; if (!person) { $("personError").textContent = "Person details are required."; valid = false; } if (!type) { $("typeError").textContent = "Select a sweet type."; valid = false; } if (!Number.isInteger(count) || count <= 0) { $("countError").textContent = "Enter a whole number greater than zero."; valid = false; } if (!valid) return; const record = { person, type, count, remarks, userId: session.userId, userName: session.name }; try { const result = await api("submitEntry", record); record.id = result.id; record.timestamp = result.timestamp; entries.unshift(record); showToast("Entry saved successfully."); changeView("overview"); } catch (error) { showToast(error.message || "Entry was not saved. Please try again."); } }

function renderSettings() { $("settingsView").innerHTML = `<div class="settings-grid"><div class="panel"><div class="panel-head"><div><small class="kicker">Access management</small><h2>Users & roles</h2><p style="margin:8px 0 0;color:var(--muted);font-size:12px">Create contributor credentials that map to the User Sheet.</p></div></div><form id="userForm" class="settings-form"><input id="newUserId" placeholder="User ID" required><input id="newUserName" placeholder="Display name" required><input id="newUserPassword" type="password" placeholder="Password" required minlength="6"><button type="submit">＋ Create</button></form>${users.map(user => `<div class="settings-row"><div class="person"><span class="avatar">${escapeHtml(initials(user.name))}</span><div><b>${escapeHtml(user.name)}</b><small style="display:block;color:var(--muted);font-size:10px">${escapeHtml(user.userId)}</small></div></div><span class="role">${escapeHtml(user.role)}</span><small style="color:var(--muted)">${escapeHtml(user.lastActive || "Active")}</small></div>`).join("")}</div><div class="panel"><div class="panel-head"><div><small class="kicker">Dropdown master</small><h2>Sweet types</h2><p style="margin:8px 0 0;color:var(--muted);font-size:12px">These values appear in every new requirement form.</p></div></div><form id="typeForm" class="settings-form" style="grid-template-columns:1fr auto"><input id="newType" placeholder="Add a sweet type" required><button type="submit">＋ Add</button></form><div class="type-list">${sweetTypes.map(type => `<span class="type">${escapeHtml(type)}</span>`).join("")}</div></div></div>`; $("userForm").onsubmit = createUser; $("typeForm").onsubmit = addType; }
async function createUser(event) { event.preventDefault(); const userId = $("newUserId").value.trim(), name = $("newUserName").value.trim(), password = $("newUserPassword").value; if (!userId || !name || password.length < 6) return showToast("Enter valid user details and a 6+ character password."); try { await api("createUser", { userId, name, password }); users.unshift({ userId, name, role: "user", lastActive: "Just created" }); showToast("User access created."); renderSettings(); } catch (error) { showToast(error.message || "User was not created."); } }
async function addType(event) { event.preventDefault(); const value = $("newType").value.trim(); if (!value) return; try { await api("addSweetType", { value }); } catch {} if (!sweetTypes.includes(value)) sweetTypes.push(value); showToast(`${value} added to the dropdown.`); renderSettings(); }

$("loginForm").addEventListener("submit", login); $("logoutButton").addEventListener("click", () => { clearSession(); $("appScreen").classList.add("hidden"); $("loginScreen").classList.remove("hidden"); showToast("You have been signed out."); }); document.querySelectorAll(".nav-button").forEach(button => button.addEventListener("click", () => changeView(button.dataset.view)));
if (session) openApp();
