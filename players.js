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
    };
  }

  function emptyBowling() {
    return {
      matches: 0, innings: 0, balls: 0, runs: 0, wickets: 0,
      bestWickets: 0, bestRuns: null, threeWickets: 0, fiveWickets: 0,
    };
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

  function mergeBatting(a, b) {
    return {
      matches: a.matches + b.matches,
      innings: a.innings + b.innings,
      notOuts: a.notOuts + b.notOuts,
      runs: a.runs + b.runs,
      balls: a.balls + b.balls,
      highest: Math.max(a.highest, b.highest),
      fifties: a.fifties + b.fifties,
      hundreds: a.hundreds + b.hundreds,
      ducks: a.ducks + b.ducks,
      fours: a.fours + b.fours,
      sixes: a.sixes + b.sixes,
    };
  }

  function mergeBowling(a, b) {
    const best = (!b.bestWickets || b.bestWickets < a.bestWickets ||
      (b.bestWickets === a.bestWickets && (b.bestRuns ?? 999) > (a.bestRuns ?? 999)))
      ? a : b;
    return {
      matches: a.matches + b.matches,
      innings: a.innings + b.innings,
      balls: a.balls + b.balls,
      runs: a.runs + b.runs,
      wickets: a.wickets + b.wickets,
      bestWickets: best.bestWickets,
      bestRuns: best.bestRuns,
      threeWickets: a.threeWickets + b.threeWickets,
      fiveWickets: a.fiveWickets + b.fiveWickets,
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

  /** Snake order: A, B, B, A, A, B, … */
  function snakePreferredSide(pickIndex) {
    const round = Math.floor(pickIndex / 2);
    const inRound = pickIndex % 2;
    if (round % 2 === 0) return inRound === 0 ? 'A' : 'B';
    return inRound === 0 ? 'B' : 'A';
  }

  function sideForCategoryPick(squads, pickIndex, scoreMap) {
    let preferred = snakePreferredSide(pickIndex);
    if (!canAddToSquadSide(preferred, squads)) {
      const other = preferred === 'A' ? 'B' : 'A';
      if (canAddToSquadSide(other, squads)) preferred = other;
      else {
        rebalanceSquadsBySize(squads, scoreMap);
        preferred = squads.A.length <= squads.B.length ? 'A' : 'B';
      }
    }
    return preferred;
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
      squads.A = squads.A.map(id => (id === best.idA ? best.idB : id));
      squads.B = squads.B.map(id => (id === best.idB ? best.idA : id));
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

  function snakeDraftCategory(list, squads, scoreMap, skillKey = 'rating') {
    const sorted = list.slice().sort((a, b) => {
      const d = skillValue(b, skillKey) - skillValue(a, skillKey);
      if (d !== 0) return d;
      return (Math.random() - 0.5);
    });
    sorted.forEach((item, i) => {
      const side = sideForCategoryPick(squads, i, scoreMap);
      squads[side].push(item.id);
    });
  }

  function draftBalanced(list, squads, scoreMap, skillKey = 'rating') {
    snakeDraftCategory(list, squads, scoreMap, skillKey);
  }

  /**
   * @param {object[]} players — pool to distribute (e.g. available today)
   * @param {{ existingSquads?: { A: string[], B: string[] } }} options
   */
  function balanceTeams(players, options = {}) {
    const existing = options.existingSquads || { A: [], B: [] };
    const squads = { A: [...existing.A], B: [...existing.B] };
    const taken = new Set([...squads.A, ...squads.B]);
    const pool = (players || []).filter(p => p && !taken.has(p.id));
    const scoreMap = new Map(teamBalanceScores(players || []).map(s => [s.id, s]));

    dedupeSquads(squads);
    rebalanceSquadsBySize(squads, scoreMap);

    const buckets = { bowler: [], batsman: [], allrounder: [], unknown: [] };
    for (const s of teamBalanceScores(pool)) {
      buckets[s.role]?.push(s);
    }

    snakeDraftCategory(buckets.bowler, squads, scoreMap, 'bowlScore');
    snakeDraftCategory(buckets.batsman, squads, scoreMap, 'batScore');
    draftBalanced(buckets.allrounder, squads, scoreMap, 'rating');
    draftBalanced(buckets.unknown, squads, scoreMap, 'rating');
    improveSkillBalance(squads, scoreMap, 'batScore');
    improveSkillBalance(squads, scoreMap, 'bowlScore');
    normalizeSquadSizes(players, squads);

    const countRole = (ids, role) =>
      ids.filter(id => scoreMap.get(id)?.role === role).length;

    const summary = {
      totalA: squads.A.length,
      totalB: squads.B.length,
      batA: countRole(squads.A, 'batsman'),
      batB: countRole(squads.B, 'batsman'),
      bowlA: countRole(squads.A, 'bowler'),
      bowlB: countRole(squads.B, 'bowler'),
      arA: countRole(squads.A, 'allrounder'),
      arB: countRole(squads.B, 'allrounder'),
    };

    return { squads, summary, error: null };
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
        if (b.out) out = true;
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

  function matchPerformanceScore(innings, playerId, name) {
    const bat = matchBattingLine(innings, playerId, name);
    const bowl = matchBowlingLine(innings, playerId, name);
    let score = 0;
    const parts = [];

    if (bat.faced) {
      let batPts = bat.runs + bat.fours + bat.sixes * 2;
      if (bat.runs >= 100) batPts += 50;
      else if (bat.runs >= 50) batPts += 25;
      if (bat.out && bat.runs === 0) batPts -= 5;
      score += batPts;
      parts.push(`${bat.runs} runs`);
    }

    if (bowl.bowled) {
      let bowlPts = bowl.wickets * 25 - bowl.runs * 0.4;
      if (bowl.wickets >= 5) bowlPts += 20;
      else if (bowl.wickets >= 3) bowlPts += 10;
      const econ = bowl.balls ? (bowl.runs / bowl.balls) * 6 : 99;
      if (bowl.balls >= 6 && econ <= 6) bowlPts += 8;
      score += Math.max(0, bowlPts);
      parts.push(`${bowl.wickets} wkts`);
    }

    return { score, parts, bat, bowl };
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
      const perf = matchPerformanceScore(match.innings, id, name);
      if (perf.score <= 0 && !perf.bat.faced && !perf.bowl.bowled) continue;
      ranked.push({
        playerId: id,
        name,
        team: playerTeamInMatch(match, id, name),
        score: perf.score,
        summary: perf.parts.join(' · ') || 'Played',
        bat: perf.bat,
        bowl: perf.bowl,
      });
    }
    ranked.sort((a, b) => b.score - a.score);

    const potm = ranked[0] || null;
    const mvpA = ranked.find(r => r.team === 'A') || null;
    const mvpB = ranked.find(r => r.team === 'B') || null;

    return { potm, mvpA, mvpB };
  }

  function applyMatchStatsToRoster(match, players) {
    if (match.status !== 'completed') return false;
    let any = false;
    for (const p of players) {
      const bat = matchBattingLine(match.innings, p.id, p.name);
      const bowl = matchBowlingLine(match.innings, p.id, p.name);
      if (!bat.faced && !bowl.bowled) continue;

      any = true;
      touch(p);
      if (bat.faced) p.batting.matches += 1;
      if (bowl.bowled) p.bowling.matches += 1;

      if (bat.faced) {
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
      }

      if (bowl.bowled) {
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
      }
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

  function rewritePlayerInMatch(match, sourceId, sourceName, targetId, targetName) {
    if (!match) return false;
    let changed = false;
    const applyLine = (line) => {
      if (!lineIsSource(line, sourceId, sourceName)) return;
      line.playerId = targetId;
      line.name = targetName;
      changed = true;
    };

    if (match.squads) {
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
      for (const b of inn.batters || []) applyLine(b);
      for (const b of inn.bowlers || []) applyLine(b);
    }

    if (match.awards) {
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

  /** Players who batted or bowled in a match (for admin reassign UI). */
  function listMatchParticipants(match, players) {
    const out = new Map();
    const add = (line) => {
      if (!line?.name) return;
      const id = line.playerId || findByName(players, line.name)?.id || null;
      const key = id || `n:${normalizeName(line.name)}`;
      if (!out.has(key)) out.set(key, { id, name: line.name.trim() });
    };
    for (const inn of match.innings || []) {
      for (const b of inn.batters || []) add(b);
      for (const b of inn.bowlers || []) add(b);
    }
    return [...out.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  /**
   * Move one player's batting/bowling in a single match to another profile.
   * Both players stay on the roster; career stats are rebuilt from all completed matches.
   */
  function reassignPlayerInMatch(players, matchId, sourceId, sourceName, targetId, matches) {
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
    )) {
      return {
        players,
        matches,
        changedMatchIds: [],
        error: `${resolvedSourceName} did not appear in that match`,
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
