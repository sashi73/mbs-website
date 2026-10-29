/* MBS Console: accounts (quotes, tax invoices, payments, expenses, GST/BAS, profit). Plugs into admin.js via window.MBS. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, money = M.money, toast = M.toast, fail = M.fail, $ = M.$;
  var STATUS = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', void: 'Void', 'part-paid': 'Part-paid', paid: 'Paid', overdue: 'Overdue' };
  var SCLASS = { draft: 'st-lost', sent: 'st-new', accepted: 'st-won', declined: 'st-lost', expired: 'st-quoted', void: 'st-lost', 'part-paid': 'st-quoted', paid: 'st-paid', overdue: 'st-overdue' };
  var schip = function (s) { return '<span class="chip ' + (SCLASS[s] || '') + '">' + esc(STATUS[s] || s) + '</span>'; };
  var r2 = function (n) { return Math.round((Number(n) || 0) * 100) / 100; };
  var V = function () { return M.view(); };
  var pretty = function (ymd) { if (!ymd) return ''; var p = ymd.split('-').map(Number); return p[2] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][p[1] - 1] + ' ' + p[0]; };
  function todayParts() {
    var o = {}; new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day };
  }
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var ymd = function (y, m, d) { var t = new Date(Date.UTC(y, m - 1, d)); return t.toISOString().slice(0, 10); };
  function today() { var t = todayParts(); return ymd(t.y, t.m, t.d); }
  function addDays(s, n) { var p = s.split('-').map(Number); return ymd(p[0], p[1], p[2] + n); }

  // same GST maths as the server (accounts.mjs)
  function calc(items, inc) {
    var ex = 0, g = 0, t = 0;
    var lines = items.map(function (i) {
      var a = r2((Number(i.qty) || 0) * (Number(i.price) || 0)), le, lg, li;
      if (inc) { li = a; lg = i.gst ? r2(a / 11) : 0; le = r2(li - lg); } else { le = a; lg = i.gst ? r2(a * 0.1) : 0; li = r2(le + lg); }
      ex += le; g += lg; t += li; return { ex: le, gst: lg, inc: li };
    });
    return { lines: lines, ex: r2(ex), gst: r2(g), inc: r2(t) };
  }

  /* ================= lists ================= */
  function docTable(rows, type) {
    if (!rows.length) return '<div class="empty">Nothing here yet.</div>';
    return '<div class="table-wrap"><table><thead><tr><th>' + (type === 'quote' ? 'Quote' : 'Invoice') + '</th><th>Customer</th><th class="hide-sm">Job</th><th>' + (type === 'quote' ? 'Valid until' : 'Due') + '</th><th>Status</th><th style="text-align:right">Total</th>' +
      (type === 'invoice' ? '<th style="text-align:right" class="hide-sm">Balance</th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (d) {
        return '<tr class="click" data-doc="' + esc(d.id) + '"><td class="ref">' + esc(d.id) + '<br><small class="muted">' + esc(pretty(d.issued)) + '</small></td><td><b>' + esc(d.name || '—') + '</b></td><td class="hide-sm ref">' + esc(d.core || '') + '</td>' +
          '<td>' + esc(pretty(type === 'quote' ? d.validUntil : d.due)) + '</td><td>' + schip(d.shown) + '</td><td style="text-align:right;font-weight:800">' + money(d.inc) + '</td>' +
          (type === 'invoice' ? '<td style="text-align:right" class="hide-sm">' + (d.status === 'void' ? '' : money(d.balance)) + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function bindDocs() { V().querySelectorAll('[data-doc]').forEach(function (tr) { tr.onclick = function () { location.hash = '#doc/' + tr.getAttribute('data-doc'); }; }); }
  function tabs(base, list, on) { return '<div class="tabs">' + list.map(function (t) { return '<a class="tab' + (t[0] === on ? ' on' : '') + '" href="#' + base + '/' + t[0] + '" style="text-decoration:none">' + esc(t[1]) + (t[2] != null ? '<b>' + t[2] + '</b>' : '') + '</a>'; }).join('') + '</div>'; }

  function quotes(args) {
    var f = args[0] || 'all';
    return api('acctLists').then(function (d) {
      var count = function (s) { return d.quotes.filter(function (q) { return q.shown === s; }).length; };
      var rows = d.quotes.filter(function (q) { return f === 'all' ? q.shown !== 'void' : q.shown === f; });
      var open = d.quotes.filter(function (q) { return q.shown === 'sent'; }).reduce(function (a, q) { return a + q.inc; }, 0);
      var won = d.quotes.filter(function (q) { return q.shown === 'accepted'; }).reduce(function (a, q) { return a + q.inc; }, 0);
      V().innerHTML = '<div class="grid kpis" style="margin-bottom:16px">' + kpi('Waiting on customer', money(open), count('sent') + ' sent') + kpi('Accepted', money(won), count('accepted') + ' quote' + (count('accepted') === 1 ? '' : 's')) + kpi('Drafts', count('draft'), 'not sent yet') + '</div>' +
        tabs('quotes', [['all', 'All'], ['draft', 'Drafts', count('draft')], ['sent', 'Sent', count('sent')], ['accepted', 'Accepted', count('accepted')], ['declined', 'Declined', count('declined')], ['expired', 'Expired', count('expired')], ['void', 'Void']], f) +
        '<div class="card"><div class="card-h"><h2>Quotes</h2><a class="btn btn-sm btn-gold" href="#doc/new/quote">＋ New quote</a></div>' + docTable(rows, 'quote') + '</div>';
      bindDocs();
    });
  }
  function invoices(args) {
    var f = args[0] || 'all';
    return api('acctLists').then(function (d) {
      var live = d.invoices.filter(function (i) { return i.status !== 'void'; });
      var unpaid = live.filter(function (i) { return ['sent', 'part-paid', 'overdue'].indexOf(i.shown) >= 0; });
      var overdue = live.filter(function (i) { return i.shown === 'overdue'; });
      var sum = function (l, k) { return l.reduce(function (a, x) { return a + (x[k] || 0); }, 0); };
      var t = todayParts(), mStart = t.y + '-' + pad(t.m) + '-01';
      var rows = live.concat(d.invoices.filter(function (i) { return i.status === 'void'; })).filter(function (i) {
        return f === 'all' ? i.status !== 'void' : f === 'unpaid' ? ['sent', 'part-paid', 'overdue'].indexOf(i.shown) >= 0 : i.shown === f;
      });
      V().innerHTML = (d.bank ? '' : '<div class="warn" style="margin-bottom:14px">Bank details aren\'t set yet, so invoices say “call for payment details”. Add <b>BANK_ACCOUNT_NAME</b>, <b>BANK_BSB</b> and <b>BANK_ACCOUNT_NUMBER</b> in Netlify.</div>') +
        '<div class="grid kpis" style="margin-bottom:16px">' + kpi('Owed to you', money(sum(unpaid, 'balance')), unpaid.length + ' unpaid invoice' + (unpaid.length === 1 ? '' : 's'), 'gold') +
          kpi('Overdue', money(sum(overdue, 'balance')), overdue.length + ' past the due date') + kpi('Invoiced this month', money(sum(live.filter(function (i) { return i.issued >= mStart && i.status !== 'draft'; }), 'inc')), 'inc GST') + '</div>' +
        tabs('invoices', [['all', 'All'], ['draft', 'Drafts', live.filter(function (i) { return i.shown === 'draft'; }).length], ['unpaid', 'Unpaid', unpaid.length], ['overdue', 'Overdue', overdue.length], ['paid', 'Paid', live.filter(function (i) { return i.shown === 'paid'; }).length], ['void', 'Void']], f) +
        '<div class="card"><div class="card-h"><h2>Tax invoices</h2><a class="btn btn-sm btn-gold" href="#doc/new/invoice">＋ New invoice</a></div>' + docTable(rows, 'invoice') + '</div>';
      bindDocs();
    });
  }
  function kpi(k, v, s, cls) { return '<div class="card kpi ' + (cls || '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>'; }

  /* ================= quote / invoice editor ================= */
  function docView(args) {
    if (args[0] === 'new') {
      var type = args[1] === 'invoice' ? 'invoice' : 'quote', core = args[2] || '';
      if (core) return api('docCreate', { type: type, core: core }).then(function (r) { history.replaceState(null, '', '#doc/' + r.doc.id); editor(r.doc); });
      var issued = today();
      return Promise.resolve(editor({ id: null, type: type, status: 'draft', shown: 'draft', issued: issued, due: addDays(issued, 7), validUntil: addDays(issued, 30), customer: {}, items: [{ desc: '', qty: 1, price: '', gst: true }], pricesInc: false, notes: '', title: '', payments: [], paid: 0, history: [], core: '' }));
    }
    return api('docGet', { id: args[0] }).then(function (r) { editor(r.doc, r); });
  }

  function editor(d, meta) {
    meta = meta || {};
    var isQ = d.type === 'quote', locked = d.status === 'void' || d.status === 'paid' || (!isQ && d.paid > 0) || (isQ && !!d.invoiceId);
    var items = (d.items && d.items.length ? d.items : [{ desc: '', qty: 1, price: '', gst: true }]).map(function (i) { return { desc: i.desc, qty: i.qty, price: i.price, gst: i.gst !== false }; });
    var dirty = false;
    var dis = locked ? ' disabled' : '';
    var title = d.id ? (isQ ? 'Quote ' : 'Invoice ') + d.id : 'New ' + (isQ ? 'quote' : 'invoice');
    $('#title').textContent = isQ ? 'Quote' : 'Tax invoice';
    V().innerHTML =
      '<div class="row" style="margin-bottom:14px"><a class="btn btn-sm" href="#' + (isQ ? 'quotes' : 'invoices') + '">← ' + (isQ ? 'Quotes' : 'Invoices') + '</a><h2 style="font-size:22px">' + esc(title) + '</h2>' + schip(d.shown || d.status) +
        (d.core ? '<a class="chip st-new" href="#job/' + esc(d.core) + '" style="text-decoration:none">Job ' + esc(d.core) + '</a>' : '') +
        (d.fromQuote ? '<a class="chip st-won" href="#doc/' + esc(d.fromQuote) + '" style="text-decoration:none">From ' + esc(d.fromQuote) + '</a>' : '') +
        (d.invoiceId ? '<a class="chip st-invoiced" href="#doc/' + esc(d.invoiceId) + '" style="text-decoration:none">Invoiced: ' + esc(d.invoiceId) + '</a>' : '') + '</div>' +
      (locked ? '<div class="note" style="margin-bottom:14px">This ' + (isQ ? 'quote' : 'invoice') + ' is ' + esc(isQ && d.invoiceId ? 'invoiced as ' + d.invoiceId : (STATUS[d.status] || d.status).toLowerCase()) + (d.paid > 0 && d.status !== 'paid' ? ' (has payments)' : '') + ', so it can\'t be edited. ' + (d.status !== 'void' && !(d.paid > 0) ? '' : '') + '</div>' : '') +
      '<div class="grid two">' +
        '<div class="grid" style="align-content:start">' +
          '<div class="card"><h2>' + (isQ ? 'Prepared for' : 'Bill to') + '</h2><div class="form">' +
            '<label>Customer name *<input id="cName" value="' + esc(d.customer.name) + '"' + dis + '></label><label>Email<input id="cEmail" type="email" value="' + esc(d.customer.email) + '"' + dis + '></label>' +
            '<label>Phone<input id="cPhone" value="' + esc(d.customer.phone) + '"' + dis + '></label><label>Address<input id="cAddr" value="' + esc(d.customer.address) + '" placeholder="Street, suburb, postcode"' + dis + '></label>' +
            '<label class="full">Heading (shown on the document)<input id="dTitle" value="' + esc(d.title) + '" placeholder="e.g. Bathroom waterproofing and retiling"' + dis + '></label>' +
            '<label>Date<input id="dIssued" type="date" value="' + esc(d.issued) + '"' + dis + '></label>' +
            '<label>' + (isQ ? 'Valid until' : 'Due date (7 days)') + '<input id="dDue" type="date" value="' + esc(isQ ? d.validUntil : d.due) + '"' + dis + '></label>' +
          '</div></div>' +
          '<div class="card"><div class="card-h"><h2>Items</h2><label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" id="pInc" style="width:auto"' + (d.pricesInc ? ' checked' : '') + dis + '>Prices include GST</label></div>' +
            '<div class="table-wrap"><table class="items"><thead><tr><th>Description</th><th style="width:70px">Qty</th><th style="width:110px" id="unitHead">Unit ' + (d.pricesInc ? 'inc' : 'ex') + ' GST</th><th style="width:54px">GST</th><th style="width:100px;text-align:right">Amount</th><th style="width:36px"></th></tr></thead><tbody id="itemRows"></tbody></table></div>' +
            (locked ? '' : '<button class="btn btn-sm" id="addLine" type="button" style="margin-top:10px">＋ Add line</button>') +
            '<div id="totals" style="margin-top:14px"></div></div>' +
          '<div class="card"><h2>Notes on the document</h2><textarea id="dNotes" rows="3" placeholder="e.g. 7-year waterproofing warranty. Work starts within 2 weeks of acceptance."' + dis + '>' + esc(d.notes) + '</textarea></div>' +
        '</div>' +
        '<div class="grid" style="align-content:start">' +
          (d.plan ? '<div class="card" id="docPlan"><h2>📅 Project plan</h2><p style="margin:0 0 8px;font-size:13.5px">' + (isQ ? 'Made from the project plan' : 'Linked to the project plan' + (d.plan.fromQuote ? ' (via quote ' + esc(d.plan.fromQuote) + ')' : '')) + ' of job <b>' + esc(d.core) + '</b>' + (d.plan.at ? ', ' + esc(M.date(d.plan.at)) : '') + '.</p>' +
            '<p class="muted" style="margin:0 0 10px;font-size:12.5px">The PDF is a pack: a cover page with the MBS logo, this ' + (isQ ? 'quote' : 'tax invoice') + ', and 2 pages of high-level project plan' + (isQ ? ' (scope, risks, milestones, Gantt chart) as it was when the quote was made.' : ' showing today\'s progress.') + '</p>' +
            '<a class="btn btn-sm" href="#plan/' + esc(d.core) + '">Open the plan →</a></div>' : '') +
          '<div class="card"><h2>Actions</h2><div class="actions" id="docActions"></div><p class="muted" id="saveState" style="margin:10px 0 0;font-size:13px"></p></div>' +
          (!isQ && d.id ? '<div class="card"><h2>Payments</h2><div id="payList"></div></div>' : '') +
          (d.history && d.history.length ? '<div class="card"><h2>History</h2><ul class="timeline">' + d.history.slice().reverse().map(function (h) { return '<li>' + esc(h.text) + '<small>' + esc(h.by) + ' · ' + esc(M.date(h.at)) + '</small></li>'; }).join('') + '</ul></div>' : '') +
        '</div>' +
      '</div>';

    function drawRows() {
      var tb = $('#itemRows');
      tb.innerHTML = items.map(function (i, n) {
        return '<tr><td><textarea rows="2" data-i="' + n + '" data-k="desc" placeholder="Describe the work or materials"' + dis + '>' + esc(i.desc) + '</textarea></td>' +
          '<td><input data-i="' + n + '" data-k="qty" inputmode="decimal" value="' + esc(i.qty) + '"' + dis + '></td>' +
          '<td><input data-i="' + n + '" data-k="price" inputmode="decimal" placeholder="0.00" value="' + esc(i.price) + '"' + dis + '></td>' +
          '<td style="text-align:center"><input type="checkbox" data-i="' + n + '" data-k="gst" style="width:auto"' + (i.gst ? ' checked' : '') + dis + ' title="Charge GST on this line"></td>' +
          '<td style="text-align:right;font-weight:700" data-amt="' + n + '"></td><td>' + (locked ? '' : '<button class="btn btn-sm" data-rm="' + n + '" type="button" title="Remove line">✕</button>') + '</td></tr>';
      }).join('');
      tb.querySelectorAll('[data-k]').forEach(function (el) {
        el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', function () {
          var i = items[+el.getAttribute('data-i')], k = el.getAttribute('data-k');
          i[k] = el.type === 'checkbox' ? el.checked : el.value;
          mark(); drawTotals();
        });
      });
      tb.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { items.splice(+b.getAttribute('data-rm'), 1); if (!items.length) items.push({ desc: '', qty: 1, price: '', gst: true }); mark(); drawRows(); }; });
      drawTotals();
    }
    function num(v) { return Number(String(v).replace(/[$,\s]/g, '')) || 0; }
    function drawTotals() {
      var t = calc(items.map(function (i) { return { qty: num(i.qty), price: num(i.price), gst: i.gst }; }), $('#pInc').checked);
      t.lines.forEach(function (l, n) { var c = V().querySelector('[data-amt="' + n + '"]'); if (c) c.textContent = money($('#pInc').checked ? l.inc : l.ex); });
      var rows = [['Subtotal (ex GST)', money(t.ex)], ['GST (10%)', money(t.gst)], ['Total (inc GST)', money(t.inc), 1]];
      if (!isQ && d.paid > 0) { rows.push(['Paid', '−' + money(d.paid)]); rows.push(['Balance due', money(t.inc - d.paid), 1]); }
      $('#totals').innerHTML = '<table style="max-width:340px;margin-left:auto"><tbody>' + rows.map(function (r) { return '<tr><td' + (r[2] ? ' style="font-weight:800"' : ' class="muted"') + '>' + r[0] + '</td><td style="text-align:right;' + (r[2] ? 'font-weight:800;font-size:16px' : '') + '">' + r[1] + '</td></tr>'; }).join('') + '</tbody></table>';
    }
    function mark() { dirty = true; $('#saveState').textContent = 'Unsaved changes'; }
    ['cName', 'cEmail', 'cPhone', 'cAddr', 'dTitle', 'dIssued', 'dDue', 'dNotes'].forEach(function (id) { $('#' + id).addEventListener('input', mark); });
    $('#pInc').addEventListener('change', function () { $('#unitHead').textContent = 'Unit ' + (this.checked ? 'inc' : 'ex') + ' GST'; mark(); drawTotals(); });
    $('#dIssued').addEventListener('change', function () { if (this.value) $('#dDue').value = addDays(this.value, isQ ? 30 : 7); });
    if ($('#addLine')) $('#addLine').onclick = function () { items.push({ desc: '', qty: 1, price: '', gst: true }); mark(); drawRows(); var t = V().querySelectorAll('#itemRows textarea'); t[t.length - 1].focus(); };

    function fields() {
      var f = { customer: { name: $('#cName').value, email: $('#cEmail').value, phone: $('#cPhone').value, address: $('#cAddr').value }, title: $('#dTitle').value,
        issued: $('#dIssued').value, notes: $('#dNotes').value, pricesInc: $('#pInc').checked,
        items: items.map(function (i) { return { desc: i.desc, qty: num(i.qty), price: num(i.price), gst: i.gst }; }).filter(function (i) { return i.desc || i.price; }) };
      f[isQ ? 'validUntil' : 'due'] = $('#dDue').value;
      return f;
    }
    function save(quiet) {
      if (locked) return Promise.resolve(d);
      if (!$('#cName').value.trim()) { fail(new Error('Enter the customer\'s name')); return Promise.reject(new Error('no name')); }
      var p = d.id ? api('docUpdate', { id: d.id, fields: fields() }) : api('docCreate', { type: d.type, fields: fields() });
      return p.then(function (r) {
        dirty = false;
        if (!quiet) toast('Saved ' + r.doc.id);
        if (!d.id) { history.replaceState(null, '', '#doc/' + r.doc.id); }
        d = r.doc; return d;
      });
    }
    function reload() { return api('docGet', { id: d.id }).then(function (r) { editor(r.doc, r); }); }

    // ---- actions ----
    var A = [];
    if (!locked) A.push('<button class="btn btn-gold" id="aSave">💾 Save</button>');
    if (d.id) A.push('<button class="btn" id="aPdf">👁 Preview PDF</button><a class="btn" id="aDl" href="' + M.API + '?action=pdf&download=1&id=' + encodeURIComponent(d.id) + '">⬇ PDF</a>');
    if (d.status !== 'void') A.push('<button class="btn btn-dark" id="aSend">✉ ' + (d.sentAt ? 'Send again' : 'Email to customer') + '</button>');
    if (d.id && d.status === 'draft') A.push('<button class="btn" id="aSent">Mark as sent</button>');
    if (isQ && d.id && ['sent', 'draft'].indexOf(d.status) >= 0) A.push('<button class="btn" id="aAcc">✅ Accepted</button><button class="btn" id="aDec">Declined</button>');
    if (isQ && d.id && !d.invoiceId && d.status !== 'void' && d.status !== 'declined') A.push('<button class="btn btn-gold" id="aInv">🧾 Make invoice</button>');
    if (!isQ && d.id && ['sent', 'part-paid', 'draft'].indexOf(d.status) >= 0) A.push('<button class="btn btn-gold" id="aPay">💰 Record payment</button>');
    if (d.id && d.status !== 'void' && !(d.paid > 0)) A.push(d.status === 'draft' ? '<button class="btn btn-danger" id="aDel">Delete draft</button>' : '<button class="btn" id="aVoid">Void</button>');
    $('#docActions').innerHTML = A.join('');
    $('#saveState').textContent = d.id ? (d.sentAt ? 'Last sent ' + M.date(d.sentAt) + (d.customer.email ? ' to ' + d.customer.email : '') : 'Saved as a draft. Not sent yet.') : 'Not saved yet.';
    var on = function (id, fn) { var b = $('#' + id); if (b) b.onclick = fn; };
    on('aSave', function () { save().then(reload).catch(function (e) { if (e.message !== 'no name') fail(e); }); });
    on('aPdf', function () { var w = window.open('about:blank', '_blank'); (dirty ? save(true) : Promise.resolve(d)).then(function () { if (w) w.location = M.API + '?action=pdf&id=' + encodeURIComponent(d.id) + '&t=' + Date.now(); }).catch(function (e) { if (w) w.close(); fail(e); }); });
    on('aSend', function () {
      (dirty || !d.id ? save(true) : Promise.resolve(d)).then(function () {
        var defMsg = isQ ? 'Thanks for the opportunity to quote. Please find our quote attached. Any questions, just reply to this email or give us a call.'
          : 'Please find your tax invoice attached. Thank you for choosing Modern Building Solutions.';
        M.modal('<h2>Email ' + esc(d.id) + ' to the customer</h2><div class="form" style="grid-template-columns:1fr;margin-top:12px">' +
          '<label>To<input id="sTo" type="email" value="' + esc(d.customer.email || '') + '" placeholder="customer@example.com"></label>' +
          '<label>Message<textarea id="sMsg" rows="4">' + esc(defMsg) + '</textarea></label>' +
          '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="sCopy" checked style="width:auto">Send me a copy</label>' +
          '<p class="muted" style="margin:0">The ' + (isQ ? 'quote' : 'tax invoice') + ' is attached as a PDF. Replies go to your business email.</p></div>' +
          '<div class="actions" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>Cancel</button><button class="btn btn-gold" id="sGo">Send</button></div>');
        $('#sGo').onclick = function () {
          var b = this; b.disabled = true; b.textContent = 'Sending…';
          api('docSend', { id: d.id, to: $('#sTo').value, message: $('#sMsg').value, copyMe: $('#sCopy').checked })
            .then(function (r) { M.closeModal(); toast('Sent to ' + r.to); reload(); })
            .catch(function (e) { b.disabled = false; b.textContent = 'Send'; fail(e); });
        };
      }).catch(function (e) { if (e.message !== 'no name') fail(e); });
    });
    var status = function (s, msg) { return function () { (dirty ? save(true) : Promise.resolve(d)).then(function () { return api('docStatus', { id: d.id, status: s }); }).then(function () { toast(msg); reload(); }).catch(fail); }; };
    on('aSent', status('sent', 'Marked as sent'));
    on('aAcc', status('accepted', 'Quote accepted, job marked as won'));
    on('aDec', status('declined', 'Marked as declined'));
    on('aInv', function () { (dirty ? save(true) : Promise.resolve(d)).then(function () { return api('docToInvoice', { id: d.id }); }).then(function (r) { toast('Invoice ' + r.doc.id + ' created'); location.hash = '#doc/' + r.doc.id; }).catch(fail); });
    on('aVoid', function () { M.confirmBox('Void ' + d.id + '?', 'It stays in your records marked VOID (its number is never reused). This can\'t be undone.', 'Void', true).then(function (ok) { if (ok) api('docStatus', { id: d.id, status: 'void' }).then(function () { toast('Voided'); reload(); }).catch(fail); }); });
    on('aDel', function () { M.confirmBox('Delete draft ' + d.id + '?', 'The draft is deleted permanently.', 'Delete', true).then(function (ok) { if (ok) api('docDelete', { id: d.id }).then(function () { toast('Draft deleted'); location.hash = isQ ? '#quotes' : '#invoices'; }).catch(fail); }); });
    on('aPay', function () {
      var bal = r2(d.totals.inc - (d.paid || 0));
      M.modal('<h2>Record a payment for ' + esc(d.id) + '</h2><p class="muted">Still owing: <b>' + money(bal) + '</b></p><div class="form">' +
        '<label>Amount received *<input id="pAmt" inputmode="decimal" value="' + bal.toFixed(2) + '"></label><label>Date<input id="pDate" type="date" value="' + today() + '"></label>' +
        '<label>Method<select id="pMeth">' + (meta.methods || ['Bank transfer', 'Card', 'Cash', 'Cheque', 'Other']).map(function (m) { return '<option>' + esc(m) + '</option>'; }).join('') + '</select></label>' +
        '<label>Reference<input id="pRef" placeholder="e.g. bank reference"></label></div>' +
        '<div class="actions" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>Cancel</button><button class="btn btn-gold" id="pGo">Save payment</button></div>');
      $('#pGo').onclick = function () { api('payAdd', { id: d.id, amount: $('#pAmt').value.replace(/[$,]/g, ''), date: $('#pDate').value, method: $('#pMeth').value, ref: $('#pRef').value }).then(function (r) { M.closeModal(); toast(r.doc.status === 'paid' ? 'Paid in full' : 'Payment saved'); reload(); }).catch(fail); };
    });
    if ($('#payList')) {
      $('#payList').innerHTML = (d.payments || []).length ? '<div class="list">' + d.payments.map(function (p) {
        return '<div class="item"><div><b>' + money(p.amount) + '</b> · ' + esc(p.method) + '<br><small>' + esc(pretty(p.date)) + (p.ref ? ' · ' + esc(p.ref) : '') + '</small></div><button class="btn btn-sm" data-unpay="' + p.id + '" title="Remove payment">✕</button></div>';
      }).join('') + '</div>' : '<p class="muted" style="margin:0">No payments yet.</p>';
      $('#payList').querySelectorAll('[data-unpay]').forEach(function (b) { b.onclick = function () { M.confirmBox('Remove this payment?', 'Only do this if it was recorded by mistake.', 'Remove', true).then(function (ok) { if (ok) api('payRemove', { id: d.id, payId: +b.getAttribute('data-unpay') }).then(function () { toast('Payment removed'); reload(); }).catch(fail); }); }; });
    }
    meta.saved = !!d.id;
    drawRows();
    window.onbeforeunload = function () { return dirty ? 'You have unsaved changes' : undefined; };
  }

  /* ================= expenses ================= */
  function expenses(args) {
    var t = todayParts(), def = args[0] || 'fy';
    var range = presets()[def] || presets().fy;
    return api('acctLists').then(function (d) {
      var rows = d.expenses.filter(function (e) { return e.date >= range.from && e.date <= range.to; });
      var tot = rows.reduce(function (a, e) { a.inc += e.inc; a.gst += e.gst; return a; }, { inc: 0, gst: 0 });
      V().innerHTML = tabs('expenses', [['month', 'This month'], ['quarter', 'This quarter'], ['fy', 'This financial year'], ['lastfy', 'Last financial year'], ['all', 'All']], def) +
        '<div class="grid kpis" style="margin-bottom:16px">' + kpi('Spent', money(tot.inc), rows.length + ' expense' + (rows.length === 1 ? '' : 's') + ' (inc GST)') + kpi('GST you can claim', money(tot.gst), 'GST credits (1B)', 'gold') + kpi('Ex GST', money(tot.inc - tot.gst), range.name) + '</div>' +
        '<div class="card"><div class="card-h"><h2>Expenses</h2><button class="btn btn-sm btn-gold" id="newExp">＋ Add expense</button></div>' +
        (rows.length ? '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Supplier</th><th class="hide-sm">Category</th><th class="hide-sm">Job</th><th style="text-align:right">Amount</th><th style="text-align:right" class="hide-sm">GST</th><th></th></tr></thead><tbody>' +
          rows.map(function (e) {
            return '<tr class="click" data-exp="' + esc(e.id) + '"><td>' + esc(pretty(e.date)) + '<br><small class="muted ref">' + esc(e.id) + '</small></td><td><b>' + esc(e.supplier || '—') + '</b><br><small class="muted">' + esc(e.desc) + '</small></td>' +
              '<td class="hide-sm">' + esc(e.category) + '</td><td class="hide-sm ref">' + esc(e.core) + '</td><td style="text-align:right;font-weight:800">' + money(e.inc) + '</td><td style="text-align:right" class="hide-sm">' + money(e.gst) + '</td><td>' + (e.receipt ? '📎' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">No expenses in this period.</div>') + '</div>';
      $('#newExp').onclick = function () { expenseForm(null, d.categories); };
      V().querySelectorAll('[data-exp]').forEach(function (tr) { tr.onclick = function () { api('docGet', { id: tr.getAttribute('data-exp') }).then(function (r) { expenseForm(r.doc, r.categories); }).catch(fail); }; });
    });
  }
  function shrink(file) {   // photos are made smaller in the browser (max 1600px) before upload
    return new Promise(function (res, rej) {
      if (file.type === 'application/pdf') { if (file.size > 5 * 1024 * 1024) return rej(new Error('PDF too big (max 5 MB)')); var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(file); return; }
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () { var s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.82)); };
      img.onerror = function () { rej(new Error('That photo could not be read')); }; img.src = url;
    });
  }
  function expenseForm(e, cats, core) {
    e = e || { date: today(), supplier: '', desc: '', category: 'Materials', inc: '', gst: '', gstIncluded: true, core: core || '' };
    M.modal('<h2>' + (e.id ? 'Expense ' + esc(e.id) : 'Add an expense') + '</h2><div class="form" style="margin-top:12px">' +
      '<label>Date<input id="eDate" type="date" value="' + esc(e.date) + '"></label><label>Supplier<input id="eSup" value="' + esc(e.supplier) + '" placeholder="e.g. Bunnings"></label>' +
      '<label class="full">What for?<input id="eDesc" value="' + esc(e.desc) + '" placeholder="e.g. Ardex membrane, 4 tubs"></label>' +
      '<label>Category<select id="eCat">' + (cats || []).map(function (c) { return '<option' + (c === e.category ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      '<label>Job (optional)<input id="eJob" value="' + esc(e.core) + '" placeholder="e.g. W-261028-000001"></label>' +
      '<label>Amount paid (inc GST) *<input id="eInc" inputmode="decimal" value="' + esc(e.inc) + '" placeholder="0.00"></label>' +
      '<label>GST in it<input id="eGst" inputmode="decimal" value="' + esc(e.id ? e.gst : '') + '" placeholder="auto: 1/11"></label>' +
      '<label class="full" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="eHasGst" style="width:auto"' + (e.gstIncluded !== false ? ' checked' : '') + '>The amount includes GST (untick for GST-free items, e.g. council fees, overseas software)</label>' +
      '<label class="full">Receipt (photo or PDF)<input id="eFile" type="file" accept="image/*,application/pdf"></label>' +
      (e.receipt ? '<p class="full" style="margin:0"><a href="' + M.API + '?action=receipt&id=' + encodeURIComponent(e.id) + '" target="_blank" rel="noopener">📎 View the saved receipt</a></p>' : '') +
      '</div><div class="actions" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>Cancel</button><button class="btn btn-gold" id="eGo">Save expense</button></div>');
    var auto = function () { if (!$('#eGst').dataset.touched) { var v = Number($('#eInc').value.replace(/[$,]/g, '')) || 0; $('#eGst').placeholder = $('#eHasGst').checked ? 'auto: ' + money(v / 11) : 'GST-free'; } };
    $('#eInc').oninput = auto; $('#eHasGst').onchange = auto; $('#eGst').oninput = function () { this.dataset.touched = 1; }; auto();
    $('#eGo').onclick = function () {
      var b = this; b.disabled = true;
      var f = $('#eFile').files[0];
      (f ? shrink(f) : Promise.resolve(null)).then(function (data) {
        return api('expSave', { id: e.id || null, receipt: data, fields: { date: $('#eDate').value, supplier: $('#eSup').value, desc: $('#eDesc').value, category: $('#eCat').value, core: $('#eJob').value.trim(),
          inc: $('#eInc').value.replace(/[$,]/g, ''), gst: $('#eGst').dataset.touched ? $('#eGst').value.replace(/[$,]/g, '') : '', gstIncluded: $('#eHasGst').checked } });
      }).then(function (r) { M.closeModal(); toast('Saved ' + r.doc.id); M.route(); }).catch(function (err) { b.disabled = false; fail(err); });
    };
  }

  /* ================= accounting & BAS ================= */
  function presets() {
    var t = todayParts(), y = t.y, m = t.m;
    var q0 = Math.floor((m - 1) / 3) * 3 + 1, fyStart = m >= 7 ? y : y - 1;
    var end = function (yy, mm) { return ymd(yy, mm + 1, 0); };
    var lq = q0 - 3 < 1 ? { y: y - 1, m: q0 + 9 } : { y: y, m: q0 - 3 };
    var lm = m === 1 ? { y: y - 1, m: 12 } : { y: y, m: m - 1 };
    var qn = function (mm) { return ({ 1: 'Jan–Mar', 4: 'Apr–Jun', 7: 'Jul–Sep', 10: 'Oct–Dec' })[mm]; };
    return {
      quarter: { from: ymd(y, q0, 1), to: end(y, q0 + 2), name: 'This quarter (' + qn(q0) + ' ' + y + ')' },
      lastquarter: { from: ymd(lq.y, lq.m, 1), to: end(lq.y, lq.m + 2), name: 'Last quarter (' + qn(lq.m) + ' ' + lq.y + ')' },
      month: { from: ymd(y, m, 1), to: end(y, m), name: 'This month' },
      lastmonth: { from: ymd(lm.y, lm.m, 1), to: end(lm.y, lm.m), name: 'Last month' },
      fy: { from: ymd(fyStart, 7, 1), to: ymd(fyStart + 1, 6, 30), name: 'FY ' + fyStart + '–' + String(fyStart + 1).slice(2) },
      lastfy: { from: ymd(fyStart - 1, 7, 1), to: ymd(fyStart, 6, 30), name: 'FY ' + (fyStart - 1) + '–' + String(fyStart).slice(2) },
      all: { from: '2000-01-01', to: '2999-12-31', name: 'All time' }
    };
  }
  function accounts(args) {
    var P = presets(), key = args[0] || 'quarter', basis = args[1] === 'accrual' ? 'accrual' : 'cash';
    var range = key === 'custom' ? { from: args[2] || P.quarter.from, to: args[3] || P.quarter.to, name: 'Custom' } : (P[key] || P.quarter);
    return api('acctReport', { from: range.from, to: range.to, basis: basis }).then(function (d) {
      var pl = d.pnl, b = d.bas, rcv = d.receivables;
      var cats = Object.keys(pl.byCategory).sort(function (x, y) { return pl.byCategory[y] - pl.byCategory[x]; });
      var maxCat = cats.length ? pl.byCategory[cats[0]] : 1;
      var exp = function (what) { return M.API + '?action=acctExport&what=' + what + '&from=' + range.from + '&to=' + range.to; };
      V().innerHTML =
        '<div class="row" style="margin-bottom:12px"><div class="tabs" style="margin:0">' + [['quarter', 'This quarter'], ['lastquarter', 'Last quarter'], ['month', 'This month'], ['lastmonth', 'Last month'], ['fy', 'This FY'], ['lastfy', 'Last FY'], ['all', 'All']].map(function (p) {
            return '<a class="tab' + (p[0] === key ? ' on' : '') + '" href="#accounts/' + p[0] + '/' + basis + '" style="text-decoration:none">' + p[1] + '</a>'; }).join('') + '</div><span class="sp"></span>' +
          '<div class="tabs" style="margin:0"><a class="tab' + (basis === 'cash' ? ' on' : '') + '" href="#accounts/' + key + '/cash' + (key === 'custom' ? '/' + range.from + '/' + range.to : '') + '" style="text-decoration:none" title="Income counted when the money arrives">Cash basis</a><a class="tab' + (basis === 'accrual' ? ' on' : '') + '" href="#accounts/' + key + '/accrual' + (key === 'custom' ? '/' + range.from + '/' + range.to : '') + '" style="text-decoration:none" title="Income counted when the invoice is issued">Accrual basis</a></div></div>' +
        '<div class="row" style="margin-bottom:16px"><b>' + esc(range.name) + '</b><span class="muted">' + esc(pretty(range.from)) + ' to ' + esc(pretty(range.to)) + '</span><span class="sp"></span>' +
          '<label style="display:flex;gap:6px;align-items:center;font-weight:600">From<input type="date" id="cFrom" value="' + esc(range.from) + '" style="width:auto"></label><label style="display:flex;gap:6px;align-items:center;font-weight:600">to<input type="date" id="cTo" value="' + esc(range.to) + '" style="width:auto"></label><button class="btn btn-sm" id="cGo">Show</button></div>' +
        '<div class="grid kpis">' + kpi('Income (ex GST)', money(pl.income.ex), pl.income.count + (basis === 'cash' ? ' payment' : ' invoice') + (pl.income.count === 1 ? '' : 's') + ' · ' + money(pl.income.inc) + ' inc GST') +
          kpi('Expenses (ex GST)', money(pl.expenses.ex), pl.expenses.count + ' expense' + (pl.expenses.count === 1 ? '' : 's')) + kpi('Profit (before tax)', money(pl.profit), pl.income.ex ? Math.round(pl.profit / pl.income.ex * 100) + '% margin' : '—', 'gold') + '</div>' +
        '<div class="grid two" style="margin-top:16px">' +
          '<div class="card"><div class="card-h"><h2>BAS summary (GST)</h2><span class="badge">' + (basis === 'cash' ? 'Cash' : 'Accrual') + '</span></div><div class="table-wrap"><table><tbody>' +
            [['G1', 'Total sales (inc GST)', b.G1], ['1A', 'GST on sales', b['1A']], ['G11', 'Purchases (inc GST)', b.G11], ['1B', 'GST on purchases (credits)', b['1B']]].map(function (r) { return '<tr><td class="ref">' + r[0] + '</td><td>' + r[1] + '</td><td style="text-align:right;font-weight:700">' + money(r[2]) + '</td></tr>'; }).join('') +
            '<tr><td></td><td style="font-weight:800">' + (b.net >= 0 ? 'GST to pay the ATO (1A − 1B)' : 'GST refund due (1B − 1A)') + '</td><td style="text-align:right;font-weight:800;font-size:17px">' + money(Math.abs(b.net)) + '</td></tr>' +
          '</tbody></table></div><p class="muted" style="margin:12px 0 0;font-size:12.5px">A guide to help fill in your BAS. Check it with your accountant or BAS agent before lodging; capital purchases (G10) and wages (W1/W2) aren\'t covered here.</p></div>' +
          '<div class="card"><h2>Expenses by category (ex GST)</h2>' + (cats.length ? '<div class="list">' + cats.map(function (c) {
              return '<div><div class="row" style="justify-content:space-between"><span>' + esc(c) + '</span><b>' + money(pl.byCategory[c]) + '</b></div><div class="pipe" style="height:8px;margin:4px 0 0"><span style="width:' + (pl.byCategory[c] / maxCat * 100) + '%;background:#C9A227"></span></div></div>'; }).join('') + '</div>' : '<div class="empty">No expenses in this period.</div>') + '</div>' +
        '</div>' +
        '<div class="grid two" style="margin-top:16px">' +
          '<div class="card"><div class="card-h"><h2>Money owed to you</h2><b>' + money(rcv.total) + '</b></div>' +
            '<div class="grid kpis" style="grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:12px">' + [['Not due', 'current'], ['1–30 days', 'd1_30'], ['31–60', 'd31_60'], ['61–90', 'd61_90'], ['90+', 'd90']].map(function (x) {
                return '<div class="card" style="padding:10px;box-shadow:none"><div class="muted" style="font-size:11.5px;font-weight:800">' + x[0] + '</div><div style="font-weight:800">' + money(rcv.buckets[x[1]]) + '</div></div>'; }).join('') + '</div>' +
            (rcv.rows.length ? '<div class="list">' + rcv.rows.map(function (r) { return '<a class="item" href="#doc/' + esc(r.id) + '" style="text-decoration:none"><div><b>' + esc(r.name) + '</b> <span class="ref">' + esc(r.id) + '</span><br><small>' + (r.daysLate ? '<span style="color:#C2410C;font-weight:700">' + r.daysLate + ' days overdue</span>' : 'due ' + esc(pretty(r.due))) + '</small></div><b>' + money(r.balance) + '</b></a>'; }).join('') + '</div>' : '<div class="empty">Nothing owed. 🎉</div>') + '</div>' +
          '<div class="card"><h2>Profit by job (ex GST)</h2>' + (d.jobs.length ? '<div class="table-wrap"><table><thead><tr><th>Job</th><th style="text-align:right">Invoiced</th><th style="text-align:right">Costs</th><th style="text-align:right">Profit</th></tr></thead><tbody>' +
            d.jobs.map(function (j) { return '<tr class="click" data-jobp="' + esc(j.core) + '"><td><span class="ref">' + esc(j.ref) + '</span><br><small class="muted">' + esc(j.name) + '</small></td><td style="text-align:right">' + money(j.invoiced) + '</td><td style="text-align:right">' + money(j.costs) + '</td><td style="text-align:right;font-weight:800;color:' + (j.profit < 0 ? '#C2410C' : '#15803D') + '">' + money(j.profit) + (j.margin !== null ? '<br><small class="muted">' + j.margin + '%</small>' : '') + '</td></tr>'; }).join('') +
            '</tbody></table></div>' : '<div class="empty">Link invoices and expenses to jobs to see profit per job.</div>') + '</div>' +
        '</div>' +
        '<div class="card" style="margin-top:16px"><div class="card-h"><h2>For your accountant</h2></div><div class="actions"><a class="btn" href="' + exp('invoices') + '">⬇ Invoices (CSV)</a><a class="btn" href="' + exp('payments') + '">⬇ Payments received (CSV)</a><a class="btn" href="' + exp('expenses') + '">⬇ Expenses (CSV)</a><button class="btn" onclick="window.print()">🖨 Print this page</button></div></div>';
      $('#cGo').onclick = function () { location.hash = '#accounts/custom/' + basis + '/' + $('#cFrom').value + '/' + $('#cTo').value; };
      V().querySelectorAll('[data-jobp]').forEach(function (tr) { tr.onclick = function () { location.hash = '#job/' + tr.getAttribute('data-jobp'); }; });
    });
  }

  /* ================= on each job page ================= */
  M.onJob(function (j) {
    var box = document.createElement('div');
    box.className = 'card'; box.id = 'jobAcct';
    box.innerHTML = '<div class="card-h"><h2>Quotes, invoices &amp; costs</h2></div><div class="empty" style="padding:10px">Loading…</div>';
    var col = V().querySelector('.grid.two > .grid'); if (col) col.insertBefore(box, col.children[1] || null);
    api('docForJob', { core: j.core }).then(function (d) {
      var all = d.quotes.concat(d.invoices);
      var cost = d.expenses.reduce(function (a, e) { return a + (e.inc - e.gst); }, 0), inv = d.invoices.filter(function (i) { return ['void', 'draft'].indexOf(i.status) < 0; }).reduce(function (a, i) { return a + i.ex; }, 0);
      box.innerHTML = '<div class="card-h"><h2>Quotes, invoices &amp; costs</h2>' + (inv || cost ? '<span class="muted">Profit so far: <b style="color:' + (inv - cost < 0 ? '#C2410C' : '#15803D') + '">' + money(inv - cost) + '</b> ex GST</span>' : '') + '</div>' +
        (all.length ? '<div class="list">' + all.map(function (x) { return '<a class="item" href="#doc/' + esc(x.id) + '" style="text-decoration:none"><div><span class="ref">' + esc(x.id) + '</span> ' + schip(x.status) + '<br><small>' + esc(pretty(x.issued)) + '</small></div><b>' + money(x.inc) + '</b></a>'; }).join('') + '</div>' : '') +
        (d.expenses.length ? '<p class="muted" style="margin:10px 0 0">Costs: ' + d.expenses.length + ' expense' + (d.expenses.length > 1 ? 's' : '') + ', ' + money(cost) + ' ex GST</p>' : '') +
        '<div class="actions" style="margin-top:12px"><a class="btn btn-sm btn-gold" href="#doc/new/quote/' + esc(j.core) + '">＋ Quote</a><a class="btn btn-sm btn-gold" href="#doc/new/invoice/' + esc(j.core) + '">＋ Invoice</a><button class="btn btn-sm" id="jobExp" type="button">＋ Expense</button></div>';
      $('#jobExp').onclick = function () { api('acctLists').then(function (l) { expenseForm(null, l.categories, j.core); }).catch(fail); };
    }).catch(fail);
  });

  M.addView('quotes', 'Quotes', quotes);
  M.addView('invoices', 'Invoices', invoices);
  M.addView('doc', 'Document', docView, 'invoices');
  window.addEventListener('hashchange', function () { var a = document.querySelector('[data-nav=invoices]'), q = document.querySelector('[data-nav=quotes]'); if (/^#doc\/(Q-|new\/quote)/.test(location.hash) && q) { a.classList.remove('on'); q.classList.add('on'); } });
  M.addView('expenses', 'Expenses', expenses);
  M.addView('accounts', 'Accounting & BAS', accounts);
  window.addEventListener('hashchange', function () { window.onbeforeunload = null; });
})();
