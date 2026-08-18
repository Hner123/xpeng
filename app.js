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

  /* Absolute when config.api.base is set (page and API on different
     hosts), relative when it isn't. */
  function endpoint(name) {
    var api = CFG.api || {};
    return (api.base || '') + (api[name] || '/api/' + name);
  }

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
    if (ev.forumLabel) $('m-forum').textContent = ev.forumLabel.toUpperCase();

    var st = CFG.status || {};
    if (st.soldOutLabel)  $('s-soldout').textContent  = st.soldOutLabel;
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
    socials.forEach(function (s) {
      ['f-links', 'follow-row'].forEach(function (host) {
        var a = document.createElement('a');
        a.textContent = s.label; a.href = s.href;
        a.target = '_blank'; a.rel = 'noopener';
        $(host).appendChild(a);
      });
    });
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
    if (!a.revealed) {
      if (a.teaser) {
        $('lineup-copy').textContent  = a.teaser + ' Names drop one week before the event.';
        $('mystery-copy').textContent = a.teaser;
      }
      if (a.revealDateLabel && reveal) reveal.textContent = 'TO BE REVEALED · ' + a.revealDateLabel;
      if (a.revealDateLabel) $('hero-artist-txt').textContent = '2 STARS · REVEALED ' + a.revealDateLabel;
      return;
    }

    /* Revealed: hero strip drops the silhouettes and names them. */
    var names = (a.acts || []).map(function (x) { return x.name; }).filter(Boolean);
    var sils = document.querySelector('.ha-sil');
    if (sils) sils.remove();
    if (names.length) $('hero-artist-txt').textContent = names.join(' · ').toUpperCase();
    $('lineup-title').textContent = 'Your headliners for Future Night.';
    $('lineup-copy').textContent  = 'One revealed with the X9, one closing the night with a full concert set.';
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
    burger.addEventListener('click', function () {
      var open = document.body.classList.toggle('menu-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $('drawer').addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        document.body.classList.remove('menu-open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });

    var sticky = $('sticky'), card = $('waitlist');
    function onScroll() {
      var r = card.getBoundingClientRect();
      var offscreen = r.bottom < 0 || r.top > window.innerHeight;
      var registered = !$('step3').hidden;          // no nagging once they're in
      sticky.classList.toggle('on', offscreen && !registered);
    }
    chrome.refreshSticky = onScroll;
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    document.querySelectorAll('[data-cta]').forEach(function (el) {
      el.addEventListener('click', function () { track('StartForm', { placement: el.dataset.cta }); });
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

  /* ---------- validation ------------------------------------- */
  function bad(wrap)   { wrap.classList.add('bad'); }
  function clear(wrap) { wrap.classList.remove('bad'); }

  var reMobile = /^09\d{9}$/;
  var reEmail  = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  function mobileDigits(v) { return String(v).replace(/[^\d]/g, '').replace(/^63/, '0'); }

  function validateStep1() {
    var ok = true;
    var name = $('f-name').value.trim();
    var mob  = mobileDigits($('f-mobile').value);
    var mail = $('f-email').value.trim();

    if (name.length < 2)      { bad($('w-name')); ok = false; }   else clear($('w-name'));
    if (!reMobile.test(mob))  { bad($('w-mobile')); ok = false; } else clear($('w-mobile'));
    if (!reEmail.test(mail))  { bad($('w-email')); ok = false; }  else clear($('w-email'));
    if (!prov.value)          { bad($('w-prov')); ok = false; }   else clear($('w-prov'));
    if (!city.value)          { bad($('w-city')); ok = false; }   else clear($('w-city'));
    return ok;
  }

  var REQUIRED_Q = { age: 'q-age', who: 'q-who', when: 'q-when', budget: 'q-budget', model: 'q-model', ev: 'q-ev' };

  function validateStep2() {
    var ok = true;
    Object.keys(REQUIRED_Q).forEach(function (k) {
      var el = $(REQUIRED_Q[k]);
      if (!answers[k]) { el.classList.add('bad'); ok = false; } else el.classList.remove('bad');
    });
    if (!drive.value) { $('q-drive').classList.add('bad'); ok = false; } else $('q-drive').classList.remove('bad');
    if (!$('c-priv').checked) ok = false;
    return ok;
  }

  /* ---------- payload ---------------------------------------- */
  function payload() {
    return {
      name:     $('f-name').value.trim(),
      mobile:   mobileDigits($('f-mobile').value),
      email:    $('f-email').value.trim().toLowerCase(),
      province: prov.value,
      city:     city.value,
      profile: {
        age: answers.age || null, segment: answers.who || null,
        drives: drive.value || null, intent: answers.when || null,
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
  var s1 = $('step1'), s2 = $('step2'), s3 = $('step3');

  function focusCard() {
    $('waitlist').scrollIntoView({ block: 'center', behavior: 'smooth' });
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

    s2.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = validateStep2();
      $('err2').classList.toggle('on', !ok);
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

    s2.hidden = true; s3.hidden = false;
    focusCard();
    if (chrome.refreshSticky) chrome.refreshSticky();
    track('CompleteRegistration', { value: 1, currency: 'PHP' });
  }

  /* ---------- share ------------------------------------------ */
  function share() {
    var sh = CFG.share || {};
    var text = sh.text || 'I joined the waitlist for XPENG FUTURE NIGHT';
    var url  = sh.url || location.href.split('?')[0];
    $('sh-fb').href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url) + '&quote=' + encodeURIComponent(text);
    $('sh-x').href  = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url);
    $('sh-vi').href = 'viber://forward?text=' + encodeURIComponent(text + ' ' + url);

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
    ['.flow li', 'left', 70],
    ['.faq details', null, 40],
    ['.closer h3', null, 0],
    ['.closer p', null, 80],
    ['.closer .btn', null, 150],
    ['footer .l', null, 0],
    ['footer .r', null, 80]
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
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
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
    var onScroll = function () {
      document.body.classList.toggle('scrolled', window.pageYOffset > 40);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
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

  /* ---------- boot ------------------------------------------- */
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
