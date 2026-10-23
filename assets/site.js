/* MBS — shared site behaviour: hover effects, reveal, nav, filters, form */
(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {

    /* ---- sticky header state ---- */
    var header = document.querySelector('header.site');
    function onScroll() {
      if (header) header.classList.toggle('scrolled', window.scrollY > 40);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* ---- mobile menu ---- */
    var burger = document.querySelector('.burger');
    var menu = document.querySelector('.menu');
    if (burger && menu) {
      burger.addEventListener('click', function () {
        var open = menu.classList.toggle('open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      menu.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') menu.classList.remove('open');
      });
    }

    /* ---- reveal on scroll ---- */
    var rv = document.querySelectorAll('.rv');
    if (!('IntersectionObserver' in window) || reduce) {
      Array.prototype.forEach.call(rv, function (el) { el.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      Array.prototype.forEach.call(rv, function (el, i) {
        el.style.transitionDelay = Math.min(i % 6, 5) * 70 + 'ms';
        io.observe(el);
      });
    }

    /* ---- magnetic buttons + gradient follows the cursor ---- */
    if (!reduce) {
      Array.prototype.forEach.call(document.querySelectorAll('.btn'), function (b) {
        b.addEventListener('mousemove', function (e) {
          var r = b.getBoundingClientRect();
          var x = e.clientX - r.left, y = e.clientY - r.top;
          var dx = (x - r.width / 2) / r.width, dy = (y - r.height / 2) / r.height;
          b.style.transform = 'translate(' + (dx * 9).toFixed(2) + 'px,' + (dy * 7).toFixed(2) + 'px)';
          b.style.setProperty('--bx', ((x / r.width) * 100).toFixed(1) + '%');
        });
        b.addEventListener('mouseleave', function () {
          b.style.transform = '';
          b.style.setProperty('--bx', '0%');
        });
      });
    }

    /* ---- gold glow follows the cursor across image tiles ---- */
    if (!reduce) {
      Array.prototype.forEach.call(document.querySelectorAll('.tile'), function (t) {
        var glow = t.querySelector('.glow');
        if (!glow) return;
        t.addEventListener('mousemove', function (e) {
          var r = t.getBoundingClientRect();
          glow.style.left = (e.clientX - r.left) + 'px';
          glow.style.top = (e.clientY - r.top) + 'px';
        });
      });
    }

    /* ---- hero parallax ---- */
    var heroImg = document.querySelector('.hero-img');
    if (heroImg && !reduce) {
      var ticking = false;
      window.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(function () {
          var y = Math.min(window.scrollY, 900);
          heroImg.style.transform = 'scale(1.08) translateY(' + (y * 0.16).toFixed(1) + 'px)';
          ticking = false;
        });
      }, { passive: true });
    }

    /* ---- ticker: duplicate content so the loop is seamless ---- */
    var track = document.querySelector('.ticker-track');
    if (track && !track.dataset.doubled) {
      track.innerHTML = track.innerHTML + track.innerHTML;
      track.dataset.doubled = '1';
    }

    /* ---- project filters ---- */
    var chips = document.querySelectorAll('.chip[data-filter]');
    if (chips.length) {
      Array.prototype.forEach.call(chips, function (c) {
        c.addEventListener('click', function () {
          Array.prototype.forEach.call(chips, function (o) {
            o.classList.remove('on');
            o.setAttribute('aria-pressed', 'false');
          });
          c.classList.add('on');
          c.setAttribute('aria-pressed', 'true');
          var f = c.dataset.filter;
          Array.prototype.forEach.call(document.querySelectorAll('#project-grid .pitem'), function (p) {
            var show = (f === 'All' || p.dataset.tag === f);
            p.style.display = show ? '' : 'none';
          });
        });
      });
    }

    /* ---- quote form: show confirmation (no server yet) ---- */
    var form = document.querySelector('form.quote');
    if (form) {
      var err = document.createElement('p');
      err.className = 'full form-error';
      err.setAttribute('role', 'alert');
      err.style.cssText = 'margin:0;font-size:14px;color:#F2B8A0;display:none';
      form.appendChild(err);

      // Optional photos: shrunk in the browser, sent with the enquiry (up to 3)
      var photos = [];
      var pInput = form.querySelector('[data-photo-input]');
      var pThumbs = form.querySelector('[data-photo-thumbs]');
      function shrink(file) {
        return new Promise(function (resolve) {
          if (!file || !/^image\//.test(file.type)) return resolve(null);
          var url = URL.createObjectURL(file), img = new Image();
          img.onload = function () {
            var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
            var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            resolve({ name: String(file.name || 'photo').slice(0, 80), data: c.toDataURL('image/jpeg', 0.82) });
          };
          img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
          img.src = url;
        });
      }
      function drawThumbs() {
        if (!pThumbs) return;
        pThumbs.innerHTML = '';
        photos.forEach(function (p, i) {
          var fig = document.createElement('figure');
          var im = document.createElement('img'); im.src = p.data; im.alt = 'Photo ' + (i + 1);
          var x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove photo ' + (i + 1));
          x.addEventListener('click', function () { photos.splice(i, 1); drawThumbs(); });
          fig.appendChild(im); fig.appendChild(x); pThumbs.appendChild(fig);
        });
      }
      if (pInput) pInput.addEventListener('change', function () {
        var files = Array.prototype.slice.call(pInput.files || [], 0, 3 - photos.length);
        pInput.value = '';
        Promise.all(files.map(shrink)).then(function (out) {
          photos = photos.concat(out.filter(Boolean)).slice(0, 3);
          drawThumbs();
        });
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var fd = new FormData(form);
        var get = function (k) { return String(fd.get(k) || '').trim(); };
        var showErr = function (msg) { err.innerHTML = msg; err.style.display = 'block'; };
        err.style.display = 'none';

        if (!get('name')) return showErr('Please add your name.');
        var digits = get('phone').replace(/[^\d]/g, '');
        if (digits.length < 8) return showErr('Please add a phone number so we can call you back.');

        var btn = form.querySelector('button[type=submit]');
        if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }

        fetch('/.netlify/functions/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'contact_form',
            channels: ['email', 'telegram'],
            website: get('website'),
            photos: photos,
            lead: {
              name: get('name'), phone: get('phone'), suburb: get('suburb'),
              service: get('service'), summary: get('details'), details: get('details')
            }
          })
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok && j.ok, ref: j.prejob_no || '' }; }); })
          .then(function (res) {
            if (!res.ok) throw new Error('send');
            var thanks = document.querySelector('.thanks');
            var refEl = thanks && thanks.querySelector('[data-ref]');
            if (thanks && !refEl) { refEl = document.createElement('p'); refEl.setAttribute('data-ref', ''); refEl.className = 'lead'; refEl.style.margin = '0'; thanks.insertBefore(refEl, thanks.children[1] || null); }
            if (refEl) refEl.innerHTML = res.ref ? 'Your reference number is <b style="color:#F2D98B">' + res.ref + '</b>.' : '';
            form.style.display = 'none';
            if (thanks) thanks.style.display = 'flex';
          })
          .catch(function () {
            showErr('Sorry, that didn’t send. Please call <a href="tel:0420494990" style="color:#F2D98B">0420 494 990</a>.');
          })
          .then(function () { if (btn) { btn.disabled = false; btn.style.opacity = ''; } });
      });
      var again = document.querySelector('[data-again]');
      if (again) {
        again.addEventListener('click', function () {
          var thanks = document.querySelector('.thanks');
          if (thanks) thanks.style.display = 'none';
          form.style.display = 'grid';
          form.reset();
          photos = []; drawThumbs();
        });
      }
    }

    /* ---- "Ask Mr. Fixit" section: hands the question to the chat ---- */
    function askFixit(q) {
      if (window.MrFixit && typeof window.MrFixit.ask === 'function') window.MrFixit.ask(q);
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-ask-form]'), function (f) {
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = f.querySelector('input[name=q]');
        var q = input ? input.value.trim() : '';
        if (!q) { if (input) input.focus(); return; }
        askFixit(q);
        input.value = '';
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-ask]'), function (b) {
      b.addEventListener('click', function () { askFixit(b.getAttribute('data-ask')); });
    });

    /* ---- current year ---- */
    Array.prototype.forEach.call(document.querySelectorAll('[data-year]'), function (el) {
      el.textContent = new Date().getFullYear();
    });
  });
})();


/* MBS v18: project photo strips, before & after sliders, track-record counters, sector links */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* photo strip under each project: tap a thumbnail to show it */
  Array.prototype.forEach.call(document.querySelectorAll('.wcard'), function (card) {
    var main = card.querySelector('.gal-main');
    var btns = card.querySelectorAll('.gal-t');
    if (!main || !btns.length) return;
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        main.src = b.dataset.src;
        Array.prototype.forEach.call(btns, function (o) { o.classList.remove('on'); o.setAttribute('aria-pressed', 'false'); });
        b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
      });
    });
  });

  /* before & after: drag the range to reveal */
  Array.prototype.forEach.call(document.querySelectorAll('.ba-frame'), function (f) {
    var r = f.querySelector('input[type=range]');
    if (!r) return;
    var set = function () { f.style.setProperty('--pos', r.value + '%'); };
    r.addEventListener('input', set);
    set();
  });

  /* track record: count up once when visible */
  var nums = document.querySelectorAll('.stat b[data-count]');
  function run(el) {
    var to = +el.dataset.count, from = el.dataset.plain ? to - 14 : 0, t0 = null, dur = 1400;
    function step(t) {
      if (!t0) t0 = t;
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if (nums.length && !reduce && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.6 });
    Array.prototype.forEach.call(nums, function (n) { io.observe(n); });
  }

  /* projects.html#f=Hotels opens the projects page filtered by that sector */
  function sectorFromHash() {
    var m = /^#f=(.+)$/.exec(location.hash || '');
    if (!m) return;
    var want = decodeURIComponent(m[1]);
    Array.prototype.forEach.call(document.querySelectorAll('.chip[data-filter]'), function (c) {
      if (c.dataset.filter === want) {
        c.click();
        var g = document.querySelector('.filters');
        if (g) window.scrollTo({ top: g.getBoundingClientRect().top + window.pageYOffset - 140 });
      }
    });
  }
  // after the page's own scripts have wired up the filter buttons
  if (document.readyState === 'complete') setTimeout(sectorFromHash, 0);
  else window.addEventListener('load', function () { setTimeout(sectorFromHash, 0); });
  window.addEventListener('hashchange', sectorFromHash);
})();
