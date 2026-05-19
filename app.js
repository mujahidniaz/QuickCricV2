'use strict';

const STORE_HIST = 'quickcric:matches';
const STORE_CURRENT = 'quickcric:current';
const STORE_AUDIO = 'quickcric:audio';
const STORE_INSTALL_DISMISSED = 'quickcric:install-dismissed';
const STORE_DEVICE_ID = 'quickcric:device-id';
const MAX_UNDO = 2;
const POLL_INTERVAL_MS = 3000;
const IN_PROGRESS_TTL_MS = 6 * 60 * 60 * 1000;

const DEVICE_ID = (() => {
  let id = '';
  try { id = localStorage.getItem(STORE_DEVICE_ID) || ''; } catch { }
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem(STORE_DEVICE_ID, id); } catch { }
  }
  return id;
})();

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
    try { localStorage.setItem(STORE_AUDIO, this.enabled ? 'on' : 'off'); } catch { }
    if (!this.enabled) {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      if (this._cur) {
        try { this._cur.pause(); this._cur.currentTime = 0; } catch { }
        this._cur = null;
      }
    }
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

  async playFile(name, maxSeconds) {
    if (!this.enabled) return false;
    try {
      if (this._cur) { try { this._cur.pause(); this._cur.currentTime = 0; } catch { } }
      const a = new Audio(`sounds/${name}.mp3`);
      a.volume = 0.8;
      this._cur = a;
      await a.play();
      if (maxSeconds) {
        setTimeout(() => {
          try { if (!a.paused) { a.pause(); a.currentTime = 0; } } catch { }
        }, maxSeconds * 1000);
      }
      return true;
    } catch { return false; }
  },

  fileForBall(d) {
    if (d.wicket) return { name: 'wicket' };
    if (d.extra && d.extra !== 'nb') return null;
    if (d.runs === 6) return { name: 'winner', maxSeconds: 2.5 };
    if (d.runs === 4) return { name: 'four' };
    if (d.runs === 2) return { name: 'two' };
    if (d.runs === 0 && !d.extra) return { name: 'dot' };
    return null;
  },

  playAfterCurrent(name, gapMs = 200) {
    if (!this.enabled) return;
    const cur = this._cur;
    const play = () => this.playFile(name);
    if (cur && !cur.ended && !cur.paused) {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        cur.removeEventListener('ended', finish);
        cur.removeEventListener('error', finish);
        setTimeout(play, gapMs);
      };
      cur.addEventListener('ended', finish);
      cur.addEventListener('error', finish);
      setTimeout(finish, 5000);
    } else {
      setTimeout(play, gapMs);
    }
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
    let playedFile = false;
    if (file) {
      playedFile = await this.playFile(file.name, file.maxSeconds);
    }

    if (!playedFile) {
      if (d.wicket) this.thump();
      else if (d.runs === 6) { this.fanfare(); this.cheer(0.7, 0.2); }
      else if (d.runs === 4) this.cheer(0.5, 0.16);
    }

    if (d.extra === 'nb') this.playAfterCurrent('noball');

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
    const playOver = () => {
      this.playFile('over').then(p => { if (!p) this.speak('End of the over'); });
    };
    const cur = this._cur;
    if (cur && !cur.ended && !cur.paused) {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        cur.removeEventListener('ended', finish);
        cur.removeEventListener('error', finish);
        setTimeout(playOver, 300);
      };
      cur.addEventListener('ended', finish);
      cur.addEventListener('error', finish);
      setTimeout(finish, 5000);
    } else {
      setTimeout(playOver, 1200);
    }
  },

  onMatchStart() {
    if (!this.enabled) return;
    this.playFile('start', 10).then(p => { if (!p) this.speak('Match starts now!'); });
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
    try { localStorage.setItem(STORE_INSTALL_DISMISSED, '1'); } catch { }
  },
  defaultTab() { return this.isIOS() ? 'ios' : 'android'; },
  async tryNativePrompt() {
    if (!this.deferredPrompt) return false;
    this.deferredPrompt.prompt();
    try { await this.deferredPrompt.userChoice; } catch { }
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
  historyFilter: 'all',
  historyDate: '',
  showLastOver: false,
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

function buildEventBanner(d) {
  if (d.wicket) {
    const onExtra = d.extra ? `on a ${d.extra === 'wd' ? 'wide' : d.extra === 'nb' ? 'no ball' : d.extra}` : '';
    return { kind: 'wicket', big: 'WICKET!', sub: onExtra || 'Out' };
  }
  if (d.runs === 6) return { kind: 'six', big: 'SIX!', sub: 'Maximum' };
  if (d.runs === 4) return { kind: 'four', big: 'FOUR!', sub: 'Boundary' };
  if (d.extra === 'wd') {
    const total = 1 + d.runs;
    return { kind: 'wide', big: 'WIDE', sub: `+${total} run${total > 1 ? 's' : ''}` };
  }
  if (d.extra === 'nb') {
    const total = 1 + d.runs;
    return { kind: 'nb', big: 'NO BALL', sub: `+${total} run${total > 1 ? 's' : ''} · free hit next` };
  }
  if (d.extra === 'lb') return { kind: 'lb', big: `LEG BYE${d.runs > 1 ? 'S' : ''}`, sub: `${d.runs} run${d.runs > 1 ? 's' : ''}` };
  if (d.extra === 'b') return { kind: 'b', big: `BYE${d.runs > 1 ? 'S' : ''}`, sub: `${d.runs} run${d.runs > 1 ? 's' : ''}` };
  if (d.runs === 0) return { kind: 'dot', big: 'DOT BALL', sub: 'No run' };
  return { kind: 'runs', big: `${d.runs} RUN${d.runs > 1 ? 'S' : ''}`, sub: 'Off the bat' };
}

function showEventBanner(banner, ms = 1800) {
  state.eventBanner = banner;
  clearTimeout(showEventBanner._t);
  showEventBanner._t = setTimeout(() => {
    state.eventBanner = null;
    document.querySelector('.event-banner')?.remove();
  }, ms);
  render();
}

function clearEventBanner() {
  state.eventBanner = null;
  clearTimeout(showEventBanner._t);
}

function showToast(msg, ms = 1500) {
  state.toast = msg;
  render();
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    state.toast = null;
    document.querySelector('.toast')?.remove();
  }, ms);
}

// ---------- Storage ----------
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORE_HIST) || '[]'); } catch { return []; }
}
function saveHistory(arr) {
  try { localStorage.setItem(STORE_HIST, JSON.stringify(arr)); } catch { }
}
function loadCurrent() {
  try { return JSON.parse(localStorage.getItem(STORE_CURRENT) || 'null'); } catch { return null; }
}
function saveCurrent(m) {
  if (m) {
    try { localStorage.setItem(STORE_CURRENT, JSON.stringify(m)); } catch { }
    if (dbOn()) window.QCDB.syncMatch(m);
  } else {
    try { localStorage.removeItem(STORE_CURRENT); } catch { }
  }
}

async function refreshHistory() {
  if (!dbOn()) return;
  state.loadingHistory = true;
  try {
    const remote = await window.QCDB.loadMatches();
    state.history = remote;
    saveHistory(remote);
    purgeStaleInProgress();
  } catch (err) {
    console.warn('history fetch failed', err);
  } finally {
    state.loadingHistory = false;
    render();
  }
}

function purgeStaleInProgress() {
  const now = Date.now();
  const stale = state.history.filter(m =>
    m.status !== 'completed' && (now - (m.startedAt || 0)) > IN_PROGRESS_TTL_MS
  );
  if (stale.length === 0) return;
  const staleIds = new Set(stale.map(m => m.id));
  if (dbOn()) {
    stale.forEach(m => {
      window.QCDB.deleteMatch(m.id).catch(err => console.warn('stale cleanup failed', err));
    });
  }
  state.history = state.history.filter(m => !staleIds.has(m.id));
  saveHistory(state.history);
  if (state.current && staleIds.has(state.current.id)) {
    state.current = null;
    saveCurrent(null);
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
    deviceId: DEVICE_ID,
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
  showEventBanner(buildEventBanner(d));
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
  state.showLastOver = false;
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
      window.QCDB.upsertMatch(m).catch(() => { });
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

  const savedInputs = {};
  root.querySelectorAll('input').forEach((input) => {
    if (input.id) savedInputs[input.id] = input.value;
  });
  const focusedEl = document.activeElement;
  const focusedId = (focusedEl && focusedEl.id && root.contains(focusedEl)) ? focusedEl.id : null;
  let selStart = null, selEnd = null;
  if (focusedId && focusedEl && 'selectionStart' in focusedEl) {
    try { selStart = focusedEl.selectionStart; selEnd = focusedEl.selectionEnd; } catch { }
  }

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
    case 'in-progress': html = renderInProgress(); break;
    case 'detail': html = renderDetail(); break;
    case 'view': html = renderSharedView(); break;
    case 'terms': html = renderTerms(); break;
    default: html = renderHome();
  }
  if (state.modal) html += renderModal();
  if (state.eventBanner) {
    const b = state.eventBanner;
    html += `<div class="event-banner kind-${esc(b.kind)}"><div class="big">${esc(b.big)}</div>${b.sub ? `<div class="sub">${esc(b.sub)}</div>` : ''}</div>`;
  }
  if (state.toast) html += `<div class="toast">${esc(state.toast)}</div>`;
  root.innerHTML = html;

  Object.entries(savedInputs).forEach(([id, value]) => {
    if (!value) return;
    const el = document.getElementById(id);
    if (el && !el.value) el.value = value;
  });

  if (focusedId) {
    const el = document.getElementById(focusedId);
    if (el) {
      el.focus();
      if (selStart != null && selEnd != null) {
        try { el.setSelectionRange(selStart, selEnd); } catch { }
      }
    }
  } else if (state.modal?.type === 'newBatter') {
    $('new-batter-input')?.focus();
  } else if (state.modal?.type === 'newBowler') {
    $('new-bowler-input')?.focus();
  }
}

function renderHome() {
  const cur = state.current;
  const inProgressCount = state.history.filter(m => m.status !== 'completed').length;
  const pastCount = state.history.filter(m => m.status === 'completed').length;
  return `
    <div class="screen">
      <div class="home-hero">
        <div class="home-brand">
          <img class="home-logo" src="icon.svg" alt="" aria-hidden="true" />
          <h1 class="home-title">Quick<span class="accent">Cric</span></h1>
        </div>
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
        ${inProgressCount > 0 ? `
          <button class="cta cta-secondary" data-action="in-progress">
            <span>In-progress matches <span class="count">${inProgressCount}</span></span>
            <span class="arrow">→</span>
          </button>` : ''}
        <button class="cta cta-secondary" data-action="history">
          <span>
            Past matches
            ${state.loadingHistory ? `<span class="loading-dot"></span>` : pastCount > 0 ? `<span class="count">${pastCount}</span>` : ''}
          </span>
          <span class="arrow">→</span>
        </button>
      </div>
      ${!dbOn() ? `
        <div class="config-warn">
          <strong>Cloud sync off.</strong> Open <code>config.js</code> and add your Supabase keys to enable share links and cross-device history.
        </div>` : ''}
      <div class="home-fill"></div>
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
      <div class="home-foot">
        <button class="foot-link" data-action="terms">Terms &amp; Conditions</button>
        <a class="foot-link" href="https://www.linkedin.com/in/khamash/" target="_blank" rel="noopener noreferrer">Contact</a>
      </div>
    </div>
  `;
}

function renderTerms() {
  return `
    <div class="screen">
      <div class="topbar">
        <div class="left">
          <button class="icon-btn ghost" data-action="back-home">←</button>
          <span class="title">Terms &amp; Conditions</span>
        </div>
        <div class="right"></div>
      </div>
      <div class="terms-body">
        <p class="terms-updated">Last updated: 18 May 2026</p>

        <p>QuickCric is a small, free, casual cricket scoring app. By opening or using this app you are taken to have read and agreed to these terms. If you do not agree, please stop using the app.</p>

        <h2>1. What QuickCric is</h2>
        <p>QuickCric lets you keep score of informal cricket matches. There is no account, no sign-up, and no profile. You type team names, tap ball outcomes, and the app records the match.</p>

        <h2>2. No personal data collection</h2>
        <p>We do not ask for, and we do not want, any personal data. We do not collect your name, email address, phone number, location, contacts, photos, or any identifier tied to you as a person.</p>
        <p>You may type anything you like into team and player name fields while scoring &mdash; nicknames, jokes, single letters. We treat whatever you type as throwaway match labels, not as real-world identities, and we do not verify, profile, or contact anyone based on it. Please do not enter anyone&rsquo;s personal information that they have not agreed to share.</p>

        <h2>3. What gets stored, and where</h2>
        <p>To make the app work, the following is stored:</p>
        <ul>
          <li><strong>On your device</strong> &mdash; your current match and a cached list of recent matches are saved in your browser&rsquo;s local storage so you can close and reopen the app and pick up where you left off.</li>
          <li><strong>A device identifier</strong> &mdash; a random ID generated by your browser the first time you open the app. It is not linked to you, your hardware, or any account. It is only used so the app knows which device originally started a match, so that the &ldquo;Resume&rdquo; button on that device works correctly.</li>
          <li><strong>In the cloud (optional)</strong> &mdash; if the person who deployed this copy of QuickCric has configured a Supabase backend, the match scorecard (teams, runs, balls, wickets, the names you typed in) is sent there so the match can be opened on another device or shared via a link. No identifiers about you are sent &mdash; only the match data itself plus the random device ID described above.</li>
        </ul>
        <p>You can clear everything stored on your device at any time by clearing your browser&rsquo;s site data for this app, or by uninstalling the PWA. Doing so will end any in-progress match on this device.</p>

        <h2>4. Shared / public data</h2>
        <p>If cloud sync is enabled and you generate a share link, the match data behind that link is publicly readable by anyone who has the link. Matches are not private. Do not put anything in team or player name fields that you would not be comfortable showing publicly.</p>
        <p>Because the backend is shared and unauthenticated, in principle any user of the same deployment can read, edit or delete any match stored in it. Treat the app as a casual scratchpad among friends, not as a system of record.</p>

        <h2>5. No accounts, no logins, no recovery</h2>
        <p>There is no user account, password, or login. There is also no way for us to recover a deleted match, restore data after you clear your browser, or transfer matches between devices other than through the share link feature described above.</p>

        <h2>6. Offline use and PWA install</h2>
        <p>QuickCric is a Progressive Web App and may be installed on your home screen. After the first load it works offline using a service worker cache. The service worker only caches the app&rsquo;s own files; it does not track you.</p>

        <h2>7. Audio</h2>
        <p>The score screen has an optional sound toggle. When enabled, the app uses your browser&rsquo;s built-in speech and audio features to play commentary and celebration sounds. No audio is recorded from your microphone &mdash; the app never requests microphone access.</p>

        <h2>8. Third parties</h2>
        <p>If cloud sync is configured for this deployment, match data is stored on Supabase (supabase.com), subject to Supabase&rsquo;s own terms and privacy policy. No advertising networks, analytics trackers, or social-media SDKs are embedded in the app.</p>

        <h2>9. Acceptable use</h2>
        <p>Please do not use QuickCric to store or share content that is unlawful, abusive, harassing, defamatory, hateful, infringing, or that contains other people&rsquo;s personal data without their consent. We may remove any match data from the shared backend at any time, without notice, if it appears to breach these terms.</p>

        <h2>10. No warranty</h2>
        <p>QuickCric is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, free of charge, with no warranties of any kind, express or implied. Scores, totals, run rates, and match results are calculated by the app from the inputs you tap; we do not guarantee they are accurate, complete, or fit for any particular purpose (including any official, competitive, or wagering use). Always sanity-check the scoreboard.</p>

        <h2>11. Limitation of liability</h2>
        <p>To the maximum extent permitted by law, the developers of QuickCric are not liable for any loss or damage arising from your use of, or inability to use, the app &mdash; including but not limited to lost matches, incorrect scores, disputes between players, missed celebrations, device issues, or data loss. Your sole remedy if you are unhappy with the app is to stop using it.</p>

        <h2>12. Changes to the app and to these terms</h2>
        <p>The app may change, break, lose features, or disappear entirely at any time. These terms may also be updated; the date at the top of this page reflects the latest version. Continued use of the app after a change means you accept the updated terms.</p>

        <h2>13. Children</h2>
        <p>The app is suitable for all ages. As no personal data is requested, no specific children&rsquo;s data protections are triggered, but parents and guardians should still supervise what their children type into any text field, here or elsewhere.</p>

        <h2>14. Governing law</h2>
        <p>These terms are interpreted under the laws applicable in the jurisdiction where the operator of this deployment resides. Nothing in these terms limits any rights you have under mandatory consumer-protection laws of your country of residence.</p>

        <h2>15. Contact</h2>
        <p>QuickCric is a personal/club-scale project. For any questions, concerns, or feedback, contact the developer Nashib on LinkedIn: <a class="terms-link" href="https://www.linkedin.com/in/khamash/" target="_blank" rel="noopener noreferrer">linkedin.com/in/khamash</a>.</p>

        <p class="terms-foot">Thanks for playing. Now go hit a six.</p>
      </div>
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
          <button class="icon-btn" data-action="back-from-innings-setup" aria-label="Back">←</button>
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
  const liveOver = (ballsInCurrentOver === 0 && inn.score.balls > 0 && inn.needNewBowler) ? currentOver - 1 : currentOver;
  const hasLastOver = liveOver >= 1;
  const showingLast = state.showLastOver && hasLastOver;
  const overToShow = showingLast ? liveOver - 1 : liveOver;
  const overBalls = inn.ballLog.filter(b => b.overNo === overToShow);
  const legalCount = overBalls.filter(b => b.legal).length;
  const remainingLegal = Math.max(0, 6 - legalCount);
  const overSlots = [...overBalls, ...Array(remainingLegal).fill(null)];
  let overRuns = 0;
  let overWkts = 0;
  for (const b of overBalls) {
    const runs = Number(b.runs) || 0;
    const extraRun = (b.extra === 'wd' || b.extra === 'nb') ? 1 : 0;
    overRuns += runs + extraRun;
    if (b.wicket === true) overWkts += 1;
  }

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
        <div class="over-strip-head">
          <div class="heading">${showingLast ? 'Last over' : 'This over'}</div>
          ${hasLastOver ? `<button class="over-toggle" data-action="toggle-last-over">${showingLast ? 'Show this over' : 'View last over'}</button>` : ''}
        </div>
        <div class="balls">
          ${overSlots.map(renderBallPill).join('')}
          ${showingLast ? `<div class="over-sum">${overRuns}/${overWkts}</div>` : ''}
        </div>
      </div>
      ${inn.freeHit ? `<div class="free-hit-banner"><span class="fh-dot"></span>Free hit · next ball<span class="fh-dot"></span></div>` : ''}
      <div class="undo-row">
        ${showingLast ? '' : `<button data-action="undo" ${canUndo ? '' : 'disabled'}>↶ Undo last ball</button>`}
      </div>
      <div class="actions">
        <div class="input-cluster">
          <button class="wkt-btn ${b.wicket ? 'selected' : ''}" data-action="select-wkt">WKT</button>
          <div class="extras-panel">
            <div class="heading">Extras</div>
            <div class="row">
              ${['wd', 'nb', 'lb', 'b'].map(e => `<button class="extra-btn ${b.extra === e ? 'selected' : ''}" data-action="select-extra" data-extra="${e}">${e}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="runs-grid">
          <button class="run-btn dot ${b.runs === 0 ? 'selected' : ''}" data-action="select-run" data-runs="0">DOT</button>
          ${[1, 2, 3, 4, 5, 6].map(n => `<button class="run-btn ${b.runs === n ? 'selected' : ''}" data-action="select-run" data-runs="${n}">${n}</button>`).join('')}
        </div>
        <div class="next-bar">
          <button class="next-ball" data-action="next-ball" ${canNext ? '' : 'disabled'}>Next ball</button>
        </div>
        <div class="foot-links">
          <button data-action="end-innings">All out · end innings</button>
          <button class="danger-link" data-action="abort-show">Abort match</button>
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
        ${m.innings.map((inn, i) => renderInningsCard(m, inn, `Innings ${i + 1}`)).join('')}
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

const HISTORY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: '7 days' },
  { id: 'month', label: '30 days' },
];

function filterByDate(matches, filterId, customDate) {
  if (filterId === 'custom' && customDate) {
    const [y, mo, d] = customDate.split('-').map(Number);
    const start = new Date(y, mo - 1, d).setHours(0, 0, 0, 0);
    const end = start + 86400000;
    return matches.filter(m => m.startedAt >= start && m.startedAt < end);
  }
  if (filterId === 'all') return matches;
  const now = Date.now();
  const DAY = 86400000;
  if (filterId === 'today') {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return matches.filter(m => m.startedAt >= start.getTime());
  }
  if (filterId === 'week') return matches.filter(m => now - m.startedAt < 7 * DAY);
  if (filterId === 'month') return matches.filter(m => now - m.startedAt < 30 * DAY);
  if (filterId === 'year') {
    const start = new Date(new Date().getFullYear(), 0, 1).getTime();
    return matches.filter(m => m.startedAt >= start);
  }
  return matches;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderHistory() {
  const filter = state.historyFilter;
  const customDate = state.historyDate;
  const completed = state.history.filter(m => m.status === 'completed');
  const filtered = filterByDate(completed, filter, customDate);
  const isCustom = filter === 'custom';
  return `
    <div class="screen">
      <div class="topbar">
        <div class="left">
          <button class="icon-btn" data-action="back-home">←</button>
          <span class="title">Past matches</span>
        </div>
        <div class="right">
          ${state.loadingHistory ? `<span class="loading-dot light"></span>` : ''}
        </div>
      </div>
      <div class="history-filters">
        ${HISTORY_FILTERS.map(f => `
          <button class="filter-chip ${filter === f.id ? 'active' : ''}" data-action="history-filter" data-filter="${f.id}">
            ${esc(f.label)}
          </button>
        `).join('')}
        <label class="filter-chip date-chip ${isCustom ? 'active' : ''}">
          <span class="date-icon" aria-hidden="true">📅</span>
          <span class="date-label">${isCustom && customDate ? esc(fmtDateLabel(customDate)) : 'Pick date'}</span>
          <input id="history-date-input" type="date" value="${esc(customDate || '')}" max="${todayIso()}" />
        </label>
        ${isCustom ? `<button class="filter-chip clear-chip" data-action="history-filter" data-filter="all" aria-label="Clear date">×</button>` : ''}
      </div>
      <div class="scroll" style="padding: 12px 16px 16px;">
        ${filtered.length === 0 ? `
          <div class="empty">${completed.length === 0 ? 'No completed matches yet.' : 'No matches in this range.'}</div>
        ` : `
          <div class="history-count">${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'}</div>
          <div class="match-list" style="padding: 0;">${filtered.map(matchCard).join('')}</div>
        `}
      </div>
    </div>
  `;
}

function renderInProgress() {
  const items = state.history.filter(m => m.status !== 'completed')
    .sort((a, b) => b.startedAt - a.startedAt);
  return `
    <div class="screen">
      <div class="topbar">
        <div class="left">
          <button class="icon-btn" data-action="back-home">←</button>
          <span class="title">In-progress matches</span>
        </div>
        <div class="right">
          ${state.loadingHistory ? `<span class="loading-dot light"></span>` : ''}
        </div>
      </div>
      <div class="scroll" style="padding: 16px;">
        ${items.length === 0 ? `
          <div class="empty">No matches in progress.</div>
        ` : `
          <div class="history-count">${items.length} ${items.length === 1 ? 'match' : 'matches'}</div>
          <div class="match-list" style="padding: 0;">
            ${items.map(inProgressCard).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

function inProgressCard(m) {
  const sameDevice = m.deviceId === DEVICE_ID;
  const i1 = m.innings[0], i2 = m.innings[1];
  return `
    <div class="match-card-wrap">
      <button class="match-card in-progress" data-action="view-detail" data-match-id="${esc(m.id)}">
        <div class="date">${fmtDate(m.startedAt)}</div>
        <div class="teams">${esc(m.teams.A)} vs ${esc(m.teams.B)}</div>
        ${i1 ? `<div class="innings-row"><span>${esc(m.teams[i1.batting])}</span><span>${i1.score.runs}/${i1.score.wickets} (${fmtOvers(i1.score.balls)})</span></div>` : ''}
        ${i2 ? `<div class="innings-row"><span>${esc(m.teams[i2.batting])}</span><span>${i2.score.runs}/${i2.score.wickets} (${fmtOvers(i2.score.balls)})</span></div>` : ''}
        <div class="result">In progress</div>
      </button>
      ${sameDevice
      ? `<button class="resume-inline" data-action="resume-match" data-match-id="${esc(m.id)}">Resume <span>→</span></button>`
      : `<div class="other-device-note">Started on another device · view only</div>`}
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
        ${m.innings.map((inn, i) => renderInningsCard(m, inn, `Innings ${i + 1}`)).join('')}
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

function renderAbortModal() {
  const m = state.current;
  if (!m) return '';
  return `
    <div class="modal-bg">
      <div class="modal abort-modal">
        <div class="abort-warn-icon">!</div>
        <h3>Abort this match?</h3>
        <p>This match will be permanently removed and <strong>cannot be recovered</strong>. The score will not be saved.</p>
        <div class="abort-summary">
          <div>${esc(m.teams.A)} vs ${esc(m.teams.B)}</div>
          <div class="muted">${m.overs} overs · started ${fmtDate(m.startedAt)}</div>
        </div>
        <div class="abort-options">
          <button class="btn btn-primary btn-tall" data-action="dont-abort">Don't abort · back to match</button>
          <button class="btn btn-secondary btn-tall" data-action="abort-restart">Abort &amp; restart · same teams</button>
          <button class="btn btn-danger btn-tall" data-action="abort-confirm">Abort · don't save</button>
        </div>
      </div>
    </div>
  `;
}

function renderModal() {
  if (state.modal.type === 'abort') return renderAbortModal();
  if (state.modal.type === 'install') return renderInstallModal();
  if (state.modal.type === 'newBatter') {
    return `
      <div class="modal-bg">
        <div class="modal name-modal">
          <h3>Next batter</h3>
          <p>A wicket fell. Who's coming in?</p>
          <div class="modal-field">
            <label for="new-batter-input">Batter name</label>
            <input id="new-batter-input" class="modal-input" type="text" placeholder="Type a name…" autocomplete="off" autocapitalize="words" enterkeyhint="done" />
          </div>
          <button class="btn btn-primary btn-tall" data-action="confirm-new-batter">Continue</button>
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
        <div class="modal name-modal">
          <h3>Next bowler</h3>
          <p>Over complete. Who's bowling next?</p>
          ${recent.length ? `
            <div class="recents-block">
              <div class="recents-label">Previously bowled</div>
              <div class="recents">${recent.map(n => `<button class="recent" data-action="recent-bowler" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>
            </div>` : ''}
          <div class="modal-field">
            <label for="new-bowler-input">Bowler name</label>
            <input id="new-bowler-input" class="modal-input" type="text" placeholder="Type a name…" autocomplete="off" autocapitalize="words" enterkeyhint="done" />
          </div>
          <button class="btn btn-primary btn-tall" data-action="confirm-new-bowler">Continue</button>
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
    case 'terms': state.view = 'terms'; render(); break;
    case 'history':
      state.view = 'history';
      state.historyFilter = 'all';
      state.historyDate = '';
      render();
      if (dbOn()) refreshHistory();
      break;
    case 'in-progress':
      state.view = 'in-progress';
      render();
      if (dbOn()) refreshHistory();
      break;
    case 'resume-match': {
      const m = state.history.find(x => x.id === dataset.matchId);
      if (!m) { showToast('Match not found'); break; }
      if (m.deviceId !== DEVICE_ID) { showToast('Started on another device'); break; }
      state.current = m;
      saveCurrent(m);
      state.detail = null;
      const inn = m.innings[m.currentInnings];
      if (!inn) state.view = 'innings-setup';
      else if (inn.ended && m.currentInnings === 0) state.view = 'innings-break';
      else state.view = 'score';
      render();
      break;
    }
    case 'history-filter':
      state.historyFilter = dataset.filter;
      if (dataset.filter !== 'custom') state.historyDate = '';
      render();
      break;
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
    case 'toggle-last-over':
      state.showLastOver = !state.showLastOver;
      render();
      break;
    case 'undo':
      if (undoBall(state.current)) {
        state.ball = emptyBall();
        showEventBanner({ kind: 'undo', big: 'UNDO', sub: 'Last ball removed' }, 1300);
      }
      break;
    case 'end-innings':
      if (confirm('End this innings now?')) { endInningsManually(); afterInningsEnd(); }
      break;
    case 'abort-show':
      state.modal = { type: 'abort' };
      render();
      break;
    case 'dont-abort':
      state.modal = null;
      render();
      break;
    case 'abort-confirm': {
      const m = state.current;
      if (m) {
        if (dbOn()) window.QCDB.deleteMatch(m.id).catch(err => console.warn(err));
        state.history = state.history.filter(x => x.id !== m.id);
        saveHistory(state.history);
      }
      state.current = null;
      saveCurrent(null);
      state.modal = null;
      state.detail = null;
      state.view = 'home';
      render();
      showToast('Match aborted');
      break;
    }
    case 'abort-restart': {
      const m = state.current;
      if (!m) { state.modal = null; render(); break; }
      const { A, B } = m.teams;
      const overs = m.overs;
      const battingFirst = m.battingFirst;
      if (dbOn()) window.QCDB.deleteMatch(m.id).catch(err => console.warn(err));
      state.history = state.history.filter(x => x.id !== m.id);
      saveHistory(state.history);
      state.current = null;
      saveCurrent(null);
      state.setup = { teamA: A, teamB: B, overs, battingFirst };
      state.modal = null;
      state.detail = null;
      state.ball = emptyBall();
      state.view = 'setup';
      render();
      showToast('Confirm setup, then Start match');
      break;
    }
    case 'start-next-innings': state.view = 'innings-setup'; render(); break;
    case 'back-from-innings-setup': {
      const m = state.current;
      if (!m) { state.view = 'home'; render(); break; }
      if (m.innings.length === 0) {
        if (dbOn()) window.QCDB.deleteMatch(m.id).catch(() => { });
        state.history = state.history.filter(x => x.id !== m.id);
        saveHistory(state.history);
        state.setup = { teamA: m.teams.A, teamB: m.teams.B, overs: m.overs, battingFirst: m.battingFirst };
        state.current = null;
        saveCurrent(null);
        state.view = 'setup';
      } else {
        state.view = 'innings-break';
      }
      render();
      break;
    }
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
    case 'delete-match': {
      const expected = (window.QC_CONFIG && window.QC_CONFIG.DELETE_PASSCODE) || '';
      const code = prompt('Enter passcode to delete this match:');
      if (code === null) break;
      if (!expected) { showToast('No passcode configured'); break; }
      if (code !== expected) { showToast('Wrong passcode'); break; }
      const id = dataset.matchId;
      if (dbOn()) window.QCDB.deleteMatch(id).catch(err => console.warn(err));
      state.history = state.history.filter(x => x.id !== id);
      saveHistory(state.history);
      state.detail = null;
      state.view = 'home'; render();
      showToast('Match deleted');
      break;
    }
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
  purgeStaleInProgress();
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

  app.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'new-batter-input') {
      e.preventDefault();
      app.querySelector('[data-action="confirm-new-batter"]')?.click();
    } else if (e.target.id === 'new-bowler-input') {
      e.preventDefault();
      app.querySelector('[data-action="confirm-new-bowler"]')?.click();
    }
  });

  app.addEventListener('input', (e) => {
    if (state.view === 'setup') {
      if (e.target.id === 'team-a-input') state.setup.teamA = e.target.value;
      if (e.target.id === 'team-b-input') state.setup.teamB = e.target.value;
    }
    if (state.view === 'history' && e.target.id === 'history-date-input') {
      const v = e.target.value;
      if (v) {
        state.historyDate = v;
        state.historyFilter = 'custom';
      } else {
        state.historyDate = '';
        state.historyFilter = 'all';
      }
      render();
    }
  });
});
