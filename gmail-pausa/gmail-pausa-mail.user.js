// ==UserScript==
// @name         Pausa Mail in Gmail
// @namespace    speedydecal.giulio
// @version      1.0.1
// @description  Pulsante "Pausa Mail" nella barra di Gmail: avvia la pausa, cambia il ritardo, "Sono rientrato", rilascia tutto.
// @match        https://mail.google.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // Web app Apps Script "Pausa Mail" (Esegui come: Me, Accesso: Solo io).
  var APP_URL = 'INCOLLA-QUI-URL-APP-WEB';
  // Chiave fissata con ?api=init: senza questa la web app rifiuta i comandi.
  var API_KEY = 'INCOLLA-QUI-LA-TUA-CHIAVE-DI-ALMENO-20-CARATTERI';
  var POLL_MS = 60000;

  var last = null, busy = false, lastErr = '';

  // ───────────── chiamate alla web app ─────────────

  function api(action, params) {
    var q = 'api=' + encodeURIComponent(action) + '&key=' + encodeURIComponent(API_KEY);
    Object.keys(params || {}).forEach(function (k) { q += '&' + k + '=' + encodeURIComponent(params[k]); });
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET',
        url: APP_URL + '?' + q + '&_=' + Date.now(),
        timeout: 90000,
        onload: function (r) {
          var data;
          try { data = JSON.parse(r.responseText); } catch (e) {
            return reject(new Error(r.status === 200
              ? 'Risposta non valida (sei connesso con geomgiulio99@gmail.com?)'
              : 'HTTP ' + r.status));
          }
          if (!data.ok) return reject(new Error(data.error || 'Errore'));
          resolve(data.status);
        },
        onerror: function () { reject(new Error('Rete non raggiungibile')); },
        ontimeout: function () { reject(new Error('Timeout')); }
      });
    });
  }

  // ───────────── formattazione ─────────────

  function fmtDur(m) {
    m = Number(m);
    var h = Math.floor(m / 60), r = m % 60;
    if (!h) return r + ' min';
    return h + ' h' + (r ? ' ' + r + ' min' : '');
  }
  function fmtTime(ms) {
    return new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  // Gmail impone Trusted Types: niente innerHTML, solo createElement.
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  // ───────────── stile ─────────────

  GM_addStyle([
    '#pm-wrap{position:relative;display:inline-flex;align-items:center;margin:0 8px;z-index:1000;}',
    '#pm-wrap.pm-float{position:fixed;top:14px;right:330px;}',
    '#pm-pill{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border-radius:18px;border:1px solid #dadce0;background:#fff;color:#3c4043;font:500 14px/1 "Google Sans",Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap;}',
    '#pm-pill:hover{background:#f1f3f4;}',
    '#pm-pill.pm-pause{background:#fef7e0;border-color:#f9ab00;color:#7a4f01;}',
    '#pm-pill.pm-drain{background:#e6f4ea;border-color:#34a853;color:#0d652d;}',
    '#pm-pill.pm-err{border-color:#d93025;}',
    '#pm-panel{position:absolute;top:44px;right:0;width:320px;background:#fff;color:#202124;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.25);padding:16px;font:14px/1.4 Roboto,Arial,sans-serif;display:none;}',
    '#pm-panel.pm-open{display:block;}',
    '#pm-panel h3{margin:0 0 10px;font:500 16px "Google Sans",Roboto,sans-serif;}',
    '.pm-status{background:#f1f3f4;border-radius:8px;padding:10px;margin-bottom:12px;}',
    '.pm-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;color:#fff;background:#5f6368;margin-bottom:6px;}',
    '.pm-badge.pm-pause{background:#f9ab00;color:#000;}.pm-badge.pm-drain{background:#34a853;color:#000;}',
    '.pm-sec{border-top:1px solid #e8eaed;padding-top:10px;margin-top:10px;}',
    '.pm-lbl{font-weight:500;}.pm-val{font-size:22px;font-weight:700;color:#1a73e8;margin:2px 0;}',
    '.pm-hint{color:#5f6368;font-size:12px;}',
    '#pm-panel input[type=range]{display:block;width:100%;box-sizing:border-box;margin:4px 0;accent-color:#1a73e8;}',
    '#pm-panel,#pm-panel *{box-sizing:border-box;}',
    '#pm-panel .pm-btn{display:block;width:100%;padding:9px;margin-top:8px;border:0;border-radius:8px;font:500 14px Roboto,sans-serif;cursor:pointer;}',
    '#pm-panel .pm-btn:disabled{opacity:.5;cursor:default;}',
    '.pm-blue{background:#1a73e8;color:#fff;}.pm-green{background:#34a853;color:#fff;}',
    '.pm-ghost{background:transparent;border:1px solid #dadce0;color:#5f6368;}',
    '.pm-errtxt{color:#d93025;font-size:12px;margin-top:8px;}',
    '.pm-bar{height:6px;background:#e8eaed;border-radius:3px;overflow:hidden;margin-top:6px;}',
    '.pm-bar>div{height:100%;background:#34a853;}'
  ].join('\n'));

  // ───────────── interfaccia ─────────────

  var ui = {};

  function build() {
    ui.pill = el('button', { id: 'pm-pill', type: 'button', title: 'Pausa Mail', onclick: togglePanel }, ['⏸ Pausa Mail']);

    ui.status = el('div', { class: 'pm-status', text: 'Caricamento…' });

    ui.delay = el('input', { type: 'range', min: '10', max: '360', step: '10', value: '60', oninput: labels });
    ui.delayVal = el('div', { class: 'pm-val' });
    ui.delayHint = el('div', { class: 'pm-hint' });
    ui.btnStart = el('button', { class: 'pm-btn pm-blue', type: 'button', text: 'Avvia pausa',
      onclick: function () { run('start', { delay: ui.delay.value }); } });

    ui.drain = el('input', { type: 'range', min: '5', max: '120', step: '5', value: '15', oninput: labels });
    ui.drainVal = el('div', { class: 'pm-val' });
    ui.btnBack = el('button', { class: 'pm-btn pm-green', type: 'button', text: '🏠 Sono rientrato',
      onclick: function () { run('back', { drain: ui.drain.value }); } });

    ui.btnAll = el('button', { class: 'pm-btn pm-ghost', type: 'button', text: 'Rilascia tutto adesso',
      onclick: function () {
        if (confirm('Rimettere subito tutte le mail in attesa nella Posta in arrivo?')) run('releaseAll');
      } });
    ui.err = el('div', { class: 'pm-errtxt' });

    ui.panel = el('div', { id: 'pm-panel' }, [
      el('h3', { text: '⏸ Pausa Mail' }),
      ui.status,
      el('div', {}, [el('div', { class: 'pm-lbl', text: 'Ritardo mail' }), ui.delayVal, ui.delay, ui.delayHint, ui.btnStart]),
      el('div', { class: 'pm-sec' }, [el('div', { class: 'pm-lbl', text: 'Rientro: ricevi la coda in' }), ui.drainVal, ui.drain, ui.btnBack]),
      el('div', { class: 'pm-sec' }, [ui.btnAll, ui.err])
    ]);
    ui.panel.addEventListener('click', function (e) { e.stopPropagation(); });

    ui.wrap = el('div', { id: 'pm-wrap' }, [ui.pill, ui.panel]);
    document.addEventListener('click', function (e) {
      if (ui.wrap && !ui.wrap.contains(e.target)) ui.panel.classList.remove('pm-open');
    });
    labels();
  }

  /** Mette il pulsante nella barra in alto, prima delle icone Supporto/Impostazioni. */
  function place() {
    if (!ui.wrap) build();
    if (document.contains(ui.wrap) && !ui.wrap.classList.contains('pm-float')) return;
    // fila di icone in alto a destra: <div flex> > <div> > <a aria-label="Assistenza">
    var anchor = document.querySelector('header a[aria-label="Assistenza"], header a[aria-label="Supporto"],' +
      ' header a[aria-label="Support"], header a[aria-label="Impostazioni"], header a[aria-label="Settings"]');
    var slot = anchor && anchor.parentElement;
    var parent = slot && slot.parentElement;
    if (parent) {
      ui.wrap.classList.remove('pm-float');
      parent.insertBefore(ui.wrap, slot);
    } else if (!document.contains(ui.wrap)) {
      ui.wrap.classList.add('pm-float');
      document.body.appendChild(ui.wrap);
    }
  }

  function labels() {
    ui.delayVal.textContent = fmtDur(ui.delay.value);
    ui.delayHint.textContent = 'Una mail che arriva adesso la vedrai alle ' + fmtTime(Date.now() + ui.delay.value * 60000);
    ui.drainVal.textContent = fmtDur(ui.drain.value);
    ui.btnStart.textContent = last && last.mode === 'pause' ? 'Aggiorna ritardo' : 'Avvia pausa';
  }

  function render(s) {
    last = s;
    lastErr = '';
    ui.err.textContent = '';
    ui.pill.classList.remove('pm-pause', 'pm-drain', 'pm-err');
    while (ui.status.firstChild) ui.status.removeChild(ui.status.firstChild);

    if (s.mode === 'pause') {
      ui.pill.classList.add('pm-pause');
      ui.pill.textContent = '⏸ In pausa · ' + fmtDur(s.delayMin) + (s.pending ? ' · ' + s.pending : '');
      ui.pill.title = 'Pausa Mail: ritardo ' + fmtDur(s.delayMin) + ', ' + s.pending + ' mail in attesa';
      ui.status.appendChild(el('span', { class: 'pm-badge pm-pause', text: 'IN PAUSA' }));
      ui.status.appendChild(el('div', {}, ['Ritardo attivo: ', el('b', { text: fmtDur(s.delayMin) })]));
      ui.status.appendChild(el('div', {}, ['Mail in attesa: ', el('b', { text: String(s.pending) })]));
      if (s.nextRelease) ui.status.appendChild(el('div', {}, ['Prossima consegna: ', el('b', { text: fmtTime(s.nextRelease) })]));
      ui.delay.value = s.delayMin;
    } else if (s.mode === 'drain') {
      var pct = s.drainTotal ? Math.round(100 * s.drainReleased / s.drainTotal) : 100;
      ui.pill.classList.add('pm-drain');
      ui.pill.textContent = '🏠 Rientro ' + s.drainReleased + '/' + s.drainTotal;
      ui.pill.title = 'Pausa Mail: consegna della coda entro le ' + fmtTime(s.drainEnd);
      ui.status.appendChild(el('span', { class: 'pm-badge pm-drain', text: 'RIENTRO IN CORSO' }));
      ui.status.appendChild(el('div', {}, ['Consegnate ', el('b', { text: s.drainReleased + ' / ' + s.drainTotal })]));
      ui.status.appendChild(el('div', {}, ['Tutto consegnato entro le ', el('b', { text: fmtTime(s.drainEnd) })]));
      var bar = el('div', { class: 'pm-bar' }, [el('div', { style: 'width:' + pct + '%' })]);
      ui.status.appendChild(bar);
    } else {
      ui.pill.textContent = '⏸ Pausa Mail' + (s.pending ? ' · ' + s.pending : '');
      ui.pill.title = 'Pausa Mail: le mail arrivano normalmente';
      ui.status.appendChild(el('span', { class: 'pm-badge', text: 'NORMALE' }));
      ui.status.appendChild(el('div', { text: 'Le mail arrivano normalmente.' }));
      if (s.pending) ui.status.appendChild(el('div', {}, ['In attesa: ', el('b', { text: String(s.pending) })]));
    }
    setButtons(false);
    labels();
  }

  function setButtons(disabled) {
    ui.btnStart.disabled = disabled;
    ui.btnBack.disabled = disabled || (!!last && last.mode === 'off' && !last.pending);
    ui.btnAll.disabled = disabled || (!!last && last.mode === 'off' && !last.pending);
  }

  function showError(e) {
    lastErr = e.message;
    ui.err.textContent = 'Errore: ' + e.message;
    ui.pill.classList.add('pm-err');
    ui.pill.title = 'Pausa Mail: ' + e.message;
    if (!last) ui.status.textContent = 'Stato non disponibile.';
    setButtons(false);
  }

  function run(action, params) {
    if (busy) return;
    busy = true;
    setButtons(true);
    ui.err.textContent = 'Attendere…';
    api(action, params).then(render, showError).then(function () { busy = false; });
  }

  function refresh() {
    if (busy || document.hidden) return;
    api('status').then(render, showError);
  }

  function togglePanel(e) {
    e.stopPropagation();
    var open = ui.panel.classList.toggle('pm-open');
    if (open) { labels(); refresh(); }
  }

  // Gmail ricostruisce la barra: ricontrollo periodico del posizionamento.
  place();
  setInterval(place, 2000);
  refresh();
  setInterval(refresh, POLL_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
})();
