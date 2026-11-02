-- 003: 异步 PvP 与排行榜（contract-v1.6 F-01/F-03/F-05）。
--
-- 迁移只向前加表/索引，不删不改；由 `schema_migrations` 台账保证只执行一次（P-050）。
-- 所有时间列仍用 double precision epoch ms。

-- 防守快照：存 BattleUnitInit[]，不存 BattleSetup（seed 每场由服务端生成）。
-- 过期快照仍是合法对战输入（F-01），所以没有删除策略；GET /pvp/defense 返回 stale。
create table if not exists pvp_defense_snapshots (
  account_id text primary key references accounts (id) on delete cascade,
  pet_ids jsonb not null,
  units jsonb not null,
  content_version text not null,
  created_at double precision not null,
  expires_at double precision not null
);

create index if not exists pvp_defense_snapshots_expiry_idx
  on pvp_defense_snapshots (expires_at);

-- 战报：setup + seed + commands + events 全部落库；回放以 events 为准（F-06）。
-- winner 允许 null（30 回合平局）。
create table if not exists pvp_replays (
  replay_id text primary key,
  attacker_id text not null references accounts (id) on delete cascade,
  defender_id text not null,
  is_bot boolean not null,
  season_id text not null,
  -- core / 配置版本；BattleReplay.version 取它（F-06）。
  content_version text not null,
  setup jsonb not null,
  seed double precision not null,
  commands jsonb not null,
  events jsonb not null,
  winner integer,
  turns integer not null,
  attacker_rating_before double precision not null,
  attacker_rating_after double precision not null,
  defender_rating_before double precision not null,
  defender_rating_after double precision not null,
  created_at double precision not null,
  expires_at double precision not null
);

create index if not exists pvp_replays_defender_idx
  on pvp_replays (defender_id, created_at);

create index if not exists pvp_replays_attacker_idx
  on pvp_replays (attacker_id, created_at);

create index if not exists pvp_replays_season_idx
  on pvp_replays (season_id, created_at);

create index if not exists pvp_replays_expiry_idx
  on pvp_replays (expires_at);

-- 每日挑战次数：PK(account_id, day_key)，day_key 为 Asia/Shanghai 日期（YYYY-MM-DD）。
create table if not exists pvp_daily_counters (
  account_id text not null references accounts (id) on delete cascade,
  day_key text not null,
  used integer not null default 0,
  primary key (account_id, day_key)
);

-- 段位榜按赛季 + rating 排序（F-05）。rating 在 profiles.data 的 jsonb 里，
-- 用表达式索引支撑 Demo 规模下的榜单扫描；M3 迁到独立列/Redis 时可替换。
create index if not exists profiles_pvp_season_rating_idx
  on profiles (
    ((data #>> '{pvp,seasonId}')),
    (((data #>> '{pvp,rating}')::double precision))
  );
