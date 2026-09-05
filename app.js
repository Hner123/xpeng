/* =============================================================
   XPENG FUTURE NIGHT — landing page behaviour
   No personal data is ever written to localStorage/sessionStorage
   or to a URL (Section 10). The submit queue below is in-memory
   only: it retries with backoff for as long as the tab is open.
   ============================================================= */
(function () {
  'use strict';

  var CFG   = window.XPENG_CONFIG || {};
  var GEO   = window.XPENG_GEO || {};
  var BRANDS= window.XPENG_BRANDS || [];
  var $ = function (id) { return document.getElementById(id); };

  /* Absolute only when the page is genuinely on a different host from
     the API. Local development and the API's own domain fall back to
     relative paths — otherwise opening the page on localhost would
     post test registrations straight into production. */
  function apiBase() {
    var api = CFG.api || {};
    if (!api.base) return '';
    var host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '') return '';
    try {
      if (new URL(api.base).hostname === host) return '';
    } catch (e) { return ''; }
    return api.base;
  }

  function endpoint(name) {
    var api = CFG.api || {};
    return apiBase() + (api[name] || '/api/' + name);
  }

  /* Same glyphs as the share row in index.html, kept here because the
     follow row is built from config.contact.socials at runtime. */
  var ICON = {
    Facebook: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.77-3.9 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.44 2.91h-2.34V22c4.78-.79 8.45-4.94 8.45-9.94Z"/></svg>',
    Instagram: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/></svg>',
    TikTok: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.1v12.4a2.59 2.59 0 1 1-1.84-2.48V9.74a5.72 5.72 0 1 0 4.94 5.66V8.99a7.32 7.32 0 0 0 4.27 1.38V7.27a4.25 4.25 0 0 1-3.21-1.45Z"/></svg>',
    YouTube: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M21.6 7.2s-.2-1.4-.8-2c-.76-.8-1.6-.8-2-.86C16.2 4.2 12 4.2 12 4.2h-.02s-4.2 0-6.8.14c-.4.06-1.24.06-2 .86-.6.6-.8 2-.8 2S2.2 8.8 2.2 10.5v1.6c0 1.6.18 3.3.18 3.3s.2 1.4.8 2c.76.8 1.76.78 2.22.86 1.5.14 6.4.18 6.4.18s4.2 0 6.8-.16c.4-.06 1.24-.06 2-.86.6-.6.8-2 .8-2s.18-1.7.18-3.3v-1.6c0-1.7-.18-3.3-.18-3.3ZM9.9 14.4V8.9l5.4 2.76-5.4 2.74Z"/></svg>',
    X: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M17.53 3h3.1l-6.77 7.74L21.9 21h-6.2l-4.4-5.77L6.1 21H3l7.05-8.06L2.4 3h6.36l4.1 5.42L17.53 3Zm-1.1 16.14h1.72L6.9 4.77H5.06l11.37 14.37Z"/></svg>'
  };

  /* ---------- tracking helper (Section 9) ---------------------- */
  function track(event, data) {
    data = data || {};
    try { if (window.fbq)  window.fbq('track', event, data); } catch (e) {}
    try { if (window.ttq)  window.ttq.track(event, data); } catch (e) {}
    try { if (window.gtag) window.gtag('event', event, data); } catch (e) {}
    (window.dataLayer = window.dataLayer || []).push(
      Object.assign({ event: event }, data)
    );
  }

  /* ---------- UTM capture (kept in memory, sent with the lead) -- */
  var UTM = (function () {
    var p = new URLSearchParams(location.search), out = {};
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','ttclid','gclid']
      .forEach(function (k) { if (p.get(k)) out[k] = p.get(k); });
    out.referrer = document.referrer || '';
    out.landing_path = location.pathname;
    return out;
  })();

  /* ---------- config into the page ---------------------------- */
  function paintConfig() {
    var ev = CFG.event || {};
    if (ev.venue)      $('m-venue').textContent = ev.venue;
    if (ev.dateLabel)  $('m-date').textContent  = ev.dateLabel;
    /* Venue section repeats both, so drive them from the same config
       and they can never drift apart. */
    if (ev.venue && $('v-venue'))     $('v-venue').textContent = ev.venue;
    if (ev.dateLabel && $('v-date'))  $('v-date').textContent  = ev.dateLabel;
    if (ev.venue && $('c-venue'))     $('c-venue').textContent = ev.venue;
    if (ev.dateLabel && $('c-date'))  $('c-date').textContent  = ev.dateLabel;

    var st = CFG.status || {};
    if (st.waitlistLabel) $('s-waitlist').textContent = st.waitlistLabel;

    /* The counter stays hidden until the live API confirms a real
       number — see liveCount(). Nothing is ever shown from config. */
    var c = CFG.counter || {};
    $('counter-label').textContent = c.label || 'already on the waitlist';

    var ct = CFG.contact || {};
    if (ct.email) {
      var mail = $('f-mail');
      mail.textContent = ct.email;
      mail.href = 'mailto:' + ct.email;
    }
    /* Only render a social link once it has a real URL. A '#' href
       silently reloads the page, which reads as a broken button —
       better to show nothing than a dead link on a campaign page. */
    var socials = (ct.socials || []).filter(function (s) {
      return s.href && s.href !== '#' && /^https?:\/\//i.test(s.href);
    });
    /* Footer keeps text links (they read as a list); the success
       screen uses icons in the requested order. */
    socials.forEach(function (s) {
      var a = document.createElement('a');
      a.textContent = s.label; a.href = s.href;
      a.target = '_blank'; a.rel = 'noopener';
      $('f-links').appendChild(a);
    });
    /* Two icon rows, same links, same order: the hero strip beside
       the forum line, and the success screen after submitting. */
    var ORDER = ['Facebook', 'Instagram', 'TikTok', 'YouTube', 'X'];
    function iconRow(host) {
      if (!host) return;
      ORDER.forEach(function (label) {
        var match = socials.filter(function (s) { return s.label === label; })[0];
        if (!match) return;
        var a = document.createElement('a');
        a.href = match.href; a.target = '_blank'; a.rel = 'noopener';
        a.setAttribute('aria-label', 'Follow XPENG Philippines on ' + label);
        a.title = label;
        a.innerHTML = ICON[label] || label;
        host.appendChild(a);
      });
    }
    iconRow($('follow-row'));
    iconRow($('hero-follow'));

    /* The hero row ships hidden, so it never flashes an empty gap
       next to the forum pill before config is read. */
    if (socials.length && $('hero-follow')) $('hero-follow').hidden = false;
    /* No usable links yet -> hide the whole follow block, heading
       included, so the success screen doesn't end on an empty row. */
    if (!socials.length) {
      var row = $('follow-row');
      if (row) {
        row.hidden = true;
        if (row.previousElementSibling) row.previousElementSibling.hidden = true;
      }
    }
    if ((ct.socials || []).length && !socials.length) {
      console.warn('[xpeng] social links are still placeholders in config.js — follow row hidden');
    }

    paintArtist();
    liveCount();
  }

  /* The ONLY source of the waitlist number. Shows it when the API
     reports a real total at or above minToShow; otherwise the
     counter stays hidden. Never invents or caches a figure, and a
     failed request must never break the form. */
  function liveCount() {
    var c = CFG.counter || {};
    if (!c.show) return;
    var floor = c.minToShow || 0;
    fetch(endpoint('count'), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok || typeof d.total !== 'number') return;
        if (d.total < floor) return;                 // real, but not yet worth showing
        CFG.counter.total = d.total;
        $('counter-num').textContent = Number(d.total).toLocaleString();
        $('counter').hidden = false;
        countUp();                                   // animate once we have the real figure
      })
      .catch(function () {});
  }

  /* Artist reveal swap — flip config.artist.revealed at T-1 week. */
  function paintArtist() {
    var a = CFG.artist || {};
    var reveal = $('lineup-reveal');
    var lab = document.querySelector('.ha-lab');
    if (lab && a.sectionLabel) lab.textContent = a.sectionLabel;
    if (!a.revealed) {
      /* Only overwrite when config actually supplies a value, so the
         markup stays the fallback rather than being clobbered. */
      if (a.blockCopy)  $('mystery-copy').textContent = a.blockCopy;
      if (a.lineupCopy) $('lineup-copy').textContent  = a.lineupCopy;
      if (a.revealDateLabel && reveal) reveal.textContent = 'TO BE REVEALED · ' + a.revealDateLabel;
      /* Was hard-coded "2 STARS", which silently overwrote the markup.
         Both halves now come from config. */
      var acts = a.actsLabel || '2 OPM STARS';
      $('hero-artist-txt').textContent = a.revealDateLabel
        ? acts + ' · REVEALED ' + a.revealDateLabel
        : acts + ' · TO BE REVEALED';
      return;
    }

    /* Revealed: hero strip drops the silhouettes and names them. */
    var names = (a.acts || []).map(function (x) { return x.name; }).filter(Boolean);
    var sils = document.querySelector('.ha-sil');
    if (sils) sils.remove();
    if (names.length) $('hero-artist-txt').textContent = names.join(' · ').toUpperCase();
    $('lineup-title').textContent = a.revealedTitle || 'Your headliners.';
    $('lineup-copy').textContent  = a.revealedCopy ||
      'One takes the stage for the XPENG X9 and XPENG L03 reveals, the other caps off the night with a full concert set.';
    var art = $('lineup-art');
    art.className = 'acts';
    art.innerHTML = (a.acts || []).map(function (act) {
      return '<div class="act"><b></b><span></span></div>';
    }).join('');
    Array.prototype.forEach.call(art.children, function (el, i) {
      el.querySelector('b').textContent    = (a.acts[i] || {}).name || '';
      el.querySelector('span').textContent = ((a.acts[i] || {}).role || '').toUpperCase();
    });
    var sil = $('mystery-sil');
    if (sil) sil.innerHTML = '<span>' + (a.acts || []).map(function (x) { return x.name; }).join(' · ') + '</span>';
  }

  /* ---------- countdown --------------------------------------- */
  function countdown() {
    var target = new Date((CFG.event || {}).dateISO || '2026-09-25T18:00:00+08:00').getTime();
    var box = $('countdown');
    if (!box || isNaN(target)) return;
    var cell = {
      d: box.querySelector('[data-cd="d"]'), h: box.querySelector('[data-cd="h"]'),
      m: box.querySelector('[data-cd="m"]'), s: box.querySelector('[data-cd="s"]')
    };
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function set(el, val, pulse) {
      if (el.textContent === val) return;
      el.textContent = val;
      if (!pulse || !document.documentElement.classList.contains('motion')) return;
      el.classList.remove('flip');
      void el.offsetWidth;                 // restart the keyframe
      el.classList.add('flip');
    }
    function tick() {
      var left = target - Date.now();
      if (left <= 0) {
        box.innerHTML = '<div class="cd" style="max-width:none;flex:1"><b>TONIGHT</b><span>MOA ARENA</span></div>';
        return;
      }
      var s = Math.floor(left / 1000);
      /* d/h/m pulse when they change; seconds tick silently. */
      set(cell.d, String(Math.floor(s / 86400)), true);
      set(cell.h, pad(Math.floor(s % 86400 / 3600)), true);
      set(cell.m, pad(Math.floor(s % 3600 / 60)), true);
      set(cell.s, pad(s % 60), false);
      setTimeout(tick, 1000);
    }
    tick();
  }

  /* ---------- nav / drawer / sticky CTA ------------------------ */
  function chrome() {
    var burger = $('burger');
    var drawer = $('drawer');

    function setMenu(open) {
      document.body.classList.toggle('menu-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    burger.addEventListener('click', function (e) {
      e.stopPropagation();
      setMenu(!document.body.classList.contains('menu-open'));
    });

    drawer.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });

    /* Tapping the dimmed page closes it — expected behaviour for an
       overlay menu, and the scrim is a pseudo-element so it cannot
       carry its own listener. */
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('menu-open')) return;
      if (e.target.closest('#drawer') || e.target.closest('#burger')) return;
      setMenu(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('menu-open')) {
        setMenu(false);
        burger.focus();
      }
    });

    var sticky = $('sticky'), card = $('waitlist');
    var cardOffscreen = false;
    function updateSticky() {
      var registered = !$('step3').hidden;
      sticky.classList.toggle('on', cardOffscreen && !registered);
    }
    function onScroll() {
      var r = card.getBoundingClientRect();
      cardOffscreen = r.bottom < 0 || r.top > window.innerHeight;
      updateSticky();
    }
    chrome.refreshSticky = updateSticky;
    if ('IntersectionObserver' in window) {
      var cardObserver = new IntersectionObserver(function (entries) {
        cardOffscreen = !entries[0].isIntersecting;
        updateSticky();
      });
      cardObserver.observe(card);
    } else {
      var stickyQueued = false;
      function queueSticky() {
        if (stickyQueued) return;
        stickyQueued = true;
        requestAnimationFrame(function () { stickyQueued = false; onScroll(); });
      }
      window.addEventListener('scroll', queueSticky, { passive: true });
      window.addEventListener('resize', queueSticky, { passive: true });
      onScroll();
    }

    document.querySelectorAll('[data-cta]').forEach(function (el) {
      el.addEventListener('click', function () { track('StartForm', { placement: el.dataset.cta }); });
    });
    /* Outbound links get their own event. Firing StartForm for these
       would count someone leaving for xpeng.com as a registration
       intent and quietly inflate the campaign's conversion figures. */
    document.querySelectorAll('[data-out]').forEach(function (el) {
      el.addEventListener('click', function () { track('OutboundClick', { destination: el.dataset.out }); });
    });
  }

  /* ---------- dropdowns --------------------------------------- */
  var prov = $('f-prov'), city = $('f-city'), drive = $('f-drive');

  function fillSelects() {
    Object.keys(GEO).forEach(function (p) {
      var o = document.createElement('option');
      o.value = o.textContent = p;
      prov.appendChild(o);
    });
    prov.addEventListener('change', function () {
      city.innerHTML = '<option value="">City / Municipality</option>';
      if (prov.value && GEO[prov.value]) {
        GEO[prov.value].forEach(function (c) {
          var o = document.createElement('option');
          o.value = o.textContent = c;
          city.appendChild(o);
        });
        city.disabled = false;
      } else {
        city.disabled = true;
      }
      clear($('w-prov')); clear($('w-city'));
    });
    BRANDS.forEach(function (b) {
      var o = document.createElement('option');
      o.value = o.textContent = b;
      drive.appendChild(o);
    });
    drive.addEventListener('change', toggleOther);
  }

  /* ---------- chips ------------------------------------------- */
  var answers = {};
  function chips() {
    document.querySelectorAll('.chips').forEach(function (g) {
      function pick(el) {
        g.querySelectorAll('.chip').forEach(function (c) {
          c.classList.remove('sel');
          c.setAttribute('aria-pressed', 'false');
        });
        el.classList.add('sel');
        el.setAttribute('aria-pressed', 'true');
        answers[g.dataset.q] = el.textContent.trim();
        g.closest('.q').classList.remove('bad');
        toggleOther();
      }
      g.addEventListener('click', function (e) {
        if (e.target.classList.contains('chip')) pick(e.target);
      });
      g.addEventListener('keydown', function (e) {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('chip')) {
          e.preventDefault(); pick(e.target);
        }
      });
    });
  }

  /* Show a "please specify" box whenever Other is the answer. Hiding
     it also clears it, so a stale value can never be submitted. */
  function toggleOther() {
    var whoWrap = $('w-who-other');
    var showWho = answers.who === 'Other';
    if (whoWrap.hidden === showWho) {
      whoWrap.hidden = !showWho;
      if (!showWho) $('f-who-other').value = '';
    }
    var drvWrap = $('w-drive-other');
    var showDrv = drive.value === 'Other brand';
    if (drvWrap.hidden === showDrv) {
      drvWrap.hidden = !showDrv;
      if (!showDrv) $('f-drive-other').value = '';
    }
  }

  /* ---------- validation ------------------------------------- */
  function bad(wrap)   { wrap.classList.add('bad'); }
  function clear(wrap) { wrap.classList.remove('bad'); }

  var reMobile = /^09\d{9}$/;
  var reEmail  = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  function mobileDigits(v) { return String(v).replace(/[^\d]/g, '').replace(/^63/, '0'); }

  function validateStep1() {
    var ok = true;
    var first = $('f-first').value.trim();
    var last  = $('f-last').value.trim();
    var mob   = mobileDigits($('f-mobile').value);
    var mail  = $('f-email').value.trim();

    if (first.length < 2) { bad($('w-first')); ok = false; } else clear($('w-first'));
    if (last.length  < 2) { bad($('w-last'));  ok = false; } else clear($('w-last'));
    if (!reMobile.test(mob))  { bad($('w-mobile')); ok = false; } else clear($('w-mobile'));
    if (!reEmail.test(mail))  { bad($('w-email')); ok = false; }  else clear($('w-email'));
    if (!prov.value)          { bad($('w-prov')); ok = false; }   else clear($('w-prov'));
    if (!city.value)          { bad($('w-city')); ok = false; }   else clear($('w-city'));
    return ok;
  }

  /* Split across the two qualification screens. */
  var REQUIRED_A = { age: 'q-age', who: 'q-who', ev: 'q-ev' };
  var REQUIRED_B = { when: 'q-when', budget: 'q-budget', model: 'q-model' };

  function checkGroup(map) {
    var ok = true;
    Object.keys(map).forEach(function (k) {
      var el = $(map[k]);
      if (!answers[k]) { el.classList.add('bad'); ok = false; } else el.classList.remove('bad');
    });
    return ok;
  }

  /* Screen one: age, segment, current vehicle. */
  function validateStep2a() {
    var ok = checkGroup(REQUIRED_A);
    if (!drive.value) { $('q-drive').classList.add('bad'); ok = false; } else $('q-drive').classList.remove('bad');
    if (answers.who === 'Other' && !$('f-who-other').value.trim()) { bad($('w-who-other')); ok = false; }
    else clear($('w-who-other'));
    if (drive.value === 'Other brand' && !$('f-drive-other').value.trim()) { bad($('w-drive-other')); ok = false; }
    else clear($('w-drive-other'));
    return ok;
  }

  function validateStep2() {
    var ok = checkGroup(REQUIRED_B);
    if (!$('c-priv').checked) ok = false;
    return ok;
  }

  /* ---------- payload ---------------------------------------- */
  function payload() {
    /* "Other" answers carry the typed detail with them, so the option
       and the specifics stay in one exportable column. */
    var segment = answers.who || null;
    if (segment === 'Other') {
      var whoOther = $('f-who-other').value.trim();
      if (whoOther) segment = 'Other — ' + whoOther;
    }
    var drives = drive.value || null;
    if (drives === 'Other brand') {
      var drvOther = $('f-drive-other').value.trim();
      if (drvOther) drives = 'Other — ' + drvOther;
    }

    return {
      first_name: $('f-first').value.trim(),
      last_name:  $('f-last').value.trim(),
      mobile:   mobileDigits($('f-mobile').value),
      email:    $('f-email').value.trim().toLowerCase(),
      province: prov.value,
      city:     city.value,
      profile: {
        age: answers.age || null, segment: segment,
        drives: drives, intent: answers.when || null,
        budget: answers.budget || null, model: answers.model || null,
        ev: answers.ev || null
      },
      consents: {
        privacy: $('c-priv').checked,
        dealer:  $('c-dealer').checked,
        marketing: $('c-mkt').checked,
        at: new Date().toISOString()
      },
      utm: UTM,
      client: { ua: navigator.userAgent, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }
    };
  }

  /* ---------- submit with in-memory retry queue ---------------
     Under spike load a submission must never be lost. Failures
     retry with backoff while the tab lives; the guest already
     sees the confirmation state, so the queue is invisible.     */
  function post(body, attempt) {
    attempt = attempt || 0;
    return fetch(endpoint('submit'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().catch(function () { return {}; });
    }).catch(function (err) {
      if (attempt >= 6) throw err;
      var wait = Math.min(30000, 1000 * Math.pow(2, attempt));
      return new Promise(function (res) {
        setTimeout(function () { res(post(body, attempt + 1)); }, wait);
      });
    });
  }

  /* Step 1 is saved on its own so an abandon at Step 2 still
     leaves us the lead (Section 4). */
  var leadSaved = false;
  function saveLead() {
    if (leadSaved) return;
    leadSaved = true;
    var lead = payload();
    lead.partial = true;
    post(lead).catch(function () {});
  }

  /* ---------- steps ------------------------------------------ */
  var s1 = $('step1'), s2 = $('step2'), s2b = $('step2b'), s3 = $('step3');

  function focusCard() {
    $('waitlist').scrollIntoView({ block: 'center', behavior: MOTION ? 'smooth' : 'instant' });
  }

  function flow() {
    s1.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = validateStep1();
      $('err1').classList.toggle('on', !ok);
      if (!ok) return;
      saveLead();
      track('StartForm', { step: 2 });
      s1.hidden = true; s2.hidden = false;
      focusCard();
    });

    $('btn-back').addEventListener('click', function () {
      s2.hidden = true; s1.hidden = false;
      focusCard();
    });

    /* Screen one of the qualification: no submit, just advance. */
    s2.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = validateStep2a();
      $('err2').classList.toggle('on', !ok);
      if (!ok) return;
      s2.hidden = true; s2b.hidden = false;
      focusCard();
    });

    $('btn-back2').addEventListener('click', function () {
      s2b.hidden = true; s2.hidden = false;
      focusCard();
    });

    s2b.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = validateStep2();
      $('err3').classList.toggle('on', !ok);
      if (!ok) return;

      var btn = $('btn-submit');
      btn.disabled = true;
      btn.textContent = 'SAVING…';

      var body = payload();
      body.partial = false;

      /* Confirm optimistically — the queue guarantees delivery. */
      post(body).then(function (res) {
        showDone(res && res.sequence);
      }).catch(function () {
        showDone(null);
      });

      showDone.pending = true;
      setTimeout(function () { if (showDone.pending) showDone(null); }, 1200);
    });

    document.querySelectorAll('.other-field input').forEach(function (el) {
      el.addEventListener('input', function () {
        var w = el.closest('.field');
        if (w) clear(w);
      });
    });
    document.querySelectorAll('#step1 input, #step1 select').forEach(function (el) {
      el.addEventListener('input', function () {
        var w = el.closest('.field');
        if (w) clear(w);
      });
    });
  }

  function showDone(sequence) {
    if (showDone.shown) {
      if (sequence) $('wl-num').textContent = '#' + Number(sequence).toLocaleString();
      return;
    }
    showDone.shown = true;
    showDone.pending = false;

    var c = CFG.counter || {};
    var seq = sequence || (c.total ? c.total + 1 : null);
    $('wl-num').textContent = seq ? '#' + Number(seq).toLocaleString() : "YOU'RE IN";

    var conf = CFG.confirmation || {};
    $('wl-copy').innerHTML = conf.mode === 'closed' ? (conf.closed || '') : (conf.open || '');

    s2.hidden = true; s2b.hidden = true; s3.hidden = false;
    /* Swap the white form card for the glass confirmation card. */
    $('waitlist').classList.add('is-done');
    focusCard();
    if (chrome.refreshSticky) chrome.refreshSticky();
    track('CompleteRegistration', { value: 1, currency: 'PHP' });
  }

  /* ---------- share ------------------------------------------ */
  function toastShare(msg) {
    var el = document.getElementById('share-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'share-toast';
      el.className = 'share-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastShare.t);
    toastShare.t = setTimeout(function () { el.classList.remove('on'); }, 2600);
  }

  function share() {
    var sh = CFG.share || {};
    var text = sh.text || 'I joined the waitlist for XPENG FUTURE NIGHT';
    var url  = sh.url || location.href.split('?')[0];
    $('sh-fb').href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url) + '&quote=' + encodeURIComponent(text);
    $('sh-x').href  = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url);
    $('sh-vi').href = 'viber://forward?text=' + encodeURIComponent(text + ' ' + url);

    /* Instagram accepts no URL from the web, so the only honest route
       is the OS share sheet — where Instagram is one of the targets.
       Desktop has no sheet, so it copies instead and says so. */
    $('sh-ig').addEventListener('click', function () {
      track('Share', { channel: 'instagram' });
      if (navigator.share) {
        navigator.share({ title: 'XPENG · Driving Into A New Day', text: text, url: url }).catch(function () {});
        return;
      }
      navigator.clipboard.writeText(url).then(function () {
        var btn = $('sh-ig');
        btn.title = 'Link copied — paste it into your Instagram story';
        toastShare('Link copied — paste it into your Instagram story');
      }).catch(function () {});
    });

    $('sh-copy').addEventListener('click', function () {
      var btn = this;
      var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy link'; }, 1800); };
      if (navigator.share) { navigator.share({ text: text, url: url }).then(done).catch(function () {}); return; }
      navigator.clipboard.writeText(url).then(done).catch(function () {});
    });

    document.querySelectorAll('.share-row a').forEach(function (a) {
      a.addEventListener('click', function () { track('Share', { channel: a.id.replace('sh-', '') }); });
    });
  }

  /* =============================================================
     SCROLL MOTION
     Opt-in: nothing below runs if the visitor prefers reduced
     motion, and the CSS is scoped to html.motion so the page is
     fully visible in that case. All animation is opacity and
     transform only — no layout thrash on a mid-range phone.
     ============================================================= */
  var MOTION = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Which elements reveal, and how they stagger inside a group. */
  var REVEAL = [
    ['.sec-eyebrow', null, 0],
    ['.sec-title', null, 60],
    ['.sec-sub', null, 120],
    ['.block', null, 90],
    ['.pill', 'scale', 60],
    ['.lineup', null, 0],
    ['.venue-shot', null, 90],
    ['.venue-facts > div', null, 50],
    ['.flow li', 'left', 70],
    ['.faq details', null, 40],
    ['.closer-tag', null, 0],
    ['.closer h3', null, 60],
    ['.closer p', null, 120],
    ['.closer .btn', null, 180],
    ['.closer-meta', null, 230]
    /* No footer entrance: it is the one band that can sit entirely
       inside the observer's bottom dead zone, and animating a footer
       buys nothing. */
  ];

  function markReveals() {
    REVEAL.forEach(function (rule) {
      var sel = rule[0], kind = rule[1], step = rule[2];
      document.querySelectorAll(sel).forEach(function (el, i) {
        el.setAttribute('data-reveal', kind || '');
        /* Stagger resets per group so a 10-item FAQ never waits 2s. */
        if (step) el.style.setProperty('--d', Math.min(i, 5) * step + 'ms');
      });
    });
  }

  function observeReveals() {
    var targets = document.querySelectorAll('[data-reveal]');
    if (!('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);       // one-shot: reveals don't re-hide on scroll up
      });
    }, { rootMargin: '0px 0px 40px 0px', threshold: 0 });
    targets.forEach(function (el) { io.observe(el); });
  }

  /* Hero glow drifts at a fraction of scroll speed. rAF-throttled. */
  function parallax() {
    var beams = document.querySelector('.beams');
    var floor = document.querySelector('.floor');
    if (!beams || !floor) return;
    var queued = false;
    function frame() {
      queued = false;
      var y = window.pageYOffset;
      if (y > window.innerHeight * 1.2) return;      // stop working off-screen
      beams.style.transform = 'translate3d(0,' + (y * 0.16).toFixed(1) + 'px,0)';
      floor.style.transform = 'perspective(560px) rotateX(58deg) translate3d(0,' + (y * -0.05).toFixed(1) + 'px,0)';
    }
    window.addEventListener('scroll', function () {
      if (!queued) { queued = true; requestAnimationFrame(frame); }
    }, { passive: true });
  }

  /* Waitlist counter counts up the first time it's seen. */
  function countUp() {
    if (!MOTION || countUp.done) return;
    var c = CFG.counter || {};
    if (!c.show || !c.total) return;                 // total is set only by liveCount()
    countUp.done = true;
    var el = $('counter-num'), target = Number(c.total), started = false;
    function run() {
      if (started) return;
      started = true;
      var t0 = performance.now(), dur = 1100;
      (function step(now) {
        var p = Math.min(1, (now - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.floor(target * eased).toLocaleString();
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = target.toLocaleString();
      })(t0);
    }
    if (!('IntersectionObserver' in window)) return run();
    var io = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { run(); io.disconnect(); }
    }, { threshold: 0.6 });
    io.observe($('counter'));
  }

  /* nav condense */
  function navShrink() {
    var queued = false, previous = null;
    function update() {
      queued = false;
      var scrolled = window.pageYOffset > 40;
      if (scrolled === previous) return;
      previous = scrolled;
      document.body.classList.toggle('scrolled', scrolled);
    }
    function onScroll() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
  }

  /* ---------- FAQ accordion ----------------------------------
     <details> can't tween its own height, so we take over the
     toggle and animate the answer with the Web Animations API.
     The element stays a real <details>/<summary>, so keyboard
     support, find-in-page and screen readers keep working — and
     with reduced motion we simply don't intercept the click. */
  function faq() {
    document.querySelectorAll('.faq details').forEach(function (d) {
      var summary = d.querySelector('summary');
      var body = d.querySelector('.a');
      if (!summary || !body) return;
      var running = null;

      summary.addEventListener('click', function (e) {
        if (!MOTION) return;                 // native instant toggle
        e.preventDefault();
        if (running) running.cancel();

        if (!d.open) {
          d.open = true;                     // must be open to measure
          var target = body.getBoundingClientRect().height;
          running = body.animate(
            { height: ['0px', target + 'px'], opacity: [0, 1] },
            { duration: 300, easing: 'cubic-bezier(.22,.61,.36,1)' }
          );
          running.onfinish = function () { running = null; };
        } else {
          var from = body.getBoundingClientRect().height;
          running = body.animate(
            { height: [from + 'px', '0px'], opacity: [1, 0] },
            { duration: 230, easing: 'cubic-bezier(.4,0,.7,.2)' }
          );
          running.onfinish = function () {
            d.open = false;                  // collapse only after it's closed
            running = null;
          };
        }
      });
    });
  }

  function motion() {
    navShrink();
    faq();
    if (!MOTION) return;
    document.documentElement.classList.add('motion');
    markReveals();
    observeReveals();
    parallax();
  }

  /* Official X9 sprite: 36 angles, repacked into a 6 by 6 grid.
     Load near the viewport; a matching still remains until ready. */
  function x9Rotation() {
    var host = $('x9-showcase'), canvas = $('x9-canvas');
    if (!host || !canvas || !window.PointerEvent) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var poster = $('x9-poster'), retry = $('x9-retry');
    var status = $('x9-view-status'), arrows = $('x9-rotate-buttons');
    var sprite = null, active = false, frame = 29, drag = null;
    $('x9-view-controls').hidden = false;

    function draw(value) {
      frame = ((value % 36) + 36) % 36;
      ctx.clearRect(0, 0, 750, 350);
      ctx.drawImage(sprite, (frame % 6) * 750, Math.floor(frame / 6) * 350, 750, 350, 0, 0, 750, 350);
      canvas.setAttribute('aria-valuenow', frame * 10);
      canvas.setAttribute('aria-valuetext', (frame * 10) + ' degrees');
    }
    function loadRotation() {
      retry.hidden = true;
      status.textContent = 'Loading 360° view…';
      var img = new Image();
      var timer = setTimeout(failed, 20000);
      function failed() {
        clearTimeout(timer);
        img.onload = img.onerror = null;
        retry.hidden = false;
        status.textContent = '360° view could not load. Try again.';
      }
      img.onerror = failed;
      img.onload = function () {
        clearTimeout(timer);
        if (img.naturalWidth !== 4500 || img.naturalHeight !== 2100) { failed(); return; }
        sprite = img;
        active = true;
        draw(frame);
        poster.hidden = true;
        canvas.hidden = false;
        arrows.hidden = false;
        status.textContent = '360° exterior view';
        $('x9-rotate-help').textContent = 'Drag or swipe to explore. Use the left and right arrow keys to rotate.';
        track('View360', { content: 'x9' });
      };
      img.src = 'image/x9/x9-360.webp';
    }
    retry.addEventListener('click', loadRotation);
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        if (entries.some(function (entry) { return entry.isIntersecting; })) {
          observer.disconnect();
          loadRotation();
        }
      }, { rootMargin: '250px' });
      observer.observe(host);
    } else loadRotation();
    $('x9-rotate-left').addEventListener('click', function () { draw(frame - 1); });
    $('x9-rotate-right').addEventListener('click', function () { draw(frame + 1); });
    canvas.addEventListener('keydown', function (e) {
      if (!active) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        draw(e.key === 'Home' ? 0 : e.key === 'End' ? 35 : frame + (e.key === 'ArrowRight' ? 1 : -1));
      }
    });
    canvas.addEventListener('pointerdown', function (e) {
      if (!active || !e.isPrimary || e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, frame: frame };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      var step = Math.max(5, canvas.getBoundingClientRect().width / 36);
      draw(drag.frame + Math.round((e.clientX - drag.x) / step));
    });
    function endDrag() { drag = null; }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);
  }

  /* ---------- boot ------------------------------------------- */
  x9Rotation();
  paintConfig();
  fillSelects();
  chips();
  flow();
  share();
  chrome();
  motion();
  countdown();
  track('PageView', UTM);
})();
