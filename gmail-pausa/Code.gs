/**
 * Pausa Mail — ritardo mobile per Gmail.
 *
 * Durante la pausa un filtro Gmail toglie ogni mail in arrivo dalla Posta in arrivo
 * e le mette l'etichetta LABEL_NAME (nessuna notifica, resta NON LETTA).
 * Ogni minuto tick() rimette in Posta in arrivo le mail per cui
 *   orario di ricezione + ritardo <= adesso.
 * "Sono rientrato" toglie il filtro e smaltisce la coda in ordine cronologico,
 * distribuita uniformemente nei minuti scelti.
 *
 * Richiede il servizio avanzato "Gmail API" (identificatore: Gmail).
 */

var LABEL_NAME = '⏸ In attesa';
var MIN_DELAY = 10, MAX_DELAY = 360;   // minuti
var MIN_DRAIN = 5, MAX_DRAIN = 120;    // minuti
var DEFAULT_DRAIN = 15;

var P_STATE = 'state';     // JSON dello stato
var P_META = 'm_';         // m_<msgId>  = "<internalDate>|<threadId>"
var P_HIDDEN = 'h_';       // h_<threadId> = JSON [msgId,...] tolti dalla Posta in arrivo

// ───────────────────────── Web app ─────────────────────────

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Pausa Mail')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ───────────────────────── Azioni (chiamate dalla pagina) ─────────────────────────

/** Avvia la pausa o, se già attiva, aggiorna solo il ritardo. */
function startPause(delayMin) {
  return withLock_(function () {
    var st = getState_();
    st.delayMin = clamp_(delayMin, MIN_DELAY, MAX_DELAY);
    if (!st.active) {
      st.active = true;
      st.since = Date.now();
    }
    st.drain = null;               // se stavi smaltendo, torni in pausa
    ensureFilter_(st);
    ensureTrigger_();
    saveState_(st);
    return statusOf_(st);
  });
}

/** "Sono rientrato": smaltisce la coda in drainMin minuti. */
function comeBack(drainMin) {
  return withLock_(function () {
    var st = getState_();
    removeFilter_(st);
    st.active = false;
    var pending = listPending_();
    if (pending.length === 0) {
      finish_(st);
      return statusOf_(st);
    }
    var d = clamp_(drainMin || DEFAULT_DRAIN, MIN_DRAIN, MAX_DRAIN);
    st.drain = { start: Date.now(), end: Date.now() + d * 60000, total: pending.length, released: 0 };
    ensureTrigger_();
    saveState_(st);
    processQueue_(st);   // eventuale prima mail subito
    saveState_(st);
    return statusOf_(st);
  });
}

/** Emergenza: rimette tutto in Posta in arrivo subito e chiude tutto. */
function releaseAllNow() {
  return withLock_(function () {
    var st = getState_();
    removeFilter_(st);
    var pending = listPending_();
    release_(pending);
    finish_(st);
    return statusOf_(st);
  });
}

function getStatus() {
  return statusOf_(getState_());
}

// ───────────────────────── Trigger ogni minuto ─────────────────────────

function tick() {
  withLock_(function () {
    var st = getState_();
    if (!st.active && !st.drain) {
      // Nessuna pausa: rilascia eventuali residui e spegni il trigger.
      release_(listPending_());
      finish_(st);
      return;
    }
    if (st.active) ensureFilter_(st);   // ricrea il filtro se è sparito
    processQueue_(st);
    if (st.drain && (Date.now() >= st.drain.end || listPending_().length === 0)) {
      release_(listPending_());
      finish_(st);
      return;
    }
    saveState_(st);
  });
}

// ───────────────────────── Logica della coda ─────────────────────────

function processQueue_(st) {
  var pending = listPending_();          // ordinate dalla più vecchia
  if (pending.length === 0) return;

  var now = Date.now();
  var delayMs = (st.delayMin || MIN_DELAY) * 60000;
  var due = 0;
  while (due < pending.length && pending[due].date + delayMs <= now) due++;

  var k = due;
  if (st.drain) {
    var span = st.drain.end - st.drain.start;
    var target = now >= st.drain.end ? Infinity
      : Math.ceil(st.drain.total * (now - st.drain.start) / span);
    k = Math.max(k, Math.min(pending.length, target - st.drain.released));
  }
  if (k <= 0) return;
  var batch = pending.slice(0, k);
  release_(batch);
  if (st.drain) st.drain.released += batch.length;
}

/**
 * Mail in attesa, dalla più vecchia alla più recente: [{id, threadId, date, labels}].
 * I metadati sono in cache nelle proprietà per non rileggerli ogni minuto.
 */
function listPending_() {
  var labelId = getLabelId_();
  var ids = [], token;
  do {
    var res = Gmail.Users.Messages.list('me', {
      labelIds: [labelId], maxResults: 500, pageToken: token, includeSpamTrash: true
    });
    (res.messages || []).forEach(function (m) { ids.push(m.id); });
    token = res.nextPageToken;
  } while (token);

  var props = PropertiesService.getUserProperties();
  var all = props.getProperties();
  var keep = {}, out = [], toSave = {};
  ids.forEach(function (id) {
    keep[P_META + id] = true;
    var cached = all[P_META + id];
    var date, threadId;
    if (cached) {
      var p = cached.split('|');
      date = Number(p[0]); threadId = p[1];
    } else {
      var m = Gmail.Users.Messages.get('me', id, { format: 'minimal' });
      if ((m.labelIds || []).indexOf('SENT') >= 0) {
        // una mail inviata da te non va ritardata: togli solo l'etichetta
        Gmail.Users.Messages.modify({ removeLabelIds: [labelId] }, 'me', id);
        return;
      }
      date = Number(m.internalDate); threadId = m.threadId;
      toSave[P_META + id] = date + '|' + threadId;
    }
    out.push({ id: id, threadId: threadId, date: date, isNew: !cached });
  });
  if (Object.keys(toSave).length) props.setProperties(toSave);
  // pulizia cache di mail non più in attesa (lette/spostate/eliminate a mano)
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(P_META) === 0 && !keep[k]) props.deleteProperty(k);
  });
  out.sort(function (a, b) { return a.date - b.date; });
  hideThreadSiblings_(out.filter(function (p) { return p.isNew; }), out);
  return out;
}

/**
 * Rimette in Posta in arrivo i messaggi indicati (restano NON letti).
 * Messaggi inviati da te / spam / cestino: si toglie solo l'etichetta.
 */
function release_(batch) {
  if (!batch.length) return;
  var labelId = getLabelId_();
  var props = PropertiesService.getUserProperties();
  var toInbox = [], onlyUnlabel = [], threads = {};

  batch.forEach(function (p) {
    var labels = [];
    try {
      labels = Gmail.Users.Messages.get('me', p.id, { format: 'minimal' }).labelIds || [];
    } catch (e) { /* messaggio eliminato definitivamente */ return; }
    var skip = labels.indexOf('SENT') >= 0 || labels.indexOf('SPAM') >= 0 || labels.indexOf('TRASH') >= 0;
    (skip ? onlyUnlabel : toInbox).push(p.id);
    threads[p.threadId] = true;
  });

  chunk_(toInbox, 1000).forEach(function (ids) {
    Gmail.Users.Messages.batchModify({ ids: ids, addLabelIds: ['INBOX'], removeLabelIds: [labelId] }, 'me');
  });
  chunk_(onlyUnlabel, 1000).forEach(function (ids) {
    Gmail.Users.Messages.batchModify({ ids: ids, removeLabelIds: [labelId] }, 'me');
  });

  // Riporta in Posta in arrivo i vecchi messaggi delle stesse conversazioni.
  Object.keys(threads).forEach(function (t) {
    var raw = props.getProperty(P_HIDDEN + t);
    if (raw) {
      var ids = JSON.parse(raw);
      if (ids.length) Gmail.Users.Messages.batchModify({ ids: ids, addLabelIds: ['INBOX'] }, 'me');
      props.deleteProperty(P_HIDDEN + t);
    }
  });
  batch.forEach(function (p) { props.deleteProperty(P_META + p.id); });
}

/**
 * Se una mail in attesa è la risposta a una conversazione già in Posta in arrivo,
 * la conversazione verrebbe mostrata (con la nuova risposta dentro).
 * Per evitarlo si tolgono temporaneamente dalla Posta in arrivo i messaggi
 * precedenti e si ripristinano al rilascio.
 */
function hideThreadSiblings_(fresh, pending) {
  if (!fresh.length) return;
  var props = PropertiesService.getUserProperties();
  var pendingIds = {};
  pending.forEach(function (p) { pendingIds[p.id] = true; });
  var seen = {};
  fresh.forEach(function (p) {
    if (seen[p.threadId]) return;
    seen[p.threadId] = true;
    var th = Gmail.Users.Threads.get('me', p.threadId, { format: 'minimal' });
    var toHide = (th.messages || []).filter(function (m) {
      return !pendingIds[m.id] && (m.labelIds || []).indexOf('INBOX') >= 0;
    }).map(function (m) { return m.id; });
    if (!toHide.length) return;
    Gmail.Users.Messages.batchModify({ ids: toHide, removeLabelIds: ['INBOX'] }, 'me');
    var key = P_HIDDEN + p.threadId;
    var prev = JSON.parse(props.getProperty(key) || '[]');
    props.setProperty(key, JSON.stringify(prev.concat(toHide)));
  });
}

// ───────────────────────── Filtro, etichetta, trigger ─────────────────────────

function getLabelId_() {
  var cache = CacheService.getUserCache();
  var id = cache.get('labelId');
  if (id) return id;
  var labels = Gmail.Users.Labels.list('me').labels || [];
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].name === LABEL_NAME) { id = labels[i].id; break; }
  }
  if (!id) {
    id = Gmail.Users.Labels.create({
      name: LABEL_NAME, labelListVisibility: 'labelShow', messageListVisibility: 'show'
    }, 'me').id;
  }
  cache.put('labelId', id, 21600);
  return id;
}

/** Crea (se manca) il filtro che intercetta TUTTE le mail in arrivo. */
function ensureFilter_(st) {
  var labelId = getLabelId_();
  var filters = Gmail.Users.Settings.Filters.list('me').filter || [];
  var mine = filters.filter(function (f) {
    return f.action && (f.action.addLabelIds || []).indexOf(labelId) >= 0;
  });
  if (mine.length) { st.filterId = mine[0].id; return; }
  var action = { addLabelIds: [labelId], removeLabelIds: ['INBOX'] };
  // "dimensione > 1 byte" = qualunque mail. Riserva: "non contiene <parola impossibile>".
  var criteriaOptions = [
    { size: 1, sizeComparison: 'larger' },
    { negatedQuery: 'zzqxpausamailnessunamail' }
  ];
  var lastErr;
  for (var i = 0; i < criteriaOptions.length; i++) {
    try {
      st.filterId = Gmail.Users.Settings.Filters.create({ criteria: criteriaOptions[i], action: action }, 'me').id;
      return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** Cancella tutti i filtri che applicano la nostra etichetta. */
function removeFilter_(st) {
  var labelId = getLabelId_();
  var filters = Gmail.Users.Settings.Filters.list('me').filter || [];
  filters.forEach(function (f) {
    if (f.action && (f.action.addLabelIds || []).indexOf(labelId) >= 0) {
      Gmail.Users.Settings.Filters.remove('me', f.id);
    }
  });
  st.filterId = null;
}

function ensureTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'tick'; });
  if (!exists) ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
}

function removeTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
}

/** Fine di tutto: nessun filtro, nessun trigger, stato pulito. */
function finish_(st) {
  removeFilter_(st);
  // ripristina conversazioni eventualmente rimaste nascoste
  var props = PropertiesService.getUserProperties();
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(P_HIDDEN) === 0) {
      var ids = JSON.parse(all[k]);
      if (ids.length) Gmail.Users.Messages.batchModify({ ids: ids, addLabelIds: ['INBOX'] }, 'me');
      props.deleteProperty(k);
    }
  });
  st.active = false;
  st.drain = null;
  st.since = null;
  saveState_(st);
  removeTrigger_();
}

// ───────────────────────── Stato ─────────────────────────

function getState_() {
  var raw = PropertiesService.getUserProperties().getProperty(P_STATE);
  var st = raw ? JSON.parse(raw) : {};
  if (!st.delayMin) st.delayMin = 60;
  return st;
}

function saveState_(st) {
  PropertiesService.getUserProperties().setProperty(P_STATE, JSON.stringify(st));
}

function statusOf_(st) {
  var pending = listPending_();
  var now = Date.now();
  var next = null;
  if (pending.length) {
    next = st.drain ? null : pending[0].date + st.delayMin * 60000;
  }
  return {
    mode: st.drain ? 'drain' : (st.active ? 'pause' : 'off'),
    delayMin: st.delayMin,
    pending: pending.length,
    oldest: pending.length ? pending[0].date : null,
    nextRelease: next,
    drainEnd: st.drain ? st.drain.end : null,
    drainReleased: st.drain ? st.drain.released : 0,
    drainTotal: st.drain ? st.drain.total : 0,
    now: now
  };
}

// ───────────────────────── Utilità ─────────────────────────

function withLock_(fn) {
  var lock = LockService.getUserLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function clamp_(v, lo, hi) {
  v = Math.round(Number(v));
  if (isNaN(v)) v = lo;
  return Math.min(hi, Math.max(lo, v));
}

function chunk_(arr, n) {
  var out = [];
  for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
