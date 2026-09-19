/* ============================================================
   SUS DIWALI SWEETS SURVEY — app.js
   Talks to the Apps Script backend (see config.js for the URL).
   ============================================================ */

/* ---- DUMMY LOGO (inline SVG) ----
   Replace by editing this string, or swap `${LOGO_SVG}` usages
   below for an <img src="your-logo.png"> once you have a real logo. */
const LOGO_SVG = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <circle cx="32" cy="32" r="31" fill="#d4a017"/>
  <path d="M14 42c6-4 10-10 18-10s12 6 18 10" stroke="#7a1230" stroke-width="3" fill="none" stroke-linecap="round"/>
  <ellipse cx="32" cy="44" rx="16" ry="7" fill="#7a1230"/>
  <path d="M32 10c3 6 2 10-1 13-3 3-3 7 1 9 4-2 4-6 1-9 3-3 2-9-1-13z" fill="#ff8c1a"/>
  <circle cx="32" cy="20" r="3" fill="#fff59d"/>
</svg>`;

/* ============================================================
   API — talks to the Apps Script Web App URL from config.js
   ============================================================ */
const API = {
  async call(action, payload) {
    const body = Object.assign({ action }, payload || {});
    // NOTE: deliberately no 'Content-Type: application/json' header.
    // Sending it triggers a CORS pre-flight (OPTIONS) request that
    // Apps Script Web Apps don't handle, and the call silently fails.
    // Leaving Content-Type as the browser default (text/plain) avoids
    // the pre-flight; Apps Script still reads the JSON body fine.
    const res = await fetch(CONFIG.WEB_APP_URL, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Network error (' + res.status + '). Please try again.');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Request failed.');
    return json.data;
  }
};

/* ============================================================
   APP STATE
   ============================================================ */
const STORE_KEY = 'sus_session_v1';
let state = {
  token: null, role: null, name: null, userId: null, frozen: false, expiry: null,
  dropdownOptions: [], entries: [], users: [], adminTab: 'users'
};
let sessionTimer = null;

function saveSession(){
  localStorage.setItem(STORE_KEY, JSON.stringify({
    token: state.token, role: state.role, name: state.name,
    userId: state.userId, frozen: state.frozen, expiry: state.expiry
  }));
}
function loadSession(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(!raw) return false;
    const s = JSON.parse(raw);
    if(!s.token || !s.expiry || Date.now() > s.expiry) { localStorage.removeItem(STORE_KEY); return false; }
    Object.assign(state, s);
    return true;
  }catch(e){ return false; }
}
function clearSession(){
  localStorage.removeItem(STORE_KEY);
  state = { token:null, role:null, name:null, userId:null, frozen:false, expiry:null, dropdownOptions:[], entries:[], users:[], adminTab:'users' };
  if(sessionTimer) clearTimeout(sessionTimer);
}
function armSessionTimer(){
  if(sessionTimer) clearTimeout(sessionTimer);
  const msLeft = state.expiry - Date.now();
  if(msLeft <= 0){ doLogout(true); return; }
  sessionTimer = setTimeout(() => doLogout(true), msLeft);
}

/* ============================================================
   LOADING HELPERS
   ============================================================ */
function showLoading(msg){
  let el = document.getElementById('loadingOverlay');
  if(!el){
    el = document.createElement('div');
    el.id = 'loadingOverlay';
    el.className = 'loading-overlay';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="box"><div class="dot"></div><span>${msg||'Please wait…'}</span></div>`;
  el.style.display = 'flex';
}
function hideLoading(){
  const el = document.getElementById('loadingOverlay');
  if(el) el.style.display = 'none';
}

/* ============================================================
   RENDER ROOT
   ============================================================ */
function render(){
  const app = document.getElementById('app');
  if(!state.token){
    app.innerHTML = renderLogin();
    attachLoginEvents();
  } else if(state.role === 'Admin'){
    app.innerHTML = renderAdmin();
    attachAdminEvents();
  } else {
    app.innerHTML = renderUser();
    attachUserEvents();
  }
}

/* ============================================================
   LOGIN VIEW
   ============================================================ */
function renderLogin(){
  return `
  <div class="login-wrap">
    <div class="login-card">
      <div class="brand-logo">${LOGO_SVG}</div>
      <h1>SUS Diwali Sweets Survey</h1>
      <p class="sub">Department wise sweets requirement collection</p>
      <div id="loginError"></div>
      <form id="loginForm">
        <div class="field">
          <label>User ID <span class="req">*</span></label>
          <input type="text" id="loginUserId" autocomplete="username" required>
        </div>
        <div class="field">
          <label>Password <span class="req">*</span></label>
          <input type="password" id="loginPassword" autocomplete="current-password" required>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%; justify-content:center;" id="loginBtn">Login</button>
      </form>
      <p class="hint" style="text-align:center; margin-top:16px;">Use the User ID and Password provided by your administrator.</p>
    </div>
  </div>`;
}
function attachLoginEvents(){
  document.getElementById('loginForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const userId = document.getElementById('loginUserId').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Logging in…';
    document.getElementById('loginError').innerHTML = '';
    try{
      const res = await API.call('login', { userId, password });
      if(res.success){
        state.token = res.token; state.role = res.role; state.name = res.name;
        state.userId = res.userId; state.frozen = res.frozen; state.expiry = res.expiry;
        saveSession(); armSessionTimer();
        await loadDataForRole();
        render();
      } else {
        document.getElementById('loginError').innerHTML = `<div class="banner banner-error">${escapeHtml(res.message)}</div>`;
        btn.disabled = false; btn.innerHTML = 'Login';
      }
    }catch(err){
      document.getElementById('loginError').innerHTML = `<div class="banner banner-error">${escapeHtml(err.message||String(err))}</div>`;
      btn.disabled = false; btn.innerHTML = 'Login';
    }
  });
}

async function loadDataForRole(){
  if(state.role === 'Admin'){
    const [opts, entries, users] = await Promise.all([
      API.call('getDropdownOptions', { token: state.token }),
      API.call('getAllEntries', { token: state.token }),
      API.call('getAllUsers', { token: state.token })
    ]);
    state.dropdownOptions = opts; state.entries = entries; state.users = users;
  } else {
    const [opts, entries] = await Promise.all([
      API.call('getDropdownOptions', { token: state.token }),
      API.call('getMyEntries', { token: state.token })
    ]);
    state.dropdownOptions = opts; state.entries = entries;
  }
}

/* ============================================================
   HEADER (shared)
   ============================================================ */
function renderHeader(){
  const roleLabel = state.role === 'Admin' ? 'Administrator' : 'User';
  return `
  <div class="topbar">
    <div class="brand">
      <div class="brand-logo">${LOGO_SVG}</div>
      <div>
        <h1>SUS Diwali Sweets Survey</h1>
        <div class="subtitle">${roleLabel} Portal</div>
      </div>
    </div>
    <div class="user-chip">
      <span class="pill">👤 ${escapeHtml(state.name)} (${escapeHtml(state.userId)})</span>
      ${state.frozen && state.role!=='Admin' ? '<span class="pill" style="background:#fdecea;color:#7a1a12;">🔒 View Only</span>' : ''}
      <button class="btn btn-outline btn-sm" id="logoutBtn">Logout</button>
    </div>
  </div>`;
}

/* ============================================================
   USER DASHBOARD
   ============================================================ */
function renderUser(){
  return `
    ${renderHeader()}
    <div class="container">
      <div id="userBanner"></div>
      ${!state.frozen ? renderEntryForm() : ''}
      <div class="card">
        <div class="toolbar">
          <h2 style="margin:0;">🍬 My Entries</h2>
          <input class="search-box" id="userSearch" placeholder="Search by name / type…">
        </div>
        <div id="userEntriesGrid"></div>
      </div>
    </div>
    <div class="footer-note">SUS Diwali Sweets Survey · Session auto-expires 8 hours after login</div>
  `;
}

function renderEntryForm(editEntry){
  const isEdit = !!editEntry;
  return `
  <div class="card">
    <h2>${isEdit ? '✏️ Edit Entry' : '➕ Add New Entry'}</h2>
    <div id="entryFormError"></div>
    <form id="entryForm">
      <div class="form-grid">
        <div class="field span2">
          <label>Person / Employee Name <span class="req">*</span></label>
          <input type="text" id="f_name" required value="${isEdit ? escapeHtml(editEntry.Name) : ''}">
        </div>
        <div class="field">
          <label>Type of Sweet <span class="req">*</span></label>
          <select id="f_type" required>
            <option value="">-- Select --</option>
            ${state.dropdownOptions.map(o => `<option value="${escapeHtml(o)}" ${isEdit && editEntry.Type===o ? 'selected':''}>${escapeHtml(o)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Count <span class="req">*</span></label>
          <input type="number" id="f_count" min="1" step="1" required value="${isEdit ? editEntry.Count : ''}">
        </div>
        <div class="field span2" style="grid-column:1 / -1;">
          <label>Remarks (optional)</label>
          <textarea id="f_remarks" rows="2">${isEdit ? escapeHtml(editEntry.Remarks||'') : ''}</textarea>
        </div>
      </div>
      <div style="margin-top:14px; display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary" id="entrySubmitBtn">${isEdit ? 'Save Changes' : 'Add Entry'}</button>
        ${isEdit ? '<button type="button" class="btn btn-outline" id="cancelEditBtn" style="color:#7a1230;border-color:#7a1230;">Cancel</button>' : ''}
        ${!isEdit ? '<span class="hint" style="align-self:center;">Tip: form stays open so you can add multiple entries quickly.</span>' : ''}
      </div>
    </form>
  </div>`;
}

function entryCardHtml(e, canEdit){
  const dt = new Date(e.Timestamp);
  return `
  <div class="entry-card" data-id="${e.ID}">
    ${canEdit ? `<div class="actions">
      <button class="icon-btn editEntryBtn" title="Edit" data-id="${e.ID}">✏️</button>
      <button class="icon-btn deleteEntryBtn" title="Delete" data-id="${e.ID}">🗑️</button>
    </div>` : ''}
    <span class="type-badge">${escapeHtml(e.Type)}</span>
    <h3>${escapeHtml(e.Name)}</h3>
    <div class="count">Count: ${e.Count}</div>
    ${e.Remarks ? `<div class="remarks">"${escapeHtml(e.Remarks)}"</div>` : ''}
    <div class="meta">${dt.toLocaleString()} ${e.UserName ? '· '+escapeHtml(e.UserName) : ''}</div>
  </div>`;
}

function renderUserEntriesGrid(filterText){
  const term = (filterText||'').toLowerCase();
  let list = state.entries;
  if(term) list = list.filter(e => (e.Name+e.Type+(e.Remarks||'')).toLowerCase().includes(term));
  const grid = document.getElementById('userEntriesGrid');
  if(!grid) return;
  if(list.length === 0){
    grid.innerHTML = `<div class="empty-state">No entries yet. ${state.frozen ? '' : 'Add your first entry above.'}</div>`;
    return;
  }
  grid.innerHTML = `<div class="entries-grid">${list.map(e => entryCardHtml(e, !state.frozen)).join('')}</div>`;
  grid.querySelectorAll('.editEntryBtn').forEach(b => b.addEventListener('click', () => startEditEntry(b.dataset.id)));
  grid.querySelectorAll('.deleteEntryBtn').forEach(b => b.addEventListener('click', () => confirmDeleteEntry(b.dataset.id)));
}

function startEditEntry(id){
  const entry = state.entries.find(e => e.ID === id);
  if(!entry) return;
  const container = document.querySelector('.container');
  const formCardHtml = renderEntryForm(entry);
  const existingForm = container.querySelector('.card');
  const wrap = document.createElement('div');
  wrap.innerHTML = formCardHtml;
  existingForm.replaceWith(...wrap.children);
  attachEntryFormEvents(entry);
  window.scrollTo({top:0, behavior:'smooth'});
}

function attachUserEvents(){
  document.getElementById('logoutBtn').addEventListener('click', () => confirmLogout());
  if(!state.frozen) attachEntryFormEvents(null);
  renderUserEntriesGrid('');
  document.getElementById('userSearch').addEventListener('input', (e) => renderUserEntriesGrid(e.target.value));
  if(state.frozen){
    document.getElementById('userBanner').innerHTML = `<div class="banner banner-warn">🔒 Your account is in VIEW ONLY mode. You can see your entries but cannot add, edit or delete. Contact the admin if this is unexpected.</div>`;
  }
}

function attachEntryFormEvents(editEntry){
  const form = document.getElementById('entryForm');
  if(!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('entryFormError');
    errBox.innerHTML = '';
    const data = {
      Name: document.getElementById('f_name').value.trim(),
      Type: document.getElementById('f_type').value,
      Count: document.getElementById('f_count').value,
      Remarks: document.getElementById('f_remarks').value.trim()
    };
    const clientErrors = clientValidateEntry(data);
    if(clientErrors.length){
      errBox.innerHTML = `<div class="banner banner-error">${clientErrors.join(' ')}</div>`;
      return;
    }
    const btn = document.getElementById('entrySubmitBtn');
    btn.disabled = true; const originalText = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span> Saving…';
    try{
      if(editEntry){
        await API.call('updateEntry', { token: state.token, id: editEntry.ID, entry: data });
      } else {
        await API.call('addEntry', { token: state.token, entry: data });
      }
      state.entries = await API.call('getMyEntries', { token: state.token });
      render();
    }catch(err){
      errBox.innerHTML = `<div class="banner banner-error">${escapeHtml(err.message||String(err))}</div>`;
      btn.disabled = false; btn.innerHTML = originalText;
    }
  });
  const cancelBtn = document.getElementById('cancelEditBtn');
  if(cancelBtn) cancelBtn.addEventListener('click', () => render());
}

function clientValidateEntry(data){
  const errors = [];
  if(!data.Name) errors.push('Person Name is required.');
  if(!data.Type) errors.push('Please select a Type.');
  if(data.Count === '' || isNaN(data.Count)) errors.push('Count is required.');
  else if(Number(data.Count) <= 0) errors.push('Count must be greater than zero.');
  return errors;
}

function confirmDeleteEntry(id){
  showModal('Delete this entry?', 'This action cannot be undone.', async () => {
    showLoading('Deleting…');
    try{
      await API.call('deleteEntry', { token: state.token, id });
      state.entries = await API.call('getMyEntries', { token: state.token });
      hideLoading();
      render();
    }catch(err){ hideLoading(); alert(err.message||String(err)); }
  });
}

/* ============================================================
   ADMIN DASHBOARD
   ============================================================ */
function renderAdmin(){
  const totalEntries = state.entries.length;
  const totalCount = state.entries.reduce((s,e)=>s+Number(e.Count||0),0);
  const totalUsers = state.users.filter(u=>u.Role==='User').length;
  const frozenUsers = state.users.filter(u=>u.Role==='User' && u.Frozen).length;
  return `
    ${renderHeader()}
    <div class="container">
      <div class="stat-row">
        <div class="stat-box"><div class="num">${totalEntries}</div><div class="lbl">Total Entries</div></div>
        <div class="stat-box"><div class="num">${totalCount}</div><div class="lbl">Total Sweets Count</div></div>
        <div class="stat-box"><div class="num">${totalUsers}</div><div class="lbl">Users</div></div>
        <div class="stat-box"><div class="num">${frozenUsers}</div><div class="lbl">Frozen (View Only)</div></div>
      </div>
      <div class="tabs">
        <button class="tab-btn ${state.adminTab==='users'?'active':''}" data-tab="users">👥 Users</button>
        <button class="tab-btn ${state.adminTab==='dropdown'?'active':''}" data-tab="dropdown">🍭 Sweet Types</button>
        <button class="tab-btn ${state.adminTab==='entries'?'active':''}" data-tab="entries">📋 All Entries</button>
      </div>
      <div id="adminTabContent"></div>
    </div>
    <div class="footer-note">SUS Diwali Sweets Survey · Admin Portal</div>
  `;
}

function attachAdminEvents(){
  document.getElementById('logoutBtn').addEventListener('click', () => confirmLogout());
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
    state.adminTab = b.dataset.tab; render();
  }));
  renderAdminTabContent();
}

function renderAdminTabContent(){
  const el = document.getElementById('adminTabContent');
  if(state.adminTab === 'users') el.innerHTML = renderUsersTab();
  else if(state.adminTab === 'dropdown') el.innerHTML = renderDropdownTab();
  else el.innerHTML = renderEntriesTab();
  attachTabContentEvents();
}

/* ---- Users Tab ---- */
function renderUsersTab(){
  return `
  <div class="card">
    <h2>➕ Create New User</h2>
    <div id="createUserError"></div>
    <form id="createUserForm">
      <div class="form-grid">
        <div class="field"><label>User ID <span class="req">*</span></label><input type="text" id="nu_userid" required></div>
        <div class="field"><label>Password <span class="req">*</span></label><input type="password" id="nu_password" required></div>
        <div class="field"><label>Display Name</label><input type="text" id="nu_name"></div>
        <div class="field"><label>Role <span class="req">*</span></label>
          <select id="nu_role"><option value="User">User</option><option value="Admin">Admin</option></select>
        </div>
      </div>
      <button type="submit" class="btn btn-primary" style="margin-top:8px;" id="createUserBtn">Create User</button>
    </form>
  </div>

  <div class="card">
    <div class="toolbar">
      <h2 style="margin:0;">👥 All Users</h2>
      <div class="row-flex">
        <span class="hint" style="margin:0;">Freeze all users (view-only):</span>
        <label class="switch"><input type="checkbox" id="freezeAllToggle" ${state.users.filter(u=>u.Role==='User').every(u=>u.Frozen) && state.users.some(u=>u.Role==='User') ? 'checked':''}><span class="slider"></span></label>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>User ID</th><th>Name</th><th>Role</th><th>Status</th><th>Frozen</th><th>Actions</th></tr></thead>
        <tbody>
          ${state.users.map(u => `
            <tr data-userid="${escapeHtml(u.UserID)}">
              <td>${escapeHtml(u.UserID)}</td>
              <td>${escapeHtml(u.Name||'')}</td>
              <td><span class="tag ${u.Role==='Admin'?'tag-admin':'tag-user'}">${u.Role}</span></td>
              <td>${u.Frozen ? '<span class="tag tag-frozen">View Only</span>' : '<span class="tag tag-active">Active</span>'}</td>
              <td>${u.Role==='Admin' ? '—' : `<label class="switch"><input type="checkbox" class="userFreezeToggle" data-userid="${escapeHtml(u.UserID)}" ${u.Frozen?'checked':''}><span class="slider"></span></label>`}</td>
              <td>
                <button class="btn btn-outline btn-sm resetPwBtn" data-userid="${escapeHtml(u.UserID)}" style="color:#7a1230;border-color:#7a1230;">Reset Pwd</button>
                <button class="btn btn-danger btn-sm deleteUserBtn" data-userid="${escapeHtml(u.UserID)}">Delete</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

/* ---- Dropdown Tab ---- */
function renderDropdownTab(){
  return `
  <div class="card">
    <h2>➕ Add Sweet Type</h2>
    <div id="addTypeError"></div>
    <form id="addTypeForm" style="display:flex; gap:10px; flex-wrap:wrap;">
      <input type="text" id="newTypeInput" placeholder="e.g. Gulab Jamun" style="flex:1; min-width:200px;" required>
      <button type="submit" class="btn btn-primary">Add</button>
    </form>
  </div>
  <div class="card">
    <h2>🍭 Current Sweet Types (${state.dropdownOptions.length})</h2>
    <div class="entries-grid">
      ${state.dropdownOptions.map(o => `
        <div class="entry-card" style="padding:12px 14px;">
          <div class="row-flex" style="justify-content:space-between;">
            <strong>${escapeHtml(o)}</strong>
            <button class="icon-btn deleteTypeBtn" data-type="${escapeHtml(o)}" title="Delete">🗑️</button>
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

/* ---- Entries Tab ---- */
function renderEntriesTab(){
  return `
  <div class="card">
    <div class="toolbar">
      <h2 style="margin:0;">📋 All Survey Entries</h2>
      <input class="search-box" id="adminSearch" placeholder="Search name / type / user…">
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date/Time</th><th>Submitted By</th><th>Name</th><th>Type</th><th>Count</th><th>Remarks</th><th>Actions</th></tr></thead>
        <tbody id="adminEntriesBody"></tbody>
      </table>
    </div>
  </div>`;
}
function renderAdminEntriesBody(filterText){
  const term = (filterText||'').toLowerCase();
  let list = state.entries;
  if(term) list = list.filter(e => (e.Name+e.Type+e.UserName+e.UserID+(e.Remarks||'')).toLowerCase().includes(term));
  const body = document.getElementById('adminEntriesBody');
  if(!body) return;
  if(list.length === 0){ body.innerHTML = `<tr><td colspan="7" class="empty-state">No entries found.</td></tr>`; return; }
  body.innerHTML = list.map(e => `
    <tr>
      <td>${new Date(e.Timestamp).toLocaleString()}</td>
      <td>${escapeHtml(e.UserName)} <span class="hint">(${escapeHtml(e.UserID)})</span></td>
      <td>${escapeHtml(e.Name)}</td>
      <td>${escapeHtml(e.Type)}</td>
      <td>${e.Count}</td>
      <td class="remarks-cell">${escapeHtml(e.Remarks||'')}</td>
      <td>
        <button class="btn btn-outline btn-sm adminEditEntryBtn" data-id="${e.ID}" style="color:#7a1230;border-color:#7a1230;">Edit</button>
        <button class="btn btn-danger btn-sm adminDeleteEntryBtn" data-id="${e.ID}">Delete</button>
      </td>
    </tr>`).join('');
  body.querySelectorAll('.adminDeleteEntryBtn').forEach(b => b.addEventListener('click', () => confirmAdminDeleteEntry(b.dataset.id)));
  body.querySelectorAll('.adminEditEntryBtn').forEach(b => b.addEventListener('click', () => openAdminEditEntryModal(b.dataset.id)));
}

function confirmAdminDeleteEntry(id){
  showModal('Delete this entry?', 'This action cannot be undone.', async () => {
    showLoading('Deleting…');
    try{
      await API.call('deleteEntry', { token: state.token, id });
      state.entries = await API.call('getAllEntries', { token: state.token });
      hideLoading(); render();
    }catch(err){ hideLoading(); alert(err.message||String(err)); }
  });
}

function openAdminEditEntryModal(id){
  const entry = state.entries.find(e => e.ID === id);
  if(!entry) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Edit Entry</h3>
      <div id="modalEditError"></div>
      <div class="field"><label>Name</label><input type="text" id="me_name" value="${escapeHtml(entry.Name)}"></div>
      <div class="field"><label>Type</label>
        <select id="me_type">${state.dropdownOptions.map(o=>`<option ${o===entry.Type?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Count</label><input type="number" min="1" id="me_count" value="${entry.Count}"></div>
      <div class="field"><label>Remarks</label><textarea id="me_remarks" rows="2">${escapeHtml(entry.Remarks||'')}</textarea></div>
      <div class="actions">
        <button class="btn btn-outline" id="modalCancelBtn">Cancel</button>
        <button class="btn btn-primary" id="modalSaveBtn">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#modalCancelBtn').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#modalSaveBtn').addEventListener('click', async () => {
    const data = {
      Name: overlay.querySelector('#me_name').value.trim(),
      Type: overlay.querySelector('#me_type').value,
      Count: overlay.querySelector('#me_count').value,
      Remarks: overlay.querySelector('#me_remarks').value.trim()
    };
    const errs = clientValidateEntry(data);
    if(errs.length){ overlay.querySelector('#modalEditError').innerHTML = `<div class="banner banner-error">${errs.join(' ')}</div>`; return; }
    try{
      await API.call('updateEntry', { token: state.token, id, entry: data });
      state.entries = await API.call('getAllEntries', { token: state.token });
      overlay.remove(); render();
    }catch(err){
      overlay.querySelector('#modalEditError').innerHTML = `<div class="banner banner-error">${escapeHtml(err.message||String(err))}</div>`;
    }
  });
}

/* ---- Shared modal for confirmations ---- */
function showModal(title, message, onConfirm){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${escapeHtml(title)}</h3>
      <p style="color:var(--muted); font-size:13.5px;">${escapeHtml(message)}</p>
      <div class="actions">
        <button class="btn btn-outline" id="modalNoBtn">Cancel</button>
        <button class="btn btn-danger" id="modalYesBtn">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#modalNoBtn').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#modalYesBtn').addEventListener('click', () => { overlay.remove(); onConfirm(); });
}

function attachTabContentEvents(){
  if(state.adminTab === 'users'){
    document.getElementById('createUserForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('createUserError'); errBox.innerHTML='';
      const payload = {
        UserID: document.getElementById('nu_userid').value.trim(),
        Password: document.getElementById('nu_password').value,
        Name: document.getElementById('nu_name').value.trim(),
        Role: document.getElementById('nu_role').value
      };
      const btn = document.getElementById('createUserBtn');
      btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span> Creating…';
      try{
        state.users = await API.call('createUser', { token: state.token, user: payload });
        render();
      }catch(err){
        errBox.innerHTML = `<div class="banner banner-error">${escapeHtml(err.message||String(err))}</div>`;
        btn.disabled = false; btn.innerHTML = orig;
      }
    });
    document.querySelectorAll('.userFreezeToggle').forEach(cb => cb.addEventListener('change', async () => {
      showLoading('Updating…');
      try{
        state.users = await API.call('updateUser', { token: state.token, userId: cb.dataset.userid, updates: { Frozen: cb.checked } });
        hideLoading(); render();
      }catch(err){ hideLoading(); alert(err.message||String(err)); cb.checked = !cb.checked; }
    }));
    document.getElementById('freezeAllToggle').addEventListener('change', async (e) => {
      const val = e.target.checked;
      showModal(val ? 'Freeze ALL users?' : 'Unfreeze ALL users?',
        val ? 'All non-admin users will be switched to view-only mode immediately.' : 'All non-admin users will regain full add/edit/delete access.',
        async () => {
          showLoading('Applying to all users…');
          try{ state.users = await API.call('freezeAll', { token: state.token, freeze: val }); hideLoading(); render(); }
          catch(err){ hideLoading(); alert(err.message||String(err)); render(); }
        });
      // revert visual state until confirmed via re-render
      e.target.checked = !val;
    });
    document.querySelectorAll('.deleteUserBtn').forEach(b => b.addEventListener('click', () => {
      showModal('Delete this user?', 'Their login will stop working immediately. Existing entries stay in records.', async () => {
        showLoading('Deleting…');
        try{ state.users = await API.call('deleteUser', { token: state.token, userId: b.dataset.userid }); hideLoading(); render(); }
        catch(err){ hideLoading(); alert(err.message||String(err)); }
      });
    }));
    document.querySelectorAll('.resetPwBtn').forEach(b => b.addEventListener('click', () => {
      const pw = prompt('Enter new password for ' + b.dataset.userid + ' (min 4 characters):');
      if(!pw) return;
      (async () => {
        showLoading('Updating password…');
        try{ state.users = await API.call('updateUser', { token: state.token, userId: b.dataset.userid, updates: { Password: pw } }); hideLoading(); render(); alert('Password updated.'); }
        catch(err){ hideLoading(); alert(err.message||String(err)); }
      })();
    }));
  }
  else if(state.adminTab === 'dropdown'){
    document.getElementById('addTypeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('addTypeError'); errBox.innerHTML='';
      const val = document.getElementById('newTypeInput').value.trim();
      try{ state.dropdownOptions = await API.call('addDropdownOption', { token: state.token, value: val }); render(); }
      catch(err){ errBox.innerHTML = `<div class="banner banner-error">${escapeHtml(err.message||String(err))}</div>`; }
    });
    document.querySelectorAll('.deleteTypeBtn').forEach(b => b.addEventListener('click', () => {
      showModal('Delete this sweet type?', 'Existing entries using this type will be unaffected, but it will no longer be selectable.', async () => {
        showLoading('Deleting…');
        try{ state.dropdownOptions = await API.call('deleteDropdownOption', { token: state.token, value: b.dataset.type }); hideLoading(); render(); }
        catch(err){ hideLoading(); alert(err.message||String(err)); }
      });
    }));
  }
  else if(state.adminTab === 'entries'){
    renderAdminEntriesBody('');
    document.getElementById('adminSearch').addEventListener('input', (e) => renderAdminEntriesBody(e.target.value));
  }
}

/* ============================================================
   LOGOUT
   ============================================================ */
function confirmLogout(){
  showModal('Logout?', 'You will need to log in again to continue.', () => doLogout(false));
}
function doLogout(expired){
  clearSession();
  render();
  if(expired){
    setTimeout(() => alert('Your session has expired after 8 hours. Please log in again.'), 100);
  }
}

/* ============================================================
   UTIL
   ============================================================ */
function escapeHtml(str){
  if(str === undefined || str === null) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============================================================
   INIT
   ============================================================ */
function showConfigMissing(){
  document.getElementById('app').innerHTML = `
    <div class="connect-error">
      <div class="brand-logo" style="width:60px;height:60px;margin:0 auto 14px;">${LOGO_SVG}</div>
      <h2 style="color:var(--maroon-dark);">Almost there — one setting left</h2>
      <p style="color:var(--muted); font-size:14px;">
        Open <code>config.js</code> in this website's files and paste your deployed
        Apps Script Web App URL into <code>WEB_APP_URL</code>. See the README for the
        3-step setup.
      </p>
    </div>`;
}

async function init(){
  if(!CONFIG || !CONFIG.WEB_APP_URL || CONFIG.WEB_APP_URL.indexOf('PASTE_YOUR') === 0){
    showConfigMissing();
    return;
  }
  if(loadSession()){
    armSessionTimer();
    render(); // render shell first
    showLoading('Loading your data…');
    try{
      await loadDataForRole();
      hideLoading();
      render();
    }catch(err){
      hideLoading();
      // token might be stale server-side (secret rotated) -> force logout
      clearSession();
      render();
    }
  } else {
    render();
  }
}
init();
