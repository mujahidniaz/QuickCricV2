(function () {
  'use strict';

  const cfg = window.QC_CONFIG || {};
  const URL = (cfg.SUPABASE_URL || '').replace(/\/$/, '');
  const KEY = cfg.SUPABASE_ANON_KEY || '';
  const enabled = !!(URL && KEY);

  async function rest(path, opts = {}) {
    if (!enabled) throw new Error('DB not configured');
    const res = await fetch(`${URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: opts.prefer || 'return=representation',
        ...(opts.headers || {})
      }
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`DB ${res.status}: ${txt || res.statusText}`);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  }

  function toRow(m) {
    return {
      id: m.id,
      data: m,
      status: m.status,
      started_at: new Date(m.startedAt).toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  async function upsertMatch(m) {
    return rest('matches', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify(toRow(m))
    });
  }

  async function loadMatches(limit = 50) {
    const rows = await rest(
      `matches?select=data&order=updated_at.desc&limit=${limit}`
    );
    return rows.map((r) => r.data);
  }

  async function loadMatch(id) {
    const rows = await rest(
      `matches?id=eq.${encodeURIComponent(id)}&select=data,updated_at&limit=1`
    );
    return rows[0] ? { match: rows[0].data, updatedAt: rows[0].updated_at } : null;
  }

  async function deleteMatch(id) {
    return rest(`matches?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      prefer: 'return=minimal'
    });
  }

  function toPlayerRow(p) {
    return {
      id: p.id,
      data: p,
      updated_at: new Date(p.updatedAt || p.createdAt || Date.now()).toISOString()
    };
  }

  async function upsertPlayers(players) {
    if (!players.length) return;
    return rest('players', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify(players.map(toPlayerRow))
    });
  }

  const ROSTER_META_ID = '_quickcric:meta';

  async function loadPlayersBundle() {
    const rows = await rest(
      'players?select=id,data&order=updated_at.desc'
    );
    const players = [];
    let deletedNames = [];
    for (const row of rows) {
      if (row.id === ROSTER_META_ID) {
        deletedNames = row.data?.deletedNames || [];
        continue;
      }
      players.push(row.data);
    }
    return { players, deletedNames };
  }

  async function loadPlayers() {
    const { players } = await loadPlayersBundle();
    return players;
  }

  async function upsertRosterMeta(deletedNames) {
    return rest('players', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify([{
        id: ROSTER_META_ID,
        data: { deletedNames, updatedAt: Date.now() },
        updated_at: new Date().toISOString()
      }])
    });
  }

  async function deletePlayer(id) {
    if (id === ROSTER_META_ID) return;
    return rest(`players?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      prefer: 'return=minimal'
    });
  }

  // Debounce + coalesce upserts so we don't hammer the API mid-tap-storm.
  let pending = null;
  let inFlight = false;
  let timer = null;
  function schedule(m) {
    pending = m;
    if (timer) return;
    timer = setTimeout(flush, 400);
  }
  async function flush() {
    timer = null;
    if (!pending || inFlight) {
      if (pending) timer = setTimeout(flush, 400);
      return;
    }
    const m = pending;
    pending = null;
    inFlight = true;
    try {
      await upsertMatch(m);
    } catch (err) {
      console.warn('[QuickCric] sync failed:', err.message);
    } finally {
      inFlight = false;
      if (pending) timer = setTimeout(flush, 200);
    }
  }

  let playersPending = null;
  let playersInFlight = false;
  let playersTimer = null;
  function schedulePlayers(players) {
    playersPending = players;
    if (playersTimer) return;
    playersTimer = setTimeout(flushPlayers, 400);
  }
  async function flushPlayers() {
    playersTimer = null;
    if (!playersPending || playersInFlight) {
      if (playersPending) playersTimer = setTimeout(flushPlayers, 400);
      return;
    }
    const list = playersPending;
    playersPending = null;
    playersInFlight = true;
    try {
      await upsertPlayers(list);
    } catch (err) {
      console.warn('[QuickCric] player sync failed:', err.message);
    } finally {
      playersInFlight = false;
      if (playersPending) playersTimer = setTimeout(flushPlayers, 200);
    }
  }

  window.QCDB = {
    enabled,
    upsertMatch,
    loadMatches,
    loadMatch,
    deleteMatch,
    syncMatch: schedule,
    upsertPlayers,
    loadPlayers,
    loadPlayersBundle,
    upsertRosterMeta,
    deletePlayer,
    syncPlayers: schedulePlayers,
    ROSTER_META_ID
  };
})();
