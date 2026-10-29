/* MBS Console: the dashboard's pipeline board. A snapshot of every job, from the first enquiry to closed:
   New enquiry > Called > Site visit, planned & quoted > Job won > Job in progress > Completed > Invoiced > Closed.
   Flip it on and off from the Dashboard; "Full screen" hides the menu so all eight columns fit. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, money = M.money, fail = M.fail, toast = M.toast, $ = M.$;
  var COLS = [
    ['new', 'New enquiry', '#3B82F6', 'Call them back'],
    ['called', 'Called', '#8B5CF6', 'Book a site visit'],
    ['visit', 'Site visit, planned & quoted', '#F59E0B', 'Visit, plan, quote, follow up'],
    ['won', 'Job won', '#10B981', 'Plan ready? Book the start'],
    ['progress', 'Job in progress', '#C9A227', 'Work under way'],
    ['completed', 'Completed', '#14B8A6', 'Send the invoice'],
    ['invoiced', 'Invoiced', '#6366F1', 'Waiting for payment'],
    ['closed', 'Closed', '#6B7280', 'Paid or lost']
  ];
  var store = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  var B = { data: null, q: '', days: +(store('mbsBoardDays') || 30), timer: null, el: null };
  var DAY = 864e5;
  var ageDays = function (ms) { return ms ? Math.max(0, Math.floor((Date.now() - ms) / DAY)) : 0; };
  var pretty = function (s) { if (!s) return ''; var a = s.split('-').map(Number); return a[2] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][a[1] - 1]; };
  var evC = function (v) { return v == null ? 'grey' : v >= 1 ? 'green' : v >= 0.9 ? 'amber' : 'red'; };

  function flags(c) {
    var a = ageDays(c.since), f = [];
    var w = function (txt, lvl) { f.push('<span class="pflag pf-' + lvl + '">' + esc(txt) + '</span>'); };
    if (c.col === 'new' && a >= 1) w('Not called yet: ' + a + ' day' + (a === 1 ? '' : 's'), a >= 3 ? 'red' : 'amber');
    if (c.col === 'called' && a >= 3 && !c.next) w('No visit booked', 'amber');
    if (c.col === 'visit' && c.stage !== 'quoted' && c.visit) w('Site visit booked', 'blue');
    if (c.col === 'visit' && c.stage !== 'quoted' && c.plan) w('Planned: quote it', 'amber');
    if (c.col === 'visit' && c.stage === 'quoted' && a >= 7) w('Quote sent ' + a + ' days ago: follow up', a >= 14 ? 'red' : 'amber');
    if (c.col === 'won' && !c.plan) w('No project plan yet', 'amber');
    if (c.col === 'won' && c.plan && c.plan.start) w('Plan ready: starts ' + pretty(c.plan.start), 'blue');
    if (c.col === 'progress' && c.plan) {
      if (c.plan.late) w(c.plan.late + ' late task' + (c.plan.late === 1 ? '' : 's'), 'red');
      if (c.plan.pct >= 100) w('All tasks done: mark it Completed', 'green');
    }
    if (c.plan && c.plan.highRisks && c.col !== 'closed') w(c.plan.highRisks + ' high risk' + (c.plan.highRisks === 1 ? '' : 's'), 'amber');
    if (c.plan && c.plan.openIssues && c.col !== 'closed') w(c.plan.openIssues + ' open issue' + (c.plan.openIssues === 1 ? '' : 's'), 'amber');
    if (c.col === 'completed' && a >= 2) w('Not invoiced: ' + a + ' days', a >= 7 ? 'red' : 'amber');
    if (c.col === 'invoiced' && a >= 14) w('Unpaid: ' + a + ' days', a >= 30 ? 'red' : 'amber');
    if (c.col === 'closed') w(c.stage === 'paid' ? 'Paid ✓' : 'Lost', c.stage === 'paid' ? 'green' : 'grey');
    return f.join('');
  }
  function card(c) {
    var a = ageDays(c.since), p = c.plan;
    var planBit = p && (['visit', 'won', 'progress', 'completed', 'invoiced'].indexOf(c.col) >= 0) ?
      '<div class="pc-plan"><div class="pbar"><span style="width:' + Math.min(100, p.pct) + '%"></span></div><div class="pc-pl"><span>' + p.pct + '% · ' + p.done + '/' + p.total + ' tasks</span>' +
        (c.col === 'progress' ? '<span class="pc-ev ev-' + evC(p.SPI) + '" title="SPI (schedule): green 1.00 or more, yellow 0.90–0.99, red below 0.90"><i class="evdot"></i>SPI ' + (p.SPI == null ? '–' : p.SPI.toFixed(2)) + '</span>' : '') + '</div>' +
        (p.finish ? '<div class="pc-fin">Finish ' + esc(pretty(p.finish)) + '</div>' : '') + '</div>' : '';
    return '<div class="pcard' + (c.stage === 'lost' ? ' lost' : '') + '" data-core="' + esc(c.core) + '" tabindex="0" role="link" title="Open ' + esc(c.ref) + ' (drag it to another column to move it on)">' +
      '<div class="pc-top"><span class="ref">' + esc(c.ref) + '</span><span class="pc-age" title="Days in this stage">' + (a ? a + 'd' : 'today') + '</span><button class="pc-move" type="button" data-move title="Move to another column (or drag the card)" aria-label="Move">⇄</button></div>' +
      '<b class="pc-name">' + esc(c.name) + '</b><div class="pc-title">' + esc(c.title) + '</div>' +
      '<div class="pc-meta">' + [c.suburb ? esc(c.suburb) : '', c.value ? '<b>' + money(c.value) + '</b> <small>' + (c.valueKind === 'invoice' ? 'invoiced' : 'quoted') + '</small>' : ''].filter(Boolean).join(' · ') + '</div>' +
      planBit + '<div class="pc-flags">' + flags(c) + '</div>' +
      (c.next && c.col !== 'closed' ? '<div class="pc-next">⏰ ' + esc(c.next.when) + ': ' + esc(c.next.text) + '</div>' : '') +
      (p ? '<a class="pc-plink" href="#plan/' + esc(c.core) + '" title="Open the project plan">📅 Plan</a>' : '') + '</div>';
  }
  function sortCol(k, list) {
    var by = { progress: function (a, b) { return (a.plan && a.plan.finish || '9') < (b.plan && b.plan.finish || '9') ? -1 : 1; },  won: function (a, b) { return (a.plan && a.plan.start || '9') < (b.plan && b.plan.start || '9') ? -1 : 1; }, closed: function (a, b) { return b.since - a.since; } };
    return list.sort(by[k] || function (a, b) { return a.since - b.since; });   // the ones waiting longest first
  }
  /* ---------- drag a card to another column (mouse), or "⇄ Move" (touch / keyboard) ---------- */
  var colName = function (k) { var c = COLS.filter(function (x) { return x[0] === k; })[0]; return c ? c[1] : k; };
  var ORDER = COLS.map(function (c) { return c[0]; });
  var today = function () { var o = {}; new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; }); return o.year + '-' + o.month + '-' + o.day; };
  function form(title, body, okLabel) {   // a small dialog; resolves with the form or null
    return new Promise(function (res) {
      M.modal('<h2>' + title + '</h2><form id="mvForm" class="mvform">' + body + '<div class="actions" style="justify-content:flex-end"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-gold" id="mvOk">' + okLabel + '</button></div></form>');
      var f = $('#mvForm'), done = false;
      f.onsubmit = function (e) { e.preventDefault(); done = true; var v = f; M.closeModal(); res(v); };
      $('#modal').addEventListener('click', function once(e) { if (e.target.id === 'modal' || e.target.hasAttribute('data-close')) { $('#modal').removeEventListener('click', once); if (!done) res(null); } });
    });
  }
  var chk = function (name, label, on) { return '<label class="mvchk"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '> ' + label + '</label>'; };
  var openQuote = function (c) { return c.quote && ['draft', 'sent'].indexOf(c.quote.status) >= 0 ? c.quote : null; };
  function ask(c, to) {   // what else should change with the move? returns opts, or null to cancel
    var back = ORDER.indexOf(to) < ORDER.indexOf(c.col), oq = openQuote(c), who = esc(c.name) + ' (' + esc(c.ref) + ')';
    var acceptBox = oq ? chk('acceptQuote', 'Mark quote <b>' + esc(oq.id) + '</b> (' + money(oq.inc) + ') as accepted', true) : '';
    if (to === 'new' || to === 'called') {
      if (c.plan) { toast('This job has a project plan, so it stays in “Site visit, planned & quoted” or later', true); return Promise.resolve(null); }
      return back ? M.confirmBox('Move back to ' + colName(to) + '?', who + ' goes back to ' + colName(to) + '.', 'Move').then(function (ok) { return ok ? {} : null; }) : Promise.resolve({});
    }
    if (to === 'visit') {
      var amt = (c.quote && c.quote.inc) || c.value || '';
      return form('Move to Site visit, planned &amp; quoted', '<p class="muted" style="margin:-4px 0 10px">' + who + '</p>' +
        '<label class="mvopt"><input type="radio" name="mode" value="quoted"' + (c.quote || c.value ? ' checked' : '') + '> <span><b>Quote given</b><br><span class="mvrow">Amount (inc GST) <input name="amount" inputmode="decimal" value="' + esc(amt) + '" style="width:130px"></span></span></label>' +
        '<label class="mvopt"><input type="radio" name="mode" value="visit"' + (c.quote || c.value ? '' : ' checked') + '> <span><b>Book a site visit</b> (adds a reminder)<br><span class="mvrow">When <input name="when" placeholder="tomorrow 10am" style="width:150px"> <input name="note" placeholder="what for, e.g. measure the deck" style="width:220px"></span></span></label>' +
        (c.plan ? '' : '<p style="margin:8px 0 0;font-size:13px">Or <a href="#plan/' + esc(c.core) + '" data-close>📅 make a project plan for this job</a> (it moves here by itself).</p>'), 'Move').then(function (f) {
        if (!f) return null; var mode = f.querySelector('[name=mode]:checked').value;
        return { mode: mode, amount: String(f.amount.value).replace(/[$,\s]/g, ''), when: f.when.value, note: f.note.value };
      });
    }
    if (to === 'won') {
      if (c.col === 'progress') return M.confirmBox('Back to Job won?', 'The project plan of ' + who + ' has started. Moving it back to Job won puts every plan task back to <b>To do (0%)</b>.', 'Reset the plan and move', true).then(function (ok) { return ok ? { resetPlan: true } : null; });
      if (!oq) return Promise.resolve({});
      return form('Move to Job won', '<p class="muted" style="margin:-4px 0 10px">' + who + '</p>' + acceptBox, 'Move').then(function (f) { return f ? { acceptQuote: !!(f.acceptQuote && f.acceptQuote.checked) } : null; });
    }
    if (to === 'progress') {
      if (!c.plan) return form('Make a project plan first', '<p>The work on ' + who + ' is tracked in its project plan (tasks, dates, Gantt chart). Make the plan, then move the job here.</p>', '📅 Make the plan').then(function (f) { if (f) location.hash = '#plan/' + c.core; return null; });
      var later = c.plan.start && c.plan.start > today();
      return form('Start the work', '<p class="muted" style="margin:-4px 0 10px">' + who + '</p><p style="margin:0 0 8px">The first task in the project plan is marked <b>In progress</b>, so the plan, the Gantt chart and the board show the job has started.</p>' +
        (later ? chk('startToday', 'Move the planned start (' + esc(pretty(c.plan.start)) + ') to <b>today</b>', true) : '') + acceptBox, 'Start').then(function (f) {
        return f ? { startToday: !!(f.startToday && f.startToday.checked), acceptQuote: !!(f.acceptQuote && f.acceptQuote.checked) } : null;
      });
    }
    if (to === 'completed') {
      return form('Mark the job completed', '<p class="muted" style="margin:-4px 0 10px">' + who + '</p>' + (c.plan ? chk('finishPlan', 'Mark every task in the project plan <b>Done</b> (100%)', true) : '') + acceptBox, 'Completed').then(function (f) {
        return f ? { finishPlan: !!(f.finishPlan && f.finishPlan.checked), acceptQuote: !!(f.acceptQuote && f.acceptQuote.checked) } : null;
      });
    }
    if (to === 'invoiced') {
      var body = '<p class="muted" style="margin:-4px 0 10px">' + who + '</p>';
      if (c.invoice) body += '<p style="margin:0 0 8px">Tax invoice <b>' + esc(c.invoice.id) + '</b> (' + money(c.invoice.inc) + ') is used.</p>';
      else if (c.quote) body += '<label class="mvopt"><input type="radio" name="inv" value="make" checked> <span><b>Make the tax invoice from ' + esc(c.quote.id) + '</b> (' + money(c.quote.inc) + ')<br><small class="muted">A draft in Invoices with the same lines, customer and project plan: check it and send it.</small></span></label>' +
        '<label class="mvopt"><input type="radio" name="inv" value="amount"> <span><b>Just mark it invoiced</b><br><span class="mvrow">Amount (inc GST) <input name="amount" inputmode="decimal" style="width:130px"></span></span></label>';
      else body += '<span class="mvrow">Amount invoiced (inc GST) <input name="amount" inputmode="decimal" value="' + esc(c.value || '') + '" style="width:130px"></span>';
      if (c.plan && c.col !== 'completed') body += chk('finishPlan', 'Mark every task in the project plan <b>Done</b>', true);
      return form('Move to Invoiced', body, 'Move').then(function (f) {
        if (!f) return null; var r = f.querySelector('[name=inv]:checked');
        return { makeInvoice: !r || r.value === 'make', amount: f.amount ? String(f.amount.value).replace(/[$,\s]/g, '') : '', finishPlan: !!(f.finishPlan && f.finishPlan.checked) };
      });
    }
    if (to === 'closed') {
      var bal = c.invoice ? (c.invoice.balance != null ? c.invoice.balance : c.invoice.inc) : 0;
      return form('Close the job', '<p class="muted" style="margin:-4px 0 10px">' + who + '</p>' +
        '<label class="mvopt"><input type="radio" name="outcome" value="paid"' + (c.col === 'invoiced' || c.col === 'completed' ? ' checked' : '') + '> <span><b>Paid</b>' + (c.invoice && bal > 0 ? '<br>' + chk('recordPayment', 'Record the payment of <b>' + money(bal) + '</b> on ' + esc(c.invoice.id), true) + ' <select name="method" style="width:auto"><option>Bank transfer</option><option>Card</option><option>Cash</option><option>Cheque</option><option>Other</option></select>' : '') + '</span></label>' +
        '<label class="mvopt"><input type="radio" name="outcome" value="lost"' + (c.col === 'invoiced' || c.col === 'completed' ? '' : ' checked') + '> <span><b>Lost</b><br><span class="mvrow">Why? <input name="reason" placeholder="optional, e.g. too expensive" style="width:240px"></span></span></label>', 'Close').then(function (f) {
        if (!f) return null;
        return { outcome: f.querySelector('[name=outcome]:checked').value, reason: f.reason.value, recordPayment: !!(f.recordPayment && f.recordPayment.checked), method: f.method ? f.method.value : '' };
      });
    }
    return Promise.resolve(null);
  }
  function moveTo(c, to) {
    if (!c || c.col === to) return;
    ask(c, to).then(function (opts) {
      if (!opts) { draw(); return; }
      var el = B.el.querySelector('.pcard[data-core="' + c.core + '"]'), tgt = B.el.querySelector('.pcol[data-col="' + to + '"] .pcol-b');
      if (el && tgt) { var e = tgt.querySelector('.pcol-empty'); if (e) e.remove(); tgt.insertBefore(el, tgt.firstChild); el.classList.add('moving'); }
      return api('boardMove', { core: c.core, to: to, opts: opts }).then(function (r) {
        toast(c.name + ': ' + (r.did && r.did.length ? r.did.join(' · ') : 'moved to ' + colName(to)));
        return load();
      }).catch(function (e) { fail(e); load(); });
    });
  }
  function moveMenu(c, btn) {
    var rc = btn.getBoundingClientRect(), m = document.createElement('div');
    m.className = 'pmenu'; m.innerHTML = '<b>Move to…</b>' + COLS.filter(function (x) { return x[0] !== c.col; }).map(function (x) { return '<button type="button" data-to="' + x[0] + '" style="--pc:' + x[2] + '"><i></i>' + esc(x[1]) + '</button>'; }).join('');
    document.body.appendChild(m);
    m.style.top = Math.min(innerHeight - m.offsetHeight - 8, rc.bottom + 4) + 'px'; m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, rc.right - m.offsetWidth)) + 'px';
    var close = function () { m.remove(); document.removeEventListener('pointerdown', out, true); };
    var out = function (e) { if (!m.contains(e.target)) close(); };
    setTimeout(function () { document.addEventListener('pointerdown', out, true); }, 0);
    m.querySelectorAll('[data-to]').forEach(function (b) { b.onclick = function () { close(); moveTo(c, b.getAttribute('data-to')); }; });
    var first = m.querySelector('button'); if (first) first.focus();
  }
  function bindDrag(host) {
    var byCore = {}; B.data.cards.forEach(function (c) { byCore[c.core] = c; });
    host.querySelectorAll('.pcard').forEach(function (el) {
      var c = byCore[el.getAttribute('data-core')];
      var mv = el.querySelector('[data-move]'); if (mv) mv.onclick = function (e) { e.stopPropagation(); moveMenu(c, mv); };
      el.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'touch' || e.button !== 0 || e.target.closest('a,button')) return;
        var sx = e.clientX, sy = e.clientY, ghost = null, over = null;
        var mvH = function (ev) {
          if (!ghost) {
            if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 7) return;
            ghost = el.cloneNode(true); ghost.classList.add('pghost'); ghost.style.width = el.offsetWidth + 'px'; document.body.appendChild(ghost);
            el.classList.add('dragging'); document.body.classList.add('pdragging'); B.dragging = true;
          }
          ev.preventDefault();
          ghost.style.left = (ev.clientX - 20) + 'px'; ghost.style.top = (ev.clientY - 14) + 'px';
          var under = document.elementFromPoint(ev.clientX, ev.clientY), col = under && under.closest('.pcol');
          if (over && over !== col) over.classList.remove('dropok');
          over = col; if (col && col.getAttribute('data-col') !== c.col) col.classList.add('dropok');
          var bd = host.getBoundingClientRect();   // scroll the board sideways near its edges
          if (ev.clientX > bd.right - 50) host.scrollLeft += 18; else if (ev.clientX < bd.left + 50) host.scrollLeft -= 18;
        };
        var upH = function () {
          document.removeEventListener('pointermove', mvH); document.removeEventListener('pointerup', upH); document.removeEventListener('pointercancel', upH);
          if (!ghost) return;
          ghost.remove(); el.classList.remove('dragging'); document.body.classList.remove('pdragging');
          setTimeout(function () { B.dragging = false; }, 0);
          if (over) { over.classList.remove('dropok'); moveTo(c, over.getAttribute('data-col')); }
        };
        document.addEventListener('pointermove', mvH); document.addEventListener('pointerup', upH); document.addEventListener('pointercancel', upH);
      });
    });
  }
  function draw() {
    var host = B.el && B.el.querySelector('#pboard'); if (!host || !B.data) return;
    var q = B.q.toLowerCase().trim();
    var cards = B.data.cards.filter(function (c) { return !q || (c.ref + ' ' + c.name + ' ' + c.suburb + ' ' + c.title + ' ' + (c.plan ? c.plan.name : '')).toLowerCase().indexOf(q) >= 0; });
    var openN = cards.filter(function (c) { return c.col !== 'closed'; }).length;
    var openV = cards.filter(function (c) { return c.col !== 'closed'; }).reduce(function (s, c) { return s + (c.value || 0); }, 0);
    B.el.querySelector('#pbSum').innerHTML = '<b>' + openN + '</b> open job' + (openN === 1 ? '' : 's') + ' · <b>' + money(openV) + '</b> quoted or invoiced';
    host.innerHTML = COLS.map(function (col) {
      var list = sortCol(col[0], cards.filter(function (c) { return c.col === col[0]; }));
      var val = list.reduce(function (s, c) { return s + (c.value || 0); }, 0);
      return '<section class="pcol" data-col="' + col[0] + '" style="--pc:' + col[2] + '"><header><div class="pcol-h"><b>' + col[1] + '</b><span class="pcol-n">' + list.length + '</span></div>' +
        '<small>' + (val ? money(val) + ' · ' : '') + esc(col[3]) + '</small></header>' +
        '<div class="pcol-b">' + (list.length ? list.map(card).join('') : '<div class="pcol-empty">Nothing here</div>') + '</div></section>';
    }).join('');
    host.querySelectorAll('.pcard').forEach(function (el) {
      var go = function (e) { if (B.dragging || e.target.closest('.pc-plink,.pc-move')) return; location.hash = '#job/' + el.getAttribute('data-core'); };
      el.addEventListener('click', go);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(e); });
    });
    bindDrag(host);
    var t = new Date(B.data.at);
    B.el.querySelector('#pbAt').textContent = 'Updated ' + t.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' });
  }
  function load() {
    var btn = B.el && B.el.querySelector('#pbRefresh'); if (btn) btn.disabled = true;
    return api('pipelineBoard', { closedDays: B.days }).then(function (d) { B.data = d; draw(); }).catch(fail).then(function () { if (btn) btn.disabled = false; });
  }
  function setFull(on) {
    document.body.classList.toggle('board-full', on);
    var b = B.el && B.el.querySelector('#pbFull'); if (b) b.textContent = on ? '✕ Exit full screen' : '⛶ Full screen';
  }
  function render(el) {
    B.el = el;
    el.innerHTML = '<div class="pbtool"><input id="pbQ" type="search" placeholder="Find a job, customer or suburb…" value="' + esc(B.q) + '">' +
      '<label class="muted" style="display:flex;gap:6px;align-items:center;font-size:13px">Closed jobs<select id="pbDays" style="width:auto">' +
      [[7, 'last 7 days'], [30, 'last 30 days'], [90, 'last 90 days'], [0, 'all']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === B.days ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<span id="pbSum" class="muted" style="font-size:13px"></span><span class="sp"></span><small class="muted" id="pbAt"></small>' +
      '<button class="btn btn-sm" id="pbRefresh" title="Load the latest">↻ Refresh</button><button class="btn btn-sm btn-gold" id="pbFull">' + (document.body.classList.contains('board-full') ? '✕ Exit full screen' : '⛶ Full screen') + '</button></div>' +
      '<div class="pboard" id="pboard"><div class="empty">Loading…</div></div>';
    el.querySelector('#pbQ').oninput = function () { B.q = this.value; draw(); };
    el.querySelector('#pbDays').onchange = function () { B.days = +this.value; store('mbsBoardDays', String(B.days)); load(); };
    el.querySelector('#pbRefresh').onclick = load;
    el.querySelector('#pbFull').onclick = function () { setFull(!document.body.classList.contains('board-full')); };
    clearInterval(B.timer);
    B.timer = setInterval(function () {   // keep the snapshot fresh while it is on screen
      if (!document.body.contains(el)) { clearInterval(B.timer); setFull(false); return; }
      if (!document.hidden && !B.dragging && $('#modal').hidden) load();
    }, 120000);
    return load();
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('board-full')) setFull(false); });
  window.addEventListener('hashchange', function () { if (document.body.classList.contains('board-full') && !/^#?(dashboard)?$/.test(location.hash)) setFull(false); });
  M.board = { render: render, full: setFull };
})();
