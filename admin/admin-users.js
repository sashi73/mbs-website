/* GKH Project Champ: Users & access.
   The super user (the Netlify login, ADMIN_USERNAME / ADMIN_PASSWORD) makes every login: their email, a password the super user
   chooses, the role, then a confirm step, then the permissions (modules and projects). Four kinds of people:
     Super user (everything, always), Project manager (admin: every module, every project),
     Contractor and Project personnel (limited: the modules and projects the super user gives them),
     Google sign-ins (view only; can only be switched off or on).
   The server enforces all of it; the menu hides what a login can't open. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, toast = M.toast, fail = M.fail, $ = M.$;
  var V = function () { return M.view(); };
  var S = { data: null, plans: [] };
  var MODS = [['projects', 'Projects', 'Programs, projects, plans, Gantt, Board, costing, risks, change control, Project Intelligence'], ['crm', 'Enquiries & visitors', 'Enquiries and website visitors'],
    ['data', 'Ask AI & data', 'Ask AI, SQL wizard and reports, activity log'], ['users', 'Users & access', 'This page (only the super user can change it)']];
  var KIND = {
    'Project manager': { ic: '🧭', cls: 'pm', about: 'Admin: every module and every project. Can see who has access, but only the super user changes it.' },
    Contractor: { ic: '🛠', cls: 'ct', about: 'Limited: Projects only, and only the projects you tick.' },
    'Project personnel': { ic: '👥', cls: 'pp', about: 'Limited: Projects and Ask AI, on all projects or only the ones you tick.' },
    Custom: { ic: '⚙', cls: 'cu', about: 'You set each module yourself.' } };
  var LVI = { none: 'No access', view: '👁 View', edit: '✎ Edit' };
  var isSuper = function () { return !!(M.me || {}).owner; };
  var when = function (t) { return t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never'; };
  var roleMods = function (r) { var x = (S.data.roles || []).filter(function (y) { return y.name === r; })[0]; return Object.assign({}, x && x.mods); };
  var lv = function (v) { return '<span class="us-lv ' + (v || 'none') + '" title="' + esc(LVI[v || 'none']) + '">' + (v === 'edit' ? '✎' : v === 'view' ? '👁' : '–') + '</span>'; };
  var pwBad = function (pw) { return pw.length < 10 ? 'Use at least 10 characters' : !/[a-z]/i.test(pw) || !/\d/.test(pw) ? 'Use letters and at least one number' : ''; };

  function load() { return Promise.all([api('userList'), api('planList', {}).catch(function () { return { plans: [] }; })]).then(function (r) { S.data = r[0]; S.plans = r[1].plans || []; }); }
  function page() { return load().then(draw); }
  function projText(u) {
    if (u.kind === 'google') return 'All (view only)';
    if (u.role === 'Project manager' || u.projAll || u.kind === 'person') return 'All projects';
    var L = (u.projects || []).map(function (c) { var p = S.plans.filter(function (x) { return x.core === c; })[0]; return p ? p.name : c; });
    return L.length ? L.slice(0, 3).join(', ') + (L.length > 3 ? ' +' + (L.length - 3) : '') : '<span class="bad">None yet</span>';
  }
  function badge(u) {
    if (u.kind === 'google') return '<span class="us-role us-r-g">G Google · view only</span>';
    var k = KIND[u.role]; return '<span class="us-role us-r-' + (k ? k.cls : 'old') + '">' + (k ? k.ic + ' ' : '') + esc(u.role) + '</span>' + (u.kind === 'subbie' || u.kind === 'person' ? ' <small class="muted" title="Made before the new Users & access: open Permissions to move it over">(older login)</small>' : '');
  }

  function draw() {
    var d = S.data, U = d.users, me = M.me || {};
    var count = function (r) { return U.filter(function (u) { return u.kind === 'google' ? r === 'g' : u.role === r; }).length; };
    V().innerHTML = '<div class="row us-head"><div><h2 style="margin:0">🔐 Users &amp; access</h2><p class="muted" style="margin:2px 0 0;font-size:13px">' + (isSuper() ? 'You are the <b>super user</b>: you make each login with the person\'s email and a password you choose, then set what they can use.' : 'Who can sign in and what each person can use. Only the super user can change it.') + '</p></div><span class="sp"></span>' +
        (isSuper() ? '<button class="btn btn-gold" id="usNew" type="button">＋ New user</button>' : '<span class="us-role us-r-pm">View only</span>') + '</div>' +
      '<div class="us-kpis">' + [['⭐', 'Super user', 1], ['🧭', 'Project managers', count('Project manager')], ['🛠', 'Contractors', count('Contractor')], ['👥', 'Project personnel', count('Project personnel')], ['G', 'Google (view only)', count('g')]].map(function (k) { return '<div class="us-kpi"><span>' + k[0] + '</span><b>' + k[2] + '</b><small>' + k[1] + '</small></div>'; }).join('') + '</div>' +
      '<div class="card"><div class="table-wrap"><table class="sc-table us-table"><thead><tr><th>Person</th><th>Role</th><th>Projects</th>' + MODS.map(function (m) { return '<th class="us-m" title="' + esc(m[1] + ': ' + m[2]) + '">' + esc(m[1]) + '</th>'; }).join('') + '<th>Last sign-in</th><th></th></tr></thead><tbody>' +
        '<tr class="us-owner"><td><b>Super user</b><br><small class="muted">' + (me.owner ? esc(me.user) + ' · ' : '') + 'the Netlify login (ADMIN_USERNAME)</small></td><td><span class="us-role owner">⭐ Super user</span></td><td>All projects</td>' + MODS.map(function () { return '<td class="us-m">' + lv('edit') + '</td>'; }).join('') + '<td class="muted">–</td><td></td></tr>' +
        U.map(function (u) {
          return '<tr data-uid="' + esc(u.id) + '" class="' + (u.active ? '' : 'tdone') + '"><td><b>' + esc(u.name) + '</b>' + (u.active ? '' : ' <span class="bad" style="font-size:11.5px">· switched off</span>') + '<br><small class="muted">' + esc(u.username) + (u.mustChange2 ? ' · sets own password at first sign-in' : '') + '</small></td>' +
            '<td>' + badge(u) + '</td><td class="us-pj">' + projText(u) + '</td>' + MODS.map(function (m) { return '<td class="us-m">' + lv((u.mods || {})[m[0]]) + '</td>'; }).join('') +
            '<td class="nowrap muted" style="font-size:12.5px">' + esc(when(u.lastLogin)) + '</td><td class="nowrap">' + (isSuper() ? '<button class="btn btn-sm" data-uperm type="button">' + (u.kind === 'google' ? 'On / off' : '⚙ Permissions') + '</button>' + (u.kind === 'google' ? '' : ' <button class="btn btn-sm" data-upw type="button" title="Set a new password">🔑</button>') + ' <button class="btn btn-sm us-del" data-udel type="button" title="Delete this login">🗑</button>' : '') + '</td></tr>';
        }).join('') +
        (U.length ? '' : '<tr><td colspan="9"><div class="empty">No logins yet: only the super user can sign in.' + (isSuper() ? ' Press <b>＋ New user</b>.' : '') + '</div></td></tr>') +
        '</tbody></table></div><p class="muted" style="font-size:12.5px;margin:10px 0 0">✎ Edit · 👁 View · – No access (hidden from their menu). Changing someone\'s permissions, switching them off or setting a new password signs them out straight away.</p></div>' +
      '<div class="card" style="margin-top:14px"><h2>Who gets what</h2><div class="us-kinds">' +
        '<div class="us-k"><b>⭐ Super user</b><span>The username and password set in Netlify. Everything, always: makes logins, sets passwords and permissions. Nobody can lock it out.</span></div>' +
        ['Project manager', 'Contractor', 'Project personnel'].map(function (r) { var m = roleMods(r); return '<div class="us-k"><b>' + KIND[r].ic + ' ' + esc(r) + '</b><span>' + esc(KIND[r].about) + '</span><div class="us-k-m">' + MODS.map(function (x) { return '<i>' + lv(m[x[0]]) + ' ' + esc(x[1]) + '</i>'; }).join('') + '</div></div>'; }).join('') +
        '<div class="us-k"><b>G Google sign-in</b><span>Anyone who signs in with Google gets <b>view only</b> on everything (never Users &amp; access). You can switch each one off.</span></div></div></div>';
    var n = $('#usNew'); if (n) n.onclick = function () { newUser(); };
    V().querySelectorAll('tr[data-uid]').forEach(function (tr) {
      var u = S.data.users.filter(function (y) { return y.id === tr.getAttribute('data-uid'); })[0]; if (!u) return;
      var b = tr.querySelector('[data-uperm]'); if (b) b.onclick = function () { if (u.kind === 'google') editGoogle(u); else perms(u); };
      var w = tr.querySelector('[data-upw]'); if (w) w.onclick = function () { setPw(u); };
      var x = tr.querySelector('[data-udel]'); if (x) x.onclick = function () {
        M.confirmBox('Delete the login for ' + u.name + '?', u.username + ' can no longer sign in. Their work on the projects stays.', 'Delete the login').then(function (y) { if (y) api('userDelete', { id: u.id }).then(function () { toast('Login deleted'); return load().then(draw); }).catch(fail); });
      };
    });
  }

  // ---------- ＋ New user: 1 details → 2 confirm → 3 permissions ----------
  function steps(n) { return '<ol class="us-steps">' + ['Details', 'Confirm', 'Permissions'].map(function (t, i) { return '<li class="' + (i + 1 < n ? 'done' : i + 1 === n ? 'on' : '') + '"><span>' + (i + 1 < n ? '✓' : i + 1) + '</span>' + t + '</li>'; }).join('') + '</ol>'; }
  function newUser(f) {
    f = f || { email: '', name: '', role: 'Project personnel', pw: '', must: false };
    M.modal('<h2>＋ New user</h2>' + steps(1) +
      '<form class="form" id="nuF" autocomplete="off"><label>Email (their username)<input name="email" type="email" required maxlength="160" value="' + esc(f.email) + '" placeholder="name@company.com"></label>' +
      '<label>Full name<input name="name" maxlength="100" value="' + esc(f.name) + '" placeholder="e.g. Aisha Rahman"></label>' +
      '<div class="full"><b>Role</b><div class="us-rpick">' + ['Project manager', 'Contractor', 'Project personnel'].map(function (r) { return '<label class="us-rcard"><input type="radio" name="role" value="' + esc(r) + '"' + (f.role === r ? ' checked' : '') + '><span><b>' + KIND[r].ic + ' ' + esc(r) + '</b><small>' + esc(KIND[r].about) + '</small></span></label>'; }).join('') + '</div></div>' +
      '<label>Password (you choose it)<span class="us-pwrow"><input name="pw" type="password" required minlength="10" autocomplete="new-password" value="' + esc(f.pw) + '"><button class="btn btn-sm" type="button" id="nuShow">Show</button></span><small class="muted">At least 10 characters, with letters and a number</small></label>' +
      '<label>Password again<input name="pw2" type="password" required autocomplete="new-password" value="' + esc(f.pw) + '"></label>' +
      '<label class="full us-chk"><input type="checkbox" name="must"' + (f.must ? ' checked' : '') + '> <span>Ask them to choose their own password the first time they sign in</span></label>' +
      '<div class="full actions"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" type="submit">Next: confirm →</button></div></form>');
    $('#modal .modal-card').classList.add('sc-wide');
    var F = $('#nuF');
    $('#nuShow').onclick = function () { var t = F.pw.type === 'password' ? 'text' : 'password'; F.pw.type = t; F.pw2.type = t; this.textContent = t === 'text' ? 'Hide' : 'Show'; };
    setTimeout(function () { F.email.focus(); }, 30);
    F.onsubmit = function (e) {
      e.preventDefault();
      var o = { email: F.email.value.trim().toLowerCase(), name: F.name.value.trim(), role: (F.querySelector('[name=role]:checked') || {}).value || 'Project personnel', pw: F.pw.value, must: F.must.checked };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) return toast('Type their email address', true);
      if (S.data.users.some(function (u) { return u.username === o.email; })) return toast(o.email + ' already has a login', true);
      var bad = pwBad(o.pw); if (bad) return toast(bad, true);
      if (o.pw !== F.pw2.value) return toast('The two passwords are not the same', true);
      confirmNew(o);
    };
  }
  function confirmNew(o) {
    var m = roleMods(o.role);
    M.modal('<h2>＋ New user</h2>' + steps(2) + '<p style="margin:4px 0 10px">Please check, then confirm. The login is made only when you press <b>Confirm and create</b>.</p>' +
      '<table class="pp-kv us-confirm"><tbody><tr><td class="muted">Name</td><td><b>' + esc(o.name || o.email) + '</b></td></tr><tr><td class="muted">Username (email)</td><td><b>' + esc(o.email) + '</b></td></tr>' +
      '<tr><td class="muted">Role</td><td>' + KIND[o.role].ic + ' <b>' + esc(o.role) + '</b><br><small class="muted">' + esc(KIND[o.role].about) + '</small></td></tr>' +
      '<tr><td class="muted">Password</td><td><code id="cnPw">••••••••••</code> <button class="btn btn-sm" type="button" id="cnShow">Show</button>' + (o.must ? '<br><small class="muted">They choose their own at first sign-in</small>' : '') + '</td></tr>' +
      '<tr><td class="muted">Starts with</td><td>' + MODS.map(function (x) { return lv(m[x[0]]) + ' ' + esc(x[1]); }).join(' · ') + '<br><small class="muted">' + (o.role === 'Project manager' ? 'All projects' : o.role === 'Contractor' ? 'No projects until you tick them on the next step' : 'All projects (you can limit it on the next step)') + '</small></td></tr></tbody></table>' +
      '<div class="actions" style="justify-content:space-between;margin-top:12px"><button class="btn" type="button" id="cnBack">← Back</button><span><button class="btn" data-close type="button">Cancel</button> <button class="btn btn-gold" type="button" id="cnGo">✓ Confirm and create</button></span></div>');
    $('#cnShow').onclick = function () { var c = $('#cnPw'); var sh = c.textContent.indexOf('•') === 0; c.textContent = sh ? o.pw : '••••••••••'; this.textContent = sh ? 'Hide' : 'Show'; };
    $('#cnBack').onclick = function () { newUser(o); };
    $('#cnGo').onclick = function () {
      var b = this; b.disabled = true;
      api('userCreate', { user: { email: o.email, name: o.name, role: o.role, password: o.pw, mustChange: o.must } }).then(function (r) {
        toast('Login made: ' + r.user.username);
        return load().then(function () { draw(); perms(S.data.users.filter(function (u) { return u.id === r.user.id; })[0] || r.user, true); });
      }).catch(function (e) { b.disabled = false; fail(e); });
    };
  }

  // ---------- ⚙ permissions: role, modules, projects, on/off ----------
  function perms(u, isNew) {
    var role = KIND[u.role] ? u.role : 'Custom', mods = Object.assign({}, u.mods), all = u.role === 'Project manager' || !!u.projAll || u.kind === 'person', mine = (u.projects || []).slice();
    var matrix = function () { return MODS.map(function (m) { return '<tr><td><b>' + esc(m[1]) + '</b><br><small class="muted">' + esc(m[2]) + '</small></td>' + ['none', 'view', 'edit'].map(function (v) { var off = m[0] === 'users' && v === 'edit'; return '<td class="us-m"><label class="us-pick"><input type="radio" name="um_' + m[0] + '" value="' + v + '"' + (mods[m[0]] === v ? ' checked' : '') + (off ? ' disabled title="Only the super user changes Users & access"' : '') + '> ' + LVI[v] + '</label></td>'; }).join('') + '</tr>'; }).join(''); };
    var projs = function () { return S.plans.length ? S.plans.map(function (p) { return '<label><input type="checkbox" value="' + esc(p.core) + '"' + (mine.indexOf(p.core) >= 0 ? ' checked' : '') + '> <span><b>' + esc(p.name) + '</b><br><small class="muted">' + esc(p.ref || p.core) + '</small></span></label>'; }).join('') : '<div class="empty">No projects yet.</div>'; };
    M.modal('<h2>⚙ ' + esc(u.name) + '</h2>' + (isNew ? steps(3) + '<p class="ok" style="margin:0 0 8px">✓ The login for <b>' + esc(u.username) + '</b> is made. Now set what they can use.</p>' : '<p class="muted" style="margin:-4px 0 10px">' + esc(u.username) + '</p>') +
      '<div class="form"><label class="full">Display name<input id="pmName" maxlength="100" value="' + esc(u.name) + '"></label>' +
      '<div class="full"><b>Role</b><div class="us-rpick" id="pmRoles">' + ['Project manager', 'Contractor', 'Project personnel', 'Custom'].map(function (r) { return '<label class="us-rcard"><input type="radio" name="pmRole" value="' + esc(r) + '"' + (role === r ? ' checked' : '') + '><span><b>' + KIND[r].ic + ' ' + esc(r) + '</b><small>' + esc(KIND[r].about) + '</small></span></label>'; }).join('') + '</div></div>' +
      '<div class="full table-wrap"><table class="sc-table us-matrix"><thead><tr><th>Module</th><th class="us-m">No access</th><th class="us-m">View</th><th class="us-m">Edit</th></tr></thead><tbody id="pmMx">' + matrix() + '</tbody></table></div>' +
      '<div class="full"><b>Projects</b><label class="us-chk" style="margin:6px 0"><input type="checkbox" id="pmAll"' + (all ? ' checked' : '') + '> <span><b>All projects</b> <small class="muted">(a project manager always has all of them)</small></span></label><div class="us-projs" id="pmProjs"' + (all ? ' hidden' : '') + '>' + projs() + '</div></div>' +
      '<label class="full us-chk"><input type="checkbox" id="pmOn"' + (u.active !== false ? ' checked' : '') + '> <span><b>Can sign in</b> <small class="muted">Untick to switch the login off (they are signed out straight away)</small></span></label></div>' +
      '<div class="actions"><button class="btn" data-close type="button">' + (isNew ? 'Later' : 'Cancel') + '</button><button class="btn btn-gold" id="pmSave" type="button">Save permissions</button></div>');
    $('#modal .modal-card').classList.add('sc-wide');
    var wire = function () { document.querySelectorAll('#pmMx input[type=radio]').forEach(function (r) { r.onchange = function () { mods[r.name.slice(3)] = r.value; role = 'Custom'; var c = document.querySelector('[name=pmRole][value="Custom"]'); if (c) c.checked = true; }; }); };
    var pmLock = function () { var pm = role === 'Project manager', a = $('#pmAll'); if (pm) a.checked = true; a.disabled = pm; $('#pmProjs').hidden = a.checked; };
    document.querySelectorAll('[name=pmRole]').forEach(function (r) { r.onchange = function () { role = r.value; if (role !== 'Custom') { mods = roleMods(role); $('#pmMx').innerHTML = matrix(); wire(); if (role === 'Contractor') $('#pmAll').checked = false; } pmLock(); }; });
    $('#pmAll').onchange = function () { $('#pmProjs').hidden = this.checked; };
    wire(); pmLock();
    $('#pmSave').onclick = function () {
      var a = $('#pmAll').checked, P = Array.prototype.map.call(document.querySelectorAll('#pmProjs input:checked'), function (x) { return x.value; });
      if (!a && !P.length && !confirm('No projects ticked: they will see no projects until you give them some. Save anyway?')) return;
      api('userSave', { user: { id: u.id, name: $('#pmName').value.trim(), role: role, mods: mods, projAll: a, projects: P, active: $('#pmOn').checked } }).then(function () {
        M.closeModal(); toast('Permissions saved'); return load().then(draw);
      }).catch(fail);
    };
  }

  // ---------- 🔑 the super user sets a new password ----------
  function setPw(u) {
    M.modal('<h2>🔑 New password for ' + esc(u.name) + '</h2><p class="muted" style="margin:-4px 0 10px">' + esc(u.username) + '. They are signed out and use the new password from now on.</p>' +
      '<form class="form" id="spF" autocomplete="off"><label class="full">New password<span class="us-pwrow"><input name="pw" type="password" required minlength="10" autocomplete="new-password"><button class="btn btn-sm" type="button" id="spShow">Show</button></span><small class="muted">At least 10 characters, with letters and a number</small></label>' +
      '<label class="full">Again<input name="pw2" type="password" required autocomplete="new-password"></label>' +
      '<label class="full us-chk"><input type="checkbox" name="must"> <span>Ask them to choose their own password when they next sign in</span></label>' +
      '<div class="full actions"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" type="submit">Set the password</button></div></form>');
    var F = $('#spF');
    $('#spShow').onclick = function () { var t = F.pw.type === 'password' ? 'text' : 'password'; F.pw.type = t; F.pw2.type = t; this.textContent = t === 'text' ? 'Hide' : 'Show'; };
    F.onsubmit = function (e) { e.preventDefault(); var bad = pwBad(F.pw.value); if (bad) return toast(bad, true); if (F.pw.value !== F.pw2.value) return toast('The two passwords are not the same', true);
      api('userSetPw', { id: u.id, password: F.pw.value, mustChange: F.must.checked }).then(function () { M.closeModal(); toast('Password set for ' + u.username); return load().then(draw); }).catch(fail); };
  }

  // G a Google sign-in: view only; it can only be switched on or off
  function editGoogle(u) {
    M.modal('<h2>G ' + esc(u.name) + '</h2><p class="muted" style="margin:-4px 0 10px">Signed in with Google as <b>' + esc(u.username) + '</b>. Google sign-ins are <b>view only</b> on everything and never see Users &amp; access. Last sign-in: ' + esc(when(u.lastLogin)) + '.</p>' +
      '<p class="muted" style="font-size:12.5px">Want them to edit? Delete this Google sign-in and make them a login with <b>＋ New user</b> (same email).</p>' +
      '<label class="us-chk"><input type="checkbox" id="usActive"' + (u.active ? ' checked' : '') + '> <span><b>Can sign in</b> <small class="muted">Untick to stop this Google account signing in</small></span></label>' +
      '<div class="actions"><button class="btn" data-close type="button">Cancel</button><button class="btn btn-gold" id="usSave" type="button">Save</button></div>');
    $('#usSave').onclick = function () { api('userSave', { user: { id: u.id, active: $('#usActive').checked } }).then(function (r) { M.closeModal(); toast(r.user.active ? 'Google sign-in on' : 'Google sign-in switched off'); return load().then(draw); }).catch(fail); };
  }

  // your own password (and the first sign-in when the super user asked them to choose one)
  function changePassword(forced) {
    var me = M.me || {};
    if (me.kind === 'google') return M.modal('<h2>🔑 Your password</h2><p>You signed in with your <b>Google account</b> (' + esc(me.user) + '), so there is no password here. Manage it at Google.</p><div class="actions"><button class="btn btn-gold" data-close type="button">OK</button></div>');
    if (me.owner) return M.modal('<h2>🔑 Your password</h2><p>You are the <b>super user</b>. Your username and password are set in Netlify (ADMIN_USERNAME and ADMIN_PASSWORD under Project configuration, Environment variables). Change them there.</p><div class="actions"><button class="btn btn-gold" data-close type="button">OK</button></div>');
    M.modal('<h2>🔑 ' + (forced ? 'Choose your own password' : 'Change your password') + '</h2>' + (forced ? '<p>Welcome, ' + esc(me.name || me.user) + '. Choose your own password to carry on.</p>' : '') +
      '<form class="form" id="pwF"><label class="full">' + (forced ? 'The password you were given' : 'Current password') + '<input type="password" name="old" required autocomplete="current-password"></label>' +
      '<label class="full">New password<input type="password" name="pw" required minlength="10" autocomplete="new-password"><small class="muted">At least 10 characters, with letters and a number</small></label>' +
      '<label class="full">New password again<input type="password" name="pw2" required autocomplete="new-password"></label>' +
      '<div class="full actions">' + (forced ? '<button class="btn" type="button" id="pwOut">Sign out</button>' : '<button class="btn" data-close type="button">Cancel</button>') + '<button class="btn btn-gold" type="submit">Save my password</button></div></form>');
    if (forced) { var x = document.querySelector('#modal [data-close], #modal .modal-x'); if (x) x.remove(); $('#modal').setAttribute('data-locked', '1'); }
    var o = $('#pwOut'); if (o) o.onclick = function () { $('#modal').removeAttribute('data-locked'); api('logout').then(function () { location.hash = ''; location.reload(); }); };
    $('#pwF').onsubmit = function (e) { e.preventDefault(); var f = e.target;
      if (f.pw.value !== f.pw2.value) return toast('The two new passwords are not the same', true);
      api('userPassword', { old: f.old.value, password: f.pw.value }).then(function () { $('#modal').removeAttribute('data-locked'); M.closeModal(); toast('Password saved'); if (forced) location.reload(); }).catch(fail);
    };
  }

  M.users = { changePassword: changePassword };
  M.addView('users', 'Users & access', page, 'users');
})();
