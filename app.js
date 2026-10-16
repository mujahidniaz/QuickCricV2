'use strict';

const STORE_HIST = 'quickcric:matches';
const STORE_CURRENT = 'quickcric:current';
const STORE_AUDIO = 'quickcric:audio';
const STORE_INSTALL_DISMISSED = 'quickcric:install-dismissed';
const STORE_DEVICE_ID = 'quickcric:device-id';
const MAX_UNDO = 36;          // enough for a full over with extras + player picks
const FREE_UNDO = 2;          // undos allowed without the edit PIN
const EDIT_OVER_PIN = '5500'; // global PIN (edit over, delete player, …)
const POLL_INTERVAL_MS = 3000;
const IN_PROGRESS_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TEAM_A = 'Green';
const DEFAULT_TEAM_B = 'Blue';
const VENUES = ['Tempelhofer Feld', 'Schillerpark'];
const DEFAULT_VENUE = VENUES[0];
const DEFAULT_OVERS = 8;

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
  _gen: 0,
  _synthEndTime: 0,

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
      this._gen++;
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      if (this._cur) {
        try { this._cur.pause(); this._cur.currentTime = 0; } catch { }
        this._cur = null;
      }
    }
  },

  stopAll() {
    this._gen++;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this._cur) { try { this._cur.pause(); this._cur.currentTime = 0; } catch { } }
  },

  whenIdle(callback, gapMs = 200) {
    if (!this.enabled) return;
    const myGen = this._gen;
    let elapsed = 0;
    const check = () => {
      if (myGen !== this._gen) return;
      const speaking = 'speechSynthesis' in window && speechSynthesis.speaking;
      const playing = this._cur && !this._cur.ended && !this._cur.paused;
      const synthing = this._synthEndTime > performance.now();
      if ((speaking || playing || synthing) && elapsed < 8000) {
        elapsed += 120;
        setTimeout(check, 120);
      } else {
        setTimeout(() => { if (myGen === this._gen) callback(); }, gapMs);
      }
    };
    check();
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
    this._gen++;
    if (this._cur) { try { this._cur.pause(); this._cur.currentTime = 0; } catch { } }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = opts.rate ?? 1.1;
    u.pitch = opts.pitch ?? 1;
    u.volume = opts.volume ?? 1;
    speechSynthesis.speak(u);
  },

  speakThen(text, after, opts = {}) {
    if (!this.enabled || !('speechSynthesis' in window) || !text) { after?.(); return; }
    this._gen++;
    const myGen = this._gen;
    if (this._cur) { try { this._cur.pause(); this._cur.currentTime = 0; } catch { } }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = opts.rate ?? 1.1;
    u.pitch = opts.pitch ?? 1;
    u.volume = opts.volume ?? 1;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (myGen === this._gen) after?.();
    };
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
    setTimeout(finish, 6000);
  },

  async playFile(name, maxSeconds) {
    if (!this.enabled) return false;
    try {
      this._gen++;
      if ('speechSynthesis' in window) speechSynthesis.cancel();
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
    this.whenIdle(() => this.playFile(name), gapMs);
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
    this._gen++;
    this._synthEndTime = performance.now() + durSec * 1000;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this._cur) { try { this._cur.pause(); this._cur.currentTime = 0; } catch { } }
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

    if (d.wicket) {
      const played = await this.playFile('wicket');
      if (!played) this.speak(pickPhrase(WICKET_PHRASES));
      return;
    }

    if (d.extra === 'nb') {
      const freeHitPhrase = d.runs > 0
        ? `No ball, ${d.runs} run${d.runs > 1 ? 's' : ''}. Free hit next ball.`
        : 'No ball! Free hit coming up.';
      const playNoballThenAnnounce = () => {
        this.playFile('noball');
        this.whenIdle(() => this.speak(freeHitPhrase), 500);
      };
      const runFile = (d.runs === 6) ? { name: 'winner', maxSeconds: 2.5 } :
                      (d.runs === 4) ? { name: 'four' } :
                      (d.runs === 2) ? { name: 'two' } : null;
      if (runFile) {
        this.playFile(runFile.name, runFile.maxSeconds);
        this.whenIdle(playNoballThenAnnounce, 250);
      } else {
        playNoballThenAnnounce();
      }
      return;
    }

    if (d.runs === 0 && !d.extra) {
      this.speakThen(pickPhrase(DOT_PHRASES), () => this.playFile('dot'));
      return;
    }

    const file = this.fileForBall(d);
    if (file) {
      const played = await this.playFile(file.name, file.maxSeconds);
      if (played) return;
    }

    let phrase = '';
    if (d.runs === 6) phrase = pickPhrase(SIX_PHRASES);
    else if (d.runs === 4) phrase = pickPhrase(FOUR_PHRASES);
    else if (d.extra === 'wd') phrase = d.runs > 0 ? `Wide, ${d.runs + 1} runs` : 'Wide ball';
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
    this.whenIdle(() => {
      this.playFile('over').then(p => { if (!p) this.speak('End of the over'); });
    }, 300);
  },

  onMatchStart() {
    if (!this.enabled) return;
    this.whenIdle(() => {
      this.playFile('start', 11.25).then(p => { if (!p) this.speak('Match starts now!'); });
    }, 200);
  },

  onMatchWin(text) {
    if (!this.enabled) return;
    this.whenIdle(() => {
      this.playFile('winner').then(p => { if (!p) this.speak(text, { rate: 1, pitch: 1.05 }); });
    }, 300);
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
  players: [],
  playerDetail: null,
  detail: null,
  shared: null,
  sharedScorecardOpen: undefined,
  ball: emptyBall(),
  modal: null,
  toast: null,
  setup: { teamA: DEFAULT_TEAM_A, teamB: DEFAULT_TEAM_B, overs: DEFAULT_OVERS, battingFirst: 'A', skipTeamPick: false, venue: DEFAULT_VENUE },
  teamPick: { squads: { A: [], B: [] }, picking: 'A', mode: 'pick', autoBalanced: false },
  teamPickUndo: [],
  loadingHistory: false,
  installTab: 'android',
  historyFilter: 'all',
  historyDate: '',
  showLastOver: false,
  overEditUnlocked: false,
  freeUndosUsed: 0,
  editOverIntent: null,
  scorePick: null,
  inningsManual: { striker: false, nonStriker: false, bowler: false },
  inningsPick: { striker: null, nonStriker: null, bowler: null },
  inningsPickUndo: [],
  playersTab: 'roster',
  appSeason: '',
  seasonLeader: 'runs',
  seasonQualified: true,
  wrappedStep: 0,
  playerFrom: 'players',
  playerSeason: 'all',
  playerStatTab: 'bat',
  summaryInn: 0,
  summaryBalls: false,
  summaryShowId: false,
  openerSlot: 'striker',
  availQuery: '',
  detailReturn: null,
  historyScroll: 0,
  adminUnlocked: false,
  adminMerge: { sourceId: '', targetId: '' },
  adminReassign: { matchId: '', sourceKey: '', targetId: '', scope: 'bat' },
  adminMatches: null,
  playerPickerFilter: '',
  matchAvailability: { ids: [] },
  tossCoin: { phase: 'idle', result: null },
};

function emptyBall() {
  return { runs: null, extra: null, wicket: false, runOut: false, runOutEnd: null };
}

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

/** Clear SW + caches, then reload from network (does not wipe roster/match cloud data). */
async function hardReloadApp() {
  showToast('Loading latest app…');
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (err) {
    console.warn('[QuickCric] hard reload failed', err);
  }
  const url = new URL(location.href);
  url.searchParams.set('_', Date.now().toString(36));
  location.replace(url.toString());
}

function buildEventBanner(d) {
  if (d.wicket) {
    const onExtra = d.extra ? `on a ${d.extra === 'wd' ? 'wide' : d.extra === 'nb' ? 'no ball' : d.extra}` : '';
    if (d.runOut) return { kind: 'wicket', big: 'RUN OUT!', sub: onExtra || 'Out' };
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

function showEventBanner(banner, ms = 1800, skipRender = false) {
  state.eventBanner = banner;
  clearTimeout(showEventBanner._t);
  showEventBanner._t = setTimeout(() => {
    state.eventBanner = null;
    document.querySelector('.event-banner')?.remove();
  }, ms);
  if (!skipRender) scheduleRender();
}

function clearEventBanner() {
  state.eventBanner = null;
  clearTimeout(showEventBanner._t);
}

function showToast(msg, ms = 1500) {
  state.toast = msg;
  scheduleRender();
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    state.toast = null;
    document.querySelector('.toast')?.remove();
  }, ms);
}

// ---------- Storage ----------
function loadHistory() {
  if (dbOn()) return [];
  try { return JSON.parse(localStorage.getItem(STORE_HIST) || '[]'); } catch { return []; }
}
function matchForStorage(m) {
  if (!m) return m;
  const copy = { ...m };
  delete copy.undo;
  return copy;
}

/** Undo is kept in memory only — ensure it exists after cloud/local loads. */
function normalizeMatch(m) {
  if (!m) return m;
  if (!Array.isArray(m.undo)) m.undo = [];
  return m;
}

function saveHistory(arr) {
  if (dbOn()) return;
  try { localStorage.setItem(STORE_HIST, JSON.stringify(arr)); } catch { }
}
function loadCurrent() {
  try { return normalizeMatch(JSON.parse(localStorage.getItem(STORE_CURRENT) || 'null')); } catch { return null; }
}

function writeCurrentLocal(m) {
  try {
    if (m) localStorage.setItem(STORE_CURRENT, JSON.stringify(matchForStorage(m)));
    else localStorage.removeItem(STORE_CURRENT);
  } catch { /* quota or private mode */ }
}

/** Further-along scorecard wins. Equal progress keeps the copy that still has undo. */
function matchProgress(m) {
  if (!m) return -1;
  const inns = m.innings || [];
  let balls = 0;
  for (const inn of inns) balls += (inn.ballLog || []).length;
  return inns.length * 1000000 + balls;
}

function preferMatch(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  if (a.id && b.id && a.id !== b.id) return a;
  const pa = matchProgress(a);
  const pb = matchProgress(b);
  if (pa !== pb) return pa > pb ? a : b;
  if (a.status === 'completed' && b.status !== 'completed') return a;
  if (b.status === 'completed' && a.status !== 'completed') return b;
  if ((a.undo?.length || 0) !== (b.undo?.length || 0)) {
    return (a.undo?.length || 0) >= (b.undo?.length || 0) ? a : b;
  }
  return (a.savedAt || 0) >= (b.savedAt || 0) ? a : b;
}

function saveCurrent(m) {
  if (m) {
    m.savedAt = Date.now();
    writeCurrentLocal(m);
    if (dbOn()) window.QCDB.syncMatch(matchForStorage(m));
  } else {
    writeCurrentLocal(null);
    stopActiveMatchPoll();
  }
}

async function allMatchesForStats() {
  const byId = new Map();
  for (const m of state.history) byId.set(m.id, m);
  if (state.current) byId.set(state.current.id, state.current);
  if (dbOn()) {
    try {
      const remote = await window.QCDB.loadMatches(500);
      for (const m of remote) byId.set(m.id, m);
    } catch (err) {
      console.warn('load matches for admin failed', err);
    }
  }
  return [...byId.values()];
}

function applyMergedMatches(updatedMatches, changedMatchIds) {
  const map = new Map(updatedMatches.map(m => [m.id, m]));
  state.history = state.history.map(m => map.get(m.id) || m);
  for (const m of updatedMatches) {
    if (!state.history.some(x => x.id === m.id)) state.history.push(m);
  }
  state.history.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  if (state.current && map.has(state.current.id)) {
    state.current = map.get(state.current.id);
  }
  if (state.detail && map.has(state.detail.id)) {
    state.detail = map.get(state.detail.id);
  }
  saveHistory(state.history);
  if (state.current) saveCurrent(state.current);
  if (dbOn()) {
    const syncIds = new Set(changedMatchIds || []);
    for (const id of syncIds) {
      const m = map.get(id);
      if (m) window.QCDB.syncMatch(m).catch(err => console.warn('match sync failed', err));
    }
  }
}

async function runPlayerMerge(sourceId, targetId) {
  if (!window.QCPlayers?.mergePlayersInto) return { error: 'Merge not available' };
  const matches = await allMatchesForStats();
  const res = window.QCPlayers.mergePlayersInto(state.players, sourceId, targetId, matches);
  if (res.error) return res;
  state.players = res.players;
  savePlayersList(res.players);
  applyMergedMatches(res.matches, res.changedMatchIds);
  if (state.playerDetail?.id === sourceId) {
    state.playerDetail = playerById(targetId);
    if (!state.playerDetail) state.view = 'players';
  } else if (state.playerDetail) {
    state.playerDetail = playerById(state.playerDetail.id);
  }
  state.adminMerge = { sourceId: '', targetId: '' };
  return res;
}

function adminMatchList() {
  const byId = new Map();
  for (const m of state.adminMatches || []) byId.set(m.id, m);
  for (const m of state.history) byId.set(m.id, m);
  if (state.current) byId.set(state.current.id, state.current);
  return [...byId.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

function adminMatchLabel(m) {
  const teams = `${m.teams?.A || 'A'} vs ${m.teams?.B || 'B'}`;
  const d = new Date(m.startedAt || Date.now());
  const when = d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const id = m.id || '—';
  const tag = m.status === 'completed' ? '' : ' · in progress';
  return `${teams} · ${when} · ${id}${tag}`;
}

function adminReassignSourceOptions(match, selectedKey, scope) {
  if (!match || !window.QCPlayers?.listMatchParticipants) {
    return '<option value="">— Select match first —</option>';
  }
  const parts = window.QCPlayers.listMatchParticipants(match, state.players, scope);
  const head = '<option value="">— Select —</option>';
  const rows = parts.map((p) => {
    const key = p.id || `n:${p.name.toLowerCase()}`;
    return `<option value="${esc(key)}"${key === selectedKey ? ' selected' : ''}>${esc(p.name)}</option>`;
  }).join('');
  return head + rows;
}

function parseAdminReassignSource(sourceKey) {
  if (!sourceKey) return { sourceId: null, sourceName: '' };
  if (sourceKey.startsWith('n:')) {
    return { sourceId: null, sourceName: sourceKey.slice(2) };
  }
  return { sourceId: sourceKey, sourceName: '' };
}

async function loadAdminMatches() {
  state.adminMatches = await allMatchesForStats();
}

async function runMatchPlayerReassign(matchId, sourceKey, targetId, scope) {
  if (!window.QCPlayers?.reassignPlayerInMatch) return { error: 'Reassign not available' };
  const matches = state.adminMatches || await allMatchesForStats();
  const { sourceId, sourceName } = parseAdminReassignSource(sourceKey);
  const res = window.QCPlayers.reassignPlayerInMatch(
    state.players,
    matchId,
    sourceId,
    sourceName,
    targetId,
    matches,
    scope,
  );
  if (res.error) return res;
  state.players = res.players;
  savePlayersList(res.players);
  applyMergedMatches(res.matches, res.changedMatchIds);
  if (state.playerDetail) {
    state.playerDetail = playerById(state.playerDetail.id);
  }
  state.adminReassign = { matchId: '', sourceKey: '', targetId: '', scope: 'bat' };
  state.adminMatches = res.matches;
  return res;
}

async function refreshCareerStatsIfNeeded() {
  const REV = '5';
  let matches = [];
  try {
    matches = await allMatchesForStats();
  } catch (err) {
    console.warn('career stats rebuild skipped', err);
  }
  if (matches.length) state.seasonMatches = matches;
  let rev = '';
  try { rev = localStorage.getItem('quickcric:statsRev') || ''; } catch { /* ignore */ }
  if (rev === REV) {
    if (state.view === 'players' || state.view === 'player-detail' || state.view === 'seasons' || state.view === 'home' || state.view === 'history' || state.view === 'wrapped') render();
    return;
  }
  if (!window.QCPlayers?.rebuildAllStatsFromMatches) return;
  const hasCareer = state.players.some(p => (p.batting?.runs || 0) > 0 || (p.bowling?.wickets || 0) > 0 || (p.bowling?.balls || 0) > 0);
  if (!matches.length && hasCareer) return;
  state.players = window.QCPlayers.rebuildAllStatsFromMatches(state.players, matches);
  try { localStorage.setItem('quickcric:statsRev', REV); } catch { /* ignore */ }
  if (state.playerDetail) state.playerDetail = playerById(state.playerDetail.id);
  if (state.view === 'players' || state.view === 'player-detail' || state.view === 'seasons' || state.view === 'home' || state.view === 'history' || state.view === 'wrapped') render();
}

function persistMatch(m) {
  if (!m) return;
  saveCurrent(m);
  state.history = [m, ...state.history.filter(x => x.id !== m.id)];
  saveHistory(state.history);
}

function loadPlayers() {
  return window.QCPlayers ? window.QCPlayers.load() : [];
}

function savePlayersList(arr) {
  if (window.QCPlayers) window.QCPlayers.save(arr);
  state.players = arr;
}

function playerById(id) {
  return state.players.find(p => p.id === id) || null;
}

function playerName(id) {
  return playerById(id)?.name || '';
}

function safePlayerPhoto(p) {
  const src = typeof p?.photo === 'string' ? p.photo.trim() : '';
  if (!/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(src)) return '';
  if (src.length > 150000) return '';
  return src;
}

function playerAvatarHtml(p, mark, cls = 'bcc-av') {
  const src = safePlayerPhoto(p);
  const letter = esc(String(mark || p?.name || '?').trim().charAt(0).toUpperCase() || '?');
  if (!src) return `<span class="${cls} bcc-an">${letter}</span>`;
  return `<span class="${cls} has-photo"><img src="${src}" alt=""></span>`;
}

function photoForCard(card) {
  if (!card) return '';
  const own = safePlayerPhoto(card);
  if (own) return own;
  const id = card.playerId || card.id;
  if (id) {
    const byId = safePlayerPhoto(playerById(id));
    if (byId) return byId;
  }
  if (card.name && window.QCPlayers?.findByName) {
    return safePlayerPhoto(window.QCPlayers.findByName(state.players, card.name));
  }
  return '';
}

function faceHtml(card) {
  const src = photoForCard(card);
  if (src) return `<img class="qc-face" src="${src}" alt="">`;
  const name = String(card?.name || '').trim();
  if (!name || name === '—') return '';
  const letter = esc(name.charAt(0).toUpperCase());
  return `<span class="qc-face is-letter" aria-hidden="true">${letter}</span>`;
}

function scorecardName(card, extra) {
  const face = faceHtml(card);
  const who = `<b>${esc(card?.name || '')}</b>${extra || ''}`;
  if (!face) return who;
  return `<span class="qc-who">${face}<span>${who}</span></span>`;
}

function portraitHtml(card) {
  const src = photoForCard(card);
  if (!src) return '';
  return `<span class="ssn-ph"><img src="${src}" alt=""></span>`;
}

function setPlayerPhoto(id, photo) {
  const p = playerById(id);
  if (!p) return;
  if (photo) p.photo = photo;
  else delete p.photo;
  p.updatedAt = Date.now();
  if (state.playerDetail?.id === id) state.playerDetail = p;
  savePlayersList(state.players);
  showToast(photo ? 'Photo saved' : 'Photo removed');
  render();
}

function compressPlayerPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      reject(new Error('type'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 160;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const side = Math.min(img.width, img.height) || 1;
      ctx.drawImage(img, Math.max(0, (img.width - side) / 2), Math.max(0, (img.height - side) / 2), side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      const out = canvas.toDataURL('image/jpeg', 0.72);
      if (!out || out.length > 120000) {
        reject(new Error('size'));
        return;
      }
      resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('load'));
    };
    img.src = url;
  });
}

function resolvePlayerId(name) {
  if (!window.QCPlayers) return null;
  return window.QCPlayers.findByName(state.players, name)?.id || null;
}

function ensurePlayerInRoster(name, playerId = null) {
  const trimmed = (name || '').trim();
  if (!trimmed || !window.QCPlayers) return playerId || null;
  if (playerId) {
    const byId = playerById(playerId);
    if (byId && byId.name.trim().toLowerCase() === trimmed.toLowerCase()) return playerId;
  }
  const existing = resolvePlayerId(trimmed);
  if (existing) return existing;
  const res = window.QCPlayers.add(state.players, trimmed);
  if (res.error) {
    const again = resolvePlayerId(trimmed);
    if (again) return again;
    showToast(res.error);
    return null;
  }
  state.players = res.players;
  return res.player?.id || null;
}

function matchUsesSquads(match) {
  if (match?.squadsSkipped) return false;
  return !!match?.squads &&
    ((match.squads.A?.length || 0) + (match.squads.B?.length || 0) > 0);
}

function matchUsesAutoSquads(match) {
  return !!(match?.squadsAutoPicked && matchUsesSquads(match));
}

function inningsSidesForMatch(match) {
  const isFirst = !match.innings || match.innings.length === 0;
  const batting = isFirst ? match.battingFirst : (match.battingFirst === 'A' ? 'B' : 'A');
  const bowling = batting === 'A' ? 'B' : 'A';
  return { batting, bowling };
}

function playersForSquadSide(match, side) {
  const ids = match?.squads?.[side];
  if (!ids?.length) return [];
  const idSet = new Set(ids);
  return state.players.filter(p => idSet.has(p.id));
}

/** Squad side, plus anyone added during the match who is not on a squad yet. */
function playersForScoringSide(match, side) {
  const squad = playersForSquadSide(match, side);
  const assigned = new Set([...(match?.squads?.A || []), ...(match?.squads?.B || [])]);
  const seen = new Set(squad.map(p => p.id));
  const fresh = state.players.filter(p => p?.id && !assigned.has(p.id) && !seen.has(p.id));
  return squad.concat(fresh);
}

function squadCountsWithinOne(countA, countB) {
  return Math.abs(countA - countB) <= 1;
}

function canAddToSquadSide(side, squads) {
  const a = squads.A.length + (side === 'A' ? 1 : 0);
  const b = squads.B.length + (side === 'B' ? 1 : 0);
  return squadCountsWithinOne(a, b);
}

function canMoveSquadPlayer(fromSide, squads) {
  const a = squads.A.length + (fromSide === 'A' ? -1 : 1);
  const b = squads.B.length + (fromSide === 'B' ? -1 : 1);
  return squadCountsWithinOne(a, b);
}

function squadSizeDiff(squads) {
  return Math.abs((squads?.A?.length || 0) - (squads?.B?.length || 0));
}

function normalizeTeamPickSquads(squads) {
  if (!window.QCPlayers?.normalizeSquadSizes) return squads;
  const players = playersAvailableToday();
  window.QCPlayers.normalizeSquadSizes(players, squads);
  return squads;
}

/** Manual alternation: when sizes differ, only the smaller side may receive the next pick. */
function teamPickSideForNext(squads) {
  const a = squads.A.length;
  const b = squads.B.length;
  if (a !== b) return a < b ? 'A' : 'B';
  return state.teamPick.picking;
}

/** Persist a player on the global roster and, when squads are in use, on that side's squad. */
function ensurePlayerOnSide(match, side, name, playerId = null) {
  const id = ensurePlayerInRoster(name, playerId);
  if (!id || !match || !side) return id;
  if (!matchUsesSquads(match)) return id;
  if (!match.squads) match.squads = { A: [], B: [] };
  if (!Array.isArray(match.squads[side])) match.squads[side] = [];
  const other = side === 'A' ? 'B' : 'A';
  if (match.squads[other]?.includes(id)) return id;
  if (!match.squads[side].includes(id)) match.squads[side].push(id);
  return id;
}

function resetInningsPickers() {
  state.inningsManual = { striker: false, nonStriker: false, bowler: false };
  state.inningsPick = { striker: null, nonStriker: null, bowler: null };
  state.inningsPickUndo = [];
  state.playerPickerFilter = '';
  state.openerSlot = 'striker';
}

function pushInningsPickUndo() {
  state.inningsPickUndo.push(clone({
    inningsPick: state.inningsPick,
    inningsManual: { ...state.inningsManual },
  }));
  if (state.inningsPickUndo.length > 24) state.inningsPickUndo.shift();
}

function undoInningsPick() {
  if (!state.inningsPickUndo.length) return false;
  const snap = state.inningsPickUndo.pop();
  state.inningsPick = snap.inningsPick;
  state.inningsManual = snap.inningsManual;
  return true;
}

function pushTeamPickUndo() {
  state.teamPickUndo.push(clone({
    squads: clone(state.teamPick.squads),
    picking: state.teamPick.picking,
    mode: state.teamPick.mode || 'pick',
  }));
  if (state.teamPickUndo.length > 24) state.teamPickUndo.shift();
}

function undoTeamPick() {
  if (!state.teamPickUndo.length) return false;
  const snap = state.teamPickUndo.pop();
  state.teamPick.squads = snap.squads;
  state.teamPick.picking = snap.picking;
  if (snap.mode) state.teamPick.mode = snap.mode;
  return true;
}

function enterSquadReview(squads, toastMsg) {
  const next = { A: [...squads.A], B: [...squads.B] };
  normalizeTeamPickSquads(next);
  state.teamPick.squads = next;
  state.teamPick.mode = 'review';
  state.teamPick.autoBalanced = true;
  state.teamPick.picking = 'A';
  state.teamPickUndo = [];
  state.view = 'team-pick';
  render();
  if (toastMsg) showToast(toastMsg);
}

/** Auto-picked squads → batting/bowling side lists only; manual or skipped squads → full roster. */
function rosterForInningsSetup(mode) {
  const m = state.current;
  if (!m || !matchUsesAutoSquads(m)) return sortPlayersForPicker(state.players);
  const { batting, bowling } = inningsSidesForMatch(m);
  const side = mode === 'bowl' ? bowling : batting;
  return sortPlayersForPicker(playersForScoringSide(m, side));
}

/** Scoring modals: squad-filtered when auto-picked; bowlers exclude crease batters. */
function rosterForScoringPicker(inn, mode) {
  const m = state.current;
  let list = state.players.slice();
  if (m && matchUsesAutoSquads(m) && inn) {
    const side = mode === 'bat' ? inn.batting : inn.bowling;
    list = playersForScoringSide(m, side);
  }
  if (mode === 'bowl' && inn) {
    list = list.filter(p => !batterNotOutOnField(inn, p));
  }
  return sortPlayersForPicker(list);
}

function enterTossView() {
  resetInningsPickers();
  state.tossCoin = { phase: 'idle', result: null };
  state.view = 'match-toss';
  if (dbOn()) {
    refreshPlayers().then(() => render()).catch(() => render());
    return true;
  }
  return false;
}

/** First innings not started yet: toss screen until confirmed, then openers. */
function viewBeforeFirstInnings(m) {
  if (!m || m.innings.length > 0) return null;
  return m.tossDone ? 'innings-setup' : 'match-toss';
}

function enterInningsSetupView() {
  resetInningsPickers();
  state.view = 'innings-setup';
  if (dbOn()) {
    refreshPlayers().then(() => render()).catch(() => render());
    return true;
  }
  return false;
}

function innPlayerMatch(b, player) {
  return (player.id && b.playerId === player.id) ||
    b.name.toLowerCase() === player.name.toLowerCase();
}

function batterOutInInnings(inn, player) {
  if (batterNotOutOnField(inn, player)) return false;
  return inn.batters.some(b => b.out && innPlayerMatch(b, player));
}

function batterNotOutOnField(inn, player) {
  return inn.batters.some(b => !b.out && innPlayerMatch(b, player));
}

function isConsecutiveBowler(inn, player) {
  if (!inn?.needNewBowler) return false;
  const last = inn.bowlers[inn.currentBowler];
  if (!last) return false;
  return innPlayerMatch(last, player);
}

function pickerDisabledReason(inn, player, mode, opts = {}) {
  if (mode === 'bat' && inn) {
    if (batterOutInInnings(inn, player)) return 'Already out';
    if (opts.blockOnField && batterNotOutOnField(inn, player)) return 'Already batting';
  }
  if (opts.excludeName && player.name.toLowerCase() === opts.excludeName.toLowerCase()) {
    return 'Already selected';
  }
  if (mode === 'bowl' && inn && opts.blockConsecutive && isConsecutiveBowler(inn, player)) {
    return 'Just bowled this over';
  }
  return null;
}

function sortPlayersForPicker(list) {
  return [...(list || [])].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function renderPlayerPickerChip(p, opts) {
  const {
    action, inn, mode, excludeName, blockOnField, blockConsecutive, selected,
  } = opts;
  const reason = pickerDisabledReason(inn, p, mode, { excludeName, blockOnField, blockConsecutive });
  const isSelected = selected && (selected.id === p.id ||
    selected.name?.toLowerCase() === p.name.toLowerCase());
  return `
    <button type="button"
      class="player-picker-chip${isSelected ? ' is-selected' : ''}${reason ? ' is-disabled' : ''}"
      data-action="${reason ? '' : esc(action)}"
      data-player-id="${esc(p.id)}"
      data-player-name="${esc(p.name)}"
      ${reason ? `disabled title="${esc(reason)}"` : ''}>
      <span class="player-picker-chip-name">${esc(p.name)}</span>
      ${reason ? `<span class="player-picker-chip-note">${esc(reason)}</span>` : ''}
    </button>`;
}

function renderPlayerPicker(opts) {
  const {
    label,
    action,
    players,
    inn = null,
    mode = 'bat',
    role = mode === 'bowl' ? 'bowler' : 'batter',
    manualKey = null,
    inputId = null,
    excludeName = '',
    blockOnField = false,
    blockConsecutive = false,
    selected = null,
    modalManual = false,
    compact = true,
    fluid = true,
    dark = false,
    filterText = null,
    showFilter = false,
  } = opts;
  const list = players || [];
  const filter = (filterText != null ? filterText : state.playerPickerFilter || '').trim().toLowerCase();
  const filtered = filter
    ? list.filter(p => p.name.toLowerCase().includes(filter))
    : list;
  const showManual = manualKey ? state.inningsManual[manualKey] : modalManual;
  const chipOpts = { action, inn, mode, excludeName, blockOnField, blockConsecutive, selected };
  const gridContent = sortPlayersForPicker(filtered)
    .map(p => renderPlayerPickerChip(p, chipOpts))
    .join('');
  const toggleAction = manualKey
    ? `toggle-innings-manual`
    : 'toggle-modal-manual';
  const toggleField = manualKey ? ` data-field="${manualKey}"` : '';
  const roleClass = role ? ` player-picker--role-${role}` : '';
  const compactClass = compact ? ' player-picker--compact' : '';
  const fluidClass = fluid ? ' player-picker-grid--fluid' : '';
  const darkClass = dark ? ' player-picker--dark' : '';
  const wantFilter = showFilter && list.length >= 12;
  return `
    <div class="player-picker${roleClass}${compactClass}${darkClass}">
      ${label ? `
        <div class="player-picker-label">
          <span class="player-picker-dot" aria-hidden="true"></span>
          <span class="player-picker-label-text">${esc(label)}</span>
          ${selected?.name ? `<span class="player-picker-picked">${esc(selected.name)}</span>` : ''}
        </div>
      ` : ''}
      ${wantFilter ? `
        <input type="search" class="form-control form-control-sm player-picker-filter" placeholder="Find player…" value="${esc(filterText != null ? filterText : state.playerPickerFilter || '')}" autocomplete="off" autocapitalize="off" enterkeyhint="search" />
      ` : ''}
      ${filtered.length ? `
        <div class="player-picker-grid${fluidClass}">${gridContent}</div>
      ` : list.length ? `<p class="player-picker-empty">No names match “${esc(filter)}”</p>` : `<p class="player-picker-empty">No saved players — add a name below</p>`}
      ${!showManual ? `
        <button type="button" class="player-picker-new" data-action="${toggleAction}"${toggleField}>
          + New name
        </button>
      ` : ''}
      ${inputId ? `
        <div class="player-picker-manual${showManual ? '' : ' d-none'}">
          <input id="${esc(inputId)}" class="form-control form-control-sm player-picker-input" type="text" placeholder="Type name…" autocomplete="off" autocapitalize="words" />
        </div>
      ` : ''}
    </div>
  `;
}

function availableIdsSet() {
  const ids = state.matchAvailability?.ids;
  if (ids?.length) return new Set(ids);
  return new Set(state.players.map(p => p.id));
}

function playersAvailableToday() {
  const allowed = availableIdsSet();
  return state.players.filter(p => allowed.has(p.id));
}

function availabilityCount() {
  return state.matchAvailability?.ids?.length || 0;
}

function canPickSquadsFromAvailability() {
  return availabilityCount() >= 2;
}

function availableForPick() {
  const picked = new Set([...state.teamPick.squads.A, ...state.teamPick.squads.B]);
  const allowed = availableIdsSet();
  return state.players.filter(p => allowed.has(p.id) && !picked.has(p.id));
}

function applyBalancedSquads(squads) {
  if (!state.current) return;
  state.current.squads = { A: [...squads.A], B: [...squads.B] };
  state.current.squadsSkipped = false;
  state.current.availablePlayerIds = [...(state.matchAvailability?.ids || [])];
  persistMatch(state.current);
}

function squadsKey(squads) {
  const a = [...(squads?.A || [])].sort().join(',');
  const b = [...(squads?.B || [])].sort().join(',');
  return `${a}|${b}`;
}

function runAutoBalance(existingSquads = null, balanceOpts = {}) {
  const pool = playersAvailableToday();
  if (pool.length < 2) return { error: 'Need at least 2 available players' };
  const fixed = existingSquads || { A: [], B: [] };
  const res = window.QCPlayers.balanceTeams(pool, { existingSquads: fixed, ...balanceOpts });
  if (!res.error && res.squads) normalizeTeamPickSquads(res.squads);
  return res;
}

/** Reshuffle until the lineup changes (or attempts run out). */
function runReshuffleBalance(prevSquads = null) {
  const prevKey = prevSquads ? squadsKey(prevSquads) : '';
  return runAutoBalance({ A: [], B: [] }, { reshuffle: true, avoidKey: prevKey });
}

async function refreshHistory() {
  if (!dbOn()) return;
  state.loadingHistory = true;
  try {
    const remote = await window.QCDB.loadMatches();
    state.history = remote.map(normalizeMatch);
    try { localStorage.removeItem(STORE_HIST); } catch { }
    const candidate = preferMatch(state.current, loadCurrent());
    if (candidate) {
      const fresh = state.history.find(x => x.id === candidate.id) || null;
      const chosen = preferMatch(candidate, fresh);
      state.current = chosen;
      if (!fresh || matchProgress(chosen) > matchProgress(fresh)) {
        state.history = [chosen, ...state.history.filter(x => x.id !== chosen.id)];
        writeCurrentLocal(chosen);
        if (dbOn()) window.QCDB.syncMatch(matchForStorage(chosen));
      } else {
        writeCurrentLocal(chosen);
      }
    }
    purgeStaleInProgress();
  } catch (err) {
    console.warn('history fetch failed', err);
  } finally {
    state.loadingHistory = false;
    render();
  }
}

async function refreshPlayers() {
  if (!dbOn() || !window.QCPlayers) return;
  try {
    const bundle = await window.QCDB.loadPlayersBundle();
    state.players = window.QCPlayers.applyRemoteBundle(bundle);
    if (state.playerDetail) {
      state.playerDetail = playerById(state.playerDetail.id);
    }
    const blocked = new Set(
      (bundle.deletedNames || []).map(n => window.QCPlayers.normalizeName(n)).filter(Boolean)
    );
    for (const p of bundle.players || []) {
      if (blocked.has(window.QCPlayers.normalizeName(p.name))) {
        window.QCDB.deletePlayer(p.id).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('players fetch failed', err);
  }
}

function purgeStaleInProgress() {
  const now = Date.now();
  const stale = state.history.filter(m =>
    m.status !== 'completed'
    && !(state.current && state.current.id === m.id)
    && (now - (m.savedAt || m.startedAt || 0)) > IN_PROGRESS_TTL_MS
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
function newBatter(name, playerId = null) {
  const pid = playerId || resolvePlayerId(name);
  return {
    name: (name || '').trim() || 'Batter',
    playerId: pid,
    runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: null,
  };
}
function newBowler(name, playerId = null) {
  const pid = playerId || resolvePlayerId(name);
  return { name: (name || '').trim() || 'Bowler', playerId: pid, balls: 0, runs: 0, wickets: 0 };
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
function newMatch(teamA, teamB, overs, battingFirst, squads = null, venue = DEFAULT_VENUE) {
  return {
    id: uid(),
    deviceId: DEVICE_ID,
    scoringDeviceId: DEVICE_ID,
    startedAt: Date.now(),
    endedAt: null,
    venue: (venue || '').trim() || DEFAULT_VENUE,
    teams: { A: (teamA || '').trim() || DEFAULT_TEAM_A, B: (teamB || '').trim() || DEFAULT_TEAM_B },
    squads: squads || { A: [], B: [] },
    squadsSkipped: !squads || ((squads.A?.length || 0) + (squads.B?.length || 0) === 0),
    squadsAutoPicked: false,
    tossDone: false,
    awards: null,
    overs,
    battingFirst,
    status: 'in_progress',
    result: '',
    innings: [],
    currentInnings: 0,
    undo: [],
  };
}

function canScore(m) {
  if (dbOn() && m?.status === 'in_progress') return true;
  return (m.scoringDeviceId !== undefined ? m.scoringDeviceId : m.deviceId) === DEVICE_ID;
}

function claimScoring(m) {
  if (!m) return;
  m.scoringDeviceId = DEVICE_ID;
}

// ---------- Scoring core ----------
function decomposeBall(sel) {
  const runs = sel.runs ?? 0;
  const { extra } = sel;
  const runOut = !!sel.runOut;
  const wicket = !!(sel.wicket || runOut);
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
  return {
    runs, extra, wicket, runOut, runOutEnd: sel.runOutEnd || null,
    totalRuns, batsmanRuns, bowlerConcedes, isLegalBall, extrasAdd,
  };
}

function ballLabel(d) {
  const parts = [];
  if (d.runs) parts.push(d.runs);
  if (d.extra) parts.push(d.extra);
  if (d.runOut) parts.push('RO');
  else if (d.wicket) parts.push('W');
  return parts.join('+') || '0';
}

function selFromLogEntry(entry) {
  return {
    runs: entry.runs ?? 0,
    extra: entry.extra || null,
    wicket: !!entry.wicket && !entry.runOut,
    runOut: !!entry.runOut,
    runOutEnd: entry.runOutEnd || null,
  };
}

function ballSelectionCount(sel) {
  return (sel.runs != null ? 1 : 0) + (sel.extra ? 1 : 0) + (sel.wicket ? 1 : 0) + (sel.runOut ? 1 : 0);
}

function liveOverNo(inn) {
  const balls = inn.score?.balls || 0;
  const currentOver = Math.floor(balls / 6);
  // Between overs (e.g. 1.0, 2.0): show the over that just finished, even after bowler is picked.
  if (balls > 0 && balls % 6 === 0) return currentOver - 1;
  return currentOver;
}

function editableOverNumbers(inn) {
  const live = liveOverNo(inn);
  const overs = [];
  if (live >= 1) overs.push(live - 1);
  overs.push(live);
  return overs;
}

function ballLogGlobalIndex(inn, overNo, slotInOver) {
  let count = 0;
  for (let i = 0; i < inn.ballLog.length; i++) {
    if (inn.ballLog[i].overNo === overNo) {
      if (count === slotInOver) return i;
      count++;
    }
  }
  return -1;
}

function lastBallLogIndex(inn) {
  const overNo = liveOverNo(inn);
  for (let i = inn.ballLog.length - 1; i >= 0; i--) {
    if (inn.ballLog[i].overNo === overNo) return i;
  }
  return -1;
}

function openEditBallByIndex(logIndex) {
  const inn = state.current?.innings?.[state.current?.currentInnings];
  if (!inn || !isLogIndexEditable(inn, logIndex)) return false;
  state.modal = {
    type: 'editBall',
    logIndex,
    sel: selFromLogEntry(inn.ballLog[logIndex]),
  };
  return true;
}

function requestBallEdit(intent) {
  const m = state.current;
  const inn = m?.innings?.[m?.currentInnings];
  if (!inn?.ballLog?.length) {
    showToast('No balls to edit yet');
    return;
  }
  state.editOverIntent = intent || null;
  if (state.overEditUnlocked) {
    if (intent === 'fixLastBall') {
      const idx = lastBallLogIndex(inn);
      if (idx < 0 || !openEditBallByIndex(idx)) showToast('No ball to edit');
    } else {
      showToast('Tap a ball in the over to edit it');
    }
    render();
    return;
  }
  state.modal = { type: 'editOverPin' };
  render();
}

function finishEditOverUnlock() {
  const intent = state.editOverIntent;
  state.editOverIntent = null;
  state.overEditUnlocked = true;
  state.freeUndosUsed = 0;
  state.showLastOver = false;
  state.modal = null;
  render();
  const inn = state.current?.innings?.[state.current?.currentInnings];
  const idx = typeof intent === 'number'
    ? intent
    : (intent === 'fixLastBall' && inn ? lastBallLogIndex(inn) : -1);
  if (idx >= 0 && openEditBallByIndex(idx)) {
    render();
    return;
  }
  showToast('Tap a ball to edit it');
}

function isLogIndexInEditWindow(inn, logIndex) {
  if (!inn || logIndex < 0) return false;
  const entry = inn.ballLog[logIndex];
  if (!entry) return false;
  const live = liveOverNo(inn);
  return entry.overNo === live || entry.overNo === live - 1;
}

function isLogIndexEditable(inn, logIndex) {
  return !!state.overEditUnlocked && isLogIndexInEditWindow(inn, logIndex);
}

function findBowlerIdx(inn, name) {
  const key = (name || '').trim().toLowerCase();
  if (!key) return -1;
  return inn.bowlers.findIndex(b => b.name.toLowerCase() === key);
}

/** Drop stale out flags after undo / edit-over replay; keep wicket count aligned with ball log. */
function reconcileDismissals(inn) {
  if (!inn) return false;
  let changed = false;

  const logWickets = inn.ballLog.filter(e => e.wicket).length;
  if (inn.score.wickets !== logWickets) {
    inn.score.wickets = logWickets;
    changed = true;
  }

  let dismissals = inn.batters.filter(b => b.out && b.dismissal === 'out').length;
  while (dismissals > inn.score.wickets) {
    let cleared = false;
    for (let i = inn.batters.length - 1; i >= 0; i--) {
      const b = inn.batters[i];
      if (b.out && b.dismissal === 'out' && i !== inn.striker && i !== inn.nonStriker) {
        b.out = false;
        b.dismissal = null;
        dismissals -= 1;
        changed = true;
        cleared = true;
        break;
      }
    }
    if (!cleared) break;
  }

  if (!inn.ended) {
    const atStriker = inn.batters[inn.striker];
    const atNonStriker = inn.batters[inn.nonStriker];
    if ((atStriker?.out || atNonStriker?.out) && !inn.needNewBatter) {
      inn.needNewBatter = true;
      changed = true;
    }
  }
  return changed;
}

function syncBowlingFromBallLog(inn) {
  if (!inn?.ballLog?.length) return;
  for (const b of inn.bowlers) {
    b.balls = 0;
    b.runs = 0;
    b.wickets = 0;
  }
  for (const entry of inn.ballLog) {
    const idx = findBowlerIdx(inn, entry.bowler);
    if (idx < 0) continue;
    const d = decomposeBall(selFromLogEntry(entry));
    const bowler = inn.bowlers[idx];
    bowler.runs += d.bowlerConcedes;
    if (d.isLegalBall) bowler.balls += 1;
    if (d.wicket && !entry.runOut) bowler.wickets += 1;
  }
}

function ensureBowlerByName(inn, match, name) {
  const idx = findBowlerIdx(inn, name);
  if (idx >= 0) {
    inn.currentBowler = idx;
    inn.needNewBowler = false;
    return;
  }
  const pid = ensurePlayerOnSide(match, inn.bowling, name, null);
  inn.currentBowler = inn.bowlers.length;
  inn.bowlers.push(newBowler(name, pid));
  inn.needNewBowler = false;
}

function addIncomingBatter(inn, match, name, playerId = null) {
  const trimmed = (name || '').trim();
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  const onCrease = (idx) => idx === inn.striker || idx === inn.nonStriker;
  const liveIdx = inn.batters.findIndex(
    (b, i) => !b.out && b.name.toLowerCase() === key && onCrease(i),
  );
  if (liveIdx >= 0) {
    inn.needNewBatter = false;
    return;
  }
  const idx = inn.batters.length;
  const pid = ensurePlayerOnSide(match, inn.batting, trimmed, playerId);
  inn.batters.push(newBatter(trimmed, pid));
  if (inn.batters[inn.striker]?.out) inn.striker = idx;
  else if (inn.batters[inn.nonStriker]?.out) inn.nonStriker = idx;
  else inn.striker = idx;
  inn.needNewBatter = false;
}

function maxWicketsForInnings(match, inn) {
  // With squads, all out when n-1 wickets fall (last batter standing ends the innings).
  if (match && inn && matchUsesSquads(match)) {
    const n = match.squads?.[inn.batting]?.length || 0;
    if (n >= 2) return n - 1;
  }
  return 10;
}

function applyBallCore(inn, sel, match) {
  const d = decomposeBall(sel);
  const striker = inn.batters[inn.striker];
  const nonStriker = inn.batters[inn.nonStriker];
  const bowler = inn.bowlers[inn.currentBowler];
  const facedName = striker.name;
  const otherName = nonStriker?.name || '';

  striker.runs += d.batsmanRuns;
  if (d.batsmanRuns === 4) striker.fours += 1;
  if (d.batsmanRuns === 6) striker.sixes += 1;
  if (d.isLegalBall) striker.balls += 1;

  bowler.runs += d.bowlerConcedes;
  if (d.isLegalBall) bowler.balls += 1;

  inn.score.runs += d.totalRuns;
  inn.score.extras += d.extrasAdd;
  if (d.isLegalBall) inn.score.balls += 1;

  let dismissedName = null;
  if (d.wicket) {
    const outEnd = d.runOut ? (d.runOutEnd || 'striker') : 'striker';
    const outIdx = outEnd === 'non' ? inn.nonStriker : inn.striker;
    const outBatter = inn.batters[outIdx];
    outBatter.out = true;
    outBatter.dismissal = d.runOut ? 'run out' : 'out';
    dismissedName = outBatter.name;
    inn.score.wickets += 1;
    if (!d.runOut) bowler.wickets += 1;
  }

  if (d.runs % 2 === 1) {
    [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
  }

  const overNo = Math.floor((inn.score.balls - (d.isLegalBall ? 1 : 0)) / 6);
  const logEntry = {
    runs: d.runs, extra: d.extra, wicket: d.wicket, runOut: d.runOut,
    runOutEnd: d.runOut ? (d.runOutEnd || 'striker') : null,
    total: d.totalRuns, label: ballLabel(d), legal: d.isLegalBall, overNo,
    batter: facedName, bowler: bowler.name,
    strikerName: facedName, nonStrikerName: otherName,
    dismissed: dismissedName,
  };

  const maxBalls = match.overs * 6;
  const target = (match.currentInnings === 1) ? inn.target : null;
  const maxWickets = maxWicketsForInnings(match, inn);
  let endNow = false;
  let reason = null;
  if (inn.score.balls >= maxBalls) { endNow = true; reason = 'overs'; }
  else if (inn.score.wickets >= maxWickets) { endNow = true; reason = 'allout'; }
  else if (target != null && inn.score.runs >= target) { endNow = true; reason = 'chased'; }

  if (d.extra === 'nb') inn.freeHit = true;
  else if (d.isLegalBall) inn.freeHit = false;

  if (endNow) {
    inn.ended = true;
    inn.endReason = reason;
    inn.needNewBatter = false;
    inn.needNewBowler = false;
  } else {
    inn.ended = false;
    inn.endReason = null;
    if (d.isLegalBall && inn.score.balls % 6 === 0) {
      // Ends change at every over, wicket or not. The incoming batter takes the
      // vacated crease, so the batter who stayed in faces the first ball of the over.
      [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
      inn.needNewBowler = true;
    }
    if (d.wicket) inn.needNewBatter = true;
  }

  return logEntry;
}

function replayInningsBallLog(match, inningsIdx, entries, editIndex, editSel) {
  const oldInn = match.innings[inningsIdx];
  const inn = newInnings(oldInn.batting, oldInn.bowling);
  if (oldInn.target != null) inn.target = oldInn.target;

  if (!oldInn.batters[0] || !oldInn.batters[1] || !oldInn.bowlers[0]) return false;

  inn.batters.push(newBatter(oldInn.batters[0].name, oldInn.batters[0].playerId));
  inn.batters.push(newBatter(oldInn.batters[1].name, oldInn.batters[1].playerId));
  inn.bowlers.push(newBowler(oldInn.bowlers[0].name, oldInn.bowlers[0].playerId));

  const newLog = [];

  for (let i = 0; i < entries.length; i++) {
    if (inn.ended) break;
    const entry = entries[i];
    const sel = (i === editIndex && editSel) ? editSel : selFromLogEntry(entry);

    if (inn.needNewBatter && entry.batter) {
      addIncomingBatter(inn, match, entry.batter);
    }
    if (inn.needNewBowler || findBowlerIdx(inn, entry.bowler) !== inn.currentBowler) {
      ensureBowlerByName(inn, match, entry.bowler);
    }

    newLog.push(applyBallCore(inn, sel, match));
  }

  inn.ballLog = newLog;
  syncBowlingFromBallLog(inn);
  reconcileDismissals(inn);
  match.innings[inningsIdx] = inn;
  if (inn.ended) {
    if (match.currentInnings === 1) {
      match.status = 'completed';
      match.result = computeResult(match);
      match.endedAt = match.endedAt || Date.now();
    }
  } else {
    match.status = 'in_progress';
    match.result = '';
    match.endedAt = null;
  }
  return true;
}

function editBallAt(match, logIndex, newSel) {
  const inn = match.innings[match.currentInnings];
  if (!inn || !isLogIndexEditable(inn, logIndex)) return false;
  const b = newSel;
  if (b.runs == null && !b.extra && !b.wicket && !b.runOut) return false;

  pushUndo(match, 'ball-edit');
  state.freeUndosUsed = 0;
  const entries = clone(inn.ballLog);
  if (!replayInningsBallLog(match, match.currentInnings, entries, logIndex, {
    runs: b.runs ?? 0,
    extra: b.extra || null,
    wicket: !!b.wicket,
    runOut: !!b.runOut,
    runOutEnd: b.runOutEnd || null,
  })) return false;

  persistMatch(match);
  return true;
}

function editPickBall(field, value) {
  if (state.modal?.type !== 'editBall') return;
  const b = state.modal.sel;
  if (field === 'runs' && b.runs === value) { b.runs = null; scheduleRender(); return; }
  if (field === 'extra' && b.extra === value) { b.extra = null; scheduleRender(); return; }
  if (field === 'wicket' && b.wicket) { b.wicket = false; scheduleRender(); return; }
  if (field === 'runOut' && b.runOut) { b.runOut = false; b.runOutEnd = null; scheduleRender(); return; }

  const presentCount = ballSelectionCount(b);
  const targetPresent = field === 'runs' ? (b.runs != null)
    : field === 'extra' ? !!b.extra
      : field === 'wicket' ? !!b.wicket
        : !!b.runOut;
  if (!targetPresent && presentCount >= 2) {
    showToast('Max 2 selections');
    return;
  }
  if (field === 'runs') b.runs = value;
  else if (field === 'extra') b.extra = value;
  else if (field === 'wicket') { b.wicket = true; b.runOut = false; b.runOutEnd = null; }
  else if (field === 'runOut') { b.runOut = true; b.wicket = false; b.runOutEnd = null; }
  scheduleRender();
}

function finishEditBall() {
  state.modal = null;
  state.ball = emptyBall();
  const m = state.current;
  const inn = m?.innings?.[m?.currentInnings];
  if (!inn) { render(); return; }
  repairScoringState(inn);
  if (inn.ended) afterInningsEnd();
  else { syncScoringModal(); render(); }
}

function snapshotForUndo(m) {
  return {
    innings: clone(m.innings),
    currentInnings: m.currentInnings,
    status: m.status,
    result: m.result,
  };
}

function pushUndo(match, kind = 'ball') {
  if (!match) return;
  normalizeMatch(match);
  const snap = snapshotForUndo(match);
  snap.undoKind = kind;
  match.undo.push(snap);
  if (match.undo.length > MAX_UNDO) match.undo.shift();
}

function lastUndoKind(match) {
  const snap = match?.undo?.[match.undo.length - 1];
  return snap?.undoKind || 'ball';
}

function undoActionLabel(match) {
  const kind = lastUndoKind(match);
  if (kind === 'pick') return '↶ Undo player pick';
  if (kind === 'swap') return '↶ Undo swap strike';
  if (kind === 'retire') return '↶ Undo retire hurt';
  if (kind === 'innings-start') return '↶ Undo start innings';
  if (kind === 'ball-edit') return '↶ Undo ball edit';
  return '↶ Undo last ball';
}

function currentOverNo(inn) {
  if (!inn) return 0;
  return liveOverNo(inn);
}

function undoWouldLeaveCurrentOver(match) {
  if (!match?.undo?.length) return false;
  const inn = match.innings[match.currentInnings];
  if (!inn) return false;
  const snap = match.undo[match.undo.length - 1];
  const snapInn = snap.innings?.[snap.currentInnings];
  if (!snapInn) return false;
  if (snap.currentInnings !== match.currentInnings) return false;
  return currentOverNo(snapInn) === currentOverNo(inn);
}

function repairScoringState(inn) {
  if (!inn || inn.ended) return false;
  let changed = reconcileDismissals(inn);
  const st = inn.striker;
  const ns = inn.nonStriker;
  const atStriker = inn.batters[st];
  const atNonStriker = inn.batters[ns];

  if (atStriker?.out || atNonStriker?.out) {
    if (!inn.needNewBatter) { inn.needNewBatter = true; changed = true; }
  }
  return changed;
}

function inningsDriftedFromBallLog(inn) {
  if (!inn?.ballLog?.length) return false;
  const logWickets = inn.ballLog.filter(e => e.wicket).length;
  const bowlerWkts = inn.bowlers.reduce((s, b) => s + (b.wickets || 0), 0);
  return inn.score.wickets !== logWickets || bowlerWkts !== logWickets;
}

/** Rebuild innings from ball log when score/bowler wickets drift (e.g. after edit-over). */
function healInningsIfDrifted(match) {
  if (!match || state.view !== 'score') return false;
  const inn = match.innings?.[match.currentInnings];
  if (!inn || inn.ended || !inningsDriftedFromBallLog(inn)) return false;
  const entries = clone(inn.ballLog);
  if (!replayInningsBallLog(match, match.currentInnings, entries, -1, null)) return false;
  persistMatch(match);
  return true;
}

/** Inline batter/bowler picker on score screen (replaces over strip). */
function syncScorePick() {
  const m = state.current;
  if (!m || state.view !== 'score') return;
  if (healInningsIfDrifted(m)) {
    // replay updated inn; continue below
  }
  const inn = m.innings?.[m.currentInnings];
  if (!inn || inn.ended) {
    state.scorePick = null;
    if (state.modal?.type === 'newBatter' || state.modal?.type === 'newBowler') state.modal = null;
    return;
  }
  if (repairScoringState(inn)) persistMatch(m);
  if (maybeEndInningsNoBattersLeft(m, inn)) return;
  if (inn.needNewBatter) {
    const prev = state.scorePick?.type === 'batter' ? state.scorePick : null;
    state.scorePick = {
      type: 'batter',
      manual: !!prev?.manual,
      pick: prev?.pick || null,
      draft: prev?.draft || '',
    };
  } else if (inn.needNewBowler) {
    const prev = state.scorePick?.type === 'bowler' ? state.scorePick : null;
    state.scorePick = {
      type: 'bowler',
      manual: !!prev?.manual,
      pick: prev?.pick || null,
      draft: prev?.draft || '',
    };
  } else {
    state.scorePick = null;
  }
  if (state.modal?.type === 'newBatter' || state.modal?.type === 'newBowler') state.modal = null;
}

function pickerCareerLine(p, mode, inn) {
  if (mode === 'bowl') {
    const spell = (inn?.bowlers || []).find(b => innPlayerMatch(b, p));
    if (spell?.balls) return `${fmtOvers(spell.balls)} ov · ${spell.wickets} wkt${spell.wickets === 1 ? '' : 's'}`;
    const wkts = p.bowling?.wickets || 0;
    return wkts ? `${wkts} career wkt${wkts === 1 ? '' : 's'}` : 'Not bowled yet';
  }
  const runs = p.batting?.runs || 0;
  return runs > 0 ? `${runs} career runs` : 'New to the crease';
}

function spellBalls(inn, player) {
  return (inn?.bowlers || []).find(b => innPlayerMatch(b, player))?.balls || 0;
}

function renderScorePickCards(inn, isBatter) {
  const sp = state.scorePick;
  const mode = isBatter ? 'bat' : 'bowl';
  const action = isBatter ? 'pick-new-batter' : 'pick-new-bowler';
  const opts = { blockOnField: isBatter, blockConsecutive: !isBatter };
  const players = rosterForScoringPicker(inn, mode);
  const filter = (state.playerPickerFilter || '').trim().toLowerCase();
  let filtered = filter
    ? players.filter(p => p.name.toLowerCase().includes(filter))
    : players.slice();
  if (isBatter) filtered = sortPlayersForPicker(filtered);
  else {
    filtered = [...filtered].sort((a, b) =>
      spellBalls(inn, a) - spellBalls(inn, b) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }
  const ready = filtered.filter(p => !pickerDisabledReason(inn, p, mode, opts));
  const blocked = filtered.filter(p => pickerDisabledReason(inn, p, mode, opts));
  const card = (p) => {
    const reason = pickerDisabledReason(inn, p, mode, opts);
    const selected = !reason && sp.pick && (
      (sp.pick.id && sp.pick.id === p.id) ||
      sp.pick.name?.toLowerCase() === p.name.toLowerCase()
    );
    return `
      <button type="button" class="sc-card${selected ? ' sc-sel' : ''}${reason ? ' sc-off' : ''}"
        data-action="${reason ? '' : action}"
        data-player-id="${esc(p.id)}"
        data-player-name="${esc(p.name)}"
        ${reason ? 'disabled' : ''}>
        ${selected ? '<span class="sc-av bcc-an">✓</span>' : playerAvatarHtml(p, '', 'sc-av')}
        <span class="sc-tx">
          <span class="sc-nm">${esc(p.name)}</span>
          <span class="sc-sub">${esc(reason || pickerCareerLine(p, mode, inn))}</span>
        </span>
      </button>`;
  };
  const readyLabel = isBatter ? 'Available batters' : 'Available bowlers · fewest overs first';
  const typedName = (state.playerPickerFilter || '').trim().replace(/\s+/g, ' ');
  const exact = typedName && players.some(p => p.name.toLowerCase() === typedName.toLowerCase());
  const addCard = typedName && !exact ? `
    <button type="button" class="sc-card sc-add" data-action="score-add-new" data-player-name="${esc(typedName)}">
      <span class="sc-av">+</span>
      <span class="sc-tx">
        <span class="sc-nm">Add “${esc(typedName)}”</span>
        <span class="sc-sub">New player for this match</span>
      </span>
    </button>` : '';
  return `
    <div class="sc-srch"><input id="score-pick-query" class="player-picker-filter" type="search" placeholder="Find player…" value="${esc(state.playerPickerFilter || '')}" autocomplete="off" autocapitalize="off" enterkeyhint="search" /></div>
    <div class="bcc-pick-scroll sc-list">
      ${addCard}
      ${filtered.length ? `
        ${ready.length ? `<div class="sc-lbl">${esc(readyLabel)}<b>${ready.length}</b></div><div class="sc-grid">${ready.map(card).join('')}</div>` : ''}
        ${blocked.length ? `<div class="sc-lbl sc-dim">Not available<b>${blocked.length}</b></div><div class="sc-grid">${blocked.map(card).join('')}</div>` : ''}
      ` : `<p class="sc-empty">${players.length ? (addCard ? 'No saved player has that exact name.' : `No names match “${esc(filter)}”`) : 'No saved players — add a name below.'}</p>`}
    </div>
    <button type="button" class="sc-new" data-action="toggle-modal-manual">${sp.manual ? 'Cancel new name' : '+ New name'}</button>
    <div class="sc-manual${sp.manual ? ' sc-on' : ''}">
      <input id="${isBatter ? 'new-batter-input' : 'new-bowler-input'}" type="text" placeholder="Type name…" value="${esc(sp.draft || '')}" autocomplete="off" autocapitalize="words" />
    </div>
  `;
}

function renderInlineScorePicker(inn) {
  const sp = state.scorePick;
  if (!sp) return '';
  const isBatter = sp.type === 'batter';
  const title = isBatter ? 'Pick next batter' : 'Pick next bowler';
  const creaseOut = inn.batters[inn.striker]?.out || inn.batters[inn.nonStriker]?.out;
  const retiredHurt = creaseOut && (
    inn.batters[inn.striker]?.dismissal === 'retired hurt' ||
    inn.batters[inn.nonStriker]?.dismissal === 'retired hurt'
  );
  const outBatter = [inn.batters[inn.striker], inn.batters[inn.nonStriker]].find(b => b?.out);
  const overRuns = (inn.ballLog || [])
    .filter(ball => ball.overNo === liveOverNo(inn))
    .reduce((sum, ball) => sum + (Number(ball.total) || 0), 0);
  let subtitle = isBatter ? 'Tap a name below' : 'Tap the next bowler';
  if (isBatter && outBatter) {
    const how = outBatter.dismissal === 'retired hurt'
      ? 'retired hurt'
      : outBatter.dismissal === 'run out' ? 'is run out' : 'is out';
    subtitle = `${outBatter.name} ${how} · ${outBatter.runs} (${outBatter.balls}) — tap a name below`;
  } else if (!isBatter) {
    const done = Math.floor((inn.score.balls || 0) / 6);
    subtitle = `Over ${done} complete · ${overRuns} runs — tap the next bowler`;
  }
  const retiring = retiredHurt && lastUndoKind(state.current) === 'retire';
  const goName = (sp.manual ? (sp.draft || '') : (sp.pick?.name || '')).trim();
  const goLabel = goName
    ? `Continue · ${goName}`
    : sp.manual ? 'Type a name' : (isBatter ? 'Tap a batter above' : 'Tap a bowler above');
  return `
    <div class="sc-sheet${isBatter ? '' : ' sc-bowl'}">
      ${retiring ? `<button type="button" class="sc-cx" data-action="undo" aria-label="Cancel">✕</button>` : ''}
      <div class="sc-grab"></div>
      <div class="sc-hd">
        <h2>${esc(title)}</h2>
        <p>${esc(subtitle)}</p>
      </div>
      ${renderScorePickCards(inn, isBatter)}
      <button type="button" class="sc-go${goName ? '' : ' sc-idle'}" data-action="${isBatter ? 'confirm-new-batter' : 'confirm-new-bowler'}">${esc(goLabel)}</button>
      ${retiring ? `<button type="button" class="sc-cnl" data-action="undo">Cancel — keep ${esc(outBatter?.name || 'them')} batting</button>` : `<button type="button" class="sc-cnl" data-action="end-innings">End innings</button>`}
    </div>
  `;
}

/** @deprecated alias */
function syncScoringModal() {
  syncScorePick();
}

function canUndoNow(match) {
  if (!match?.undo?.length) return false;
  const kind = lastUndoKind(match);
  if (kind === 'pick' || kind === 'swap' || kind === 'retire' || kind === 'innings-start' || kind === 'ball-edit') return true;
  if (kind !== 'ball') return false;

  const inn = match.innings?.[match.currentInnings];
  if (!inn) return false;

  const overOk = undoWouldLeaveCurrentOver(match);
  if (inn.needNewBatter) {
    if (state.overEditUnlocked) return overOk;
    return state.freeUndosUsed < FREE_UNDO && overOk;
  }
  if (inn.needNewBowler) {
    return state.overEditUnlocked ? overOk : false;
  }

  if (state.overEditUnlocked) return overOk;
  return state.freeUndosUsed < FREE_UNDO && overOk;
}

function recordBall(match, sel) {
  pushUndo(match, 'ball');
  state.freeUndosUsed = 0;

  const inn = match.innings[match.currentInnings];
  const overBefore = currentOverNo(inn);
  const wasFreeHit = inn.freeHit;
  const logEntry = applyBallCore(inn, sel, match);
  inn.ballLog.push(logEntry);

  if (currentOverNo(inn) !== overBefore) state.overEditUnlocked = false;

  const d = decomposeBall(sel);
  audio.onBall(d, wasFreeHit);
  if (!inn.ended && d.isLegalBall && inn.score.balls % 6 === 0) audio.onOverEnd();
  persistMatch(match);
  showEventBanner(buildEventBanner(d), 1800, true);
}

function undoBall(match) {
  if (!canUndoNow(match)) return false;
  const snap = match.undo.pop();
  const kind = snap.undoKind || 'ball';
  match.innings = snap.innings;
  match.currentInnings = snap.currentInnings;
  match.status = snap.status;
  match.result = snap.result;
  if (snap.squads) match.squads = snap.squads;
  if (kind === 'ball') state.freeUndosUsed += 1;
  else state.freeUndosUsed = 0;
  persistMatch(match);
  return true;
}

function afterUndoMatch() {
  state.ball = emptyBall();
  state.modal = null;
  const m = state.current;
  const inn = m?.innings?.[m?.currentInnings];
  if (!inn) {
    const pre = viewBeforeFirstInnings(m);
    state.view = pre || 'innings-setup';
    render();
    return;
  }
  if (reconcileDismissals(inn)) persistMatch(m);
  if (inn.ended) {
    afterInningsEnd();
    return;
  }
  syncScorePick();
  render();
}

function retireHurt(match, end) {
  const inn = match?.innings?.[match.currentInnings];
  if (!inn || inn.ended || inn.needNewBatter || inn.needNewBowler) return false;
  const idx = end === 'non' ? inn.nonStriker : inn.striker;
  const b = inn.batters[idx];
  if (!b || b.out) return false;

  pushUndo(match, 'retire');
  state.freeUndosUsed = 0;
  b.out = true;
  b.dismissal = 'retired hurt';
  inn.needNewBatter = true;
  persistMatch(match);
  return true;
}

function swapStrike(match) {
  const inn = match?.innings?.[match.currentInnings];
  if (!inn || inn.ended || inn.needNewBatter) return false;
  const a = inn.batters[inn.striker];
  const b = inn.batters[inn.nonStriker];
  if (!a || !b || a.out || b.out) return false;
  pushUndo(match, 'swap');
  state.freeUndosUsed = 0;
  [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
  persistMatch(match);
  return true;
}

function addBatter(inn, name, playerId = null) {
  const trimmed = (name || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return false;
  if (!inn.needNewBatter) {
    showToast('No batter slot to fill');
    return false;
  }
  if (batterOutInInnings(inn, { id: playerId, name: trimmed })) {
    showToast('That batter is already out');
    return false;
  }
  if (batterNotOutOnField(inn, { id: playerId, name: trimmed })) {
    showToast('Already batting');
    return false;
  }
  pushUndo(state.current, 'pick');
  state.freeUndosUsed = 0;
  playerId = ensurePlayerOnSide(state.current, inn.batting, trimmed, playerId);
  if (window.QCPlayers && !playerId) {
    state.current?.undo?.pop();
    return false;
  }
  const idx = inn.batters.length;
  inn.batters.push(newBatter(trimmed, playerId));

  const strikerOut = inn.batters[inn.striker]?.out;
  const nonStrikerOut = inn.batters[inn.nonStriker]?.out;
  if (strikerOut) inn.striker = idx;
  else if (nonStrikerOut) inn.nonStriker = idx;
  else {
    const outIdx = inn.batters.findIndex((b, i) => i < idx && b.out);
    if (outIdx === inn.striker) inn.striker = idx;
    else if (outIdx === inn.nonStriker) inn.nonStriker = idx;
    else if (outIdx >= 0) inn.striker = idx;
    else inn.striker = idx;
  }

  inn.needNewBatter = false;
  return true;
}

function addBowler(inn, name, playerId = null) {
  const trimmed = (name || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return false;
  if (!inn.needNewBowler) {
    showToast('No bowler slot to fill');
    return false;
  }
  if (isConsecutiveBowler(inn, { id: playerId, name: trimmed })) {
    showToast("Can't bowl consecutive overs");
    return false;
  }
  if (batterNotOutOnField(inn, { id: playerId, name: trimmed })) {
    showToast('Already batting');
    return false;
  }
  pushUndo(state.current, 'pick');
  state.freeUndosUsed = 0;
  playerId = ensurePlayerOnSide(state.current, inn.bowling, trimmed, playerId);
  if (window.QCPlayers && !playerId) {
    state.current?.undo?.pop();
    return false;
  }
  const key = trimmed.toLowerCase();
  const existing = inn.bowlers.findIndex(b =>
    (playerId && b.playerId === playerId) || b.name.toLowerCase() === key
  );
  if (existing >= 0) {
    inn.currentBowler = existing;
    if (playerId && !inn.bowlers[existing].playerId) inn.bowlers[existing].playerId = playerId;
  } else {
    inn.currentBowler = inn.bowlers.length;
    inn.bowlers.push(newBowler(trimmed, playerId));
  }
  inn.needNewBowler = false;
  return true;
}

// ---------- Transitions ----------
function goToMatchStart() {
  resetInningsPickers();
  const useAvailability = state.players.length > 0 && !state.setup.skipTeamPick;
  if (useAvailability) {
    const sorted = [...state.players].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    state.matchAvailability = { ids: sorted.map(p => p.id) };
    state.teamPick = { squads: { A: [], B: [] }, picking: 'A', mode: 'pick', autoBalanced: false };
    state.teamPickUndo = [];
    state.view = 'match-availability';
  } else {
    if (state.current) state.current.squadsSkipped = true;
    if (!enterTossView()) render();
  }
}

function startMatch(teamA, teamB, overs, squads = null, venue = DEFAULT_VENUE) {
  resetInningsPickers();
  state.overEditUnlocked = false;
  state.freeUndosUsed = 0;
  state.current = newMatch(teamA, teamB, overs, 'A', squads, venue);
  normalizeMatch(state.current);
  if (squads) {
    state.current.tossDone = false;
    if (!enterTossView()) render();
  } else {
    goToMatchStart();
  }
  persistMatch(state.current);
}

function startInnings(strikerName, nonStrikerName, bowlerName, strikerId = null, nonStrikerId = null, bowlerId = null) {
  const m = state.current;
  pushUndo(m, 'innings-start');
  state.freeUndosUsed = 0;
  const isFirst = m.innings.length === 0;
  const batting = isFirst ? m.battingFirst : (m.battingFirst === 'A' ? 'B' : 'A');
  const bowling = batting === 'A' ? 'B' : 'A';
  strikerId = ensurePlayerOnSide(m, batting, strikerName, strikerId);
  nonStrikerId = ensurePlayerOnSide(m, batting, nonStrikerName, nonStrikerId);
  bowlerId = ensurePlayerOnSide(m, bowling, bowlerName, bowlerId);
  const inn = newInnings(batting, bowling);
  inn.batters.push(newBatter(strikerName, strikerId));
  inn.batters.push(newBatter(nonStrikerName, nonStrikerId));
  inn.bowlers.push(newBowler(bowlerName, bowlerId));
  if (!isFirst) inn.target = m.innings[0].score.runs + 1;
  m.innings.push(inn);
  m.currentInnings = m.innings.length - 1;
  m.tossDone = true;
  state.overEditUnlocked = false;
  state.inningsPickUndo = [];
  state.view = 'score';
  persistMatch(m);
  if (isFirst) audio.onMatchStart();
}

function endInningsManually() {
  const inn = state.current.innings[state.current.currentInnings];
  inn.ended = true;
  inn.endReason = 'manual';
  inn.needNewBatter = false;
  inn.needNewBowler = false;
  persistMatch(state.current);
}

function completeMatch() {
  const m = state.current;
  if (!m) return;
  m.status = 'completed';
  m.endedAt = Date.now();
  m.result = computeResult(m);
  m.undo = [];

  try {
    if (window.QCPlayers) {
      m.awards = window.QCPlayers.computeAwards(m, state.players);
      state.players = window.QCPlayers.applyMatchStats(m, state.players);
    }
  } catch (err) {
    console.warn('match awards/stats failed', err);
  }

  if (dbOn()) {
    // Drop any coalesced in-progress write so it can't overwrite the final result.
    window.QCDB.cancelSync?.(m.id);
    window.QCDB.syncMatch(m);
  }
  state.history = [m, ...state.history.filter(x => x.id !== m.id)];
  saveHistory(state.history);

  state.detail = m;
  state.current = null;
  saveCurrent(null);
  state.scorePick = null;
  state.summaryInn = 0;
  state.summaryBalls = false;
  state.view = 'result';
  try { audio.onMatchWin(m.result); } catch { /* ignore */ }
}

function computeResult(m) {
  if (m.innings.length < 2) return 'Match ended early';
  const i1 = m.innings[0], i2 = m.innings[1];
  const team2 = m.teams[i2.batting], team1 = m.teams[i1.batting];
  if (i2.score.runs > i1.score.runs) {
    // Squad matches end at squad size - 1 wickets, so the margin depends on that cap.
    const w = maxWicketsForInnings(m, i2) - i2.score.wickets;
    return `${team2} won by ${w} wicket${w !== 1 ? 's' : ''}`;
  } else if (i1.score.runs > i2.score.runs) {
    const r = i1.score.runs - i2.score.runs;
    return `${team1} won by ${r} run${r !== 1 ? 's' : ''}`;
  }
  return 'Match tied';
}

function afterBall() {
  const inn = state.current?.innings?.[state.current.currentInnings];
  if (!inn) { render(); return; }
  if (inn.ended) {
    afterInningsEnd();
  } else {
    if (maybeEndInningsNoBattersLeft(state.current, inn)) {
      afterInningsEnd();
      return;
    }
    syncScorePick();
    render();
  }
}

function afterInningsEnd() {
  const m = state.current;
  if (!m) { render(); return; }
  if (m.currentInnings === 0) {
    state.view = 'innings-break';
    state.scorePick = null;
    persistMatch(m);
    render();
  } else {
    completeMatch();
    render();
  }
}

/** If squad batting is exhausted, end the innings instead of stalling on "pick batter". */
function maybeEndInningsNoBattersLeft(match, inn) {
  if (!match || !inn || inn.ended || !inn.needNewBatter) return false;
  if (!matchUsesSquads(match)) return false;
  const list = rosterForScoringPicker(inn, 'bat');
  const eligible = list.some(p => !pickerDisabledReason(inn, p, 'bat', { blockOnField: true }));
  if (eligible) return false;
  inn.ended = true;
  inn.endReason = 'allout';
  inn.needNewBatter = false;
  inn.needNewBowler = false;
  persistMatch(match);
  return true;
}

/** Open the right screen for an in-progress match; complete it if the last innings already ended. */
function openMatchScoringView(m) {
  if (!m) { state.view = 'home'; return; }
  const pre = viewBeforeFirstInnings(m);
  if (pre) {
    state.view = pre;
    return;
  }
  const inn = m.innings?.[m.currentInnings];
  if (!inn) {
    state.view = 'innings-setup';
    return;
  }
  if (inn.ended) {
    state.view = 'score';
    // Let render/advanceIfInningsEnded finish the break or result transition.
    return;
  }
  state.view = 'score';
}

/** Heal matches that ended but never transitioned (e.g. stale sync / resume). */
function advanceIfInningsEnded() {
  const m = state.current;
  if (!m || m.status === 'completed') return false;
  const inn = m.innings?.[m.currentInnings];
  if (!inn) return false;
  if (maybeEndInningsNoBattersLeft(m, inn) || inn.ended) {
    afterInningsEnd();
    return true;
  }
  return false;
}

// ---------- Selection helpers ----------
function scoringPickActive() {
  const inn = state.current?.innings?.[state.current?.currentInnings];
  return !!(inn && (inn.needNewBatter || inn.needNewBowler) && !inn.ended);
}

function markPadButton(btn, on) {
  if (!btn) return;
  btn.classList.toggle('sc-sel', on);
  btn.classList.toggle('selected', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function updateScoreInputUI() {
  const root = $('app');
  if (!root || state.view !== 'score' || state.shared) return false;
  const b = state.ball;
  root.querySelectorAll('[data-action="select-run"]').forEach((btn) => {
    const n = parseInt(btn.dataset.runs, 10);
    markPadButton(btn, b.runs === n);
  });
  root.querySelectorAll('[data-action="select-extra"]').forEach((btn) => {
    markPadButton(btn, b.extra === btn.dataset.extra);
  });
  const wkt = root.querySelector('[data-action="select-wkt"]');
  markPadButton(wkt, !!b.wicket);
  const ro = root.querySelector('[data-action="select-ro"]');
  markPadButton(ro, !!b.runOut);
  const inn = state.current?.innings?.[state.current?.currentInnings];
  const selCount = ballSelectionCount(b);
  const canNext = selCount > 0 && !inn?.needNewBatter && !inn?.needNewBowler && !inn?.ended;
  const nextBtn = root.querySelector('[data-action="next-ball"]');
  if (nextBtn) nextBtn.disabled = !canNext;
  return true;
}

function pickBall(field, value) {
  if (scoringPickActive()) return;
  const b = state.ball;
  if (field === 'runs' && b.runs === value) { b.runs = null; updateScoreInputUI() || scheduleRender(); return; }
  if (field === 'extra' && b.extra === value) { b.extra = null; updateScoreInputUI() || scheduleRender(); return; }
  if (field === 'wicket' && b.wicket) { b.wicket = false; updateScoreInputUI() || scheduleRender(); return; }
  if (field === 'runOut' && b.runOut) { b.runOut = false; b.runOutEnd = null; updateScoreInputUI() || scheduleRender(); return; }

  const presentCount = ballSelectionCount(b);
  const targetPresent = field === 'runs' ? (b.runs != null)
    : field === 'extra' ? !!b.extra
      : field === 'wicket' ? !!b.wicket
        : !!b.runOut;
  if (!targetPresent && presentCount >= 2) {
    showToast('Max 2 selections');
    return;
  }
  if (field === 'runs') b.runs = value;
  else if (field === 'extra') b.extra = value;
  else if (field === 'wicket') { b.wicket = true; b.runOut = false; b.runOutEnd = null; }
  else if (field === 'runOut') { b.runOut = true; b.wicket = false; b.runOutEnd = null; }
  updateScoreInputUI() || scheduleRender();
}

function finalizeBallCommit(sel) {
  recordBall(state.current, sel);
  state.ball = emptyBall();
  state.showLastOver = false;
  afterBall();
}

function commitBall() {
  if (scoringPickActive()) {
    showToast(state.scorePick?.type === 'batter' ? 'Pick the next batter first' : 'Pick the next bowler first');
    return;
  }
  const inn = state.current?.innings?.[state.current?.currentInnings];
  if (inn?.needNewBatter) {
    syncScoringModal();
    render();
    showToast('Pick the next batter first');
    return;
  }
  if (inn?.needNewBowler) {
    syncScoringModal();
    render();
    showToast('Pick the next bowler first');
    return;
  }
  const b = state.ball;
  if (b.runs == null && !b.extra && !b.wicket && !b.runOut) return;
  const sel = {
    runs: b.runs ?? 0,
    extra: b.extra,
    wicket: b.wicket,
    runOut: b.runOut,
    runOutEnd: b.runOutEnd,
  };
  if (sel.runOut && !sel.runOutEnd) {
    const inn = state.current.innings[state.current.currentInnings];
    state.modal = {
      type: 'runOutPick',
      sel,
      strikerName: inn.batters[inn.striker]?.name || 'Striker',
      nonStrikerName: inn.batters[inn.nonStriker]?.name || 'Non-striker',
      source: 'score',
    };
    render();
    return;
  }
  finalizeBallCommit(sel);
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
  const shareText = 'QuickCric scorecard';
  if (navigator.share) {
    navigator.share({ title: shareText, url }).catch(() => copyShare(url));
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

let activeMatchPollTimer = null;
const ACTIVE_MATCH_VIEWS = new Set(['score', 'innings-setup', 'innings-break', 'team-pick', 'match-availability', 'match-toss']);

function startActiveMatchPoll(id) {
  if (activeMatchPollTimer && state._pollMatchId === id) return;
  stopActiveMatchPoll();
  state._pollMatchId = id;
  activeMatchPollTimer = setInterval(async () => {
    if (!state.current || state.current.id !== id) return;
    try {
      const r = await window.QCDB.loadMatch(id);
      if (!r?.match) return;
      const remote = normalizeMatch(r.match);
      if (JSON.stringify(remote) === JSON.stringify(state.current)) return;
      state.current = remote;
      state.history = [remote, ...state.history.filter(x => x.id !== id)];
      render();
    } catch { /* ignore */ }
  }, POLL_INTERVAL_MS);
}

function stopActiveMatchPoll() {
  if (activeMatchPollTimer) {
    clearInterval(activeMatchPollTimer);
    activeMatchPollTimer = null;
  }
  state._pollMatchId = null;
}

function syncActiveMatchPoll() {
  const m = state.current;
  // Never pull remote over local while this device is scoring — cloud copy has no undo stack.
  const scoringHere = m && canScore(m);
  if (dbOn() && m?.id && m.status === 'in_progress' && ACTIVE_MATCH_VIEWS.has(state.view) && !scoringHere) {
    startActiveMatchPoll(m.id);
  } else {
    stopActiveMatchPoll();
  }
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
    state.sharedScorecardOpen = undefined;
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
const SCROLL_RESTORE_SEL = '.setup-body, .scroll, .break-screen, .result-screen, .score-body, .bcc-sum .bcc-scroll, .bcc-pick-scroll';

function captureScrollPositions(container) {
  return [...container.querySelectorAll(SCROLL_RESTORE_SEL)].map(el => el.scrollTop);
}

function restoreScrollPositions(container, tops) {
  const els = container.querySelectorAll(SCROLL_RESTORE_SEL);
  tops.forEach((top, i) => {
    const el = els[i];
    if (el) el.scrollTop = top;
  });
}

function rememberHistoryScroll() {
  const el = document.querySelector('#app .bcc-past .bcc-scroll');
  if (el) state.historyScroll = el.scrollTop;
}

/** Put the past-matches list back where the user left it. */
function bindHistoryScrollRestore(root) {
  const el = root.querySelector('.bcc-past .bcc-scroll');
  if (!el) return;
  const top = state.historyScroll || 0;
  let ignore = true;
  const apply = () => { el.scrollTop = top; };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(() => { ignore = false; });
  });
  el.addEventListener('scroll', () => {
    if (ignore) return;
    state.historyScroll = el.scrollTop;
  }, { passive: true });
}

let renderScheduled = false;

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderNow();
  });
}

function render() {
  scheduleRender();
}

// Browser back follows the on-screen back control. Home is the root entry.
const SCREEN_BACK = {
  setup: 'back-home',
  'match-availability': 'back-from-availability',
  'team-pick': 'back-from-team-pick',
  'match-toss': 'back-from-toss',
  'innings-setup': 'back-from-innings-setup',
  score: 'home',
  'innings-break': 'home',
  result: 'back-to-matches',
  detail: 'back-to-matches',
  players: 'back-home',
  'player-detail': 'players',
  history: 'back-home',
  'in-progress': 'back-home',
  admin: 'back-from-admin',
  terms: 'back-home',
  view: 'back-home',
};

const MODAL_BACK = {
  adminPin: 'cancel-admin-pin',
  deletePlayerPin: 'cancel-delete-player-pin',
  deleteMatchPin: 'cancel-delete-match-pin',
  editPlayerName: 'cancel-edit-player-name',
  runOutPick: 'cancel-run-out-pick',
  editBall: 'cancel-edit-ball',
  editOverPin: 'cancel-edit-over-pin',
  retireHurt: 'cancel-retire-hurt',
  confirmSwapStrike: 'cancel-swap-strike',
  abort: 'dont-abort',
  install: 'close-install',
};

let qcStack = [];
let qcEpoch = 1;
let qcSilent = 0;
let qcNavReady = false;
let qcAfterSilent = null;
let qcRewind = false;

function currentNavToken() {
  const screen = state.shared ? 'view' : (state.view || 'home');
  return state.modal?.type ? `${screen}#${state.modal.type}` : screen;
}

function backActionFor(token) {
  if (!token) return null;
  const cut = token.indexOf('#');
  if (cut !== -1) return MODAL_BACK[token.slice(cut + 1)] || null;
  return SCREEN_BACK[token] || null;
}

function writeNavState(token, index, mode) {
  const payload = { qc: token, i: index, epoch: qcEpoch };
  if (mode === 'replace') history.replaceState(payload, '');
  else history.pushState(payload, '');
}

function bootNavHistory() {
  const token = currentNavToken();
  qcEpoch += 1;
  if (token === 'home') {
    qcStack = ['home'];
    writeNavState('home', 0, 'replace');
  } else {
    qcStack = ['home', token];
    writeNavState('home', 0, 'replace');
    writeNavState(token, 1, 'push');
  }
  qcNavReady = true;
}

function reuseNavIndex(token, rewind) {
  const idx = qcStack.lastIndexOf(token);
  if (idx < 0 || idx >= qcStack.length - 1) return -1;
  if (rewind || token === 'home') return idx;
  const tip = qcStack[qcStack.length - 1];
  if (tip.includes('#')) return idx;
  if (idx === qcStack.length - 2) return idx;
  return -1;
}

function syncNavHistory() {
  if (!qcNavReady || qcSilent) return;
  const token = currentNavToken();
  const rewind = qcRewind;
  qcRewind = false;
  if (!qcStack.length) {
    qcStack = [token];
    writeNavState(token, 0, 'replace');
    return;
  }
  if (qcStack[qcStack.length - 1] === token) {
    const st = history.state;
    if (!st || st.qc !== token || st.epoch !== qcEpoch) writeNavState(token, qcStack.length - 1, 'replace');
    return;
  }
  const idx = reuseNavIndex(token, rewind);
  if (idx >= 0) {
    const steps = qcStack.length - 1 - idx;
    qcStack = qcStack.slice(0, idx + 1);
    if (steps > 0) {
      qcSilent = 1;
      history.go(-steps);
    }
    return;
  }
  qcStack.push(token);
  writeNavState(token, qcStack.length - 1, 'push');
}

function applyBrowserBack() {
  if (qcStack.length <= 1) return;
  const leaving = qcStack.pop();
  const action = backActionFor(leaving);
  if (!action) return;
  qcRewind = true;
  handle(action, {});
}

function onNavPopState() {
  if (qcSilent > 0) {
    qcSilent -= 1;
    if (qcSilent === 0 && qcAfterSilent) {
      const fn = qcAfterSilent;
      qcAfterSilent = null;
      fn();
    }
    return;
  }
  const st = history.state;
  if (st?.epoch === qcEpoch && typeof st.i === 'number') {
    if (st.i === qcStack.length - 1) return;
    if (st.i >= qcStack.length) {
      qcSilent = 1;
      history.back();
      return;
    }
    const steps = qcStack.length - 1 - st.i;
    if (steps > 1) {
      qcSilent = 1;
      qcAfterSilent = applyBrowserBack;
      history.go(steps - 1);
      return;
    }
  }
  applyBrowserBack();
}

function browserBackMatches(action) {
  return !!action && action === backActionFor(currentNavToken()) && qcStack.length > 1;
}

function renderNow() {
  const root = $('app');

  const scrollTops = captureScrollPositions(root);

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
  if (view === 'score') {
    // If an innings already ended (resume / stale sync), advance instead of scoring further.
    if (advanceIfInningsEnded()) return;
    syncScorePick();
    if (state.current?.innings?.[state.current.currentInnings]?.ended) {
      advanceIfInningsEnded();
      return;
    }
    view = state.view;
  }
  switch (view) {
    case 'home': html = renderHome(); break;
    case 'setup': html = renderSetup(); break;
    case 'match-availability': html = renderMatchAvailability(); break;
    case 'team-pick': html = renderTeamPick(); break;
    case 'match-toss': html = renderMatchToss(); break;
    case 'innings-setup': html = renderInningsSetup(); break;
    case 'score': html = renderScore(); break;
    case 'innings-break': html = renderInningsBreak(); break;
    case 'result': html = renderDetail(); break;
    case 'history': html = renderHistory(); break;
    case 'in-progress': html = renderInProgress(); break;
    case 'detail': html = renderDetail(); break;
    case 'players': html = renderPlayers(); break;
    case 'seasons': html = renderSeasons(); break;
    case 'wrapped': html = renderWrapped(); break;
    case 'player-detail': html = renderPlayerDetail(); break;
    case 'view': html = renderSharedView(); break;
    case 'terms': html = renderTerms(); break;
    case 'admin':
      if (!state.adminUnlocked) {
        state.view = 'home';
        html = renderHome();
      } else {
        html = renderAdmin();
      }
      break;
    default: html = renderHome();
  }
  if (state.modal) html += renderModal();
  if (state.eventBanner) {
    const b = state.eventBanner;
    html += `<div class="event-banner kind-${esc(b.kind)}"><div class="big">${esc(b.big)}</div>${b.sub ? `<div class="sub">${esc(b.sub)}</div>` : ''}</div>`;
  }
  if (state.toast) html += `<div class="toast">${esc(state.toast)}</div>`;
  root.innerHTML = html;

  restoreScrollPositions(root, scrollTops);
  requestAnimationFrame(() => restoreScrollPositions(root, scrollTops));
  if (view === 'history') bindHistoryScrollRestore(root);

  Object.entries(savedInputs).forEach(([id, value]) => {
    if (!value) return;
    const el = document.getElementById(id);
    if (el && !el.value) el.value = value;
  });

  if (focusedId) {
    const el = document.getElementById(focusedId);
    if (el) {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
      if (selStart != null && selEnd != null) {
        try { el.setSelectionRange(selStart, selEnd); } catch { }
      }
    }
  } else if (state.scorePick?.manual && state.scorePick.type === 'batter') {
    try {
      $('new-batter-input')?.focus({ preventScroll: true });
    } catch {
      $('new-batter-input')?.focus();
    }
  } else if (state.scorePick?.manual && state.scorePick.type === 'bowler') {
    try {
      $('new-bowler-input')?.focus({ preventScroll: true });
    } catch {
      $('new-bowler-input')?.focus();
    }
  } else if (state.modal?.type === 'deletePlayerPin' || state.modal?.type === 'deleteMatchPin') {
    const pinInput = $('delete-match-pin-input') || $('delete-player-pin-input');
    try {
      pinInput?.focus({ preventScroll: true });
    } catch {
      pinInput?.focus();
    }
  } else if (state.modal?.type === 'editPlayerName') {
    try {
      $('edit-player-name-input')?.focus({ preventScroll: true });
    } catch {
      $('edit-player-name-input')?.focus();
    }
  } else if (state.modal?.type === 'adminPin') {
    try {
      $('admin-pin-input')?.focus({ preventScroll: true });
    } catch {
      $('admin-pin-input')?.focus();
    }
  }
  syncActiveMatchPoll();
  syncNavHistory();
}

function renderTopbar(title, opts = {}) {
  const { back = 'back-home', right = '' } = opts;
  return `
    <div class="bcc-top">
      <button type="button" class="bcc-ib" data-action="${back}" aria-label="Back">←</button>
      <span class="bcc-an">${esc(title)}</span>
      ${right ? `<div class="bcc-top-side">${right}</div>` : ''}
    </div>
    <div class="bcc-art"></div>`;
}

function renderEyeIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}

function setupSteps(step) {
  return `<div class="bcc-steps">${[1, 2, 3, 4].map(n => `<i class="${n <= step ? 'on' : ''}"></i>`).join('')}</div><div class="bcc-art"></div>`;
}

function setupTop(title, sub, back, extra = '') {
  return `
    <div class="bcc-top bcc-top--tall">
      <button type="button" class="bcc-ib" data-action="${back}" aria-label="Back">←</button>
      <div class="bcc-setup-t"><span class="bcc-an">${title}</span>${sub ? `<small>${sub}</small>` : ''}</div>
      ${extra}
    </div>`;
}

function iconBtn(action, icon, extraClass = '', title = '') {
  const t = title ? ` title="${esc(title)}" aria-label="${esc(title)}"` : '';
  return `<button type="button" class="btn btn-sm btn-outline-light rounded-circle qc-icon-btn ${extraClass}" data-action="${action}"${t}><i class="bi bi-${icon}"></i></button>`;
}

function renderBottomBar(label, action, variant = 'primary') {
  return `
    <div class="qc-bottom-bar border-top bg-body px-3 py-3 mt-auto">
      <button type="button" class="btn btn-${variant} btn-lg w-100 fw-bold" data-action="${action}">${esc(label)}</button>
    </div>`;
}

function renderBsSheet(title, subtitle, body, footer = '') {
  return `
    <div class="modal fade show d-block qc-modal-backdrop" tabindex="-1" role="dialog">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable qc-sheet-dialog mx-3">
        <div class="modal-content border-0 shadow-lg rounded-4 overflow-hidden">
          <div class="modal-header border-0 pb-0 px-4 pt-4">
            <div>
              <h5 class="modal-title fw-bold mb-1">${esc(title)}</h5>
              ${subtitle ? `<p class="text-muted small mb-0">${esc(subtitle)}</p>` : ''}
            </div>
          </div>
          <div class="modal-body px-4">${body}</div>
          ${footer ? `<div class="modal-footer border-0 flex-column gap-2 px-4 pb-4 pt-0">${footer}</div>` : ''}
        </div>
      </div>
    </div>`;
}

function renderBccDock(active) {
  return `
    <nav class="bcc-dock" aria-label="Main">
      <div class="bcc-dock-bar">
        <button type="button" data-action="back-home" class="${active === 'home' ? 'is-on' : ''}">Home</button>
        <button type="button" data-action="seasons" class="${active === 'seasons' || active === 'wrapped' ? 'is-on' : ''}">Season</button>
        <button type="button" class="bcc-dock-go" data-action="new-match" aria-label="Start a match">+</button>
        <button type="button" data-action="players" class="${active === 'players' ? 'is-on' : ''}">Players</button>
      </div>
    </nav>`;
}

function homeTickerLine() {
  const QP = window.QCPlayers;
  const players = state.players || [];
  const bits = [];
  const byRuns = players.filter(p => (p.batting?.runs || 0) > 0)
    .sort((a, b) => b.batting.runs - a.batting.runs);
  if (byRuns[0]) bits.push(`${byRuns[0].name}: ${byRuns[0].batting.runs} runs`);
  const bySr = players.filter(p => (p.batting?.balls || 0) >= 12)
    .sort((a, b) => (parseFloat(QP.batSR(b.batting)) || 0) - (parseFloat(QP.batSR(a.batting)) || 0));
  if (bySr[0] && bySr[0].id !== byRuns[0]?.id) bits.push(`${bySr[0].name} strikes at ${QP.batSR(bySr[0].batting)}`);
  const byWkts = players.filter(p => (p.bowling?.wickets || 0) > 0)
    .sort((a, b) => b.bowling.wickets - a.bowling.wickets);
  if (byWkts[0]) bits.push(`${byWkts[0].name}: ${byWkts[0].bowling.wickets} wickets`);
  const done = state.history.filter(m => m.status === 'completed').length;
  bits.push(`${done} ${done === 1 ? 'match' : 'matches'} in the books`);
  bits.push(`${players.length} players`);
  return `${bits.join('   •   ')}   •   `;
}

function renderLastMatchCard() {
  const matches = state.history
    .filter(m => m.status === 'completed' && m.innings?.length)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const m = matches[0];
  if (!m) return '';
  const day = new Date(m.startedAt).toLocaleDateString(undefined, { weekday: 'long' });
  const result = m.result || '';
  const rows = m.innings.slice(0, 2).map(inn => {
    const name = m.teams[inn.batting] || '';
    const won = result.toLowerCase().startsWith(String(name).toLowerCase());
    return `<div class="bcc-sr${won ? ' is-win' : ''}"><b>${esc(name)}</b><span class="bcc-an">${inn.score.runs}/${inn.score.wickets}</span></div>`;
  }).join('');
  return `
    <h2 class="bcc-kicker">Last match</h2>
    <button type="button" class="bcc-scorecard" data-action="view-detail" data-match-id="${esc(m.id)}">
      <div class="bcc-scorecard-in">
        <div class="bcc-meta">${esc(day)} · ${m.overs} overs · ${esc(matchVenue(m))}</div>
        ${rows}
        ${result ? `<div class="bcc-res">${esc(result)}</div>` : ''}
      </div>
      <div class="bcc-art"></div>
    </button>`;
}

function homeLiveMatch() {
  if (state.current && state.current.status !== 'completed') return state.current;
  return state.history
    .filter(m => m.status !== 'completed')
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0] || null;
}

function renderHome() {
  const cur = state.current;
  const live = homeLiveMatch();
  const inProgress = state.history.filter(m => m.status !== 'completed');
  const pastCount = state.history.filter(m => m.status === 'completed').length;
  const seasonYear = activeSeason();
  const seasonPlayed = completedSeasonMatches(seasonYear);
  const allPlayed = completedSeasonMatches('all');
  const seasonBoard = buildSeasonBoard(seasonYear === 'all' ? 'all' : seasonYear);
  const orange = seasonBoard.batters[0];
  const activeMonths = seasonBoard.months.map((n, i) => ({ n, i })).filter(m => m.n > 0);
  const monthMax = Math.max(1, ...activeMonths.map(m => m.n));
  const monthBars = activeMonths.map(m => `<div><i style="height:${Math.max(12, Math.round(m.n / monthMax * 100))}%"></i><em>${HISTORY_MONTHS[m.i]}</em></div>`).join('');
  const playedIds = new Set();
  for (const match of seasonPlayed) {
    for (const p of state.players) if (playerAppeared(match, p)) playedIds.add(p.id);
  }
  const playerCount = state.players.length;
  const otherLive = inProgress.filter(m => m.id !== live?.id).length;
  const playHere = !!(cur && live && cur.id === live.id);
  return `
    <div class="screen bcc-home">
      <div class="bcc-scroll">
        <header class="bcc-hero">
          <div class="bcc-seam" aria-hidden="true"></div>
          <div class="bcc-hrow">
            <div class="bcc-logo bcc-an"><span class="bcc-badge">B</span>BCC</div>
            ${renderSeasonChip()}
          </div>
          <h1 class="bcc-an">Berlin<br>Cricket<br><em>Club</em></h1>
          <p class="bcc-tag">Bat, Bowl , Yean , Repeat!</p>
          <div class="bcc-flags" aria-hidden="true">
            <svg class="bcc-flag" viewBox="0 0 60 40">
              <rect width="60" height="40" rx="4" fill="#01411c"/>
              <rect width="16" height="40" fill="#fff"/>
              <circle cx="34" cy="20" r="9" fill="#fff"/>
              <circle cx="37.2" cy="18.6" r="7.2" fill="#01411c"/>
              <polygon fill="#fff" points="46,12 47.6,16.6 52.6,16.6 48.6,19.4 50.1,24 46,21.3 41.9,24 43.4,19.4 39.4,16.6 44.4,16.6"/>
            </svg>
            <span class="bcc-flag bcc-flag-de"></span>
          </div>
        </header>
        <div class="bcc-art"></div>
        <div class="bcc-tick" aria-hidden="true"><div>${esc(homeTickerLine())}</div></div>
        <div class="bcc-wrap">
          ${live ? `
            <button type="button" class="bcc-live" data-action="${playHere ? 'resume' : 'resume-match'}" data-match-id="${esc(live.id)}">
              <span class="bcc-live-dot" aria-hidden="true"></span>
              <span class="bcc-live-text">
                <b>Live now</b>
                <small>${esc(live.teams.A)} vs ${esc(live.teams.B)}</small>
              </span>
              <span class="bcc-an">Play</span>
            </button>
          ` : ''}
          <button type="button" class="bcc-cta" data-action="new-match">
            <span><b class="bcc-an">${live ? 'New match' : 'Start a match'}</b><small>Teams, overs, every ball</small></span>
            <span class="bcc-go" aria-hidden="true">→</span>
          </button>
          <button type="button" class="bcc-sea" data-action="seasons">
            <div class="bcc-sea-h"><span>${seasonYear === 'all' ? 'All-time' : `Season ${seasonYear}${seasonBoard.open ? ' · in progress' : ''}`}</span><span>Dashboard →</span></div>
            <div class="bcc-sea-n">
              <div><b class="bcc-an">${fmtNum(seasonPlayed.length)}</b><small>Matches</small></div>
              <div><b class="bcc-an">${fmtNum(seasonBoard.runs)}</b><small>Runs</small></div>
              <div><b class="bcc-an">${fmtNum(seasonBoard.wickets)}</b><small>Wickets</small></div>
            </div>
            <div class="bcc-sea-mo" aria-hidden="true">${monthBars}</div>
            ${orange ? `<div class="bcc-sea-cap">${portraitHtml(orange)}<span>Orange cap: <b>${esc(orange.name)}</b> · ${fmtNum(orange.batting.runs)} runs</span></div>` : ''}
          </button>
          <div class="bcc-grid">
            <button type="button" class="bcc-tile" data-action="history">
              <div class="bcc-n bcc-an">${state.loadingHistory ? '…' : seasonPlayed.length}</div>
              <b>Past matches</b>
              <small>${seasonYear === 'all' ? 'Results and scorecards' : `this season · ${allPlayed.length} all-time`}</small>
            </button>
            <button type="button" class="bcc-tile" data-action="players">
              <div class="bcc-n bcc-an">${seasonYear === 'all' ? playerCount : playedIds.size}</div>
              <b>Players</b>
              <small>${seasonYear === 'all' ? 'Batting and bowling ranks' : `played in ${seasonYear} · ${playerCount} total`}</small>
            </button>
          </div>
          ${otherLive ? `
            <button type="button" class="bcc-more" data-action="in-progress">${otherLive} more in progress</button>
          ` : ''}
          ${renderLastMatchCard()}
          ${!dbOn() ? `<p class="bcc-sync">Cloud sync off. Add keys in config.js for share links.</p>` : ''}
          ${install.shouldShow() ? `
            <div class="bcc-pwa">
              <button type="button" class="bcc-pwa-btn" data-action="install-show">Install for full-screen scoring</button>
              <button type="button" class="bcc-pwa-x" data-action="install-dismiss" aria-label="Dismiss">×</button>
            </div>
          ` : ''}
          <div class="bcc-foot">
            <button type="button" data-action="hard-reload" title="Clear app cache and reload">Refresh app</button>
            <button type="button" data-action="terms">Terms</button>
            <button type="button" data-action="admin-open">Admin</button>
            <a href="https://www.linkedin.com/in/khamash/" target="_blank" rel="noopener noreferrer">Contact</a>
          </div>
        </div>
      </div>
      ${renderBccDock('home')}
    </div>
  `;
}

function renderAdmin() {
  const sorted = [...state.players].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const { sourceId, targetId } = state.adminMerge;
  const { matchId, sourceKey, targetId: reassignTargetId, scope: reassignScope } = state.adminReassign;
  const moveScope = reassignScope === 'bat' || reassignScope === 'bowl' ? reassignScope : 'both';
  const optionHtml = (selectedId) => {
    const head = '<option value="">— Select —</option>';
    const rows = sorted.map(p =>
      `<option value="${esc(p.id)}"${p.id === selectedId ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    return head + rows;
  };
  const canMerge = sourceId && targetId && sourceId !== targetId;
  const matches = adminMatchList();
  const selectedMatch = matches.find(m => m.id === matchId) || null;
  const matchOptions = matches.length
    ? `<option value="">— Select —</option>${matches.map(m =>
      `<option value="${esc(m.id)}"${m.id === matchId ? ' selected' : ''}>${esc(adminMatchLabel(m))}</option>`).join('')}`
    : '<option value="">No saved matches yet</option>';
  const canReassign = (() => {
    if (!matchId || !sourceKey || !reassignTargetId) return false;
    const { sourceId, sourceName } = parseAdminReassignSource(sourceKey);
    if (sourceId && sourceId === reassignTargetId) return false;
    const target = playerById(reassignTargetId);
    if (!sourceId && target && sourceName.toLowerCase() === target.name.toLowerCase()) return false;
    return true;
  })();
  return `
    <div class="screen bcc-page admin-screen">
      ${renderTopbar('Admin', { back: 'back-from-admin', ghost: true })}
      <div class="scroll flex-grow-1 overflow-auto admin-body px-3 py-3">
        <div class="admin-card">
          <h2 class="admin-card-title">Move match stats</h2>
          <p class="admin-card-lede">Wrong name in one match? Move that match&apos;s batting, bowling, or both to who actually played. Both profiles stay, and career totals are recalculated.</p>
          <label class="form-label admin-label" for="admin-reassign-match">Match</label>
          <select id="admin-reassign-match" class="form-select form-select-sm mb-2">${matchOptions}</select>
          <span class="form-label admin-label d-block">Move</span>
          <div class="btn-group btn-group-sm w-100 mb-2" role="group" aria-label="What to move">
            <button type="button" class="btn ${moveScope === 'bat' ? 'btn-dark' : 'btn-outline-secondary'}" data-action="admin-reassign-scope" data-scope="bat">Batting</button>
            <button type="button" class="btn ${moveScope === 'bowl' ? 'btn-dark' : 'btn-outline-secondary'}" data-action="admin-reassign-scope" data-scope="bowl">Bowling</button>
            <button type="button" class="btn ${moveScope === 'both' ? 'btn-dark' : 'btn-outline-secondary'}" data-action="admin-reassign-scope" data-scope="both">Both</button>
          </div>
          <label class="form-label admin-label" for="admin-reassign-source">Scored as (wrong)</label>
          <select id="admin-reassign-source" class="form-select form-select-sm mb-2"${matchId ? '' : ' disabled'}>${adminReassignSourceOptions(selectedMatch, sourceKey, moveScope)}</select>
          <label class="form-label admin-label" for="admin-reassign-target">Actually played (correct)</label>
          <select id="admin-reassign-target" class="form-select form-select-sm mb-3">${optionHtml(reassignTargetId)}</select>
          <label class="form-label admin-label" for="admin-reassign-pin">Global PIN</label>
          <input id="admin-reassign-pin" class="form-control form-control-sm pin-input text-center font-monospace fw-bold mb-3" type="text" inputmode="numeric" maxlength="4" placeholder="····" autocomplete="off" enterkeyhint="done" />
          <button type="button" class="btn btn-primary w-100 fw-bold" data-action="admin-reassign-run" ${canReassign ? '' : 'disabled'}>Move selected stats</button>
        </div>
        <div class="admin-card">
          <h2 class="admin-card-title">Merge players</h2>
          <p class="admin-card-lede">Scorecards point at the kept player. The duplicate is removed. Stats are rebuilt from all completed matches.</p>
          <label class="form-label admin-label" for="admin-merge-source">Remove duplicate</label>
          <select id="admin-merge-source" class="form-select form-select-sm mb-2">${optionHtml(sourceId)}</select>
          <label class="form-label admin-label" for="admin-merge-target">Keep this profile</label>
          <select id="admin-merge-target" class="form-select form-select-sm mb-3">${optionHtml(targetId)}</select>
          <label class="form-label admin-label" for="admin-merge-pin">Global PIN</label>
          <input id="admin-merge-pin" class="form-control form-control-sm pin-input text-center font-monospace fw-bold mb-3" type="text" inputmode="numeric" maxlength="4" placeholder="····" autocomplete="off" enterkeyhint="done" />
          <button type="button" class="btn btn-danger w-100 fw-bold" data-action="admin-merge-run" ${canMerge ? '' : 'disabled'}>Merge &amp; recalculate stats</button>
        </div>
        <p class="admin-footnote">For typos and duplicate profiles. Not reversible in the app.</p>
      </div>
    </div>
  `;
}

function renderTerms() {
  return `
    <div class="screen bcc-page">
      ${renderTopbar('Terms & Conditions')}
      <div class="terms-body flex-grow-1 overflow-auto px-3 px-md-4 pb-4">
        <p class="terms-updated">Last updated: 18 May 2026</p>

        <p>QuickCric is a small, free, casual cricket scoring app. By opening or using this app you are taken to have read and agreed to these terms. If you do not agree, please stop using the app.</p>

        <h2>1. What QuickCric is</h2>
        <p>QuickCric lets you keep score of informal cricket matches. There is no account, no sign-up, and no profile. You type team names, tap ball outcomes, and the app records the match.</p>

        <h2>2. No personal data collection</h2>
        <p>There is no account and no sign-up. We do not ask for your email address, phone number, location, or contacts.</p>
        <p>You may type anything you like into team and player name fields while scoring &mdash; nicknames, jokes, single letters. A player can also add a photo on their profile. That photo is stored with the player name and anyone who opens this copy of the app can see it. Please do not add a photo of someone who has not agreed to it.</p>

        <h2>3. What gets stored, and where</h2>
        <p>To make the app work, the following is stored:</p>
        <ul>
          <li><strong>On your device</strong> &mdash; your current match and a cached list of recent matches are saved in your browser&rsquo;s local storage so you can close and reopen the app and pick up where you left off.</li>
          <li><strong>A device identifier</strong> &mdash; a random ID generated by your browser the first time you open the app. It is not linked to you, your hardware, or any account. It is only used so the app knows which device originally started a match, so that the &ldquo;Resume&rdquo; button on that device works correctly.</li>
          <li><strong>In the cloud (optional)</strong> &mdash; if the person who deployed this copy of QuickCric has configured a Supabase backend, the match scorecard (teams, runs, balls, wickets, the names you typed in) and player profiles, including an optional photo, are sent there so the match can be opened on another device or shared via a link.</li>
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

function matchVenue(m) {
  return (m?.venue || '').trim() || DEFAULT_VENUE;
}

function matchWinnerName(m) {
  const result = m?.result || '';
  const names = [m?.teams?.A, m?.teams?.B].filter(Boolean);
  return names
    .slice()
    .sort((a, b) => b.length - a.length)
    .find(name => result.toLowerCase().startsWith(String(name).toLowerCase())) || '';
}

function teamTone(name) {
  const n = String(name || '').trim().toLowerCase();
  if (n === 'green') return 'green';
  if (n === 'blue') return 'blue';
  return 'ink';
}

const HISTORY_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HISTORY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function historyDayParts(ts) {
  const d = new Date(ts || 0);
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const startMatch = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const n = Math.round((startToday - startMatch) / 86400000);
  const when = n === 0 ? 'today' : n === 1 ? 'yesterday' : n > 1 ? `${n} days ago` : '';
  return {
    key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
    label: `${HISTORY_WEEKDAYS[d.getDay()]} ${d.getDate()} ${HISTORY_MONTHS[d.getMonth()]}`,
    when,
  };
}

function headToHeadCounts(matches) {
  let green = 0;
  let blue = 0;
  for (const m of matches) {
    const w = matchWinnerName(m).toLowerCase();
    if (w === 'green') green += 1;
    else if (w === 'blue') blue += 1;
  }
  return { green, blue };
}

function pastMatchCard(m) {
  const inns = (m.innings || []).slice(0, 2);
  const first = inns[0];
  const winner = matchWinnerName(m);
  const firstName = first ? (m.teams[first.batting] || '') : '';
  const tone = winner ? teamTone(winner) : '';
  const rows = inns.map(inn => {
    const name = m.teams[inn.batting] || '';
    const won = winner && name.toLowerCase() === winner.toLowerCase();
    const lost = !!winner && !won;
    return `<div class="bcc-pm-tm${won ? ' is-win' : ''}${lost ? ' is-lose' : ''}"><span class="bcc-pm-dot is-${teamTone(name)}"></span><b>${esc(name)}</b><span class="bcc-pm-sc bcc-an">${inn.score.runs}/${inn.score.wickets}</span><small>(${fmtOvers(inn.score.balls)})</small></div>`;
  }).join('');
  const ftTone = tone === 'green' || tone === 'blue' ? ` is-${tone}` : '';
  const dot = ftTone ? `<i class="bcc-pm-dot is-${tone}"></i>` : '';
  return `
    <button type="button" class="bcc-pm" data-action="view-detail" data-match-id="${esc(m.id)}">
      <div class="bcc-pm-hd"><span>${m.overs} overs</span><span>${esc(firstName || '—')} batted first</span></div>
      <div class="bcc-pm-venue">${esc(matchVenue(m))}</div>
      ${rows || '<div class="bcc-pm-tm"><b>No innings</b></div>'}
      <div class="bcc-pm-ft${ftTone}"><span class="bcc-pm-res">${dot}${esc(m.result || 'Completed')}</span><span class="bcc-pm-go">Scorecard →</span></div>
    </button>`;
}

function renderSetup() {
  const s = state.setup;
  const venue = VENUES.includes(s.venue) ? s.venue : DEFAULT_VENUE;
  const presets = [5, 6, 8, 10, 15, 20];
  const n = state.players.length;
  return `
    <div class="screen bcc-setup">
      ${setupTop('New match', 'Step 1 of 4 · The basics', 'back-home')}
      ${setupSteps(1)}
      <div class="bcc-scroll bcc-setup-body">
        <div class="bcc-lab">Teams</div>
        <label class="bcc-fld"><i class="is-a"></i><input id="team-a-input" type="text" value="${esc(s.teamA)}" placeholder="${esc(DEFAULT_TEAM_A)}" autocomplete="off" autocapitalize="words" /></label>
        <div class="bcc-vsr"><span>VS</span><button type="button" data-action="swap-teams">⇅ Swap</button></div>
        <label class="bcc-fld"><i class="is-b"></i><input id="team-b-input" type="text" value="${esc(s.teamB)}" placeholder="${esc(DEFAULT_TEAM_B)}" autocomplete="off" autocapitalize="words" /></label>
        <div class="bcc-sec">
          <div class="bcc-lab">Location</div>
          <div class="bcc-fld bcc-fld--loc"><span aria-hidden="true">📍</span><b>${esc(venue)}</b></div>
          <div class="bcc-loc-chips">
            ${VENUES.map(name => `<button type="button" class="bcc-chip${name === venue ? ' is-on' : ''}" data-action="pick-venue" data-venue="${esc(name)}">${esc(name)}</button>`).join('')}
          </div>
        </div>
        <div class="bcc-sec">
          <div class="bcc-lab">Overs per innings</div>
          <div class="bcc-ov">
            <button type="button" data-action="overs-step" data-delta="-1" aria-label="Decrease overs" ${s.overs <= 1 ? 'disabled' : ''}>−</button>
            <div><div class="bcc-an">${s.overs}</div><small>Overs</small></div>
            <button type="button" data-action="overs-step" data-delta="1" aria-label="Increase overs" ${s.overs >= 99 ? 'disabled' : ''}>+</button>
          </div>
          <div class="bcc-loc-chips is-center">
            ${presets.map(o => `<button type="button" class="bcc-chip${s.overs === o ? ' is-on' : ''}" data-action="overs-pick" data-overs="${o}">${o}</button>`).join('')}
          </div>
        </div>
        ${n ? `<div class="bcc-info"><span aria-hidden="true">👥</span><span><b>${n} saved player${n === 1 ? '' : 's'}</b>Pick squads next, or skip and type names later</span></div>` : ''}
      </div>
      <div class="bcc-setup-bar"><button type="button" class="bcc-cta bcc-an" data-action="start-match">Start match →</button></div>
    </div>
  `;
}

function tossCoinShortLabel(name, maxLen = 9) {
  const t = String(name || '').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

let tossFlipTimer = null;

function clearTossFlipTimer() {
  if (tossFlipTimer) {
    clearTimeout(tossFlipTimer);
    tossFlipTimer = null;
  }
}

function startMatchTossFlip() {
  const m = state.current;
  if (!m || state.view !== 'match-toss') return;
  if (state.tossCoin?.phase === 'flipping') return;

  clearTossFlipTimer();
  const side = Math.random() < 0.5 ? 'A' : 'B';
  state.tossCoin = { phase: 'flipping', result: side };
  render();

  const FLIP_MS = 2400;
  tossFlipTimer = setTimeout(() => {
    tossFlipTimer = null;
    if (state.view !== 'match-toss' || !state.current) return;
    state.current.battingFirst = side;
    state.tossCoin = { phase: 'landed', result: side };
    persistMatch(state.current);
    const face = side === 'A' ? 'Heads' : 'Tails';
    showToast(`${face}! ${state.current.teams[side]} bats first`);
    render();
    tossFlipTimer = setTimeout(() => {
      tossFlipTimer = null;
      if (state.view === 'match-toss' && state.tossCoin?.phase === 'landed') {
        state.tossCoin = { phase: 'idle', result: side };
        render();
      }
    }, 2000);
  }, FLIP_MS);
}

function renderTossCoinStage(m) {
  const tc = state.tossCoin || { phase: 'idle', result: null };
  const flipping = tc.phase === 'flipping';
  const landed = tc.phase === 'landed';
  const showTails = tc.result === 'B';
  const landClass = landed || (tc.phase === 'idle' && tc.result)
    ? (showTails ? 'toss-coin--tails-up' : 'toss-coin--heads-up')
    : 'toss-coin--heads-up';
  const animClass = flipping
    ? (showTails ? 'toss-coin--flip-tails' : 'toss-coin--flip-heads')
    : landClass;
  const headsLabel = tossCoinShortLabel(m.teams.A);
  const tailsLabel = tossCoinShortLabel(m.teams.B);
  const status = flipping
    ? 'Coin in the air…'
    : landed
      ? (tc.result === 'A' ? `Heads · ${m.teams.A} bats` : `Tails · ${m.teams.B} bats`)
      : 'Heads = ' + m.teams.A + ' · Tails = ' + m.teams.B;

  return `
    <div class="bcc-stage" aria-live="polite">
      <div class="bcc-lab">Tap the coin to flip</div>
      <div class="toss-coin-scene">
        <div class="toss-coin-shadow${flipping ? ' is-active' : ''}" aria-hidden="true"></div>
        <button type="button" class="toss-coin ${animClass}${flipping ? ' is-flipping' : ''}" data-action="toss" ${flipping ? 'disabled' : ''} aria-label="Flip the coin">
          <span class="toss-coin-edge" aria-hidden="true"></span>
          <span class="toss-coin-face toss-coin-face--heads">
            <span class="toss-coin-face-tag">Heads</span>
            <span class="toss-coin-face-team">${esc(headsLabel)}</span>
          </span>
          <span class="toss-coin-face toss-coin-face--tails">
            <span class="toss-coin-face-tag">Tails</span>
            <span class="toss-coin-face-team">${esc(tailsLabel)}</span>
          </span>
        </button>
      </div>
      <div class="bcc-toss-res">${esc(status)}</div>
    </div>`;
}

function renderMatchToss() {
  const m = state.current;
  const bf = m.battingFirst === 'B' ? 'B' : 'A';
  const batName = m.teams[bf];
  const flipping = state.tossCoin?.phase === 'flipping';
  return `
    <div class="screen bcc-toss">
      <div class="bcc-top">
        <button type="button" class="bcc-ib" data-action="back-from-toss" aria-label="Back">←</button>
        <span class="bcc-an">Toss</span>
      </div>
      <div class="bcc-art"></div>
      <div class="bcc-vs">
        <div class="bcc-vs-row">
          <span class="bcc-an is-a">${esc(m.teams.A)}</span>
          <span class="bcc-an is-x">vs</span>
          <span class="bcc-an is-b">${esc(m.teams.B)}</span>
        </div>
        <p>${m.overs} overs per side${matchUsesSquads(m) ? ' · squads set' : ''}</p>
      </div>
      <div class="bcc-scroll">
        ${renderTossCoinStage(m)}
        <div class="bcc-wrap">
          <div class="bcc-lab">Or pick manually</div>
          <button type="button" class="bcc-opt${bf === 'A' ? ' is-on' : ''}" data-action="bat-first" data-team="A" ${flipping ? 'disabled' : ''}>
            <span><i class="is-a"></i>${esc(m.teams.A)}</span>
            <small>${bf === 'A' ? 'batting first' : ''}</small>
          </button>
          <button type="button" class="bcc-opt${bf === 'B' ? ' is-on' : ''}" data-action="bat-first" data-team="B" ${flipping ? 'disabled' : ''}>
            <span><i class="is-b"></i>${esc(m.teams.B)}</span>
            <small>${bf === 'B' ? 'batting first' : ''}</small>
          </button>
          <p class="bcc-note">${esc(batName)} will bat first unless you change it above.</p>
        </div>
      </div>
      <div class="bcc-footbar">
        <button type="button" class="bcc-cta bcc-cta--bar" data-action="confirm-toss" ${flipping ? 'disabled' : ''}>
          <span><b class="bcc-an">Continue to openers</b></span>
          <span class="bcc-go" aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  `;
}

function openerNextSlot() {
  const order = ['striker', 'nonStriker', 'bowler'];
  return order.find(key => !state.inningsPick[key]) || state.openerSlot || 'bowler';
}

function renderInningsSetup() {
  const m = state.current;
  const isFirst = m.innings.length === 0;
  const batting = isFirst ? m.battingFirst : (m.battingFirst === 'A' ? 'B' : 'A');
  const bowling = batting === 'A' ? 'B' : 'A';
  const team = m.teams[batting];
  const target = !isFirst ? m.innings[0].score.runs + 1 : null;
  const slot = ['striker', 'nonStriker', 'bowler'].includes(state.openerSlot) ? state.openerSlot : 'striker';
  const QP = window.QCPlayers;
  const picks = state.inningsPick;
  const ready = !!(picks.striker?.name && picks.nonStriker?.name && picks.bowler?.name);
  const query = (state.playerPickerFilter || '').trim().toLowerCase();
  const mode = slot === 'bowler' ? 'bowl' : 'bat';
  const action = slot === 'bowler' ? 'pick-bowler' : slot === 'nonStriker' ? 'pick-non-striker' : 'pick-striker';
  const crease = [picks.striker, picks.nonStriker].filter(Boolean);
  const taken = new Set(
    (slot === 'bowler' ? crease : crease.filter(p => p !== picks[slot]))
      .map(p => (p.id || p.name || '').toLowerCase()),
  );
  const roster = rosterForInningsSetup(mode).filter(p => !query || p.name.toLowerCase().includes(query));
  const exact = roster.some(p => p.name.toLowerCase() === query);
  const hints = {
    striker: 'Who faces the first ball?',
    nonStriker: 'Who is at the other end?',
    bowler: 'Who bowls the first over?',
  };
  const slots = [
    ['striker', 'Striker', '🏏', picks.striker],
    ['nonStriker', 'Non-striker', '🏃', picks.nonStriker],
    ['bowler', 'Bowler', '🔴', picks.bowler],
  ];
  const flip = isFirst ? `<button type="button" class="bcc-ib" data-action="flip-batting" aria-label="Other team bats first">⇄</button>` : '';
  const sub = target ? `Innings 2 · chasing ${target}` : `Innings 1 · ${m.overs} overs to bat`;
  return `
    <div class="screen bcc-setup">
      ${setupTop(esc(team) + ' batting', esc(sub), 'back-from-innings-setup', flip)}
      ${setupSteps(4)}
      <div class="bcc-scroll bcc-setup-body">
        <div class="bcc-slots">
          ${slots.map(([key, label, icon, pick]) => `
            <button type="button" class="bcc-slot is-${key}${slot === key ? ' is-act' : ''}${pick?.name ? ' is-full' : ''}" data-action="opener-slot" data-slot="${key}">
              <small>${label}</small>
              <span>${icon}</span>
              <b>${pick?.name ? esc(pick.name) : 'Tap to pick'}</b>
            </button>`).join('')}
        </div>
        <div class="bcc-lab">${hints[slot]}</div>
        <input id="opener-query" class="bcc-srch player-picker-filter" type="search" placeholder="Find player…" value="${esc(state.playerPickerFilter || '')}" autocomplete="off" autocapitalize="off" enterkeyhint="search" />
        <div class="bcc-pg">
          ${roster.map(p => {
            const blocked = taken.has(p.id.toLowerCase()) || taken.has(p.name.toLowerCase());
            const meta = blocked && slot === 'bowler'
              ? 'Already batting'
              : mode === 'bowl'
                ? `${p.bowling?.wickets || 0} wkts`
                : `SR ${QP ? QP.batSR(p.batting) : '—'}`;
            return `<button type="button" class="bcc-pc" data-action="${action}" data-player-id="${esc(p.id)}" data-player-name="${esc(p.name)}" ${blocked ? 'disabled' : ''}><b>${esc(p.name)}</b><small>${meta}</small></button>`;
          }).join('')}
          ${query && !exact ? `<button type="button" class="bcc-pc is-add" data-action="opener-add"><b>+ Add “${esc(state.playerPickerFilter.trim())}”</b><small>New name</small></button>` : ''}
        </div>
        <div class="bcc-undo"><button type="button" data-action="undo-innings-pick" ${state.inningsPickUndo.length ? '' : 'disabled'}>↶ Undo last pick</button></div>
      </div>
      <div class="bcc-setup-bar"><button type="button" class="bcc-cta bcc-an" data-action="start-innings" ${ready ? '' : 'disabled'}>Start innings</button></div>
    </div>
  `;
}

function scBallFace(ball) {
  if (!ball) return { cls: 'sc-ball', text: '' };
  let cls = 'sc-ball sc-f';
  if (ball.runOut || ball.wicket) cls += ' sc-bw';
  else if (ball.extra) cls += ' sc-ex';
  else if (ball.runs === 4) cls += ' sc-b4';
  else if (ball.runs === 6) cls += ' sc-b6';
  const text = (!ball.extra && !ball.wicket && !ball.runOut && ball.runs === 0) ? '•' : (ball.label || '0');
  return { cls, text };
}

function scOverRunsMap(inn) {
  const map = {};
  for (const ball of inn.ballLog || []) {
    map[ball.overNo] = (map[ball.overNo] || 0) + (Number(ball.total) || 0);
  }
  return map;
}

function scPaceBars(inn, maxOvers) {
  const map = scOverRunsMap(inn);
  const played = Math.floor((inn.score.balls || 0) / 6) + ((inn.score.balls || 0) % 6 === 0 && inn.score.balls ? 0 : 1);
  const values = [];
  for (let i = 0; i < maxOvers; i++) {
    if (map[i] == null && i >= played) values.push(null);
    else values.push(map[i] || 0);
  }
  const peak = Math.max(12, ...values.filter(v => v != null));
  const current = (inn.score.balls || 0) > 0 && (inn.score.balls % 6 === 0)
    ? Math.floor(inn.score.balls / 6) - 1
    : Math.floor((inn.score.balls || 0) / 6);
  return values.map((v, i) => {
    if (v == null) return '<i style="height:4px"></i>';
    const on = i === current && !(inn.score.balls > 0 && inn.score.balls % 6 === 0);
    const h = Math.max(5, (v / peak) * 46);
    return `<i class="${on ? 'sc-c' : 'sc-d'}" style="height:${h.toFixed(0)}px"></i>`;
  }).join('');
}

function scPartnership(inn) {
  const striker = inn.batters[inn.striker];
  const non = inn.batters[inn.nonStriker];
  if (!striker || striker.out || !non || non.out) return null;
  const names = new Set([striker.name, non.name]);
  const log = inn.ballLog || [];
  let from = log.length;
  for (let i = log.length - 1; i >= 0; i--) {
    const pair = [log[i].strikerName, log[i].nonStrikerName];
    if (!pair[0] || !names.has(pair[0]) || !names.has(pair[1])) break;
    from = i;
  }
  const slice = log.slice(from);
  const side = {};
  for (const name of names) side[name] = { runs: 0, balls: 0 };
  let extras = 0;
  let total = 0;
  for (const ball of slice) {
    total += Number(ball.total) || 0;
    const batRuns = (ball.extra === 'wd' || ball.extra === 'lb' || ball.extra === 'b') ? 0 : (Number(ball.runs) || 0);
    if (side[ball.batter]) {
      side[ball.batter].runs += batRuns;
      if (ball.legal) side[ball.batter].balls += 1;
    }
    if (ball.extra === 'wd') extras += 1 + (Number(ball.runs) || 0);
    else if (ball.extra === 'nb') extras += 1;
    else if (ball.extra === 'b' || ball.extra === 'lb') extras += Number(ball.runs) || 0;
  }
  const balls = slice.filter(b => b.legal).length;
  return { striker, non, side, total, balls, extras };
}

function scFinishedOvers(inn) {
  const groups = new Map();
  for (const ball of inn.ballLog || []) {
    if (!groups.has(ball.overNo)) groups.set(ball.overNo, []);
    groups.get(ball.overNo).push(ball);
  }
  const cutoff = Math.floor((inn.score.balls || 0) / 6);
  return [...groups.entries()]
    .filter(([n]) => n < cutoff)
    .sort((a, b) => b[0] - a[0]);
}

function creaseRow(inn, idx, needPick) {
  const b = inn.batters[idx];
  if (b?.out) {
    if (b.dismissal === 'retired hurt') {
      return { name: `${b.name} · retired hurt`, figs: `${b.runs} (${b.balls})`, pending: needPick };
    }
    return { name: 'Pick next batter', figs: '—', pending: true };
  }
  if (needPick && !b) {
    return { name: 'Pick next batter', figs: '—', pending: true };
  }
  if (!b) return { name: '—', figs: '—', pending: false };
  return { name: b.name, figs: `${b.runs} (${b.balls})`, pending: false };
}

function renderScore() {
  const m = state.current;
  const inn = m.innings[m.currentInnings];
  const team = m.teams[inn.batting];
  const strikerRow = creaseRow(inn, inn.striker, inn.needNewBatter);
  const nonStrikerRow = creaseRow(inn, inn.nonStriker, inn.needNewBatter);
  const bowler = inn.bowlers[inn.currentBowler];
  const rate = fmtRate(inn.score.runs, inn.score.balls);

  const liveOver = liveOverNo(inn);
  const hasLastOver = liveOver >= 1;
  const showingLast = state.showLastOver && hasLastOver;
  const overToShow = showingLast ? liveOver - 1 : liveOver;
  const overBalls = inn.ballLog.filter(b => b.overNo === overToShow);
  const legalCount = overBalls.filter(b => b.legal).length;
  const remainingLegal = Math.max(0, 6 - legalCount);

  const b = state.ball;
  const selCount = ballSelectionCount(b);
  const canNext = selCount > 0 && !inn.needNewBatter && !inn.needNewBowler && !inn.ended;
  const canUndo = canUndoNow(m);
  const canSwap = !inn.ended && !inn.needNewBatter && !inn.needNewBowler &&
    inn.batters[inn.striker] && inn.batters[inn.nonStriker] &&
    !inn.batters[inn.striker].out && !inn.batters[inn.nonStriker].out;
  const canRetireHurt = !inn.ended && !inn.needNewBatter && !inn.needNewBowler &&
    inn.batters[inn.striker] && inn.batters[inn.nonStriker] &&
    !inn.batters[inn.striker].out && !inn.batters[inn.nonStriker].out;
  const atOverBreak = inn.score.balls > 0 && inn.score.balls % 6 === 0 && !inn.ended;
  const pickingPlayer = inn.needNewBatter || inn.needNewBowler;
  const scBallHtml = (ball, overNo, slotIdx, small) => {
    const face = scBallFace(ball);
    const logIndex = ballLogGlobalIndex(inn, overNo, slotIdx);
    const size = small ? ' sc-sm' : '';
    if (inn.ended || pickingPlayer || !isLogIndexInEditWindow(inn, logIndex)) {
      return `<div class="${face.cls}${size}">${esc(face.text)}</div>`;
    }
    return `<button type="button" class="${face.cls}${size}" data-action="edit-ball" data-log-index="${logIndex}" title="Edit this ball">${esc(face.text)}</button>`;
  };
  const scOverBallsHtml = (overNo, { emptySlots = 0 } = {}) => {
    const balls = inn.ballLog.filter(b => b.overNo === overNo);
    const filled = balls.map((ball, slotIdx) => scBallHtml(ball, overNo, slotIdx, false)).join('');
    return filled + Array(emptySlots).fill('<div class="sc-ball"></div>').join('');
  };

  const ballsLeft = (m.overs * 6) - inn.score.balls;
  const need = m.currentInnings === 1 && inn.target != null ? inn.target - inn.score.runs : null;
  const rrr = need != null && need > 0 && ballsLeft > 0 ? ((need / ballsLeft) * 6).toFixed(2) : '';
  const chase = need != null && need > 0 && ballsLeft > 0
    ? `${team} require ${need} ${need === 1 ? 'run' : 'runs'} in ${ballsLeft} ${ballsLeft === 1 ? 'ball' : 'balls'}`
    : '';
  const ex = inningsExtraRuns(inn);
  const extraTotal = ex.b + ex.lb + ex.wd + ex.nb;

  const maxBalls = m.overs * 6;
  const pace = inn.score.balls ? Math.round(inn.score.runs / inn.score.balls * maxBalls) : 0;
  const ringC = 2 * Math.PI * 45;
  const ringDash = maxBalls ? (ringC * inn.score.balls / maxBalls) : 0;
  const striker = inn.batters[inn.striker];
  const nonStriker = inn.batters[inn.nonStriker];
  const bowlEcon = bowler?.balls ? (bowler.runs / (bowler.balls / 6)).toFixed(1) : '0.0';
  const partner = scPartnership(inn);
  const finished = scFinishedOvers(inn);
  const overLabel = atOverBreak ? `Over ${liveOver + 1} done` : 'This over';
  const overSlots = scOverBallsHtml(overToShow, {
    emptySlots: atOverBreak ? 0 : remainingLegal,
  });
  const finishedRows = finished.map(([overNo, balls]) => {
    const who = balls[0]?.bowler || '';
    const runs = balls.reduce((sum, ball) => sum + (Number(ball.total) || 0), 0);
    const pills = balls.map((ball, slotIdx) => scBallHtml(ball, overNo, slotIdx, true)).join('');
    return `<div class="sc-orow"><div class="sc-olab">Over ${overNo + 1}<em>${esc(who)}</em></div><div class="sc-bl">${pills}</div><b class="bcc-an">${runs}</b></div>`;
  }).join('');
  const chaseSw = need != null && need > 0
    ? `<br>Need <b>${need}</b> from <b>${ballsLeft}</b><br>RRR <b>${rrr}</b>`
    : `<br><b>${ballsLeft}</b> balls left`;

  return `
    <div class="screen score-screen bcc-score${pickingPlayer ? ' score-screen--picking' : ''}">
      <div class="bcc-top">
        <button type="button" class="bcc-ib" data-action="home" aria-label="Back">←</button>
        <span class="bcc-an">${esc(team)}</span>
        <button type="button" class="bcc-ib" data-action="toggle-audio" aria-label="Toggle sound">${audio.enabled ? '🔊' : '🔇'}</button>
        <button type="button" class="bcc-ib" data-action="share" aria-label="Share">↗</button>
      </div>
      <div class="score-body sc-top">
      <div class="sc-hero">
        <div class="sc-hr">
          <div>
            <span class="sc-tm"><i></i>${esc(team)} · ${m.currentInnings === 1 ? 'Chase' : 'Batting'}</span>
            ${chase ? `<div class="sc-chase">${esc(chase)}</div>` : ''}
            ${inn.freeHit ? `<div class="sc-free">Free hit</div>` : ''}
            <div class="sc-big bcc-an">${inn.score.runs}/${inn.score.wickets}</div>
          </div>
          <div class="sc-mid">
            <div class="sc-rp">${scPaceBars(inn, m.overs)}</div>
            <small>Runs per over</small>
            <div class="sc-pj">On pace for <b class="bcc-an">${pace}</b></div>
          </div>
          <div class="sc-sw"><b>${fmtOvers(inn.score.balls)}</b> / ${m.overs} overs<br>CRR <b>${rate}</b>${chaseSw}</div>
          <div class="sc-ring" aria-hidden="true">
            <svg viewBox="0 0 104 104"><circle class="sc-tr" cx="52" cy="52" r="45"/><circle class="sc-pg" cx="52" cy="52" r="45" stroke-dasharray="${ringDash.toFixed(1)} ${ringC.toFixed(1)}"/></svg>
            <div><b class="bcc-an">${fmtOvers(inn.score.balls)}</b><small>Of ${m.overs} overs</small></div>
          </div>
        </div>
        <div class="sc-chips">
          <div class="sc-chip"><b class="bcc-an sc-g">${rate}</b><small>Run rate</small></div>
          ${need != null && need > 0
            ? `<div class="sc-chip"><b class="bcc-an sc-g">${need}</b><small>Need</small><small class="sc-s2">RRR ${rrr}</small></div>`
            : `<div class="sc-chip sc-chip--extras"><b class="bcc-an">${extraTotal}</b><small>Extras</small><span class="sc-corner sc-corner--l">WD: ${ex.wd}</span><span class="sc-corner sc-corner--r">NB: ${ex.nb}</span></div>`}
          <div class="sc-chip"><b class="bcc-an">${Math.max(0, ballsLeft)}</b><small>Balls left</small></div>
        </div>
        ${need != null && need > 0 ? `<div class="sc-xline">Extras ${extraTotal} · WD${ex.wd} NB${ex.nb}</div>` : ''}
        <div class="sc-ovr">
          <span>${esc(overLabel)}</span>
          <div class="sc-balls">${overSlots}</div>
        </div>
      </div>
      <div class="sc-crew">
        <div class="sc-cbox">
          <div class="sc-ch">Batting<div>
            <button type="button" data-action="swap-strike" ${canSwap ? '' : 'disabled'}>⇄ Swap</button>
            <button type="button" class="sc-rh" data-action="retire-hurt" ${canRetireHurt ? '' : 'disabled'}>Retire</button>
          </div></div>
          ${striker && !striker.out
            ? `<div class="sc-br sc-on"><span>${faceHtml(striker)}${esc(striker.name)} 🏏</span><b class="bcc-an">${striker.runs} <small>(${striker.balls})</small></b></div>`
            : `<div class="sc-br sc-wait"><span>Pick next batter 🏏</span><b>—</b></div>`}
          ${nonStriker && !nonStriker.out
            ? `<div class="sc-br"><span>${faceHtml(nonStriker)}${esc(nonStriker.name)}</span><b class="bcc-an">${nonStriker.runs} <small>(${nonStriker.balls})</small></b></div>`
            : `<div class="sc-br sc-wait"><span>Pick next batter</span><b>—</b></div>`}
        </div>
        <div class="sc-cbox sc-bwx">
          <div class="sc-ch">Bowling</div>
          <div class="sc-nm2">${faceHtml(bowler)}${esc(bowler?.name || '—')}</div>
          <div class="sc-st"><b class="bcc-an">${bowler ? fmtOvers(bowler.balls) : '0.0'}</b><small>${bowler ? `${bowler.runs}/${bowler.wickets}` : '0/0'}</small></div>
          <div class="sc-ec">Econ ${bowlEcon}</div>
        </div>
      </div>
      ${partner ? `<div class="sc-partner">
        <div class="sc-fc">
          <div class="sc-fh"><span>Partnership</span><b class="bcc-an">${partner.total} <em>${partner.balls} balls</em></b></div>
          <div class="sc-pbar"><i style="flex:${partner.side[partner.striker.name].runs || 0.2}"></i><u style="flex:${partner.side[partner.non.name].runs || 0.2}"></u></div>
          <div class="sc-pn">
            <span><i></i>${esc(partner.striker.name)} <b>${partner.side[partner.striker.name].runs} (${partner.side[partner.striker.name].balls})</b></span>
            <span><i></i>${esc(partner.non.name)} <b>${partner.side[partner.non.name].runs} (${partner.side[partner.non.name].balls})</b></span>
          </div>
          ${partner.extras ? `<div class="sc-pe">incl. ${partner.extras} extra${partner.extras === 1 ? '' : 's'}</div>` : ''}
        </div>
      </div>` : ''}
      <div class="sc-feed">
        <div class="sc-fc sc-ov">
          <div class="sc-fh"><span>Over by over</span><em>${finished.length} finished</em></div>
          <div class="sc-olist">${finishedRows || '<div class="sc-ph">Finished overs show up here,<br>ball by ball.</div>'}</div>
        </div>
      </div>
      </div>
      <div class="actions score-actions${pickingPlayer ? ' score-actions--pick' : ''} sc-dock">
      ${pickingPlayer ? renderInlineScorePicker(inn) : `
        <div class="sc-pad">
          <div class="sc-k1">
            <button type="button" class="sc-kw${b.wicket ? ' sc-sel' : ''}" data-action="select-wkt">WICKET</button>
            <button type="button" class="sc-ko${b.runOut ? ' sc-sel' : ''}" data-action="select-ro">RUN OUT</button>
            <button type="button" class="sc-kx${b.extra === 'wd' ? ' sc-sel' : ''}" data-action="select-extra" data-extra="wd">WIDE</button>
            <button type="button" class="sc-kx${b.extra === 'nb' ? ' sc-sel' : ''}" data-action="select-extra" data-extra="nb">NO BALL</button>
          </div>
          <div class="sc-nums">
            <button type="button" class="sc-dot${b.runs === 0 ? ' sc-sel' : ''}" data-action="select-run" data-runs="0">DOT</button>
            ${[1, 2, 3, 4, 5, 6].map(n => `<button type="button" class="${b.runs === n ? 'sc-sel' : ''}" data-action="select-run" data-runs="${n}">${n}</button>`).join('')}
          </div>
          <div class="sc-act">
            <button type="button" class="sc-undo" data-action="undo" title="${esc(undoActionLabel(m))}" ${canUndo && !showingLast ? '' : 'disabled'}>Undo</button>
            <button type="button" class="sc-nb bcc-an" data-action="next-ball" ${canNext ? '' : 'disabled'}>Next ball</button>
          </div>
          <div class="sc-ft">
            <button type="button" data-action="end-innings">End innings</button>
            <button type="button" class="sc-ab" data-action="abort-show">Abort match</button>
          </div>
        </div>`}
      </div>
    </div>
  `;
}

function overStripTotals(overBalls) {
  let overRuns = 0;
  let overWkts = 0;
  for (const b of overBalls) {
    overRuns += (Number(b.runs) || 0) + ((b.extra === 'wd' || b.extra === 'nb') ? 1 : 0);
    if (b.wicket === true) overWkts += 1;
  }
  return { overRuns, overWkts };
}

function renderOverStrip(inn, overNo, opts = {}) {
  const {
    editable = false,
    label = 'This over',
    showSum = false,
    emptySlots = 0,
  } = opts;
  const overBalls = inn.ballLog.filter(b => b.overNo === overNo);
  const { overRuns, overWkts } = overStripTotals(overBalls);
  const pills = editable
    ? overBalls.map((b, slotIdx) => {
        const logIndex = ballLogGlobalIndex(inn, overNo, slotIdx);
        return renderBallPill(b, { editable: isLogIndexEditable(inn, logIndex), logIndex });
      }).join('')
    : [...overBalls, ...Array(emptySlots).fill(null)].map(b => renderBallPill(b)).join('');

  return `
    <div class="over-strip${editable ? ' over-strip--editable' : ''}">
      <div class="over-strip-head">
        <div class="heading">${esc(label)}</div>
      </div>
      <div class="balls">
        ${pills}
        ${showSum && overBalls.length ? `<div class="over-sum">${overRuns}/${overWkts}</div>` : ''}
      </div>
    </div>
  `;
}

function renderBallPill(b, opts = {}) {
  if (!b) return `<div class="ball-pill empty">·</div>`;
  let cls = 'ball-pill';
  if (b.extra) cls += ' extra';
  else if (b.runOut) cls += ' wkt ro';
  else if (b.wicket) cls += ' wkt';
  else if (b.runs === 4) cls += ' run4';
  else if (b.runs === 6) cls += ' run6';
  else if (b.runs === 0) cls += ' dot';
  const inner = esc(b.label);
  if (opts.editable && opts.logIndex != null) {
    return `<button type="button" class="${cls} ball-pill-btn" data-action="edit-ball" data-log-index="${opts.logIndex}" title="Edit this ball">${inner}</button>`;
  }
  return `<div class="${cls}">${inner}</div>`;
}

function renderLivePanel(m) {
  const inn = m.innings[m.currentInnings];
  if (!inn || inn.ended) return '';

  const striker = inn.batters[inn.striker];
  const nonStriker = inn.batters[inn.nonStriker];
  const bowler = inn.bowlers[inn.currentBowler];
  const rate = fmtRate(inn.score.runs, inn.score.balls);

  const liveOver = liveOverNo(inn);
  const overBalls = inn.ballLog.filter(b => b.overNo === liveOver);
  const legalCount = overBalls.filter(b => b.legal).length;
  const remainingLegal = Math.max(0, 6 - legalCount);
  const overSlots = [...overBalls, ...Array(remainingLegal).fill(null)];
  let overRuns = 0, overWkts = 0;
  for (const b of overBalls) {
    overRuns += (Number(b.runs) || 0) + ((b.extra === 'wd' || b.extra === 'nb') ? 1 : 0);
    if (b.wicket === true) overWkts++;
  }

  const targetPill = (m.currentInnings === 1 && inn.target != null && inn.target - inn.score.runs > 0)
    ? `Need ${inn.target - inn.score.runs} from ${(m.overs * 6) - inn.score.balls} balls` : '';

  return `
    <div class="live-panel">
      <div class="hero">
        <div class="team">${esc(m.teams[inn.batting])}${m.currentInnings === 1 ? ' · 2nd innings' : ''}</div>
        <div class="rate">scoring at ${rate} per over</div>
        <div class="score-line">${inn.score.runs}/${inn.score.wickets}</div>
        <div class="overs">${fmtOvers(inn.score.balls)} / ${m.overs}.0 overs</div>
        ${targetPill ? `<div class="target">${esc(targetPill)}</div>` : ''}
      </div>
      <div class="stats">
        <div class="row">
          <span class="name striker">${esc(striker?.name || '—')}</span>
          <span class="figs">${striker?.runs ?? 0} (${striker?.balls ?? 0})</span>
        </div>
        <div class="row bowler-row">
          <span class="name">${esc(bowler?.name || '—')}</span>
          <span class="figs">${fmtOvers(bowler?.balls ?? 0)} · ${bowler?.runs ?? 0}/${bowler?.wickets ?? 0}</span>
        </div>
        <div class="row">
          <span class="name">${esc(nonStriker?.name || '—')}</span>
          <span class="figs">${nonStriker?.runs ?? 0} (${nonStriker?.balls ?? 0})</span>
        </div>
        <div class="row"></div>
      </div>
      <div class="over-strip">
        <div class="over-strip-head">
          <div class="heading">Over ${liveOver + 1}</div>
        </div>
        <div class="balls">
          ${overSlots.map(renderBallPill).join('')}
          ${overBalls.length >= 6 ? `<div class="over-sum">${overRuns}/${overWkts}</div>` : ''}
        </div>
      </div>
      ${inn.freeHit ? `<div class="free-hit-banner free-hit-banner--compact"><span class="fh-dot"></span>Free hit<span class="fh-dot"></span></div>` : ''}
    </div>
  `;
}

function renderInningsBreak() {
  const m = state.current;
  const i1 = m.innings[0];
  const battingNext = m.battingFirst === 'A' ? 'B' : 'A';
  return `
    <div class="screen bcc-sum">
      <div class="bcc-top">
        <button type="button" class="bcc-ib" data-action="home" aria-label="Back">←</button>
        <span class="bcc-an">Innings break</span>
        <button type="button" class="bcc-ib" data-action="share" aria-label="Share">↗</button>
      </div>
      <div class="bcc-scroll">
        <div class="bcc-sum-hero">
          <div class="bcc-sum-lab">End of innings 1</div>
          <h1 class="bcc-an">${i1.score.runs}/${i1.score.wickets}</h1>
          <p>${esc(m.teams[i1.batting])} · ${fmtOvers(i1.score.balls)} overs · RR ${fmtRate(i1.score.runs, i1.score.balls)}</p>
          <p class="bcc-break-need">${esc(m.teams[battingNext])} need ${i1.score.runs + 1}</p>
        </div>
        <div class="bcc-art"></div>
        <div class="bcc-sum-wrap">
          <h2>Innings 1</h2>
          ${renderSummaryBatting(i1)}
          ${renderSummaryBowling(i1)}
        </div>
      </div>
      <div class="bcc-setup-bar"><button type="button" class="bcc-cta bcc-an" data-action="start-next-innings">Start 2nd innings</button></div>
    </div>
  `;
}

function summaryWhen(ts) {
  const d = new Date(ts || 0);
  return `${HISTORY_WEEKDAYS[d.getDay()]} ${d.getDate()} ${HISTORY_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function inningsExtraRuns(inn) {
  const out = { wd: 0, nb: 0, b: 0, lb: 0 };
  for (const ball of inn?.ballLog || []) {
    const runs = Number(ball.runs) || 0;
    if (ball.extra === 'wd') out.wd += 1 + runs;
    else if (ball.extra === 'nb') out.nb += 1;
    else if (ball.extra === 'b') out.b += runs;
    else if (ball.extra === 'lb') out.lb += runs;
  }
  return out;
}

function batterDotBalls(inn, name) {
  const want = String(name || '').trim().toLowerCase();
  let dots = 0;
  for (const ball of inn?.ballLog || []) {
    if (String(ball.batter || '').trim().toLowerCase() !== want || !ball.legal) continue;
    const batRuns = (ball.extra === 'lb' || ball.extra === 'b') ? 0 : (Number(ball.runs) || 0);
    if (batRuns === 0 && !ball.wicket && !ball.runOut) dots += 1;
  }
  return dots;
}

function bowlerExtraCounts(inn, name) {
  const want = String(name || '').trim().toLowerCase();
  let wides = 0;
  let noBalls = 0;
  for (const ball of inn?.ballLog || []) {
    if (String(ball.bowler || '').trim().toLowerCase() !== want) continue;
    if (ball.extra === 'wd') wides += 1;
    else if (ball.extra === 'nb') noBalls += 1;
  }
  return { wides, noBalls };
}

function summaryStrikeRate(runs, balls) {
  const b = Number(balls) || 0;
  if (!b) return '—';
  return String(Math.round(((Number(runs) || 0) / b) * 100));
}

function summaryEcon(balls, runs) {
  const b = Number(balls) || 0;
  if (!b) return '—';
  return ((Number(runs) || 0) / (b / 6)).toFixed(1);
}

function howOutLabel(batter) {
  if (!batter?.out) return { text: 'not out', notOut: true };
  if (batter.dismissal === 'run out') return { text: 'run out', notOut: false };
  if (batter.dismissal === 'retired hurt') return { text: 'retired hurt', notOut: false };
  return { text: 'out', notOut: false };
}

function summaryFaceClass(name, winner) {
  const tone = teamTone(name);
  const toneClass = tone === 'green' ? 'is-g' : tone === 'blue' ? 'is-b' : 'is-ink';
  const lost = winner && String(name).toLowerCase() !== winner.toLowerCase();
  return `${toneClass}${lost ? ' is-lose' : ''}`;
}

function renderSummaryFace(m) {
  const winner = matchWinnerName(m);
  const sides = (m.innings || []).slice(0, 2);
  if (!sides.length) {
    return '<div class="bcc-face"><div class="is-ink"><div class="bcc-face-s bcc-an">—</div><small>Yet to bat</small></div></div>';
  }
  const cells = sides.map(inn => {
    const name = m.teams[inn.batting] || '';
    return `<div class="${summaryFaceClass(name, winner)}"><div class="bcc-face-s bcc-an">${inn.score.runs}/${inn.score.wickets}</div><small>${esc(name)} · ${fmtOvers(inn.score.balls)} ov</small></div>`;
  });
  if (cells.length === 1) cells.push('<div class="is-ink is-lose"><div class="bcc-face-s bcc-an">—</div><small>To bat</small></div>');
  return `<div class="bcc-face">${cells[0]}<div class="bcc-face-vs bcc-an">vs</div>${cells[1]}</div>`;
}

function matchAwards(m) {
  if (!m) return null;
  if (m.status === 'completed' && window.QCPlayers?.computeAwards) {
    try { return window.QCPlayers.computeAwards(m, state.players); } catch { /* keep stored */ }
  }
  return m.awards || null;
}

function awardFigures(award) {
  if (!award) return '';
  const bits = [];
  if (award.bat?.faced) bits.push(`${award.bat.runs} run${award.bat.runs === 1 ? '' : 's'}`);
  if (award.bowl?.bowled) {
    const w = award.bowl.wickets || 0;
    bits.push(`${w} wkt${w === 1 ? '' : 's'}`);
  }
  return bits.join(' · ');
}

function awardImpact(award) {
  const n = Number(award?.score);
  return Number.isFinite(n) ? n.toFixed(1) : '';
}

function renderPotmCup() {
  return `
    <svg class="bcc-potm-cup" viewBox="0 0 72 72" aria-hidden="true">
      <path fill="#c9840a" d="M16 18c-7 1-10 8-8 14 2 7 8 9 14 7l-2-6c-4 1-7-1-8-5s1-7 4-8z"/>
      <path fill="#c9840a" d="M56 18c7 1 10 8 8 14-2 7-8 9-14 7l2-6c4 1 7-1 8-5s-1-7-4-8z"/>
      <path fill="#ffe7a3" d="M20 10h32l-2 26c-1 10-6 16-14 16s-13-6-14-16z"/>
      <path fill="#f6c453" d="M24 14h24l-1 18c-1 8-5 12-11 12s-10-4-11-12z"/>
      <path fill="#fff6d2" d="M28 16c1 8 0 14-2 20 6-1 10-6 11-16-3-1-6-3-9-4z"/>
      <rect x="32" y="50" width="8" height="7" rx="1.5" fill="#e0a322"/>
      <path fill="#c9840a" d="M22 57h28l3 5H19z"/>
      <rect x="16" y="62" width="40" height="6" rx="2" fill="#8a5608"/>
    </svg>`;
}

function renderSummaryAwards(m) {
  const a = matchAwards(m);
  if (!a || (!a.potm && !a.mvpA && !a.mvpB)) return '';
  const mvp = (award, side) => {
    if (!award) return '';
    const tone = teamTone(m.teams[side]);
    const cls = tone === 'green' ? 'is-g' : tone === 'blue' ? 'is-b' : '';
    const impact = awardImpact(award);
    const line = [awardFigures(award), impact ? `${impact} impact` : ''].filter(Boolean).join(' · ');
    return `<div class="bcc-mv ${cls}"><small>${esc(m.teams[side])} MVP</small><b>${esc(award.name)}</b><span>${esc(line || award.summary)}</span></div>`;
  };
  const potmImpact = a.potm ? awardImpact(a.potm) : '';
  return `
    <h2>Match awards</h2>
    ${a.potm ? `
      <div class="bcc-potm">
        ${renderPotmCup()}
        <div class="bcc-potm-main">
          <small>Player of the match</small>
          <b class="bcc-an">${esc(a.potm.name)}</b>
          <span class="bcc-potm-line">${esc(awardFigures(a.potm) || a.potm.summary)}</span>
        </div>
        ${potmImpact ? `<div class="bcc-potm-score"><b class="bcc-an">${potmImpact}</b><small>Impact</small></div>` : ''}
      </div>` : ''}
    <div class="bcc-two">${mvp(a.mvpA, 'A')}${mvp(a.mvpB, 'B')}</div>
    ${a.potm?.summary ? `<h2>Why ${esc(a.potm.name)}?</h2><p class="bcc-why">${esc(a.potm.summary)}</p>` : ''}`;
}

function renderSummaryTops(m) {
  const allBatters = (m.innings || []).flatMap(inn => inn.batters || []);
  const allBowlers = (m.innings || []).flatMap(inn => inn.bowlers || []);
  const topBat = allBatters.slice().sort((a, b) => b.runs - a.runs)[0];
  const topBowl = allBowlers.slice().sort((a, b) => {
    if (b.wickets !== a.wickets) return b.wickets - a.wickets;
    return a.runs - b.runs;
  })[0];
  if (!topBat?.balls && !topBowl?.balls) return '';
  return `
    <h2>Top performers</h2>
    <div class="bcc-top2">
      ${topBat?.balls ? `<div class="bcc-tp">${portraitHtml(topBat)}<div><small>Top scorer</small><b>${esc(topBat.name)}</b><div class="bcc-an">${topBat.runs} <span>(${topBat.balls})</span></div></div></div>` : '<div></div>'}
      ${topBowl?.balls ? `<div class="bcc-tp">${portraitHtml(topBowl)}<div><small>Best bowler</small><b>${esc(topBowl.name)}</b><div class="bcc-an">${topBowl.wickets}/${topBowl.runs}</div></div></div>` : ''}
    </div>`;
}

function renderSummaryBatting(inn) {
  const rows = (inn.batters || []).map(b => {
    const how = howOutLabel(b);
    return `<div class="bcc-tr"><span>${scorecardName(b, `<small class="${how.notOut ? 'is-no' : ''}">${esc(how.text)}</small>`)}</span><span class="bcc-rn bcc-an">${b.runs}</span><span>${b.balls}</span><span>${b.fours}</span><span>${b.sixes}</span><span class="is-dot">${batterDotBalls(inn, b.name)}</span><span>${summaryStrikeRate(b.runs, b.balls)}</span></div>`;
  }).join('');
  return `
    <div class="bcc-box">
      <div class="bcc-th"><span>Batter</span><span>R</span><span>B</span><span>4s</span><span>6s</span><span>0s</span><span>SR</span></div>
      ${rows || '<div class="bcc-tr"><span><b>No batters</b></span></div>'}
    </div>`;
}

function renderSummaryExtras(inn) {
  const ex = inningsExtraRuns(inn);
  const keys = [
    ['wd', 'Wides', '#f2a900'],
    ['nb', 'No-balls', '#d8432b'],
    ['b', 'Byes', '#2f6fe4'],
    ['lb', 'Leg-byes', '#1f7a4d'],
  ];
  const total = keys.reduce((n, [k]) => n + ex[k], 0);
  const bar = total
    ? keys.map(([k, , color]) => ex[k] ? `<i style="flex:${ex[k]};background:${color}"></i>` : '').join('')
    : '<i style="flex:1;background:#e2dac6"></i>';
  return `
    <div class="bcc-ex">
      <div class="bcc-ex-hd"><b>Extras</b><span class="bcc-an">${total}</span></div>
      <div class="bcc-stack">${bar}</div>
      <div class="bcc-cells">
        ${keys.map(([k, label, color]) => `<div><span class="bcc-an">${ex[k]}</span><small><i style="background:${color}"></i>${label}</small></div>`).join('')}
      </div>
    </div>`;
}

function bowlingSpellRows(inn) {
  const log = inn?.ballLog || [];
  if (!log.length) {
    return (inn?.bowlers || []).map(b => ({
      name: b.name, balls: b.balls || 0, runs: b.runs || 0, wickets: b.wickets || 0,
    }));
  }
  const order = [];
  const byName = new Map();
  for (const ball of log) {
    const name = String(ball.bowler || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, { name, balls: 0, runs: 0, wickets: 0 });
      order.push(key);
    }
    const row = byName.get(key);
    const offBat = Number(ball.runs) || 0;
    let conceded = offBat;
    if (ball.extra === 'wd' || ball.extra === 'nb') conceded = 1 + offBat;
    else if (ball.extra === 'lb' || ball.extra === 'b') conceded = 0;
    row.runs += conceded;
    if (ball.legal) row.balls += 1;
    if (ball.wicket && !ball.runOut) row.wickets += 1;
  }
  return order.map(key => byName.get(key));
}

function renderSummaryBowling(inn) {
  const rows = bowlingSpellRows(inn).map(b => {
    const extra = bowlerExtraCounts(inn, b.name);
    return `<div class="bcc-tr"><span>${scorecardName(b)}</span><span>${fmtOvers(b.balls)}</span><span>${b.runs}</span><span class="bcc-rn bcc-an">${b.wickets}</span><span class="is-xw">${extra.wides}</span><span class="is-xw">${extra.noBalls}</span><span>${summaryEcon(b.balls, b.runs)}</span></div>`;
  }).join('');
  return `
    <div class="bcc-box is-bowl">
      <div class="bcc-th"><span>Bowler</span><span>O</span><span>R</span><span>W</span><span>WD</span><span>NB</span><span>Eco</span></div>
      ${rows || '<div class="bcc-tr"><span><b>No bowlers</b></span></div>'}
    </div>`;
}

function renderSummaryBallLog(inn) {
  const log = inn?.ballLog || [];
  if (!log.length) return '<p class="bcc-sum-note">No balls logged for this innings.</p>';
  const overs = [];
  for (const ball of log) {
    const n = ball.overNo || 0;
    if (!overs[n]) overs[n] = [];
    overs[n].push(ball);
  }
  return `<div class="bcc-sum-log">${overs.map((balls, n) => {
    if (!balls) return '';
    const bowlers = [];
    for (const ball of balls) {
      const name = (ball.bowler || '').trim();
      if (name && !bowlers.some(n => n.toLowerCase() === name.toLowerCase())) bowlers.push(name);
    }
    const who = bowlers.length ? `<span class="bcc-sum-bowler">${bowlers.map(esc).join(', ')}</span>` : '';
    return `<div class="bcc-sum-over"><div class="bcc-sum-over-hd"><b>Over ${n + 1}</b>${who}</div><div class="bcc-sum-balls">${balls.map(b => `<span>${esc(b.label || '0')}</span>`).join('')}</div></div>`;
  }).join('')}</div>`;
}

function renderDetail() {
  const m = state.detail || state.current;
  if (!m) return renderHome();
  const isHistoricalView = (state.view === 'detail' || state.view === 'result') && m.status === 'completed';
  const inns = m.innings || [];
  const innIndex = Math.min(Math.max(0, state.summaryInn || 0), Math.max(0, inns.length - 1));
  const inn = inns[innIndex];
  const done = m.status === 'completed';
  return `
    <div class="screen bcc-sum">
      <div class="bcc-top">
        <button type="button" class="bcc-ib" data-action="back-to-matches" aria-label="Back">←</button>
        <span class="bcc-an">Match summary</span>
        <button type="button" class="bcc-ib bcc-eye${state.summaryShowId ? ' is-on' : ''}" data-action="toggle-match-id" aria-label="${state.summaryShowId ? 'Hide match code' : 'Show match code'}" aria-pressed="${state.summaryShowId ? 'true' : 'false'}">${renderEyeIcon()}</button>
        <button type="button" class="bcc-ib" data-action="share" aria-label="Share">↗</button>
      </div>
      ${state.summaryShowId ? `<button type="button" class="bcc-id-reveal" data-action="copy-match-id" data-match-id="${esc(m.id)}">${esc(m.id)}</button>` : ''}
      <div class="bcc-scroll">
        <div class="bcc-sum-hero">
          <div class="bcc-sum-lab">${done ? 'Result' : 'Status'}</div>
          <h1 class="bcc-an">${esc(m.result || (done ? 'Match tied' : 'In progress'))}</h1>
          <p>${esc(m.teams.A)} vs ${esc(m.teams.B)} · ${esc(summaryWhen(m.startedAt))} · ${m.overs} overs<br>${esc(matchVenue(m))}</p>
          ${renderSummaryFace(m)}
        </div>
        <div class="bcc-art"></div>
        <div class="bcc-sum-wrap">
          ${renderSummaryAwards(m)}
          ${renderSummaryTops(m)}
          ${inns.length ? `
            <h2>Scorecard</h2>
            <div class="bcc-sum-tabs">
              ${inns.map((item, i) => `
                <button type="button" class="bcc-sum-tab${i === innIndex ? ' is-on' : ''}" data-action="summary-innings" data-index="${i}">
                  <span>Innings ${i + 1} · ${esc(m.teams[item.batting] || '')}</span>
                  <small>${item.score.runs}/${item.score.wickets} (${fmtOvers(item.score.balls)})</small>
                </button>
              `).join('')}
            </div>
            ${inn ? `${renderSummaryBatting(inn)}${renderSummaryExtras(inn)}${renderSummaryBowling(inn)}` : ''}
            ${state.summaryBalls && inn ? renderSummaryBallLog(inn) : ''}
          ` : '<p class="bcc-sum-note">No innings yet.</p>'}
          <div class="bcc-sum-foot">
            <button type="button" class="is-dark${state.summaryBalls ? ' is-on' : ''}" data-action="summary-balls">${state.summaryBalls ? 'Hide balls' : 'Ball by ball'}</button>
            <button type="button" class="is-lime" data-action="share">Share scorecard</button>
          </div>
          ${isHistoricalView ? `<button type="button" class="bcc-sum-del" data-action="delete-match" data-match-id="${esc(m.id)}">Delete match and stats</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderInningsCard(m, inn, title, strikerIdx) {
  const teamName = m.teams[inn.batting];
  return `
    <div class="card border-0 shadow-sm mb-3 overflow-hidden">
      <div class="card-header d-flex justify-content-between align-items-center bg-light">
        <span class="fw-bold small">${esc(title)} · ${esc(teamName)}</span>
        <span class="badge text-bg-dark font-monospace">${inn.score.runs}/${inn.score.wickets} (${fmtOvers(inn.score.balls)})</span>
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-striped mb-0 small">
          <thead class="table-light"><tr><th>Batter</th><th class="text-end">R</th><th class="text-end">B</th><th class="text-end">4s</th><th class="text-end">6s</th></tr></thead>
          <tbody>
            ${inn.batters.map((b, bi) => `
              <tr${!b.out && bi === strikerIdx ? ' class="table-warning"' : ''}>
                <td><div class="fw-semibold">${esc(b.name)}</div><div class="text-muted" style="font-size:11px">${b.out ? (b.dismissal === 'run out' ? 'run out' : b.dismissal === 'retired hurt' ? 'retired hurt' : 'out') : 'not out'}</div></td>
                <td class="text-end">${b.runs}</td><td class="text-end">${b.balls}</td><td class="text-end">${b.fours}</td><td class="text-end">${b.sixes}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="table-responsive border-top">
        <table class="table table-sm mb-0 small">
          <thead class="table-light"><tr><th>Bowler</th><th class="text-end">O</th><th class="text-end">R</th><th class="text-end">W</th></tr></thead>
          <tbody>
            ${inn.bowlers.map(b => `
              <tr><td>${esc(b.name)}</td><td class="text-end">${fmtOvers(b.balls)}</td><td class="text-end">${b.runs}</td><td class="text-end">${b.wickets}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>
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
    <div class="card border-0 shadow-sm mx-3 mb-3">
      <div class="card-header bg-transparent fw-bold text-uppercase small">Top performers</div>
      <ul class="list-group list-group-flush">
        ${topBat?.balls ? `<li class="list-group-item d-flex justify-content-between"><span class="text-muted small">Top scorer</span><span><strong>${esc(topBat.name)}</strong> · ${topBat.runs}(${topBat.balls})</span></li>` : ''}
        ${topBowl?.balls ? `<li class="list-group-item d-flex justify-content-between"><span class="text-muted small">Best bowler</span><span><strong>${esc(topBowl.name)}</strong> · ${topBowl.wickets}/${topBowl.runs}</span></li>` : ''}
      </ul>
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

function renderAwards(m) {
  const a = matchAwards(m);
  if (!a || (!a.potm && !a.mvpA && !a.mvpB)) return '';
  return `
    <div class="card border-0 shadow-sm mx-3 mb-3">
      <div class="card-header bg-warning-subtle fw-bold text-uppercase small">Match awards</div>
      <ul class="list-group list-group-flush">
        ${a.potm ? `<li class="list-group-item"><span class="badge text-bg-warning me-2">POTM</span><strong>${esc(a.potm.name)}</strong><div class="small text-muted">${esc(a.potm.summary)}</div></li>` : ''}
        ${a.mvpA ? `<li class="list-group-item"><span class="badge text-bg-primary me-2">${esc(m.teams.A)} MVP</span><strong>${esc(a.mvpA.name)}</strong><div class="small text-muted">${esc(a.mvpA.summary)}</div></li>` : ''}
        ${a.mvpB ? `<li class="list-group-item"><span class="badge text-bg-success me-2">${esc(m.teams.B)} MVP</span><strong>${esc(a.mvpB.name)}</strong><div class="small text-muted">${esc(a.mvpB.summary)}</div></li>` : ''}
      </ul>
    </div>
  `;
}

function renderMatchAvailability() {
  const m = state.current;
  const sorted = [...state.players].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const checked = new Set(state.matchAvailability?.ids || []);
  const n = checked.size;
  const canSquads = n >= 2;
  const QP = window.QCPlayers;
  const q = (state.availQuery || '').trim().toLowerCase();
  const rows = sorted.filter(p => !q || p.name.toLowerCase().includes(q));
  return `
    <div class="screen bcc-setup">
      ${setupTop(`${esc(m?.teams?.A || '')} vs ${esc(m?.teams?.B || '')}`, `${n} of ${sorted.length} available today`, 'back-from-availability')}
      ${setupSteps(2)}
      <div class="bcc-scroll bcc-setup-body">
        <div class="bcc-tools">
          <input id="avail-query" class="bcc-srch" type="search" placeholder="Find player…" value="${esc(state.availQuery || '')}" autocomplete="off" autocapitalize="off" enterkeyhint="search" />
          <button type="button" class="bcc-sm" data-action="availability-select-all">All</button>
          <button type="button" class="bcc-sm" data-action="availability-clear">Clear</button>
        </div>
        <div class="bcc-plist">
          ${rows.map(p => {
            const on = checked.has(p.id);
            return `
              <label class="bcc-prow${on ? ' is-on' : ''}">
                <input type="checkbox" class="avail-check" data-player-id="${esc(p.id)}" ${on ? 'checked' : ''} />
                <span class="bcc-cb" aria-hidden="true">✓</span>
                ${playerAvatarHtml(p)}
                <span class="bcc-nm"><b>${esc(p.name)}</b><small>${p.batting.runs} runs · ${p.bowling.wickets} wkts · SR ${QP.batSR(p.batting)}</small></span>
              </label>`;
          }).join('') || '<p class="bcc-empty">No players match that search.</p>'}
        </div>
      </div>
      <div class="bcc-setup-bar">
        <button type="button" class="bcc-cta bcc-an" data-action="availability-auto" ${canSquads ? '' : 'disabled'}>Auto-pick balanced teams</button>
        <button type="button" class="bcc-outline" data-action="availability-manual" ${canSquads ? '' : 'disabled'}>Pick teams manually</button>
        <button type="button" class="bcc-lnk" data-action="availability-skip">Skip squads · type names later</button>
      </div>
    </div>
  `;
}

function renderSquadReviewRow(id, side, m, squads) {
  const other = side === 'A' ? 'B' : 'A';
  const otherLabel = m.teams[other];
  const canMove = canMoveSquadPlayer(side, squads);
  return `
    <div class="squad-review-row">
      <span class="squad-review-name">${esc(playerName(id))}</span>
      ${canMove
        ? `<button type="button" class="btn btn-sm btn-outline-secondary squad-review-move" data-action="move-squad-player" data-player-id="${esc(id)}" data-from-side="${side}" title="Move to ${esc(otherLabel)}">→ ${esc(otherLabel)}</button>`
        : `<span class="squad-review-move-hint text-muted small" title="Teams must stay within one player of each other">—</span>`}
    </div>`;
}

function squadStrengthPct(players, squads) {
  const scores = window.QCPlayers?.teamBalanceScores?.(players) || [];
  const map = new Map(scores.map(s => [s.id, s.rating || 0]));
  const sum = (ids) => ids.reduce((t, id) => t + (map.get(id) || 0), 0);
  const a = sum(squads.A);
  const b = sum(squads.B);
  const tot = a + b;
  return { a, b, pct: tot ? Math.round((a / tot) * 100) : null };
}

function renderTeamPick() {
  const tp = state.teamPick;
  const m = state.current;
  const countA = tp.squads.A.length;
  const countB = tp.squads.B.length;
  const sizeDiff = squadSizeDiff(tp.squads);
  const pool = playersAvailableToday();
  const sideOf = new Map();
  tp.squads.A.forEach(id => sideOf.set(id, 'A'));
  tp.squads.B.forEach(id => sideOf.set(id, 'B'));
  const unassigned = pool.filter(p => !sideOf.has(p.id)).length;
  const strength = squadStrengthPct(pool, tp.squads);
  const ready = countA >= 2 && countB >= 2 && sizeDiff <= 1;
  const note = unassigned
    ? `${unassigned} still to assign`
    : sizeDiff > 1
      ? 'Tap a few players across to even it out'
      : (strength.pct != null && Math.abs(strength.pct - 50) <= 8)
        ? 'Nicely balanced'
        : 'Tap a few players across to even it out';
  const order = { A: 0, B: 1 };
  const rows = [...pool].sort((a, b) =>
    (order[sideOf.get(a.id)] ?? 2) - (order[sideOf.get(b.id)] ?? 2)
    || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const markA = (m.teams.A || 'A').trim().charAt(0).toUpperCase() || 'A';
  const markB = (m.teams.B || 'B').trim().charAt(0).toUpperCase() || 'B';
  const shuffle = (countA + countB) > 0 ? 'squad-review-reshuffle' : 'auto-pick-teams';
  return `
    <div class="screen bcc-setup">
      ${setupTop('Pick teams', `${pool.length} players in today`, 'back-from-team-pick', `<button type="button" class="bcc-ib" data-action="${shuffle}" aria-label="Shuffle teams">🔀</button>`)}
      ${setupSteps(3)}
      <div class="bcc-scroll bcc-setup-body">
        <div class="bcc-bal">
          <div class="bcc-bal-r">
            <div><div class="bcc-an is-g">${countA}</div><small>${esc(m.teams.A)}</small></div>
            <div class="is-mid"><div class="bcc-an">${strength.pct == null ? '– : –' : `${strength.pct} : ${100 - strength.pct}`}</div><small>Strength</small></div>
            <div class="is-end"><div class="bcc-an is-b">${countB}</div><small>${esc(m.teams.B)}</small></div>
          </div>
          <div class="bcc-split"><i class="is-a" style="flex:${strength.a || 1}"></i><i class="is-b" style="flex:${strength.b || 1}"></i></div>
          <p>${note}</p>
        </div>
        <div class="bcc-plist">
          ${rows.map(p => {
            const side = sideOf.get(p.id) || '';
            return `
              <div class="bcc-prow">
                ${playerAvatarHtml(p)}
                <span class="bcc-nm"><b>${esc(p.name)}</b><small>${p.batting.runs} runs · ${p.bowling.wickets} wkts</small></span>
                <span class="bcc-seg">
                  <button type="button" class="is-a${side === 'A' ? ' is-on' : ''}" data-action="assign-squad" data-player-id="${esc(p.id)}" data-side="A">${esc(markA)}</button>
                  <button type="button" class="is-b${side === 'B' ? ' is-on' : ''}" data-action="assign-squad" data-player-id="${esc(p.id)}" data-side="B">${esc(markB)}</button>
                </span>
              </div>`;
          }).join('') || '<p class="bcc-empty">No players marked available.</p>'}
        </div>
      </div>
      <div class="bcc-setup-bar">
        <button type="button" class="bcc-cta bcc-an" data-action="finish-team-pick" ${ready ? '' : 'disabled'}>Continue to toss →</button>
      </div>
    </div>`;
}

function seasonMatchPool() {
  const byId = new Map();
  for (const m of state.seasonMatches || []) if (m?.id) byId.set(m.id, m);
  for (const m of state.history || []) if (m?.id) byId.set(m.id, m);
  if (state.current?.id) byId.set(state.current.id, state.current);
  return [...byId.values()];
}

function renderSeasonSwitch(years, selected, action, includeOverall = true) {
  const items = [
    ...(includeOverall ? [{ id: 'all', label: 'Overall' }] : []),
    ...years.map(year => ({ id: year, label: year })),
  ];
  return `<div class="bcc-years" role="tablist">${items.map(item => `
    <button type="button" role="tab" aria-selected="${selected === item.id}"
      class="${selected === item.id ? 'is-on' : ''}"
      data-action="${action}" data-year="${esc(item.id)}">${esc(item.label)}</button>
  `).join('')}</div>`;
}

function renderSeasonBoard(facts) {
  if (!facts) return '';
  const row = (label, player, figure, tone) => {
    if (!player) return '';
    return `
      <button type="button" class="bcc-prow" data-action="view-player" data-player-id="${esc(player.id)}" data-from="${tone === 'bowl' ? 'bowling' : 'batting'}">
        <span class="bcc-nm"><b>${esc(player.name)}</b><small>${esc(label)}</small></span>
        <span class="bcc-chip ${tone === 'bowl' ? 'is-wkts' : 'is-runs'} bcc-an">${esc(String(figure))}</span>
      </button>`;
  };
  return `
    <div class="bcc-season">
      <div class="bcc-season-top">
        <div><b class="bcc-an">${facts.matches}</b><small>Matches</small></div>
        <div><b class="bcc-an">${facts.balls}</b><small>Balls bowled</small></div>
      </div>
      ${row('Best batter', facts.batter, facts.batter?.batting?.runs ?? '', 'bat')}
      ${row('Best bowler', facts.bowler, facts.bowler?.bowling?.wickets ?? '', 'bowl')}
      ${row('Most extras', facts.extrasLeader, facts.extrasLeader?.bowling?.extras ?? '', 'bowl')}
      ${row('Best economy', facts.economy, facts.economy ? window.QCPlayers.bowlEcon(facts.economy.bowling) : '', 'bowl')}
      ${row('Clutch wins', facts.clutch, facts.clutchWins || '', 'bat')}
    </div>`;
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-GB');
}

function samePlayerCard(card, player) {
  if (!card || !player) return false;
  if (player.id && card.playerId) return card.playerId === player.id;
  return String(card.name || '').trim().toLowerCase() === String(player.name || '').trim().toLowerCase();
}

function seasonChoices() {
  const QP = window.QCPlayers;
  return QP?.seasonYears ? QP.seasonYears(state.players, seasonMatchPool()) : [];
}

function activeSeason() {
  const years = seasonChoices();
  const now = String(new Date().getFullYear());
  if (state.appSeason === 'all') return 'all';
  if (state.appSeason && years.includes(state.appSeason)) return state.appSeason;
  if (years.includes(now)) return now;
  return years[0] || now;
}

function completedSeasonMatches(year) {
  const QP = window.QCPlayers;
  return seasonMatchPool()
    .filter(m => m && m.status === 'completed' && m.innings && (year === 'all' || !QP?.seasonKeyOf || QP.seasonKeyOf(m) === String(year)))
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
}

function playerAppeared(match, player) {
  for (const inn of match.innings || []) {
    if ((inn.batters || []).some(b => samePlayerCard(b, player))) return true;
    if ((inn.bowlers || []).some(b => samePlayerCard(b, player))) return true;
  }
  return false;
}

function playerRunsInMatch(match, player) {
  let runs = 0;
  let faced = false;
  let sixes = 0;
  for (const inn of match.innings || []) {
    for (const b of inn.batters || []) {
      if (!samePlayerCard(b, player)) continue;
      faced = true;
      runs += Number(b.runs) || 0;
      sixes += Number(b.sixes) || 0;
    }
  }
  return { faced, runs, sixes };
}

function seasonDelta(now, prev, asPercent) {
  if (prev == null || Number.isNaN(Number(prev))) return '';
  const d = Number(now) - Number(prev);
  if (!d) return '';
  const up = d > 0;
  let text = String(Math.abs(Math.round(d)));
  if (asPercent && Number(prev) > 0) text = `${Math.abs(Math.round((d / Number(prev)) * 100))}%`;
  return `<em class="${up ? 'is-up' : 'is-dn'}">${up ? '▲' : '▼'} ${text}</em>`;
}

function renderSeasonChip() {
  const label = activeSeason() === 'all' ? 'All-time' : activeSeason();
  return `<button type="button" class="ssn-chip" data-action="season-picker">${esc(label)} ▾</button>`;
}

function buildSeasonBoard(year) {
  const QP = window.QCPlayers;
  const y = year === 'all' ? 'all' : String(year || '');
  const played = completedSeasonMatches(y);
  const views = (y === 'all' || !QP?.playerInSeason)
    ? state.players
    : state.players.map(p => QP.playerInSeason(p, y));
  const batters = QP?.battingRankings ? QP.battingRankings(views) : [];
  const bowlers = QP?.bowlingRankings ? QP.bowlingRankings(views) : [];
  let runs = 0;
  let wickets = 0;
  let sixes = 0;
  const months = Array.from({ length: 12 }, () => 0);
  let closest = null;
  let biggestWkts = null;
  let biggestRuns = null;
  const impact = new Map();
  const potm = new Map();
  const showed = new Map();
  const running = new Map();
  const snaps = [];
  let bestBat = null;
  let bestBowl = null;
  for (const match of played) {
    const when = new Date(match.startedAt || 0);
    if (match.startedAt) months[when.getMonth()] += 1;
    for (const inn of match.innings || []) {
      runs += inn.score?.runs || 0;
      wickets += inn.score?.wickets || 0;
      for (const b of inn.batters || []) {
        sixes += Number(b.sixes) || 0;
        const score = Number(b.runs) || 0;
        if (!bestBat || score > bestBat.runs) {
          bestBat = { runs: score, name: b.name, balls: b.balls || 0, when };
        }
      }
      for (const b of inn.bowlers || []) {
        const wk = Number(b.wickets) || 0;
        const conceded = Number(b.runs) || 0;
        if (!bestBowl || wk > bestBowl.wickets || (wk === bestBowl.wickets && conceded < bestBowl.runs)) {
          bestBowl = { wickets: wk, runs: conceded, name: b.name, when };
        }
      }
    }
    const res = String(match.result || '');
    const byRuns = res.match(/by (\d+) runs/);
    const byWkts = res.match(/by (\d+) wickets/);
    const winner = [match.teams?.A, match.teams?.B].find(name => name && res.startsWith(`${name} won`)) || '';
    const stamp = `${when.getDate()} ${HISTORY_MONTHS[when.getMonth()]}`;
    if (byRuns) {
      const n = Number(byRuns[1]);
      if (!closest || n < closest.n) closest = { n, label: `${n} ${n === 1 ? 'run' : 'runs'}`, side: winner, when: stamp };
    }
    if (byWkts) {
      const n = Number(byWkts[1]);
      if (!biggestWkts || n > biggestWkts.n) biggestWkts = { n, label: `${n} ${n === 1 ? 'wicket' : 'wickets'}`, side: winner, when: stamp };
    }
    if (byRuns) {
      const n = Number(byRuns[1]);
      if (!biggestRuns || n > biggestRuns.n) biggestRuns = { n, label: `${n} ${n === 1 ? 'run' : 'runs'}`, side: winner, when: stamp };
    }
    if (QP?.computeAwards && QP.matchPerformanceScore) {
      try {
        const awards = QP.computeAwards(match, state.players);
        if (awards?.potm?.playerId) potm.set(awards.potm.playerId, (potm.get(awards.potm.playerId) || 0) + 1);
      } catch { /* skip a broken scorecard */ }
      for (const p of state.players) {
        if (!playerAppeared(match, p)) continue;
        showed.set(p.id, (showed.get(p.id) || 0) + 1);
        const line = playerRunsInMatch(match, p);
        running.set(p.id, (running.get(p.id) || 0) + line.runs);
        try {
          const perf = QP.matchPerformanceScore(match, p.id, p.name);
          const row = impact.get(p.id) || { id: p.id, name: p.name, score: 0 };
          row.score += perf.score || 0;
          impact.set(p.id, row);
        } catch { /* ignore */ }
      }
      snaps.push(new Map(running));
    }
  }
  const rankedImpact = [...impact.values()].sort((a, b) => b.score - a.score);
  const potmLeader = rankedImpact[0] ? {
    ...rankedImpact[0],
    awards: potm.get(rankedImpact[0].id) || 0,
    view: views.find(p => p.id === rankedImpact[0].id) || null,
  } : null;
  const topIds = [...running.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
  const colors = ['#f2a900', '#1f7a4d', '#2f6fe4'];
  const race = topIds.map((id, i) => ({
    id,
    name: state.players.find(p => p.id === id)?.name || 'Player',
    color: colors[i],
    points: snaps.map(snap => snap.get(id) || 0),
  }));
  let leaderId = null;
  let flips = 0;
  let flipAt = -1;
  let flipName = '';
  for (let i = 0; i < snaps.length; i++) {
    let bestId = null;
    let best = -1;
    for (const [id, value] of snaps[i]) {
      if (value > best) { best = value; bestId = id; }
    }
    if (bestId && bestId !== leaderId) {
      if (leaderId) {
        flips += 1;
        flipAt = i;
        flipName = state.players.find(p => p.id === bestId)?.name || '';
      }
      leaderId = bestId;
    }
  }
  const prevYear = y !== 'all' ? String(Number(y) - 1) : '';
  const prevPlayed = prevYear && seasonChoices().includes(prevYear) ? completedSeasonMatches(prevYear) : [];
  let prevRuns = 0;
  let prevWickets = 0;
  let prevSixes = 0;
  for (const match of prevPlayed) {
    for (const inn of match.innings || []) {
      prevRuns += inn.score?.runs || 0;
      prevWickets += inn.score?.wickets || 0;
      for (const b of inn.batters || []) prevSixes += Number(b.sixes) || 0;
    }
  }
  const dates = played.map(m => m.startedAt).filter(Boolean);
  const first = dates.length ? new Date(dates[0]) : null;
  const last = dates.length ? new Date(dates[dates.length - 1]) : null;
  const open = y !== 'all' && Number(y) === new Date().getFullYear();
  const showedRows = [...showed.entries()]
    .map(([id, n]) => ({ id, name: state.players.find(p => p.id === id)?.name || '', n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .slice(0, 5);
  const bySixes = views.filter(p => (p.batting?.sixes || 0) > 0).sort((a, b) => (b.batting.sixes || 0) - (a.batting.sixes || 0));
  const byRate = views
    .filter(p => (p.batting?.balls || 0) >= 30)
    .sort((a, b) => (parseFloat(QP.batSR(b.batting)) || 0) - (parseFloat(QP.batSR(a.batting)) || 0));
  const byExtras = views.filter(p => (p.bowling?.extras || 0) > 0).sort((a, b) => (b.bowling.extras || 0) - (a.bowling.extras || 0));
  const clutch = views.slice().sort((a, b) => {
    const ca = (a.batting?.carriedWins || 0) + (a.bowling?.stoodUpWins || 0);
    const cb = (b.batting?.carriedWins || 0) + (b.bowling?.stoodUpWins || 0);
    return cb - ca;
  })[0];
  const clutchWins = clutch ? (clutch.batting?.carriedWins || 0) + (clutch.bowling?.stoodUpWins || 0) : 0;
  return {
    year: y,
    played,
    runs,
    wickets,
    sixes,
    months,
    batters,
    bowlers,
    bySixes,
    byRate,
    byExtras,
    clutch: clutchWins > 0 ? clutch : null,
    clutchWins,
    potm: potmLeader,
    impactRunners: rankedImpact.slice(1, 3),
    race,
    flips,
    flipAt,
    flipName,
    closest,
    biggest: biggestWkts || biggestRuns,
    prev: prevPlayed.length ? { matches: prevPlayed.length, runs: prevRuns, wickets: prevWickets, sixes: prevSixes } : null,
    open,
    first,
    last,
    showed: showedRows,
    bestBat,
    bestBowl,
    views,
  };
}

function renderCapRace(board) {
  const lines = board.race.filter(r => r.points.some(v => v > 0));
  if (lines.length < 1 || !board.played.length) return '<p class="ssn-empty">The race starts after the first match.</p>';
  const W = 320;
  const H = 168;
  const L = 28;
  const R = 78;
  const T = 10;
  const B = 22;
  const n = Math.max(1, board.played.length - 1);
  const peak = Math.max(10, ...lines.flatMap(r => r.points));
  const X = i => L + ((W - L - R) * i) / n;
  const Y = v => T + (H - T - B) - (v / peak) * (H - T - B);
  let g = '';
  for (const v of [0, Math.round(peak / 2), peak]) {
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#e5dfcf"/><text x="${L - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9" font-weight="700" fill="#74807a">${v}</text>`;
  }
  const monthMarks = [];
  for (let i = 0; i < board.played.length; ) {
    const month = new Date(board.played[i].startedAt || 0).getMonth();
    let j = i + 1;
    while (j < board.played.length && new Date(board.played[j].startedAt || 0).getMonth() === month) j += 1;
    monthMarks.push({ i: Math.floor((i + j - 1) / 2), label: HISTORY_MONTHS[month] });
    i = j;
  }
  monthMarks.forEach(mark => {
    g += `<text x="${X(mark.i).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9" font-weight="700" fill="#74807a">${esc(mark.label)}</text>`;
  });
  if (board.flipAt > 0) {
    g += `<line x1="${X(board.flipAt).toFixed(1)}" x2="${X(board.flipAt).toFixed(1)}" y1="${T}" y2="${T + (H - T - B)}" stroke="#0a2118" stroke-dasharray="3 3" opacity="0.35"/>`;
  }
  lines.forEach(line => {
    const d = line.points.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
    const end = line.points[line.points.length - 1] || 0;
    g += `<path d="${d}" fill="none" stroke="${line.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    g += `<circle cx="${X(line.points.length - 1).toFixed(1)}" cy="${Y(end).toFixed(1)}" r="4.5" fill="${line.color}" stroke="#fffdf7" stroke-width="2"/>`;
    g += `<text x="${(X(line.points.length - 1) + 8).toFixed(1)}" y="${(Y(end) + 4).toFixed(1)}" font-size="11" font-weight="800" fill="#0a2118">${esc(line.name.split(' ')[0])} <tspan fill="#74807a" font-weight="700">${end}</tspan></text>`;
  });
  const note = board.flipAt > 0 && board.flipName
    ? `<p class="ssn-note">${esc(board.flipName)} took the lead at match ${board.flipAt + 1}.</p>`
    : '';
  return `<svg class="ssn-race" viewBox="0 0 ${W} ${H}" role="img" aria-label="Runs of the top batters after each match">${g}</svg>${note}`;
}

function leaderRows(board) {
  const tab = state.seasonLeader || 'runs';
  const qualified = !!state.seasonQualified;
  const minBalls = 30;
  let rows = [];
  let figure = p => p.batting?.runs || 0;
  let unit = 'runs';
  if (tab === 'wickets') {
    rows = board.bowlers.filter(p => !qualified || (p.bowling?.balls || 0) >= minBalls);
    figure = p => p.bowling?.wickets || 0;
    unit = 'wickets';
  } else if (tab === 'sixes') {
    rows = board.bySixes.filter(p => !qualified || (p.batting?.balls || 0) >= minBalls);
    figure = p => p.batting?.sixes || 0;
    unit = 'sixes';
  } else if (tab === 'sr') {
    rows = board.batters.filter(p => (p.batting?.balls || 0) >= (qualified ? minBalls : 1));
    rows = rows.slice().sort((a, b) => (parseFloat(window.QCPlayers.batSR(b.batting)) || 0) - (parseFloat(window.QCPlayers.batSR(a.batting)) || 0));
    figure = p => window.QCPlayers.batSR(p.batting);
    unit = 'strike rate';
  } else if (tab === 'econ') {
    rows = board.bowlers.filter(p => (p.bowling?.balls || 0) >= (qualified ? minBalls : 1));
    rows = rows.slice().sort((a, b) => (parseFloat(window.QCPlayers.bowlEcon(a.bowling)) || 99) - (parseFloat(window.QCPlayers.bowlEcon(b.bowling)) || 99));
    figure = p => window.QCPlayers.bowlEcon(p.bowling);
    unit = 'economy';
  } else {
    rows = board.batters.filter(p => !qualified || (p.batting?.balls || 0) >= minBalls);
    figure = p => p.batting?.runs || 0;
  }
  return { rows: rows.slice(0, 8), figure, unit, tab };
}

function renderSeasons() {
  const year = activeSeason();
  const boardYear = year === 'all' ? (seasonChoices()[0] || String(new Date().getFullYear())) : year;
  const board = buildSeasonBoard(year === 'all' ? 'all' : boardYear);
  const titleYear = year === 'all' ? 'All-time' : board.year;
  const leaders = leaderRows(board);
  const peak = leaders.rows.length ? Number(leaders.figure(leaders.rows[0])) || 1 : 1;
  const cap = leaders.tab === 'runs' ? 'Orange cap' : leaders.tab === 'wickets' ? 'Purple cap' : leaders.tab === 'sixes' ? 'Sixes' : leaders.tab === 'sr' ? 'Strike rate' : 'Economy';
  const head = leaders.rows[0];
  const headMeta = head ? (
    leaders.tab === 'wickets' || leaders.tab === 'econ'
      ? `Econ ${window.QCPlayers.bowlEcon(head.bowling)} · Avg ${window.QCPlayers.bowlAvg(head.bowling)}`
      : `Avg ${window.QCPlayers.batAvg(head.batting)} · SR ${window.QCPlayers.batSR(head.batting)} · HS ${head.batting.highest || 0}`
  ) : '';
  const range = board.first
    ? `${board.first.getDate()} ${HISTORY_MONTHS[board.first.getMonth()]} – ${board.open ? 'today' : `${board.last.getDate()} ${HISTORY_MONTHS[board.last.getMonth()]}`}`
    : 'No matches yet';
  const potmView = board.potm?.view;
  const awards = [
    board.bySixes[0] ? ['🏏', 'Six machine', board.bySixes[0].name, `${board.bySixes[0].batting.sixes} sixes`, board.bySixes[0].id, 'batting'] : null,
    board.byRate[0] ? ['⚡', 'Highest run rate', board.byRate[0].name, `${((board.byRate[0].batting.runs / board.byRate[0].batting.balls) * 6).toFixed(2)} per over`, board.byRate[0].id, 'batting'] : null,
    board.bowlers[0] ? ['🎯', 'Best bowler', board.bowlers[0].name, `${board.bowlers[0].bowling.wickets} wickets`, board.bowlers[0].id, 'bowling'] : null,
    board.byExtras[0] ? ['➕', 'Most extras', board.byExtras[0].name, `${board.byExtras[0].bowling.extras} extras`, board.byExtras[0].id, 'bowling'] : null,
    board.clutch ? ['🧊', 'Clutch', board.clutch.name, `${board.clutchWins} clutch wins`, board.clutch.id, 'batting'] : null,
  ].filter(Boolean);
  const tabs = [['runs', 'Runs'], ['wickets', 'Wickets'], ['sixes', 'Sixes'], ['sr', 'SR'], ['econ', 'Econ']];
  return `
    <div class="screen ssn-page">
      <div class="bcc-top">
        <button type="button" class="bcc-ib" data-action="back-home" aria-label="Back">←</button>
        <span class="bcc-an">Season</span>
        ${renderSeasonChip()}
        <button type="button" class="bcc-ib" data-action="open-wrapped" aria-label="Season wrapped">↗</button>
      </div>
      <div class="bcc-scroll">
        <div class="ssn-hero">
          <div class="ssn-yr">
            <div class="ssn-big bcc-an">${esc(titleYear)}</div>
            <div class="ssn-meta"><b>${board.open ? 'Season open' : year === 'all' ? 'Every match' : 'Season closed'}</b><br>${esc(range)}${board.open ? '<br>closes 31 Dec' : ''}</div>
          </div>
          <div class="ssn-st">
            <div><b class="bcc-an">${fmtNum(board.played.length)}</b><small>Matches</small>${board.prev ? seasonDelta(board.played.length, board.prev.matches, false) : ''}</div>
            <div><b class="bcc-an">${fmtNum(board.runs)}</b><small>Runs</small>${board.prev ? seasonDelta(board.runs, board.prev.runs, true) : ''}</div>
            <div><b class="bcc-an">${fmtNum(board.wickets)}</b><small>Wickets</small>${board.prev ? seasonDelta(board.wickets, board.prev.wickets, true) : ''}</div>
            <div><b class="bcc-an">${fmtNum(board.sixes)}</b><small>Sixes</small>${board.prev ? seasonDelta(board.sixes, board.prev.sixes, false) : ''}</div>
          </div>
        </div>
        ${board.potm ? `
          <button type="button" class="ssn-potm" data-action="view-player" data-player-id="${esc(board.potm.id)}" data-from="batting">
            ${portraitHtml(board.potm) || '<span class="ssn-tr" aria-hidden="true">🏆</span>'}
            <span class="ssn-tx">
              <small>Player of the season</small>
              <b class="bcc-an">${faceHtml(board.potm)}${esc(board.potm.name)}</b>
              <span>${board.potm.awards} match award${board.potm.awards === 1 ? '' : 's'}</span>
              <span>${potmView?.bowling?.wickets || 0} wkts · ${potmView?.batting?.runs || 0} runs</span>
            </span>
            <span class="ssn-im"><b class="bcc-an">${Math.round(board.potm.score).toLocaleString('en-GB')}</b><small>Impact</small></span>
          </button>
          ${board.impactRunners.length ? `<div class="ssn-runn">${board.impactRunners.map((p, i) => `<div><span>${i + 2} ${faceHtml(p)}${esc(p.name)}</span><em class="bcc-an">${Math.round(p.score).toLocaleString('en-GB')}</em></div>`).join('')}</div>` : ''}
        ` : ''}
        <div class="ssn-lab">Orange cap race <i>${board.flips ? `lead changed ${board.flips}×` : 'one leader so far'}</i></div>
        <div class="ssn-box">
          <div class="ssn-rh"><span class="is-on">Runs</span></div>
          ${renderCapRace(board)}
          <div class="ssn-two">
            <div><small>Closest finish</small><b class="bcc-an">${board.closest ? esc(board.closest.label) : '—'}</b><span>${board.closest ? esc(`${board.closest.side} · ${board.closest.when}`) : 'No result yet'}</span></div>
            <div><small>Biggest win</small><b class="bcc-an">${board.biggest ? esc(board.biggest.label) : '—'}</b><span>${board.biggest ? esc(`${board.biggest.side} · ${board.biggest.when}`) : 'No result yet'}</span></div>
          </div>
        </div>
        <div class="ssn-lab">Leaders</div>
        <div class="ssn-box">
          <div class="ssn-tabs">
            ${tabs.map(([id, label]) => `<button type="button" class="${leaders.tab === id ? 'is-on' : ''}" data-action="season-leader" data-tab="${id}">${label}</button>`).join('')}
          </div>
          <button type="button" class="ssn-qual" data-action="season-qualified">
            <span>Qualified only · min 30 balls</span>
            <i class="${state.seasonQualified ? 'is-on' : ''}" aria-hidden="true"></i>
          </button>
          ${head ? `
            <button type="button" class="ssn-ld" data-action="view-player" data-player-id="${esc(head.id)}" data-from="${leaders.tab === 'wickets' || leaders.tab === 'econ' ? 'bowling' : 'batting'}">
              ${portraitHtml(head)}<span><span class="ssn-cp">${esc(cap)}</span><b class="bcc-an">${faceHtml(head)}${esc(head.name)}</b><span class="ssn-mn">${esc(headMeta)}</span></span>
              <span class="ssn-bg bcc-an">${esc(String(leaders.figure(head)))}<small>${esc(leaders.unit)}</small></span>
            </button>
            ${leaders.rows.slice(1).map((p, i) => {
              const value = Number(leaders.figure(p)) || 0;
              const width = peak ? Math.max(6, Math.round((value / peak) * 100)) : 0;
              return `<button type="button" class="ssn-lr" data-action="view-player" data-player-id="${esc(p.id)}" data-from="${leaders.tab === 'wickets' || leaders.tab === 'econ' ? 'bowling' : 'batting'}"><span class="k bcc-an">${i + 2}</span><span><b>${faceHtml(p)}${esc(p.name)}</b><i><u style="width:${width}%"></u></i></span><em class="bcc-an">${esc(String(leaders.figure(p)))}</em></button>`;
            }).join('')}
          ` : '<p class="ssn-empty">Nobody has qualified yet.</p>'}
        </div>
        <div class="ssn-lab">Showed up <i>of ${board.played.length} matches</i></div>
        <div class="ssn-box ssn-att">
          ${board.showed.map(p => `<button type="button" data-action="view-player" data-player-id="${esc(p.id)}" data-from="batting"><span>${esc(p.name)}</span><i><u style="width:${board.played.length ? Math.round(p.n / board.played.length * 100) : 0}%"></u></i><b class="bcc-an">${p.n}</b></button>`).join('') || '<p class="ssn-empty">No appearances yet.</p>'}
        </div>
        <div class="ssn-lab">Season awards</div>
        <div class="ssn-aw">
          ${awards.map(([icon, label, name, fig, id, from]) => `
            <button type="button" data-action="view-player" data-player-id="${esc(id)}" data-from="${from}">
              <span>${icon}</span><small>${esc(label)}</small><b>${faceHtml({ id, name })}${esc(name)}</b><em>${esc(fig)}</em>
            </button>`).join('')}
        </div>
        <div class="ssn-lab">Records</div>
        <div class="ssn-box ssn-rec">
          ${board.bestBat ? `<div><span>Highest score</span><b>${esc(board.bestBat.name)}</b><em class="bcc-an">${board.bestBat.runs}</em></div>` : ''}
          ${board.bestBowl && board.bestBowl.wickets ? `<div><span>Best bowling</span><b>${esc(board.bestBowl.name)}</b><em class="bcc-an">${board.bestBowl.wickets}/${board.bestBowl.runs}</em></div>` : ''}
          ${board.bySixes[0] ? `<div><span>Most sixes</span><b>${esc(board.bySixes[0].name)}</b><em class="bcc-an">${board.bySixes[0].batting.sixes}</em></div>` : ''}
        </div>
      </div>
      ${renderBccDock('seasons')}
    </div>`;
}

function shareSeasonWrap() {
  const year = activeSeason() === 'all' ? (seasonChoices()[0] || String(new Date().getFullYear())) : activeSeason();
  const board = buildSeasonBoard(year);
  const bat = board.batters[0];
  const text = [
    `BCC season ${board.year}`,
    `${board.played.length} matches, ${fmtNum(board.runs)} runs, ${board.wickets} wickets, ${board.sixes} sixes.`,
    bat ? `Orange cap: ${bat.name}, ${bat.batting.runs} runs.` : '',
    board.potm ? `Player of the season: ${board.potm.name}.` : '',
    'Bat, Bowl , Yean , Repeat!',
  ].filter(Boolean).join('\n');
  if (navigator.share) {
    navigator.share({ title: `BCC ${board.year}`, text }).catch(() => {});
    return;
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied the season summary')).catch(() => showToast('Could not copy'));
    return;
  }
  showToast('Sharing is not available here');
}

function renderWrapped() {
  const year = activeSeason() === 'all' ? (seasonChoices()[0] || String(new Date().getFullYear())) : activeSeason();
  const board = buildSeasonBoard(year);
  const bat = board.batters[0];
  const bowl = board.bowlers[0];
  const steps = [];
  if (bat) steps.push({
    kicker: 'The orange cap',
    num: String(bat.batting.runs),
    name: bat.name,
    sub: `runs this season, ${bat.batting.sixes || 0} sixes, and a best of ${bat.batting.highest || 0}.`,
  });
  if (bowl) steps.push({
    kicker: 'The purple cap',
    num: String(bowl.bowling.wickets),
    name: bowl.name,
    sub: `wickets at an economy of ${window.QCPlayers.bowlEcon(bowl.bowling)}.`,
  });
  if (board.potm) steps.push({
    kicker: 'Player of the season',
    num: board.potm.score.toFixed(0),
    name: board.potm.name,
    sub: `${board.potm.awards} player-of-the-match awards. Impact ${board.potm.score.toFixed(1)}.`,
  });
  steps.push({
    kicker: 'The year in numbers',
    title: `That was ${board.year}`,
    grid: [
      [fmtNum(board.played.length), 'Matches'],
      [fmtNum(board.runs), 'Runs'],
      [fmtNum(board.sixes), 'Sixes'],
      [fmtNum(board.showed.length ? state.players.filter(p => board.played.some(m => playerAppeared(m, p))).length : 0), 'Players'],
    ],
    line: board.potm ? `Player of the season: ${board.potm.name}` : '',
    share: true,
  });
  const step = Math.min(state.wrappedStep || 0, steps.length - 1);
  const card = steps[step] || steps[0];
  if (!card) {
    return `<div class="screen ssn-wrap"><p>No season to wrap yet.</p></div>`;
  }
  const bars = steps.map((_, i) => `<i class="${i <= step ? 'is-on' : ''}"></i>`).join('');
  return `
    <div class="screen ssn-wrap">
      <div class="ssn-sb">${bars}</div>
      <div class="ssn-wh"><span>BCC · Season ${esc(board.year)}</span><button type="button" data-action="wrapped-close" aria-label="Close">✕</button></div>
      <button type="button" class="ssn-stage" data-action="${card.share ? '' : 'wrapped-next'}">
        <span class="ssn-k">${esc(card.kicker)}</span>
        ${card.title ? `<b class="bcc-an ssn-wtitle">${esc(card.title)}</b>` : `<b class="bcc-an ssn-wnum">${esc(card.num || '')}</b><b class="bcc-an ssn-wname">${esc(card.name || '')}</b><span class="ssn-wsub">${esc(card.sub || '')}</span>`}
        ${card.grid ? `<span class="ssn-wgrid">${card.grid.map(([n, l]) => `<span><b class="bcc-an">${esc(n)}</b><small>${esc(l)}</small></span>`).join('')}</span>` : ''}
        ${card.line ? `<span class="ssn-wline">${esc(card.line)}</span>` : ''}
      </button>
      ${card.share ? `<button type="button" class="ssn-wshare" data-action="wrapped-share">Share to the group</button>` : ''}
      <div class="ssn-wfoot">${card.share ? 'Bat, Bowl , Yean , Repeat!' : 'Tap to continue'}</div>
      <div class="bcc-art"></div>
    </div>`;
}

function renderSeasonPicker() {
  const years = seasonChoices();
  const current = activeSeason();
  const now = String(new Date().getFullYear());
  const allCount = completedSeasonMatches('all').length;
  const opt = (year, title, detail, on) => `
    <button type="button" class="ssn-opt${on ? ' is-on' : ''}" data-action="pick-season" data-year="${esc(year)}">
      <span class="y bcc-an">${esc(year === 'all' ? 'All-time' : year)}</span>
      <span class="tx"><b>${esc(title)}${year === now ? '<i>Live</i>' : ''}</b>${esc(detail)}</span>
      ${on ? '<span class="ck">✓</span>' : ''}
    </button>`;
  const yearOpts = years.map((year, i) => {
    const matches = completedSeasonMatches(year);
    const first = matches[0]?.startedAt ? HISTORY_MONTHS[new Date(matches[0].startedAt).getMonth()] : '';
    const last = matches.length ? HISTORY_MONTHS[new Date(matches[matches.length - 1].startedAt).getMonth()] : '';
    const title = year === now ? 'Current season' : (i === 1 ? 'Last season' : 'Season');
    return opt(year, title, `${matches.length} matches${first ? ` · ${first} – ${last}` : ''}`, current === year);
  }).join('');
  return `
    <div class="ssn-shade">
      <button type="button" class="ssn-shade-hit" data-action="close-season-picker" aria-label="Close"></button>
      <div class="ssn-sheet" role="dialog" aria-label="Choose season">
        <div class="ssn-grab"></div>
        <h3 class="bcc-an">Choose season</h3>
        <p>Home, past matches, players and this dashboard follow the year.</p>
        ${yearOpts}
        ${opt('all', 'Every match ever', `${allCount} matches · ${state.players.length} players`, current === 'all')}
        <p class="ssn-hint">A match counts in the year it was played. Nothing to set up.</p>
      </div>
    </div>`;
}


function renderPlayers() {
  const year = activeSeason();
  const QP = window.QCPlayers;
  const source = year === 'all' || !QP.playerInSeason ? state.players : state.players.map(p => QP.playerInSeason(p, year));
  const list = year === 'all' ? source : source.filter(p => (p.batting?.innings || 0) > 0 || (p.bowling?.innings || 0) > 0 || (p.batting?.runs || 0) > 0 || (p.bowling?.balls || 0) > 0);
  const tab = state.playersTab || 'roster';
  const batRanked = QP.battingRankings(list);
  const bowlRanked = QP.bowlingRankings(list);
  const rosterSorted = [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const tabs = [
    { id: 'roster', label: 'Roster', count: list.length },
    { id: 'batting', label: 'Batting', count: batRanked.length },
    { id: 'bowling', label: 'Bowling', count: bowlRanked.length },
  ];

  function statRow(p, rank, kind) {
    const qualified = kind === 'bowl' ? QP.bowlingQualifies(p.bowling) : QP.battingQualifies(p.batting);
    const inns = kind === 'bowl' ? (p.bowling.innings || 0) : (p.batting.innings || 0);
    const line = kind === 'bowl'
      ? `${QP.bowlingWicketsPerInnings(p.bowling).toFixed(2)} wkts/inns · Econ ${QP.bowlEcon(p.bowling)}`
      : `${QP.battingRunsPerInnings(p.batting).toFixed(1)} runs/inns · SR ${QP.batSR(p.batting)}`;
    const note = qualified ? line : `Not ranked yet · ${inns}/${QP.MIN_QUALIFY_INNINGS} inns`;
    const chip = kind === 'bowl'
      ? `<span class="bcc-chip is-wkts bcc-an" title="Wickets">${p.bowling.wickets}</span>`
      : `<span class="bcc-chip is-runs bcc-an" title="Runs">${p.batting.runs}</span>`;
    const tone = !qualified ? '' : rank === 1 ? 'is-r1' : rank === 2 ? 'is-r2' : rank === 3 ? 'is-r3' : '';
    return `
      <button type="button" class="bcc-prow ${tone}" data-action="view-player" data-player-id="${esc(p.id)}" data-from="${kind === 'bowl' ? 'bowling' : 'batting'}">
        <span class="bcc-av bcc-an">${qualified ? rank : '–'}</span>
        <span class="bcc-nm"><b>${esc(p.name)}</b><small>${esc(note)}</small></span>
        ${chip}
      </button>`;
  }

  function rosterRow(p) {
    return `
      <button type="button" class="bcc-prow" data-action="view-player" data-player-id="${esc(p.id)}" data-from="batting">
        ${playerAvatarHtml(p)}
        <span class="bcc-nm"><b>${esc(p.name)}</b><small>SR ${QP.batSR(p.batting)} · ${QP.fmtOvers(p.bowling.balls)} ov</small></span>
        <span class="bcc-chip is-runs bcc-an" title="Runs">${p.batting.runs}</span>
        <span class="bcc-chip is-wkts bcc-an" title="Wickets">${p.bowling.wickets}</span>
      </button>`;
  }

  let tableBody = '';
  if (tab === 'roster') {
    tableBody = rosterSorted.length
      ? rosterSorted.map(rosterRow).join('')
      : `<div class="players-empty players-empty--compact"><p>${year === 'all' ? 'No players yet — add a name above' : `Nobody played in ${year}`}</p></div>`;
  } else if (tab === 'batting') {
    tableBody = batRanked.length
      ? batRanked.map((p, i) => statRow(p, i + 1, 'bat')).join('')
      : `<div class="players-empty players-empty--compact"><p>No batting stats — finish a match first</p></div>`;
  } else {
    tableBody = bowlRanked.length
      ? bowlRanked.map((p, i) => statRow(p, i + 1, 'bowl')).join('')
      : `<div class="players-empty players-empty--compact"><p>No bowling stats — finish a match first</p></div>`;
  }

  return `
    <div class="screen bcc-players">
      <div class="bcc-top">
        <button type="button" class="bcc-ib" data-action="back-home" aria-label="Back">←</button>
        <span class="bcc-an">Players</span>
        ${renderSeasonChip()}
      </div>
      <div class="bcc-art"></div>
      <div class="bcc-scroll">
        <div class="bcc-wrap">
          <div class="bcc-add">
            <input id="new-player-input" type="text" placeholder="Add player…" autocomplete="off" autocapitalize="words" />
            <button type="button" data-action="add-player">Add</button>
          </div>
          <div class="bcc-seg" role="tablist">
            ${tabs.map(t => `
              <button type="button" role="tab" aria-selected="${tab === t.id}"
                class="${tab === t.id ? 'is-on' : ''}"
                data-action="players-tab" data-tab="${t.id}">
                ${esc(t.label)}<small>${t.count}</small>
              </button>
            `).join('')}
          </div>
          ${tab === 'roster' && rosterSorted.length ? `<div class="bcc-colhead"><span>Runs</span><span>Wkts</span></div>` : ''}
          ${tab === 'batting' && batRanked.length ? `<div class="bcc-colhead"><span>Runs</span></div>` : ''}
          ${tab === 'bowling' && bowlRanked.length ? `<div class="bcc-colhead"><span>Wkts</span></div>` : ''}
          <div class="bcc-plist">${tableBody}</div>
        </div>
      </div>
      ${renderBccDock('players')}
    </div>
  `;
}

function renderFactTiles(items) {
  return `<div class="bcc-f3">${items.map(([val, label, wide]) => `
    <div${wide ? ' class="is-wide"' : ''}><b class="bcc-an">${esc(String(val))}</b><small>${esc(label)}</small></div>
  `).join('')}</div>`;
}

function renderCssRings(rings) {
  return `<div class="bcc-bx bcc-rings-box"><div class="bcc-rings">${rings.map(r => `
    <div class="bcc-rg">
      <div class="bcc-ring" style="--p:${r.pct};--c:${r.color}" data-v="${r.pct}%"></div>
      <small>${esc(r.label)}</small>
    </div>`).join('')}</div></div>`;
}

function renderStatDonut(parts, unit) {
  const shown = parts.filter(p => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  if (!total) return '';
  const r = 42;
  const C = 2 * Math.PI * r;
  let off = 0;
  const arcs = shown.map(p => {
    const d = (p.value / total) * C;
    const el = `<circle class="bcc-dn" cx="60" cy="60" r="${r}" fill="none" stroke="${p.color}" stroke-width="16" stroke-dasharray="${d.toFixed(2)} ${(C - d).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;
    off += d;
    return el;
  }).join('');
  const legend = shown.map(p => {
    const pc = Math.round((p.value / total) * 100);
    return `
      <div class="bcc-lg-row">
        <div class="bcc-lg-l"><span><i class="bcc-dot" style="background:${p.color}"></i>${esc(p.label)}</span><span><em class="bcc-lg-n">${p.value}</em> <b class="bcc-lg-pc">${pc}%</b></span></div>
        <div class="bcc-trk"><i style="width:${pc}%;background:${p.color}"></i></div>
      </div>`;
  }).join('');
  return `
    <div class="bcc-donut">
      <svg viewBox="0 0 120 120" width="140" height="140" aria-hidden="true">
        <g transform="rotate(-90 60 60)">
          <circle cx="60" cy="60" r="${r}" fill="none" stroke="#e2dac6" stroke-width="16"/>
          ${arcs}
        </g>
        <text x="60" y="64" text-anchor="middle" font-size="26" fill="#0a2118" font-family="Anton, Impact, sans-serif">${total}</text>
        <text x="60" y="78" text-anchor="middle" font-size="8" font-weight="800" fill="#6b766e">${esc(String(unit).toUpperCase())}</text>
      </svg>
      <div class="bcc-lgr">${legend}</div>
    </div>`;
}

function renderHighlightBars(items, hiIndex, color, axis) {
  if (!items.length) return '';
  const peak = Math.max(1, ...items.map(i => i.value));
  const W = 300;
  const H = 150;
  const g = W / items.length;
  const bw = Math.min(30, g - 10);
  const grid = [0, 0.5, 1].map(f => {
    const y = 110 - f * 80;
    return `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="#e2dac6" stroke-dasharray="3 4"/>`;
  }).join('');
  const bars = items.map((item, i) => {
    const h = Math.max(3, (item.value / peak) * 80);
    const x = g * i + (g - bw) / 2;
    const on = i === hiIndex;
    return `
      <rect class="bcc-gr" style="animation-delay:${i * 60}ms" x="${x.toFixed(1)}" y="${(110 - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="8" fill="${on ? color : '#6b766e'}" opacity="${on ? 1 : 0.35}"/>
      <text x="${(x + bw / 2).toFixed(1)}" y="${Math.max(12, 104 - h).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="#0a2118">${item.value}</text>
      <text x="${(x + bw / 2).toFixed(1)}" y="128" text-anchor="middle" font-size="11" font-weight="800" fill="${on ? '#0a2118' : '#6b766e'}">${esc(String(item.label))}</text>`;
  }).join('');
  return `<svg class="bcc-hbars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(axis)}">${grid}${bars}<text x="${W / 2}" y="146" text-anchor="middle" font-size="9" font-weight="800" fill="#6b766e">${esc(axis)}</text></svg>`;
}

function renderPlayerDetail() {
  const raw = state.playerDetail;
  if (!raw) return renderPlayers();
  const QP = window.QCPlayers;
  const pool = seasonMatchPool();
  const years = QP.seasonYears ? QP.seasonYears(state.players, pool) : [];
  const season = years.includes(state.playerSeason) ? state.playerSeason : 'all';
  if (season !== state.playerSeason) state.playerSeason = season;
  const viewed = season !== 'all' && QP.playerInSeason ? QP.playerInSeason(raw, season) : raw;
  const bat = QP.battingView ? QP.battingView(viewed.batting) : viewed.batting;
  const bowl = QP.bowlingView ? QP.bowlingView(viewed.bowling) : viewed.bowling;
  const p = raw;
  const rankedPool = season !== 'all' && QP.playerInSeason
    ? state.players.map(pl => QP.playerInSeason(pl, season))
    : state.players;
  const balls = bat.balls || 0;
  const dots = Math.min(bat.dots || 0, balls);
  const fours = Math.min(bat.fours || 0, balls);
  const sixes = Math.min(bat.sixes || 0, Math.max(0, balls - fours));
  const otherBalls = Math.max(0, balls - dots - fours - sixes);
  const ballMix = [
    { label: 'Dots', value: dots, color: '#8b948d' },
    { label: '1–3 runs', value: otherBalls, color: '#1f7a4d' },
    { label: 'Fours', value: fours, color: '#f2a900' },
    { label: 'Sixes', value: sixes, color: '#d8432b' },
  ];
  const positions = Object.entries(bat.positions || {})
    .map(([key, v]) => ({ label: key, value: v.runs || 0 }))
    .filter(item => item.value > 0 || (bat.positions[item.label]?.inns || 0) > 0)
    .sort((a, b) => Number(a.label) - Number(b.label));
  const overs = Object.entries(bowl.overSlots || {})
    .map(([key, v]) => ({ label: key, value: v.wickets || 0 }))
    .filter(item => item.value > 0 || (bowl.overSlots[item.label]?.balls || 0) > 0)
    .sort((a, b) => Number(a.label) - Number(b.label));
  const legal = bowl.balls || 0;
  const bowlMix = [
    { label: 'Legal', value: legal, color: '#1f7a4d' },
    { label: 'Wides', value: bowl.wides || 0, color: '#f2a900' },
    { label: 'No-balls', value: bowl.noBalls || 0, color: '#d8432b' },
  ];
  const batWin = bat.innings ? Math.round(((bat.wins || 0) / bat.innings) * 100) : 0;
  const bowlWin = bowl.innings ? Math.round(((bowl.wins || 0) / bowl.innings) * 100) : 0;
  const share = bat.teamRuns ? Math.round(Math.min(1, bat.runs / bat.teamRuns) * 100) : 0;
  const stood = bowl.innings ? Math.round(((bowl.stoodUp || 0) / bowl.innings) * 100) : 0;
  const bestPos = QP.bestBattingPosition(bat);
  const clubRuns = rankedPool.reduce((s, pl) => s + (pl.batting?.runs || 0), 0);
  const clubWkts = rankedPool.reduce((s, pl) => s + (pl.bowling?.wickets || 0), 0);
  const runPct = clubRuns ? Math.round((bat.runs / clubRuns) * 100) : 0;
  const wktPct = clubWkts ? Math.round((bowl.wickets / clubWkts) * 100) : 0;
  const batRank = rankedPool.filter(pl => (pl.batting?.runs || 0) > bat.runs).length + 1;
  const bowlRank = rankedPool.filter(pl => (pl.bowling?.wickets || 0) > bowl.wickets).length + 1;
  const statTab = state.playerStatTab === 'bowl' ? 'bowl' : 'bat';
  const batting = statTab !== 'bowl';
  const hasBat = (bat.runs || 0) > 0;
  const hasBowl = (bowl.wickets || 0) > 0;
  const hiPos = bestPos ? positions.findIndex(item => String(item.label) === String(bestPos.pos)) : -1;
  const hiOver = overs.reduce((best, item, i) => (item.value > (overs[best]?.value || 0) ? i : best), 0);
  const kpis = batting
    ? [[bat.runs, 'Runs'], [QP.batSR(bat), 'Strike rate'], [`${runPct}%`, 'Of club runs']]
    : [[bowl.wickets, 'Wickets'], [QP.fmtOvers(bowl.balls), 'Overs'], [`${wktPct}%`, 'Of club wkts']];
  const prevYear = season !== 'all' ? String(Number(season) - 1) : '';
  const prevView = prevYear && years.includes(prevYear) && QP.playerInSeason ? QP.playerInSeason(raw, prevYear) : null;
  const prevBat = prevView && QP.battingView ? QP.battingView(prevView.batting) : null;
  const prevBowl = prevView && QP.bowlingView ? QP.bowlingView(prevView.bowling) : null;
  const cardKpis = [
    [bat.runs, 'Runs', prevBat ? seasonDelta(bat.runs, prevBat.runs, false) : ''],
    [QP.batAvg(bat), 'Avg', prevBat ? seasonDelta(parseFloat(QP.batAvg(bat)), parseFloat(QP.batAvg(prevBat)), false) : ''],
    [QP.batSR(bat), 'SR', prevBat ? seasonDelta(parseFloat(QP.batSR(bat)), parseFloat(QP.batSR(prevBat)), false) : ''],
    [bowl.wickets, 'Wkts', prevBowl ? seasonDelta(bowl.wickets, prevBowl.wickets, false) : ''],
  ];
  const formMatches = completedSeasonMatches(season).map(m => ({ line: playerRunsInMatch(m, raw) })).filter(x => x.line.faced);
  const formPeak = Math.max(1, ...formMatches.map(x => x.line.runs), 0);
  const formHtml = formMatches.length ? `
    <div class="bcc-bx"><h4><span>${season === 'all' ? 'Runs per match' : `${season} form · runs per match`}</span><i>Best: ${formPeak}</i></h4>
      <div class="ssn-form">${formMatches.map((x, i) => `<div>${x.line.runs}<i class="${x.line.runs === formPeak && x.line.runs > 0 ? 'is-hi' : ''}" style="height:${Math.max(3, Math.round((x.line.runs / formPeak) * 72))}px"></i><em>${i + 1}</em></div>`).join('')}</div>
    </div>` : '';
  const seasonTable = years.map(y => {
    const view = QP.playerInSeason(raw, y);
    const b = QP.battingView(view.batting);
    const w = QP.bowlingView(view.bowling);
    if (!(b.innings || w.innings || b.runs || w.wickets)) return '';
    return `<div class="ssn-tb${y === season ? ' is-cur' : ''}"><b>${esc(y)}</b><span>${b.innings}</span><span class="r bcc-an">${b.runs}</span><span>${esc(String(QP.batAvg(b)))}</span><span>${esc(String(QP.batSR(b)))}</span><span>${w.wickets}</span></div>`;
  }).join('');
  const capPool = season !== 'all' && QP.playerInSeason ? state.players.map(pl => QP.playerInSeason(pl, season)) : state.players;
  const capLeader = QP.battingRankings(capPool)[0];
  const holdsCap = season !== 'all' && capLeader && capLeader.id === p.id && (capLeader.batting?.runs || 0) > 0;
  const badge = batting
    ? (hasBat ? `<span class="bcc-rkb">#${batRank} run scorer</span>` : '')
    : (hasBowl ? `<span class="bcc-rkb">#${bowlRank} wicket taker</span>` : '');
  const body = batting
    ? (hasBat ? `
        ${renderCssRings([
          { pct: batWin, color: '#1f7a4d', label: `${bat.wins || 0} of ${bat.innings} innings won` },
          { pct: share, color: '#f2a900', label: 'Share of team runs' },
        ])}
        ${renderFactTiles([
          [bat.innings, 'Innings'],
          [bat.notOuts, 'Not out'],
          [bat.highest, 'Highest'],
          [bat.fifties, 'Fifties'],
          [bat.hundreds, 'Hundreds'],
          [bat.ducks, 'Ducks'],
          [QP.winRate(bat.carriedWins || 0, bat.carried || 0), 'Carried', true],
        ])}
        ${bestPos ? `
          <div class="bcc-best">
            <h4>Best batting position</h4>
            <div class="bcc-best-g">
              <div><b class="bcc-an">${esc(bestPos.pos)}</b><small>Position</small></div>
              <div><b class="bcc-an">${bestPos.runs}</b><small>Runs</small></div>
              <div><b class="bcc-an">${esc(String(bestPos.avg))}</b><small>Average</small></div>
              <div><b class="bcc-an">${bestPos.inns}</b><small>Innings</small></div>
            </div>
            <p>Average is runs each time they were out. A carry is an innings where they outscored the rest of the team.</p>
          </div>` : ''}
        ${balls ? `<div class="bcc-bx"><h4>Balls faced</h4>${renderStatDonut(ballMix, 'Balls')}</div>` : ''}
        ${positions.length ? `<div class="bcc-bx"><h4>Runs by batting position</h4><div class="bcc-sub">Highlighted = their best slot</div>${renderHighlightBars(positions, hiPos, '#f2a900', 'Batting position')}</div>` : ''}
      ` : `<div class="bcc-bx bcc-emp">No runs yet — get out there!</div>`)
    : (hasBowl ? `
        ${renderFactTiles([
          [QP.bowlAvg(bowl), 'Average'],
          [QP.bowlEcon(bowl), 'Economy'],
          [bowl.extras || ((bowl.wides || 0) + (bowl.noBalls || 0)), 'Extras'],
          [bowl.deliveries || bowl.balls, 'Balls bowled'],
          [bowl.runs, 'Runs hit off'],
          [bowl.dots || 0, 'Dot balls'],
        ])}
        ${(legal || bowl.wides || bowl.noBalls) ? `<div class="bcc-bx"><h4>Balls bowled</h4>${renderStatDonut(bowlMix, 'Balls')}</div>` : ''}
        ${overs.length ? `<div class="bcc-bx"><h4>Wickets by over number</h4><div class="bcc-sub">Highlighted = their most dangerous over</div>${renderHighlightBars(overs, hiOver, '#d8432b', 'Over number')}</div>` : ''}
        ${renderCssRings([
          { pct: bowlWin, color: '#1f7a4d', label: `${bowl.wins || 0} of ${bowl.innings} spells won` },
          { pct: stood, color: '#d8432b', label: `${bowl.stoodUp || 0} spells led the attack` },
        ])}
      ` : `<div class="bcc-bx bcc-emp">No wickets yet — get out there!</div>`);
  return `
    <div class="screen bcc-player">
      <div class="bcc-top">
        <button type="button" class="bcc-ib" data-action="${state.playerFrom === 'seasons' ? 'seasons' : 'players'}" aria-label="Back">←</button>
        <span class="bcc-an">${esc(p.name)}</span>
      </div>
      <div class="bcc-art"></div>
      <div class="bcc-scroll">
        <div class="bcc-pcard">
          <div class="bcc-pcard-in">
            <div class="ssn-sw">
              ${years.map(y => `<button type="button" class="${season === y ? 'is-on' : ''}" data-action="player-season" data-year="${esc(y)}">${esc(y)}</button>`).join('')}
              <button type="button" class="${season === 'all' ? 'is-on' : ''}" data-action="player-season" data-year="all">All-time</button>
            </div>
            <div class="ssn-id">
              <div>
                <h3 class="bcc-an">${esc(p.name)}</h3>
                <p>${bat.innings} innings · ${bowl.wickets} wickets${season === 'all' ? '' : ' this season'}</p>
              </div>
              ${safePlayerPhoto(p)
                ? `<div class="bcc-ph"><img src="${safePlayerPhoto(p)}" alt=""></div>`
                : `<div class="bcc-pbig bcc-an" aria-hidden="true">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</div>`}
            </div>
            <div class="bcc-kp ssn-kp">
              ${cardKpis.map(([val, label, delta]) => `<div><b class="bcc-an">${esc(String(val))}</b><small>${esc(label)}</small>${delta}</div>`).join('')}
            </div>
          </div>
          <div class="bcc-art"></div>
        </div>
        ${formHtml}
        ${seasonTable ? `<div class="bcc-bx ssn-table"><h4>Season by season</h4><div class="ssn-tb is-head"><span>Season</span><span>Inn</span><span>Runs</span><span>Avg</span><span>SR</span><span>Wkt</span></div>${seasonTable}<div class="ssn-tb is-all"><b>All-time</b><span>${QP.battingView(raw.batting).innings}</span><span class="r bcc-an">${QP.battingView(raw.batting).runs}</span><span>${esc(String(QP.batAvg(raw.batting)))}</span><span>${esc(String(QP.batSR(raw.batting)))}</span><span>${QP.bowlingView(raw.bowling).wickets}</span></div></div>` : ''}
        ${holdsCap ? `<div class="ssn-capnote"><span>🟠</span><span><b>Orange cap ${esc(season)}</b>Top run-scorer of the season so far</span></div>` : ''}
        <div class="bcc-tabs2">
          <button type="button" class="${batting ? 'is-on' : ''}" data-action="player-stat-tab" data-tab="bat">🏏 Batting</button>
          <button type="button" class="${batting ? '' : 'is-on'}" data-action="player-stat-tab" data-tab="bowl">🔴 Bowling</button>
        </div>
        <div class="bcc-wrap bcc-statbody">
          ${body}
          <div class="bcc-player-actions">
            <button type="button" data-action="player-photo" data-player-id="${esc(p.id)}">${safePlayerPhoto(p) ? 'Change photo' : 'Add photo'}</button>
            ${safePlayerPhoto(p) ? `<button type="button" data-action="player-photo-clear" data-player-id="${esc(p.id)}">Remove photo</button>` : ''}
            <input id="player-photo-input" type="file" accept="image/*" hidden />
            <button type="button" data-action="edit-player-name" data-player-id="${esc(p.id)}">Edit name</button>
            <button type="button" class="is-danger" data-action="delete-player" data-player-id="${esc(p.id)}">Remove player</button>
          </div>
        </div>
      </div>
      ${renderBccDock(state.playerFrom === 'seasons' ? 'seasons' : 'players')}
    </div>
  `;
}

function renderHistory() {
  const filter = state.historyFilter;
  const customDate = state.historyDate;
  const year = activeSeason();
  const allCompleted = completedSeasonMatches('all');
  const completed = year === 'all' ? allCompleted : completedSeasonMatches(year);
  const filtered = filterByDate(completed, filter, customDate)
    .slice()
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const { green, blue } = headToHeadCounts(filtered);
  const emptyBar = green + blue === 0;
  const isCustom = filter === 'custom';
  let list = '';
  if (!filtered.length) {
    list = '<div class="bcc-pm-empty"><span class="bcc-an">No matches</span>Nobody played. Suspicious.</div>';
  } else {
    let lastKey = '';
    for (const m of filtered) {
      const day = historyDayParts(m.startedAt || 0);
      if (day.key !== lastKey) {
        lastKey = day.key;
        list += `<div class="bcc-pm-day"><span>${esc(day.label)}</span>${esc(day.when)}</div>`;
      }
      list += pastMatchCard(m);
    }
  }
  return `
    <div class="screen bcc-past">
      <div class="bcc-top">
        <button type="button" class="bcc-ib" data-action="back-home" aria-label="Back">←</button>
        <span class="bcc-an">Past matches</span>
        ${renderSeasonChip()}
        ${state.loadingHistory ? '<span class="bcc-pm-spin" aria-label="Loading"></span>' : ''}
      </div>
      <div class="bcc-scroll">
        <div class="bcc-h2h">
          <div class="bcc-h2h-row">
            <div><div class="bcc-h2h-n bcc-an is-g">${green}</div><small>Green wins</small></div>
            <div class="bcc-h2h-mid">Head to head</div>
            <div class="bcc-h2h-right"><div class="bcc-h2h-n bcc-an is-b">${blue}</div><small>Blue wins</small></div>
          </div>
          <div class="bcc-h2h-split${emptyBar ? ' is-empty' : ''}">
            <i class="is-g" style="flex:${emptyBar ? 1 : (green || 0.0001)}"></i>
            <i class="is-b" style="flex:${emptyBar ? 1 : (blue || 0.0001)}"></i>
          </div>
        </div>
        <div class="bcc-art"></div>
        <div class="bcc-chips">
          ${HISTORY_FILTERS.map(f => `
            <button type="button" class="bcc-chip${filter === f.id ? ' is-on' : ''}" data-action="history-filter" data-filter="${f.id}">${esc(f.label)}</button>
          `).join('')}
          <label class="bcc-chip${isCustom ? ' is-on' : ''}">
            ${isCustom && customDate ? esc(fmtDateLabel(customDate)) : 'Date'}
            <input id="history-date-input" type="date" value="${esc(customDate || '')}" max="${todayIso()}" />
          </label>
        </div>
        <div class="bcc-pm-cnt">Showing ${filtered.length} of ${allCompleted.length} ${allCompleted.length === 1 ? 'match' : 'matches'}</div>
        ${list}
      </div>
    </div>
  `;
}

function renderInProgress() {
  const items = state.history.filter(m => m.status !== 'completed')
    .sort((a, b) => b.startedAt - a.startedAt);
  return `
    <div class="screen bcc-past">
      ${renderTopbar('In progress')}
      <div class="bcc-scroll">
        ${items.length === 0 ? `
          <p class="bcc-empty">No matches in progress.</p>
        ` : `
          <div class="bcc-pm-cnt">${items.length} ${items.length === 1 ? 'match' : 'matches'}</div>
          ${items.map(inProgressCard).join('')}
        `}
      </div>
    </div>
  `;
}

function inProgressCard(m) {
  const scorer = canScore(m);
  const inns = (m.innings || []).slice(0, 2);
  const rows = inns.map(inn => {
    const name = m.teams[inn.batting] || '';
    return `<div class="bcc-pm-tm"><span class="bcc-pm-dot is-${teamTone(name)}"></span><b>${esc(name)}</b><span class="bcc-pm-sc bcc-an">${inn.score.runs}/${inn.score.wickets}</span><small>(${fmtOvers(inn.score.balls)})</small></div>`;
  }).join('');
  const action = scorer ? 'resume-match' : 'take-scoring';
  const label = scorer ? 'Resume' : 'Score this match';
  return `
    <div class="bcc-livecard">
      <button type="button" class="bcc-pm" data-action="view-detail" data-match-id="${esc(m.id)}">
        <div class="bcc-pm-hd"><span>${fmtDate(m.startedAt)}</span><span>In progress</span></div>
        <div class="bcc-pm-venue">${esc(matchVenue(m))}</div>
        ${rows || `<div class="bcc-pm-tm"><b>${esc(m.teams.A)} vs ${esc(m.teams.B)}</b></div>`}
        <div class="bcc-pm-ft"><span class="bcc-pm-res">${esc(m.teams.A)} vs ${esc(m.teams.B)}</span><span class="bcc-pm-go">Summary →</span></div>
      </button>
      <button type="button" class="bcc-cta bcc-an" data-action="${action}" data-match-id="${esc(m.id)}">${label}</button>
    </div>`;
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

  const isLive = m.status !== 'completed';
  const inn = m.innings[m.currentInnings];
  const hasActiveInnings = isLive && !!inn && !inn.ended;
  const defaultOpen = !isLive || !hasActiveInnings;
  const scorecardOpen = state.sharedScorecardOpen !== undefined ? state.sharedScorecardOpen : defaultOpen;

  return `
    <div class="screen bcc-page">
      <div class="bcc-top">
        <button type="button" class="bcc-ib" data-action="back-home" aria-label="Close">←</button>
        <span class="bcc-an">${esc(m.teams.A)} vs ${esc(m.teams.B)}</span>
      </div>
      <div class="bcc-art"></div>
      <p class="bcc-share-note">${isLive ? 'Live · updates every 3s' : 'Shared scorecard · read-only'}</p>

      ${hasActiveInnings ? renderLivePanel(m) : `
        <div class="result-banner">
          <div class="label">${isLive ? 'Live' : 'Result'}</div>
          <div class="winner">${esc(m.result || liveSnapshotLine(m))}</div>
          <div class="margin">${fmtDate(m.startedAt)} · ${m.overs} overs</div>
        </div>
        ${!isLive ? renderAwards(m) : ''}
        ${!isLive ? renderAwards(m) : ''}
        ${!isLive ? renderTopPerformers(m) : ''}
      `}

      ${hasActiveInnings ? `
        <div class="live-meta">
          <span>${fmtDate(m.startedAt)} · ${m.overs} overs</span>
          ${!canScore(m)
            ? `<button class="btn-inline-score" data-action="take-scoring" data-match-id="${esc(m.id)}" data-from-shared="1">Score this match →</button>`
            : ''}
        </div>
      ` : isLive && !canScore(m) ? `
        <div class="live-meta">
          <button class="btn btn-primary shared-score-btn" data-action="take-scoring" data-match-id="${esc(m.id)}" data-from-shared="1">Score this match →</button>
        </div>
      ` : ''}

      ${m.innings.length > 0 ? `
        <div class="scorecard-section">
          <button class="scorecard-toggle" data-action="toggle-shared-scorecard">
            <span>Full scorecard</span>
            <span class="sc-arrow">${scorecardOpen ? '▴' : '▾'}</span>
          </button>
          ${scorecardOpen ? `
            <div class="scorecard">
              ${m.innings.map((i, idx) => renderInningsCard(m, i, `Innings ${idx + 1}`, idx === m.currentInnings && isLive ? inn?.striker : undefined)).join('')}
            </div>
          ` : ''}
        </div>
      ` : isLive ? `<div class="live-meta" style="justify-content: center; color: var(--ink-faint);">Match hasn't started yet</div>` : ''}
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
  if (!state.modal) return '';
  if (state.modal.type === 'seasonPicker') return renderSeasonPicker();
  if (state.modal.type === 'abort') return renderAbortModal();
  if (state.modal.type === 'install') return renderInstallModal();
  if (state.modal.type === 'editOverPin') {
    return renderBsSheet('Edit this ball', 'Enter the PIN to change a ball from this over or the one before it.', `
      <label class="form-label" for="edit-over-pin-input">PIN</label>
      <input id="edit-over-pin-input" class="form-control form-control-lg text-center font-monospace fw-bold pin-input" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="····" autocomplete="off" enterkeyhint="done" />
    `, `
      <button type="button" class="btn btn-primary btn-lg w-100" data-action="confirm-edit-over-pin">Unlock ball edit</button>
      <button type="button" class="btn btn-link w-100" data-action="cancel-edit-over-pin">Cancel</button>
    `);
  }
  if (state.modal.type === 'runOutPick') {
    const m = state.modal;
    const st = m.strikerName || 'Striker';
    const ns = m.nonStrikerName || 'Non-striker';
    return renderBsSheet(
      'Run out',
      'Who was run out on this ball?',
      `<p class="small text-muted mb-0">Does not count as a bowler wicket.</p>`,
      `
        <button type="button" class="btn btn-outline-dark btn-lg w-100 mb-2" data-action="confirm-run-out-end" data-end="striker">${esc(st)} · striker end</button>
        <button type="button" class="btn btn-outline-dark btn-lg w-100 mb-2" data-action="confirm-run-out-end" data-end="non">${esc(ns)} · non-striker end</button>
        <button type="button" class="btn btn-outline-secondary w-100" data-action="cancel-run-out-pick">Cancel</button>
      `,
    );
  }
  if (state.modal.type === 'editBall') {
    const inn = state.current.innings[state.current.currentInnings];
    const entry = inn.ballLog[state.modal.logIndex];
    const sel = state.modal.sel;
    const selCount = ballSelectionCount(sel);
    const canSave = selCount > 0;
    return renderBsSheet(
      `Edit ball · over ${entry.overNo + 1}`,
      `${esc(entry.batter)} · ${esc(entry.bowler)} · was ${esc(entry.label)}`,
      `
        <div class="edit-ball-picker">
          <div class="input-cluster edit-ball-cluster">
            <div class="wkt-stack">
              <button type="button" class="wkt-btn ${sel.wicket ? 'selected' : ''}" data-action="edit-ball-wkt">WKT</button>
              <button type="button" class="ro-btn ${sel.runOut ? 'selected' : ''}" data-action="edit-ball-ro">RunOut</button>
            </div>
            <div class="extras-panel">
              <div class="heading">Extras</div>
              <div class="extras-btns">
                ${['wd', 'nb'].map(e => `<button type="button" class="extra-btn ${sel.extra === e ? 'selected' : ''}" data-action="edit-ball-extra" data-extra="${e}">${e}</button>`).join('')}
              </div>
            </div>
          </div>
          <div class="runs-grid edit-ball-runs">
            <button type="button" class="run-btn dot ${sel.runs === 0 ? 'selected' : ''}" data-action="edit-ball-run" data-runs="0">DOT</button>
            ${[1, 2, 3, 4, 5, 6].map(n => `<button type="button" class="run-btn ${sel.runs === n ? 'selected' : ''}" data-action="edit-ball-run" data-runs="${n}">${n}</button>`).join('')}
          </div>
        </div>
      `,
      `
        <button type="button" class="btn btn-primary btn-lg w-100 mb-2" data-action="confirm-edit-ball" ${canSave ? '' : 'disabled'}>Save ball</button>
        <button type="button" class="btn btn-outline-secondary w-100" data-action="cancel-edit-ball">Cancel</button>
      `,
    );
  }
  if (state.modal.type === 'deleteMatchPin') {
    return renderBsSheet(
      'Delete this match?',
      'The scorecard goes, and its runs and wickets come off the player stats.',
      `
        <label class="form-label" for="delete-match-pin-input">Global PIN</label>
        <input id="delete-match-pin-input" class="form-control form-control-lg text-center font-monospace fw-bold pin-input" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="····" autocomplete="off" enterkeyhint="done" />
      `,
      `
        <button type="button" class="btn btn-danger btn-lg w-100 mb-2" data-action="confirm-delete-match-pin">Delete match and stats</button>
        <button type="button" class="btn btn-outline-secondary w-100" data-action="cancel-delete-match-pin">Cancel</button>
      `,
    );
  }
  if (state.modal.type === 'deletePlayerPin') {
    const p = playerById(state.modal.playerId);
    const name = p?.name || 'This player';
    return renderBsSheet(
      'Remove player?',
      `${esc(name)} and all career stats will be deleted permanently.`,
      `
        <label class="form-label" for="delete-player-pin-input">Global PIN</label>
        <input id="delete-player-pin-input" class="form-control form-control-lg text-center font-monospace fw-bold pin-input" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="····" autocomplete="off" enterkeyhint="done" />
      `,
      `
        <button type="button" class="btn btn-danger btn-lg w-100 mb-2" data-action="confirm-delete-player-pin">Remove player</button>
        <button type="button" class="btn btn-outline-secondary w-100" data-action="cancel-delete-player-pin">Cancel</button>
      `,
    );
  }
  if (state.modal.type === 'editPlayerName') {
    const p = playerById(state.modal.playerId);
    const name = p?.name || '';
    return renderBsSheet(
      'Edit player name',
      'Stats stay on this profile; only the display name changes.',
      `
        <label class="form-label" for="edit-player-name-input">Name</label>
        <input id="edit-player-name-input" class="form-control form-control-lg" type="text" value="${esc(name)}" autocomplete="off" autocapitalize="words" enterkeyhint="next" />
        <label class="form-label mt-3" for="edit-player-pin-input">Global PIN</label>
        <input id="edit-player-pin-input" class="form-control form-control-lg text-center font-monospace fw-bold pin-input" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="····" autocomplete="off" enterkeyhint="done" />
      `,
      `
        <button type="button" class="btn btn-primary btn-lg w-100 mb-2" data-action="confirm-edit-player-name">Save name</button>
        <button type="button" class="btn btn-outline-secondary w-100" data-action="cancel-edit-player-name">Cancel</button>
      `,
    );
  }
  if (state.modal.type === 'adminPin') {
    return renderBsSheet(
      'Admin',
      'Enter the global PIN to manage roster tools.',
      `
        <label class="form-label" for="admin-pin-input">Global PIN</label>
        <input id="admin-pin-input" class="form-control form-control-lg text-center font-monospace fw-bold pin-input" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="····" autocomplete="off" enterkeyhint="done" />
      `,
      `
        <button type="button" class="btn btn-primary btn-lg w-100 mb-2" data-action="confirm-admin-pin">Continue</button>
        <button type="button" class="btn btn-outline-secondary w-100" data-action="cancel-admin-pin">Cancel</button>
      `,
    );
  }
  if (state.modal.type === 'confirmSwapStrike') {
    const inn = state.current.innings[state.current.currentInnings];
    const striker = inn.batters[inn.striker];
    const nonStriker = inn.batters[inn.nonStriker];
    return renderBsSheet(
      'Swap strike?',
      `${esc(striker.name)} and ${esc(nonStriker.name)} will switch ends.`,
      `<p class="small text-muted mb-0">Striker becomes non-striker and vice versa. You can undo after confirming.</p>`,
      `
        <button type="button" class="btn btn-primary btn-lg w-100 mb-2" data-action="confirm-swap-strike">Yes, swap strike</button>
        <button type="button" class="btn btn-outline-secondary w-100" data-action="cancel-swap-strike">Cancel</button>
      `,
    );
  }
  if (state.modal.type === 'retireHurt') {
    const inn = state.current.innings[state.current.currentInnings];
    const striker = inn.batters[inn.striker];
    const nonStriker = inn.batters[inn.nonStriker];
    return renderBsSheet(
      'Retire hurt',
      'Who is leaving the field injured?',
      `<p class="small text-muted mb-0">Does not count as a wicket. Pick a replacement batter next.</p>`,
      `
        <button type="button" class="btn btn-outline-dark btn-lg w-100 mb-2" data-action="confirm-retire-hurt" data-end="striker">${esc(striker.name)} · striker</button>
        <button type="button" class="btn btn-outline-dark btn-lg w-100 mb-2" data-action="confirm-retire-hurt" data-end="non">${esc(nonStriker.name)} · non-striker</button>
        <button type="button" class="btn btn-outline-secondary w-100" data-action="cancel-retire-hurt">Cancel</button>
      `,
    );
  }
  return '';
}

async function deleteMatchAndStats(id) {
  if (!id) return;
  if (dbOn()) {
    window.QCDB.cancelSync?.(id);
    try {
      await window.QCDB.deleteMatch(id);
    } catch (err) {
      console.warn(err);
      showToast('Could not delete the match');
      return;
    }
  }
  state.history = state.history.filter(x => x.id !== id);
  saveHistory(state.history);
  if (state.adminMatches) state.adminMatches = state.adminMatches.filter(x => x.id !== id);
  if (state.current?.id === id) {
    state.current = null;
    saveCurrent(null);
  }
  let matches = state.history.filter(x => x.id !== id);
  if (dbOn()) {
    try {
      const remote = await window.QCDB.loadMatches(500);
      const byId = new Map();
      for (const m of remote) {
        if (m?.id && m.id !== id) byId.set(m.id, m);
      }
      for (const m of matches) {
        if (m?.id && !byId.has(m.id)) byId.set(m.id, m);
      }
      matches = [...byId.values()];
    } catch (err) {
      console.warn('player stats left unchanged; match list failed', err);
      state.detail = null;
      state.detailReturn = null;
      state.view = 'history';
      render();
      showToast('Match deleted. Player stats will refresh when the match list loads.');
      return;
    }
  }
  if (window.QCPlayers?.rebuildAllStatsFromMatches) {
    state.players = window.QCPlayers.rebuildAllStatsFromMatches(state.players, matches);
    if (state.playerDetail) state.playerDetail = playerById(state.playerDetail.id);
  }
  state.detail = null;
  state.detailReturn = null;
  state.view = 'history';
  render();
  showToast('Match deleted. Player stats updated.');
}

// ---------- Action dispatch ----------
function handle(action, dataset) {
  switch (action) {
    case 'home':
      state.view = 'home';
      state.detail = null;
      state.overEditUnlocked = false;
      state.freeUndosUsed = 0;
      state.editOverIntent = null;
      state.scorePick = null;
      if (state.modal?.type === 'newBatter' || state.modal?.type === 'newBowler') {
        state.modal = null;
      }
      render();
      break;
    case 'terms': state.view = 'terms'; render(); break;
    case 'admin-open':
      if (state.adminUnlocked) {
        state.view = 'admin';
        loadAdminMatches().then(() => render()).catch(() => render());
      } else {
        state.modal = { type: 'adminPin' };
        render();
      }
      break;
    case 'back-from-admin':
      state.view = 'home';
      render();
      break;
    case 'cancel-admin-pin':
      state.modal = null;
      render();
      break;
    case 'hard-reload':
      hardReloadApp();
      break;
    case 'history':
      state.view = 'history';
      state.historyFilter = 'all';
      state.historyDate = '';
      state.historyScroll = 0;
      render();
      if (dbOn()) refreshHistory();
      break;
    case 'back-to-matches': {
      const dest = state.view === 'result'
        ? 'history'
        : (state.detailReturn === 'in-progress' ? 'in-progress' : 'history');
      state.detail = null;
      state.modal = null;
      state.summaryInn = 0;
      state.summaryBalls = false;
      state.detailReturn = null;
      state.view = dest;
      render();
      if (dbOn()) refreshHistory();
      break;
    }
    case 'in-progress':
      state.view = 'in-progress';
      render();
      if (dbOn()) refreshHistory();
      break;
    case 'resume-match': {
      (async () => {
        const matchId = dataset.matchId;
        let m = state.history.find(x => x.id === matchId);
        if (dbOn()) {
          try {
            const r = await window.QCDB.loadMatch(matchId);
            if (r?.match) m = normalizeMatch(r.match);
          } catch { /* fall back to cached list row */ }
        }
        const local = loadCurrent();
        if (local && local.id === matchId) m = preferMatch(local, m);
        if (state.current && state.current.id === matchId) m = preferMatch(state.current, m);
        if (!m) { showToast('Match not found'); return; }
        if (!canScore(m)) { showToast('Cannot score this match'); return; }
        state.current = m;
        state.overEditUnlocked = false;
        state.freeUndosUsed = 0;
        persistMatch(m);
        state.detail = null;
        openMatchScoringView(m);
        render();
      })();
      break;
    }
    case 'take-scoring': {
      const matchId = dataset.matchId;
      const fromShared = !!dataset.fromShared;
      const m = fromShared ? state.shared : state.history.find(x => x.id === matchId);
      if (!m) { showToast('Match not found'); break; }
      claimScoring(m);
      state.overEditUnlocked = false;
      state.freeUndosUsed = 0;
      if (fromShared) {
        state.current = clone(m);
        persistMatch(state.current);
        state.shared = null;
        stopPolling();
        history.replaceState(history.state, '', location.pathname);
      } else {
        state.current = m;
        persistMatch(m);
      }
      openMatchScoringView(state.current);
      render();
      showToast('You are now scoring');
      break;
    }
    case 'history-filter':
      state.historyFilter = dataset.filter;
      if (dataset.filter !== 'custom') state.historyDate = '';
      state.historyScroll = 0;
      render();
      break;
    case 'toggle-shared-scorecard': {
      const m = state.shared;
      const isLive = m?.status !== 'completed';
      const inn = m?.innings[m?.currentInnings];
      const hasActive = isLive && !!inn && !inn.ended;
      const defaultOpen = !isLive || !hasActive;
      const current = state.sharedScorecardOpen !== undefined ? state.sharedScorecardOpen : defaultOpen;
      state.sharedScorecardOpen = !current;
      render(); break;
    }
    case 'back-home':
      if (state.shared) {
        state.shared = null;
        state.sharedScorecardOpen = undefined;
        stopPolling();
        history.replaceState(history.state, '', location.pathname);
      }
      state.view = 'home'; state.detail = null; state.modal = null; render();
      if (dbOn()) refreshHistory();
      break;
    case 'new-match':
      state.view = 'setup';
      state.setup = { teamA: DEFAULT_TEAM_A, teamB: DEFAULT_TEAM_B, overs: DEFAULT_OVERS, battingFirst: 'A', skipTeamPick: false, venue: DEFAULT_VENUE };
      render(); break;
    case 'players':
      state.view = 'players';
      state.playerDetail = null;
      state.playerFrom = 'players';
      render();
      refreshCareerStatsIfNeeded();
      break;
    case 'seasons':
      state.view = 'seasons';
      state.playerDetail = null;
      state.playerFrom = 'seasons';
      render();
      refreshCareerStatsIfNeeded();
      break;
    case 'season-picker':
      state.modal = { type: 'seasonPicker' };
      render();
      break;
    case 'close-season-picker':
      state.modal = null;
      render();
      break;
    case 'pick-season':
      state.appSeason = dataset.year || 'all';
      state.playerSeason = state.appSeason;
      state.modal = null;
      render();
      break;
    case 'season-leader':
      state.seasonLeader = dataset.tab || 'runs';
      render();
      break;
    case 'season-qualified':
      state.seasonQualified = !state.seasonQualified;
      render();
      break;
    case 'open-wrapped':
      state.wrappedStep = 0;
      state.view = 'wrapped';
      state.modal = null;
      render();
      break;
    case 'wrapped-next':
      state.wrappedStep = (state.wrappedStep || 0) + 1;
      render();
      break;
    case 'wrapped-close':
      state.view = 'seasons';
      render();
      break;
    case 'wrapped-share':
      shareSeasonWrap();
      break;
    case 'players-tab':
      state.playersTab = dataset.tab || 'roster';
      render();
      break;
    case 'player-season':
      state.playerSeason = dataset.year || 'all';
      state.appSeason = state.playerSeason;
      render();
      break;
    case 'admin-reassign-scope': {
      const scope = dataset.scope === 'bat' || dataset.scope === 'bowl' ? dataset.scope : 'both';
      state.adminReassign.scope = scope;
      const match = adminMatchList().find(m => m.id === state.adminReassign.matchId);
      if (match && state.adminReassign.sourceKey && window.QCPlayers?.listMatchParticipants) {
        const parts = window.QCPlayers.listMatchParticipants(match, state.players, scope);
        const keys = new Set(parts.map(p => p.id || `n:${p.name.toLowerCase()}`));
        if (!keys.has(state.adminReassign.sourceKey)) state.adminReassign.sourceKey = '';
      }
      render();
      break;
    }
    case 'view-player': {
      const p = playerById(dataset.playerId);
      if (p) {
        state.playerDetail = p;
        state.playerStatTab = dataset.from === 'bowling' ? 'bowl' : 'bat';
        state.playerFrom = state.view === 'seasons' ? 'seasons' : 'players';
        state.playerSeason = activeSeason();
        state.view = 'player-detail';
        render();
      }
      break;
    }
    case 'player-stat-tab':
      state.playerStatTab = dataset.tab === 'bowl' ? 'bowl' : 'bat';
      render();
      break;
    case 'delete-player': {
      const p = playerById(dataset.playerId);
      if (!p) break;
      state.modal = { type: 'deletePlayerPin', playerId: p.id };
      render();
      break;
    }
    case 'player-photo':
      $('player-photo-input')?.click();
      break;
    case 'player-photo-clear':
      setPlayerPhoto(dataset.playerId, '');
      break;
    case 'edit-player-name': {
      const p = playerById(dataset.playerId);
      if (!p) break;
      state.modal = { type: 'editPlayerName', playerId: p.id };
      render();
      break;
    }
    case 'cancel-delete-player-pin':
    case 'cancel-delete-match-pin':
      state.modal = null;
      render();
      break;
    case 'cancel-edit-player-name':
      state.modal = null;
      render();
      break;
    case 'team-pick-player': {
      const id = dataset.playerId;
      const side = teamPickSideForNext(state.teamPick.squads);
      if (!id || state.teamPick.squads[side].includes(id)) break;
      if (state.teamPick.squads.A.includes(id) || state.teamPick.squads.B.includes(id)) break;
      if (!canAddToSquadSide(side, state.teamPick.squads)) {
        showToast('Teams must stay within one player of each other');
        break;
      }
      pushTeamPickUndo();
      state.teamPick.squads[side].push(id);
      state.teamPick.picking = side === 'A' ? 'B' : 'A';
      render();
      break;
    }
    case 'undo-team-pick':
      if (undoTeamPick()) {
        showToast('Squad pick undone');
        render();
      }
      break;
    case 'auto-pick-teams': {
      if (!canPickSquadsFromAvailability()) {
        showToast('Need at least 2 available players');
        break;
      }
      pushTeamPickUndo();
      const res = runAutoBalance(state.teamPick.squads);
      if (res.error) {
        showToast(res.error);
        break;
      }
      state.teamPick.squads = res.squads;
      state.teamPick.picking = res.squads.A.length <= res.squads.B.length ? 'A' : 'B';
      state.teamPick.mode = 'review';
      state.teamPick.autoBalanced = true;
      const m = state.current;
      const msg = window.QCPlayers.formatBalanceSummary(res.summary, m?.teams?.A, m?.teams?.B);
      showToast(msg);
      render();
      break;
    }
    case 'move-squad-player': {
      const id = dataset.playerId;
      const from = dataset.fromSide;
      if (!id || (from !== 'A' && from !== 'B')) break;
      const to = from === 'A' ? 'B' : 'A';
      if (!state.teamPick.squads[from].includes(id)) break;
      if (!canMoveSquadPlayer(from, state.teamPick.squads)) {
        showToast('Move would make one team more than one player ahead');
        break;
      }
      pushTeamPickUndo();
      state.teamPick.squads[from] = state.teamPick.squads[from].filter(x => x !== id);
      if (!state.teamPick.squads[to].includes(id)) state.teamPick.squads[to].push(id);
      render();
      break;
    }
    case 'squad-review-reshuffle': {
      if (!canPickSquadsFromAvailability()) {
        showToast('Need at least 2 available players');
        break;
      }
      pushTeamPickUndo();
      const res = runReshuffleBalance(state.teamPick.squads);
      if (res.error) {
        showToast(res.error);
        break;
      }
      state.teamPick.squads = res.squads;
      state.teamPick.mode = 'review';
      state.teamPick.autoBalanced = true;
      const m = state.current;
      showToast(window.QCPlayers.formatBalanceSummary(res.summary, m?.teams?.A, m?.teams?.B));
      render();
      break;
    }
    case 'availability-review':
      normalizeTeamPickSquads(state.teamPick.squads);
      state.teamPick.mode = 'review';
      state.view = 'team-pick';
      render();
      break;
    case 'enter-squad-review':
      normalizeTeamPickSquads(state.teamPick.squads);
      state.teamPick.mode = 'review';
      render();
      break;
    case 'availability-select-all':
      state.matchAvailability = { ids: state.players.map(p => p.id) };
      render();
      break;
    case 'availability-clear':
      state.matchAvailability = { ids: [] };
      render();
      break;
    case 'availability-manual':
      if (!canPickSquadsFromAvailability()) {
        showToast('Pick at least 2 players who are available');
        break;
      }
      state.teamPick = { squads: { A: [], B: [] }, picking: 'A', mode: 'pick', autoBalanced: false };
      state.teamPickUndo = [];
      state.view = 'team-pick';
      render();
      break;
    case 'availability-auto': {
      if (!canPickSquadsFromAvailability()) {
        showToast('Pick at least 2 players who are available');
        break;
      }
      const res = runAutoBalance({ A: [], B: [] });
      if (res.error) {
        showToast(res.error);
        break;
      }
      const m = state.current;
      const msg = window.QCPlayers.formatBalanceSummary(res.summary, m?.teams?.A, m?.teams?.B);
      enterSquadReview(res.squads, msg);
      break;
    }
    case 'availability-skip':
      if (state.current) {
        state.current.squads = { A: [], B: [] };
        state.current.squadsSkipped = true;
        state.current.squadsAutoPicked = false;
        persistMatch(state.current);
      }
      if (!enterTossView()) render();
      break;
    case 'back-from-availability': {
      const m = state.current;
      if (!m) { state.view = 'home'; render(); break; }
      if (dbOn()) {
        window.QCDB.cancelSync(m.id);
        window.QCDB.deleteMatch(m.id).catch(() => { });
      }
      state.history = state.history.filter(x => x.id !== m.id);
      saveHistory(state.history);
      state.setup = { teamA: m.teams.A, teamB: m.teams.B, overs: m.overs, battingFirst: m.battingFirst, skipTeamPick: false };
      state.current = null;
      saveCurrent(null);
      state.matchAvailability = { ids: [] };
      state.view = 'setup';
      render();
      break;
    }
    case 'skip-team-pick':
      if (state.current) {
        state.current.squads = { A: [], B: [] };
        state.current.squadsSkipped = true;
        state.current.squadsAutoPicked = false;
        persistMatch(state.current);
      }
      if (!enterTossView()) render();
      break;
    case 'finish-team-pick':
      normalizeTeamPickSquads(state.teamPick.squads);
      if (squadSizeDiff(state.teamPick.squads) > 1) {
        showToast('Teams must be within one player of each other — pick or move players to even up');
        render();
        break;
      }
      if (state.current) {
        state.current.squads = clone(state.teamPick.squads);
        state.current.squadsSkipped = false;
        state.current.squadsAutoPicked = !!state.teamPick.autoBalanced;
        state.current.availablePlayerIds = [...(state.matchAvailability?.ids || [])];
        persistMatch(state.current);
      }
      if (!enterTossView()) render();
      break;
    case 'confirm-toss':
      if (state.current) {
        state.current.tossDone = true;
        persistMatch(state.current);
      }
      if (!enterInningsSetupView()) render();
      break;
    case 'back-from-toss': {
      const m = state.current;
      clearTossFlipTimer();
      if (!m) { state.view = 'home'; render(); break; }
      m.tossDone = false;
      if (state.players.length > 0 && matchUsesSquads(m)) {
        state.teamPick.squads = clone(m.squads);
        state.teamPick.mode = 'review';
        state.teamPick.autoBalanced = !!m.squadsAutoPicked;
        state.view = 'team-pick';
      } else if (state.players.length > 0) {
        state.view = 'match-availability';
      } else {
        if (dbOn()) {
          window.QCDB.cancelSync(m.id);
          window.QCDB.deleteMatch(m.id).catch(() => { });
        }
        state.history = state.history.filter(x => x.id !== m.id);
        saveHistory(state.history);
        state.setup = { teamA: m.teams.A, teamB: m.teams.B, overs: m.overs, battingFirst: 'A', skipTeamPick: false };
        state.current = null;
        saveCurrent(null);
        state.view = 'setup';
      }
      render();
      break;
    }
    case 'back-from-team-pick':
      if (state.teamPick.mode === 'review') {
        state.view = 'match-availability';
      } else {
        state.view = 'match-availability';
        state.teamPick.mode = 'pick';
      }
      render();
      break;
    case 'pick-striker':
    case 'pick-non-striker':
    case 'pick-bowler':
    case 'pick-new-batter':
    case 'pick-new-bowler': {
      if (!dataset.playerName) break;
      const pickMap = {
        'pick-striker': ['striker-input', 'striker'],
        'pick-non-striker': ['non-striker-input', 'nonStriker'],
        'pick-bowler': ['bowler-input', 'bowler'],
      };
      if (pickMap[action]) {
        const [inputId, pickKey] = pickMap[action];
        const cur = state.inningsPick[pickKey];
        const samePlayer = cur && (
          (dataset.playerId && cur.id === dataset.playerId) ||
          cur.name?.toLowerCase() === (dataset.playerName || '').toLowerCase()
        );
        if (action === 'pick-bowler' && !samePlayer) {
          const battingNow = [state.inningsPick.striker, state.inningsPick.nonStriker].some(b =>
            b && (
              (dataset.playerId && b.id === dataset.playerId) ||
              b.name?.toLowerCase() === (dataset.playerName || '').toLowerCase()
            )
          );
          if (battingNow) {
            showToast('Already batting');
            break;
          }
        }
        pushInningsPickUndo();
        const input = $(inputId);
        if (samePlayer) {
          state.inningsPick[pickKey] = null;
          if (input) {
            input.value = '';
            delete input.dataset.playerId;
          }
          state.inningsManual[pickKey] = false;
          render();
          break;
        }
        if (input) {
          input.value = dataset.playerName || '';
          input.dataset.playerId = dataset.playerId || '';
        }
        state.inningsPick[pickKey] = { name: dataset.playerName, id: dataset.playerId || null };
        if (pickKey !== 'bowler') {
          const bowler = state.inningsPick.bowler;
          const next = state.inningsPick[pickKey];
          if (bowler && (
            (next.id && bowler.id === next.id) ||
            bowler.name?.toLowerCase() === next.name.toLowerCase()
          )) {
            state.inningsPick.bowler = null;
          }
        }
        state.inningsManual[pickKey] = false;
        state.playerPickerFilter = '';
        state.openerSlot = openerNextSlot();
        render();
        break;
      }
      if (action === 'pick-new-batter') {
        if (!state.scorePick || state.scorePick.type !== 'batter') break;
        state.scorePick.pick = { name: dataset.playerName, id: dataset.playerId || null };
        state.scorePick.manual = false;
        state.scorePick.draft = '';
        render();
      } else if (action === 'pick-new-bowler') {
        if (!state.scorePick || state.scorePick.type !== 'bowler') break;
        state.scorePick.pick = { name: dataset.playerName, id: dataset.playerId || null };
        state.scorePick.manual = false;
        state.scorePick.draft = '';
        render();
      }
      break;
    }
    case 'toggle-innings-manual': {
      const field = dataset.field;
      if (field && state.inningsManual[field] !== undefined) {
        const opening = !state.inningsManual[field];
        state.inningsManual[field] = opening;
        if (opening) {
          state.inningsPick[field] = null;
          const inputId = field === 'nonStriker' ? 'non-striker-input' : `${field}-input`;
          const input = $(inputId);
          if (input) {
            input.value = '';
            delete input.dataset.playerId;
          }
        }
        render();
      }
      break;
    }
    case 'toggle-modal-manual':
      if (state.scorePick) {
        const opening = !state.scorePick.manual;
        state.scorePick.manual = opening;
        if (opening) {
          state.scorePick.pick = null;
          state.scorePick.draft = '';
          const input = $(state.scorePick.type === 'batter' ? 'new-batter-input' : 'new-bowler-input');
          if (input) {
            input.value = '';
            delete input.dataset.playerId;
          }
        }
        render();
      } else if (state.modal) {
        state.modal.manual = !state.modal.manual;
        render();
      }
      break;
    case 'resume': {
      const m = state.current;
      if (!m) { state.view = 'home'; render(); break; }
      state.overEditUnlocked = false;
      state.freeUndosUsed = 0;
      openMatchScoringView(m);
      render(); break;
    }
    case 'bat-first':
      if (state.view === 'match-toss' && state.current) {
        if (state.tossCoin?.phase === 'flipping') break;
        clearTossFlipTimer();
        state.current.battingFirst = dataset.team;
        state.tossCoin = { phase: 'idle', result: dataset.team };
        persistMatch(state.current);
      } else {
        state.setup.battingFirst = dataset.team;
      }
      render(); break;
    case 'swap-teams': {
      const a = state.setup.teamA;
      state.setup.teamA = state.setup.teamB;
      state.setup.teamB = a;
      render();
      break;
    }
    case 'pick-venue':
      if (VENUES.includes(dataset.venue)) state.setup.venue = dataset.venue;
      render();
      break;
    case 'overs-pick':
      state.setup.overs = parseInt(dataset.overs, 10); render(); break;
    case 'overs-step': {
      const next = state.setup.overs + parseInt(dataset.delta, 10);
      if (next >= 1 && next <= 99) state.setup.overs = next;
      render(); break;
    }
    case 'toss': {
      if (state.view === 'match-toss' && state.current) {
        startMatchTossFlip();
        break;
      }
      const side = Math.random() < 0.5 ? 'A' : 'B';
      state.setup.battingFirst = side;
      const name = side === 'A'
        ? (state.setup.teamA || DEFAULT_TEAM_A)
        : (state.setup.teamB || DEFAULT_TEAM_B);
      showToast(`${name} bats first`);
      render();
      break;
    }
    case 'select-run': pickBall('runs', parseInt(dataset.runs, 10)); break;
    case 'select-extra': pickBall('extra', dataset.extra); break;
    case 'select-wkt': pickBall('wicket', true); break;
    case 'select-ro': pickBall('runOut', true); break;
    case 'next-ball': commitBall(); break;
    case 'toggle-last-over':
      state.showLastOver = !state.showLastOver;
      render();
      break;
    case 'edit-over':
      if (state.overEditUnlocked) {
        showToast('Tap a ball in the over to edit it');
        break;
      }
      requestBallEdit(null);
      break;
    case 'fix-last-ball':
      requestBallEdit('fixLastBall');
      break;
    case 'done-edit-over':
      state.overEditUnlocked = false;
      state.editOverIntent = null;
      state.showLastOver = false;
      render();
      showToast('Ball editing locked');
      break;
    case 'edit-ball': {
      const logIndex = parseInt(dataset.logIndex, 10);
      const inn = state.current?.innings?.[state.current?.currentInnings];
      if (!inn || !isLogIndexInEditWindow(inn, logIndex)) {
        showToast('That ball cannot be edited');
        break;
      }
      if (!state.overEditUnlocked) {
        state.editOverIntent = logIndex;
        state.modal = { type: 'editOverPin' };
        render();
        break;
      }
      const entry = inn.ballLog[logIndex];
      state.modal = {
        type: 'editBall',
        logIndex,
        sel: selFromLogEntry(entry),
      };
      render();
      break;
    }
    case 'edit-ball-run':
      editPickBall('runs', parseInt(dataset.runs, 10));
      break;
    case 'edit-ball-extra':
      editPickBall('extra', dataset.extra);
      break;
    case 'edit-ball-wkt':
      editPickBall('wicket', true);
      break;
    case 'edit-ball-ro':
      editPickBall('runOut', true);
      break;
    case 'confirm-run-out-end': {
      const modal = state.modal;
      if (modal?.type !== 'runOutPick') break;
      const end = dataset.end === 'non' ? 'non' : 'striker';
      modal.sel.runOutEnd = end;
      if (modal.source === 'editBall') {
        if (!editBallAt(state.current, modal.logIndex, modal.sel)) {
          showToast('Could not save ball');
          break;
        }
        state.modal = null;
        showToast('Ball updated');
        finishEditBall();
      } else {
        state.modal = null;
        finalizeBallCommit(modal.sel);
        render();
      }
      break;
    }
    case 'cancel-run-out-pick':
      state.modal = null;
      render();
      break;
    case 'cancel-edit-ball':
      state.modal = null;
      render();
      break;
    case 'cancel-edit-over-pin':
      state.editOverIntent = null;
      state.modal = null;
      render();
      break;
    case 'retire-hurt': {
      const inn = state.current?.innings?.[state.current?.currentInnings];
      if (!inn || inn.ended || inn.needNewBatter || inn.needNewBowler) {
        showToast("Can't retire hurt right now");
        break;
      }
      state.modal = { type: 'retireHurt' };
      render();
      break;
    }
    case 'confirm-retire-hurt': {
      const end = dataset.end === 'non' ? 'non' : 'striker';
      if (retireHurt(state.current, end)) {
        state.modal = null;
        syncScorePick();
        showToast('Retired hurt — pick replacement');
        render();
      } else {
        showToast("Can't retire hurt right now");
      }
      break;
    }
    case 'cancel-retire-hurt':
      state.modal = null;
      render();
      break;
    case 'swap-strike': {
      const m = state.current;
      const inn = m?.innings?.[m.currentInnings];
      const ok = inn && !inn.ended && !inn.needNewBatter &&
        inn.batters[inn.striker] && inn.batters[inn.nonStriker] &&
        !inn.batters[inn.striker].out && !inn.batters[inn.nonStriker].out;
      if (!ok) {
        showToast("Can't swap strike right now");
        break;
      }
      state.modal = { type: 'confirmSwapStrike' };
      render();
      break;
    }
    case 'confirm-swap-strike':
      state.modal = null;
      if (swapStrike(state.current)) {
        showToast('Strike swapped');
      } else {
        showToast("Can't swap strike right now");
      }
      render();
      break;
    case 'cancel-swap-strike':
      state.modal = null;
      render();
      break;
    case 'undo-innings-pick':
      if (undoInningsPick()) {
        showToast('Pick undone');
        render();
      }
      break;
    case 'undo':
      if (undoBall(state.current)) {
        showEventBanner({ kind: 'undo', big: 'UNDO', sub: 'Last action undone' }, 1300);
        afterUndoMatch();
      } else if (state.current?.undo?.length && !state.overEditUnlocked) {
        const inn = state.current.innings?.[state.current.currentInnings];
        if (inn?.needNewBatter || inn?.needNewBowler) {
          showToast('Enter the PIN to undo an earlier ball');
        } else {
          state.modal = { type: 'editOverPin' };
          render();
          showToast('Enter PIN to edit earlier balls in this over');
        }
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
        if (dbOn()) {
          window.QCDB.cancelSync?.(m.id);
          window.QCDB.deleteMatch(m.id).catch(err => console.warn(err));
        }
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
      if (dbOn()) {
        window.QCDB.cancelSync?.(m.id);
        window.QCDB.deleteMatch(m.id).catch(err => console.warn(err));
      }
      state.history = state.history.filter(x => x.id !== m.id);
      saveHistory(state.history);
      state.current = null;
      saveCurrent(null);
      state.setup = { teamA: A, teamB: B, overs, battingFirst, skipTeamPick: false };
      state.modal = null;
      state.detail = null;
      state.ball = emptyBall();
      state.overEditUnlocked = false;
      state.freeUndosUsed = 0;
      state.view = 'setup';
      render();
      showToast('Confirm setup, then Start match');
      break;
    }
    case 'start-next-innings':
      if (!enterInningsSetupView()) render();
      break;
    case 'back-from-innings-setup': {
      const m = state.current;
      if (!m) { state.view = 'home'; render(); break; }
      if (m.innings.length === 0) {
        state.view = 'match-toss';
      } else {
        state.view = 'innings-break';
      }
      render();
      break;
    }
    case 'share': shareCurrent(); break;
    case 'copy-match-id': {
      const id = dataset.matchId || '';
      if (!id) break;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(id).then(
          () => showToast('Match code copied'),
          () => showToast(id),
        );
      } else {
        showToast(id);
      }
      break;
    }
    case 'toggle-match-id':
      state.summaryShowId = !state.summaryShowId;
      render();
      break;
    case 'opener-slot':
      if (['striker', 'nonStriker', 'bowler'].includes(dataset.slot)) {
        state.openerSlot = dataset.slot;
        render();
      }
      break;
    case 'opener-add': {
      const name = (state.playerPickerFilter || '').trim();
      if (!name) break;
      const slot = state.openerSlot === 'bowler' || state.openerSlot === 'nonStriker' ? state.openerSlot : 'striker';
      handle(slot === 'bowler' ? 'pick-bowler' : slot === 'nonStriker' ? 'pick-non-striker' : 'pick-striker', {
        playerName: name,
        playerId: '',
      });
      break;
    }
    case 'flip-batting': {
      const m = state.current;
      if (!m || m.innings.length) break;
      m.battingFirst = m.battingFirst === 'B' ? 'A' : 'B';
      persistMatch(m);
      resetInningsPickers();
      render();
      break;
    }
    case 'assign-squad': {
      const id = dataset.playerId;
      const side = dataset.side === 'B' ? 'B' : 'A';
      if (!id || !state.teamPick?.squads) break;
      const squads = state.teamPick.squads;
      const other = side === 'A' ? 'B' : 'A';
      pushTeamPickUndo();
      if (squads[side].includes(id)) {
        squads[side] = squads[side].filter(x => x !== id);
      } else {
        squads[other] = (squads[other] || []).filter(x => x !== id);
        squads[side].push(id);
      }
      state.teamPick.autoBalanced = false;
      render();
      break;
    }
    case 'summary-innings':
      state.summaryInn = Number(dataset.index) || 0;
      render();
      break;
    case 'summary-balls':
      state.summaryBalls = !state.summaryBalls;
      render();
      break;
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
      if (m) {
        if (state.view === 'history') rememberHistoryScroll();
        state.detail = m;
        state.summaryInn = 0;
        state.summaryBalls = false;
        state.summaryShowId = false;
        state.detailReturn = state.view === 'in-progress' ? 'in-progress' : 'history';
        state.view = 'detail';
        render();
      }
      break;
    }
    case 'delete-match': {
      const id = dataset.matchId;
      if (!id) break;
      state.modal = { type: 'deleteMatchPin', matchId: id };
      render();
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
      bootNavHistory();
      render();
      return;
    }
    if (parsed.kind === 'id') {
      state.view = 'view';
      bootNavHistory();
      render();
      await loadSharedById(parsed.id);
      return;
    }
  }

  state.current = loadCurrent();
  state.history = dbOn() ? [] : loadHistory();
  state.players = dbOn() ? [] : loadPlayers();
  if (window.QCPlayers && !dbOn()) {
    state.players = window.QCPlayers.save(state.players, { localOnly: true });
  }
  if (state.current) {
    state.history = [state.current, ...state.history.filter(x => x.id !== state.current.id)];
    saveHistory(state.history);
  }
  purgeStaleInProgress();
  state.view = 'home';
  bootNavHistory();
  render();

    if (dbOn()) {
    await refreshPlayers();
    render();
    refreshHistory();
    refreshCareerStatsIfNeeded();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !dbOn()) return;
    refreshPlayers().then(() => render()).catch(() => {});
    refreshHistory();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  audio.init();
  window.addEventListener('popstate', onNavPopState);
  init();
  const app = $('app');

  app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;
    if (browserBackMatches(action)) {
      history.back();
      return;
    }

    if (action === 'start-match') {
      const a = $('team-a-input')?.value || '';
      const b = $('team-b-input')?.value || '';
      state.setup.teamA = a;
      state.setup.teamB = b;
      const venue = VENUES.includes(state.setup.venue) ? state.setup.venue : DEFAULT_VENUE;
      state.setup.venue = venue;
      if (!a.trim() || !b.trim()) return showToast('Enter both team names');
      startMatch(a, b, state.setup.overs, null, venue);
      render();
      return;
    }
    if (action === 'confirm-edit-over-pin') {
      const pin = ($('edit-over-pin-input')?.value || '').trim();
      if (!pin) return showToast('Enter the PIN');
      if (pin !== EDIT_OVER_PIN) return showToast('Wrong PIN · try again');
      finishEditOverUnlock();
      return;
    }
    if (action === 'confirm-edit-ball') {
      if (state.modal?.type !== 'editBall') return;
      const sel = state.modal.sel;
      const entry = state.current.innings[state.current.currentInnings].ballLog[state.modal.logIndex];
      if (sel.runs == null && !sel.extra && !sel.wicket && !sel.runOut) {
        return showToast('Pick runs, an extra, or a wicket');
      }
      if (sel.runOut && !sel.runOutEnd) {
        state.modal = {
          type: 'runOutPick',
          sel,
          source: 'editBall',
          logIndex: state.modal.logIndex,
          strikerName: entry.strikerName || entry.batter,
          nonStrikerName: entry.nonStrikerName || 'Non-striker',
        };
        render();
        return;
      }
      if (!editBallAt(state.current, state.modal.logIndex, sel)) return showToast('Could not save ball');
      showToast('Ball updated');
      finishEditBall();
      return;
    }
    if (action === 'confirm-delete-match-pin') {
      const pin = ($('delete-match-pin-input')?.value || '').trim();
      if (!pin) return showToast('Enter the global PIN');
      if (pin !== EDIT_OVER_PIN) return showToast('Wrong PIN · try again');
      const id = state.modal?.matchId;
      state.modal = null;
      render();
      if (id) deleteMatchAndStats(id);
      return;
    }
    if (action === 'confirm-delete-player-pin') {
      const pin = ($('delete-player-pin-input')?.value || '').trim();
      if (!pin) return showToast('Enter the global PIN');
      if (pin !== EDIT_OVER_PIN) return showToast('Wrong PIN · try again');
      const id = state.modal?.playerId;
      if (!id) return;
      state.players = window.QCPlayers.remove(state.players, id);
      state.playerDetail = null;
      state.modal = null;
      state.view = 'players';
      render();
      showToast('Player removed');
      return;
    }
    if (action === 'confirm-edit-player-name') {
      const pin = ($('edit-player-pin-input')?.value || '').trim();
      if (!pin) return showToast('Enter the global PIN');
      if (pin !== EDIT_OVER_PIN) return showToast('Wrong PIN · try again');
      const id = state.modal?.playerId;
      if (!id) return;
      const name = $('edit-player-name-input')?.value || '';
      const res = window.QCPlayers.rename(state.players, id, name);
      if (res.error) return showToast(res.error);
      state.players = res.players;
      state.playerDetail = res.player;
      state.modal = null;
      render();
      showToast(res.player ? `${res.player.name} updated` : 'Name updated');
      return;
    }
    if (action === 'confirm-admin-pin') {
      const pin = ($('admin-pin-input')?.value || '').trim();
      if (!pin) return showToast('Enter the global PIN');
      if (pin !== EDIT_OVER_PIN) return showToast('Wrong PIN · try again');
      state.adminUnlocked = true;
      state.modal = null;
      state.view = 'admin';
      loadAdminMatches().then(() => render()).catch(() => render());
      return;
    }
    if (action === 'admin-reassign-run') {
      (async () => {
        const pin = ($('admin-reassign-pin')?.value || '').trim();
        if (!pin) return showToast('Enter the global PIN');
        if (pin !== EDIT_OVER_PIN) return showToast('Wrong PIN · try again');
        const matchId = $('admin-reassign-match')?.value || state.adminReassign.matchId;
        const sourceKey = $('admin-reassign-source')?.value || state.adminReassign.sourceKey;
        const targetId = $('admin-reassign-target')?.value || state.adminReassign.targetId;
        const scope = state.adminReassign.scope === 'bat' || state.adminReassign.scope === 'bowl'
          ? state.adminReassign.scope
          : 'both';
        if (!matchId) return showToast('Pick a match');
        if (!sourceKey) return showToast('Pick who was scored wrongly');
        if (!targetId) return showToast('Pick who actually played');
        showToast('Moving stats…');
        const res = await runMatchPlayerReassign(matchId, sourceKey, targetId, scope);
        if (res.error) {
          showToast(res.error);
          render();
          return;
        }
        render();
        const doneMatch = adminMatchList().find(x => x.id === matchId);
        const moved = res.scope === 'bat' ? 'Batting' : res.scope === 'bowl' ? 'Bowling' : 'Batting and bowling';
        showToast(`${moved} · ${res.sourceName} → ${res.targetName} · ${adminMatchLabel(doneMatch || { id: matchId, startedAt: Date.now(), teams: {} })}`);
      })();
      return;
    }
    if (action === 'admin-merge-run') {
      (async () => {
        const pin = ($('admin-merge-pin')?.value || '').trim();
        if (!pin) return showToast('Enter the global PIN');
        if (pin !== EDIT_OVER_PIN) return showToast('Wrong PIN · try again');
        const sourceId = $('admin-merge-source')?.value || state.adminMerge.sourceId;
        const targetId = $('admin-merge-target')?.value || state.adminMerge.targetId;
        if (!sourceId || !targetId) return showToast('Pick both players');
        if (sourceId === targetId) return showToast('Choose two different players');
        showToast('Merging…');
        const res = await runPlayerMerge(sourceId, targetId);
        if (res.error) {
          showToast(res.error);
          render();
          return;
        }
        render();
        showToast(`Merged into ${res.targetName} · stats recalculated`);
      })();
      return;
    }
    if (action === 'add-player') {
      (async () => {
        if (dbOn()) await refreshPlayers();
        const name = $('new-player-input')?.value || '';
        const res = window.QCPlayers.add(state.players, name);
        if (res.error) return showToast(res.error);
        state.players = res.players;
        render();
        showToast(`${res.player.name} added`);
      })();
      return;
    }
    if (action === 'start-innings') {
      const openerName = (key, inputId) => state.inningsManual[key]
        ? ($(inputId)?.value || '')
        : (state.inningsPick[key]?.name || $(inputId)?.value || '');
      const openerId = (key, inputId) => state.inningsManual[key]
        ? null
        : (state.inningsPick[key]?.id || $(inputId)?.dataset.playerId || null);
      const s = openerName('striker', 'striker-input');
      const ns = openerName('nonStriker', 'non-striker-input');
      const bw = openerName('bowler', 'bowler-input');
      const sId = openerId('striker', 'striker-input');
      const nsId = openerId('nonStriker', 'non-striker-input');
      const bwId = openerId('bowler', 'bowler-input');
      if (!s.trim() || !ns.trim() || !bw.trim()) return showToast('Pick both batters and a bowler');
      if (s.trim().toLowerCase() === ns.trim().toLowerCase()) return showToast('Striker and non-striker must differ');
      if ([s, ns].some(n => n.trim().toLowerCase() === bw.trim().toLowerCase())) return showToast('Bowler is already batting');
      startInnings(s, ns, bw, sId, nsId, bwId);
      resetInningsPickers();
      render();
      return;
    }
    if (action === 'score-add-new' || action === 'confirm-new-batter' || action === 'confirm-new-bowler') {
      const inn = state.current?.innings?.[state.current.currentInnings];
      if (!inn || !state.scorePick) return;
      const isBowler = state.scorePick.type === 'bowler' || action === 'confirm-new-bowler';
      let name = '';
      let pid = null;
      if (action === 'score-add-new') {
        name = (t.dataset.playerName || state.playerPickerFilter || '').trim();
      } else {
        const manual = !!state.scorePick.manual;
        const pick = !manual && state.scorePick.type === (isBowler ? 'bowler' : 'batter') ? state.scorePick.pick : null;
        const inputId = isBowler ? 'new-bowler-input' : 'new-batter-input';
        const typed = ($(inputId)?.value || state.scorePick.draft || '').trim();
        name = manual ? typed : (pick?.name || typed);
        pid = manual ? null : (pick?.id || null);
      }
      if (!name.trim()) return showToast(isBowler ? 'Pick a bowler or type a name' : 'Pick a batter or type a name');
      const ok = isBowler ? addBowler(inn, name, pid) : addBatter(inn, name, pid);
      if (!ok) return;
      state.playerPickerFilter = '';
      persistMatch(state.current);
      syncScorePick();
      render();
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
    } else if (e.target.id === 'edit-over-pin-input') {
      e.preventDefault();
      app.querySelector('[data-action="confirm-edit-over-pin"]')?.click();
    } else if (e.target.id === 'delete-player-pin-input') {
      e.preventDefault();
      app.querySelector('[data-action="confirm-delete-player-pin"]')?.click();
    } else if (e.target.id === 'delete-match-pin-input') {
      e.preventDefault();
      app.querySelector('[data-action="confirm-delete-match-pin"]')?.click();
    } else if (e.target.id === 'edit-player-pin-input') {
      e.preventDefault();
      app.querySelector('[data-action="confirm-edit-player-name"]')?.click();
    } else if (e.target.id === 'admin-pin-input') {
      e.preventDefault();
      app.querySelector('[data-action="confirm-admin-pin"]')?.click();
    } else if (e.target.id === 'admin-merge-pin') {
      e.preventDefault();
      app.querySelector('[data-action="admin-merge-run"]')?.click();
    } else if (e.target.id === 'admin-reassign-pin') {
      e.preventDefault();
      app.querySelector('[data-action="admin-reassign-run"]')?.click();
    } else if (e.target.id === 'new-player-input') {
      e.preventDefault();
      app.querySelector('[data-action="add-player"]')?.click();
    }
  });

  app.addEventListener('change', (e) => {
    if (e.target?.id === 'player-photo-input') {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      const id = state.playerDetail?.id;
      if (!file || !id) return;
      compressPlayerPhoto(file)
        .then(url => setPlayerPhoto(id, url))
        .catch(() => showToast('Could not use that photo'));
      return;
    }
    if (e.target.classList?.contains('avail-check')) {
      const id = e.target.dataset.playerId;
      if (!id) return;
      const ids = new Set(state.matchAvailability?.ids || []);
      if (e.target.checked) ids.add(id);
      else ids.delete(id);
      state.matchAvailability = { ids: [...ids] };
      render();
      return;
    }
    if (e.target.id === 'admin-reassign-match') {
      state.adminReassign.matchId = e.target.value || '';
      state.adminReassign.sourceKey = '';
      render();
    } else if (e.target.id === 'admin-reassign-source') {
      state.adminReassign.sourceKey = e.target.value || '';
      render();
    } else if (e.target.id === 'admin-reassign-target') {
      state.adminReassign.targetId = e.target.value || '';
      render();
    } else if (e.target.id === 'admin-merge-source') {
      state.adminMerge.sourceId = e.target.value || '';
      render();
    } else if (e.target.id === 'admin-merge-target') {
      state.adminMerge.targetId = e.target.value || '';
      render();
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
      state.historyScroll = 0;
      render();
    }
    if (e.target.id === 'avail-query') {
      state.availQuery = e.target.value;
      render();
    }
    if (e.target.classList?.contains('player-picker-filter')) {
      state.playerPickerFilter = e.target.value;
      render();
    }
    if ((e.target.id === 'new-batter-input' || e.target.id === 'new-bowler-input') && state.scorePick) {
      state.scorePick.draft = e.target.value;
      if (state.scorePick.manual) {
        const name = e.target.value.trim().replace(/\s+/g, ' ');
        const btn = app.querySelector('[data-action="confirm-new-batter"], [data-action="confirm-new-bowler"]');
        if (btn) {
          btn.textContent = name ? `Continue · ${name}` : 'Type a name';
          btn.classList.toggle('sc-idle', !name);
        }
      }
    }
  });
});
