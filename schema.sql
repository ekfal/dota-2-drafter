-- schema.sql — Dota 2 Draft Helper
-- Sumber kebenaran skema (PRD §11). Postgres / Supabase.
-- Join key lintas tabel & sumber: match_id Valve.
--
-- Tipe (terkunci, slim-storage, target 500 MB):
--   ID Valve (match_id, account_id, league_id, team_id) = bigint
--   hero_id, patch_id, ord, role, team(0/1)              = smallint
--   count (picks/bans/games/wins/contest)                = int
--   rating Elo                                           = real
--   timestamp sumber (start_time)                        = bigint (epoch Unix, sesuai OpenDota)
--   bool nullable kalau status belum final
--
-- Catatan derived: patch_id / team_id NULL pada tabel hitungan = agregat
-- "semua patch / semua tim". PK natural pakai COALESCE(...,0) di unique index
-- karena kolom PK tak boleh NULL. Tabel hitungan aman di-drop & recompute.

-- ============================================================
-- 11.1 TABEL MENTAH (salinan slim OpenDota)
-- ============================================================

-- Patch (auto dari dotaconstants patch.json)
create table patches (
  id          smallint primary key,
  name        text    not null,
  start_time  bigint  not null            -- epoch boundary rilis patch
);

-- Turnamen / league
create table leagues (
  league_id   bigint  primary key,
  name        text,
  tier        text                        -- OpenDota tier: professional/premium/amateur
);

-- Tim + Elo dasar
create table teams (
  team_id     bigint  primary key,
  name        text,
  tag         text,
  rating      real,                       -- Elo OpenDota
  logo_url    text                        -- dari /teams/{id}, buat header team (DESIGN v2)
);

-- Pemain + roster
create table players (
  account_id  bigint  primary key,
  team_id     bigint  references teams(team_id),   -- nullable: free agent / tak diketahui
  name        text,
  is_pro      boolean
);

-- Hero (dari constants)
create table heroes (
  hero_id         smallint primary key,
  localized_name  text not null,
  primary_attr    text,                   -- str/agi/int/all
  img             text                    -- path CDN relatif (/apps/dota2/...); prepend cdn.cloudflare.steamstatic.com. Slim: URL saja, tak download file.
);

-- Inti match (slim, TANPA telemetry)
create table matches (
  match_id          bigint   primary key,
  league_id         bigint   references leagues(league_id),
  patch_id          smallint references patches(id),     -- nullable sampai di-tag
  radiant_team_id   bigint   references teams(team_id),  -- nullable: team_id bisa kosong
  dire_team_id      bigint   references teams(team_id),
  radiant_win       boolean,                             -- nullable: match belum selesai
  start_time        bigint,                              -- epoch Unix
  duration          int                                  -- detik; dari /proMatches (FR-4)
);

-- Draft: pick/ban per sisi + urutan
create table picks_bans (
  match_id    bigint   not null references matches(match_id) on delete cascade,
  ord         smallint not null,           -- urutan draft (0..n)
  is_pick     boolean  not null,
  hero_id     smallint not null references heroes(hero_id),
  team        smallint not null,           -- 0 = radiant, 1 = dire (as-is OpenDota)
  primary key (match_id, ord)
);

-- Siapa main hero apa (lane_role nullable, isi saat parse — F2)
create table match_players (
  match_id    bigint   not null references matches(match_id) on delete cascade,
  account_id  bigint   references players(account_id),   -- nullable: anonymous player
  hero_id     smallint not null references heroes(hero_id),
  is_radiant  boolean  not null,
  win         boolean,
  lane_role   smallint,                    -- 1-4 OpenDota (Safe/Mid/Off/Jungle), null pra-parse
  player_slot smallint,                    -- 0-4 radiant, 128-132 dire
  net_worth   int,                         -- buat ranking core/support (slim, tak simpan gold_t/xp_t)
  position    smallint,                    -- derived 1-5 (heuristik net-worth-first), recomputable
  primary key (match_id, hero_id)
);

-- ============================================================
-- 11.2 TABEL HITUNGAN (derived — rebuildable dari mentah)
-- ============================================================

-- FR-1: most pick/ban/contest se-turnamen
create table tournament_hero_stats (
  league_id   bigint   not null references leagues(league_id) on delete cascade,
  hero_id     smallint not null references heroes(hero_id),
  picks       int      not null default 0,
  bans        int      not null default 0,
  contest     int      not null default 0,
  primary key (league_id, hero_id)
);

-- FR-2 & FR-6: most pick/ban tim, ban lawan
create table team_hero_stats (
  team_id     bigint   not null references teams(team_id) on delete cascade,
  hero_id     smallint not null references heroes(hero_id),
  patch_id    smallint references patches(id),   -- NULL = semua patch
  picks       int      not null default 0,
  pick_wins   int      not null default 0,
  bans        int      not null default 0
);
create unique index team_hero_stats_uq
  on team_hero_stats (team_id, hero_id, coalesce(patch_id, 0));

-- FR-5 + "klik hero → di-pick sama siapa" (kanonik a < b)
create table hero_pairs (
  hero_id_a   smallint not null references heroes(hero_id),
  hero_id_b   smallint not null references heroes(hero_id),
  patch_id    smallint references patches(id),   -- NULL = semua patch
  team_id     bigint   references teams(team_id),-- NULL = semua tim
  games       int      not null default 0,
  wins        int      not null default 0,
  check (hero_id_a < hero_id_b)
);
create unique index hero_pairs_uq
  on hero_pairs (hero_id_a, hero_id_b, coalesce(patch_id, 0), coalesce(team_id, 0));

-- FR-8: distribusi role pos 1-5
create table hero_role_dist (
  hero_id     smallint not null references heroes(hero_id),
  patch_id    smallint references patches(id),   -- NULL = semua patch
  role        smallint not null,                 -- pos 1-5 (mapping lane_role F2)
  games       int      not null default 0,
  wins        int      not null default 0
);
create unique index hero_role_dist_uq
  on hero_role_dist (hero_id, coalesce(patch_id, 0), role);

-- Watermark incremental (mis. last_promatch_id)
create table ingest_state (
  key         text primary key,
  value       text,
  updated_at  timestamptz not null default now()  -- bookkeeping internal (bukan data sumber)
);

-- ============================================================
-- INDEX (sasaran query, slim)
-- ============================================================

-- matches: filter umum (turnamen, patch, tim, urut waktu)
create index matches_league_idx     on matches (league_id);
create index matches_patch_idx      on matches (patch_id);
create index matches_radiant_idx    on matches (radiant_team_id);
create index matches_dire_idx       on matches (dire_team_id);
create index matches_start_idx      on matches (start_time desc);

-- picks_bans: agregasi per hero (pick & ban tak punya endpoint → hitung di sini)
create index picks_bans_hero_idx    on picks_bans (hero_id);

-- match_players: lookup per player / per hero
create index match_players_acct_idx on match_players (account_id);
create index match_players_hero_idx on match_players (hero_id);

-- players: roster per tim
create index players_team_idx       on players (team_id);

-- derived: lookup per hero
create index team_hero_stats_hero_idx on team_hero_stats (hero_id);

-- ============================================================
-- RLS — READ-ONLY publik (anon/authenticated SELECT; tulis hanya service_role)
-- service_role (worker ingest) bypass RLS, tak butuh policy write.
-- ============================================================

alter table patches               enable row level security;
alter table leagues               enable row level security;
alter table teams                 enable row level security;
alter table players               enable row level security;
alter table heroes                enable row level security;
alter table matches               enable row level security;
alter table picks_bans            enable row level security;
alter table match_players         enable row level security;
alter table tournament_hero_stats enable row level security;
alter table team_hero_stats       enable row level security;
alter table hero_pairs            enable row level security;
alter table hero_role_dist        enable row level security;
alter table ingest_state          enable row level security;

create policy read_patches      on patches               for select using (true);
create policy read_leagues      on leagues               for select using (true);
create policy read_teams        on teams                 for select using (true);
create policy read_players      on players               for select using (true);
create policy read_heroes       on heroes                for select using (true);
create policy read_matches      on matches               for select using (true);
create policy read_picks_bans   on picks_bans            for select using (true);
create policy read_match_players on match_players        for select using (true);
create policy read_thstats      on tournament_hero_stats for select using (true);
create policy read_teamhstats   on team_hero_stats       for select using (true);
create policy read_heropairs    on hero_pairs            for select using (true);
create policy read_heroroles    on hero_role_dist        for select using (true);
create policy read_ingest       on ingest_state          for select using (true);
