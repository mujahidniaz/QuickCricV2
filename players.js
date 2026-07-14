(function () {
  'use strict';

  const STORE = 'quickcric:players';

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

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; }
  }

  function save(players, opts) {
    const localOnly = !!(opts && opts.localOnly);
    try { localStorage.setItem(STORE, JSON.stringify(players)); } catch { }
    if (!localOnly && window.QCDB?.enabled) window.QCDB.syncPlayers(players);
  }

  function merge(local, remote) {
    const map = new Map();
    for (const p of remote) map.set(p.id, p);
    for (const p of local) {
      const ex = map.get(p.id);
      const pTs = p.updatedAt || p.createdAt || 0;
      const exTs = ex ? (ex.updatedAt || ex.createdAt || 0) : -1;
      if (!ex || pTs >= exTs) map.set(p.id, p);
    }
    return Array.from(map.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function touch(p) {
    p.updatedAt = Date.now();
  }

  function findById(players, id) {
    return players.find(p => p.id === id) || null;
  }

  function findByName(players, name) {
    const n = (name || '').trim().toLowerCase();
    if (!n) return null;
    return players.find(p => p.name.toLowerCase() === n) || null;
  }

  function add(players, name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return { players, player: null, error: 'Name required' };
    if (findByName(players, trimmed)) return { players, player: null, error: 'Player already exists' };
    const player = newPlayer(trimmed);
    const next = [player, ...players];
    save(next);
    return { players: next, player, error: null };
  }

  function remove(players, id) {
    const next = players.filter(p => p.id !== id);
    save(next);
    if (window.QCDB?.enabled) {
      window.QCDB.deletePlayer(id).catch(err => console.warn('[QuickCric] player delete failed:', err.message));
    }
    return next;
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

  function applyMatchStats(match, players) {
    if (match.status !== 'completed') return players;
    const rosterIds = new Set(players.map(p => p.id));
    const touched = new Set();

    for (const p of players) {
      const bat = matchBattingLine(match.innings, p.id, p.name);
      const bowl = matchBowlingLine(match.innings, p.id, p.name);
      if (!bat.faced && !bowl.bowled) continue;

      touched.add(p.id);
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

    if (touched.size) save(players);
    return players;
  }

  window.QCPlayers = {
    STORE,
    load,
    save,
    merge,
    add,
    remove,
    findById,
    findByName,
    newPlayer,
    batAvg,
    batSR,
    bowlAvg,
    bowlEcon,
    bowlSR,
    fmtOvers,
    computeAwards,
    applyMatchStats,
    matchPerformanceScore,
  };
})();
