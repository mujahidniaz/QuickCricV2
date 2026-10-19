---
name: quickcric-push
description: >-
  QuickCricV2 (BCC cricket PWA) architecture, file map, state, stats APIs, and
  GitHub push workflow. Use for any QuickCric feature work, UI fixes, season or
  player stats, ICC ranks, photos, scoring, or when the user says push/deploy.
---

# QuickCric (QuickCricV2 / BCC)

Lightweight **vanilla JS PWA** — no framework, no build. Club scoring: team names, tap ball outcomes, optional player roster + season dashboard. Deployed as static files (often Vercel) with optional **Supabase** for matches/players sync and live share links.

**Local run:** `python3 -m http.server 8000` → `http://localhost:8000`

**Deeper product/rules doc:** repo root `CLAUDE.md` (cricket table, sharing, audio, Supabase SQL).

---

## Repository layout

| File | Role |
|------|------|
| `index.html` | Single-page shell; screens swapped by `render()` |
| `app.js` | ~7k lines: `state`, scoring, all `render*()` views, `handleAction()` router, photos, season UI |
| `players.js` | `window.QCPlayers` IIFE — stats aggregation, rankings, ICC ratings, team balance, awards |
| `db.js` | `window.QCDB` — thin Supabase REST (no SDK) |
| `config.js` | `window.QC_CONFIG` — `SUPABASE_URL`, `SUPABASE_ANON_KEY` (blank = localStorage-only) |
| `style.css` | Mobile-first; **BCC** theme (`bcc-*`, `ssn-*` season screens) |
| `sw.js` | Service worker; **`CACHE = 'quickcric-vNNN'`** — bump on every deploy |
| `manifest.json`, `icon.svg` | PWA install |
| `sounds/` | Optional `six.mp3`, `four.mp3`, `wicket.mp3`, `win.mp3` |
| `ref/` | Design references — not shipped |
| `data/` | Local import dumps — **do not commit** upload/fixed CSV/JSON |

---

## App flow (`state.view`)

Router in `render()` switch (~line 2905):

| `state.view` | Screen |
|--------------|--------|
| `home` | Start / resume / dock nav |
| `setup` | Teams, overs, venue |
| `match-availability` | Checkbox roster before match |
| `team-pick` | Manual or auto-balanced squads |
| `match-toss` | Coin toss UI |
| `innings-setup` | Openers + bowler |
| `score` | Live scoring pad |
| `innings-break` | Between innings |
| `result` / `detail` | Match summary + scorecard (`renderDetail`) |
| `history` | Past matches list |
| `in-progress` | Resume list |
| `players` | Roster + batting/bowling boards + **Bat rank / Bowl rank** (ICC) |
| `player-detail` | Profile: season chips, bat/bowl stats, ICC rank tabs, photo |
| `seasons` | Season dashboard (caps, leaders, awards, wrapped entry) |
| `wrapped` | Season story cards |
| `view` | Read-only shared match (`#m=` or `#v=`) |
| `terms` | Legal |

**Actions:** delegated clicks use `data-action` → `handleAction()` (large `switch`). Prefer extending existing actions over new listeners.

**Season context:** `activeSeason()` / `state.appSeason` — filters history, players, season board (`'all'` or year string).

---

## `window.QCPlayers` (players.js)

Stats are rebuilt from completed matches via `applyMatchStats` / `rebuildAllStatsFromMatches`. Important exports:

- **Views:** `battingView`, `bowlingView`, `playerInSeason`, `seasonYears`, `seasonFacts`
- **Leaderboards:** `battingRankings`, `bowlingRankings`, `MIN_QUALIFY_INNINGS` (5), `battingQualifies` / `bowlingQualifies`, runs/wickets **per innings** ranking
- **ICC:** `iccRankings(players, matches)` → `{ batting, bowling }` rows with `rating`, `innings`, `factor`
- **Match:** `computeAwards`, `matchPerformanceScore`, `listMatchParticipants`, `reassignPlayerInMatch`, `mergePlayersInto`
- **Teams:** `teamBalanceScores`, `balanceTeams`, `normalizeSquadSizes`
- **CRUD helpers:** `add`, `remove`, `rename`, `findById`, `newPlayer`

Player objects: `{ id, name, data?, batting: {...}, bowling: {...}, photo? }` — photo often base64 in `photo` field.

---

## Photos & scorecard faces (app.js)

- `safePlayerPhoto(p)` — validated data URL or `''`
- `setPlayerPhoto(id, dataUrl)` / `compressPlayerPhoto(file)` — roster sync
- `playerAvatarHtml`, `faceHtml`, `scorecardFaceName`, `seasonLeaderFaceName`, `summaryPortraitHtml`, `portraitHtml` — consistent sizes per context (44px scorecard, 64px profile, etc.)
- Hidden file input `#player-photo-input`; actions `player-photo`, `player-photo-clear`

---

## Players list tabs (`state.playersTab`)

1. **Roster** — alphabetical, avatars  
2. **Batting** / **Bowling** — qualified leaderboard (min innings)  
3. **Bat rank** / **Bowl rank** — second row `bcc-seg is-rank`; ICC list + `bcc-ranknote`

## Player detail tabs (`state.playerStatTab`)

`bat` | `bowl` | `bat-rank` | `bowl-rank` — rank tabs show ICC KPIs + full board; `view-player` sets tab from `data-from`.

---

## Data & sync

**localStorage keys (common):**

- `quickcric:matches`, `quickcric:current` — match cache + in-progress
- `quickcric:audio` — mute
- Player list cached with matches when DB on

**Supabase:** `matches` + `players` tables, JSONB `data` column; public RLS (casual club use). See `CLAUDE.md` for SQL.

**Share:** `#m=<id>` live poll (3s) with DB; `#v=<base64>` frozen snapshot without DB.

**Scoring:** `state.ball` selection (runs/extra/wicket categories); `innings[i].ballLog` snapshots; undo last 2 balls. Rules table in `CLAUDE.md`.

---

## UI conventions

- **BCC** branding: `bcc-top`, `bcc-scroll`, `bcc-wrap`, `bcc-dock`, `bcc-an` (Anton-style numbers)
- **Season:** `ssn-*` (dashboard, caps, leaders, form bars)
- **Match summary:** `bcc-top-stack` vertical top performers; bowling rows `bcc-tr--bowl`
- Modals: `state.modal.type` (e.g. `deletePlayerPin`, `editPlayerName`, `adminPin`)

---

## Editing checklist

1. Read surrounding `render*` + `handleAction` case before changing behavior.
2. Stats logic belongs in **players.js**; UI in **app.js**; styles in **style.css**.
3. After JS/CSS/HTML changes: **`node --check app.js`** and **bump `sw.js` CACHE**.
4. Do not reintroduce duplicate portraits (one large OR small face in a row, not both).

---

## Push & deploy

### When the user asks to push

1. **Inspect** — `git status`, `git diff`, `git log -5 --oneline` (parallel).
2. **Commit** in this turn (user requested push).
3. **Stage** app sources + `.cursor/skills/` when updated. **Never** commit:
   - `.DS_Store`
   - `data/*upload*`, `data/*.fixed.json`, local CSV/JSON dumps
   - `*_bkp.*`, `style_bkp.css`, `app_bkp.js`
   - Do not paste admin PIN or Supabase keys into chat
4. **Pre-push:** `node --check app.js` if `app.js` changed; bump `sw.js` `CACHE` if shipped assets changed.
5. **Commit message** — 1–2 sentences, why-focused; HEREDOC per user git rules.
6. **Push** (prefer SSH — HTTPS `origin` may be wrong GitHub user):

```bash
git push git@github.com:mujahidniaz/QuickCricV2.git HEAD:main
git fetch git@github.com:mujahidniaz/QuickCricV2.git main:refs/remotes/origin/main
git status -sb
```

7. **Report** commit hash; remind user to hard-refresh PWA after deploy.

| Remote | Use |
|--------|-----|
| `git@github.com:mujahidniaz/QuickCricV2.git` | **Push target** |
| `origin` | May fail on HTTPS — use SSH above |

### Maintain this skill

When architecture, remotes, or push steps change, update this file and add a **Changelog** line.

## Changelog

- 2026-10-20 — App map: views, QCPlayers, ICC rank tabs, photos, data/sync, UI conventions.
- 2026-10-20 — Initial skill: SSH push, SW cache bump, commit exclusions.
