/* MBS Console (CRM). Talks only to /.netlify/functions/admin. Everything shown is escaped (customer text is untrusted). */
(function () {
  'use strict';
  var API = '../.netlify/functions/admin';
  var STAGES = ['new', 'called', 'quoted', 'won', 'completed', 'invoiced', 'paid', 'lost'];
  var OPEN = ['new', 'called', 'quoted', 'won', 'completed', 'invoiced'];
  var LABEL = { new: 'New enquiry', called: 'Called', quoted: 'Quoted', won: 'Job won', completed: 'Completed', invoiced: 'Invoiced', paid: 'Paid', lost: 'Lost' };
  var COLOR = { new: '#3B82F6', called: '#8B5CF6', quoted: '#F59E0B', won: '#10B981', completed: '#14B8A6', invoiced: '#6366F1', paid: '#16A34A', lost: '#9CA3AF' };
  var NEXT = { new: ['called', 'quoted', 'lost'], called: ['quoted', 'lost'], quoted: ['won', 'lost'], won: ['completed', 'invoiced'], completed: ['invoiced'], invoiced: ['paid'], paid: [], lost: [] };
  var TRADES = { B: 'Building & renovations', C: 'Concrete & cracks', W: 'Waterproofing & leaks', R: 'Roofing & gutters', T: 'Tiling', D: 'Doors & windows', G: 'Gyprock & plaster', O: 'Outdoor: decks, pergolas & fencing', F: 'Painting & finishes', E: 'Electrical', P: 'Plumbing', S: 'Storm damage', M: 'General maintenance' };
  var STORES = { 'mbs-jobs': 'Live database', 'mbs-jobs-test': 'Test database', 'mbs-visits': 'Visitor counter' };

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var view = $('#view');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var gst = function (n) { return Math.round((Number(n) || 0) / 11 * 100) / 100; };
  var date = function (t) { return t ? new Date(t).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: '2-digit', hour: 'numeric', minute: '2-digit' }) : ''; };
  var day = function (t) { return t ? new Date(t).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
  var chip = function (s) { return '<span class="chip st-' + esc(s) + '">' + esc(LABEL[s] || s) + '</span>'; };
  var tel = function (p) { return String(p || '').replace(/[^\d+]/g, ''); };

  function api(action, data) {
    return fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' }, body: JSON.stringify(Object.assign({ action: action }, data || {})) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401 && action !== 'login') { showLogin(); throw new Error('Please log in again'); }
          if (!r.ok) throw new Error(j.error || ('Error ' + r.status));
          return j;
        });
      });
  }
  var toastT;
  function toast(msg, err) {
    var t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast' + (err ? ' err' : ''); }, 3200);
  }
  function fail(e) { toast(e.message || String(e), true); }
  function modal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; var f = $('#modalBody input,#modalBody button'); if (f) f.focus(); }
  function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }
  $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal' || e.target.hasAttribute('data-close')) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (res) {
      modal('<h2>' + esc(title) + '</h2><p>' + text + '</p><div class="actions" style="justify-content:flex-end"><button class="btn" data-close type="button">Cancel</button><button class="btn ' + (danger ? 'btn-danger' : 'btn-gold') + '" id="okBtn" type="button">' + esc(okLabel) + '</button></div>');
      $('#okBtn').onclick = function () { closeModal(); res(true); };
      $('#modal').addEventListener('click', function once(e) { if (e.target.id === 'modal' || e.target.hasAttribute('data-close')) { $('#modal').removeEventListener('click', once); res(false); } });
    });
  }

  /* ---------------- login ---------------- */
  function showLogin() { $('#app').hidden = true; $('#login').hidden = false; setTimeout(function () { var u = $('#loginForm [name=username]'); if (u) u.focus(); }, 50); }
  function showApp(user) { $('#login').hidden = true; $('#app').hidden = false; $('#who').textContent = user; route(); }
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, msg = $('#loginMsg'), btn = f.querySelector('button');
    msg.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
    api('login', { username: f.username.value, password: f.password.value })
      .then(function (j) { f.password.value = ''; showApp(j.user); })
      .catch(function (err) { msg.textContent = err.message; f.password.value = ''; f.password.focus(); })
      .then(function () { btn.disabled = false; btn.textContent = 'Sign in'; });
  });
  $('#logout').addEventListener('click', function () { api('logout').then(function () { location.hash = ''; showLogin(); }); });
  var closeMenu = function () { $('#side').classList.remove('open'); };
  $('#menuBtn').addEventListener('click', function () { $('#side').classList.toggle('open'); });
  $('#sideClose').addEventListener('click', closeMenu);
  $('#backdrop').addEventListener('click', closeMenu);
  $('#topSearch').addEventListener('submit', function (e) { e.preventDefault(); var q = $('#q').value.trim(); location.hash = q ? '#jobs/search/' + encodeURIComponent(q) : '#jobs'; });

  /* ---------------- router ---------------- */
  var VIEWS = { dashboard: dashboard, jobs: jobs, job: jobView, new: newJob, reminders: reminders, reports: reports, data: dataExplorer, activity: activity, analytics: analytics };
  var TITLES = { dashboard: 'Dashboard', jobs: 'Jobs', job: 'Job', new: 'New job', reminders: 'Reminders', reports: 'Reports', data: 'Data explorer', activity: 'Activity log', analytics: 'Analytics & AI' };
  var NAVKEY = { job: 'jobs' };
  function route() {
    if ($('#app').hidden) return;
    var parts = (location.hash.slice(1) || 'dashboard').split('/').map(decodeURIComponent);
    var name = VIEWS[parts[0]] ? parts[0] : 'dashboard';
    $('#title').textContent = TITLES[name];
    document.title = TITLES[name] + ' · MBS Console';
    var navOn = name === 'sql' && parts[1] === 'ask' ? 'ask' : (NAVKEY[name] || name);
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (a) { a.classList.toggle('on', a.getAttribute('data-nav') === navOn); });
    $('#side').classList.remove('open');
    view.innerHTML = '<div class="empty">Loading…</div>';
    Promise.resolve(VIEWS[name](parts.slice(1))).catch(fail);
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* ---------------- dashboard ---------------- */
  function dashboard() {
    var per = sessionStorage.getItem('mbs-per') || 'month';
    return api('dashboard', { period: per }).then(function (d) {
      var r = d.report, pipeTotal = OPEN.reduce(function (a, s) { return a + (r.pipeline[s] || 0); }, 0) || 1;
      view.innerHTML =
        '<div class="row" style="margin-bottom:14px"><div class="tabs" style="margin:0">' +
          ['week', 'month', 'fy', 'all'].map(function (p) { return '<button class="tab' + (p === per ? ' on' : '') + '" data-per="' + p + '">' + { week: 'This week', month: 'This month', fy: 'Financial year', all: 'All time' }[p] + '</button>'; }).join('') +
        '</div><span class="sp"></span><span class="muted">Showing ' + esc(d.period) + '</span></div>' +
        '<div class="grid kpis">' +
          kpi('Enquiries', r.enquiries, r.called + ' called') +
          kpi('Quotes sent', r.quotes, money(r.quoteValue)) +
          kpi('Jobs won', r.won, money(r.wonValue) + (r.winRate !== null ? ' · ' + r.winRate + '% win rate' : '')) +
          kpi('Invoiced', money(r.invTotal), 'GST ' + money(r.invGst) + ' · ex GST ' + money(r.invEx), 'gold') +
          kpi('Paid', money(r.paidTotal), r.paid + ' invoice' + (r.paid === 1 ? '' : 's') + ' · GST ' + money(r.paidGst)) +
          kpi('Owed now', money(r.owedTotal), r.owed + ' unpaid invoice' + (r.owed === 1 ? '' : 's')) +
        '</div>' +
        '<div class="grid two" style="margin-top:16px">' +
          '<div class="card"><div class="card-h"><h2>Pipeline: ' + d.open + ' open job' + (d.open === 1 ? '' : 's') + '</h2><a class="btn btn-sm" href="#jobs">All jobs →</a></div>' +
            '<div class="pipe">' + OPEN.map(function (s) { return r.pipeline[s] ? '<span title="' + LABEL[s] + '" style="width:' + (r.pipeline[s] / pipeTotal * 100) + '%;background:' + COLOR[s] + '"></span>' : ''; }).join('') + '</div>' +
            '<div class="legend">' + OPEN.map(function (s) { return '<a href="#jobs/' + s + '" style="text-decoration:none"><span class="dot" style="background:' + COLOR[s] + '"></span>' + LABEL[s] + ' <b>' + (r.pipeline[s] || 0) + '</b></a>'; }).join('') + '</div>' +
            '<h2 style="margin:20px 0 8px">Latest enquiries</h2>' + jobTable(d.recent, true) + '</div>' +
          '<div class="card"><div class="card-h"><h2>Upcoming reminders</h2><a class="btn btn-sm" href="#reminders">All →</a></div>' +
            (d.reminders.length ? '<div class="list">' + d.reminders.map(remItem).join('') + '</div>' : '<div class="empty">No reminders coming up.</div>') + '</div>' +
        '</div>';
      view.querySelectorAll('[data-per]').forEach(function (b) { b.onclick = function () { sessionStorage.setItem('mbs-per', b.getAttribute('data-per')); dashboard(); }; });
      bindRows();
    });
  }
  function kpi(k, v, s, cls) { return '<div class="card kpi ' + (cls || '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>'; }
  function remItem(r) {
    return '<div class="item"><div><b>' + esc(r.when) + '</b><br>' + esc(r.text) + (r.core ? '<br><small><a href="#job/' + esc(r.core) + '">' + esc(r.core) + '</a></small>' : '') + '</div>' +
      '<button class="btn btn-sm" data-unremind="' + r.id + '" title="Delete reminder">✕</button></div>';
  }
  function jobTable(list, compact) {
    if (!list.length) return '<div class="empty">No jobs here yet.</div>';
    return '<div class="table-wrap"><table><thead><tr><th>Job</th><th>Customer</th><th class="hide-sm">Suburb</th>' + (compact ? '' : '<th class="hide-sm">Service</th>') +
      '<th>Stage</th><th class="hide-sm">Value</th><th class="hide-sm">Created</th></tr></thead><tbody>' +
      list.map(function (j) {
        var val = j.invoice ? money(j.invoice.amount) : j.quote ? money(j.quote.amount) : '';
        return '<tr class="click" data-job="' + esc(j.core) + '"><td class="ref">' + esc(j.ref) + '</td><td><b>' + esc(j.name) + '</b><br><small class="muted">' + esc(j.phone) + '</small></td>' +
          '<td class="hide-sm">' + esc(j.suburb) + '</td>' + (compact ? '' : '<td class="hide-sm">' + esc(j.service) + '</td>') + '<td>' + chip(j.stage) + '</td>' +
          '<td class="hide-sm">' + esc(val) + '</td><td class="hide-sm">' + esc(day(j.created)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function bindRows() {
    view.querySelectorAll('tr[data-job]').forEach(function (tr) { tr.onclick = function () { location.hash = '#job/' + tr.getAttribute('data-job'); }; });
    view.querySelectorAll('[data-unremind]').forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); api('unremind', { id: Number(b.getAttribute('data-unremind')) }).then(function () { toast('Reminder deleted'); route(); }).catch(fail); };
    });
  }

  /* ---------------- jobs ---------------- */
  function jobs(args) {
    var stage = args[0] && args[0] !== 'search' ? args[0] : 'open', q = args[0] === 'search' ? args[1] || '' : '';
    if (q) $('#q').value = q;
    return api('jobs', { stage: q ? 'all' : stage, q: q }).then(function (d) {
      var tabs = ['open', 'all'].concat(STAGES);
      view.innerHTML = '<div class="tabs">' + tabs.map(function (s) {
          return '<a class="tab' + (!q && s === stage ? ' on' : '') + '" href="#jobs/' + s + '" style="text-decoration:none">' + (s === 'open' ? 'Open' : s === 'all' ? 'All' : LABEL[s]) + '</a>';
        }).join('') + '</div>' +
        '<div class="card"><div class="card-h"><h2>' + (q ? 'Search: “' + esc(q) + '”' : (stage === 'open' ? 'Open jobs' : stage === 'all' ? 'All jobs' : LABEL[stage])) + ' <span class="muted">(' + d.jobs.length + ')</span></h2>' +
        '<div class="actions"><a class="btn btn-sm" href="' + API + '?action=export">⬇ Export CSV</a><a class="btn btn-sm btn-gold" href="#new">＋ New job</a></div></div>' + jobTable(d.jobs) + '</div>';
      bindRows();
    });
  }

  /* ---------------- one job ---------------- */
  function jobView(args) {
    return api('job', { ref: args[0] }).then(function (d) {
      var j = d.job, next = NEXT[j.stage] || [];
      var q = j.quote, inv = j.invoice;
      view.innerHTML =
        '<div class="row" style="margin-bottom:14px"><a class="btn btn-sm" href="#jobs">← Jobs</a><h2 style="font-size:22px">' + esc(j.ref) + '</h2>' + chip(j.stage) + '<span class="sp"></span>' +
          (j.phone ? '<a class="btn btn-sm" href="tel:' + esc(tel(j.phone)) + '">📞 Call</a><a class="btn btn-sm" href="sms:' + esc(tel(j.phone)) + '">💬 SMS</a>' : '') +
          (j.email ? '<a class="btn btn-sm" href="mailto:' + esc(j.email) + '">✉ Email</a>' : '') +
          (j.mapsUrl ? '<a class="btn btn-sm" href="' + esc(j.mapsUrl) + '" target="_blank" rel="noopener">🗺 Directions</a>' : '') + '</div>' +
        '<div class="grid two">' +
          '<div class="grid" style="align-content:start">' +
            '<div class="card"><h2>Customer &amp; job</h2><dl class="kv">' +
              kv('Name', j.name) + kv('Phone', j.phone) + kv('Email', j.email) + kv('Suburb', j.suburb) + kv('Service', j.service) +
              kv('Trade', j.trade ? j.trade + ' · ' + (TRADES[j.trade] || '') : '') + kv('Best time', j.best_time) + kv('Source', j.source) + kv('Created', date(j.created)) +
              (q ? kv('Quote', money(q.amount) + ' inc GST (GST ' + money(q.gst || gst(q.amount)) + ')') : '') +
              (inv ? kv('Invoice', money(inv.amount) + ' inc GST (GST ' + money(inv.gst || gst(inv.amount)) + ', ex GST ' + money(inv.amount - (inv.gst || gst(inv.amount))) + ')') : '') +
              (j.lost_reason ? kv('Lost because', j.lost_reason) : '') +
            '</dl>' + (j.summary ? '<h2 style="margin:16px 0 6px">Details</h2><p style="margin:0;white-space:pre-wrap">' + esc(j.summary) + '</p>' : '') + '</div>' +
            '<div class="card"><h2>Move this job along</h2><div class="actions" id="stageBtns">' +
              (next.length ? next.map(function (s) { return '<button class="btn ' + (s === 'lost' ? '' : 'btn-gold') + '" data-stage="' + s + '">' + esc(LABEL[s]) + '</button>'; }).join('') : '<span class="muted">This job is ' + esc(LABEL[j.stage].toLowerCase()) + '.</span>') +
              '<span class="sp"></span><select id="anyStage" aria-label="Set any stage" style="width:auto"><option value="">Set any stage…</option>' + STAGES.map(function (s) { return '<option value="' + s + '">' + LABEL[s] + '</option>'; }).join('') + '</select>' +
            '</div><div id="stageForm"></div></div>' +
            '<div class="card"><h2>Photos (' + ((j.photos || []).length) + ')</h2>' + ((j.photos || []).length ? '<div class="photos">' + j.photos.map(function (p) {
                var src = API + '?action=photo&key=' + encodeURIComponent(p.key); return '<a href="' + src + '" target="_blank" rel="noopener"><img src="' + src + '" alt="Job photo" loading="lazy"></a>'; }).join('') + '</div>' : '<p class="muted" style="margin:0">No photos.</p>') + '</div>' +
          '</div>' +
          '<div class="grid" style="align-content:start">' +
            '<div class="card"><h2>Reminders</h2>' + (d.reminders.length ? '<div class="list">' + d.reminders.map(remItem).join('') + '</div>' : '<p class="muted" style="margin:0 0 6px">None set.</p>') +
              '<div class="actions" style="margin-top:10px"><button class="btn btn-sm" data-rem="in 1h">In 1 hour</button><button class="btn btn-sm" data-rem="tomorrow 9am">Tomorrow 9am</button><button class="btn btn-sm" data-rem="in 7d">In 7 days</button></div>' +
              '<form class="inline-form" id="remForm"><input name="when" placeholder="When? e.g. fri 2pm, 28/11 10am" required><input name="text" placeholder="What for?"><button class="btn btn-sm btn-dark">Add</button></form></div>' +
            '<div class="card"><h2>Notes</h2><form class="inline-form" id="noteForm" style="margin:0 0 12px"><input name="text" placeholder="Add a note…" required><button class="btn btn-sm btn-dark">Add note</button></form>' +
              ((j.notes || []).length ? '<div class="list">' + j.notes.slice().reverse().map(function (n) { return '<div class="item"><div>' + esc(n.text) + '<br><small>' + esc(n.by) + ' · ' + esc(date(n.at)) + '</small></div></div>'; }).join('') + '</div>' : '') + '</div>' +
            '<div class="card"><h2>History</h2><ul class="timeline">' + (j.history || []).slice().reverse().map(function (h) { return '<li>' + esc(h.text) + '<small>' + esc(h.by) + ' · ' + esc(date(h.at)) + '</small></li>'; }).join('') + '</ul></div>' +
          '</div>' +
        '</div>';
      var core = j.core;
      var go = function (stage, extra) {
        return api('stage', Object.assign({ ref: core, stage: stage }, extra || {})).then(function (r) { toast(LABEL[stage] + (r.after !== r.before ? ' · now ' + r.after : '')); route(); }).catch(fail);
      };
      var askStage = function (stage) {
        var box = $('#stageForm');
        if (stage === 'quoted' || stage === 'invoiced') {
          box.innerHTML = '<form class="inline-form"><b>' + (stage === 'quoted' ? 'Quote' : 'Invoice') + ' amount (inc GST)</b><input name="amount" inputmode="decimal" placeholder="e.g. 4500" required><span class="muted" id="gstHint"></span><button class="btn btn-sm btn-gold">Save</button></form>';
          var f = box.querySelector('form');
          f.amount.oninput = function () { var n = Number(f.amount.value.replace(/[$,]/g, '')); $('#gstHint').textContent = n > 0 ? 'GST ' + money(gst(n)) + ' · ex GST ' + money(n - gst(n)) : ''; };
          f.onsubmit = function (e) { e.preventDefault(); go(stage, { amount: f.amount.value }); };
          f.amount.focus();
        } else if (stage === 'lost') {
          box.innerHTML = '<form class="inline-form"><b>Why was it lost?</b><input name="reason" placeholder="optional, e.g. too expensive"><button class="btn btn-sm btn-danger">Mark lost</button></form>';
          var g = box.querySelector('form'); g.onsubmit = function (e) { e.preventDefault(); go('lost', { reason: g.reason.value }); }; g.reason.focus();
        } else { go(stage); }
      };
      view.querySelectorAll('[data-stage]').forEach(function (b) { b.onclick = function () { askStage(b.getAttribute('data-stage')); }; });
      $('#anyStage').onchange = function () { if (this.value) askStage(this.value); };
      view.querySelectorAll('[data-rem]').forEach(function (b) { b.onclick = function () { api('remind', { ref: core, when: b.getAttribute('data-rem'), text: 'Follow up ' + j.name }).then(function (r) { toast('Reminder set for ' + r.reminder.when); route(); }).catch(fail); }; });
      $('#remForm').onsubmit = function (e) { e.preventDefault(); var f = e.target; api('remind', { ref: core, when: f.when.value, text: f.text.value || 'Follow up ' + j.name }).then(function (r) { toast('Reminder set for ' + r.reminder.when); route(); }).catch(fail); };
      $('#noteForm').onsubmit = function (e) { e.preventDefault(); api('note', { ref: core, text: e.target.text.value }).then(function () { toast('Note added'); route(); }).catch(fail); };
      bindRows();
      jobExtras.forEach(function (fn) { try { fn(j); } catch (err) { fail(err); } });
    });
  }
  function kv(k, v) { return v ? '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>' : ''; }

  /* ---------------- new job ---------------- */
  function newJob() {
    view.innerHTML = '<div class="card" style="max-width:820px"><h2>Add a job (e.g. a phone enquiry)</h2><form class="form" id="newForm">' +
      '<label>Customer name *<input name="name" required></label><label>Phone *<input name="phone" type="tel" required></label>' +
      '<label>Email<input name="email" type="email"></label><label>Suburb<input name="suburb" placeholder="e.g. Castle Hill"></label>' +
      '<label>Service<input name="service" placeholder="e.g. Leaking shower"></label>' +
      '<label>Trade<select name="trade"><option value="">Work it out from the service</option>' + Object.keys(TRADES).map(function (k) { return '<option value="' + k + '">' + k + ' · ' + esc(TRADES[k]) + '</option>'; }).join('') + '</select></label>' +
      '<label>Best time to call<input name="best_time" placeholder="e.g. Tomorrow morning"></label><label>Source<select name="source"><option>Phone call</option><option>Walk-in / site</option><option>Referral</option><option>Email</option><option>Other</option></select></label>' +
      '<label class="full">Details<textarea name="summary" rows="4" placeholder="What needs doing?"></textarea></label>' +
      '<div class="full actions"><button class="btn btn-gold">Create job</button><a class="btn" href="#jobs">Cancel</a></div></form></div>';
    $('#newForm').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, data = {};
      ['name', 'phone', 'email', 'suburb', 'service', 'trade', 'best_time', 'source', 'summary'].forEach(function (k) { data[k] = f[k].value; });
      api('create', data).then(function (r) { toast('Created ' + r.job.ref); location.hash = '#job/' + r.job.core; }).catch(fail);
    };
    $('#newForm [name=name]').focus();
  }

  /* ---------------- reminders ---------------- */
  function reminders() {
    return api('reminders').then(function (d) {
      view.innerHTML = '<div class="grid two"><div class="card"><h2>All reminders (' + d.reminders.length + ')</h2>' +
        (d.reminders.length ? '<div class="list">' + d.reminders.map(remItem).join('') + '</div>' : '<div class="empty">No reminders set.</div>') + '</div>' +
        '<div class="card"><h2>Add a reminder</h2><form class="form" id="remAll" style="grid-template-columns:1fr">' +
        '<label>When *<input name="when" placeholder="in 2h · tomorrow 9am · fri 2pm · 28/11 10am" required></label>' +
        '<label>Job number (optional)<input name="ref" placeholder="e.g. PW-261028-000001 or just 1"></label>' +
        '<label>What for?<input name="text" placeholder="e.g. order tiles"></label><div class="actions"><button class="btn btn-gold">Add reminder</button></div>' +
        '<p class="muted" style="margin:0">Reminders arrive in Telegram (everyone who gets the job alerts).</p></form></div></div>';
      bindRows();
      $('#remAll').onsubmit = function (e) { e.preventDefault(); var f = e.target; api('remind', { when: f.when.value, ref: f.ref.value.trim(), text: f.text.value }).then(function (r) { toast('Reminder set for ' + r.reminder.when); route(); }).catch(fail); };
    });
  }

  /* ---------------- reports ---------------- */
  function reports(args) {
    var per = args[0] || 'month';
    return api('report', { period: per }).then(function (d) {
      var r = d.report;
      var rows = [
        ['New enquiries', r.enquiries, ''], ['Customers called', r.called, ''], ['Quotes sent', r.quotes, money(r.quoteValue) + ' inc GST'],
        ['Jobs won', r.won, money(r.wonValue) + (r.winRate !== null ? ' · win rate ' + r.winRate + '%' : '')], ['Jobs lost', r.lost, ''],
        ['Jobs completed', r.completed, ''], ['Invoices raised', r.invoiced, money(r.invTotal) + ' inc GST'],
        ['  GST on invoices', '', money(r.invGst)], ['  Invoiced ex GST', '', money(r.invEx)],
        ['Invoices paid', r.paid, money(r.paidTotal) + ' (GST ' + money(r.paidGst) + ')'], ['Still owed', r.owed, money(r.owedTotal) + ' (GST ' + money(r.owedGst) + ')']
      ];
      view.innerHTML = '<div class="tabs">' + [['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['fy', 'Financial year'], ['year', 'Calendar year'], ['all', 'All time']].map(function (p) {
          return '<a class="tab' + (p[0] === per ? ' on' : '') + '" href="#reports/' + p[0] + '" style="text-decoration:none">' + p[1] + '</a>'; }).join('') + '</div>' +
        '<div class="card" style="max-width:820px"><div class="card-h"><h2>Report: ' + esc(d.period) + (d.from ? ' <span class="muted">(from ' + esc(day(d.from)) + ')</span>' : '') + '</h2>' +
        '<div class="actions"><button class="btn btn-sm" onclick="window.print()">🖨 Print</button><a class="btn btn-sm" href="' + API + '?action=export">⬇ Export all jobs (CSV)</a></div></div>' +
        '<div class="table-wrap"><table><tbody>' + rows.map(function (x) { return '<tr><td' + (/^ /.test(x[0]) ? ' style="padding-left:28px;color:#6B6860"' : '') + '>' + esc(x[0].trim()) + '</td><td style="text-align:right;font-weight:800">' + esc(x[1]) + '</td><td style="text-align:right">' + esc(x[2]) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<p class="muted" style="margin:14px 0 0">Amounts include GST unless marked. GST = 1/11 of the GST-inclusive amount.</p></div>';
    });
  }

  /* ---------------- data explorer ---------------- */
  var dataState = { store: 'mbs-jobs', kind: 'all' };
  function dataExplorer(args) {
    if (args[0] && STORES[args[0]]) dataState.store = args[0];
    var st = dataState.store;
    return Promise.all([api('stores'), api('dataList', { store: st })]).then(function (res) {
      var stores = res[0].stores, rows = res[1].rows;
      var kinds = ['all'].concat(Array.from(new Set(rows.map(function (r) { return r.kind; }))));
      if (kinds.indexOf(dataState.kind) < 0) dataState.kind = 'all';
      var shown = rows.filter(function (r) { return dataState.kind === 'all' || r.kind === dataState.kind; });
      var other = st === 'mbs-jobs' ? 'mbs-jobs-test' : st === 'mbs-jobs-test' ? 'mbs-jobs' : '';
      view.innerHTML =
        '<div class="tabs">' + stores.map(function (s) { return '<a class="tab' + (s.store === st ? ' on' : '') + '" href="#data/' + s.store + '" style="text-decoration:none">' + esc(STORES[s.store]) + '<b>' + s.count + '</b></a>'; }).join('') + '</div>' +
        '<div class="note" style="margin-bottom:14px">Tick the records you want, then <b>delete</b> them or <b>move</b> them to the ' + (st === 'mbs-jobs-test' ? 'live' : 'test') + ' database. A job always takes its photos (and reminders) with it. Download a backup first if unsure.</div>' +
        '<div class="card"><div class="card-h"><div class="tabs" style="margin:0">' + kinds.map(function (k) { return '<button class="tab' + (k === dataState.kind ? ' on' : '') + '" data-kind="' + esc(k) + '">' + esc(k === 'all' ? 'Everything' : k) + '</button>'; }).join('') + '</div>' +
          '<div class="actions"><a class="btn btn-sm" href="' + API + '?action=backup&store=' + encodeURIComponent(st) + '">⬇ Backup (JSON)</a>' +
          (st !== 'mbs-visits' ? '<button class="btn btn-sm" id="reindex">↻ Rebuild job list</button>' : '') + '</div></div>' +
          '<div class="row" style="margin-bottom:10px"><b id="selCount">0 selected</b><span class="sp"></span>' +
            (other ? '<button class="btn btn-sm btn-dark" id="moveBtn" disabled>Move to ' + esc(STORES[other].toLowerCase()) + '</button>' : '') +
            '<button class="btn btn-sm btn-danger" id="delBtn" disabled>Delete selected</button></div>' +
          (shown.length ? '<div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="selAll" aria-label="Select all" style="width:auto"></th><th>Record</th><th>Type</th><th>Details</th><th></th></tr></thead><tbody>' +
            shown.map(function (r) {
              var det = r.kind === 'job' ? '<span class="ref">' + esc(r.ref || '') + '</span> ' + (r.stage ? chip(r.stage) : '') + '<br><b>' + esc(r.name || '(not in job list)') + '</b> <small class="muted">' + esc([r.suburb, r.service].filter(Boolean).join(' · ')) + ' ' + esc(day(r.created)) + '</small>'
                : r.kind === 'photo' ? 'Photo of job <span class="ref">' + esc(r.job) + '</span>'
                : r.kind === 'counter' ? '<span style="color:#B45309">Job-number counter (delete = numbers restart at 000001)</span>'
                : r.kind === 'index' ? '<span style="color:#B45309">Job list used by the console and bot (rebuild instead of deleting)</span>'
                : r.kind === 'reminders' ? 'All reminders' : '';
              return '<tr><td><input type="checkbox" class="sel" value="' + esc(r.key) + '" aria-label="Select ' + esc(r.key) + '" style="width:auto"></td><td class="ref">' + esc(r.key) + '</td><td>' + esc(r.kind) + '</td><td>' + det + '</td>' +
                '<td><button class="btn btn-sm" data-view="' + esc(r.key) + '">View</button></td></tr>';
            }).join('') + '</tbody></table></div>' : '<div class="empty">Nothing stored here.</div>') +
        '</div>';
      var sels = function () { return Array.prototype.map.call(view.querySelectorAll('.sel:checked'), function (c) { return c.value; }); };
      var upd = function () { var n = sels().length; $('#selCount').textContent = n + ' selected'; $('#delBtn').disabled = !n; if ($('#moveBtn')) $('#moveBtn').disabled = !n; };
      view.querySelectorAll('.sel').forEach(function (c) { c.onchange = upd; });
      if ($('#selAll')) $('#selAll').onchange = function () { var on = this.checked; view.querySelectorAll('.sel').forEach(function (c) { c.checked = on; }); upd(); };
      view.querySelectorAll('[data-kind]').forEach(function (b) { b.onclick = function () { dataState.kind = b.getAttribute('data-kind'); dataExplorer([]); }; });
      view.querySelectorAll('[data-view]').forEach(function (b) {
        b.onclick = function () {
          var k = b.getAttribute('data-view');
          if (k.indexOf('photo:') === 0) { modal('<h2 class="ref">' + esc(k) + '</h2><img src="' + API + '?action=photo&store=' + encodeURIComponent(st) + '&key=' + encodeURIComponent(k) + '" style="max-width:100%;border-radius:10px;margin-top:12px" alt=""><div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-close>Close</button></div>'); return; }
          api('dataGet', { store: st, key: k }).then(function (d) { modal('<h2 class="ref" style="margin-bottom:12px">' + esc(k) + '</h2><pre class="json">' + esc(JSON.stringify(d.value, null, 2)) + '</pre><div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-close>Close</button></div>'); }).catch(fail);
        };
      });
      $('#delBtn').onclick = function () {
        var keys = sels(), risky = keys.filter(function (k) { return k === 'seq' || k === 'index' || k === 'reminders'; });
        confirmBox('Delete ' + keys.length + ' record' + (keys.length > 1 ? 's' : '') + '?', 'This permanently deletes them from the <b>' + esc(STORES[st].toLowerCase()) + '</b>' + (risky.length ? '. <span style="color:#C2410C">Includes ' + esc(risky.join(', ')) + '.</span>' : '') + ' It cannot be undone.', 'Delete', true)
          .then(function (ok) { if (ok) return api('dataDelete', { store: st, keys: keys }).then(function (r) { toast('Deleted ' + r.deleted.length + ' item(s)'); dataExplorer([]); }); }).catch(fail);
      };
      if ($('#moveBtn')) $('#moveBtn').onclick = function () {
        var keys = sels();
        confirmBox('Move ' + keys.length + ' record' + (keys.length > 1 ? 's' : '') + '?', 'Jobs and photos move to the <b>' + esc(STORES[other].toLowerCase()) + '</b> (counters and lists stay where they are).', 'Move')
          .then(function (ok) { if (ok) return api('dataMove', { from: st, to: other, keys: keys }).then(function (r) { toast('Moved ' + r.moved.length + ' item(s)'); dataExplorer([]); }); }).catch(fail);
      };
      if ($('#reindex')) $('#reindex').onclick = function () { api('rebuildIndex', { store: st }).then(function (r) { toast('Job list rebuilt: ' + r.jobs + ' jobs'); dataExplorer([]); }).catch(fail); };
    });
  }

  /* ---------------- activity + analytics ---------------- */
  function activity() {
    return api('log').then(function (d) {
      view.innerHTML = '<div class="card" style="max-width:900px"><h2>Recent console activity</h2>' + (d.log.length ? '<ul class="timeline">' + d.log.map(function (x) { return '<li>' + esc(x.text) + '<small>' + esc(x.user) + ' · ' + esc(date(x.at)) + '</small></li>'; }).join('') + '</ul>' : '<div class="empty">Nothing yet.</div>') + '</div>';
    });
  }
  function analytics() {
    view.innerHTML = '<div class="note" style="margin-bottom:16px"><span class="badge">Coming next</span> &nbsp;This space is ready for business intelligence on your job data.</div><div class="soon">' +
      [['📈 Trends', 'Enquiries, quotes, wins and revenue by week and month; seasonality and busiest suburbs.'], ['📊 Power BI', 'Live Power BI reports and dashboards embedded here, fed from the job database.'],
       ['🤖 AI insights', 'Ask questions in plain English: “which suburbs bring the biggest jobs?”, “why are we losing quotes?”.'], ['💵 Accounting', 'Invoices, payments and GST summaries for BAS, linked to each job.'],
       ['🎯 Win-rate analysis', 'Quote-to-win rate by trade, source and response time.'], ['👷 Team', 'Staff logins, job assignment and workload.']]
      .map(function (x) { return '<div class="card"><h2>' + x[0] + '</h2><p class="muted" style="margin:0">' + esc(x[1]) + '</p></div>'; }).join('') + '</div>';
  }

  /* ---------------- shared with admin-acct.js (accounting screens) ---------------- */
  var jobExtras = [];
  window.MBS = {
    api: api, esc: esc, money: money, gst: gst, date: date, day: day, chip: chip, toast: toast, fail: fail, modal: modal, closeModal: closeModal,
    confirmBox: confirmBox, route: route, $: $, view: function () { return view; }, API: API,
    addView: function (name, title, fn, navKey) { VIEWS[name] = fn; TITLES[name] = title; if (navKey) NAVKEY[name] = navKey; },
    onJob: function (fn) { jobExtras.push(fn); }
  };

  /* ---------------- start ---------------- */
  // wait until every console script (accounts, SQL, planner) has added its pages, so a link like #plan/... opens the right page
  function start() { api('me').then(function (j) { showApp(j.user); }).catch(function () { showLogin(); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
