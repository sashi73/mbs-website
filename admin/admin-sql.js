/* MBS Console: SQL wizard. Data is copied into the browser and queried there (read-only: nothing in the database can change).
   Templates, a drag-and-drop builder, an auto-completing editor, table / record / chart views, and AI reports as PDF. */
(function () {
  'use strict';
  var M = window.MBS; if (!M) return;
  var api = M.api, esc = M.esc, toast = M.toast, fail = M.fail, $ = M.$;
  var V = function () { return M.view(); };
  var LIBS = ['vendor/alasql.min.js', 'vendor/chart.umd.min.js', 'vendor/codemirror.js', 'vendor/cm-sql.js', 'vendor/show-hint.js', 'vendor/sql-hint.js'];
  var CSS = ['vendor/codemirror.css', 'vendor/show-hint.css'];
  var OPEN = { jobs: true };
  var loaded = null, DB = null, SCHEMA = null, DESCRIBE = {}, loadedAt = 0;
  var S = { askLog: [], period: null, tab: 'ask', view: 'table', sql: '', cols: [], rows: [], chart: { type: 'bar', x: '', y: [] }, title: 'Data report', wiz: { table: '', cols: [], filters: [], order: '', dir: 'DESC', limit: 100 } };
  var chartObj = null, cm = null;
  var COLORS = ['#C9A227', '#1F2937', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6', '#F59E0B', '#14B8A6', '#EC4899', '#6B7280', '#84CC16', '#0EA5E9'];

  function loadLibs() {
    if (loaded) return loaded;
    CSS.forEach(function (h) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = h + '?v=23'; document.head.appendChild(l); });
    loaded = LIBS.reduce(function (p, src) { return p.then(function () { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src + '?v=23'; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }); }, Promise.resolve())
      .catch(function (e) { loaded = null; throw e; });
    return loaded;
  }
  function loadData(force) {
    if (DB && !force && Date.now() - loadedAt < 5 * 60000) return Promise.resolve();
    return api('sqlData').then(function (d) {
      SCHEMA = d.schema; DESCRIBE = d.describe || {};
      DB = new window.alasql.Database();
      Object.keys(d.schema).forEach(function (t) { DB.exec('CREATE TABLE ' + t); DB.tables[t].data = d.data[t] || []; });
      loadedAt = Date.now();
    });
  }

  /* ---------- safety: only reading queries ---------- */
  function check(sql) {
    var s = String(sql || '').replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/;\s*$/, '');
    if (!s) throw new Error('Write a query first');
    if (!/^(select|with)\b/i.test(s)) throw new Error('Only SELECT queries are allowed here (reports read data, they never change it)');
    if (/;/.test(s)) throw new Error('Run one query at a time');
    if (/\b(into|insert|update|delete|drop|create|alter|attach|detach|require|source|declare)\b/i.test(s)) throw new Error('That kind of statement is not allowed here');
    if (/\b(json|csv|xlsx|xls|txt|tab|tsv|html|ods|file)\s*\(/i.test(s)) throw new Error('Reading files is not allowed here');
    return s;
  }
  function run(sql) {
    var s = check(sql);
    var t0 = performance.now();
    var res;
    try { res = DB.exec(s); }
    catch (e) {
      var m = String(e.message || e);
      if (/Parse error/.test(m)) {
        var got = (m.match(/got '([A-Z_]+)'/) || [])[1];
        throw new Error('The SQL has a mistake' + (got ? ' near ' + got.toLowerCase() : '') + '. Tip: total, value, count, sum, rows and index are reserved words, so use other names (e.g. AS total_inc).');
      }
      throw new Error(m.split('\n')[0]);
    }
    if (!Array.isArray(res)) res = [{ value: res }];
    var cols = [];
    res.slice(0, 200).forEach(function (r) { Object.keys(r || {}).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
    S.sql = s; S.cols = cols; S.rows = res; S.ms = Math.round(performance.now() - t0);
    return res;
  }
  var isNum = function (c) { var n = S.rows.slice(0, 50).filter(function (r) { return r[c] != null && r[c] !== ''; }); return n.length > 0 && n.every(function (r) { return typeof r[c] === 'number'; }); };

  /* ---------- templates ---------- */
  var T = [
    { g: 'Projects', n: 'Tasks due this period', d: 'Plan tasks finishing in the chosen period', sql: "SELECT job, task, resource, finish, pct_complete\nFROM plan_tasks\nWHERE finish BETWEEN '{FROM}' AND '{TO}' AND done = false\nORDER BY finish", c: null, p: true },
    { g: 'Projects', n: 'Late tasks', d: 'Past their finish date and not complete', sql: "SELECT job, task, resource, finish, pct_complete\nFROM plan_tasks\nWHERE late = true\nORDER BY finish", c: null },
    { g: 'Projects', n: 'Planned vs actual cost by job', d: 'Budget against money spent', sql: "SELECT job, SUM(planned_cost) AS planned, SUM(actual_cost) AS actual\nFROM plan_tasks\nGROUP BY job\nORDER BY planned DESC", c: ['bar', 'job', ['planned', 'actual']] },
    { g: 'Projects', n: 'Open risks by score', d: 'Highest risks first (probability x impact)', sql: "SELECT job, risk, probability, impact, score, response, owner\nFROM plan_risks\nWHERE status = 'Open'\nORDER BY score DESC", c: ['hbar', 'risk', ['score']] },
    { g: 'Customers', n: 'Customers with the most orders', d: 'Confirmed jobs and value per customer', sql: "SELECT name, suburb, confirmed_jobs, enquiries, total_value, last_contact\nFROM customers\nWHERE confirmed_jobs > 0\nORDER BY confirmed_jobs DESC, total_value DESC\nLIMIT 20", c: ['bar', 'name', ['confirmed_jobs']] },
    { g: 'Customers', n: 'Top customers by value', d: 'Who has spent the most (inc GST)', sql: "SELECT name, suburb, total_value, paid_total, owed, confirmed_jobs\nFROM customers\nORDER BY total_value DESC\nLIMIT 20", c: ['bar', 'name', ['total_value']] },
    { g: 'Customers', n: 'Customers by suburb', d: 'Where customers are, and how many became jobs', sql: "SELECT suburb, COUNT(*) AS customers_count, SUM(confirmed_jobs) AS confirmed, SUM(total_value) AS value_inc\nFROM customers\nGROUP BY suburb\nORDER BY customers_count DESC\nLIMIT 20", c: ['bar', 'suburb', ['customers_count', 'confirmed']] },
    { g: 'Customers', n: 'Repeat customers', d: 'Customers with two or more enquiries', sql: "SELECT name, suburb, enquiries, confirmed_jobs, total_value, first_contact, last_contact\nFROM customers\nWHERE repeat_customer = true\nORDER BY enquiries DESC", c: null },
    { g: 'Customers', n: 'Quotes waiting (customers)', d: 'Customers with a quote they have not answered yet', sql: "SELECT name, phone, suburb, open_quotes, quoted_value, last_contact\nFROM customers\nWHERE open_quotes > 0\nORDER BY quoted_value DESC", c: null },
    { g: 'Customers', n: 'New customers per month', d: 'First enquiry month', sql: "SELECT first_month, COUNT(*) AS new_customers\nFROM customers\nGROUP BY first_month\nORDER BY first_month", c: ['line', 'first_month', ['new_customers']] },
    { g: 'Customers', n: 'Customers to win back', d: 'Had a job, nothing open, no contact for a year', sql: "SELECT name, phone, suburb, confirmed_jobs, total_value, last_contact\nFROM customers\nWHERE confirmed_jobs > 0 AND open_jobs = 0 AND days_since_contact > 365\nORDER BY total_value DESC", c: null },
    { g: 'Inventory', n: 'Low stock (time to re-order)', d: 'At or below the re-order level', sql: "SELECT item, unit, on_hand, allocated, available, on_order, reorder_level, price_supplier\nFROM inventory\nWHERE low = true\nORDER BY available", c: null },
    { g: 'Inventory', n: 'Stock value by category', d: 'What the stock on hand is worth (ex GST)', sql: "SELECT category, COUNT(*) AS items_count, SUM(stock_value) AS value_ex\nFROM inventory\nGROUP BY category\nORDER BY value_ex DESC", c: ['pie', 'category', ['value_ex']] },
    { g: 'Inventory', n: 'Supplier price comparison', d: 'Every quote for every item, cheapest first', sql: "SELECT item, supplier, price_ex, quote_ref, valid_until, expired, preferred\nFROM supplier_prices\nORDER BY item, price_ex", c: null },
    { g: 'Inventory', n: 'Stock used per job', d: 'Materials taken out for each job', sql: "SELECT job, item, -SUM(qty) AS used_qty\nFROM stock_moves\nWHERE qty < 0 AND job <> ''\nGROUP BY job, item\nORDER BY job", c: null },
    { g: 'Projects', n: 'Open issues', d: 'Issues not resolved yet', sql: "SELECT job, issue, priority, owner, due, status\nFROM plan_issues\nWHERE status <> 'Resolved'\nORDER BY due", c: null },
    { g: 'Quick numbers', n: 'Scorecard: all the key numbers', d: 'Enquiries, calls, quotes, wins, money in and out', sql: "SELECT 'New enquiries' AS measure, COUNT(*) AS figure FROM jobs WHERE created BETWEEN '{FROM}' AND '{TO}'\nUNION ALL SELECT 'Customers called' AS measure, COUNT(*) AS figure FROM jobs WHERE called_date BETWEEN '{FROM}' AND '{TO}'\nUNION ALL SELECT 'Customers quoted' AS measure, COUNT(*) AS figure FROM jobs WHERE quoted_date BETWEEN '{FROM}' AND '{TO}'\nUNION ALL SELECT 'Quoted ($ inc GST)' AS measure, IFNULL(SUM(quote_inc), 0) AS figure FROM jobs WHERE quoted_date BETWEEN '{FROM}' AND '{TO}'\nUNION ALL SELECT 'Jobs won' AS measure, COUNT(*) AS figure FROM jobs WHERE won_date BETWEEN '{FROM}' AND '{TO}'\nUNION ALL SELECT 'Won ($ inc GST)' AS measure, IFNULL(SUM(quote_inc), 0) AS figure FROM jobs WHERE won_date BETWEEN '{FROM}' AND '{TO}'\nUNION ALL SELECT 'Jobs completed' AS measure, COUNT(*) AS figure FROM jobs WHERE completed_date BETWEEN '{FROM}' AND '{TO}'\nUNION ALL SELECT 'Jobs lost' AS measure, COUNT(*) AS figure FROM jobs WHERE lost_date BETWEEN '{FROM}' AND '{TO}'\nUNION ALL SELECT 'Invoiced ($ inc GST)' AS measure, IFNULL(SUM(inc), 0) AS figure FROM invoices WHERE status <> 'void' AND status <> 'draft' AND issued BETWEEN '{FROM}' AND '{TO}'\nUNION ALL SELECT 'Money received ($)' AS measure, IFNULL(SUM(amount), 0) AS figure FROM payments WHERE date BETWEEN '{FROM}' AND '{TO}'\nUNION ALL SELECT 'Expenses ($ inc GST)' AS measure, IFNULL(SUM(inc), 0) AS figure FROM expenses WHERE date BETWEEN '{FROM}' AND '{TO}'", c: null, p: true },
    { g: 'Quick numbers', n: 'New enquiries', d: 'How many new enquiries came in', sql: "SELECT COUNT(*) AS new_enquiries\nFROM jobs\nWHERE created BETWEEN '{FROM}' AND '{TO}'", c: null, p: true },
    { g: 'Quick numbers', n: 'New enquiries per day', d: 'Day by day, for spotting busy days', sql: "SELECT created AS day, COUNT(*) AS enquiries\nFROM jobs\nWHERE created BETWEEN '{FROM}' AND '{TO}'\nGROUP BY created\nORDER BY day", c: ['line', 'day', ['enquiries']], p: true },
    { g: 'Quick numbers', n: 'New customers quoted', d: 'How many customers were quoted, and for how much', sql: "SELECT COUNT(*) AS customers_quoted, IFNULL(SUM(quote_inc), 0) AS quoted_inc_gst\nFROM jobs\nWHERE quoted_date BETWEEN '{FROM}' AND '{TO}'", c: null, p: true },
    { g: 'Quick numbers', n: 'Who was quoted', d: 'List of customers quoted and where each job is now', sql: "SELECT ref, name, suburb, service, quoted_date, quote_inc, stage\nFROM jobs\nWHERE quoted_date BETWEEN '{FROM}' AND '{TO}'\nORDER BY quoted_date DESC", c: null, p: true },
    { g: 'Quick numbers', n: 'Jobs won', d: 'How many jobs were won, and their value', sql: "SELECT COUNT(*) AS jobs_won, IFNULL(SUM(quote_inc), 0) AS won_inc_gst\nFROM jobs\nWHERE won_date BETWEEN '{FROM}' AND '{TO}'", c: null, p: true },
    { g: 'Quick numbers', n: 'Enquiries by trade', d: 'Which kinds of work people asked for', sql: "SELECT trade, COUNT(*) AS enquiries\nFROM jobs\nWHERE created BETWEEN '{FROM}' AND '{TO}'\nGROUP BY trade\nORDER BY enquiries DESC", c: ['bar', 'trade', ['enquiries']], p: true },
    { g: 'Quick numbers', n: 'Enquiries by suburb', d: 'Where enquiries came from', sql: "SELECT suburb, COUNT(*) AS enquiries\nFROM jobs\nWHERE created BETWEEN '{FROM}' AND '{TO}'\nGROUP BY suburb\nORDER BY enquiries DESC\nLIMIT 15", c: ['hbar', 'suburb', ['enquiries']], p: true },
    { g: 'Quick numbers', n: 'Money received', d: 'Payments in, by how they paid', sql: "SELECT method, COUNT(*) AS payments, SUM(amount) AS received\nFROM payments\nWHERE date BETWEEN '{FROM}' AND '{TO}'\nGROUP BY method\nORDER BY received DESC", c: ['pie', 'method', ['received']], p: true },
    { g: 'Quick numbers', n: 'Invoices issued', d: 'Every invoice sent in the period', sql: "SELECT id, customer, issued, due, inc, paid, balance, status\nFROM invoices\nWHERE status <> 'draft' AND issued BETWEEN '{FROM}' AND '{TO}'\nORDER BY issued DESC", c: null, p: true },
    { g: 'Follow-ups', n: 'Not called yet', d: 'New enquiries still waiting for a call (oldest first)', sql: "SELECT ref, name, phone, suburb, service, created, best_time\nFROM jobs\nWHERE stage = 'new'\nORDER BY created", c: null },
    { g: 'Follow-ups', n: 'Quotes waiting for an answer', d: 'Sent quotes the customer hasn\'t accepted or declined', sql: "SELECT id, customer, issued, valid_until, inc, status\nFROM quotes\nWHERE status = 'sent' OR status = 'expired'\nORDER BY issued", c: ['hbar', 'customer', ['inc']] },
    { g: 'Jobs', n: 'Jobs by stage', d: 'How many jobs sit at each stage of the pipeline', sql: "SELECT stage, COUNT(*) AS jobs\nFROM jobs\nGROUP BY stage\nORDER BY jobs DESC", c: ['pie', 'stage', ['jobs']] },
    { g: 'Jobs', n: 'Enquiries per month', d: 'New enquiries each month', sql: "SELECT created_month AS month, COUNT(*) AS enquiries\nFROM jobs\nGROUP BY created_month\nORDER BY month", c: ['line', 'month', ['enquiries']] },
    { g: 'Jobs', n: 'Top suburbs', d: 'Where the work comes from', sql: "SELECT suburb, COUNT(*) AS jobs\nFROM jobs\nGROUP BY suburb\nORDER BY jobs DESC\nLIMIT 10", c: ['hbar', 'suburb', ['jobs']] },
    { g: 'Jobs', n: 'Win rate by trade', d: 'Enquiries won, per trade code', sql: "SELECT trade,\n  COUNT(*) AS enquiries,\n  SUM(CASE WHEN stage IN ('won','completed','invoiced','paid') THEN 1 ELSE 0 END) AS won,\n  ROUND(100.0 * SUM(CASE WHEN stage IN ('won','completed','invoiced','paid') THEN 1 ELSE 0 END) / COUNT(*), 0) AS win_rate_pct\nFROM jobs\nGROUP BY trade\nORDER BY enquiries DESC", c: ['bar', 'trade', ['enquiries', 'won']] },
    { g: 'Jobs', n: 'Where enquiries come from', d: 'Website chat, form, phone…', sql: "SELECT source, COUNT(*) AS jobs\nFROM jobs\nGROUP BY source\nORDER BY jobs DESC", c: ['doughnut', 'source', ['jobs']] },
    { g: 'Jobs', n: 'Lost jobs and why', d: 'Reasons given when a job was lost', sql: "SELECT ref, service, suburb, lost_date, lost_reason\nFROM jobs\nWHERE stage = 'lost'\nORDER BY lost_date DESC", c: null },
    { g: 'Money', n: 'Invoiced vs received per month', d: 'Invoices issued and money in, inc GST', sql: "SELECT issued_month AS month, SUM(inc) AS invoiced, SUM(paid) AS received\nFROM invoices\nWHERE status <> 'void' AND status <> 'draft'\nGROUP BY issued_month\nORDER BY month", c: ['bar', 'month', ['invoiced', 'received']] },
    { g: 'Money', n: 'Payments received per month', d: 'Cash in (inc GST) and the GST in it', sql: "SELECT month, SUM(amount) AS received, SUM(gst) AS gst\nFROM payments\nGROUP BY month\nORDER BY month", c: ['line', 'month', ['received', 'gst']] },
    { g: 'Money', n: 'Unpaid invoices, oldest first', d: 'Who owes what and how late', sql: "SELECT id, customer, due, balance, days_overdue\nFROM invoices\nWHERE balance > 0 AND status IN ('sent','part-paid','overdue')\nORDER BY days_overdue DESC", c: ['hbar', 'id', ['balance']] },
    { g: 'Money', n: 'Profit by job', d: 'Invoiced ex GST minus costs ex GST', sql: "SELECT j.ref, j.service,\n  IFNULL(i.income, 0) AS income,\n  IFNULL(e.costs, 0) AS costs,\n  IFNULL(i.income, 0) - IFNULL(e.costs, 0) AS profit\nFROM jobs j\nLEFT JOIN (SELECT job, SUM(ex) AS income FROM invoices WHERE status <> 'void' AND status <> 'draft' GROUP BY job) i ON i.job = j.core\nLEFT JOIN (SELECT job, SUM(ex) AS costs FROM expenses GROUP BY job) e ON e.job = j.core\nWHERE i.income > 0 OR e.costs > 0\nORDER BY profit DESC", c: ['bar', 'ref', ['income', 'costs', 'profit']] },
    { g: 'Money', n: 'Quotes by status', d: 'Value of quotes sent, accepted, declined', sql: "SELECT status, COUNT(*) AS quotes, SUM(inc) AS quoted_inc_gst\nFROM quotes\nGROUP BY status\nORDER BY quoted_inc_gst DESC", c: ['pie', 'status', ['quoted_inc_gst']] },
    { g: 'Money', n: 'Expenses by category', d: 'Where the money goes (ex GST)', sql: "SELECT category, SUM(ex) AS spent_ex_gst, SUM(gst) AS gst_credits\nFROM expenses\nGROUP BY category\nORDER BY spent_ex_gst DESC", c: ['doughnut', 'category', ['spent_ex_gst']] },
    { g: 'Money', n: 'Best-selling line items', d: 'What you invoice most for', sql: "SELECT description, COUNT(*) AS times, SUM(ex) AS value_ex_gst\nFROM items\nWHERE doc_type = 'invoice'\nGROUP BY description\nORDER BY value_ex_gst DESC\nLIMIT 10", c: ['hbar', 'description', ['value_ex_gst']] },
    { g: 'Other', n: 'Website visitors per month', d: 'From the visitor counter', sql: "SELECT month, SUM(visits) AS visitors\nFROM visits\nGROUP BY month\nORDER BY month", c: ['area', 'month', ['visitors']] },
    { g: 'Other', n: 'Upcoming reminders', d: 'Call-backs and follow-ups due', sql: "SELECT date, text, job\nFROM reminders\nORDER BY due", c: null }
  ];

  /* ---------- periods for the quick numbers (Sydney dates) ---------- */
  function syd() { var o = {}; new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; }); return { y: +o.year, m: +o.month, d: +o.day, wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(o.weekday) }; }
  function ymd(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10); }
  function periods() {
    var t = syd(), fy = t.m >= 7 ? t.y : t.y - 1, lm = t.m === 1 ? [t.y - 1, 12] : [t.y, t.m - 1];
    return {
      today: { from: ymd(t.y, t.m, t.d), to: ymd(t.y, t.m, t.d), name: 'today' },
      week: { from: ymd(t.y, t.m, t.d - t.wd), to: ymd(t.y, t.m, t.d - t.wd + 6), name: 'this week' },
      month: { from: ymd(t.y, t.m, 1), to: ymd(t.y, t.m + 1, 0), name: 'this month' },
      lastmonth: { from: ymd(lm[0], lm[1], 1), to: ymd(lm[0], lm[1] + 1, 0), name: 'last month' },
      year: { from: ymd(t.y, 1, 1), to: ymd(t.y, 12, 31), name: 'this year' },
      fy: { from: ymd(fy, 7, 1), to: ymd(fy + 1, 6, 30), name: 'FY ' + fy + '-' + String(fy + 1).slice(2) },
      all: { from: '2000-01-01', to: '2999-12-31', name: 'all time' }
    };
  }
  function period() { if (!S.period) S.period = Object.assign({ key: 'month' }, periods().month); return S.period; }
  function prettyRange(p) { var f = function (s) { var a = s.split('-').map(Number); return a[2] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][a[1] - 1] + ' ' + a[0]; }; return p.key === 'all' ? 'all time' : p.from === p.to ? f(p.from) : f(p.from) + ' to ' + f(p.to); }

  /* ---------- page ---------- */
  function page() {
    V().innerHTML = '<div class="empty">Loading the SQL wizard…</div>';
    return loadLibs().then(function () { return loadData(); }).then(draw);
  }
  function draw() {
    var tables = Object.keys(SCHEMA);
    V().innerHTML =
      '<div class="sqlw">' +
        '<aside class="card sql-side"><div class="card-h"><h2>Tables</h2><button class="btn btn-sm" id="sqlRefresh" title="Load the latest data">↻</button></div>' +
          '<p class="muted" style="margin:0 0 10px;font-size:12.5px">Drag a table or column into the builder or the editor (or tap it).</p>' +
          tables.map(function (t) {
            return '<details class="tbl" data-t="' + esc(t) + '"' + (OPEN[t] ? ' open' : '') + '><summary><span class="chipd tchip" draggable="true" data-drag="' + esc(t) + '" data-table="' + esc(t) + '">' + esc(t) + '</span><small class="muted"> ' + DB.tables[t].data.length + (DB.tables[t].data.length === 1 ? ' row' : ' rows') + '</small></summary>' +
              '<p class="muted" style="margin:4px 0 6px;font-size:12px">' + esc(DESCRIBE[t] || '') + '</p><div class="cols">' +
              SCHEMA[t].map(function (c) { return '<span class="chipd" draggable="true" data-drag="' + esc(c) + '" data-col="' + esc(c) + '" data-of="' + esc(t) + '">' + esc(c) + '</span>'; }).join('') + '</div></details>';
          }).join('') + '</aside>' +
        '<section class="sql-main">' +
          '<div class="tabs" id="sqlTabs">' + [['ask', '✨ AI query'], ['templates', '★ Templates'], ['wizard', '🧩 Wizard'], ['editor', '⌨ SQL editor'], ['saved', '💾 Saved']].map(function (x) { return '<button class="tab' + (S.tab === x[0] ? ' on' : '') + '" data-tab="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
          '<div class="card" id="sqlPanel"></div>' +
          '<div class="card" id="sqlResults" style="margin-top:16px"><div class="empty">Pick a template, build a query with the wizard, or write SQL, then press Run.</div></div>' +
        '</section>' +
      '</div>';
    $('#sqlRefresh').onclick = function () { loadData(true).then(function () { toast('Latest data loaded'); draw(); }).catch(fail); };
    V().querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-tab'); draw(); }; });
    // drag + tap on the table/column chips
    V().querySelectorAll('.chipd').forEach(function (c) {
      c.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', c.getAttribute('data-drag')); e.dataTransfer.setData('application/x-mbs', JSON.stringify({ table: c.getAttribute('data-table'), col: c.getAttribute('data-col'), of: c.getAttribute('data-of') })); });
      c.addEventListener('click', function (e) { e.preventDefault(); pick({ table: c.getAttribute('data-table'), col: c.getAttribute('data-col'), of: c.getAttribute('data-of') }); });
    });
    V().querySelectorAll('details.tbl').forEach(function (d) { d.addEventListener('toggle', function () { OPEN[d.getAttribute('data-t')] = d.open; }); });
    panel();
    if (S.rows.length) results();
  }
  function pick(it) {
    if (S.tab === 'editor' && cm) { cm.replaceSelection(it.table || it.col); cm.focus(); return; }
    if (S.tab !== 'wizard') { S.tab = 'wizard'; }
    if (it.table) { setTable(it.table); OPEN[it.table] = true; }
    else if (it.col) { if (S.wiz.table !== it.of) setTable(it.of); if (!S.wiz.cols.some(function (x) { return x.c === it.col; })) S.wiz.cols.push({ c: it.col, agg: '' }); }
    draw();
  }
  function setTable(t) { if (S.wiz.table !== t) { S.wiz = { table: t, cols: [], filters: [], order: '', dir: 'DESC', limit: 100 }; } }

  function panel() {
    var P = $('#sqlPanel');
    if (S.tab === 'templates') {
      var groups = {}; T.forEach(function (t, i) { (groups[t.g] = groups[t.g] || []).push([t, i]); });
      var pr = period();
      P.innerHTML = '<h2>Common reports</h2><p class="muted" style="margin:-6px 0 12px">One click runs it. You can then change it in the editor.</p>' +
        '<div class="period"><b>Period for quick numbers:</b><div class="tabs" style="margin:0">' + [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['fy', 'Financial year'], ['all', 'All time'], ['custom', 'Date range']].map(function (x) {
          return '<button class="tab' + (pr.key === x[0] ? ' on' : '') + '" data-per="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
        '<div class="row" id="perRange"' + (pr.key === 'custom' ? '' : ' hidden') + '><label style="display:flex;gap:6px;align-items:center;font-weight:600">From<input type="date" id="perFrom" value="' + esc(pr.from) + '" style="width:auto"></label><label style="display:flex;gap:6px;align-items:center;font-weight:600">to<input type="date" id="perTo" value="' + esc(pr.to) + '" style="width:auto"></label></div>' +
        '<span class="muted" id="perShow">' + esc(prettyRange(pr)) + '</span></div>' + ['Quick numbers', 'Follow-ups', 'Jobs', 'Customers', 'Money', 'Projects', 'Inventory', 'Other'].filter(function (g) { return groups[g]; }).concat(Object.keys(groups).filter(function (g) { return ['Quick numbers', 'Follow-ups', 'Jobs', 'Customers', 'Money', 'Projects', 'Inventory', 'Other'].indexOf(g) < 0; })).map(function (g) {
        return '<p class="side-h" style="color:var(--muted);margin:14px 0 8px">' + esc(g) + (g === 'Quick numbers' ? ' <span style="text-transform:none;letter-spacing:0">(' + esc(prettyRange(pr)) + ')</span>' : '') + '</p><div class="tpl-grid">' + groups[g].map(function (x) { return '<button class="tpl' + (x[0].p ? ' tpl-p' : '') + '" data-tpl="' + x[1] + '"><b>' + esc(x[0].n) + '</b><small>' + esc(x[0].d) + '</small></button>'; }).join('') + '</div>';
      }).join('');
      P.querySelectorAll('[data-tpl]').forEach(function (b) { b.onclick = function () { useTemplate(T[+b.getAttribute('data-tpl')]); }; });
      P.querySelectorAll('[data-per]').forEach(function (b) { b.onclick = function () {
        var k = b.getAttribute('data-per');
        S.period = k === 'custom' ? { key: 'custom', from: period().from, to: period().to, name: 'custom' } : Object.assign({ key: k }, periods()[k]);
        panel(); }; });
      var setRange = function () { var f = $('#perFrom').value, t = $('#perTo').value; if (f && t) { S.period = { key: 'custom', from: f <= t ? f : t, to: f <= t ? t : f, name: 'custom' }; $('#perShow').textContent = prettyRange(S.period); } };
      if ($('#perFrom')) { $('#perFrom').onchange = setRange; $('#perTo').onchange = setRange; }
    } else if (S.tab === 'ask') askPanel(P);
    else if (S.tab === 'wizard') wizard(P);
    else if (S.tab === 'editor') editor(P);
    else saved(P);
  }
  function useTemplate(t) {
    var pr = period(), sql = t.p ? t.sql.replace(/\{FROM\}/g, pr.from).replace(/\{TO\}/g, pr.to) : t.sql;
    S.title = t.p ? t.n + ' (' + (pr.key === 'custom' ? prettyRange(pr) : pr.name) + ')' : t.n;
    try { run(sql); } catch (e) { return fail(e); }
    if (t.c) { S.chart = { type: t.c[0], x: t.c[1], y: t.c[2].slice() }; S.view = 'chart'; } else { S.view = 'table'; autoChart(); }
    S.tab = 'editor'; draw();
  }


  /* ---------- ✨ AI query: ask in plain English ---------- */
  var EXAMPLES = ['How many new jobs did I get this month?', 'What is the completion status of each project?', 'Which tasks are late, and who is the lead?', 'How much money is owed to me, and by which invoices?',
    'Which quotes sent in the last 30 days are still waiting?', 'Jobs won this financial year by trade', 'Top 5 suburbs for enquiries this year', 'Spending by category last month'];
  function hints() {
    var q = function (sql, k) { try { return DB.exec(sql).map(function (r) { return r[k]; }).filter(function (v) { return v != null && v !== ''; }); } catch (e) { return []; } };
    var counts = {}; Object.keys(SCHEMA).forEach(function (t) { counts[t] = DB.tables[t].data.length; });
    var plans = []; try { plans = DB.exec('SELECT DISTINCT plan_name AS pn, job AS jb FROM plan_tasks').map(function (r) { return r.pn + ' (job ' + r.jb + ')'; }); } catch (e) {}
    return {
      row_counts: counts, stages: q('SELECT DISTINCT stage AS v FROM jobs', 'v'), quote_status: q('SELECT DISTINCT status AS v FROM quotes', 'v'), invoice_status: q('SELECT DISTINCT status AS v FROM invoices', 'v'),
      expense_categories: q('SELECT DISTINCT category AS v FROM expenses', 'v'), trades: q('SELECT DISTINCT trade AS v FROM jobs', 'v'), sources: q('SELECT DISTINCT source AS v FROM jobs', 'v'),
      suburbs: q('SELECT suburb AS v, COUNT(*) AS n FROM jobs GROUP BY suburb ORDER BY n DESC LIMIT 40', 'v'), services: q('SELECT service AS v, COUNT(*) AS n FROM jobs GROUP BY service ORDER BY n DESC LIMIT 30', 'v'),
      plans: plans.slice(0, 40), plan_status: q('SELECT DISTINCT status AS v FROM plan_tasks', 'v'), risk_status: q('SELECT DISTINCT status AS v FROM plan_risks', 'v'), issue_status: q('SELECT DISTINCT status AS v FROM plan_issues', 'v')
    };
  }
  function askPanel(P) {
    P.innerHTML = '<div class="card-h"><h2>✨ AI query</h2><span class="muted" style="font-size:12.5px">Ask in plain English. The AI writes the query; it runs here on your own data.</span></div>' +
      '<form class="askbar" id="askForm"><input id="askQ" autocomplete="off" maxlength="400" placeholder="e.g. How many new jobs did I get this month?" aria-label="Your question"><button class="btn btn-gold" id="askGo" type="submit">Ask</button></form>' +
      '<div class="ask-ex">' + EXAMPLES.map(function (e) { return '<button type="button" class="chipq" data-ex="' + esc(e) + '">' + esc(e) + '</button>'; }).join('') + '</div>' +
      '<div id="askOut"></div><div class="muted" id="askUse" style="font-size:12px;margin-top:8px"></div>' +
      (S.askLog.length ? '<details class="ask-log"><summary>Earlier questions (' + S.askLog.length + ')</summary>' + S.askLog.slice().reverse().map(function (a, i) { return '<button type="button" class="ask-old" data-old="' + (S.askLog.length - 1 - i) + '"><b>' + esc(a.q) + '</b><small>' + esc(a.answer || '') + '</small></button>'; }).join('') + '</details>' : '') +
      '<p style="margin:12px 0 0"><button type="button" class="btn btn-sm" id="aiPing">🔌 Test AI connection</button> <span class="muted" id="aiPingOut" style="font-size:12.5px"></span></p>' +
      '<p class="muted" style="font-size:12px;margin:12px 0 0">To write the query the AI only sees table and column names, today\'s dates and short lists like stages and plan names. To word the answer it sees the results with names, phone numbers and emails removed. Don\'t type phone numbers into the question.</p>';
    var last = S.askLog[S.askLog.length - 1];
    if (S.pendingQ) { var pq = S.pendingQ; S.pendingQ = ''; $('#askQ').value = pq; setTimeout(function () { ask(pq); }, 0); }
    else if (last) showAnswer(last);
    api('sqlUsage').then(showUse).catch(function () {});
    $('#aiPing').onclick = function () {
      var o = $('#aiPingOut'); o.textContent = 'Checking…';
      api('aiPing').then(function (r) {
        o.textContent = r.ok ? '✅ DeepSeek answered in ' + (r.ms / 1000).toFixed(1) + ' s (model ' + r.model + ', time allowed ' + r.timeoutSec + ' s).'
          : '❌ ' + (r.reason || 'No answer') + (r.ms ? ' (after ' + (r.ms / 1000).toFixed(1) + ' s)' : '');
      }).catch(function (e) { o.textContent = '❌ ' + e.message; });
    };
    $('#askForm').onsubmit = function (e) { e.preventDefault(); ask($('#askQ').value); };
    P.querySelectorAll('[data-ex]').forEach(function (b) { b.onclick = function () { $('#askQ').value = b.getAttribute('data-ex'); ask(b.getAttribute('data-ex')); }; });
    P.querySelectorAll('[data-old]').forEach(function (b) { b.onclick = function () { var a = S.askLog[+b.getAttribute('data-old')]; try { run(a.sql); S.title = a.title; S.view = a.view || 'table'; if (a.chart) S.chart = JSON.parse(JSON.stringify(a.chart)); else autoChart(); results(); showAnswer(a); $('#askQ').value = a.q; } catch (e) { fail(e); } }; });
    setTimeout(function () { var i = $('#askQ'); if (i && !S.askBusy) i.focus(); }, 30);
  }
  function showUse(t) {
    var el = $('#askUse'); if (!el || !t) return;
    el.textContent = 'Today: ' + t.questions + ' of ' + t.limit + ' AI questions used · ' + Number(t.tokens || 0).toLocaleString('en-AU') + ' tokens.';
  }
  function showAnswer(a) {
    var O = $('#askOut'); if (!O) return;
    var big = '';
    if (a.single != null) big = '<div class="ask-big">' + esc(a.single) + '</div>';
    O.innerHTML = '<div class="ask-ans' + (a.error ? ' err' : '') + '"><div class="ask-q">“' + esc(a.q) + '”</div>' + big +
      '<div class="ask-a">' + (a.answer ? esc(a.answer) : '<span class="ask-think">Working out the answer…</span>') + '</div>' +
      (a.note ? '<div class="muted" style="font-size:12.5px;margin-top:6px">How I read it: ' + esc(a.note) + '</div>' : '') +
      (a.tokens ? '<div class="muted" style="font-size:12px;margin-top:4px">This question used about ' + a.tokens.toLocaleString('en-AU') + ' tokens.</div>' : '') +
      (a.sql ? '<details class="ask-sql"><summary>Show the query</summary><pre class="json" style="max-height:220px">' + esc(a.sql) + '</pre><button class="btn btn-sm" type="button" id="askEdit">Open in SQL editor</button></details>' : '') + '</div>';
    var ed = $('#askEdit'); if (ed) ed.onclick = function () { S.sql = a.sql; S.title = a.title || 'Query results'; S.tab = 'editor'; draw(); };
  }
  function ask(question) {
    question = String(question || '').trim();
    if (!question) return toast('Type a question first', true);
    if (S.askBusy) return;
    S.askBusy = true;
    var btn = $('#askGo'); if (btn) { btn.disabled = true; btn.textContent = 'Thinking…'; }
    var O = $('#askOut'); if (O) O.innerHTML = '<div class="ask-ans"><div class="ask-q">“' + esc(question) + '”</div><div class="ask-a"><span class="ask-think">Writing the query…</span></div></div>';
    var H = hints(), hist = S.askLog.slice(-1).map(function (a) { return { q: a.q, sql: a.sql }; });
    var a = { q: question, at: Date.now(), tokens: 0 };
    var count = function (r) { a.tokens += Number(r && r.tokens) || 0; if (r && r.today) showUse(r.today); return r; };
    var tryRun = function (r, n) {
      if (!r.sql) return Promise.reject(new Error(r.note || 'I could not turn that into a query. Try asking in a different way.'));
      try { run(r.sql); return Promise.resolve(r); }
      catch (e) {
        if (n >= 1) return Promise.reject(new Error('The AI\'s query did not work (' + e.message + '). Try asking in a different way.'));
        var t = $('#askOut .ask-think'); if (t) t.textContent = 'Fixing the query…';
        return api('sqlAsk', { question: question, hints: H, history: hist, previous: { sql: r.sql, error: e.message } }).then(count).then(function (r2) { return tryRun(r2, n + 1); });
      }
    };
    var slow = function (e) { return /took too long|slow right now|Error 50[234]|Failed to fetch|NetworkError/i.test(String(e && e.message)); };
    var first = function () {
      return api('sqlAsk', { question: question, hints: H, history: hist }).catch(function (e) {
        if (!slow(e)) throw e;
        var t = $('#askOut .ask-think'); if (t) t.textContent = 'The AI is slow right now, trying once more…';
        return api('sqlAsk', { question: question, hints: H, history: hist }).catch(function (e2) {
          if (slow(e2)) throw new Error('The AI did not answer in time (twice). DeepSeek may be busy: try again in a minute. If this keeps happening, press "Test AI connection" below.');
          throw e2;
        });
      });
    };
    first().then(count).then(function (r) { return tryRun(r, 0); }).then(function (r) {
      a.sql = S.sql; a.title = r.title || 'AI query'; a.note = r.note || '';
      S.title = a.title;
      var ok = r.chart && S.cols.indexOf(r.chart.x) >= 0 && r.chart.y.every(function (y) { return S.cols.indexOf(y) >= 0; });
      if (ok && S.rows.length > 1) { S.chart = { type: r.chart.type, x: r.chart.x, y: r.chart.y.slice() }; S.view = 'chart'; } else { S.view = 'table'; autoChart(); }
      a.view = S.view; a.chart = JSON.parse(JSON.stringify(S.chart));
      if (S.rows.length === 1 && S.cols.length === 1) { var v = S.rows[0][S.cols[0]]; a.single = typeof v === 'number' ? v.toLocaleString('en-AU', { maximumFractionDigits: 2 }) : String(v == null ? '' : v); }
      results(); showAnswer(a);
      // a single number or nothing found: no need to spend tokens on wording the answer
      if (!S.rows.length) { a.answer = 'Nothing matched that question.'; return; }
      if (a.single != null) { a.answer = a.title + ': ' + a.single + '.'; return; }
      return api('sqlAnswer', { question: question, title: a.title, sql: S.sql, columns: S.cols, rows: S.rows.slice(0, 20), row_count: S.rows.length }).then(function (x) { a.answer = x.answer; count(x); }).catch(function () { a.answer = S.rows.length + ' row' + (S.rows.length === 1 ? '' : 's') + ' found (see the table).'; });
    }).then(function () {
      S.askLog.push(a); if (S.askLog.length > 20) S.askLog.shift();
      showAnswer(a);
    }).catch(function (e) {
      a.answer = e.message; a.error = true; showAnswer(a);
    }).then(function () { S.askBusy = false; var b = $('#askGo'); if (b) { b.disabled = false; b.textContent = 'Ask'; } });
  }

  /* ---------- wizard ---------- */
  var OPS = [['=', 'is'], ['<>', 'is not'], ['>', 'more than'], ['>=', 'at least'], ['<', 'less than'], ['<=', 'at most'], ['contains', 'contains'], ['starts', 'starts with'], ['empty', 'is empty'], ['notempty', 'is not empty']];
  function lit(v) { var s = String(v == null ? '' : v).trim(); return /^-?\d+(\.\d+)?$/.test(s) ? s : "'" + s.replace(/'/g, "''") + "'"; }
  function buildSql() {
    var w = S.wiz; if (!w.table) return '';
    var aggd = w.cols.some(function (x) { return x.agg; });
    var sel = w.cols.length ? w.cols.map(function (x) { return x.agg ? (x.agg === 'COUNT' ? 'COUNT(' + x.c + ')' : x.agg + '(' + x.c + ')') + ' AS ' + x.agg.toLowerCase() + '_' + x.c : x.c; }) : ['*'];
    if (w.count) sel.push('COUNT(*) AS rows_count');
    var where = w.filters.filter(function (f) { return f.c; }).map(function (f) {
      if (f.op === 'contains') return f.c + " LIKE " + lit('%' + f.v + '%');
      if (f.op === 'starts') return f.c + " LIKE " + lit(f.v + '%');
      if (f.op === 'empty') return '(' + f.c + " IS NULL OR " + f.c + " = '')";
      if (f.op === 'notempty') return '(' + f.c + " IS NOT NULL AND " + f.c + " <> '')";
      return f.c + ' ' + f.op + ' ' + lit(f.v);
    });
    var plain = w.cols.filter(function (x) { return !x.agg; }).map(function (x) { return x.c; });
    var group = (aggd || w.count) && plain.length ? plain : [];
    var sql = 'SELECT ' + sel.join(', ') + '\nFROM ' + w.table;
    if (where.length) sql += '\nWHERE ' + where.join('\n  AND ');
    if (group.length) sql += '\nGROUP BY ' + group.join(', ');
    if (w.order) sql += '\nORDER BY ' + w.order + ' ' + (w.dir === 'ASC' ? 'ASC' : 'DESC');
    if (w.limit) sql += '\nLIMIT ' + Math.max(1, Math.min(10000, +w.limit || 100));
    return sql;
  }
  function wizard(P) {
    var w = S.wiz, cols = w.table ? SCHEMA[w.table] : [];
    var opt = function (list, val, blank) { return (blank ? '<option value="">' + blank + '</option>' : '') + list.map(function (c) { var v = Array.isArray(c) ? c[0] : c, l = Array.isArray(c) ? c[1] : c; return '<option value="' + esc(v) + '"' + (v === val ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); };
    var outCols = w.cols.map(function (x) { return x.agg ? x.agg.toLowerCase() + '_' + x.c : x.c; }).concat(w.count ? ['rows_count'] : []);
    P.innerHTML = '<h2>Build a query, step by step</h2>' +
      '<div class="wz"><div class="wz-step"><b>1</b> Table</div><div class="drop" data-drop="table">' + (w.table ? '<span class="chipd tchip">' + esc(w.table) + '</span> <select id="wzTable" style="width:auto">' + opt(Object.keys(SCHEMA), w.table) + '</select>' : '<span class="muted">Drag a table here or </span><select id="wzTable" style="width:auto">' + opt(Object.keys(SCHEMA), '', 'choose…') + '</select>') + '</div></div>' +
      (w.table ? '<div class="wz"><div class="wz-step"><b>2</b> Columns</div><div class="drop" data-drop="cols">' + (w.cols.length ? w.cols.map(function (x, i) {
          return '<span class="pill"><select data-agg="' + i + '" title="Add up, count, average…">' + opt([['', '—'], ['COUNT', 'count'], ['SUM', 'sum'], ['AVG', 'average'], ['MIN', 'min'], ['MAX', 'max']], x.agg) + '</select><b>' + esc(x.c) + '</b><button data-rmcol="' + i + '" type="button" aria-label="Remove">✕</button></span>'; }).join('') : '<span class="muted">Drag columns here (or tap them on the left). Leave empty for all columns.</span>') + '</div>' +
        '<label class="wz-opt"><input type="checkbox" id="wzCount" style="width:auto"' + (w.count ? ' checked' : '') + '> Also count the rows in each group</label></div>' +
        '<div class="wz"><div class="wz-step"><b>3</b> Filters</div><div class="drop" data-drop="filter">' + w.filters.map(function (f, i) {
          return '<div class="frow"><select data-fc="' + i + '">' + opt(cols, f.c, 'column…') + '</select><select data-fo="' + i + '">' + opt(OPS, f.op) + '</select>' + (/empty/.test(f.op) ? '' : '<input data-fv="' + i + '" value="' + esc(f.v) + '" placeholder="value">') + '<button class="btn btn-sm" data-rmf="' + i + '" type="button">✕</button></div>'; }).join('') +
          '<button class="btn btn-sm" id="wzAddF" type="button">＋ Add filter</button> <span class="muted" style="font-size:12.5px">or drop a column here</span></div></div>' +
        '<div class="wz"><div class="wz-step"><b>4</b> Sort and limit</div><div class="row"><select id="wzOrder" style="width:auto">' + opt(outCols.concat(cols.filter(function (c) { return outCols.indexOf(c) < 0; })), w.order, 'no sorting') + '</select>' +
          '<select id="wzDir" style="width:auto">' + opt([['DESC', 'biggest / newest first'], ['ASC', 'smallest / oldest first']], w.dir) + '</select><label style="display:flex;gap:6px;align-items:center;font-weight:600">Max rows <input id="wzLimit" type="number" min="1" max="10000" value="' + esc(w.limit) + '" style="width:90px"></label></div></div>' +
        '<pre class="json" id="wzSql" style="margin-top:12px;max-height:180px">' + esc(buildSql()) + '</pre>' +
        '<div class="actions" style="margin-top:12px"><button class="btn btn-gold" id="wzRun">▶ Run</button><button class="btn" id="wzEdit">Open in the SQL editor</button><button class="btn" id="wzReset">Start again</button></div>' : '');
    var re = function () { panel(); };
    var tSel = $('#wzTable'); if (tSel) tSel.onchange = function () { setTable(this.value); re(); };
    P.querySelectorAll('[data-agg]').forEach(function (s) { s.onchange = function () { w.cols[+s.getAttribute('data-agg')].agg = s.value; re(); }; });
    P.querySelectorAll('[data-rmcol]').forEach(function (b) { b.onclick = function () { w.cols.splice(+b.getAttribute('data-rmcol'), 1); re(); }; });
    P.querySelectorAll('[data-fc]').forEach(function (s) { s.onchange = function () { w.filters[+s.getAttribute('data-fc')].c = s.value; re(); }; });
    P.querySelectorAll('[data-fo]').forEach(function (s) { s.onchange = function () { w.filters[+s.getAttribute('data-fo')].op = s.value; re(); }; });
    P.querySelectorAll('[data-fv]').forEach(function (s) { s.oninput = function () { w.filters[+s.getAttribute('data-fv')].v = s.value; $('#wzSql').textContent = buildSql(); }; });
    P.querySelectorAll('[data-rmf]').forEach(function (b) { b.onclick = function () { w.filters.splice(+b.getAttribute('data-rmf'), 1); re(); }; });
    if ($('#wzAddF')) $('#wzAddF').onclick = function () { w.filters.push({ c: '', op: '=', v: '' }); re(); };
    if ($('#wzCount')) $('#wzCount').onchange = function () { w.count = this.checked; re(); };
    if ($('#wzOrder')) $('#wzOrder').onchange = function () { w.order = this.value; re(); };
    if ($('#wzDir')) $('#wzDir').onchange = function () { w.dir = this.value; re(); };
    if ($('#wzLimit')) $('#wzLimit').oninput = function () { w.limit = this.value; $('#wzSql').textContent = buildSql(); };
    if ($('#wzRun')) $('#wzRun').onclick = function () { try { run(buildSql()); S.title = 'Report: ' + w.table; S.view = 'table'; autoChart(); results(); } catch (e) { fail(e); } };
    if ($('#wzEdit')) $('#wzEdit').onclick = function () { S.sql = buildSql(); S.tab = 'editor'; draw(); };
    if ($('#wzReset')) $('#wzReset').onclick = function () { S.wiz = { table: '', cols: [], filters: [], order: '', dir: 'DESC', limit: 100 }; re(); };
    // drop targets
    P.querySelectorAll('[data-drop]').forEach(function (z) {
      z.addEventListener('dragover', function (e) { e.preventDefault(); z.classList.add('over'); });
      z.addEventListener('dragleave', function () { z.classList.remove('over'); });
      z.addEventListener('drop', function (e) {
        e.preventDefault(); z.classList.remove('over');
        var it = {}; try { it = JSON.parse(e.dataTransfer.getData('application/x-mbs') || '{}'); } catch (x) {}
        var kind = z.getAttribute('data-drop');
        if (it.table) { setTable(it.table); re(); return; }
        if (!it.col) return;
        if (w.table !== it.of) setTable(it.of);
        if (kind === 'filter') w.filters.push({ c: it.col, op: '=', v: '' });
        else if (!w.cols.some(function (x) { return x.c === it.col; })) w.cols.push({ c: it.col, agg: '' });
        re();
      });
    });
  }

  /* ---------- editor ---------- */
  // suggestions: SQL words and tables (built-in), plus the columns of the tables already in the query
  function smartHint(ed, opts) {
    var cur = ed.getCursor(), line = ed.getLine(cur.line), start = cur.ch;
    while (start > 0 && /[\w$]/.test(line.charAt(start - 1))) start--;
    var word = line.slice(start, cur.ch).toLowerCase();
    var base = window.CodeMirror.hint.sql(ed, opts) || { list: [], from: window.CodeMirror.Pos(cur.line, start), to: cur };
    if (line.charAt(start - 1) === '.' || !word) return base;
    var used = [], re = /\b(?:from|join)\s+(\w+)/gi, m, txt = ed.getValue();
    while ((m = re.exec(txt))) if (SCHEMA[m[1]] && used.indexOf(m[1]) < 0) used.push(m[1]);
    var have = base.list.map(function (x) { return typeof x === 'string' ? x : x.text; });
    var extra = [];
    (used.length ? used : Object.keys(SCHEMA)).forEach(function (t) { SCHEMA[t].forEach(function (c) { if (c.indexOf(word) === 0 && have.indexOf(c) < 0 && extra.indexOf(c) < 0) extra.push(c); }); });
    if (!extra.length) return base;
    return { list: extra.concat(base.list), from: window.CodeMirror.Pos(cur.line, start), to: cur };
  }
  function editor(P) {
    P.innerHTML = '<div class="card-h"><h2>SQL editor</h2><span class="muted" style="font-size:12.5px">Tables: ' + Object.keys(SCHEMA).map(esc).join(', ') + ' · Ctrl+Space for suggestions · Ctrl+Enter to run</span></div>' +
      '<textarea id="sqlText"></textarea>' +
      '<div class="actions" style="margin-top:12px"><button class="btn btn-gold" id="sqlRun">▶ Run</button><button class="btn" id="sqlSave">💾 Save query</button><button class="btn" id="sqlClear">Clear</button></div>';
    var hintTables = {}; Object.keys(SCHEMA).forEach(function (t) { hintTables[t] = SCHEMA[t]; });
    cm = window.CodeMirror.fromTextArea($('#sqlText'), { mode: 'text/x-sql', lineNumbers: true, lineWrapping: true, viewportMargin: Infinity,
      extraKeys: { 'Ctrl-Space': 'autocomplete', 'Ctrl-Enter': function () { $('#sqlRun').click(); }, 'Cmd-Enter': function () { $('#sqlRun').click(); } },
      hintOptions: { tables: hintTables, completeSingle: false, hint: smartHint } });
    cm.setValue(S.sql || 'SELECT *\nFROM jobs\nLIMIT 50');
    cm.on('inputRead', function (ed, ch) { if (/^[A-Za-z_.]$/.test(ch.text[0] || '') && !ed.state.completionActive) ed.showHint({ completeSingle: false }); });
    $('#sqlRun').onclick = function () { try { if (cm.getValue().trim().replace(/;\s*$/, '') !== String(S.sql).trim()) S.title = 'Query results'; run(cm.getValue()); if (!S.chart.x || S.cols.indexOf(S.chart.x) < 0) autoChart(); results(); } catch (e) { fail(e); } };
    $('#sqlClear').onclick = function () { cm.setValue(''); cm.focus(); };
    $('#sqlSave').onclick = function () {
      M.modal('<h2>Save this query</h2><label style="margin-top:12px">Name<input id="svName" value="' + esc(S.title) + '"></label><p class="muted">Saved in this browser.</p><div class="actions" style="justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn btn-gold" id="svGo">Save</button></div>');
      $('#svGo').onclick = function () { var l = savedList(); l.unshift({ name: $('#svName').value || 'Query', sql: cm.getValue(), at: Date.now() }); store(l.slice(0, 50)); M.closeModal(); toast('Query saved'); };
    };
  }
  function savedList() { try { return JSON.parse(localStorage.getItem('mbs-sql-saved') || '[]'); } catch (e) { return []; } }
  function store(l) { try { localStorage.setItem('mbs-sql-saved', JSON.stringify(l)); } catch (e) {} }
  function saved(P) {
    var l = savedList();
    P.innerHTML = '<h2>Saved queries</h2>' + (l.length ? '<div class="list">' + l.map(function (q, i) { return '<div class="item"><div><b>' + esc(q.name) + '</b><br><small class="ref">' + esc(q.sql.replace(/\s+/g, ' ').slice(0, 110)) + '</small></div><div class="actions"><button class="btn btn-sm btn-gold" data-load="' + i + '">Open</button><button class="btn btn-sm" data-del="' + i + '">✕</button></div></div>'; }).join('') + '</div>'
      : '<div class="empty">Nothing saved yet. Use “Save query” in the SQL editor.</div>');
    P.querySelectorAll('[data-load]').forEach(function (b) { b.onclick = function () { var q = l[+b.getAttribute('data-load')]; S.sql = q.sql; S.title = q.name; S.tab = 'editor'; draw(); }; });
    P.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { l.splice(+b.getAttribute('data-del'), 1); store(l); panel(); }; });
  }

  /* ---------- results ---------- */
  function autoChart() {
    var x = S.cols.filter(function (c) { return !isNum(c); })[0] || S.cols[0] || '';
    var y = S.cols.filter(function (c) { return isNum(c) && c !== x; }).slice(0, 3);
    S.chart = { type: S.chart.type || 'bar', x: x, y: y };
  }
  function fmt(v) { return typeof v === 'number' ? v.toLocaleString('en-AU', { maximumFractionDigits: 2 }) : v === true ? 'yes' : v === false ? 'no' : v == null ? '' : String(v); }
  function results() {
    var R = $('#sqlResults'); if (!R) return;
    var n = S.rows.length;
    R.innerHTML = '<div class="card-h"><h2>Results <span class="muted">(' + n + ' row' + (n === 1 ? '' : 's') + (S.ms != null ? ' · ' + S.ms + ' ms' : '') + ')</span></h2>' +
      '<div class="actions"><div class="tabs" style="margin:0">' + [['table', 'Table'], ['records', 'Records'], ['chart', 'Chart']].map(function (x) { return '<button class="tab' + (S.view === x[0] ? ' on' : '') + '" data-view="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<button class="btn btn-sm" id="csvBtn">⬇ CSV</button><button class="btn btn-sm btn-gold" id="pubBtn">📄 Publish as report</button></div></div><div id="resBody"></div>';
    R.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { S.view = b.getAttribute('data-view'); results(); }; });
    $('#csvBtn').onclick = downloadCsv;
    $('#pubBtn').onclick = publish;
    var B = $('#resBody');
    if (!n) { B.innerHTML = '<div class="empty">No rows match.</div>'; return; }
    if (S.view === 'table') {
      B.innerHTML = '<div class="table-wrap"><table><thead><tr>' + S.cols.map(function (c) { return '<th' + (isNum(c) ? ' style="text-align:right"' : '') + '>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        S.rows.slice(0, 500).map(function (r) { return '<tr>' + S.cols.map(function (c) { return '<td' + (typeof r[c] === 'number' ? ' style="text-align:right"' : '') + '>' + esc(fmt(r[c])) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
        (n > 500 ? '<p class="muted">Showing the first 500 rows. Download the CSV for all of them.</p>' : '');
    } else if (S.view === 'records') {
      B.innerHTML = '<div class="recs">' + S.rows.slice(0, 100).map(function (r, i) { return '<div class="rec"><div class="muted" style="font-size:11.5px;font-weight:800">#' + (i + 1) + '</div><dl class="kv">' + S.cols.map(function (c) { return '<dt>' + esc(c) + '</dt><dd>' + esc(fmt(r[c])) + '</dd>'; }).join('') + '</dl></div>'; }).join('') + '</div>' +
        (n > 100 ? '<p class="muted">Showing the first 100 records.</p>' : '');
    } else chartView(B);
  }
  var TYPES = [['bar', 'Bar'], ['hbar', 'Horizontal bar'], ['stacked', 'Stacked bar'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie'], ['doughnut', 'Doughnut'], ['polarArea', 'Polar area'], ['radar', 'Radar']];
  function chartView(B) {
    var c = S.chart;
    B.innerHTML = '<div class="row" style="margin-bottom:12px"><label style="display:flex;gap:6px;align-items:center;font-weight:700">Chart<select id="chType" style="width:auto">' + TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === c.type ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></label>' +
      '<label style="display:flex;gap:6px;align-items:center;font-weight:700">Labels (X)<select id="chX" style="width:auto">' + S.cols.map(function (x) { return '<option' + (x === c.x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></label>' +
      '<span style="font-weight:700">Values (Y):</span>' + S.cols.filter(isNum).map(function (y) { return '<label style="display:flex;gap:4px;align-items:center;font-weight:600"><input type="checkbox" data-y="' + esc(y) + '" style="width:auto"' + (c.y.indexOf(y) >= 0 ? ' checked' : '') + '>' + esc(y) + '</label>'; }).join('') + '</div>' +
      '<div class="chart-box"><canvas id="chCanvas"></canvas></div>';
    $('#chType').onchange = function () { c.type = this.value; drawChart(); };
    $('#chX').onchange = function () { c.x = this.value; drawChart(); };
    B.querySelectorAll('[data-y]').forEach(function (b) { b.onchange = function () { var y = b.getAttribute('data-y'); c.y = b.checked ? c.y.concat([y]) : c.y.filter(function (v) { return v !== y; }); drawChart(); }; });
    drawChart();
  }
  function chartConfig(still) {
    var c = S.chart;
    var ys = c.y.filter(function (y) { return S.cols.indexOf(y) >= 0; });
    if (!ys.length) { var n0 = S.cols.filter(isNum)[0]; if (n0) ys = [n0]; }
    var rows = S.rows.slice(0, 300), labels = rows.map(function (r) { return fmt(r[c.x]) || '(blank)'; });
    var round = ['pie', 'doughnut', 'polarArea'].indexOf(c.type) >= 0;
    var type = c.type === 'hbar' || c.type === 'stacked' ? 'bar' : c.type === 'area' ? 'line' : c.type;
    var sets = (round ? ys.slice(0, 1) : ys).map(function (y, i) {
      var col = COLORS[i % COLORS.length];
      return { label: y, data: rows.map(function (r) { return Number(r[y]) || 0; }),
        backgroundColor: round ? rows.map(function (_, k) { return COLORS[k % COLORS.length]; }) : (c.type === 'area' || c.type === 'radar' ? col + '55' : col),
        borderColor: round ? '#fff' : col, borderWidth: round ? 2 : 2, fill: c.type === 'area' || c.type === 'radar', tension: 0.25, pointRadius: 3 };
    });
    return { type: type, data: { labels: labels, datasets: sets },
      options: { responsive: !still, maintainAspectRatio: false, animation: still ? false : { duration: 300 }, devicePixelRatio: still ? 2 : undefined, indexAxis: c.type === 'hbar' ? 'y' : 'x',
        plugins: { legend: { display: round || sets.length > 1, position: 'bottom' }, title: { display: !!S.title, text: S.title, font: { size: 15, weight: '700' } } },
        scales: round || c.type === 'radar' ? {} : { x: { stacked: c.type === 'stacked' }, y: { stacked: c.type === 'stacked', beginAtZero: true } } },
      plugins: [{ id: 'white', beforeDraw: function (ch) { var x = ch.ctx; x.save(); x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, ch.width, ch.height); x.restore(); } }] };
  }
  function hasNumbers() { return S.cols.some(isNum); }
  function drawChart() {
    var cv = $('#chCanvas'); if (!cv) return;
    if (chartObj) { chartObj.destroy(); chartObj = null; }
    if (!hasNumbers()) { cv.parentNode.innerHTML = '<div class="empty">These results have no number columns to chart. Try a query with COUNT(*) or SUM(…).</div>'; return; }
    chartObj = new window.Chart(cv, chartConfig(false));
  }
  function downloadCsv() {
    var cell = function (v) { var s = fmt(v).replace(/,(?=\d{3})/g, ''); if (typeof v === 'number') s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var csv = '﻿' + [S.cols.join(',')].concat(S.rows.map(function (r) { return S.cols.map(function (c) { return cell(r[c]); }).join(','); })).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = (S.title || 'query').replace(/[^\w-]+/g, '-') + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- publish as a report (DeepSeek + PDF) ---------- */
  function chartImage() {
    if (!hasNumbers()) return '';
    var cv = document.createElement('canvas'); cv.width = 1000; cv.height = 460; cv.style.cssText = 'position:fixed;left:-9999px;top:0;width:1000px;height:460px';
    document.body.appendChild(cv);
    var ch = new window.Chart(cv, chartConfig(true));
    var img = ch.toBase64Image('image/png', 1);
    ch.destroy(); cv.remove();
    return img;
  }
  function publish() {
    if (!S.rows.length) return fail(new Error('Run a query with some results first'));
    M.modal('<h2>Publish as a report</h2><div class="form" style="grid-template-columns:1fr;margin-top:12px">' +
      '<label>Report title<input id="rpTitle" value="' + esc(S.title) + '"></label>' +
      '<label>What should the report focus on? (optional)<textarea id="rpFocus" rows="2" placeholder="e.g. which months were best, and what to do about unpaid invoices"></textarea></label>' +
      (hasNumbers() ? '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="rpChart" checked style="width:auto">Include the chart (' + esc((TYPES.filter(function (t) { return t[0] === S.chart.type; })[0] || ['', 'Bar'])[1]) + ')</label>' : '<input type="checkbox" id="rpChart" hidden><p class="muted" style="margin:0">No chart: these results have no number columns.</p>') +
      '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="rpTable" checked style="width:auto">Include the data table (first 40 rows)</label>' +
      '<p class="note" style="margin:0">DeepSeek writes the summary from the results. Phone numbers, emails, addresses and customer names are removed before anything is sent to it.</p></div>' +
      '<div id="rpOut"></div><div class="actions" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>Close</button><button class="btn btn-gold" id="rpGo">✨ Write report with AI</button></div>');
    $('#rpGo').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Writing…';
      api('sqlNarrative', { title: $('#rpTitle').value, focus: $('#rpFocus').value, sql: S.sql, columns: S.cols, rows: S.rows.slice(0, 200) }).then(function (n) {
        $('#rpOut').innerHTML = '<div class="card" style="margin-top:14px;box-shadow:none">' + (n.note ? '<p class="warn" style="margin:0 0 10px">' + esc(n.note) + '</p>' : '') +
          '<label>Title<input id="rpT2" value="' + esc(n.title || $('#rpTitle').value) + '"></label><label style="margin-top:10px">Summary<textarea id="rpSum" rows="3">' + esc(n.summary) + '</textarea></label>' +
          '<label style="margin-top:10px">Key findings (one per line)<textarea id="rpIns" rows="4">' + esc((n.insights || []).join('\n')) + '</textarea></label>' +
          '<label style="margin-top:10px">Suggested actions (one per line)<textarea id="rpRec" rows="2">' + esc((n.recommendations || []).join('\n')) + '</textarea></label>' +
          '<p class="muted" style="margin:8px 0 0;font-size:12.5px">Edit anything before downloading.</p></div>';
        b.disabled = false; b.textContent = '⬇ Download PDF';
        b.onclick = function () {
          b.disabled = true; b.textContent = 'Making the PDF…';
          var lines = function (id) { return $(id).value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); };
          fetch(M.API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-MBS-Admin': '1' },
            body: JSON.stringify({ action: 'sqlPdf', title: $('#rpT2').value, summary: $('#rpSum').value, insights: lines('#rpIns'), recommendations: lines('#rpRec'), ai: !!n.ai,
              sql: S.sql, columns: $('#rpTable').checked ? S.cols : [], rows: $('#rpTable').checked ? S.rows.slice(0, 200) : [], chart: $('#rpChart').checked ? chartImage() : '' }) })
            .then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || 'PDF failed'); }); return r.blob(); })
            .then(function (blob) {
              var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = ($('#rpT2').value || 'MBS report').replace(/[^\w-]+/g, '-') + '.pdf'; document.body.appendChild(a); a.click(); a.remove();
              toast('Report downloaded'); b.disabled = false; b.textContent = '⬇ Download PDF';
            }).catch(function (e) { b.disabled = false; b.textContent = '⬇ Download PDF'; fail(e); });
        };
      }).catch(function (e) { b.disabled = false; b.textContent = '✨ Write report with AI'; fail(e); });
    };
  }

  M.addView('sql', 'SQL wizard', function (args) { if (args && ['ask', 'templates', 'wizard', 'editor', 'saved'].indexOf(args[0]) >= 0) S.tab = args[0]; return page(); });
  window.MBS.sqlState = S;   // for tests
  // other pages (e.g. Customers) can send a question straight to the AI query
  M.askAI = function (q) { S.pendingQ = String(q || ''); S.tab = 'ask'; if (location.hash === '#sql/ask') page(); else location.hash = '#sql/ask'; };
})();
