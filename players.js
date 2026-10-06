(function () {
  'use strict';

  const STORE = 'quickcric:players';
  const STORE_DELETED = 'quickcric:players-deleted-names';

  function cloudOn() {
    return !!(window.QCDB && window.QCDB.enabled);
  }

  function loadDeletedNames() {
    try {
      return new Set(JSON.parse(localStorage.getItem(STORE_DELETED) || '[]'));
    } catch {
      return new Set();
    }
  }

  function saveDeletedNames(names) {
    try {
      localStorage.setItem(STORE_DELETED, JSON.stringify([...names]));
    } catch { }
  }

  function setDeletedNames(names) {
    const normalized = [...new Set(names.map(normalizeName).filter(Boolean))];
    saveDeletedNames(normalized);
    return normalized;
  }

  function isDeletedName(name) {
    return loadDeletedNames().has(normalizeName(name));
  }

  function blockDeletedName(name) {
    const names = loadDeletedNames();
    const key = normalizeName(name);
    if (!key) return names;
    names.add(key);
    saveDeletedNames(names);
    if (window.QCDB?.enabled) {
      window.QCDB.upsertRosterMeta([...names]).catch(err =>
        console.warn('[QuickCric] roster meta sync failed:', err.message));
    }
    return names;
  }

  function unblockDeletedName(name) {
    const names = loadDeletedNames();
    names.delete(normalizeName(name));
    saveDeletedNames(names);
    if (window.QCDB?.enabled) {
      window.QCDB.upsertRosterMeta([...names]).catch(err =>
        console.warn('[QuickCric] roster meta sync failed:', err.message));
    }
  }

  function applyDeletedNames(deletedNames) {
    if (!Array.isArray(deletedNames)) return;
    setDeletedNames(deletedNames);
  }

  function filterDeleted(players) {
    const blocked = loadDeletedNames();
    if (!blocked.size) return players;
    return players.filter(p => !blocked.has(normalizeName(p.name)));
  }

  function emptyBatting() {
    return {
      matches: 0, innings: 0, notOuts: 0, runs: 0, balls: 0,
      highest: 0, fifties: 0, hundreds: 0, ducks: 0, fours: 0, sixes: 0,
      dots: 0, wins: 0, carried: 0, carriedWins: 0, teamRuns: 0,
      positions: {},
    };
  }

  function emptyBowling() {
    return {
      matches: 0, innings: 0, balls: 0, runs: 0, wickets: 0,
      bestWickets: 0, bestRuns: null, threeWickets: 0, fiveWickets: 0,
      deliveries: 0, extras: 0, wides: 0, noBalls: 0, dots: 0,
      wins: 0, stoodUp: 0, stoodUpWins: 0,
      overSlots: {},
    };
  }

  function battingView(s) {
    const base = emptyBatting();
    const src = s || {};
    return Object.assign(base, src, {
      positions: src.positions && typeof src.positions === 'object' ? src.positions : {},
    });
  }

  function bowlingView(s) {
    const base = emptyBowling();
    const src = s || {};
    return Object.assign(base, src, {
      overSlots: src.overSlots && typeof src.overSlots === 'object' ? src.overSlots : {},
    });
  }

  function newPlayer(name) {
    const n = (name || '').trim();
    const now = Date.now();
    return {
      id: 'p_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      name: n || 'Player',
      createdAt: now,
      updatedAt: now,
      batting: emptyBatting(),
      bowling: emptyBowling(),
    };
  }

  function normalizeName(name) {
    return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function mergeCountMap(a, b, fields) {
    const out = {};
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const key of keys) {
      const x = (a && a[key]) || {};
      const y = (b && b[key]) || {};
      const row = {};
      for (const f of fields) row[f] = (x[f] || 0) + (y[f] || 0);
      out[key] = row;
    }
    return out;
  }

  function mergeBatting(a, b) {
    const A = battingView(a);
    const B = battingView(b);
    return {
      matches: A.matches + B.matches,
      innings: A.innings + B.innings,
      notOuts: A.notOuts + B.notOuts,
      runs: A.runs + B.runs,
      balls: A.balls + B.balls,
      highest: Math.max(A.highest, B.highest),
      fifties: A.fifties + B.fifties,
      hundreds: A.hundreds + B.hundreds,
      ducks: A.ducks + B.ducks,
      fours: A.fours + B.fours,
      sixes: A.sixes + B.sixes,
      dots: A.dots + B.dots,
      wins: A.wins + B.wins,
      carried: A.carried + B.carried,
      carriedWins: A.carriedWins + B.carriedWins,
      teamRuns: A.teamRuns + B.teamRuns,
      positions: mergeCountMap(A.positions, B.positions, ['inns', 'runs', 'outs', 'balls', 'dots']),
    };
  }

  function mergeBowling(a, b) {
    const A = bowlingView(a);
    const B = bowlingView(b);
    const best = (!B.bestWickets || B.bestWickets < A.bestWickets ||
      (B.bestWickets === A.bestWickets && (B.bestRuns ?? 999) > (A.bestRuns ?? 999)))
      ? A : B;
    return {
      matches: A.matches + B.matches,
      innings: A.innings + B.innings,
      balls: A.balls + B.balls,
      runs: A.runs + B.runs,
      wickets: A.wickets + B.wickets,
      bestWickets: best.bestWickets,
      bestRuns: best.bestRuns,
      threeWickets: A.threeWickets + B.threeWickets,
      fiveWickets: A.fiveWickets + B.fiveWickets,
      deliveries: A.deliveries + B.deliveries,
      extras: A.extras + B.extras,
      wides: A.wides + B.wides,
      noBalls: A.noBalls + B.noBalls,
      dots: A.dots + B.dots,
      wins: A.wins + B.wins,
      stoodUp: A.stoodUp + B.stoodUp,
      stoodUpWins: A.stoodUpWins + B.stoodUpWins,
      overSlots: mergeCountMap(A.overSlots, B.overSlots, ['balls', 'runs', 'wickets']),
    };
  }

  function playerActivity(p) {
    return (p.batting?.runs || 0) + (p.bowling?.wickets || 0) * 25 +
      (p.batting?.matches || 0) + (p.bowling?.matches || 0);
  }

  function pickCanonicalPlayer(group) {
    return group.slice().sort((a, b) => {
      const act = playerActivity(b) - playerActivity(a);
      if (act) return act;
      const ts = (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
      if (ts) return ts;
      return (a.createdAt || 0) - (b.createdAt || 0);
    })[0];
  }

  function dedupeByName(players) {
    const groups = new Map();
    for (const p of players) {
      const key = normalizeName(p.name);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const kept = [];
    const removedIds = [];
    for (const group of groups.values()) {
      if (group.length === 1) {
        kept.push(group[0]);
        continue;
      }
      const winner = pickCanonicalPlayer(group);
      const merged = {
        ...winner,
        name: winner.name.trim().replace(/\s+/g, ' '),
        batting: emptyBatting(),
        bowling: emptyBowling(),
      };
      for (const p of group) {
        merged.batting = mergeBatting(merged.batting, p.batting || emptyBatting());
        merged.bowling = mergeBowling(merged.bowling, p.bowling || emptyBowling());
        if (p.id !== winner.id) removedIds.push(p.id);
      }
      touch(merged);
      kept.push(merged);
    }
    kept.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return { players: kept, removedIds };
  }

  function load() {
    if (cloudOn()) return [];
    try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; }
  }

  function save(players, opts) {
    const localOnly = !!(opts && opts.localOnly);
    const cleaned = filterDeleted(players);
    const { players: deduped, removedIds } = dedupeByName(cleaned);
    if (!cloudOn()) {
      try { localStorage.setItem(STORE, JSON.stringify(deduped)); } catch { }
    }
    if (!localOnly && cloudOn()) {
      removedIds.forEach(id => {
        window.QCDB.deletePlayer(id).catch(err => console.warn('[QuickCric] player delete failed:', err.message));
      });
      window.QCDB.syncPlayers(deduped);
    }
    return deduped;
  }

  /** Supabase roster is canonical when cloud is on — replaces in-memory state, no local merge. */
  function applyRemoteBundle(bundle) {
    const remote = Array.isArray(bundle) ? bundle : (bundle?.players || []);
    const deletedNames = Array.isArray(bundle) ? null : bundle?.deletedNames;
    if (Array.isArray(deletedNames)) applyDeletedNames(deletedNames);
    const { players: deduped, removedIds } = dedupeByName(filterDeleted(remote));
    if (cloudOn()) {
      try {
        localStorage.removeItem(STORE);
      } catch { }
      removedIds.forEach(id => {
        window.QCDB.deletePlayer(id).catch(err => console.warn('[QuickCric] player delete failed:', err.message));
      });
      if (removedIds.length || deduped.length !== remote.length) {
        window.QCDB.syncPlayers(deduped);
      }
    } else {
      try { localStorage.setItem(STORE, JSON.stringify(deduped)); } catch { }
    }
    return deduped;
  }

  function merge(local, remote) {
    if (cloudOn()) return applyRemoteBundle({ players: remote, deletedNames: null });
    const map = new Map();
    for (const p of filterDeleted(remote)) map.set(p.id, p);
    for (const p of filterDeleted(local)) {
      const ex = map.get(p.id);
      const pTs = p.updatedAt || p.createdAt || 0;
      const exTs = ex ? (ex.updatedAt || ex.createdAt || 0) : -1;
      if (!ex || pTs >= exTs) map.set(p.id, p);
    }
    return dedupeByName(Array.from(map.values())).players;
  }

  function touch(p) {
    p.updatedAt = Date.now();
  }

  function findById(players, id) {
    return players.find(p => p.id === id) || null;
  }

  function findByName(players, name) {
    const n = normalizeName(name);
    if (!n) return null;
    return players.find(p => normalizeName(p.name) === n) || null;
  }

  function add(players, name) {
    const trimmed = (name || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) return { players, player: null, error: 'Name required' };
    if (isDeletedName(trimmed)) {
      return { players, player: null, error: 'This player was removed from the roster' };
    }
    const list = dedupeByName(filterDeleted(players)).players;
    if (findByName(list, trimmed)) return { players: list, player: null, error: 'Player already exists' };
    const player = newPlayer(trimmed);
    const saved = save([player, ...list]);
    return { players: saved, player: findById(saved, player.id) || player, error: null };
  }

  function remove(players, id) {
    const removed = findById(players, id);
    const next = players.filter(p => p.id !== id);
    if (removed) blockDeletedName(removed.name);
    const saved = save(next);
    if (window.QCDB?.enabled) {
      window.QCDB.deletePlayer(id).catch(err => console.warn('[QuickCric] player delete failed:', err.message));
    }
    return saved;
  }

  function rename(players, id, newName) {
    const trimmed = (newName || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) return { players, player: null, error: 'Name required' };
    const list = dedupeByName(filterDeleted(players)).players;
    const target = findById(list, id);
    if (!target) return { players: list, player: null, error: 'Player not found' };
    if (normalizeName(trimmed) === normalizeName(target.name)) {
      return { players: list, player: target, error: null };
    }
    if (isDeletedName(trimmed)) {
      return { players: list, player: null, error: 'This name was removed from the roster' };
    }
    const conflict = findByName(list, trimmed);
    if (conflict && conflict.id !== id) {
      return { players: list, player: null, error: 'Another player already uses this name' };
    }
    target.name = trimmed;
    touch(target);
    const saved = save(list);
    return { players: saved, player: findById(saved, id), error: null };
  }

  function sharePct(part, total) {
    if (!total) return '—';
    return `${Math.round((part / total) * 100)}%`;
  }

  function winRate(wins, n) {
    if (!n) return '—';
    return `${wins}/${n} · ${Math.round((wins / n) * 100)}%`;
  }

  function dotPct(dots, balls) {
    if (!balls) return '—';
    return `${Math.round((dots / balls) * 100)}%`;
  }

  /** Runs per dismissal. Only innings they actually batted count; not-outs are not in the divisor. */
  function batAvg(s) {
    const dismissals = s.innings - s.notOuts;
    if (!dismissals) return s.runs > 0 ? s.runs.toFixed(2) : '—';
    return (s.runs / dismissals).toFixed(2);
  }

  function batSR(s) {
    if (!s.balls) return '—';
    return ((s.runs / s.balls) * 100).toFixed(1);
  }

  function bowlAvg(s) {
    if (!s.wickets) return '—';
    return (s.runs / s.wickets).toFixed(2);
  }

  function bowlEcon(s) {
    if (!s.balls) return '—';
    return ((s.runs / s.balls) * 6).toFixed(2);
  }

  function bowlSR(s) {
    if (!s.wickets) return '—';
    return (s.balls / s.wickets).toFixed(1);
  }

  function fmtOvers(balls) {
    return `${Math.floor(balls / 6)}.${balls % 6}`;
  }

  function bestBattingPosition(s) {
    const pos = battingView(s).positions || {};
    let best = null;
    for (const [key, v] of Object.entries(pos)) {
      if (!v?.inns) continue;
      const avg = v.outs ? v.runs / v.outs : v.runs;
      if (!best || avg > best.avg || (avg === best.avg && v.runs > best.runs)) {
        best = { pos: key, avg, runs: v.runs, inns: v.inns, outs: v.outs };
      }
    }
    if (!best) return null;
    const avgTxt = best.outs ? (best.runs / best.outs).toFixed(1) : `${best.runs}*`;
    return { pos: String(best.pos), runs: best.runs, avg: avgTxt, inns: best.inns };
  }

  function bestBowlingOver(s) {
    const slots = bowlingView(s).overSlots || {};
    let best = null;
    for (const [key, v] of Object.entries(slots)) {
      if ((v?.balls || 0) < 6) continue;
      const econ = (v.runs / v.balls) * 6;
      const score = (v.wickets || 0) * 1000 - econ;
      if (!best || score > best.score) best = { pos: key, econ, score, ...v };
    }
    if (!best) return null;
    return {
      over: String(best.pos),
      wickets: best.wickets || 0,
      runs: best.runs || 0,
      econ: best.econ.toFixed(2),
    };
  }

  function winningSide(match) {
    const res = match?.result || '';
    if (!res || res === 'Match tied' || res === 'Match ended early') return null;
    const sides = ['A', 'B']
      .map(side => ({ side, name: match.teams?.[side] || '' }))
      .filter(x => x.name)
      .sort((a, b) => b.name.length - a.name.length);
    for (const { side, name } of sides) {
      if (res.startsWith(`${name} won`)) return side;
    }
    return null;
  }

  function nameHit(lineName, name) {
    return (lineName || '').trim().toLowerCase() === (name || '').trim().toLowerCase();
  }

  function battingDotsFromLog(inn, name) {
    if (!inn?.ballLog?.length) return 0;
    let dots = 0;
    for (const ball of inn.ballLog) {
      if (!nameHit(ball.batter, name) || !ball.legal) continue;
      const batRuns = (ball.extra === 'lb' || ball.extra === 'b') ? 0 : (Number(ball.runs) || 0);
      if (batRuns === 0 && !ball.wicket && !ball.runOut) dots += 1;
    }
    return dots;
  }

  function bowlingFromLog(inn, name) {
    const empty = {
      bowled: false, runs: 0, balls: 0, wickets: 0,
      deliveries: 0, extras: 0, wides: 0, noBalls: 0, dots: 0, slots: {},
    };
    if (!inn?.ballLog?.length) return empty;
    const out = empty;
    for (const ball of inn.ballLog) {
      if (!nameHit(ball.bowler, name)) continue;
      out.bowled = true;
      out.deliveries += 1;
      const slotNo = String((ball.overNo || 0) + 1);
      if (!out.slots[slotNo]) out.slots[slotNo] = { balls: 0, runs: 0, wickets: 0 };
      const dRuns = Number(ball.runs) || 0;
      let conceded = dRuns;
      if (ball.extra === 'wd') {
        out.wides += 1;
        conceded = 1 + dRuns;
        out.extras += conceded;
      } else if (ball.extra === 'nb') {
        out.noBalls += 1;
        conceded = 1 + dRuns;
        out.extras += 1;
      } else if (ball.extra === 'lb' || ball.extra === 'b') {
        conceded = 0;
      }
      out.runs += conceded;
      out.slots[slotNo].runs += conceded;
      if (ball.legal) {
        out.balls += 1;
        out.slots[slotNo].balls += 1;
        if (dRuns === 0 && !ball.wicket && !ball.runOut && ball.extra !== 'lb' && ball.extra !== 'b') {
          out.dots += 1;
        }
      }
      if (ball.wicket && !ball.runOut) {
        out.wickets += 1;
        out.slots[slotNo].wickets += 1;
      }
    }
    return out;
  }

  function addOverSlots(target, slots) {
    if (!target.overSlots) target.overSlots = {};
    for (const [key, v] of Object.entries(slots || {})) {
      if (!target.overSlots[key]) target.overSlots[key] = { balls: 0, runs: 0, wickets: 0 };
      const slot = target.overSlots[key];
      slot.balls += v.balls || 0;
      slot.runs += v.runs || 0;
      slot.wickets += v.wickets || 0;
    }
  }

  function battingRankings(players) {
    return [...players]
      .filter(p => (p.batting?.innings || 0) > 0 || (p.batting?.runs || 0) > 0)
      .sort((a, b) => {
        const runsA = a.batting.runs || 0;
        const runsB = b.batting.runs || 0;
        if (runsB !== runsA) return runsB - runsA;
        const avgA = parseFloat(batAvg(a.batting)) || 0;
        const avgB = parseFloat(batAvg(b.batting)) || 0;
        if (avgB !== avgA) return avgB - avgA;
        return (parseFloat(batSR(b.batting)) || 0) - (parseFloat(batSR(a.batting)) || 0);
      });
  }

  function bowlingRankings(players) {
    return [...players]
      .filter(p => (p.bowling?.wickets || 0) > 0 || (p.bowling?.balls || 0) > 0)
      .sort((a, b) => {
        const wA = a.bowling.wickets || 0;
        const wB = b.bowling.wickets || 0;
        if (wB !== wA) return wB - wA;
        const avgA = parseFloat(bowlAvg(a.bowling));
        const avgB = parseFloat(bowlAvg(b.bowling));
        if (!Number.isNaN(avgA) && !Number.isNaN(avgB) && avgA !== avgB) return avgA - avgB;
        const ecA = parseFloat(bowlEcon(a.bowling));
        const ecB = parseFloat(bowlEcon(b.bowling));
        if (!Number.isNaN(ecA) && !Number.isNaN(ecB) && ecA !== ecB) return ecA - ecB;
        return (b.bowling.balls || 0) - (a.bowling.balls || 0);
      });
  }

  function normalizeScoreList(values) {
    const max = Math.max(...values, 0.001);
    return values.map(v => (v / max) * 100);
  }

  function rawBatSkill(p, poolAvgSR) {
    const bat = p.batting || emptyBatting();
    const inn = bat.innings || 0;
    if (!inn) return 0;
    const rpi = (bat.runs || 0) / inn;
    const sr = bat.balls ? ((bat.runs || 0) / bat.balls) * 100 : 0;
    const srMod = poolAvgSR > 0 ? (0.7 + 0.3 * (sr / poolAvgSR)) : 1;
    return rpi * srMod;
  }

  function rawBowlSkill(p, poolAvgEcon) {
    const bowl = p.bowling || emptyBowling();
    const inn = bowl.innings || 0;
    const balls = bowl.balls || 0;
    if (!balls && !inn) return 0;
    const wpi = inn ? (bowl.wickets || 0) / inn : 0;
    if (wpi > 0) {
      const econ = balls ? ((bowl.runs || 0) / balls) * 6 : poolAvgEcon || 8;
      const econMod = econ > 0 && poolAvgEcon > 0 ? (0.7 + 0.3 * (poolAvgEcon / econ)) : 1;
      return wpi * econMod;
    }
    return (balls / 6) * 0.5;
  }

  function classifyPlayerRole(batN, bowlN) {
    const minSig = 12;
    const close = 0.65;
    if (batN < minSig && bowlN < minSig) return 'unknown';
    if (batN >= minSig && bowlN >= minSig) {
      const ratio = Math.min(batN, bowlN) / Math.max(batN, bowlN);
      if (ratio >= close) return 'allrounder';
    }
    if (bowlN > batN * 1.15) return 'bowler';
    if (batN > bowlN * 1.15) return 'batsman';
    if (batN >= minSig && bowlN >= minSig) return 'allrounder';
    if (bowlN >= minSig) return 'bowler';
    if (batN >= minSig) return 'batsman';
    return 'unknown';
  }

  /** Per-player normalized skills and role for team balancing. */
  function teamBalanceScores(players) {
    if (!players?.length) return [];
    let sumSR = 0;
    let countSR = 0;
    let sumEcon = 0;
    let countEcon = 0;
    for (const p of players) {
      const bat = p.batting || emptyBatting();
      const bowl = p.bowling || emptyBowling();
      if (bat.balls) {
        sumSR += ((bat.runs || 0) / bat.balls) * 100;
        countSR += 1;
      }
      if (bowl.balls) {
        sumEcon += ((bowl.runs || 0) / bowl.balls) * 6;
        countEcon += 1;
      }
    }
    const poolAvgSR = countSR ? sumSR / countSR : 100;
    const poolAvgEcon = countEcon ? sumEcon / countEcon : 8;

    const rawBat = players.map(p => rawBatSkill(p, poolAvgSR));
    const rawBowl = players.map(p => rawBowlSkill(p, poolAvgEcon));
    const batN = normalizeScoreList(rawBat);
    const bowlN = normalizeScoreList(rawBowl);

    return players.map((p, i) => {
      const role = classifyPlayerRole(batN[i], bowlN[i]);
      let rating = 0;
      if (role === 'batsman') rating = batN[i];
      else if (role === 'bowler') rating = bowlN[i];
      else if (role === 'allrounder') rating = batN[i] * 0.5 + bowlN[i] * 0.5;
      else rating = Math.max(batN[i], bowlN[i]) * 0.25;
      return { id: p.id, batScore: batN[i], bowlScore: bowlN[i], role, rating };
    });
  }

  function squadRatingTotals(squads, scoreMap) {
    const sum = (ids) => ids.reduce((t, id) => t + (scoreMap.get(id)?.rating || 0), 0);
    return { A: sum(squads.A), B: sum(squads.B) };
  }

  function squadSkillTotals(squads, scoreMap, skillKey) {
    const sum = (ids) => ids.reduce((t, id) => {
      const s = scoreMap.get(id);
      if (!s) return t;
      if (skillKey === 'batScore') return t + (s.batScore || 0);
      if (skillKey === 'bowlScore') return t + (s.bowlScore || 0);
      return t + (s.rating || 0);
    }, 0);
    return { A: sum(squads.A), B: sum(squads.B) };
  }

  function skillValue(item, skillKey) {
    if (skillKey === 'batScore') return item.batScore || 0;
    if (skillKey === 'bowlScore') return item.bowlScore || 0;
    return item.rating || 0;
  }

  function swapSquadPlayers(squads, idA, idB) {
    squads.A = squads.A.map(id => (id === idA ? idB : id));
    squads.B = squads.B.map(id => (id === idB ? idA : id));
  }

  /** Swap players across teams if it evens a skill total without breaking squad sizes. */
  function improveSkillBalance(squads, scoreMap, skillKey) {
    for (let pass = 0; pass < 8; pass++) {
      const totals = squadSkillTotals(squads, scoreMap, skillKey);
      const diff = totals.A - totals.B;
      if (Math.abs(diff) < 8) break;
      let best = null;
      let bestImprovement = 0;
      for (const idA of squads.A) {
        for (const idB of squads.B) {
          const a = scoreMap.get(idA);
          const b = scoreMap.get(idB);
          if (!a || !b) continue;
          const va = skillValue(a, skillKey);
          const vb = skillValue(b, skillKey);
          const newDiff = (totals.A - va + vb) - (totals.B - vb + va);
          const improvement = Math.abs(diff) - Math.abs(newDiff);
          if (improvement > bestImprovement + 0.5) {
            bestImprovement = improvement;
            best = { idA, idB };
          }
        }
      }
      if (!best) break;
      swapSquadPlayers(squads, best.idA, best.idB);
    }
  }

  function roleImbalanceScore(squads, scoreMap) {
    let score = 0;
    for (const role of ['batsman', 'bowler', 'allrounder']) {
      const a = squads.A.filter(id => scoreMap.get(id)?.role === role).length;
      const b = squads.B.filter(id => scoreMap.get(id)?.role === role).length;
      score += Math.max(0, Math.abs(a - b) - 1);
    }
    return score;
  }

  /** Prefer swaps that even role counts without blowing up overall rating gap. */
  function improveRoleBalance(squads, scoreMap) {
    for (let pass = 0; pass < 10; pass++) {
      const beforeRoles = roleImbalanceScore(squads, scoreMap);
      if (beforeRoles === 0) break;
      const rating = squadRatingTotals(squads, scoreMap);
      const ratingGap = Math.abs(rating.A - rating.B);
      let best = null;
      let bestScore = Infinity;
      for (const idA of squads.A) {
        for (const idB of squads.B) {
          const a = scoreMap.get(idA);
          const b = scoreMap.get(idB);
          if (!a || !b || a.role === b.role) continue;
          const nextA = squads.A.map(id => (id === idA ? idB : id));
          const nextB = squads.B.map(id => (id === idB ? idA : id));
          const nextSquads = { A: nextA, B: nextB };
          const roles = roleImbalanceScore(nextSquads, scoreMap);
          if (roles >= beforeRoles) continue;
          const nextRating = squadRatingTotals(nextSquads, scoreMap);
          const nextGap = Math.abs(nextRating.A - nextRating.B);
          if (nextGap > ratingGap + 18) continue;
          const score = roles * 1000 + nextGap;
          if (score < bestScore) {
            bestScore = score;
            best = { idA, idB };
          }
        }
      }
      if (!best) break;
      swapSquadPlayers(squads, best.idA, best.idB);
    }
  }

  function balanceCost(squads, scoreMap) {
    const gap = (totals) => Math.abs(totals.A - totals.B);
    return gap(squadSkillTotals(squads, scoreMap, 'batScore'))
      + gap(squadSkillTotals(squads, scoreMap, 'bowlScore'))
      + gap(squadRatingTotals(squads, scoreMap)) * 0.75
      + roleImbalanceScore(squads, scoreMap) * 40;
  }

  /** Jointly tighten batting, bowling, rating, and role gaps via swaps. */
  function improveCombinedBalance(squads, scoreMap) {
    for (let pass = 0; pass < 12; pass++) {
      const current = balanceCost(squads, scoreMap);
      let best = null;
      let bestCost = current;
      for (const idA of squads.A) {
        for (const idB of squads.B) {
          if (!scoreMap.get(idA) || !scoreMap.get(idB)) continue;
          const nextSquads = {
            A: squads.A.map(id => (id === idA ? idB : id)),
            B: squads.B.map(id => (id === idB ? idA : id)),
          };
          const nextCost = balanceCost(nextSquads, scoreMap);
          if (nextCost < bestCost - 0.75) {
            bestCost = nextCost;
            best = { idA, idB };
          }
        }
      }
      if (!best) break;
      swapSquadPlayers(squads, best.idA, best.idB);
    }
  }

  function squadCountsWithinOne(countA, countB) {
    return Math.abs(countA - countB) <= 1;
  }

  function canAddToSquadSide(side, squads) {
    const a = squads.A.length + (side === 'A' ? 1 : 0);
    const b = squads.B.length + (side === 'B' ? 1 : 0);
    return squadCountsWithinOne(a, b);
  }

  function sideForNextPick(squads, scoreMap) {
    let options = ['A', 'B'].filter(s => canAddToSquadSide(s, squads));
    if (!options.length) {
      rebalanceSquadsBySize(squads, scoreMap);
      options = ['A', 'B'].filter(s => canAddToSquadSide(s, squads));
    }
    if (!options.length) {
      return squads.A.length <= squads.B.length ? 'A' : 'B';
    }
    if (options.length === 1) return options[0];
    const totals = squadRatingTotals(squads, scoreMap);
    const weaker = weakerSquadSide(totals);
    return options.includes(weaker) ? weaker : options[0];
  }

  function dedupeSquads(squads) {
    squads.A = [...new Set(squads.A || [])];
    squads.B = [...new Set(squads.B || [])];
    squads.B = squads.B.filter(id => !squads.A.includes(id));
  }

  /** Keep squad sizes within one; fix duplicates and stuck imbalances. */
  function normalizeSquadSizes(players, squads) {
    const scoreMap = new Map(teamBalanceScores(players || []).map(s => [s.id, s]));
    dedupeSquads(squads);
    rebalanceSquadsBySize(squads, scoreMap);
    if (squadCountsWithinOne(squads.A.length, squads.B.length)) return squads;

    const ids = [...squads.A, ...squads.B];
    squads.A = [];
    squads.B = [];
    const items = ids.map(id => scoreMap.get(id) || { id, rating: 0, batScore: 0, bowlScore: 0, role: 'unknown' });
    draftBalanced(items, squads, scoreMap, 'rating');
    rebalanceSquadsBySize(squads, scoreMap);
    return squads;
  }

  function rebalanceSquadsBySize(squads, scoreMap) {
    for (;;) {
      const diff = squads.A.length - squads.B.length;
      if (Math.abs(diff) <= 1) break;
      const from = diff > 0 ? 'A' : 'B';
      const to = from === 'A' ? 'B' : 'A';
      const ids = squads[from];
      let pickIdx = 0;
      let minRating = Infinity;
      for (let i = 0; i < ids.length; i++) {
        const r = scoreMap.get(ids[i])?.rating || 0;
        if (r <= minRating) { minRating = r; pickIdx = i; }
      }
      const [id] = ids.splice(pickIdx, 1);
      squads[to].push(id);
    }
  }

  function weakerSquadSide(totals) {
    if (totals.A < totals.B) return 'A';
    if (totals.B < totals.A) return 'B';
    return Math.random() < 0.5 ? 'A' : 'B';
  }

  /**
   * Draft strongest-first onto the currently weaker/smaller side.
   * Jitter lets reshuffle produce different (still balanced) lineups.
   */
  function draftCategory(list, squads, scoreMap, skillKey = 'rating', jitterAmp = 0) {
    const decorated = list.map(item => ({
      item,
      key: skillValue(item, skillKey) + (jitterAmp ? (Math.random() - 0.5) * 2 * jitterAmp : 0),
    }));
    decorated.sort((a, b) => {
      const d = b.key - a.key;
      if (Math.abs(d) > 1e-9) return d;
      return Math.random() - 0.5;
    });
    for (const { item } of decorated) {
      const side = sideForNextPick(squads, scoreMap);
      squads[side].push(item.id);
    }
  }

  function draftBalanced(list, squads, scoreMap, skillKey = 'rating', jitterAmp = 0) {
    draftCategory(list, squads, scoreMap, skillKey, jitterAmp);
  }

  function finalizeSquadSummary(squads, scoreMap) {
    const countRole = (ids, role) =>
      ids.filter(id => scoreMap.get(id)?.role === role).length;
    return {
      totalA: squads.A.length,
      totalB: squads.B.length,
      batA: countRole(squads.A, 'batsman'),
      batB: countRole(squads.B, 'batsman'),
      bowlA: countRole(squads.A, 'bowler'),
      bowlB: countRole(squads.B, 'bowler'),
      arA: countRole(squads.A, 'allrounder'),
      arB: countRole(squads.B, 'allrounder'),
    };
  }

  function assignMissingPlayers(pool, squads, scoreMap) {
    const assigned = new Set([...squads.A, ...squads.B]);
    for (const p of pool) {
      if (!p?.id || assigned.has(p.id)) continue;
      const side = sideForNextPick(squads, scoreMap);
      squads[side].push(p.id);
      assigned.add(p.id);
    }
  }

  function draftUnlockedOntoSquads(pool, squads, scoreMap, jitterAmp) {
    const buckets = { bowler: [], batsman: [], allrounder: [], unknown: [] };
    for (const s of teamBalanceScores(pool)) {
      buckets[s.role]?.push(s);
    }
    draftCategory(buckets.bowler, squads, scoreMap, 'bowlScore', jitterAmp);
    draftCategory(buckets.batsman, squads, scoreMap, 'batScore', jitterAmp);
    draftBalanced(buckets.allrounder, squads, scoreMap, 'rating', jitterAmp);
    draftBalanced(buckets.unknown, squads, scoreMap, 'rating', jitterAmp);
    improveSkillBalance(squads, scoreMap, 'rating');
    improveSkillBalance(squads, scoreMap, 'batScore');
    improveSkillBalance(squads, scoreMap, 'bowlScore');
    improveRoleBalance(squads, scoreMap);
    improveCombinedBalance(squads, scoreMap);
    assignMissingPlayers(pool, squads, scoreMap);
  }

  function squadPartitionKey(squads) {
    const a = [...(squads?.A || [])].slice().sort().join(',');
    const b = [...(squads?.B || [])].slice().sort().join(',');
    return `${a}|${b}`;
  }

  /**
   * @param {object[]} players — pool to distribute (e.g. available today)
   * @param {{ existingSquads?: { A: string[], B: string[] }, reshuffle?: boolean, avoidKey?: string }} options
   */
  function balanceTeams(players, options = {}) {
    const existing = options.existingSquads || { A: [], B: [] };
    const allPlayers = players || [];
    const scoreMap = new Map(teamBalanceScores(allPlayers).map(s => [s.id, s]));
    const avoidKey = options.avoidKey || '';
    const attempts = options.reshuffle ? 8 : 1;
    const jitterAmp = options.reshuffle ? 28 : 0;

    const candidates = [];
    for (let i = 0; i < attempts; i++) {
      const squads = { A: [...existing.A], B: [...existing.B] };
      dedupeSquads(squads);
      rebalanceSquadsBySize(squads, scoreMap);
      const taken = new Set([...squads.A, ...squads.B]);
      const pool = allPlayers.filter(p => p && !taken.has(p.id));

      draftUnlockedOntoSquads(pool, squads, scoreMap, jitterAmp);
      normalizeSquadSizes(allPlayers, squads);
      assignMissingPlayers(pool, squads, scoreMap);
      rebalanceSquadsBySize(squads, scoreMap);

      if (options.reshuffle && Math.random() < 0.5) {
        const tmp = squads.A;
        squads.A = squads.B;
        squads.B = tmp;
      }

      candidates.push({
        squads,
        cost: balanceCost(squads, scoreMap),
        key: squadPartitionKey(squads),
      });
    }

    const minCost = Math.min(...candidates.map(c => c.cost));
    let good = candidates.filter(c => c.cost <= minCost + 30);
    if (avoidKey) {
      const fresh = good.filter(c => c.key !== avoidKey);
      if (fresh.length) good = fresh;
    }
    const pick = good[Math.floor(Math.random() * good.length)] || candidates[0];
    return { squads: pick.squads, summary: finalizeSquadSummary(pick.squads, scoreMap), error: null };
  }

  function formatBalanceSummary(summary, teamAName, teamBName) {
    const a = teamAName || 'A';
    const b = teamBName || 'B';
    return `${a} ${summary.totalA} · ${b} ${summary.totalB} · ${summary.bowlA}+${summary.bowlB} bowlers · ${summary.batA}+${summary.batB} batters`;
  }

  function matchBattingLine(innings, playerId, name) {
    let runs = 0, balls = 0, fours = 0, sixes = 0, out = false, faced = false;
    for (const inn of innings) {
      for (const b of inn.batters) {
        const match = playerId ? b.playerId === playerId : b.name.toLowerCase() === name.toLowerCase();
        if (!match) continue;
        faced = true;
        runs += b.runs;
        balls += b.balls;
        fours += b.fours;
        sixes += b.sixes;
        if (b.out && b.dismissal !== 'retired hurt') out = true;
      }
    }
    return { faced, runs, balls, fours, sixes, out };
  }

  function matchBowlingLine(innings, playerId, name) {
    const spells = {};
    for (const inn of innings) {
      for (const b of inn.bowlers) {
        const match = playerId ? b.playerId === playerId : b.name.toLowerCase() === name.toLowerCase();
        if (!match) continue;
        const key = playerId || b.name.toLowerCase();
        if (!spells[key]) spells[key] = { balls: 0, runs: 0, wickets: 0 };
        spells[key].balls += b.balls;
        spells[key].runs += b.runs;
        spells[key].wickets += b.wickets;
      }
    }
    const vals = Object.values(spells);
    if (!vals.length) return { bowled: false, balls: 0, runs: 0, wickets: 0 };
    return vals.reduce((a, s) => ({
      bowled: true,
      balls: a.balls + s.balls,
      runs: a.runs + s.runs,
      wickets: a.wickets + s.wickets,
    }), { bowled: false, balls: 0, runs: 0, wickets: 0 });
  }

  function cardIsPlayer(card, playerId, name) {
    if (!card) return false;
    if (playerId && card.playerId) return card.playerId === playerId;
    return nameHit(card.name, name);
  }

  /**
   * Player of the match is impact on this match, not the biggest raw total.
   *
   * Batting: the percent of that innings' runs they scored. At least six balls
   * faced, scoring clearly faster or slower than the innings nudges it.
   * Bowling: 18 points for each wicket. Another 12 if they took at least half
   * of the wickets that fell. At least one over: a few points for being tighter
   * or looser than that innings. A bowling score cannot go below zero.
   * The two add. The winning side then gets +8, and only if the performance
   * was already worth 20, so a quiet winner cannot jump a dominant one.
   */
  function matchPerformanceScore(match, playerId, name) {
    const innings = match?.innings || [];
    const bat = { faced: false, runs: 0, balls: 0, teamRuns: 0, teamBalls: 0 };
    const bowl = { bowled: false, runs: 0, balls: 0, wickets: 0, fell: 0, teamRuns: 0, teamBalls: 0 };

    for (const inn of innings) {
      const batter = (inn.batters || []).find(b => cardIsPlayer(b, playerId, name));
      if (batter) {
        bat.faced = true;
        bat.runs += Number(batter.runs) || 0;
        bat.balls += Number(batter.balls) || 0;
        bat.teamRuns += Number(inn.score?.runs) || 0;
        bat.teamBalls += Number(inn.score?.balls) || 0;
      }
      const bowler = (inn.bowlers || []).find(b => cardIsPlayer(b, playerId, name));
      if (bowler) {
        bowl.bowled = true;
        bowl.runs += Number(bowler.runs) || 0;
        bowl.balls += Number(bowler.balls) || 0;
        bowl.wickets += Number(bowler.wickets) || 0;
        bowl.fell += Number(inn.score?.wickets) || 0;
        bowl.teamRuns += Number(inn.score?.runs) || 0;
        bowl.teamBalls += Number(inn.score?.balls) || 0;
      }
    }

    let batImpact = 0;
    if (bat.faced && bat.teamRuns > 0) {
      batImpact = (bat.runs / bat.teamRuns) * 100;
      if (bat.balls >= 6 && bat.teamBalls >= 6) {
        const playerSr = (bat.runs / bat.balls) * 100;
        const innsSr = (bat.teamRuns / bat.teamBalls) * 100;
        batImpact += Math.max(-15, Math.min(15, (playerSr - innsSr) / 20));
      }
    }

    let bowlImpact = 0;
    if (bowl.bowled) {
      bowlImpact += bowl.wickets * 18;
      if (bowl.fell > 0 && bowl.wickets / bowl.fell >= 0.5) bowlImpact += 12;
      if (bowl.balls >= 6 && bowl.teamBalls >= 6) {
        const theirs = (bowl.runs / bowl.balls) * 6;
        const inns = (bowl.teamRuns / bowl.teamBalls) * 6;
        const overs = bowl.balls / 6;
        bowlImpact += Math.max(-12, Math.min(12, (inns - theirs) * overs));
      }
      bowlImpact = Math.max(0, bowlImpact);
    }

    let score = batImpact + bowlImpact;
    const side = playerTeamInMatch(match, playerId, name);
    const won = !!side && winningSide(match) === side;
    if (won && score >= 20) score += 8;

    return { score, summary: impactSummary(bat, bowl, batImpact, bowlImpact), bat, bowl };
  }

  function impactSummary(bat, bowl, batImpact, bowlImpact) {
    const runBit = bat.faced && bat.teamRuns > 0 ? `${bat.runs} of ${bat.teamRuns} runs` : '';
    const wktBit = bowl.bowled && bowl.wickets > 0 && bowl.fell > 0
      ? `${bowl.wickets} of ${bowl.fell} wickets`
      : '';
    const econ = bowl.balls >= 6 ? ((bowl.runs / bowl.balls) * 6).toFixed(1) : '';
    const both = batImpact >= 15 && bowlImpact >= 15 && Math.min(batImpact, bowlImpact) >= Math.max(batImpact, bowlImpact) * 0.5;
    let label = 'In the game';
    if (both) label = 'Runs and wickets';
    else if (batImpact >= bowlImpact && bat.teamRuns > 0 && bat.runs / bat.teamRuns >= 0.35) label = 'Carried the innings';
    else if (bowlImpact > batImpact && bowl.fell > 0 && bowl.wickets / bowl.fell >= 0.5) label = 'Broke the batting';
    else if (bowlImpact > batImpact && bowl.wickets === 0 && econ) label = 'Held an end';
    const bits = [];
    if (both || batImpact >= bowlImpact) {
      if (runBit) bits.push(runBit);
      if (wktBit) bits.push(wktBit);
    } else {
      if (wktBit) bits.push(wktBit);
      if (runBit && batImpact >= 15) bits.push(runBit);
    }
    if (!bits.length && econ) bits.push(`${econ} an over`);
    if (!bits.length) return label;
    return `${label} · ${bits.slice(0, 2).join(' · ')}`;
  }

  function playerTeamInMatch(match, playerId, name) {
    if (match.squads?.A?.includes(playerId)) return 'A';
    if (match.squads?.B?.includes(playerId)) return 'B';
    for (const inn of match.innings) {
      for (const b of inn.batters) {
        const hit = playerId ? b.playerId === playerId : b.name.toLowerCase() === name.toLowerCase();
        if (hit) return inn.batting;
      }
      for (const b of inn.bowlers) {
        const hit = playerId ? b.playerId === playerId : b.name.toLowerCase() === name.toLowerCase();
        if (hit) return inn.bowling;
      }
    }
    return null;
  }

  function computeAwards(match, players) {
    const seen = new Map();
    for (const inn of match.innings) {
      for (const b of inn.batters) {
        const id = b.playerId || findByName(players, b.name)?.id;
        if (!id) continue;
        if (!seen.has(id)) seen.set(id, findByName(players, b.name)?.name || b.name);
      }
      for (const b of inn.bowlers) {
        const id = b.playerId || findByName(players, b.name)?.id;
        if (!id) continue;
        if (!seen.has(id)) seen.set(id, findByName(players, b.name)?.name || b.name);
      }
    }

    const ranked = [];
    for (const [id, name] of seen) {
      const perf = matchPerformanceScore(match, id, name);
      if (perf.score <= 0 && !perf.bat.faced && !perf.bowl.bowled) continue;
      ranked.push({
        playerId: id,
        name,
        team: playerTeamInMatch(match, id, name),
        score: perf.score,
        summary: perf.summary || 'Played',
        bat: perf.bat,
        bowl: perf.bowl,
      });
    }
    ranked.sort((a, b) =>
      b.score - a.score || (b.bowl.wickets - a.bowl.wickets) || (b.bat.runs - a.bat.runs));

    const potm = ranked[0] || null;
    const mvpFor = (side) => ranked.find(r => r.team === side && r !== potm) || null;
    const mvpA = mvpFor('A');
    const mvpB = mvpFor('B');

    return { potm, mvpA, mvpB };
  }

  function applyMatchStatsToRoster(match, players) {
    if (match.status !== 'completed') return false;
    const winner = winningSide(match);
    let any = false;
    for (const p of players) {
      const bat = matchBattingLine(match.innings, p.id, p.name);
      const bowl = matchBowlingLine(match.innings, p.id, p.name);
      if (!bat.faced && !bowl.bowled) continue;

      any = true;
      p.batting = battingView(p.batting);
      p.bowling = bowlingView(p.bowling);
      touch(p);
      const side = playerTeamInMatch(match, p.id, p.name);
      const won = !!(side && winner && side === winner);

      if (bat.faced) {
        p.batting.matches += 1;
        p.batting.innings += 1;
        p.batting.runs += bat.runs;
        p.batting.balls += bat.balls;
        p.batting.fours += bat.fours;
        p.batting.sixes += bat.sixes;
        if (bat.runs > p.batting.highest) p.batting.highest = bat.runs;
        if (bat.runs >= 100) p.batting.hundreds += 1;
        else if (bat.runs >= 50) p.batting.fifties += 1;
        if (bat.out && bat.runs === 0) p.batting.ducks += 1;
        if (!bat.out) p.batting.notOuts += 1;
        if (won) p.batting.wins += 1;
      }

      if (bowl.bowled) {
        p.bowling.matches += 1;
        p.bowling.innings += 1;
        p.bowling.balls += bowl.balls;
        p.bowling.runs += bowl.runs;
        p.bowling.wickets += bowl.wickets;
        if (bowl.wickets > p.bowling.bestWickets ||
          (bowl.wickets === p.bowling.bestWickets && bowl.runs < (p.bowling.bestRuns ?? 999))) {
          p.bowling.bestWickets = bowl.wickets;
          p.bowling.bestRuns = bowl.runs;
        }
        if (bowl.wickets >= 5) p.bowling.fiveWickets += 1;
        else if (bowl.wickets >= 3) p.bowling.threeWickets += 1;
        if (won) p.bowling.wins += 1;
      }

      let carriedThisMatch = false;
      let stoodThisMatch = false;
      for (const inn of match.innings || []) {
        const batter = (inn.batters || []).find(b =>
          (p.id && b.playerId === p.id) || nameHit(b.name, p.name));
        if (batter) {
          const pos = String((inn.batters.indexOf(batter) || 0) + 1);
          if (!p.batting.positions[pos]) {
            p.batting.positions[pos] = { inns: 0, runs: 0, outs: 0, balls: 0, dots: 0 };
          }
          const dots = battingDotsFromLog(inn, batter.name);
          const slot = p.batting.positions[pos];
          slot.inns += 1;
          slot.runs += batter.runs || 0;
          slot.balls += batter.balls || 0;
          slot.dots += dots;
          const dismissed = !!(batter.out && batter.dismissal !== 'retired hurt');
          if (dismissed) slot.outs += 1;
          p.batting.dots += dots;
          p.batting.teamRuns += inn.score?.runs || 0;
          const rest = (inn.score?.runs || 0) - (batter.runs || 0);
          if ((batter.runs || 0) > 0 && (batter.runs || 0) > rest) {
            p.batting.carried += 1;
            carriedThisMatch = true;
          }
        }

        const card = (inn.bowlers || []).find(b =>
          (p.id && b.playerId === p.id) || nameHit(b.name, p.name));
        const spell = bowlingFromLog(inn, card?.name || p.name);
        if (spell.bowled) {
          p.bowling.deliveries += spell.deliveries;
          p.bowling.extras += spell.extras;
          p.bowling.wides += spell.wides;
          p.bowling.noBalls += spell.noBalls;
          p.bowling.dots += spell.dots;
          addOverSlots(p.bowling, spell.slots);
          const others = (inn.bowlers || [])
            .filter(b => b !== card)
            .reduce((sum, b) => sum + (b.wickets || 0), 0);
          const wkts = card ? (card.wickets || 0) : spell.wickets;
          if (wkts >= 1 && wkts >= others) {
            p.bowling.stoodUp += 1;
            stoodThisMatch = true;
          }
        } else if (card && (card.balls || card.runs || card.wickets)) {
          p.bowling.deliveries += card.balls || 0;
        }
      }
      if (carriedThisMatch && won) p.batting.carriedWins += 1;
      if (stoodThisMatch && won) p.bowling.stoodUpWins += 1;
    }
    return any;
  }

  function applyMatchStats(match, players) {
    const touched = applyMatchStatsToRoster(match, players);
    if (touched) return save(players);
    return players;
  }

  function resetCareerStats(p) {
    p.batting = emptyBatting();
    p.bowling = emptyBowling();
  }

  function lineIsSource(line, sourceId, sourceName) {
    if (!line) return false;
    if (sourceId && line.playerId === sourceId) return true;
    const sn = normalizeName(sourceName);
    if (!sn) return false;
    if (normalizeName(line.name) !== sn) return false;
    return !line.playerId || line.playerId === sourceId;
  }

  function snapLine(line) {
    return line ? { playerId: line.playerId || null, name: line.name || '' } : null;
  }

  function mappedIdentity(line, sourceId, sourceName, targetId, targetName, moved) {
    if (!line) return null;
    if (moved && lineIsSource(line, sourceId, sourceName)) return { playerId: targetId, name: targetName };
    return { playerId: line.playerId || null, name: line.name || '' };
  }

  function findLineIndex(list, ident) {
    if (!ident || !list?.length) return 0;
    if (ident.playerId) {
      const byId = list.findIndex(l => l.playerId === ident.playerId);
      if (byId >= 0) return byId;
    }
    const byName = list.findIndex(l => normalizeName(l.name) === normalizeName(ident.name));
    return byName >= 0 ? byName : 0;
  }

  /** Rename a role's cards, or fold them into the target's existing card in that innings. */
  function moveRoleList(list, sourceId, sourceName, targetId, targetName, sumKeys) {
    if (!Array.isArray(list)) return false;
    const sourceIdx = [];
    list.forEach((line, i) => {
      if (lineIsSource(line, sourceId, sourceName)) sourceIdx.push(i);
    });
    if (!sourceIdx.length) return false;
    const targetIdx = list.findIndex((line, i) =>
      !sourceIdx.includes(i) && ((targetId && line.playerId === targetId) ||
        normalizeName(line.name) === normalizeName(targetName)));
    if (targetIdx < 0) {
      for (const i of sourceIdx) {
        list[i].playerId = targetId;
        list[i].name = targetName;
      }
      return true;
    }
    const dest = list[targetIdx];
    for (const i of sourceIdx) {
      const src = list[i];
      for (const k of sumKeys) dest[k] = (Number(dest[k]) || 0) + (Number(src[k]) || 0);
      if (src.out) {
        dest.out = true;
        if (!dest.dismissal) dest.dismissal = src.dismissal || 'out';
      }
    }
    for (let n = sourceIdx.length - 1; n >= 0; n--) list.splice(sourceIdx[n], 1);
    return true;
  }

  function rewriteLogNames(inn, sourceName, targetName, scope) {
    let changed = false;
    for (const ball of inn.ballLog || []) {
      const hit = (field) => {
        if (normalizeName(ball[field]) !== normalizeName(sourceName)) return;
        ball[field] = targetName;
        changed = true;
      };
      if (scope !== 'bowl') {
        hit('batter');
        hit('strikerName');
        hit('nonStrikerName');
        hit('dismissed');
      }
      if (scope !== 'bat') hit('bowler');
    }
    return changed;
  }

  function rewritePlayerInMatch(match, sourceId, sourceName, targetId, targetName, scope) {
    if (!match) return false;
    const move = scope === 'bat' || scope === 'bowl' ? scope : 'both';
    let changed = false;

    if (move === 'both' && match.squads && sourceId) {
      for (const side of ['A', 'B']) {
        const arr = match.squads[side];
        if (!Array.isArray(arr)) continue;
        const next = arr.map(id => {
          if (id === sourceId) {
            changed = true;
            return targetId;
          }
          return id;
        });
        match.squads[side] = [...new Set(next)];
      }
    }

    for (const inn of match.innings || []) {
      const before = {
        striker: snapLine(inn.batters?.[inn.striker]),
        non: snapLine(inn.batters?.[inn.nonStriker]),
        bowler: snapLine(inn.bowlers?.[inn.currentBowler]),
      };
      if (move !== 'bowl' && moveRoleList(
        inn.batters, sourceId, sourceName, targetId, targetName,
        ['runs', 'balls', 'fours', 'sixes'],
      )) {
        changed = true;
        const striker = mappedIdentity(before.striker, sourceId, sourceName, targetId, targetName, true);
        const non = mappedIdentity(before.non, sourceId, sourceName, targetId, targetName, true);
        inn.striker = findLineIndex(inn.batters, striker);
        inn.nonStriker = findLineIndex(inn.batters, non);
        if ((inn.batters?.length || 0) > 1 && inn.striker === inn.nonStriker) {
          inn.nonStriker = inn.striker === 0 ? 1 : 0;
        }
      }
      if (move !== 'bat' && moveRoleList(
        inn.bowlers, sourceId, sourceName, targetId, targetName,
        ['balls', 'runs', 'wickets'],
      )) {
        changed = true;
        const bowler = mappedIdentity(before.bowler, sourceId, sourceName, targetId, targetName, true);
        inn.currentBowler = findLineIndex(inn.bowlers, bowler);
      }
      if (rewriteLogNames(inn, sourceName, targetName, move)) changed = true;
    }

    if (move === 'both' && match.awards) {
      for (const key of ['potm', 'mvpA', 'mvpB']) {
        const a = match.awards[key];
        if (!a) continue;
        if (a.playerId === sourceId || lineIsSource(a, sourceId, sourceName)) {
          a.playerId = targetId;
          a.name = targetName;
          changed = true;
        }
      }
    }
    return changed;
  }

  function cloneMatch(m) {
    return JSON.parse(JSON.stringify(m));
  }

  function rebuildAllStatsFromMatches(players, matches) {
    for (const p of players) resetCareerStats(p);
    const completed = matches
      .filter(m => m && m.status === 'completed')
      .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    for (const m of completed) applyMatchStatsToRoster(m, players);
    for (const p of players) touch(p);
    return save(players);
  }

  /** Players who batted and/or bowled in a match (for admin reassign UI). */
  function listMatchParticipants(match, players, scope) {
    const move = scope === 'bat' || scope === 'bowl' ? scope : 'both';
    const out = new Map();
    const add = (line) => {
      if (!line?.name) return;
      const id = line.playerId || findByName(players, line.name)?.id || null;
      const key = id || `n:${normalizeName(line.name)}`;
      if (!out.has(key)) out.set(key, { id, name: line.name.trim() });
    };
    for (const inn of match.innings || []) {
      if (move !== 'bowl') for (const b of inn.batters || []) add(b);
      if (move !== 'bat') for (const b of inn.bowlers || []) add(b);
    }
    return [...out.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  /**
   * Move one player's batting/bowling in a single match to another profile.
   * Both players stay on the roster; career stats are rebuilt from all completed matches.
   */
  function reassignPlayerInMatch(players, matchId, sourceId, sourceName, targetId, matches, scope) {
    const move = scope === 'bat' || scope === 'bowl' ? scope : 'both';
    if (!matchId) {
      return { players, matches, changedMatchIds: [], error: 'Pick a match' };
    }
    if (!targetId) {
      return { players, matches, changedMatchIds: [], error: 'Pick who actually played' };
    }
    if (sourceId && sourceId === targetId) {
      return { players, matches, changedMatchIds: [], error: 'Choose two different players' };
    }
    const target = findById(players, targetId);
    if (!target) {
      return { players, matches, changedMatchIds: [], error: 'Correct player not found' };
    }
    let resolvedSourceId = sourceId || null;
    let resolvedSourceName = (sourceName || '').trim();
    if (resolvedSourceId) {
      const source = findById(players, resolvedSourceId);
      if (!source) {
        return { players, matches, changedMatchIds: [], error: 'Wrong player not found' };
      }
      resolvedSourceName = source.name;
    } else if (!resolvedSourceName) {
      return { players, matches, changedMatchIds: [], error: 'Pick who was scored wrongly' };
    }
    if (normalizeName(resolvedSourceName) === normalizeName(target.name)) {
      return { players, matches, changedMatchIds: [], error: 'Choose two different players' };
    }

    const match = (matches || []).find(m => m?.id === matchId);
    if (!match) {
      return { players, matches, changedMatchIds: [], error: 'Match not found' };
    }

    const copy = cloneMatch(match);
    if (!rewritePlayerInMatch(
      copy,
      resolvedSourceId,
      resolvedSourceName,
      targetId,
      target.name,
      move,
    )) {
      const missing = move === 'bat'
        ? `${resolvedSourceName} did not bat in that match`
        : move === 'bowl'
          ? `${resolvedSourceName} did not bowl in that match`
          : `${resolvedSourceName} did not appear in that match`;
      return {
        players,
        matches,
        changedMatchIds: [],
        error: missing,
      };
    }

    if (copy.status === 'completed') {
      copy.awards = computeAwards(copy, players);
    }

    const updatedMatches = (matches || []).map(m => (m.id === matchId ? copy : m));
    const nextPlayers = rebuildAllStatsFromMatches(players, updatedMatches);

    return {
      players: nextPlayers,
      matches: updatedMatches,
      changedMatchIds: [matchId],
      error: null,
      targetName: target.name,
      sourceName: resolvedSourceName,
      scope: move,
      matchLabel: `${match.teams?.A || 'A'} vs ${match.teams?.B || 'B'}`,
    };
  }

  /**
   * Merge source into target: rewrite all matches, drop source, rebuild career stats from completed matches.
   */
  function mergePlayersInto(players, sourceId, targetId, matches) {
    if (!sourceId || !targetId) {
      return { players, matches, changedMatchIds: [], error: 'Pick both players' };
    }
    if (sourceId === targetId) {
      return { players, matches, changedMatchIds: [], error: 'Choose two different players' };
    }
    const source = findById(players, sourceId);
    const target = findById(players, targetId);
    if (!source || !target) {
      return { players, matches, changedMatchIds: [], error: 'Player not found' };
    }

    const changedMatchIds = [];
    const updatedMatches = (matches || []).map(m => {
      const copy = cloneMatch(m);
      if (rewritePlayerInMatch(copy, sourceId, source.name, targetId, target.name)) {
        changedMatchIds.push(copy.id);
      }
      return copy;
    });

    let nextPlayers = players.filter(p => p.id !== sourceId);
    nextPlayers = rebuildAllStatsFromMatches(nextPlayers, updatedMatches);

    if (cloudOn()) {
      window.QCDB.deletePlayer(sourceId).catch(err =>
        console.warn('[QuickCric] player delete failed:', err.message));
    }

    return {
      players: nextPlayers,
      matches: updatedMatches,
      changedMatchIds,
      error: null,
      targetName: target.name,
      sourceName: source.name,
    };
  }

  window.QCPlayers = {
    STORE,
    cloudOn,
    load,
    save,
    applyRemoteBundle,
    merge,
    dedupeByName,
    normalizeName,
    applyDeletedNames,
    isDeletedName,
    add,
    remove,
    rename,
    findById,
    findByName,
    newPlayer,
    batAvg,
    batSR,
    bowlAvg,
    bowlEcon,
    bowlSR,
    fmtOvers,
    sharePct,
    winRate,
    dotPct,
    bestBattingPosition,
    bestBowlingOver,
    battingView,
    bowlingView,
    battingRankings,
    bowlingRankings,
    teamBalanceScores,
    balanceTeams,
    normalizeSquadSizes,
    formatBalanceSummary,
    computeAwards,
    applyMatchStats,
    mergePlayersInto,
    reassignPlayerInMatch,
    listMatchParticipants,
    rebuildAllStatsFromMatches,
    matchPerformanceScore,
  };
})();
