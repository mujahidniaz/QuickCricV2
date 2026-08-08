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
const IN_PROGRESS_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TEAM_A = 'Green';
const DEFAULT_TEAM_B = 'Blue';
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
  setup: { teamA: DEFAULT_TEAM_A, teamB: DEFAULT_TEAM_B, overs: DEFAULT_OVERS, battingFirst: 'A', skipTeamPick: false },
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
  inningsManual: { striker: false, nonStriker: false, bowler: false },
  inningsPick: { striker: null, nonStriker: null, bowler: null },
  inningsPickUndo: [],
  playersTab: 'roster',
  adminUnlocked: false,
  adminMerge: { sourceId: '', targetId: '' },
  matchAvailability: { ids: [] },
  tossCoin: { phase: 'idle', result: null },
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

function saveHistory(arr) {
  if (dbOn()) return;
  try { localStorage.setItem(STORE_HIST, JSON.stringify(arr)); } catch { }
}
function loadCurrent() {
  if (dbOn()) return null;
  try { return JSON.parse(localStorage.getItem(STORE_CURRENT) || 'null'); } catch { return null; }
}
let localSaveTimer = null;

function saveCurrent(m) {
  if (m) {
    const stored = matchForStorage(m);
    if (localSaveTimer) clearTimeout(localSaveTimer);
    localSaveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_CURRENT, JSON.stringify(stored)); } catch { }
      localSaveTimer = null;
    }, 200);
    if (dbOn()) window.QCDB.syncMatch(stored);
  } else {
    if (!dbOn()) {
      try { localStorage.removeItem(STORE_CURRENT); } catch { }
    }
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

function resolvePlayerId(name) {
  if (!window.QCPlayers) return null;
  return window.QCPlayers.findByName(state.players, name)?.id || null;
}

function ensurePlayerInRoster(name, playerId = null) {
  const trimmed = (name || '').trim();
  if (!trimmed || !window.QCPlayers) return playerId || null;
  if (playerId && playerById(playerId)) return playerId;
  const existing = resolvePlayerId(trimmed);
  if (existing) return existing;
  const res = window.QCPlayers.add(state.players, trimmed);
  if (res.error) {
    // Name may already exist after a race/refresh — resolve again before giving up.
    return resolvePlayerId(trimmed) || playerId || null;
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
  if (!m || !matchUsesAutoSquads(m)) return state.players.slice();
  const { batting, bowling } = inningsSidesForMatch(m);
  const side = mode === 'bowl' ? bowling : batting;
  return playersForSquadSide(m, side);
}

/** Scoring modals: squad-filtered when auto-picked; bowlers exclude crease batters. */
function rosterForScoringPicker(inn, mode) {
  const m = state.current;
  let list = state.players.slice();
  if (m && matchUsesAutoSquads(m) && inn) {
    const side = mode === 'bat' ? inn.batting : inn.bowling;
    list = playersForSquadSide(m, side);
  }
  if (mode === 'bowl' && inn) {
    list = list.filter(p => !batterNotOutOnField(inn, p));
  }
  return list;
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

function renderPlayerPicker(opts) {
  const {
    label,
    action,
    players,
    inn = null,
    mode = 'bat',
    manualKey = null,
    inputId = null,
    excludeName = '',
    blockOnField = false,
    blockConsecutive = false,
    selected = null,
    modalManual = false,
  } = opts;
  const list = players || [];
  const showManual = manualKey ? state.inningsManual[manualKey] : modalManual;
  const items = list.map(p => {
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
  }).join('');
  const toggleAction = manualKey
    ? `toggle-innings-manual`
    : 'toggle-modal-manual';
  const toggleField = manualKey ? ` data-field="${manualKey}"` : '';
  return `
    <div class="player-picker">
      ${label ? `<label class="form-label small text-uppercase fw-bold text-muted">${esc(label)}</label>` : ''}
      ${list.length ? `
        <div class="player-picker-grid">${items}</div>
      ` : `<p class="player-picker-empty">No saved players yet — add a new name below.</p>`}
      ${!showManual ? `
        <button type="button" class="btn btn-sm btn-link player-picker-new px-0" data-action="${toggleAction}"${toggleField}>
          <i class="bi bi-plus-lg me-1"></i>Add new name
        </button>
      ` : ''}
      ${inputId ? `
        <div class="player-picker-manual${showManual ? '' : ' d-none'}">
          <label class="form-label" for="${esc(inputId)}">Type a name</label>
          <input id="${esc(inputId)}" class="form-control form-control-lg" type="text" placeholder="Enter name…" autocomplete="off" autocapitalize="words" />
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

function runAutoBalance(existingSquads = null) {
  const pool = playersAvailableToday();
  if (pool.length < 2) return { error: 'Need at least 2 available players' };
  const fixed = existingSquads || { A: [], B: [] };
  const res = window.QCPlayers.balanceTeams(pool, { existingSquads: fixed });
  if (!res.error && res.squads) normalizeTeamPickSquads(res.squads);
  return res;
}

async function refreshHistory() {
  if (!dbOn()) return;
  state.loadingHistory = true;
  try {
    const remote = await window.QCDB.loadMatches();
    state.history = remote;
    try {
      localStorage.removeItem(STORE_HIST);
      localStorage.removeItem(STORE_CURRENT);
    } catch { }
    if (state.current) {
      const fresh = remote.find(x => x.id === state.current.id);
      state.current = fresh && fresh.status !== 'completed' ? fresh : null;
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
function newMatch(teamA, teamB, overs, battingFirst, squads = null) {
  return {
    id: uid(),
    deviceId: DEVICE_ID,
    scoringDeviceId: DEVICE_ID,
    startedAt: Date.now(),
    endedAt: null,
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

function selFromLogEntry(entry) {
  return { runs: entry.runs ?? 0, extra: entry.extra || null, wicket: !!entry.wicket };
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
  if (inn?.needNewBatter) {
    showToast('Pick the next batter first');
    return;
  }
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
  if (intent === 'fixLastBall') {
    const inn = state.current?.innings?.[state.current?.currentInnings];
    const idx = inn ? lastBallLogIndex(inn) : -1;
    if (idx >= 0 && openEditBallByIndex(idx)) {
      render();
      return;
    }
  }
  showToast('Tap a ball to edit, or use Fix last ball');
}

function isLogIndexEditable(inn, logIndex) {
  if (!state.overEditUnlocked || logIndex < 0) return false;
  const entry = inn.ballLog[logIndex];
  if (!entry) return false;
  const live = liveOverNo(inn);
  return entry.overNo === live || entry.overNo === live - 1;
}

function findBowlerIdx(inn, name) {
  const key = (name || '').trim().toLowerCase();
  if (!key) return -1;
  return inn.bowlers.findIndex(b => b.name.toLowerCase() === key);
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

function addReplayBatter(inn, match, template) {
  const idx = inn.batters.length;
  const pid = ensurePlayerOnSide(match, inn.batting, template.name, template.playerId);
  inn.batters.push(newBatter(template.name, pid));
  if (inn.batters[inn.striker]?.out) inn.striker = idx;
  else if (inn.batters[inn.nonStriker]?.out) inn.nonStriker = idx;
  else inn.striker = idx;
  inn.needNewBatter = false;
}

function applyBallCore(inn, sel, match) {
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
  const logEntry = {
    runs: d.runs, extra: d.extra, wicket: d.wicket, total: d.totalRuns,
    label: ballLabel(d), legal: d.isLegalBall, overNo,
    batter: striker.name, bowler: bowler.name,
  };

  const maxBalls = match.overs * 6;
  const target = (match.currentInnings === 1) ? inn.target : null;
  let endNow = false;
  let reason = null;
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
    inn.ended = false;
    inn.endReason = null;
    if (d.isLegalBall && inn.score.balls % 6 === 0) {
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

  let nextBatterFromOld = 2;
  const newLog = [];

  for (let i = 0; i < entries.length; i++) {
    if (inn.ended) break;
    const entry = entries[i];
    const sel = (i === editIndex && editSel) ? editSel : selFromLogEntry(entry);

    if (inn.needNewBatter && nextBatterFromOld < oldInn.batters.length) {
      addReplayBatter(inn, match, oldInn.batters[nextBatterFromOld++]);
    }
    if (inn.needNewBowler || findBowlerIdx(inn, entry.bowler) !== inn.currentBowler) {
      ensureBowlerByName(inn, match, entry.bowler);
    }

    newLog.push(applyBallCore(inn, sel, match));
  }

  inn.ballLog = newLog;
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
  if (b.runs == null && !b.extra && !b.wicket) return false;

  pushUndo(match, 'ball-edit');
  state.freeUndosUsed = 0;
  const entries = clone(inn.ballLog);
  if (!replayInningsBallLog(match, match.currentInnings, entries, logIndex, {
    runs: b.runs ?? 0,
    extra: b.extra || null,
    wicket: !!b.wicket,
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

  const presentCount = (b.runs != null ? 1 : 0) + (b.extra ? 1 : 0) + (b.wicket ? 1 : 0);
  const targetPresent = field === 'runs' ? (b.runs != null) : field === 'extra' ? !!b.extra : !!b.wicket;
  if (!targetPresent && presentCount >= 2) {
    showToast('Max 2 selections');
    return;
  }
  if (field === 'runs') b.runs = value;
  else if (field === 'extra') b.extra = value;
  else if (field === 'wicket') b.wicket = true;
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
  let changed = false;
  const st = inn.striker;
  const ns = inn.nonStriker;
  const atStriker = inn.batters[st];
  const atNonStriker = inn.batters[ns];

  if (atStriker?.out || atNonStriker?.out) {
    if (!inn.needNewBatter) { inn.needNewBatter = true; changed = true; }
    const offCrease = inn.batters.findIndex((b, i) => !b.out && i !== st && i !== ns);
    if (offCrease >= 0) {
      if (atStriker?.out) inn.striker = offCrease;
      else if (atNonStriker?.out) inn.nonStriker = offCrease;
      inn.needNewBatter = false;
      changed = true;
    }
  }
  return changed;
}

/** Re-open batter/bowler picker after leaving mid-match (e.g. back to home). */
function syncScoringModal() {
  const m = state.current;
  if (!m || state.view !== 'score') return;
  const inn = m.innings?.[m.currentInnings];
  if (!inn || inn.ended) {
    if (state.modal?.type === 'newBatter' || state.modal?.type === 'newBowler') state.modal = null;
    return;
  }
  if (repairScoringState(inn)) persistMatch(m);
  if (inn.needNewBatter) {
    state.modal = {
      type: 'newBatter',
      manual: state.modal?.type === 'newBatter' ? !!state.modal.manual : false,
      pick: state.modal?.type === 'newBatter' ? state.modal.pick || null : null,
    };
  } else if (inn.needNewBowler) {
    state.modal = {
      type: 'newBowler',
      manual: state.modal?.type === 'newBowler' ? !!state.modal.manual : false,
      pick: state.modal?.type === 'newBowler' ? state.modal.pick || null : null,
    };
  } else if (state.modal?.type === 'newBatter' || state.modal?.type === 'newBowler') {
    state.modal = null;
  }
}

function canUndoNow(match) {
  if (!match?.undo?.length) return false;
  const kind = lastUndoKind(match);
  if (kind === 'pick' || kind === 'swap' || kind === 'innings-start' || kind === 'ball-edit') return true;
  if (kind !== 'ball') return false;

  const inn = match.innings?.[match.currentInnings];
  if (!inn) return false;

  // Over complete or wicket pending — never free-undo the last ball.
  if (inn.needNewBowler || inn.needNewBatter) {
    return state.overEditUnlocked && undoWouldLeaveCurrentOver(match);
  }

  if (state.overEditUnlocked) return undoWouldLeaveCurrentOver(match);
  return state.freeUndosUsed < FREE_UNDO && undoWouldLeaveCurrentOver(match);
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
  if (inn.ended) {
    afterInningsEnd();
    return;
  }
  if (inn.needNewBatter) {
    state.modal = { type: 'newBatter', manual: false };
  } else if (inn.needNewBowler) {
    state.modal = { type: 'newBowler', manual: false };
  }
  render();
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
  const trimmed = (name || '').trim();
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
  const trimmed = (name || '').trim();
  if (!trimmed) return false;
  if (!inn.needNewBowler) {
    showToast('No bowler slot to fill');
    return false;
  }
  if (isConsecutiveBowler(inn, { id: playerId, name: trimmed })) {
    showToast("Can't bowl consecutive overs");
    return false;
  }
  pushUndo(state.current, 'pick');
  state.freeUndosUsed = 0;
  playerId = ensurePlayerOnSide(state.current, inn.bowling, trimmed, playerId);
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

function startMatch(teamA, teamB, overs, squads = null) {
  resetInningsPickers();
  state.overEditUnlocked = false;
  state.freeUndosUsed = 0;
  state.current = newMatch(teamA, teamB, overs, 'A', squads);
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
  m.status = 'completed';
  m.endedAt = Date.now();
  m.result = computeResult(m);
  m.undo = [];

  if (window.QCPlayers) {
    m.awards = window.QCPlayers.computeAwards(m, state.players);
    state.players = window.QCPlayers.applyMatchStats(m, state.players);
  }

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
    state.modal = { type: 'newBatter', manual: false };
    render();
  } else if (inn.needNewBowler) {
    state.modal = { type: 'newBowler', manual: false };
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
function updateScoreInputUI() {
  const root = $('app');
  if (!root || state.view !== 'score' || state.shared) return false;
  const b = state.ball;
  root.querySelectorAll('[data-action="select-run"]').forEach((btn) => {
    const n = parseInt(btn.dataset.runs, 10);
    btn.classList.toggle('selected', b.runs === n);
  });
  root.querySelectorAll('[data-action="select-extra"]').forEach((btn) => {
    btn.classList.toggle('selected', b.extra === btn.dataset.extra);
  });
  const wkt = root.querySelector('[data-action="select-wkt"]');
  if (wkt) wkt.classList.toggle('selected', !!b.wicket);
  const inn = state.current?.innings?.[state.current?.currentInnings];
  const selCount = (b.runs != null ? 1 : 0) + (b.extra ? 1 : 0) + (b.wicket ? 1 : 0);
  const canNext = selCount > 0 && !inn?.needNewBatter && !inn?.needNewBowler && !inn?.ended;
  const nextBtn = root.querySelector('[data-action="next-ball"]');
  if (nextBtn) nextBtn.disabled = !canNext;
  return true;
}

function pickBall(field, value) {
  const b = state.ball;
  if (field === 'runs' && b.runs === value) { b.runs = null; updateScoreInputUI() || scheduleRender(); return; }
  if (field === 'extra' && b.extra === value) { b.extra = null; updateScoreInputUI() || scheduleRender(); return; }
  if (field === 'wicket' && b.wicket) { b.wicket = false; updateScoreInputUI() || scheduleRender(); return; }

  const presentCount = (b.runs != null ? 1 : 0) + (b.extra ? 1 : 0) + (b.wicket ? 1 : 0);
  const targetPresent = field === 'runs' ? (b.runs != null) : field === 'extra' ? !!b.extra : !!b.wicket;
  if (!targetPresent && presentCount >= 2) {
    showToast('Max 2 selections');
    return;
  }
  if (field === 'runs') b.runs = value;
  else if (field === 'extra') b.extra = value;
  else if (field === 'wicket') b.wicket = true;
  updateScoreInputUI() || scheduleRender();
}

function commitBall() {
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
      if (JSON.stringify(r.match) === JSON.stringify(state.current)) return;
      state.current = r.match;
      state.history = [r.match, ...state.history.filter(x => x.id !== id)];
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
  const scoringHere = m && state.view === 'score' && canScore(m);
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
const SCROLL_RESTORE_SEL = '.setup-body, .scroll, .break-screen, .result-screen, .score-body';

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
  if (view === 'score') syncScoringModal();
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
  } else if (state.modal?.type === 'newBatter') {
    try {
      $('new-batter-input')?.focus({ preventScroll: true });
    } catch {
      $('new-batter-input')?.focus();
    }
  } else if (state.modal?.type === 'newBowler') {
    try {
      $('new-bowler-input')?.focus({ preventScroll: true });
    } catch {
      $('new-bowler-input')?.focus();
    }
  } else if (state.modal?.type === 'deletePlayerPin') {
    try {
      $('delete-player-pin-input')?.focus({ preventScroll: true });
    } catch {
      $('delete-player-pin-input')?.focus();
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
}

function renderTopbar(title, opts = {}) {
  const { back = 'back-home', right = '', ghost = false } = opts;
  return `
    <nav class="navbar qc-navbar sticky-top px-3">
      <div class="d-flex align-items-center gap-2 flex-grow-1 min-w-0">
        <button type="button" class="btn btn-sm ${ghost ? 'btn-link text-white qc-back-link' : 'btn-outline-light'} qc-back-btn rounded-circle" data-action="${back}" aria-label="Back">
          <i class="bi bi-arrow-left"></i>
        </button>
        <span class="qc-nav-title text-truncate">${esc(title)}</span>
      </div>
      ${right ? `<div class="d-flex align-items-center gap-2 flex-shrink-0">${right}</div>` : ''}
    </nav>`;
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

function renderHome() {
  const cur = state.current;
  const inProgressCount = state.history.filter(m => m.status !== 'completed').length;
  const pastCount = state.history.filter(m => m.status === 'completed').length;
  const playerCount = state.players.length;
  const menuCard = (action, icon, label, desc, count, loading, tone = '') => `
    <button type="button" class="home-card home-card--${tone || 'default'}" data-action="${action}">
      <span class="home-card-icon"><i class="bi bi-${icon}"></i></span>
      <span class="home-card-body">
        <span class="home-card-title">${label}${count ? `<span class="home-card-count">${count}</span>` : ''}${loading ? '<span class="home-menu-spinner"></span>' : ''}</span>
        <span class="home-card-desc">${desc}</span>
      </span>
    </button>`;
  return `
    <div class="screen home-page">
      <div class="home-atmosphere" aria-hidden="true">
        <div class="home-orb home-orb--a"></div>
        <div class="home-orb home-orb--b"></div>
        <div class="home-grain"></div>
      </div>
      <div class="home-shell">
        <header class="home-brand-card">
          <img class="home-mark" src="icon.svg" alt="" width="48" height="48" />
          <div class="home-intro">
            <div class="home-brand-row">
              <h1 class="home-wordmark">QuickCric</h1>
              <span class="home-chip">Offline</span>
            </div>
            <p class="home-lede">Tap outcomes. Skip the setup. Share live scores.</p>
          </div>
        </header>
        <main class="home-main">
          ${cur ? `
            <button type="button" class="home-resume" data-action="resume">
              <span class="home-resume-dot" aria-hidden="true"></span>
              <span class="home-resume-text">
                <span class="home-resume-label">Live now</span>
                <span class="home-resume-match">${esc(cur.teams.A)} vs ${esc(cur.teams.B)}</span>
              </span>
              <span class="home-resume-go"><i class="bi bi-play-fill"></i></span>
            </button>
          ` : ''}
          <button type="button" class="home-cta" data-action="new-match">
            <span class="home-cta-text">
              <span class="home-cta-label">${cur ? 'New match' : 'Start a match'}</span>
              <span class="home-cta-sub">Teams · overs · ball-by-ball</span>
            </span>
            <span class="home-cta-arrow"><i class="bi bi-arrow-right"></i></span>
          </button>
          <div class="home-grid">
            ${inProgressCount ? menuCard('in-progress', 'hourglass-split', 'In progress', 'Resume another game', inProgressCount, false, 'amber') : ''}
            ${menuCard('history', 'trophy', 'Past matches', 'Results & scorecards', pastCount, state.loadingHistory, 'green')}
            ${menuCard('players', 'people', 'Players', 'Roster, batting & bowling ranks', playerCount, false, 'blue')}
          </div>
          ${!dbOn() ? `
            <p class="home-sync-note"><i class="bi bi-cloud-slash"></i> Cloud sync off — add keys in <code>config.js</code> for share links.</p>
          ` : ''}
        </main>
        <footer class="home-banner">
          ${install.shouldShow() ? `
            <div class="home-pwa">
              <span class="home-pwa-icon"><i class="bi bi-phone"></i></span>
              <button type="button" class="home-pwa-btn" data-action="install-show">Install for full-screen scoring</button>
              <button type="button" class="home-pwa-dismiss" data-action="install-dismiss" aria-label="Dismiss"><i class="bi bi-x"></i></button>
            </div>
          ` : ''}
          <div class="home-foot">
            <button type="button" class="foot-link" data-action="hard-reload" title="Clear app cache and reload">Refresh app</button>
            <span class="foot-dot">·</span>
            <button type="button" class="foot-link" data-action="terms">Terms</button>
            <span class="foot-dot">·</span>
            <button type="button" class="foot-link foot-link--muted" data-action="admin-open">Admin</button>
            <span class="foot-dot">·</span>
            <a class="foot-link" href="https://www.linkedin.com/in/khamash/" target="_blank" rel="noopener noreferrer">Contact</a>
          </div>
        </footer>
      </div>
    </div>
  `;
}

function renderAdmin() {
  const sorted = [...state.players].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const { sourceId, targetId } = state.adminMerge;
  const optionHtml = (selectedId) => {
    const head = '<option value="">— Select —</option>';
    const rows = sorted.map(p =>
      `<option value="${esc(p.id)}"${p.id === selectedId ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    return head + rows;
  };
  const canMerge = sourceId && targetId && sourceId !== targetId;
  return `
    <div class="screen d-flex flex-column admin-screen">
      ${renderTopbar('Admin', { back: 'back-from-admin', ghost: true })}
      <div class="scroll flex-grow-1 overflow-auto admin-body px-3 py-3">
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
    <div class="screen d-flex flex-column">
      ${renderTopbar('Terms & Conditions', { ghost: true })}
      <div class="terms-body flex-grow-1 overflow-auto px-3 px-md-4 pb-4">
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
    <button type="button" class="card w-100 text-start border-0 shadow-sm qc-match-card mb-2 ${inProg ? 'border-start border-4 border-success' : ''}" data-action="view-detail" data-match-id="${esc(m.id)}">
      <div class="card-body py-3">
        <div class="text-muted small text-uppercase fw-semibold mb-1">${fmtDate(m.startedAt)}</div>
        <div class="fw-bold fs-6 mb-2">${esc(m.teams.A)} <span class="text-muted fw-normal">vs</span> ${esc(m.teams.B)}</div>
        ${i1 ? `<div class="d-flex justify-content-between small text-secondary mb-1"><span>${esc(m.teams[i1.batting])}</span><span class="font-monospace">${i1.score.runs}/${i1.score.wickets} (${fmtOvers(i1.score.balls)})</span></div>` : ''}
        ${i2 ? `<div class="d-flex justify-content-between small text-secondary mb-2"><span>${esc(m.teams[i2.batting])}</span><span class="font-monospace">${i2.score.runs}/${i2.score.wickets} (${fmtOvers(i2.score.balls)})</span></div>` : ''}
        <span class="badge ${inProg ? 'text-bg-success' : 'text-bg-primary'}">${esc(m.result || 'In progress')}</span>
      </div>
    </button>
  `;
}

function renderSetup() {
  const s = state.setup;
  const presets = [5, 6, 8, 10, 15, 20];
  return `
    <div class="screen d-flex flex-column">
      ${renderTopbar('New match', { ghost: true })}
      <div class="setup-body flex-grow-1 overflow-auto px-3 py-4">
        <div class="mb-4">
          <label class="form-label small text-uppercase fw-bold text-muted">Teams</label>
          <div class="input-group mb-2">
            <input id="team-a-input" class="form-control form-control-lg" type="text" placeholder="${esc(DEFAULT_TEAM_A)}" value="${esc(s.teamA)}" />
          </div>
          <div class="input-group">
            <input id="team-b-input" class="form-control form-control-lg" type="text" placeholder="${esc(DEFAULT_TEAM_B)}" value="${esc(s.teamB)}" />
          </div>
        </div>
        <div class="mb-4">
          <label class="form-label small text-uppercase fw-bold text-muted">Overs per innings</label>
          <div class="d-flex align-items-center justify-content-center gap-4 mb-3">
            <button type="button" class="btn btn-dark btn-lg rounded-circle qc-counter-btn" data-action="overs-step" data-delta="-1" aria-label="Decrease overs" ${s.overs <= 1 ? 'disabled' : ''}>−</button>
            <span class="counter-value">${s.overs}</span>
            <button type="button" class="btn btn-dark btn-lg rounded-circle qc-counter-btn" data-action="overs-step" data-delta="1" aria-label="Increase overs" ${s.overs >= 99 ? 'disabled' : ''}>+</button>
          </div>
          <div class="d-flex flex-wrap gap-2 justify-content-center">
            ${presets.map(o => `<button type="button" class="btn btn-sm ${s.overs === o ? 'btn-dark' : 'btn-outline-secondary'} rounded-pill px-3" data-action="overs-pick" data-overs="${o}">${o}</button>`).join('')}
          </div>
        </div>
        ${state.players.length > 0 ? `
          <div class="alert alert-light border small mb-0">
            <i class="bi bi-people me-1"></i>${state.players.length} saved players · pick squads next (or skip)
          </div>
        ` : ''}
      </div>
      ${renderBottomBar('Start match', 'start-match')}
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
      : 'Tap below to flip';

  return `
    <div class="toss-stage" aria-live="polite">
      <p class="toss-stage-status small text-uppercase fw-bold text-muted mb-2">${esc(status)}</p>
      <div class="toss-coin-scene">
        <div class="toss-coin-shadow${flipping ? ' is-active' : ''}" aria-hidden="true"></div>
        <div class="toss-coin ${animClass}${flipping ? ' is-flipping' : ''}" role="img" aria-label="Coin toss">
          <div class="toss-coin-edge" aria-hidden="true"></div>
          <div class="toss-coin-face toss-coin-face--heads">
            <span class="toss-coin-face-tag">Heads</span>
            <span class="toss-coin-face-team">${esc(headsLabel)}</span>
          </div>
          <div class="toss-coin-face toss-coin-face--tails">
            <span class="toss-coin-face-tag">Tails</span>
            <span class="toss-coin-face-team">${esc(tailsLabel)}</span>
          </div>
        </div>
      </div>
      <div class="toss-legend d-flex justify-content-center gap-3 small text-muted mt-2">
        <span><strong class="text-dark">Heads</strong> = ${esc(tossCoinShortLabel(m.teams.A, 14))}</span>
        <span><strong class="text-dark">Tails</strong> = ${esc(tossCoinShortLabel(m.teams.B, 14))}</span>
      </div>
    </div>`;
}

function renderMatchToss() {
  const m = state.current;
  const bf = m.battingFirst === 'B' ? 'B' : 'A';
  const batName = m.teams[bf];
  const flipping = state.tossCoin?.phase === 'flipping';
  return `
    <div class="screen d-flex flex-column toss-screen">
      ${renderTopbar('Toss', { back: 'back-from-toss', ghost: true })}
      <div class="setup-head text-white px-4 py-3">
        <h2 class="h5 fw-bold mb-1">${esc(m.teams.A)} vs ${esc(m.teams.B)}</h2>
        <p class="mb-0 small opacity-75">${m.overs} overs per side${matchUsesSquads(m) ? ' · squads set' : ''}</p>
      </div>
      <div class="setup-body flex-grow-1 overflow-auto px-3 py-4">
        ${renderTossCoinStage(m)}
        <label class="form-label small text-uppercase fw-bold text-muted mt-2">Or pick manually</label>
        <div class="d-grid gap-2 mb-3">
          <button type="button" class="btn btn-lg text-start ${bf === 'A' ? 'btn-warning' : 'btn-outline-secondary'}" data-action="bat-first" data-team="A" ${flipping ? 'disabled' : ''}>
            <span class="fw-bold">${esc(m.teams.A)}</span>
            ${bf === 'A' ? '<span class="small ms-2 opacity-75">· batting first</span>' : ''}
          </button>
          <button type="button" class="btn btn-lg text-start ${bf === 'B' ? 'btn-warning' : 'btn-outline-secondary'}" data-action="bat-first" data-team="B" ${flipping ? 'disabled' : ''}>
            <span class="fw-bold">${esc(m.teams.B)}</span>
            ${bf === 'B' ? '<span class="small ms-2 opacity-75">· batting first</span>' : ''}
          </button>
        </div>
        <button type="button" class="btn btn-primary w-100 toss-flip-btn" data-action="toss" ${flipping ? 'disabled' : ''}>
          <i class="bi bi-coin me-2"></i>${flipping ? 'Flipping…' : 'Toss coin'}
        </button>
        <p class="small text-muted mt-3 mb-0">${esc(batName)} will bat first unless you change it above.</p>
      </div>
      ${flipping ? `
      <div class="qc-bottom-bar border-top bg-body px-3 py-3 mt-auto">
        <button type="button" class="btn btn-primary btn-lg w-100 fw-bold" disabled>Continue to openers</button>
      </div>` : renderBottomBar('Continue to openers', 'confirm-toss')}
    </div>
  `;
}

function renderInningsSetup() {
  const m = state.current;
  const isFirst = m.innings.length === 0;
  const batting = isFirst ? m.battingFirst : (m.battingFirst === 'A' ? 'B' : 'A');
  const bowling = batting === 'A' ? 'B' : 'A';
  const team = m.teams[batting];
  const target = !isFirst ? m.innings[0].score.runs + 1 : null;
  return `
    <div class="screen d-flex flex-column">
      ${renderTopbar(isFirst ? 'Innings 1' : 'Innings 2', { back: 'back-from-innings-setup' })}
      <div class="setup-head text-white px-4 py-3">
        <h2 class="h4 fw-bold mb-1">${esc(team)} batting</h2>
        ${target ? `<p class="mb-0 opacity-75 small">Chasing ${target} in ${m.overs} overs</p>` : `<p class="mb-0 opacity-75 small">${m.overs} overs to bat</p>`}
      </div>
      <div class="setup-body flex-grow-1 overflow-auto px-3 py-4">
        ${state.players.length ? `<p class="small text-muted mb-3">${matchUsesAutoSquads(m)
          ? `Auto-picked squads — batters from ${esc(m.teams[batting])}, bowlers from ${esc(m.teams[bowling])}`
          : `${state.players.length} saved players — tap a name for each role`}</p>` : ''}
        ${renderPlayerPicker({
          label: 'Striker',
          action: 'pick-striker',
          players: rosterForInningsSetup('bat'),
          mode: 'bat',
          manualKey: 'striker',
          inputId: 'striker-input',
          excludeName: state.inningsPick.nonStriker?.name || '',
          selected: state.inningsPick.striker,
        })}
        ${renderPlayerPicker({
          label: 'Non-striker',
          action: 'pick-non-striker',
          players: rosterForInningsSetup('bat'),
          mode: 'bat',
          manualKey: 'nonStriker',
          inputId: 'non-striker-input',
          excludeName: state.inningsPick.striker?.name || '',
          selected: state.inningsPick.nonStriker,
        })}
        ${renderPlayerPicker({
          label: 'Bowler',
          action: 'pick-bowler',
          players: rosterForInningsSetup('bowl'),
          mode: 'bowl',
          manualKey: 'bowler',
          inputId: 'bowler-input',
          selected: state.inningsPick.bowler,
        })}
      </div>
      <div class="undo-row px-3 pb-2">
        <button type="button" class="btn btn-sm btn-outline-secondary w-100" data-action="undo-innings-pick" ${state.inningsPickUndo.length ? '' : 'disabled'}>↶ Undo last pick</button>
      </div>
      ${renderBottomBar('Start innings', 'start-innings')}
    </div>
  `;
}

function creaseRow(inn, idx, needPick) {
  const b = inn.batters[idx];
  if (b?.out) {
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

  let targetPill = '';
  if (m.currentInnings === 1 && inn.target != null) {
    const need = inn.target - inn.score.runs;
    const ballsLeft = (m.overs * 6) - inn.score.balls;
    if (need > 0) targetPill = `Need ${need} from ${ballsLeft} balls`;
  }

  const b = state.ball;
  const selCount = (b.runs != null ? 1 : 0) + (b.extra ? 1 : 0) + (b.wicket ? 1 : 0);
  const canNext = selCount > 0 && !inn.needNewBatter && !inn.needNewBowler && !inn.ended;
  const canUndo = canUndoNow(m);
  const canSwap = !inn.ended && !inn.needNewBatter && !inn.needNewBowler &&
    inn.batters[inn.striker] && inn.batters[inn.nonStriker] &&
    !inn.batters[inn.striker].out && !inn.batters[inn.nonStriker].out;
  const overBallCount = overBalls.length;
  const canEditOver = !inn.ended && inn.ballLog.length > 0;
  const atOverBreak = inn.score.balls > 0 && inn.score.balls % 6 === 0 && !inn.ended;
  const editMode = state.overEditUnlocked;
  const overStripsHtml = editMode
    ? editableOverNumbers(inn).map((overNo) => renderOverStrip(inn, overNo, {
        editable: true,
        label: overNo === liveOver ? 'This over · tap a ball' : `Over ${overNo + 1} · tap a ball`,
        showSum: true,
      })).join('')
    : renderOverStrip(inn, overToShow, {
        editable: false,
        label: showingLast ? 'Last over' : (atOverBreak ? 'Over just bowled' : 'This over'),
        showSum: showingLast || atOverBreak,
        emptySlots: atOverBreak ? 0 : remainingLegal,
      });

  return `
    <div class="screen score-screen">
      ${renderTopbar(team, {
        back: 'home',
        right: `${iconBtn('toggle-audio', audio.enabled ? 'volume-up-fill' : 'volume-mute-fill', audio.enabled ? '' : 'muted', 'Toggle sound')}${iconBtn('share', 'box-arrow-up', '', 'Share')}`,
      })}
      <div class="score-body">
      <div class="hero">
        <div class="team">${esc(team)}${m.currentInnings === 1 ? ' · 2nd innings' : ''}</div>
        <div class="rate">scoring at ${rate} per over</div>
        <div class="score-line">${inn.score.runs}/${inn.score.wickets}</div>
        <div class="overs">${fmtOvers(inn.score.balls)} / ${m.overs}.0 overs</div>
        ${targetPill ? `<div class="target">${esc(targetPill)}</div>` : ''}
        ${editMode ? `<div class="pin-badge">Tap any ball in this or the previous over to edit</div>` : ''}
      </div>
      <div class="stats">
        <div class="row${strikerRow.pending ? ' crease-pending' : ''}">
          <span class="name striker">${esc(strikerRow.name)}</span>
          <span class="figs">${esc(strikerRow.figs)}</span>
        </div>
        <div class="row bowler-row">
          <span class="name">${esc(bowler.name)}</span>
          <span class="figs">${fmtOvers(bowler.balls)} · ${bowler.runs}/${bowler.wickets}</span>
        </div>
        <div class="row${nonStrikerRow.pending ? ' crease-pending' : ''}">
          <span class="name">${esc(nonStrikerRow.name)}</span>
          <span class="figs">${esc(nonStrikerRow.figs)}</span>
        </div>
        <div class="row stats-actions">
          <button type="button" class="strike-swap-btn" data-action="swap-strike" ${canSwap ? '' : 'disabled'} title="Swap striker and non-striker">⇄ Swap strike</button>
        </div>
      </div>
      ${overStripsHtml}
      ${!editMode && canEditOver ? `
      <div class="over-edit-bar">
        <button type="button" class="over-edit-primary" data-action="edit-over">Edit over</button>
        ${atOverBreak ? `<button type="button" class="over-edit-secondary" data-action="fix-last-ball">Fix last ball</button>` : ''}
      </div>` : ''}
      ${editMode ? `<div class="over-edit-bar over-edit-bar--active">
        <span class="over-edit-active-label">Tap a ball to change it</span>
        <button type="button" class="over-edit-secondary" data-action="done-edit-over">Done</button>
      </div>` : ''}
      ${!editMode && hasLastOver ? `
      <div class="over-strip-nav">
        <button type="button" class="over-toggle" data-action="toggle-last-over">${showingLast ? 'Show this over' : 'View last over'}</button>
      </div>` : ''}
      ${inn.freeHit ? `<div class="free-hit-banner free-hit-banner--compact"><span class="fh-dot"></span>Free hit<span class="fh-dot"></span></div>` : ''}
      <div class="undo-row">
        ${showingLast ? '' : `<button data-action="undo" ${canUndo ? '' : 'disabled'}>${undoActionLabel(m)}</button>`}
      </div>
      </div>
      <div class="actions score-actions">
        <div class="input-cluster">
          <button class="wkt-btn ${b.wicket ? 'selected' : ''}" data-action="select-wkt">WKT</button>
          <div class="extras-panel">
            <div class="heading">Extras</div>
            <div class="extras-btns">
              ${['wd', 'nb', 'lb', 'b'].map(e => `<button class="extra-btn ${b.extra === e ? 'selected' : ''}" data-action="select-extra" data-extra="${e}">${e}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="runs-grid">
          <button class="run-btn dot ${b.runs === 0 ? 'selected' : ''}" data-action="select-run" data-runs="0">DOT</button>
          ${[1, 2, 3, 4, 5, 6].map(n => `<button class="run-btn ${b.runs === n ? 'selected' : ''}" data-action="select-run" data-runs="${n}">${n}</button>`).join('')}
        </div>
        <div class="next-bar px-1">
          <button type="button" class="btn btn-dark btn-lg w-100 fw-bold next-ball" data-action="next-ball" ${canNext ? '' : 'disabled'}>Next ball</button>
        </div>
        <div class="foot-links d-flex justify-content-center gap-3 py-1">
          <button type="button" class="btn btn-link btn-sm text-muted p-0" data-action="end-innings">End innings</button>
          <button type="button" class="btn btn-link btn-sm text-danger p-0" data-action="abort-show">Abort match</button>
        </div>
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
    <div class="screen break-screen d-flex flex-column overflow-auto">
      ${renderTopbar('Innings break', { back: 'home', right: iconBtn('share', 'box-arrow-up', '', 'Share') })}
      <div class="break-hero text-white text-center px-4 py-4">
        <div class="small text-uppercase opacity-75 fw-bold mb-1">End of innings 1</div>
        <div class="h5 fw-bold mb-2">${esc(m.teams[i1.batting])}</div>
        <div class="score-big">${i1.score.runs}/${i1.score.wickets}</div>
        <div class="opacity-75 mb-3">${fmtOvers(i1.score.balls)} overs · RR ${fmtRate(i1.score.runs, i1.score.balls)}</div>
        <span class="badge rounded-pill text-bg-warning fs-6 px-3 py-2">${esc(m.teams[battingNext])} need ${i1.score.runs + 1}</span>
      </div>
      <div class="scorecard px-3 pb-3 flex-grow-1">${renderInningsCard(m, i1, 'Innings 1')}</div>
      ${renderBottomBar('Start 2nd innings', 'start-next-innings')}
    </div>
  `;
}

function renderDetail() {
  const m = state.detail || state.current;
  if (!m) return renderHome();
  const isJustEnded = state.view === 'result';
  const isHistoricalView = state.view === 'detail' && m.status === 'completed';
  return `
    <div class="screen result-screen d-flex flex-column overflow-auto">
      ${renderTopbar('Match summary', { right: iconBtn('share', 'box-arrow-up', '', 'Share') })}
      <div class="result-banner text-white text-center px-4 py-4">
        <div class="small text-uppercase opacity-75 fw-bold mb-1">${m.status === 'completed' ? 'Result' : 'Status'}</div>
        <div class="winner display-6 fw-bold mb-2">${esc(m.result || 'Match in progress')}</div>
        <div class="opacity-75">${esc(m.teams.A)} vs ${esc(m.teams.B)} · ${fmtDate(m.startedAt)} · ${m.overs} overs</div>
      </div>
      ${renderAwards(m)}
      ${renderTopPerformers(m)}
      <div class="scorecard px-3 pb-3 flex-grow-1">
        ${m.innings.map((inn, i) => renderInningsCard(m, inn, `Innings ${i + 1}`)).join('')}
      </div>
      ${isJustEnded ? renderBottomBar('Done', 'back-home') : ''}
      ${isHistoricalView ? `
        <div class="qc-bottom-bar border-top bg-body px-3 py-3">
          <button type="button" class="btn btn-outline-danger btn-lg w-100" data-action="delete-match" data-match-id="${esc(m.id)}"><i class="bi bi-trash me-2"></i>Delete match</button>
        </div>` : ''}
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
                <td><div class="fw-semibold">${esc(b.name)}</div><div class="text-muted" style="font-size:11px">${b.out ? 'out' : 'not out'}</div></td>
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
  const a = m.awards || (m.status === 'completed' && window.QCPlayers
    ? window.QCPlayers.computeAwards(m, state.players)
    : null);
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
  const draftCount = (state.teamPick?.squads?.A?.length || 0) + (state.teamPick?.squads?.B?.length || 0);
  const QP = window.QCPlayers;
  return `
    <div class="screen d-flex flex-column match-avail-screen">
      ${renderTopbar('Available today', { back: 'back-from-availability', ghost: true })}
      <div class="setup-head text-white px-4 py-3">
        <h2 class="h5 fw-bold mb-1">${esc(m?.teams?.A || '')} vs ${esc(m?.teams?.B || '')}</h2>
        <p class="mb-0 small opacity-75">${n} of ${sorted.length} players available</p>
      </div>
      <div class="avail-toolbar px-3 py-2 d-flex gap-2 border-bottom bg-white">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-action="availability-select-all">Select all</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-action="availability-clear">Clear</button>
      </div>
      <div class="scroll flex-grow-1 overflow-auto players-list-scroll">
        <div class="players-table">
          <div class="players-table-body">
            ${sorted.map(p => {
              const on = checked.has(p.id);
              return `
              <label class="avail-row${on ? ' is-checked' : ''}">
                <input type="checkbox" class="avail-check" data-player-id="${esc(p.id)}" ${on ? 'checked' : ''} />
                <span class="players-row-avatar">${esc(p.name.charAt(0).toUpperCase())}</span>
                <span class="players-row-text">
                  <span class="players-row-name">${esc(p.name)}</span>
                  <span class="players-row-meta">${p.batting.runs} runs · ${p.bowling.wickets} wkts · SR ${QP.batSR(p.batting)}</span>
                </span>
              </label>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div class="qc-bottom-bar border-top bg-body px-3 py-3 mt-auto d-grid gap-2">
        <button type="button" class="btn btn-primary btn-lg fw-bold" data-action="availability-auto" ${canSquads ? '' : 'disabled'}>Auto-pick balanced teams</button>
        ${draftCount > 0 ? `<button type="button" class="btn btn-outline-primary" data-action="availability-review">Review teams (${draftCount})</button>` : ''}
        <button type="button" class="btn btn-outline-dark" data-action="availability-manual" ${canSquads ? '' : 'disabled'}>Pick teams manually</button>
        <button type="button" class="btn btn-link text-muted" data-action="availability-skip">Skip squads · type names later</button>
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

function renderTeamPick() {
  const tp = state.teamPick;
  const m = state.current;
  const isReview = tp.mode === 'review';
  const picking = isReview ? tp.picking : teamPickSideForNext(tp.squads);
  const avail = availableForPick();
  const teamName = m.teams[picking];
  const countA = tp.squads.A.length;
  const countB = tp.squads.B.length;
  const sizeDiff = squadSizeDiff(tp.squads);

  if (isReview) {
    return `
    <div class="screen d-flex flex-column squad-review-screen">
      ${renderTopbar('Review squads', { back: 'back-from-team-pick', ghost: true })}
      <div class="setup-head text-white px-4 py-3">
        <h2 class="h5 fw-bold mb-1">${esc(m.teams.A)} vs ${esc(m.teams.B)}</h2>
        <p class="mb-0 small opacity-75">Move players between teams · sizes stay equal (or one extra if odd total)</p>
        ${sizeDiff > 1 ? `<p class="mb-0 small text-warning mt-1">Teams are ${sizeDiff} apart — tap Reshuffle or move players to even up</p>` : ''}
      </div>
      <div class="px-3 py-3 flex-grow-1 overflow-auto">
        <div class="row g-2 squad-review-cols">
          <div class="col-6">
            <div class="card h-100">
              <div class="card-header py-2 d-flex justify-content-between">
                <span class="small fw-bold">${esc(m.teams.A)}</span>
                <span class="badge text-bg-secondary">${countA}</span>
              </div>
              <div class="card-body py-2 squad-review-list">
                ${tp.squads.A.length
                  ? tp.squads.A.map(id => renderSquadReviewRow(id, 'A', m, tp.squads)).join('')
                  : '<span class="text-muted small">Empty</span>'}
              </div>
            </div>
          </div>
          <div class="col-6">
            <div class="card h-100">
              <div class="card-header py-2 d-flex justify-content-between">
                <span class="small fw-bold">${esc(m.teams.B)}</span>
                <span class="badge text-bg-secondary">${countB}</span>
              </div>
              <div class="card-body py-2 squad-review-list">
                ${tp.squads.B.length
                  ? tp.squads.B.map(id => renderSquadReviewRow(id, 'B', m, tp.squads)).join('')
                  : '<span class="text-muted small">Empty</span>'}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="qc-bottom-bar border-top bg-body px-3 py-3 mt-auto d-grid gap-2">
        <button type="button" class="btn btn-outline-secondary" data-action="squad-review-reshuffle">Reshuffle auto-pick</button>
        <button type="button" class="btn btn-outline-secondary" data-action="undo-team-pick" ${state.teamPickUndo.length ? '' : 'disabled'}>↶ Undo</button>
        <button type="button" class="btn btn-primary btn-lg fw-bold" data-action="finish-team-pick">Continue to toss</button>
      </div>
    </div>`;
  }

  return `
    <div class="screen d-flex flex-column">
      ${renderTopbar('Pick squads', { back: 'back-from-team-pick', ghost: true })}
      <div class="setup-head text-white px-4 py-3">
        <h2 class="h5 fw-bold mb-1">${esc(m.teams.A)} vs ${esc(m.teams.B)}</h2>
        <p class="mb-0 small opacity-75">Captains pick alternately · ${esc(m.teams.A)} ${countA} · ${esc(m.teams.B)} ${countB}</p>
      </div>
      <div class="px-3 py-3">
        <div class="row g-2">
          <div class="col-6">
            <div class="card h-100 ${picking === 'A' ? 'border-warning border-2 shadow-sm' : ''}">
              <div class="card-header py-2 d-flex justify-content-between"><span class="small fw-bold">${esc(m.teams.A)}</span><span class="badge text-bg-secondary">${countA}</span></div>
              <div class="card-body py-2 d-flex flex-wrap gap-1">${tp.squads.A.map(id => `<span class="badge text-bg-light text-dark border">${esc(playerName(id))}</span>`).join('') || '<span class="text-muted small">Empty</span>'}</div>
            </div>
          </div>
          <div class="col-6">
            <div class="card h-100 ${picking === 'B' ? 'border-warning border-2 shadow-sm' : ''}">
              <div class="card-header py-2 d-flex justify-content-between"><span class="small fw-bold">${esc(m.teams.B)}</span><span class="badge text-bg-secondary">${countB}</span></div>
              <div class="card-body py-2 d-flex flex-wrap gap-1">${tp.squads.B.map(id => `<span class="badge text-bg-light text-dark border">${esc(playerName(id))}</span>`).join('') || '<span class="text-muted small">Empty</span>'}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="setup-body flex-grow-1 overflow-auto px-3">
        <p class="mb-3">Picking for <strong>${esc(teamName)}</strong></p>
        <div class="d-flex flex-wrap gap-2">
          ${avail.length ? avail.map(p => `
            <button type="button" class="btn btn-outline-dark rounded-pill" data-action="team-pick-player" data-player-id="${esc(p.id)}">${esc(p.name)}</button>
          `).join('') : '<span class="text-muted">All players picked</span>'}
        </div>
      </div>
      <div class="qc-bottom-bar border-top bg-body px-3 py-3 mt-auto d-grid gap-2">
        <button type="button" class="btn btn-outline-secondary" data-action="auto-pick-teams">Auto-pick teams</button>
        ${(countA + countB) > 0 ? `<button type="button" class="btn btn-outline-primary" data-action="enter-squad-review">Review squads</button>` : ''}
        <button type="button" class="btn btn-outline-secondary" data-action="undo-team-pick" ${state.teamPickUndo.length ? '' : 'disabled'}>↶ Undo last pick</button>
        <button type="button" class="btn btn-primary btn-lg fw-bold" data-action="finish-team-pick">Continue to toss</button>
        <button type="button" class="btn btn-link text-muted" data-action="skip-team-pick">Skip · type names later</button>
      </div>
    </div>
  `;
}

function renderPlayers() {
  const list = state.players;
  const tab = state.playersTab || 'roster';
  const QP = window.QCPlayers;
  const batRanked = QP.battingRankings(list);
  const bowlRanked = QP.bowlingRankings(list);
  const rosterSorted = [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const tabs = [
    { id: 'roster', label: 'Roster', count: list.length },
    { id: 'batting', label: 'Batting', count: batRanked.length },
    { id: 'bowling', label: 'Bowling', count: bowlRanked.length },
  ];

  function rankingRow(p, rank, kind) {
    const topClass = rank <= 3 ? ` players-row-rank--top players-row-rank--${rank}` : '';
    const hero = kind === 'batting' ? String(p.batting.runs) : String(p.bowling.wickets);
    const heroLbl = kind === 'batting' ? 'runs' : 'wkts';
    const detail = kind === 'batting'
      ? `Avg ${QP.batAvg(p.batting)} · SR ${QP.batSR(p.batting)} · ${p.batting.innings} inns`
      : `Econ ${QP.bowlEcon(p.bowling)} · Avg ${QP.bowlAvg(p.bowling)} · ${QP.fmtOvers(p.bowling.balls)} ov`;
    return `
      <button type="button" class="players-row players-row--rank" data-action="view-player" data-player-id="${esc(p.id)}">
        <span class="players-row-rank${topClass}">${rank}</span>
        <span class="players-row-text">
          <span class="players-row-name">${esc(p.name)}</span>
          <span class="players-row-meta">${detail}</span>
        </span>
        <span class="players-row-hero"><span class="players-row-hero-val">${hero}</span><span class="players-row-hero-lbl">${heroLbl}</span></span>
      </button>`;
  }

  function rosterRow(p) {
    return `
      <button type="button" class="players-row players-row--roster" data-action="view-player" data-player-id="${esc(p.id)}">
        <span class="players-row-avatar">${esc(p.name.charAt(0).toUpperCase())}</span>
        <span class="players-row-text">
          <span class="players-row-name">${esc(p.name)}</span>
          <span class="players-row-meta">SR ${QP.batSR(p.batting)} · ${QP.fmtOvers(p.bowling.balls)} ov</span>
        </span>
        <span class="players-row-stats">
          <span class="players-stat-pill players-stat-pill--bat" title="Runs">${p.batting.runs}</span>
          <span class="players-stat-pill players-stat-pill--bowl" title="Wickets">${p.bowling.wickets}</span>
        </span>
      </button>`;
  }

  let tableHead = '';
  let tableBody = '';

  if (tab === 'roster') {
    if (list.length === 0) {
      tableBody = `<div class="players-empty players-empty--compact"><p>No players yet — add a name above</p></div>`;
    } else {
      tableHead = `
        <div class="players-table-head players-table-head--roster">
          <span class="col-rank" aria-hidden="true"></span>
          <span class="col-player">Player</span>
          <span class="col-nums"><span>R</span><span>W</span></span>
        </div>`;
      tableBody = rosterSorted.map(rosterRow).join('');
    }
  } else if (tab === 'batting') {
    if (batRanked.length === 0) {
      tableBody = `<div class="players-empty players-empty--compact"><p>No batting stats — finish a match first</p></div>`;
    } else {
      tableHead = `
        <div class="players-table-head">
          <span class="col-rank">#</span>
          <span class="col-player">Runs · avg · SR</span>
          <span class="col-hero">Runs</span>
        </div>`;
      tableBody = batRanked.map((p, i) => rankingRow(p, i + 1, 'batting')).join('');
    }
  } else {
    if (bowlRanked.length === 0) {
      tableBody = `<div class="players-empty players-empty--compact"><p>No bowling stats — finish a match first</p></div>`;
    } else {
      tableHead = `
        <div class="players-table-head">
          <span class="col-rank">#</span>
          <span class="col-player">Econ · avg · overs</span>
          <span class="col-hero">Wkts</span>
        </div>`;
      tableBody = bowlRanked.map((p, i) => rankingRow(p, i + 1, 'bowling')).join('');
    }
  }

  return `
    <div class="screen d-flex flex-column players-screen">
      ${renderTopbar('Players', { ghost: true })}
      <div class="players-toolbar">
        <div class="players-add-row">
          <input id="new-player-input" class="form-control players-add-input" type="text" placeholder="Add player…" autocomplete="off" autocapitalize="words" />
          <button type="button" class="btn btn-primary btn-sm players-add-btn" data-action="add-player">Add</button>
        </div>
        <div class="players-segment" role="tablist">
          ${tabs.map(t => `
            <button type="button" role="tab" aria-selected="${tab === t.id}"
              class="players-segment-btn${tab === t.id ? ' is-active' : ''}"
              data-action="players-tab" data-tab="${t.id}">
              ${esc(t.label)}<span class="players-segment-count">${t.count}</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="scroll flex-grow-1 overflow-auto players-list-scroll">
        <div class="players-table${tableHead ? '' : ' players-table--bare'}">
          ${tableHead}
          <div class="players-table-body">${tableBody}</div>
        </div>
      </div>
    </div>
  `;
}

function renderStatList(items) {
  return `
    <div class="player-stat-list">
      ${items.map(([label, val]) => `
        <div class="player-stat-row">
          <span class="player-stat-label">${esc(label)}</span>
          <span class="player-stat-value">${esc(String(val))}</span>
        </div>
      `).join('')}
    </div>`;
}

function renderPlayerDetail() {
  const p = state.playerDetail;
  if (!p) return renderPlayers();
  const bat = p.batting;
  const bowl = p.bowling;
  const QP = window.QCPlayers;
  const bestBowl = bowl.bestWickets
    ? `${bowl.bestWickets}/${bowl.bestRuns ?? 0}`
    : '—';
  const batPrimary = [
    ['Runs', bat.runs],
    ['Average', QP.batAvg(bat)],
    ['Strike rate', QP.batSR(bat)],
    ['Highest', bat.highest],
  ];
  const batSecondary = [
    ['Matches', bat.matches],
    ['Innings', bat.innings],
    ['Balls faced', bat.balls],
    ['Fifties', bat.fifties],
    ['Hundreds', bat.hundreds],
    ['Fours', bat.fours],
    ['Sixes', bat.sixes],
    ['Ducks', bat.ducks],
  ];
  const bowlPrimary = [
    ['Wickets', bowl.wickets],
    ['Average', QP.bowlAvg(bowl)],
    ['Economy', QP.bowlEcon(bowl)],
    ['Best figures', bestBowl],
  ];
  const bowlSecondary = [
    ['Matches', bowl.matches],
    ['Overs', QP.fmtOvers(bowl.balls)],
    ['Runs conceded', bowl.runs],
    ['Strike rate', QP.bowlSR(bowl)],
    ['3-wicket hauls', bowl.threeWickets],
    ['5-wicket hauls', bowl.fiveWickets],
  ];
  return `
    <div class="screen d-flex flex-column player-profile-screen">
      ${renderTopbar('Player stats', { back: 'players', ghost: true })}
      <div class="scroll flex-grow-1 overflow-auto">
        <div class="player-hero">
          <div class="player-hero-inner">
            <div class="player-avatar">${esc(p.name.charAt(0).toUpperCase())}</div>
            <h1 class="player-hero-name">${esc(p.name)}</h1>
            <p class="player-hero-line">${bat.runs} runs · ${bowl.wickets} wickets · SR ${QP.batSR(bat)}</p>
          </div>
        </div>
        <div class="player-sections">
          <section class="player-section">
            <h2 class="player-section-title"><span class="dot batting"></span>Batting</h2>
            <div class="player-stat-card">
              <div class="player-stat-highlights">
                ${batPrimary.map(([lbl, val]) => `
                  <div class="player-highlight">
                    <div class="player-highlight-val">${esc(String(val))}</div>
                    <div class="player-highlight-lbl">${esc(lbl)}</div>
                  </div>
                `).join('')}
              </div>
              ${renderStatList(batSecondary)}
            </div>
          </section>
          <section class="player-section">
            <h2 class="player-section-title"><span class="dot bowling"></span>Bowling</h2>
            <div class="player-stat-card">
              <div class="player-stat-highlights">
                ${bowlPrimary.map(([lbl, val]) => `
                  <div class="player-highlight">
                    <div class="player-highlight-val">${esc(String(val))}</div>
                    <div class="player-highlight-lbl">${esc(lbl)}</div>
                  </div>
                `).join('')}
              </div>
              ${renderStatList(bowlSecondary)}
            </div>
          </section>
          <button type="button" class="btn btn-outline-secondary w-100 mb-2" data-action="edit-player-name" data-player-id="${esc(p.id)}">
            <i class="bi bi-pencil me-2"></i>Edit name
          </button>
          <button type="button" class="btn btn-outline-danger w-100 player-delete-btn" data-action="delete-player" data-player-id="${esc(p.id)}">
            <i class="bi bi-trash3 me-2"></i>Remove player
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderHistory() {
  const filter = state.historyFilter;
  const customDate = state.historyDate;
  const completed = state.history.filter(m => m.status === 'completed');
  const filtered = filterByDate(completed, filter, customDate);
  const isCustom = filter === 'custom';
  return `
    <div class="screen d-flex flex-column">
      ${renderTopbar('Past matches', { right: state.loadingHistory ? '<span class="spinner-border spinner-border-sm text-light"></span>' : '' })}
      <div class="px-3 py-2 border-bottom bg-body overflow-auto">
        <div class="btn-group btn-group-sm flex-nowrap w-100" role="group">
          ${HISTORY_FILTERS.map(f => `
            <button type="button" class="btn ${filter === f.id ? 'btn-dark' : 'btn-outline-secondary'} rounded-pill me-1" data-action="history-filter" data-filter="${f.id}">${esc(f.label)}</button>
          `).join('')}
          <label class="btn btn-outline-secondary rounded-pill mb-0 position-relative overflow-hidden">
            <i class="bi bi-calendar3 me-1"></i>${isCustom && customDate ? esc(fmtDateLabel(customDate)) : 'Date'}
            <input id="history-date-input" type="date" class="position-absolute top-0 start-0 w-100 h-100 opacity-0" value="${esc(customDate || '')}" max="${todayIso()}" />
          </label>
          ${isCustom ? `<button type="button" class="btn btn-outline-danger rounded-pill" data-action="history-filter" data-filter="all">×</button>` : ''}
        </div>
      </div>
      <div class="scroll flex-grow-1 overflow-auto px-3 py-3">
        ${filtered.length === 0 ? `
          <div class="text-center text-muted py-5">${completed.length === 0 ? 'No completed matches yet.' : 'No matches in this range.'}</div>
        ` : `
          <p class="small text-uppercase fw-bold text-muted mb-2">${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'}</p>
          ${filtered.map(matchCard).join('')}
        `}
      </div>
    </div>
  `;
}

function renderInProgress() {
  const items = state.history.filter(m => m.status !== 'completed')
    .sort((a, b) => b.startedAt - a.startedAt);
  return `
    <div class="screen d-flex flex-column">
      ${renderTopbar('In-progress', { right: state.loadingHistory ? '<span class="spinner-border spinner-border-sm text-light"></span>' : '' })}
      <div class="scroll flex-grow-1 overflow-auto px-3 py-3">
        ${items.length === 0 ? `
          <div class="text-center text-muted py-5">No matches in progress.</div>
        ` : `
          <p class="small text-uppercase fw-bold text-muted mb-2">${items.length} ${items.length === 1 ? 'match' : 'matches'}</p>
          ${items.map(inProgressCard).join('')}
        `}
      </div>
    </div>
  `;
}

function inProgressCard(m) {
  const scorer = canScore(m);
  const i1 = m.innings[0], i2 = m.innings[1];
  return `
    <div class="card border-0 shadow-sm mb-3 overflow-hidden">
      <button type="button" class="card-body w-100 text-start border-0 bg-transparent qc-match-card" data-action="view-detail" data-match-id="${esc(m.id)}">
        <div class="text-muted small text-uppercase fw-semibold mb-1">${fmtDate(m.startedAt)}</div>
        <div class="fw-bold mb-2">${esc(m.teams.A)} vs ${esc(m.teams.B)}</div>
        ${i1 ? `<div class="d-flex justify-content-between small text-secondary mb-1"><span>${esc(m.teams[i1.batting])}</span><span class="font-monospace">${i1.score.runs}/${i1.score.wickets}</span></div>` : ''}
        ${i2 ? `<div class="d-flex justify-content-between small text-secondary mb-2"><span>${esc(m.teams[i2.batting])}</span><span class="font-monospace">${i2.score.runs}/${i2.score.wickets}</span></div>` : ''}
        <span class="badge text-bg-success">In progress</span>
      </button>
      ${scorer
      ? `<button type="button" class="btn btn-warning w-100 rounded-0 fw-bold" data-action="resume-match" data-match-id="${esc(m.id)}"><i class="bi bi-play-fill me-2"></i>Resume</button>`
      : `<button type="button" class="btn btn-success w-100 rounded-0 fw-bold" data-action="take-scoring" data-match-id="${esc(m.id)}"><i class="bi bi-play-fill me-2"></i>Score this match</button>`}
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

  const isLive = m.status !== 'completed';
  const inn = m.innings[m.currentInnings];
  const hasActiveInnings = isLive && !!inn && !inn.ended;
  const defaultOpen = !isLive || !hasActiveInnings;
  const scorecardOpen = state.sharedScorecardOpen !== undefined ? state.sharedScorecardOpen : defaultOpen;

  return `
    <div class="screen result-screen">
      <div class="view-banner">${isLive ? 'Live · updates every 3s' : 'Shared scorecard · read-only'}</div>
      <div class="topbar">
        <div class="left">
          <span class="title">${esc(m.teams.A)} vs ${esc(m.teams.B)}</span>
        </div>
        <div class="right">
          <button class="icon-btn" data-action="back-home" title="Close">×</button>
        </div>
      </div>

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
  if (state.modal.type === 'abort') return renderAbortModal();
  if (state.modal.type === 'install') return renderInstallModal();
  if (state.modal.type === 'newBatter') {
    const inn = state.current.innings[state.current.currentInnings];
    return renderBsSheet('Next batter', 'A wicket fell. Pick a batter or add a new name.', `
      ${renderPlayerPicker({
        action: 'pick-new-batter',
        players: rosterForScoringPicker(inn, 'bat'),
        inn,
        mode: 'bat',
        blockOnField: true,
        inputId: 'new-batter-input',
        modalManual: state.modal.manual,
        selected: state.modal.pick,
      })}
    `, `${canUndoNow(state.current) && lastUndoKind(state.current) === 'pick'
      ? `<button type="button" class="btn btn-outline-secondary w-100 mb-2" data-action="undo">${esc(undoActionLabel(state.current))}</button>`
      : ''}<button type="button" class="btn btn-primary btn-lg w-100" data-action="confirm-new-batter">Continue</button>`);
  }
  if (state.modal.type === 'newBowler') {
    const inn = state.current.innings[state.current.currentInnings];
    return renderBsSheet('Next bowler', 'Over complete. Pick the next bowler.', `
      ${renderPlayerPicker({
        action: 'pick-new-bowler',
        players: rosterForScoringPicker(inn, 'bowl'),
        inn,
        mode: 'bowl',
        blockConsecutive: true,
        inputId: 'new-bowler-input',
        modalManual: state.modal.manual,
        selected: state.modal.pick,
      })}
    `, `${canUndoNow(state.current) && lastUndoKind(state.current) === 'pick'
      ? `<button type="button" class="btn btn-outline-secondary w-100 mb-2" data-action="undo">${esc(undoActionLabel(state.current))}</button>`
      : ''}<button type="button" class="btn btn-primary btn-lg w-100" data-action="confirm-new-bowler">Continue</button>`);
  }
  if (state.modal.type === 'editOverPin') {
    return renderBsSheet('Edit overs', 'Enter the PIN, then tap any ball in this over or the previous over to change it.', `
      <label class="form-label" for="edit-over-pin-input">PIN</label>
      <input id="edit-over-pin-input" class="form-control form-control-lg text-center font-monospace fw-bold pin-input" type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="····" autocomplete="off" enterkeyhint="done" />
    `, `
      <button type="button" class="btn btn-primary btn-lg w-100" data-action="confirm-edit-over-pin">Unlock ball edit</button>
      <button type="button" class="btn btn-link w-100" data-action="cancel-edit-over-pin">Cancel</button>
    `);
  }
  if (state.modal.type === 'editBall') {
    const inn = state.current.innings[state.current.currentInnings];
    const entry = inn.ballLog[state.modal.logIndex];
    const sel = state.modal.sel;
    const selCount = (sel.runs != null ? 1 : 0) + (sel.extra ? 1 : 0) + (sel.wicket ? 1 : 0);
    const canSave = selCount > 0;
    return renderBsSheet(
      `Edit ball · over ${entry.overNo + 1}`,
      `${esc(entry.batter)} · ${esc(entry.bowler)} · was ${esc(entry.label)}`,
      `
        <div class="edit-ball-picker">
          <div class="input-cluster edit-ball-cluster">
            <button type="button" class="wkt-btn ${sel.wicket ? 'selected' : ''}" data-action="edit-ball-wkt">WKT</button>
            <div class="extras-panel">
              <div class="heading">Extras</div>
              <div class="extras-btns">
                ${['wd', 'nb', 'lb', 'b'].map(e => `<button type="button" class="extra-btn ${sel.extra === e ? 'selected' : ''}" data-action="edit-ball-extra" data-extra="${e}">${e}</button>`).join('')}
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
  return '';
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
      if (state.modal?.type === 'newBatter' || state.modal?.type === 'newBowler') {
        state.modal = null;
      }
      render();
      break;
    case 'terms': state.view = 'terms'; render(); break;
    case 'admin-open':
      if (state.adminUnlocked) {
        state.view = 'admin';
        render();
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
      render();
      if (dbOn()) refreshHistory();
      break;
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
            if (r?.match) m = r.match;
          } catch { /* fall back to cached list row */ }
        }
        if (!m) { showToast('Match not found'); return; }
        if (!canScore(m)) { showToast('Cannot score this match'); return; }
        state.current = m;
        state.overEditUnlocked = false;
        state.freeUndosUsed = 0;
        persistMatch(m);
        state.detail = null;
        const pre = viewBeforeFirstInnings(m);
        if (pre) state.view = pre;
        else {
          const inn = m.innings[m.currentInnings];
          if (inn.ended && m.currentInnings === 0) state.view = 'innings-break';
          else state.view = 'score';
        }
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
        history.replaceState(null, '', location.pathname);
      } else {
        state.current = m;
        persistMatch(m);
      }
      const pre = viewBeforeFirstInnings(state.current);
      if (pre) state.view = pre;
      else {
        const inn = state.current.innings[state.current.currentInnings];
        if (inn.ended && state.current.currentInnings === 0) state.view = 'innings-break';
        else state.view = 'score';
      }
      render();
      showToast('You are now scoring');
      break;
    }
    case 'history-filter':
      state.historyFilter = dataset.filter;
      if (dataset.filter !== 'custom') state.historyDate = '';
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
        history.replaceState(null, '', location.pathname);
      }
      state.view = 'home'; state.detail = null; state.modal = null; render();
      if (dbOn()) refreshHistory();
      break;
    case 'new-match':
      state.view = 'setup';
      state.setup = { teamA: DEFAULT_TEAM_A, teamB: DEFAULT_TEAM_B, overs: DEFAULT_OVERS, battingFirst: 'A', skipTeamPick: false };
      render(); break;
    case 'players':
      state.view = 'players';
      state.playerDetail = null;
      render(); break;
    case 'players-tab':
      state.playersTab = dataset.tab || 'roster';
      render();
      break;
    case 'view-player': {
      const p = playerById(dataset.playerId);
      if (p) { state.playerDetail = p; state.view = 'player-detail'; render(); }
      break;
    }
    case 'delete-player': {
      const p = playerById(dataset.playerId);
      if (!p) break;
      state.modal = { type: 'deletePlayerPin', playerId: p.id };
      render();
      break;
    }
    case 'edit-player-name': {
      const p = playerById(dataset.playerId);
      if (!p) break;
      state.modal = { type: 'editPlayerName', playerId: p.id };
      render();
      break;
    }
    case 'cancel-delete-player-pin':
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
      const res = runAutoBalance({ A: [], B: [] });
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
      if (dbOn()) window.QCDB.deleteMatch(m.id).catch(() => { });
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
        if (dbOn()) window.QCDB.deleteMatch(m.id).catch(() => { });
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
        state.inningsManual[pickKey] = false;
        render();
        break;
      }
      if (action === 'pick-new-batter') {
        if (!state.modal || state.modal.type !== 'newBatter') break;
        state.modal.pick = { name: dataset.playerName, id: dataset.playerId || null };
        state.modal.manual = false;
        const input = $('new-batter-input');
        if (input) {
          input.value = dataset.playerName || '';
          input.dataset.playerId = dataset.playerId || '';
        }
        render();
      } else if (action === 'pick-new-bowler') {
        if (!state.modal || state.modal.type !== 'newBowler') break;
        state.modal.pick = { name: dataset.playerName, id: dataset.playerId || null };
        state.modal.manual = false;
        const input = $('new-bowler-input');
        if (input) {
          input.value = dataset.playerName || '';
          input.dataset.playerId = dataset.playerId || '';
        }
        render();
      }
      break;
    }
    case 'toggle-innings-manual': {
      const field = dataset.field;
      if (field && state.inningsManual[field] !== undefined) {
        state.inningsManual[field] = !state.inningsManual[field];
        render();
      }
      break;
    }
    case 'toggle-modal-manual':
      if (state.modal) {
        state.modal.manual = !state.modal.manual;
        render();
      }
      break;
    case 'resume': {
      const m = state.current;
      if (!m) { state.view = 'home'; render(); break; }
      state.overEditUnlocked = false;
      state.freeUndosUsed = 0;
      const pre = viewBeforeFirstInnings(m);
      if (pre) state.view = pre;
      else {
        const inn = m.innings[m.currentInnings];
        if (inn.ended && m.currentInnings === 0) state.view = 'innings-break';
        else state.view = 'score';
      }
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
      if (!inn || !isLogIndexEditable(inn, logIndex)) {
        showToast('That ball cannot be edited');
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
    case 'cancel-edit-ball':
      state.modal = null;
      render();
      break;
    case 'cancel-edit-over-pin':
      state.editOverIntent = null;
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
          showToast('Enter PIN via Edit over to undo earlier balls');
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

  state.current = dbOn() ? null : loadCurrent();
  state.history = dbOn() ? [] : loadHistory();
  state.players = dbOn() ? [] : loadPlayers();
  if (window.QCPlayers && !dbOn()) {
    state.players = window.QCPlayers.save(state.players, { localOnly: true });
  }
  if (state.current && !dbOn()) {
    state.history = [state.current, ...state.history.filter(x => x.id !== state.current.id)];
    saveHistory(state.history);
  }
  purgeStaleInProgress();
  state.view = 'home';
  render();

  if (dbOn()) {
    await refreshPlayers();
    render();
    refreshHistory();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !dbOn()) return;
    refreshPlayers().then(() => render()).catch(() => {});
    refreshHistory();
  });
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
      startMatch(a, b, state.setup.overs);
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
      if (sel.runs == null && !sel.extra && !sel.wicket) return showToast('Pick runs, an extra, or a wicket');
      if (!editBallAt(state.current, state.modal.logIndex, sel)) return showToast('Could not save ball');
      showToast('Ball updated');
      finishEditBall();
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
      render();
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
      const s = state.inningsPick.striker?.name || $('striker-input')?.value || '';
      const ns = state.inningsPick.nonStriker?.name || $('non-striker-input')?.value || '';
      const bw = state.inningsPick.bowler?.name || $('bowler-input')?.value || '';
      const sId = state.inningsPick.striker?.id || $('striker-input')?.dataset.playerId || null;
      const nsId = state.inningsPick.nonStriker?.id || $('non-striker-input')?.dataset.playerId || null;
      const bwId = state.inningsPick.bowler?.id || $('bowler-input')?.dataset.playerId || null;
      if (!s.trim() || !ns.trim() || !bw.trim()) return showToast('Pick both batters and a bowler');
      if (s.trim().toLowerCase() === ns.trim().toLowerCase()) return showToast('Striker and non-striker must differ');
      startInnings(s, ns, bw, sId, nsId, bwId);
      resetInningsPickers();
      render();
      return;
    }
    if (action === 'confirm-new-batter') {
      const inn = state.current.innings[state.current.currentInnings];
      const pick = state.modal?.pick;
      const v = pick?.name || $('new-batter-input')?.value || '';
      const pid = pick?.id || $('new-batter-input')?.dataset.playerId || null;
      if (!v.trim()) return showToast('Pick a batter or type a name');
      if (!addBatter(inn, v, pid)) return;
      persistMatch(state.current);
      state.modal = inn.needNewBowler ? { type: 'newBowler', manual: false, pick: null } : null;
      render();
      return;
    }
    if (action === 'confirm-new-bowler') {
      const pick = state.modal?.pick;
      const v = pick?.name || $('new-bowler-input')?.value || '';
      const pid = pick?.id || $('new-bowler-input')?.dataset.playerId || null;
      if (!v.trim()) return showToast('Pick a bowler or type a name');
      if (!addBowler(state.current.innings[state.current.currentInnings], v, pid)) return;
      persistMatch(state.current);
      state.modal = null;
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
    } else if (e.target.id === 'edit-player-pin-input') {
      e.preventDefault();
      app.querySelector('[data-action="confirm-edit-player-name"]')?.click();
    } else if (e.target.id === 'admin-pin-input') {
      e.preventDefault();
      app.querySelector('[data-action="confirm-admin-pin"]')?.click();
    } else if (e.target.id === 'admin-merge-pin') {
      e.preventDefault();
      app.querySelector('[data-action="admin-merge-run"]')?.click();
    } else if (e.target.id === 'new-player-input') {
      e.preventDefault();
      app.querySelector('[data-action="add-player"]')?.click();
    }
  });

  app.addEventListener('change', (e) => {
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
    if (e.target.id === 'admin-merge-source') {
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
      render();
    }
  });
});
