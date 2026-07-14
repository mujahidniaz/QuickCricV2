# QuickCric

A lightweight, zero-config cricket scoring PWA. Type team names, tap a ball outcome, move on. No player rosters, no setup wizards, no accounts.

Built for casual games — park cricket, club nets, backyard T20 — where you want a live scorecard in seconds, not a full tournament management system.

## Features

- **Fast scoring** — tap runs (0–6), extras (wide, no-ball, bye, leg bye), or wicket, then **Next Ball**
- **Two-innings matches** — configurable overs (default 6), automatic innings transitions, chase targets
- **Live share links** — spectators open a URL and see scores update every 3 seconds (with Supabase)
- **Offline-first** — works without cloud config; resumes in-progress matches from local storage
- **PWA** — install to home screen, works offline after first load
- **Audio** — ball-by-ball commentary (Web Speech API) plus synthesized cheers for 4s, 6s, wickets, and wins
- **Optional scoring PIN** — share a 4-digit PIN so someone else can score from their device
- **Match history** — browse past games, filter by date, view full scorecards

## Quick start

No build step. Serve the folder with any static HTTP server:

```bash
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000) on a phone or desktop. Tap **Add to Home Screen** to install as a PWA.

Without Supabase configured, matches are stored in `localStorage` on that device only.

## Tech stack

| Layer | Choice |
|---|---|
| UI | Vanilla JS — single-page app, screens toggled via JS |
| Styling | Mobile-first CSS, dark green cricket theme |
| Storage | `localStorage` + optional [Supabase](https://supabase.com) REST API |
| PWA | `manifest.json` + service worker (`sw.js`) |
| Audio | Web Speech API + Web Audio API (+ optional `sounds/*.mp3`) |

No framework, no bundler, no npm install.

## Project structure

```
QuickCricV2/
├── index.html      # App shell
├── app.js          # State, scoring rules, UI rendering (~2k lines)
├── db.js           # Supabase REST wrapper (~100 lines, no SDK)
├── config.js       # Supabase URL, anon key, delete passcode
├── style.css       # Mobile-first styles
├── manifest.json   # PWA manifest
├── sw.js           # Service worker (offline cache)
├── icon.svg        # App icon
└── sounds/         # Optional custom audio (not bundled)
    ├── six.mp3
    ├── four.mp3
    ├── wicket.mp3
    └── win.mp3
```

## Supabase setup (optional, ~3 min)

Cloud sync enables cross-device history and live share links. The free tier is enough for personal or club use.

1. Create a project at [supabase.com](https://supabase.com).
2. In the **SQL editor**, run:

```sql
create table if not exists matches (
  id text primary key,
  data jsonb not null,
  status text not null default 'in_progress',
  started_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists matches_updated_at_idx on matches (updated_at desc);

alter table matches enable row level security;

create policy "public select" on matches for select using (true);
create policy "public insert" on matches for insert with check (true);
create policy "public update" on matches for update using (true) with check (true);
create policy "public delete" on matches for delete using (true);
```

3. From **Project Settings → API**, copy the **Project URL** and **anon public** key.
4. Paste them into `config.js`:

```js
window.QC_CONFIG = {
  SUPABASE_URL: 'https://<your-project>.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...',

  // Passcode required to delete a saved match
  DELETE_PASSCODE: 'your-passcode'
};
```

5. Reload the app. The "Cloud sync off" banner disappears once config is valid.

**Security note:** these RLS policies make the matches table fully public — anyone with the anon key (i.e. anyone who opens the deployed site) can read, write, and delete any match. Fine for casual scoring among friends; not for sensitive data. Use a separate Supabase project per deployment.

## How scoring works

### Ball input

Up to two buttons can be active before **Next Ball**. Categories: **RUNS** (0–6), **EXTRA** (wd/nb/lb/b), **WICKET**. At most one per category.

| Input | Total | Batsman | Bowler concedes | Legal ball | Striker rotates |
|---|---|---|---|---|---|
| 0 (dot) | 0 | 0 | 0 | yes | no |
| 1–6 | n | n | n | yes | odd n |
| wd | 1 | 0 | 1 | no | no |
| wd + n | 1+n | 0 | 1+n | no | odd n |
| nb | 1 | 0 | 1 | no | no |
| nb + n | 1+n | n | 1+n | no | odd n |
| lb / b | n | 0 | 0 | yes | odd n |
| W | — | out | — | yes (unless wd) | new batter at striker |

- End of over swaps striker and prompts for a new bowler
- Innings ends on: overs complete, 10 wickets, target chased (2nd innings), or manual **End Innings**
- **Undo** restores up to the previous 2 balls

### Data model

Matches are stored as JSON in `matches.data` (Supabase) and cached locally:

- `quickcric:matches` — match history
- `quickcric:current` — in-progress match (updated after every ball)

Each ball is a snapshot in `innings[i].ballLog`.

## Sharing

The **Share** button generates a link:

- **With Supabase:** `…/#m=<matchId>` — viewer polls every 3 s for live updates (read-only)
- **Without Supabase:** `…/#v=<base64>` — frozen snapshot encoded in the URL

Sync writes are debounced (~400 ms). Failed writes log a warning but don't block scoring; the next ball retries.

## Audio

Toggle the speaker (♪) on the score screen. When enabled:

- **Commentary** on every ball via Web Speech API (UK / Indian / Australian English voices when available)
- **Celebrations** via Web Audio API: fanfare for sixes, cheer for fours, thump for wickets, melody on match win

Drop custom clips into `sounds/` (`six.mp3`, `four.mp3`, `wicket.mp3`, `win.mp3`) — the app tries files first, then falls back to synthesized audio. Mute state is saved in `localStorage` under `quickcric:audio`.

## Intentionally out of scope

- Player rosters / team management
- Detailed dismissal types (all wickets stored as "out")
- Multi-day, super overs, DLS, free-hit state machine
- Auth / per-user isolation

## License

Not specified in the repository. Add a license file if you plan to distribute or open-source the project.
