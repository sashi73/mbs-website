/* GKH Project Champ: the contact page enquiry form. Sends to /.netlify/functions/contact, which saves it for the team
   (Customers > Enquiries in the console) and emails GKH. */
(function () {
  'use strict';
  var f = document.getElementById('enqForm'), done = document.getElementById('enqDone');
  if (!f) return;
  var err = f.querySelector('.c-enq-err'), btn = f.querySelector('button[type=submit]');
  var EMAIL = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  function phoneOk(s) { var t = String(s || '').replace(/[^\d+]/g, ''); if (!t) return ''; if (t.indexOf('00') === 0) t = '+' + t.slice(2); if (t[0] !== '+') return null; var n = t.length - 1; return n >= 8 && n <= 15 ? t : null; }
  function fail(m) { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = function (n) { var x = f.elements[n]; return x ? String(x.value || '').trim() : ''; };
    var phone = phoneOk(v('phone'));
    if (!v('first') || !v('last')) return fail('Please type your first and last name.');
    if (!EMAIL.test(v('email'))) return fail('Please check your email address.');
    if (phone === null) return fail('Please include the country code in your phone number, for example +61 412 345 678.');
    if (!v('reason')) return fail('Please choose how we can help.');
    var pref = (f.querySelector('input[name=pref]:checked') || {}).value || 'Email';
    if ((pref === 'Phone' || pref === 'WhatsApp') && !phone) return fail('Please add your phone number so we can reach you by ' + pref + '.');
    if (!f.elements.consent.checked) return fail('Please tick the box to agree to the privacy notice.');
    err.hidden = true; btn.disabled = true; btn.querySelector('span').textContent = 'Sending…';
    var body = { first: v('first'), last: v('last'), email: v('email'), phone: phone || '', org: v('org'), role: v('role'), country: v('country'), size: v('size'),
      reason: v('reason'), message: v('message'), pref: pref, consent: true, news: !!f.elements.news.checked, website: v('website'), lang: document.documentElement.lang || 'en' };
    fetch('/.netlify/functions/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        btn.disabled = false; btn.querySelector('span').textContent = 'Send enquiry';
        if (!x.ok) return fail((x.j && x.j.error) || 'Sorry, that didn’t send. Please try again, or email ceo@gkhconsultancy.com.');
        done.querySelector('[data-first]').textContent = body.first; done.querySelector('[data-ref]').textContent = x.j.ref || '';
        f.hidden = true; done.hidden = false; done.scrollIntoView({ block: 'center', behavior: 'smooth' });
      })
      .catch(function () { btn.disabled = false; btn.querySelector('span').textContent = 'Send enquiry'; fail('No connection. Please check your internet and try again.'); });
  });
  document.getElementById('enqAgain').addEventListener('click', function () { f.reset(); done.hidden = true; f.hidden = false; f.elements.first.focus(); });
})();
