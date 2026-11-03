/* MBS Console v86: Users & access (a small "Active Directory"). Only people in the People register can be given a login. Each user
   has a role and, for every module, None / View / Edit. The server enforces it; the menu hides what a user can't open. The
   Netlify login (ADMIN_USERNAME / ADMIN_PASSWORD) is the Owner and always has full access, so nobody can be locked out. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, toast = M.toast, fail = M.fail, $ = M.$;
  var V = function () { return M.view(); };
  var S = { data: null, people: null };
  var LVI = { none: '–', view: '👁 View', edit: '✎ Edit' };
  var SHORT = { crm: 'Jobs', projects: 'Projects', accounts: 'Accounts', stock: 'Stock', subbies: 'Subbies', people: 'People', data: 'Data & AI', users: 'Users' };
  var canEdit = function () { var me = M.me || {}; return me.owner || (me.mods || {}).users === 'edit'; };
  var when = function (t) { return t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' }) : 'Never'; };

  function load() { return Promise.all([api('userList'), api('pplList')]).then(function (r) { S.data = r[0]; S.people = r[1].people; }); }
  function page(args) {
    var a = args || [];
    return load().then(function () {
      draw();
      if (/^U-\d+$/.test(a[0] || '')) editUser(a[0]);
      else if (a[0] === 'new') editUser('', a[1] || '');
    });
  }
  function draw() {
    var d = S.data, U = d.users, me = M.me || {};
    var person = function (id) { return S.people.filter(function (p) { return p.id === id; })[0]; };
    V().innerHTML = '<div class="row" style="margin-bottom:12px"><div><h2 style="margin:0">🔐 Users &amp; access</h2><p class="muted" style="margin:2px 0 0;font-size:13px">Who can sign in to the console, and what each person can use. Only people in <a href="#people">People</a> can be given a login.</p></div><span class="sp"></span>' +
        (canEdit() ? '<button class="btn btn-gold" id="usNew">＋ Give someone a login</button>' : '<span class="muted">View only</span>') + '</div>' +
      '<div class="card"><div class="table-wrap"><table class="sc-table us-table"><thead><tr><th>Person</th><th>Username</th><th>Role</th>' + d.mods.map(function (m) { return '<th class="us-m" title="' + esc(m.name + ': ' + m.about) + '">' + esc(SHORT[m.key] || m.name) + '</th>'; }).join('') + '<th>Last sign-in</th><th></th></tr></thead><tbody>' +
        '<tr class="us-owner"><td><b>Owner</b><br><small class="muted">The Netlify login (ADMIN_USERNAME)</small></td><td>' + (me.owner ? esc(me.user) : '<span class="muted">set in Netlify</span>') + '</td><td><span class="us-role owner">Owner</span></td>' + d.mods.map(function () { return '<td class="us-m"><span class="us-lv edit">✎</span></td>'; }).join('') + '<td class="muted">–</td><td class="muted" style="font-size:12px">Always has full access</td></tr>' +
        U.map(function (u) { var p = person(u.personId);
          return '<tr data-uid="' + esc(u.id) + '" class="click' + (u.active ? '' : ' tdone') + '"><td><b>' + esc(u.name) + '</b><br><small class="muted">' + esc(p ? (p.role || p.type) : 'not in People') + (u.active ? '' : ' · disabled') + '</small></td><td>' + esc(u.username) + (u.mustChange ? '<br><small class="muted">password not set yet</small>' : '') + '</td>' +
            '<td><span class="us-role">' + esc(u.role) + '</span></td>' + d.mods.map(function (m) { var v = (u.mods || {})[m.key] || 'none'; return '<td class="us-m"><span class="us-lv ' + v + '" title="' + esc(m.name + ': ' + v) + '">' + (v === 'edit' ? '✎' : v === 'view' ? '👁' : '–') + '</span></td>'; }).join('') +
            '<td class="nowrap muted" style="font-size:12.5px">' + esc(when(u.lastLogin)) + '</td><td>' + (canEdit() ? '<button class="btn btn-sm" data-uedit>Edit</button>' : '') + '</td></tr>'; }).join('') +
        '</tbody></table></div>' + (U.length ? '' : '<div class="empty" style="margin-top:10px">No logins yet: only the Owner can sign in. Add your team in <a href="#people">People</a>, then give them a login here.</div>') +
        '<p class="muted" style="font-size:12.5px;margin:10px 0 0">✎ Edit · 👁 View only · – No access (hidden from their menu). Changing someone\'s access, disabling them or resetting their password signs them out straight away. Archiving someone in People (or making them Inactive) also stops their login.</p></div>' +
      '<div class="card" style="margin-top:14px"><h2>Roles</h2><p class="muted" style="margin:-4px 0 10px;font-size:13px">Pick a role for each user; choose <b>Custom</b> to set each module yourself.</p><div class="table-wrap"><table class="sc-table us-roles"><thead><tr><th>Role</th>' + d.mods.map(function (m) { return '<th class="us-m" title="' + esc(m.name + ': ' + m.about) + '">' + esc(SHORT[m.key] || m.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        d.roles.filter(function (r) { return r.mods; }).map(function (r) { return '<tr><td><b>' + esc(r.name) + '</b></td>' + d.mods.map(function (m) { var v = r.mods[m.key]; return '<td class="us-m"><span class="us-lv ' + v + '">' + (v === 'edit' ? '✎' : v === 'view' ? '👁' : '–') + '</span></td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></div>';
    var n = $('#usNew'); if (n) n.onclick = function () { editUser(''); };
    V().querySelectorAll('tr[data-uid]').forEach(function (tr) { tr.onclick = function () { if (canEdit()) editUser(tr.getAttribute('data-uid')); }; });
  }

  function editUser(id, personId) {
    if (!canEdit()) return;
    var d = S.data, u = id ? d.users.filter(function (x) { return x.id === id; })[0] : null;
    if (id && !u) return toast('User not found', true);
    var taken = {}; d.users.forEach(function (x) { if (!u || x.id !== u.id) taken[x.personId] = 1; });
    var pick = S.people.filter(function (p) { return !p.archived && p.status !== 'Inactive' && !taken[p.id]; });
    var role = u ? u.role : 'Read only', mods = Object.assign({}, u ? u.mods : (d.roles.filter(function (r) { return r.name === role; })[0] || {}).mods);
    var matrix = function () { return d.mods.map(function (m) { return '<tr><td><b>' + esc(m.name) + '</b><br><small class="muted">' + esc(m.about) + '</small></td>' + d.levels.map(function (lv) { return '<td class="us-m"><label class="us-pick"><input type="radio" name="um_' + m.key + '" value="' + lv + '"' + (mods[m.key] === lv ? ' checked' : '') + '> ' + LVI[lv] + '</label></td>'; }).join('') + '</tr>'; }).join(''); };
    M.modal('<h2>' + (u ? '🔐 ' + esc(u.name) : '＋ Give someone a login') + '</h2>' +
      '<div class="form" style="margin-top:10px">' +
      (u ? '<p class="full muted" style="margin:0">Linked to <a href="#people/' + esc(u.personId) + '">' + esc(u.name) + '</a> in People.</p>'
        : '<label class="full">Person (from People)<select id="usPerson"><option value="">Pick someone…</option>' + pick.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === personId ? ' selected' : '') + ' data-email="' + esc(p.email || '') + '">' + esc(p.name + (p.role ? ' · ' + p.role : '') + (p.email ? '' : ' (no email)')) + '</option>'; }).join('') + '</select>' +
          (pick.length ? '' : '<small class="muted">Everyone active in People already has a login. Add people in <a href="#people">People</a> first.</small>') + '</label>') +
      '<label>Username<input id="usName" maxlength="160" value="' + esc(u ? u.username : '') + '" placeholder="their email address"></label>' +
      '<label>Role<select id="usRole">' + d.roles.map(function (r) { return '<option' + (r.name === role ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('') + '</select></label>' +
      '<div class="full table-wrap"><table class="sc-table us-matrix"><thead><tr><th>Module</th><th class="us-m">No access</th><th class="us-m">View</th><th class="us-m">Edit</th></tr></thead><tbody id="usMx">' + matrix() + '</tbody></table></div>' +
      '<label class="full us-chk"><input type="checkbox" id="usActive"' + (!u || u.active ? ' checked' : '') + '> <span><b>Can sign in</b> <small class="muted">Untick to disable the login (they are signed out straight away)</small></span></label>' +
      (u ? '' : '<p class="full muted" style="margin:0;font-size:12.5px">A temporary password is made for them. Give it to them in person or by phone; they set their own password the first time they sign in.</p>') + '</div>' +
      '<div class="actions" style="justify-content:space-between;margin-top:12px">' + (u ? '<button class="btn" id="usReset" type="button">🔑 Reset password</button>' : '<span></span>') +
      '<span><button class="btn" data-close type="button">Cancel</button> <button class="btn btn-gold" id="usSave" type="button">' + (u ? 'Save' : 'Create the login') + '</button></span></div>');
    $('#modal .modal-card').classList.add('sc-wide');
    var ps = $('#usPerson');
    var fillName = function () { if (!ps) return; var o = ps.options[ps.selectedIndex]; if (o && o.getAttribute('data-email') && !$('#usName').value) $('#usName').value = o.getAttribute('data-email'); };
    if (ps) { ps.onchange = function () { $('#usName').value = ''; fillName(); }; fillName(); }
    var setRole = function (r) { var rr = d.roles.filter(function (x) { return x.name === r; })[0]; if (rr && rr.mods) { mods = Object.assign({}, rr.mods); $('#usMx').innerHTML = matrix(); wire(); } };
    var wire = function () { document.querySelectorAll('#usMx input[type=radio]').forEach(function (r) { r.onchange = function () { mods[r.name.slice(3)] = r.value; $('#usRole').value = 'Custom'; }; }); };
    $('#usRole').onchange = function () { setRole(this.value); }; wire();
    var done = function (r, what) {
      M.closeModal();
      if (r.temp) M.modal('<h2>🔑 ' + esc(what) + '</h2><p>Temporary password for <b>' + esc(r.user.name) + '</b> (username <b>' + esc(r.user.username) + '</b>):</p><p class="us-temp"><code id="usTemp">' + esc(r.temp) + '</code> <button class="btn btn-sm" id="usCopy" type="button">Copy</button></p>' +
        '<p class="muted" style="font-size:13px">It is shown only now. Give it to them in person or by phone (not in the same email as the username). They must set their own password when they first sign in.</p><div class="actions"><button class="btn btn-gold" data-close type="button">Done</button></div>');
      var c = $('#usCopy'); if (c) c.onclick = function () { try { navigator.clipboard.writeText(r.temp); toast('Copied'); } catch (e) {} };
      return load().then(function () { if (location.hash.indexOf('#users') === 0) { history.replaceState(null, '', '#users'); draw(); } });
    };
    $('#usSave').onclick = function () {
      var o = { id: u ? u.id : '', personId: u ? u.personId : (ps ? ps.value : ''), username: $('#usName').value.trim(), role: $('#usRole').value, mods: mods, active: $('#usActive').checked };
      if (!o.personId) return toast('Pick someone from People', true);
      api('userSave', { user: o }).then(function (r) { if (!r.temp) toast('Saved: ' + r.user.username); return done(r, 'Login created'); }).catch(fail);
    };
    var rs = $('#usReset'); if (rs) rs.onclick = function () {
      M.confirmBox('Reset ' + u.name + '\'s password?', 'They are signed out and get a new temporary password, which you give them. They then set their own.', 'Reset password').then(function (y) { if (y) api('userReset', { id: u.id }).then(function (r) { return done(r, 'New temporary password'); }).catch(fail); });
    };
  }

  // your own password (and the first sign-in with a temporary one)
  function changePassword(forced) {
    var me = M.me || {};
    if (me.owner) return M.modal('<h2>🔑 Your password</h2><p>You are signed in as the <b>Owner</b>. The Owner\'s username and password are set in Netlify (ADMIN_USERNAME and ADMIN_PASSWORD under Site configuration, Environment variables). Change them there.</p><div class="actions"><button class="btn btn-gold" data-close type="button">OK</button></div>');
    M.modal('<h2>🔑 ' + (forced ? 'Set your own password' : 'Change your password') + '</h2>' + (forced ? '<p>Welcome, ' + esc(me.name || me.user) + '. You signed in with a temporary password: choose your own to carry on.</p>' : '') +
      '<form class="form" id="pwF"><label class="full">' + (forced ? 'Temporary password' : 'Current password') + '<input type="password" name="old" required autocomplete="current-password"></label>' +
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
