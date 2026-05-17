# QuickCric

A lightweight, zero-config cricket scoring PWA. Type team names, tap a ball outcome, move on. No player rosters, no setup wizards, no accounts.

## Stack & files

Vanilla JS, no framework, no build step. Runs from any static server.

- `index.html` — single page shell, all screens toggled via JS
- `app.js` — state, scoring rules, rendering
- `db.js` — Supabase REST wrapper (~80 lines, no SDK)
- `config.js` — Supabase URL + anon key
- `style.css` — mobile-first
- `manifest.json` + `sw.js` + `icon.svg` — PWA bits
- `ref/` — design references (not shipped)

## Running

```
python3 -m http.server 8000
```

Open `http://localhost:8000` on a phone or desktop. Tap "Add to Home Screen" to install as a PWA. Works offline after first load.

## Supabase setup (one-time, ~3 min)

QuickCric stores matches in Supabase so they're available across devices and can be live-shared via link. The free tier covers a personal/club use case comfortably (500 MB DB, 5 GB bandwidth/month, no credit card needed).

1. Create an account at https://supabase.com and start a new project (pick any region close to you).
2. Open the **SQL editor** in the Supabase dashboard, paste the block below, and run it:

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

3. In **Project Settings → API**, copy the **Project URL** and the **anon public** key.
4. Paste them into `config.js`:

   ```js
   window.QC_CONFIG = {
     SUPABASE_URL: 'https://<your-project>.supabase.co',
     SUPABASE_ANON_KEY: 'eyJ...'
   };
   ```

5. Reload the app. The "Cloud sync off" banner on the home screen disappears once config is loaded.

**Note on security:** these policies make the matches table fully public — anyone with the anon key (i.e. anyone who opens the deployed site) can read, write, and delete any match. That's appropriate for a casual scoring app shared among friends; not appropriate for anything sensitive. If multiple people host the same deployment, give each their own Supabase project.

If `config.js` is left blank the app still works — it falls back to localStorage (single device, no share links).

## Data model

Stored in Supabase as `matches.data` (JSONB). Cached locally in `localStorage`:
- `quickcric:matches` — cached history list
- `quickcric:current` — in-progress match, kept up to date after every ball so a closed tab can resume offline

Each ball is a snapshot in `innings[i].ballLog`. Undo restores up to the previous 2 balls.

## Cricket rules encoded

| Input | Total | Batsman | Bowler concedes | Legal ball | Striker rotates |
|---|---|---|---|---|---|
| 0 (dot) | 0 | 0 | 0 | yes | no |
| 1/2/3/4/5/6 | n | n | n | yes | odd n |
| wd | 1 | 0 | 1 | no | no |
| wd + n | 1+n | 0 | 1+n | no | odd n |
| nb | 1 | 0 | 1 | no | no |
| nb + n | 1+n | n | 1+n | no | odd n |
| lb / b | n | 0 | 0 | yes | odd n |
| W | — | out | — | yes (unless wd) | new batter at striker end |

- End of over swaps striker, prompts for new bowler
- Innings ends on: overs done, 10 wickets, target chased (2nd innings), or manual "End Innings"
- All wickets are stored as "out" — we don't differentiate caught/bowled/lbw to keep entry fast

## Selection rules (scoring screen)

Up to 2 buttons can be active before pressing **Next Ball**. Categories: RUNS (0-6), EXTRA (wd/nb/lb/b), WICKET. At most one per category. Tapping a 3rd from a new category is rejected with a toast; tap to deselect first. Tapping the same button again deselects.

## Sharing

The Share button generates a link the recipient can open in any browser:
- **With Supabase configured:** `…/#m=<matchId>` — viewer fetches the match from the DB and polls every 3 s while the page is open, so live scores update without a refresh. Read-only.
- **Without Supabase:** `…/#v=<base64>` — a static snapshot of the current state encoded into the URL. Viewer sees a frozen scorecard; refreshing pulls the same frozen state.

## Sync behavior

Mid-match writes are debounced (~400 ms) and coalesced — rapid tapping won't fire one request per ball. Failed writes log a warning but don't block scoring; the next ball will retry. If you lose connectivity mid-match, scoring continues from the local cache and resumes syncing when you're back online (on the next ball).

## Audio

The score screen has a speaker toggle (♪ icon in the top-right). When enabled:

- **Commentary on every ball** uses the browser's Web Speech API — picks a UK / Indian / Australian English voice if available. Phrases vary so it doesn't sound repetitive ("OUT! What a wicket!" / "FOUR! Through the gap!" / "Single taken" / etc.). Free hits, wides, byes, leg byes and no-balls each get their own line.
- **Synthesized celebrations** are generated via Web Audio API as a fallback: a 4-note fanfare + crowd-noise burst for a SIX, a shorter cheer for a FOUR, a low thump for a wicket, and a longer melody + cheer when the match is won.

### Custom audio (the T20 World Cup ask)

If you want the actual "famous six music" or any other clip, drop the files into a `sounds/` folder next to `index.html` with these exact names:

```
sounds/
  six.mp3     ← plays on every six
  four.mp3    ← plays on every four
  wicket.mp3  ← plays on every wicket
  win.mp3     ← plays once when the match ends
```

The app tries each file first; if it's missing, it falls back to the synthesized version. The browser's autoplay rules require a user gesture (which you already have — Next Ball), so files play reliably.

Why aren't these bundled? The actual T20 WC and IPL tracks are copyrighted — you'll need to source clips yourself (royalty-free options on mixkit.co, pixabay.com, freesound.org, or your own recordings).

Mute state is remembered in `localStorage` under `quickcric:audio`.

## Out of scope (intentionally)

- Player rosters / team management
- Detailed dismissal types
- Multi-day, super overs, DLS, free hits as a separate state
- Auth / per-user isolation (single shared Supabase project per deployment)
