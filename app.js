'use strict';

const STORE_HIST = 'quickcric:matches';
const STORE_CURRENT = 'quickcric:current';
const STORE_AUDIO = 'quickcric:audio';
const STORE_INSTALL_DISMISSED = 'quickcric:install-dismissed';
const MAX_UNDO = 2;
const POLL_INTERVAL_MS = 3000;

const SIX_PHRASES = [
  'SIX! What a strike!',
  'MAXIMUM! That is enormous!',
  'SIX! Cleared the rope easily!',
  'SIX! Into the crowd!',
  'Massive hit, SIX runs!'
];
const FOUR_PHRASES = [
  'FOUR! Cracking shot!',
  'FOUR! Beautiful timing!',
  'FOUR! Through the gap!',
  'Boundary! FOUR runs!',
  'FOUR! Down the ground!'
];
const WICKET_PHRASES = [
  'OUT! What a wicket!',
  'WICKET! He has to walk!',
  'GOT HIM! That is OUT!',
  'OUT! Massive blow!',
  'WICKET! The bowler strikes!'
];
const DOT_PHRASES = ['Dot ball', 'No run', 'Defended solidly', 'Played and missed', 'Tight bowling'];
const SINGLE_PHRASES = ['Single taken', 'One run', 'Quick single', 'Pushed for one', 'Rotates the strike'];
const pickPhrase = (arr) => arr[Math.floor(Math.random() * arr.length)];

const audio = {
  enabled: (() => { try { return localStorage.getItem(STORE_AUDIO) !== 'off'; } catch { return true; } })(),
  ctx: null,
  voice: null,

  init() {
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      this.voice =
        voices.find(v => /en-(GB|IN|AU)/i.test(v.lang) && /male|daniel|google|british/i.test(v.name)) ||
        voices.find(v => /en-(GB|IN|AU)/i.test(v.lang)) ||
        voices.find(v => /^en/i.test(v.lang)) ||
        voices[0] || null;
    };
    pick();
    speechSynthesis.addEventListener?.('voiceschanged', pick);
  },

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem(STORE_AUDIO, this.enabled ? 'on' : 'off'); } catch {}
    if (!this.enabled && 'speechSynthesis' in window) speechSynthesis.cancel();
  },

  ensureCtx() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    return this.ctx;
  },

  speak(text, opts = {}) {
    if (!this.enabled || !('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = opts.rate ?? 1.1;
    u.pitch = opts.pitch ?? 1;
    u.volume = opts.volume ?? 1;
    speechSynthesis.speak(u);
  },

  async playFile(name) {
    if (!this.enabled) return false;
    try {
      if (this._cur) { try { this._cur.pause(); this._cur.currentTime = 0; } catch {} }
      const a = new Audio(`sounds/${name}.mp3`);
      a.volume = 0.8;
      this._cur = a;
      await a.play();
      return true;
    } catch { return false; }
  },

  fileForBall(d) {
    if (d.wicket) return 'wicket';
    if (d.extra) return null;
    if (d.runs === 6) return 'six';
    if (d.runs === 4) return 'four';
    if (d.runs === 2) return 'two';
    if (d.runs === 0) return 'dot';
    return null;
  },

  beep(freq, duration, type = 'sine', volume = 0.08) {
    if (!this.enabled) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(volume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    o.start();
    o.stop(ctx.currentTime + duration);
  },

  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.beep(f, 0.18, 'square', 0.09), i * 90));
  },

  thump() {
    this.beep(80, 0.3, 'sawtooth', 0.18);
    setTimeout(() => this.beep(60, 0.4, 'sawtooth', 0.12), 50);
  },

  cheer(durSec = 0.6, vol = 0.18) {
    if (!this.enabled) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * durSec), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = Math.pow(1 - i / data.length, 1.4);
      data[i] = (Math.random() * 2 - 1) * env * vol;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  },

  celebration() {
    const melody = [[523, 0.15], [659, 0.15], [784, 0.15], [659, 0.15], [784, 0.2], [1047, 0.5]];
    let t = 0;
    melody.forEach(([f, d]) => { setTimeout(() => this.beep(f, d, 'square', 0.1), t * 1000); t += d + 0.04; });
    setTimeout(() => this.cheer(1.2, 0.22), 200);
  },

  async onBall(d, freeHitWas) {
    if (!this.enabled) return;

    const file = this.fileForBall(d);
    if (file) {
      const played = await this.playFile(file);
      if (played) return;
    }

    if (d.wicket) this.thump();
    else if (d.runs === 6) { this.fanfare(); this.cheer(0.7, 0.2); }
    else if (d.runs === 4) this.cheer(0.5, 0.16);

    let phrase = '';
    if (d.wicket) phrase = pickPhrase(WICKET_PHRASES);
    else if (d.runs === 6) phrase = pickPhrase(SIX_PHRASES);
    else if (d.runs === 4) phrase = pickPhrase(FOUR_PHRASES);
    else if (d.extra === 'wd') phrase = d.runs > 0 ? `Wide, ${d.runs + 1} runs` : 'Wide ball';
    else if (d.extra === 'nb') phrase = d.runs > 0 ? `No ball, ${d.runs} runs. Free hit next ball.` : 'No ball! Free hit coming up.';
    else if (d.extra === 'lb') phrase = `${d.runs} leg ${d.runs > 1 ? 'byes' : 'bye'}`;
    else if (d.extra === 'b') phrase = `${d.runs} ${d.runs > 1 ? 'byes' : 'bye'}`;
    else if (d.runs === 0) phrase = pickPhrase(DOT_PHRASES);
    else if (d.runs === 1) phrase = freeHitWas ? 'Single on the free hit' : pickPhrase(SINGLE_PHRASES);
    else if (d.runs === 2) phrase = 'Two runs, well run';
    else if (d.runs === 3) phrase = 'Three runs, excellent running';
    else phrase = `${d.runs} runs`;
    this.speak(phrase);
  },

  onOverEnd() {
    if (!this.enabled) return;
    setTimeout(() => {
      this.playFile('over').then(p => { if (!p) this.speak('End of the over'); });
    }, 1600);
  },

  onMatchStart() {
    if (!this.enabled) return;
    this.playFile('start').then(p => { if (!p) this.speak('Match starts now!'); });
  },

  onMatchWin(text) {
    if (!this.enabled) return;
    this.playFile('winner').then(p => {
      if (!p) { this.celebration(); setTimeout(() => this.speak(text, { rate: 1, pitch: 1.05 }), 700); }
    });
  }
};

const install = {
  dismissed: (() => { try { return localStorage.getItem(STORE_INSTALL_DISMISSED) === '1'; } catch { return false; } })(),
  deferredPrompt: null,
  isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true;
  },
  isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent); },
  isAndroid() { return /Android/.test(navigator.userAgent); },
  shouldShow() { return !this.dismissed && !this.isStandalone(); },
  dismiss() {
    this.dismissed = true;
    try { localStorage.setItem(STORE_INSTALL_DISMISSED, '1'); } catch {}
  },
  defaultTab() { return this.isIOS() ? 'ios' : 'android'; },
  async tryNativePrompt() {
    if (!this.deferredPrompt) return false;
    this.deferredPrompt.prompt();
    try { await this.deferredPrompt.userChoice; } catch {}
    this.deferredPrompt = null;
    this.dismiss();
    return true;
  }
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  install.deferredPrompt = e;
  if (state.view === 'home') render();
});
window.addEventListener('appinstalled', () => {
  install.dismiss();
  if (state.view === 'home') render();
});

const state = {
  view: 'home',
  current: null,
  history: [],
  detail: null,
  shared: null,
  ball: emptyBall(),
  modal: null,
  toast: null,
  setup: { teamA: '', teamB: '', overs: 6, battingFirst: 'A' },
  loadingHistory: false,
  installTab: 'android',
};

function emptyBall() { return { runs: null, extra: null, wicket: false }; }

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtOvers = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;
const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
const fmtRate = (runs, balls) => balls === 0 ? '0.00' : ((runs / balls) * 6).toFixed(2);
const dbOn = () => !!(window.QCDB && window.QCDB.enabled);

function showToast(msg, ms = 1500) {
  state.toast = msg;
  render();
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { state.toast = null; render(); }, ms);
}

// ---------- Storage ----------
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORE_HIST) || '[]'); } catch { return []; }
}
function saveHistory(arr) {
  try { localStorage.setItem(STORE_HIST, JSON.stringify(arr)); } catch {}
}
function loadCurrent() {
  try { return JSON.parse(localStorage.getItem(STORE_CURRENT) || 'null'); } catch { return null; }
}
function saveCurrent(m) {
  if (m) {
    try { localStorage.setItem(STORE_CURRENT, JSON.stringify(m)); } catch {}
    if (dbOn()) window.QCDB.syncMatch(m);
  } else {
    try { localStorage.removeItem(STORE_CURRENT); } catch {}
  }
}

async function refreshHistory() {
  if (!dbOn()) return;
  state.loadingHistory = true;
  try {
    const remote = await window.QCDB.loadMatches();
    state.history = remote;
    saveHistory(remote);
  } catch (err) {
    console.warn('history fetch failed', err);
  } finally {
    state.loadingHistory = false;
    render();
  }
}

// ---------- Match factories ----------
function newBatter(name) {
  return { name: (name || '').trim() || 'Batter', runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: null };
}
function newBowler(name) {
  return { name: (name || '').trim() || 'Bowler', balls: 0, runs: 0, wickets: 0 };
}
function newInnings(batting, bowling) {
  return {
    batting, bowling,
    score: { runs: 0, wickets: 0, balls: 0, extras: 0 },
    batters: [], bowlers: [],
    striker: 0, nonStriker: 1, currentBowler: 0,
    ballLog: [],
    needNewBatter: false, needNewBowler: false,
    ended: false, endReason: null,
    target: null,
    freeHit: false,
  };
}
function newMatch(teamA, teamB, overs, battingFirst) {
  return {
    id: uid(),
    startedAt: Date.now(),
    endedAt: null,
    teams: { A: (teamA || '').trim() || 'Team A', B: (teamB || '').trim() || 'Team B' },
    overs,
    battingFirst,
    status: 'in_progress',
    result: '',
    innings: [],
    currentInnings: 0,
    undo: [],
  };
}

// ---------- Scoring core ----------
function decomposeBall(sel) {
  const runs = sel.runs ?? 0;
  const { extra, wicket } = sel;
  let totalRuns, batsmanRuns, bowlerConcedes, isLegalBall, extrasAdd;
  if (extra === 'wd') {
    totalRuns = 1 + runs; batsmanRuns = 0; bowlerConcedes = 1 + runs; isLegalBall = false; extrasAdd = 1 + runs;
  } else if (extra === 'nb') {
    totalRuns = 1 + runs; batsmanRuns = runs; bowlerConcedes = 1 + runs; isLegalBall = false; extrasAdd = 1;
  } else if (extra === 'lb' || extra === 'b') {
    totalRuns = runs; batsmanRuns = 0; bowlerConcedes = 0; isLegalBall = true; extrasAdd = runs;
  } else {
    totalRuns = runs; batsmanRuns = runs; bowlerConcedes = runs; isLegalBall = true; extrasAdd = 0;
  }
  return { runs, extra, wicket, totalRuns, batsmanRuns, bowlerConcedes, isLegalBall, extrasAdd };
}

function ballLabel(d) {
  const parts = [];
  if (d.runs) parts.push(d.runs);
  if (d.extra) parts.push(d.extra);
  if (d.wicket) parts.push('W');
  return parts.join('+') || '0';
}

function snapshotForUndo(m) {
  return clone({
    innings: m.innings,
    currentInnings: m.currentInnings,
    status: m.status,
    result: m.result,
  });
}

function recordBall(match, sel) {
  match.undo.push(snapshotForUndo(match));
  if (match.undo.length > MAX_UNDO) match.undo.shift();

  const inn = match.innings[match.currentInnings];
  const wasFreeHit = inn.freeHit;
  const d = decomposeBall(sel);
  const striker = inn.batters[inn.striker];
  const bowler = inn.bowlers[inn.currentBowler];

  striker.runs += d.batsmanRuns;
  if (d.batsmanRuns === 4) striker.fours += 1;
  if (d.batsmanRuns === 6) striker.sixes += 1;
  if (d.isLegalBall) striker.balls += 1;

  bowler.runs += d.bowlerConcedes;
  if (d.isLegalBall) bowler.balls += 1;

  inn.score.runs += d.totalRuns;
  inn.score.extras += d.extrasAdd;
  if (d.isLegalBall) inn.score.balls += 1;

  if (d.wicket) {
    striker.out = true;
    striker.dismissal = 'out';
    inn.score.wickets += 1;
    bowler.wickets += 1;
  }

  if (d.runs % 2 === 1) {
    [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
  }

  const overNo = Math.floor((inn.score.balls - (d.isLegalBall ? 1 : 0)) / 6);
  inn.ballLog.push({
    runs: d.runs, extra: d.extra, wicket: d.wicket, total: d.totalRuns,
    label: ballLabel(d), legal: d.isLegalBall, overNo,
    batter: striker.name, bowler: bowler.name,
  });

  const maxBalls = match.overs * 6;
  const target = (match.currentInnings === 1) ? inn.target : null;
  let endNow = false, reason = null;
  if (inn.score.balls >= maxBalls) { endNow = true; reason = 'overs'; }
  else if (inn.score.wickets >= 10) { endNow = true; reason = 'allout'; }
  else if (target != null && inn.score.runs >= target) { endNow = true; reason = 'chased'; }

  if (d.extra === 'nb') inn.freeHit = true;
  else if (d.isLegalBall) inn.freeHit = false;

  if (endNow) {
    inn.ended = true;
    inn.endReason = reason;
    inn.needNewBatter = false;
    inn.needNewBowler = false;
  } else {
    if (d.isLegalBall && inn.score.balls % 6 === 0) {
      [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
      inn.needNewBowler = true;
    }
    if (d.wicket) inn.needNewBatter = true;
  }

  audio.onBall(d, wasFreeHit);
  if (!endNow && d.isLegalBall && inn.score.balls % 6 === 0) audio.onOverEnd();
  saveCurrent(match);
}

function undoBall(match) {
  if (!match.undo.length) return false;
  const snap = match.undo.pop();
  match.innings = snap.innings;
  match.currentInnings = snap.currentInnings;
  match.status = snap.status;
  match.result = snap.result;
  saveCurrent(match);
  return true;
}

function addBatter(inn, name) {
  const idx = inn.batters.length;
  inn.batters.push(newBatter(name));
  if (inn.batters[inn.striker]?.out) inn.striker = idx;
  else if (inn.batters[inn.nonStriker]?.out) inn.nonStriker = idx;
  inn.needNewBatter = false;
}

function addBowler(inn, name) {
  const existing = inn.bowlers.findIndex(b => b.name.toLowerCase() === (name || '').trim().toLowerCase());
  if (existing >= 0) inn.currentBowler = existing;
  else {
    inn.currentBowler = inn.bowlers.length;
    inn.bowlers.push(newBowler(name));
  }
  inn.needNewBowler = false;
}

// ---------- Transitions ----------
function startMatch(teamA, teamB, overs, battingFirst) {
  state.current = newMatch(teamA, teamB, overs, battingFirst);
  state.view = 'innings-setup';
  saveCurrent(state.current);
}

function startInnings(strikerName, nonStrikerName, bowlerName) {
  const m = state.current;
  const isFirst = m.innings.length === 0;
  const batting = isFirst ? m.battingFirst : (m.battingFirst === 'A' ? 'B' : 'A');
  const bowling = batting === 'A' ? 'B' : 'A';
  const inn = newInnings(batting, bowling);
  inn.batters.push(newBatter(strikerName));
  inn.batters.push(newBatter(nonStrikerName));
  inn.bowlers.push(newBowler(bowlerName));
  if (!isFirst) inn.target = m.innings[0].score.runs + 1;
  m.innings.push(inn);
  m.currentInnings = m.innings.length - 1;
  m.undo = [];
  state.view = 'score';
  saveCurrent(m);
  if (isFirst) audio.onMatchStart();
}

function endInningsManually() {
  const inn = state.current.innings[state.current.currentInnings];
  inn.ended = true;
  inn.endReason = 'manual';
  inn.needNewBatter = false;
  inn.needNewBowler = false;
  saveCurrent(state.current);
}

function completeMatch() {
  const m = state.current;
  m.status = 'completed';
  m.endedAt = Date.now();
  m.result = computeResult(m);
  m.undo = [];

  if (dbOn()) {
    window.QCDB.upsertMatch(m).catch(err => console.warn('final sync failed', err));
  }
  state.history = [m, ...state.history.filter(x => x.id !== m.id)];
  saveHistory(state.history);

  state.detail = m;
  state.current = null;
  saveCurrent(null);
  state.view = 'result';
  audio.onMatchWin(m.result);
}

function computeResult(m) {
  if (m.innings.length < 2) return 'Match ended early';
  const i1 = m.innings[0], i2 = m.innings[1];
  const team2 = m.teams[i2.batting], team1 = m.teams[i1.batting];
  if (i2.score.runs > i1.score.runs) {
    const w = 10 - i2.score.wickets;
    return `${team2} won by ${w} wicket${w !== 1 ? 's' : ''}`;
  } else if (i1.score.runs > i2.score.runs) {
    const r = i1.score.runs - i2.score.runs;
    return `${team1} won by ${r} run${r !== 1 ? 's' : ''}`;
  }
  return 'Match tied';
}

function afterBall() {
  const inn = state.current.innings[state.current.currentInnings];
  if (inn.ended) {
    afterInningsEnd();
  } else if (inn.needNewBatter) {
    state.modal = { type: 'newBatter' };
    render();
  } else if (inn.needNewBowler) {
    state.modal = { type: 'newBowler' };
    render();
  } else {
    render();
  }
}

function afterInningsEnd() {
  const m = state.current;
  if (m.currentInnings === 0) {
    state.view = 'innings-break';
    render();
  } else {
    completeMatch();
    render();
  }
}

// ---------- Selection helpers ----------
function pickBall(field, value) {
  const b = state.ball;
  if (field === 'runs' && b.runs === value) { b.runs = null; render(); return; }
  if (field === 'extra' && b.extra === value) { b.extra = null; render(); return; }
  if (field === 'wicket' && b.wicket) { b.wicket = false; render(); return; }

  const presentCount = (b.runs != null ? 1 : 0) + (b.extra ? 1 : 0) + (b.wicket ? 1 : 0);
  const targetPresent = field === 'runs' ? (b.runs != null) : field === 'extra' ? !!b.extra : !!b.wicket;
  if (!targetPresent && presentCount >= 2) {
    showToast('Max 2 selections');
    return;
  }
  if (field === 'runs') b.runs = value;
  else if (field === 'extra') b.extra = value;
  else if (field === 'wicket') b.wicket = true;
  render();
}

function commitBall() {
  const b = state.ball;
  if (b.runs == null && !b.extra && !b.wicket) return;
  recordBall(state.current, { runs: b.runs ?? 0, extra: b.extra, wicket: b.wicket });
  state.ball = emptyBall();
  afterBall();
}

// ---------- Share + viewer ----------
function shareCurrent() {
  const m = state.shared || state.detail || state.current;
  if (!m) return;
  let url;
  if (dbOn()) {
    url = `${location.origin}${location.pathname}#m=${encodeURIComponent(m.id)}`;
    if (m === state.current) {
      window.QCDB.upsertMatch(m).catch(() => {});
    }
  } else {
    const snap = clone(m); delete snap.undo; snap.shared = true;
    const json = JSON.stringify(snap);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    url = `${location.origin}${location.pathname}#v=${b64}`;
  }
  if (navigator.share) {
    navigator.share({ title: 'QuickCric scorecard', url }).catch(() => copyShare(url));
  } else {
    copyShare(url);
  }
}
function copyShare(url) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(
      () => showToast('Link copied'),
      () => prompt('Copy this link:', url)
    );
  } else {
    prompt('Copy this link:', url);
  }
}
function parseSharedFromHash() {
  const idMatch = location.hash.match(/^#m=([^&]+)/);
  if (idMatch) return { kind: 'id', id: decodeURIComponent(idMatch[1]) };
  const snapMatch = location.hash.match(/^#v=([A-Za-z0-9+/=_-]+)/);
  if (snapMatch) {
    try {
      const json = decodeURIComponent(escape(atob(snapMatch[1])));
      return { kind: 'snapshot', match: JSON.parse(json) };
    } catch { /* fall through */ }
  }
  return null;
}

let pollTimer = null;
function startPolling(id) {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const r = await window.QCDB.loadMatch(id);
      if (!r) return;
      if (JSON.stringify(r.match) !== JSON.stringify(state.shared)) {
        state.shared = r.match;
        render();
      }
    } catch { /* ignore */ }
  }, POLL_INTERVAL_MS);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function loadSharedById(id) {
  if (!dbOn()) {
    showToast('This link needs cloud setup');
    state.view = 'home';
    state.shared = null;
    render();
    return;
  }
  try {
    const r = await window.QCDB.loadMatch(id);
    if (!r) {
      showToast('Match not found');
      state.view = 'home';
      state.shared = null;
      render();
      return;
    }
    state.shared = r.match;
    state.view = 'view';
    render();
    startPolling(id);
  } catch (err) {
    console.warn(err);
    showToast('Failed to load');
    state.view = 'home';
    render();
  }
}

// ---------- Renderers ----------
function render() {
  const root = $('app');
  let html = '';
  let view = state.shared ? 'view' : state.view;
  switch (view) {
    case 'home': html = renderHome(); break;
    case 'setup': html = renderSetup(); break;
    case 'innings-setup': html = renderInningsSetup(); break;
    case 'score': html = renderScore(); break;
    case 'innings-break': html = renderInningsBreak(); break;
    case 'result': html = renderDetail(); break;
    case 'history': html = renderHistory(); break;
    case 'detail': html = renderDetail(); break;
    case 'view': html = renderSharedView(); break;
    default: html = renderHome();
  }
  if (state.modal) html += renderModal();
  if (state.toast) html += `<div class="toast">${esc(state.toast)}</div>`;
  root.innerHTML = html;

  if (state.modal?.type === 'newBatter') $('new-batter-input')?.focus();
  else if (state.modal?.type === 'newBowler') $('new-bowler-input')?.focus();
}

function renderHome() {
  const cur = state.current;
  const items = state.history.filter(m => !cur || m.id !== cur.id).slice(0, 30);
  return `
    <div class="screen">
      <div class="home-hero">
        <h1>Quick<span class="accent">Cric</span></h1>
        <p>Tap a ball outcome. Skip the setup. Casual cricket scoring that gets out of your way.</p>
      </div>
      <div class="home-actions">
        ${cur ? `
          <button class="cta resume" data-action="resume">
            <span>Resume ${esc(cur.teams.A)} vs ${esc(cur.teams.B)}</span>
            <span class="arrow">→</span>
          </button>` : ''}
        <button class="cta" data-action="new-match">
          <span>${cur ? 'Start new match' : 'Start a match'}</span>
          <span class="arrow">→</span>
        </button>
      </div>
      ${!dbOn() ? `
        <div class="config-warn">
          <strong>Cloud sync off.</strong> Open <code>config.js</code> and add your Supabase keys to enable share links and cross-device history.
        </div>` : ''}
      <div class="section-label">
        Past matches
        ${state.loadingHistory ? `<span class="loading-dot"></span>` : ''}
      </div>
      ${items.length === 0
        ? `<div class="empty">${state.loadingHistory ? 'Loading…' : 'No matches yet. Your first one shows up here when you finish.'}</div>`
        : `<div class="match-list scroll">${items.map(matchCard).join('')}</div>`}
      ${install.shouldShow() ? `
        <div class="install-banner">
          <button class="install-main" data-action="install-show">
            <div class="install-text">
              <strong>Install on your phone</strong>
              <span>Use QuickCric like a regular app · offline-ready</span>
            </div>
            <span class="install-arrow">→</span>
          </button>
          <button class="install-x" data-action="install-dismiss" aria-label="Dismiss">×</button>
        </div>` : ''}
    </div>
  `;
}

function matchCard(m) {
  const i1 = m.innings[0], i2 = m.innings[1];
  const inProg = m.status !== 'completed';
  return `
    <button class="match-card ${inProg ? 'in-progress' : ''}" data-action="view-detail" data-match-id="${esc(m.id)}">
      <div class="date">${fmtDate(m.startedAt)}</div>
      <div class="teams">${esc(m.teams.A)} vs ${esc(m.teams.B)}</div>
      ${i1 ? `<div class="innings-row"><span>${esc(m.teams[i1.batting])}</span><span>${i1.score.runs}/${i1.score.wickets} (${fmtOvers(i1.score.balls)})</span></div>` : ''}
      ${i2 ? `<div class="innings-row"><span>${esc(m.teams[i2.batting])}</span><span>${i2.score.runs}/${i2.score.wickets} (${fmtOvers(i2.score.balls)})</span></div>` : ''}
      <div class="result">${esc(m.result || 'Match in progress')}</div>
    </button>
  `;
}

function renderSetup() {
  const s = state.setup;
  const presets = [5, 6, 8, 10, 15, 20];
  return `
    <div class="screen">
      <div class="topbar">
        <div class="left">
          <button class="icon-btn ghost" data-action="back-home">←</button>
          <span class="title">New match</span>
        </div>
        <div class="right"></div>
      </div>
      <div class="setup-body">
        <div class="field">
          <label>Teams · tap circle to set who bats first</label>
          <div class="team-row">
            <input id="team-a-input" type="text" placeholder="Team A" value="${esc(s.teamA)}" />
            <button class="bat-toggle ${s.battingFirst === 'A' ? 'active' : ''}" data-action="bat-first" data-team="A" aria-label="Team A bats first">A</button>
          </div>
          <div class="team-row">
            <input id="team-b-input" type="text" placeholder="Team B" value="${esc(s.teamB)}" />
            <button class="bat-toggle ${s.battingFirst === 'B' ? 'active' : ''}" data-action="bat-first" data-team="B" aria-label="Team B bats first">B</button>
          </div>
        </div>
        <div class="toss-row">
          <button class="toss-btn" data-action="toss">⟳ Toss a coin</button>
        </div>
        <div class="field">
          <label>Overs per innings</label>
          <div class="overs-counter">
            <button class="counter-btn" data-action="overs-step" data-delta="-1" aria-label="Decrease overs" ${s.overs <= 1 ? 'disabled' : ''}>−</button>
            <span class="counter-value">${s.overs}</span>
            <button class="counter-btn" data-action="overs-step" data-delta="1" aria-label="Increase overs" ${s.overs >= 99 ? 'disabled' : ''}>+</button>
          </div>
          <div class="chip-row chip-row-presets">
            ${presets.map(o => `<button class="chip ${s.overs === o ? 'selected' : ''}" data-action="overs-pick" data-overs="${o}">${o}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="bottom-bar">
        <button class="btn btn-primary" data-action="start-match">Start match</button>
      </div>
    </div>
  `;
}

function renderInningsSetup() {
  const m = state.current;
  const isFirst = m.innings.length === 0;
  const batting = isFirst ? m.battingFirst : (m.battingFirst === 'A' ? 'B' : 'A');
  const team = m.teams[batting];
  const target = !isFirst ? m.innings[0].score.runs + 1 : null;
  return `
    <div class="screen">
      <div class="topbar">
        <div class="left">
          <span class="title">${isFirst ? 'Innings 1' : 'Innings 2'}</span>
        </div>
        <div class="right"></div>
      </div>
      <div class="setup-head">
        <h2>${esc(team)} batting</h2>
        ${target ? `<p>Chasing ${target} in ${m.overs} overs</p>` : `<p>${m.overs} overs to bat</p>`}
      </div>
      <div class="setup-body">
        <div class="field">
          <label>Striker · faces the first ball</label>
          <input id="striker-input" type="text" placeholder="First batter" autocomplete="off" />
        </div>
        <div class="field">
          <label>Non-striker</label>
          <input id="non-striker-input" type="text" placeholder="Second batter" autocomplete="off" />
        </div>
        <div class="field">
          <label>Bowler</label>
          <input id="bowler-input" type="text" placeholder="Opening bowler" autocomplete="off" />
        </div>
      </div>
      <div class="bottom-bar">
        <button class="btn btn-primary" data-action="start-innings">Start innings</button>
      </div>
    </div>
  `;
}

function renderScore() {
  const m = state.current;
  const inn = m.innings[m.currentInnings];
  const team = m.teams[inn.batting];
  const striker = inn.batters[inn.striker];
  const nonStriker = inn.batters[inn.nonStriker];
  const bowler = inn.bowlers[inn.currentBowler];
  const rate = fmtRate(inn.score.runs, inn.score.balls);

  const ballsInCurrentOver = inn.score.balls % 6;
  const currentOver = Math.floor(inn.score.balls / 6);
  const overToShow = (ballsInCurrentOver === 0 && inn.score.balls > 0) ? currentOver - 1 : currentOver;
  const overBalls = inn.ballLog.filter(b => b.overNo === overToShow);
  const overSlots = [];
  for (let i = 0; i < 6; i++) overSlots[i] = overBalls[i] || null;

  let targetPill = '';
  if (m.currentInnings === 1 && inn.target != null) {
    const need = inn.target - inn.score.runs;
    const ballsLeft = (m.overs * 6) - inn.score.balls;
    if (need > 0) targetPill = `Need ${need} from ${ballsLeft} balls`;
  }

  const b = state.ball;
  const selCount = (b.runs != null ? 1 : 0) + (b.extra ? 1 : 0) + (b.wicket ? 1 : 0);
  const canNext = selCount > 0;
  const canUndo = m.undo.length > 0;

  return `
    <div class="screen">
      <div class="topbar">
        <div class="left">
          <button class="icon-btn" data-action="home">←</button>
          <span class="title">${esc(team)}</span>
        </div>
        <div class="right">
          <button class="icon-btn audio-btn ${audio.enabled ? '' : 'muted'}" data-action="toggle-audio" title="${audio.enabled ? 'Mute sound' : 'Enable sound'}" aria-label="Toggle sound">♪</button>
          <button class="icon-btn" data-action="share" title="Share">↗</button>
        </div>
      </div>
      <div class="hero">
        <div class="team">${esc(team)}${m.currentInnings === 1 ? ' · 2nd innings' : ''}</div>
        <div class="rate">scoring at ${rate} per over</div>
        <div class="score-line">${inn.score.runs}/${inn.score.wickets}</div>
        <div class="overs">${fmtOvers(inn.score.balls)} / ${m.overs}.0 overs</div>
        ${targetPill ? `<div class="target">${esc(targetPill)}</div>` : ''}
      </div>
      <div class="stats">
        <div class="row">
          <span class="name striker">${esc(striker.name)}</span>
          <span class="figs">${striker.runs} (${striker.balls})</span>
        </div>
        <div class="row bowler-row">
          <span class="name">${esc(bowler.name)}</span>
          <span class="figs">${fmtOvers(bowler.balls)} · ${bowler.runs}/${bowler.wickets}</span>
        </div>
        <div class="row">
          <span class="name">${esc(nonStriker.name)}</span>
          <span class="figs">${nonStriker.runs} (${nonStriker.balls})</span>
        </div>
        <div class="row"></div>
      </div>
      <div class="over-strip">
        <div class="heading">This over</div>
        <div class="balls">${overSlots.map(renderBallPill).join('')}</div>
      </div>
      ${inn.freeHit ? `<div class="free-hit-banner"><span class="fh-dot"></span>Free hit · next ball<span class="fh-dot"></span></div>` : ''}
      <div class="undo-row">
        <button data-action="undo" ${canUndo ? '' : 'disabled'}>↶ Undo last ball</button>
      </div>
      <div class="actions">
        <div class="input-cluster">
          <button class="wkt-btn ${b.wicket ? 'selected' : ''}" data-action="select-wkt">WKT</button>
          <div class="extras-panel">
            <div class="heading">Extras</div>
            <div class="row">
              ${['wd','nb','lb','b'].map(e => `<button class="extra-btn ${b.extra === e ? 'selected' : ''}" data-action="select-extra" data-extra="${e}">${e}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="runs-grid">
          <button class="run-btn dot ${b.runs === 0 ? 'selected' : ''}" data-action="select-run" data-runs="0">DOT</button>
          ${[1,2,3,4,5,6].map(n => `<button class="run-btn ${b.runs === n ? 'selected' : ''}" data-action="select-run" data-runs="${n}">${n}</button>`).join('')}
        </div>
        <div class="next-bar">
          <button class="next-ball" data-action="next-ball" ${canNext ? '' : 'disabled'}>Next ball</button>
        </div>
        <div class="foot-links">
          <button data-action="end-innings">All out · end innings</button>
        </div>
      </div>
    </div>
  `;
}

function renderBallPill(b) {
  if (!b) return `<div class="ball-pill empty">·</div>`;
  let cls = 'ball-pill';
  if (b.extra) cls += ' extra';
  else if (b.wicket) cls += ' wkt';
  else if (b.runs === 4) cls += ' run4';
  else if (b.runs === 6) cls += ' run6';
  else if (b.runs === 0) cls += ' dot';
  return `<div class="${cls}">${esc(b.label)}</div>`;
}

function renderInningsBreak() {
  const m = state.current;
  const i1 = m.innings[0];
  const battingNext = m.battingFirst === 'A' ? 'B' : 'A';
  return `
    <div class="screen break-screen">
      <div class="topbar">
        <div class="left">
          <button class="icon-btn" data-action="home">←</button>
          <span class="title">Innings break</span>
        </div>
        <div class="right">
          <button class="icon-btn" data-action="share" title="Share">↗</button>
        </div>
      </div>
      <div class="break-hero">
        <div class="label">End of innings 1</div>
        <div class="team">${esc(m.teams[i1.batting])}</div>
        <div class="score-big">${i1.score.runs}/${i1.score.wickets}</div>
        <div>${fmtOvers(i1.score.balls)} overs · RR ${fmtRate(i1.score.runs, i1.score.balls)}</div>
        <div class="target-pill">${esc(m.teams[battingNext])} need ${i1.score.runs + 1} to win</div>
      </div>
      <div class="scorecard">
        ${renderInningsCard(m, i1, 'Innings 1')}
      </div>
      <div class="bottom-bar">
        <button class="btn btn-primary" data-action="start-next-innings">Start 2nd innings</button>
      </div>
    </div>
  `;
}

function renderDetail() {
  const m = state.detail || state.current;
  if (!m) return renderHome();
  const isJustEnded = state.view === 'result';
  const isHistoricalView = state.view === 'detail' && m.status === 'completed';
  return `
    <div class="screen result-screen">
      <div class="topbar">
        <div class="left">
          <button class="icon-btn" data-action="back-home">←</button>
          <span class="title">Match summary</span>
        </div>
        <div class="right">
          <button class="icon-btn" data-action="share" title="Share">↗</button>
        </div>
      </div>
      <div class="result-banner">
        <div class="label">${m.status === 'completed' ? 'Result' : 'Status'}</div>
        <div class="winner">${esc(m.result || 'Match in progress')}</div>
        <div class="margin">${esc(m.teams.A)} vs ${esc(m.teams.B)} · ${fmtDate(m.startedAt)} · ${m.overs} overs</div>
      </div>
      ${renderTopPerformers(m)}
      <div class="scorecard">
        ${m.innings.map((inn, i) => renderInningsCard(m, inn, `Innings ${i+1}`)).join('')}
      </div>
      ${isJustEnded ? `
        <div class="bottom-bar">
          <button class="btn btn-primary" data-action="back-home">End match</button>
        </div>` : ''}
      ${isHistoricalView ? `
        <div class="bottom-bar">
          <button class="btn btn-danger" data-action="delete-match" data-match-id="${esc(m.id)}">Delete match</button>
        </div>` : ''}
    </div>
  `;
}

function renderInningsCard(m, inn, title) {
  const teamName = m.teams[inn.batting];
  return `
    <div class="inn-card">
      <div class="head">
        <span>${esc(title)} · ${esc(teamName)}</span>
        <span class="total">${inn.score.runs}/${inn.score.wickets} (${fmtOvers(inn.score.balls)})</span>
      </div>
      <table>
        <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr></thead>
        <tbody>
          ${inn.batters.map(b => `
            <tr>
              <td>
                <div>${esc(b.name)}</div>
                <div class="${b.out ? 'out' : 'not-out'}">${b.out ? 'out' : 'not out'}</div>
              </td>
              <td>${b.runs}</td>
              <td>${b.balls}</td>
              <td>${b.fours}</td>
              <td>${b.sixes}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <table>
        <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th></tr></thead>
        <tbody>
          ${inn.bowlers.map(b => `
            <tr>
              <td>${esc(b.name)}</td>
              <td>${fmtOvers(b.balls)}</td>
              <td>${b.runs}</td>
              <td>${b.wickets}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderTopPerformers(m) {
  const allBatters = m.innings.flatMap(inn => inn.batters);
  const allBowlers = m.innings.flatMap(inn => inn.bowlers);
  const topBat = allBatters.slice().sort((a, b) => b.runs - a.runs)[0];
  const topBowl = allBowlers.slice().sort((a, b) => {
    if (b.wickets !== a.wickets) return b.wickets - a.wickets;
    return a.runs - b.runs;
  })[0];
  if (!topBat?.balls && !topBowl?.balls) return '';
  return `
    <div class="top-performers">
      <div class="heading">Top performers</div>
      ${topBat?.balls ? `<div class="perf-row"><span class="role">Top scorer</span><span><strong>${esc(topBat.name)}</strong> · ${topBat.runs}(${topBat.balls})</span></div>` : ''}
      ${topBowl?.balls ? `<div class="perf-row"><span class="role">Best bowler</span><span><strong>${esc(topBowl.name)}</strong> · ${topBowl.wickets}/${topBowl.runs} (${fmtOvers(topBowl.balls)})</span></div>` : ''}
    </div>
  `;
}

function renderHistory() {
  return `
    <div class="screen">
      <div class="topbar">
        <div class="left">
          <button class="icon-btn" data-action="back-home">←</button>
          <span class="title">Past matches</span>
        </div>
        <div class="right"></div>
      </div>
      <div class="scroll" style="padding: 16px;">
        ${state.history.length === 0
          ? `<div class="empty">No matches yet.</div>`
          : `<div class="match-list" style="padding: 0;">${state.history.map(matchCard).join('')}</div>`}
      </div>
    </div>
  `;
}

function renderSharedView() {
  const m = state.shared;
  if (!m) {
    return `
      <div class="screen">
        <div class="view-banner">Shared scorecard</div>
        <div class="setup-body" style="align-items: center; justify-content: center; text-align: center;">
          <p style="opacity: 0.7;">Loading…</p>
        </div>
      </div>
    `;
  }
  return `
    <div class="screen result-screen">
      <div class="view-banner">${m.status === 'completed' ? 'Shared scorecard · read-only' : 'Live scorecard · updates every 3s'}</div>
      <div class="topbar">
        <div class="left">
          <span class="title">${esc(m.teams.A)} vs ${esc(m.teams.B)}</span>
        </div>
        <div class="right">
          <button class="icon-btn" data-action="back-home" title="Close">×</button>
        </div>
      </div>
      <div class="result-banner">
        <div class="label">${m.status === 'completed' ? 'Result' : 'Live'}</div>
        <div class="winner">${esc(m.result || liveSnapshotLine(m))}</div>
        <div class="margin">${fmtDate(m.startedAt)} · ${m.overs} overs</div>
      </div>
      ${renderTopPerformers(m)}
      <div class="scorecard">
        ${m.innings.map((inn, i) => renderInningsCard(m, inn, `Innings ${i+1}`)).join('')}
      </div>
    </div>
  `;
}

function liveSnapshotLine(m) {
  const inn = m.innings[m.currentInnings];
  if (!inn) return 'Yet to start';
  return `${m.teams[inn.batting]} ${inn.score.runs}/${inn.score.wickets} (${fmtOvers(inn.score.balls)})`;
}

function renderInstallModal() {
  const tab = state.installTab;
  return `
    <div class="modal-bg">
      <div class="modal install-modal">
        <h3>Install QuickCric on your phone</h3>
        <p>Get full-screen scoring, faster launches, and works offline.</p>
        <div class="platform-tabs">
          <button class="tab ${tab === 'ios' ? 'active' : ''}" data-action="install-tab" data-tab="ios">iPhone · iPad</button>
          <button class="tab ${tab === 'android' ? 'active' : ''}" data-action="install-tab" data-tab="android">Android</button>
        </div>
        ${tab === 'ios' ? `
          <ol class="install-steps">
            <li>Open this page in <strong>Safari</strong> (not Chrome)</li>
            <li>Tap the <strong>Share button</strong> at the bottom · the square with an up arrow</li>
            <li>Scroll and tap <strong>Add to Home Screen</strong></li>
            <li>Tap <strong>Add</strong> in the top right</li>
          </ol>
          <div class="install-note">QuickCric now opens like a regular app — no browser bars, works offline.</div>
        ` : `
          <ol class="install-steps">
            <li>Open this page in <strong>Chrome</strong></li>
            <li>Tap the <strong>⋮ menu</strong> in the top-right corner</li>
            <li>Tap <strong>Install app</strong> · or <strong>Add to Home Screen</strong></li>
            <li>Tap <strong>Install</strong> in the confirmation popup</li>
          </ol>
          ${install.deferredPrompt ? `
            <button class="btn btn-primary" data-action="install-now">Install now</button>
          ` : ''}
        `}
        <button class="btn btn-ghost" data-action="close-install">Done</button>
      </div>
    </div>
  `;
}

function renderModal() {
  if (state.modal.type === 'install') return renderInstallModal();
  if (state.modal.type === 'newBatter') {
    return `
      <div class="modal-bg">
        <div class="modal">
          <h3>Next batter</h3>
          <p>A wicket fell. Who's coming in?</p>
          <input id="new-batter-input" type="text" placeholder="Batter name" autocomplete="off" />
          <button class="btn btn-primary" data-action="confirm-new-batter">Continue</button>
        </div>
      </div>
    `;
  }
  if (state.modal.type === 'newBowler') {
    const inn = state.current.innings[state.current.currentInnings];
    const current = inn.bowlers[inn.currentBowler]?.name;
    const recent = [...new Set(inn.bowlers.map(b => b.name))].filter(n => n !== current);
    return `
      <div class="modal-bg">
        <div class="modal">
          <h3>Next bowler</h3>
          <p>Over complete. Who's bowling next?</p>
          ${recent.length ? `<div class="recents">${recent.map(n => `<button class="recent" data-action="recent-bowler" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
          <input id="new-bowler-input" type="text" placeholder="Bowler name" autocomplete="off" />
          <button class="btn btn-primary" data-action="confirm-new-bowler">Continue</button>
        </div>
      </div>
    `;
  }
  return '';
}

// ---------- Action dispatch ----------
function handle(action, dataset) {
  switch (action) {
    case 'home': state.view = 'home'; state.detail = null; render(); break;
    case 'history': state.view = 'history'; render(); break;
    case 'back-home':
      if (state.shared) {
        state.shared = null;
        stopPolling();
        history.replaceState(null, '', location.pathname);
      }
      state.view = 'home'; state.detail = null; state.modal = null; render();
      if (dbOn()) refreshHistory();
      break;
    case 'new-match':
      state.view = 'setup';
      state.setup = { teamA: '', teamB: '', overs: 6, battingFirst: 'A' };
      render(); break;
    case 'resume': {
      const m = state.current;
      if (!m) { state.view = 'home'; render(); break; }
      const inn = m.innings[m.currentInnings];
      if (!inn) state.view = 'innings-setup';
      else if (inn.ended && m.currentInnings === 0) state.view = 'innings-break';
      else state.view = 'score';
      render(); break;
    }
    case 'bat-first':
      state.setup.battingFirst = dataset.team; render(); break;
    case 'overs-pick':
      state.setup.overs = parseInt(dataset.overs, 10); render(); break;
    case 'overs-step': {
      const next = state.setup.overs + parseInt(dataset.delta, 10);
      if (next >= 1 && next <= 99) state.setup.overs = next;
      render(); break;
    }
    case 'toss': {
      state.setup.battingFirst = Math.random() < 0.5 ? 'A' : 'B';
      const name = state.setup.battingFirst === 'A'
        ? (state.setup.teamA || 'Team A')
        : (state.setup.teamB || 'Team B');
      render();
      showToast(`${name} bats first`);
      break;
    }
    case 'select-run': pickBall('runs', parseInt(dataset.runs, 10)); break;
    case 'select-extra': pickBall('extra', dataset.extra); break;
    case 'select-wkt': pickBall('wicket', true); break;
    case 'next-ball': commitBall(); break;
    case 'undo':
      if (undoBall(state.current)) { state.ball = emptyBall(); render(); }
      break;
    case 'end-innings':
      if (confirm('End this innings now?')) { endInningsManually(); afterInningsEnd(); }
      break;
    case 'start-next-innings': state.view = 'innings-setup'; render(); break;
    case 'share': shareCurrent(); break;
    case 'toggle-audio': audio.toggle(); render(); break;
    case 'install-show':
      state.installTab = install.defaultTab();
      state.modal = { type: 'install' };
      render(); break;
    case 'install-dismiss':
      install.dismiss(); render(); break;
    case 'install-tab':
      state.installTab = dataset.tab; render(); break;
    case 'install-now':
      install.tryNativePrompt().then(() => { state.modal = null; render(); });
      break;
    case 'close-install':
      state.modal = null; render(); break;
    case 'view-detail': {
      const m = state.history.find(x => x.id === dataset.matchId);
      if (m) { state.detail = m; state.view = 'detail'; render(); }
      break;
    }
    case 'delete-match':
      if (confirm('Delete this match?')) {
        const id = dataset.matchId;
        if (dbOn()) window.QCDB.deleteMatch(id).catch(err => console.warn(err));
        state.history = state.history.filter(x => x.id !== id);
        saveHistory(state.history);
        state.detail = null;
        state.view = 'home'; render();
      }
      break;
  }
}

// ---------- Init & wiring ----------
async function init() {
  const parsed = parseSharedFromHash();
  if (parsed) {
    if (parsed.kind === 'snapshot') {
      state.shared = parsed.match;
      state.view = 'view';
      render();
      return;
    }
    if (parsed.kind === 'id') {
      state.view = 'view';
      render();
      await loadSharedById(parsed.id);
      return;
    }
  }

  state.current = loadCurrent();
  state.history = loadHistory();
  state.view = 'home';
  render();

  if (dbOn()) refreshHistory();
}

document.addEventListener('DOMContentLoaded', () => {
  audio.init();
  init();
  const app = $('app');

  app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;

    if (action === 'start-match') {
      const a = $('team-a-input')?.value || '';
      const b = $('team-b-input')?.value || '';
      state.setup.teamA = a;
      state.setup.teamB = b;
      if (!a.trim() || !b.trim()) return showToast('Enter both team names');
      startMatch(a, b, state.setup.overs, state.setup.battingFirst);
      render();
      return;
    }
    if (action === 'start-innings') {
      const s = $('striker-input')?.value || '';
      const ns = $('non-striker-input')?.value || '';
      const bw = $('bowler-input')?.value || '';
      if (!s.trim() || !ns.trim() || !bw.trim()) return showToast('Need both batters and the bowler');
      startInnings(s, ns, bw);
      render();
      return;
    }
    if (action === 'confirm-new-batter') {
      const v = $('new-batter-input')?.value || '';
      if (!v.trim()) return showToast('Name required');
      const inn = state.current.innings[state.current.currentInnings];
      addBatter(inn, v);
      saveCurrent(state.current);
      state.modal = inn.needNewBowler ? { type: 'newBowler' } : null;
      render();
      return;
    }
    if (action === 'confirm-new-bowler') {
      const v = $('new-bowler-input')?.value || '';
      if (!v.trim()) return showToast('Name required');
      addBowler(state.current.innings[state.current.currentInnings], v);
      saveCurrent(state.current);
      state.modal = null;
      render();
      return;
    }
    if (action === 'recent-bowler') {
      const input = $('new-bowler-input');
      if (input) { input.value = t.dataset.name; input.focus(); }
      return;
    }
    handle(action, t.dataset);
  });

  app.addEventListener('input', (e) => {
    if (state.view !== 'setup') return;
    if (e.target.id === 'team-a-input') state.setup.teamA = e.target.value;
    if (e.target.id === 'team-b-input') state.setup.teamB = e.target.value;
  });
});
