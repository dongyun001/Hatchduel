-- PetBattle 初始迁移（contract-v1 / M1 服务端）
-- 迁移必须向前兼容：只加表/加列，不删不改语义（TECH_DESIGN §10.4，PITFALLS P-105）。
-- epoch ms 统一用 double precision：毫秒时间戳远小于 2^53，可直接被 JS 无损读取。

create table if not exists accounts (
  id text primary key,
  display_name text not null,
  region text not null,
  status text not null default 'active',
  created_at double precision not null,
  -- 一个外部身份只能绑定一个账号；三种平台各自唯一。
  guest_device_id text unique,
  wechat_openid text unique,
  steam_id text unique
);

create table if not exists profiles (
  account_id text primary key references accounts (id) on delete cascade,
  revision integer not null,
  data jsonb not null,
  updated_at double precision not null
);

create table if not exists sessions (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  refresh_token_hash text not null,
  created_at double precision not null,
  expires_at double precision not null,
  revoked_at double precision
);

create index if not exists sessions_account_idx on sessions (account_id);

-- 幂等：(scope, key) 唯一；scope 是 accountId 或 device:<deviceId>。
-- body 用 json 而不是 jsonb：重放要逐字节一致（jsonb 会重排 key 顺序）。
create table if not exists idempotency_keys (
  scope text not null,
  key text not null,
  fingerprint text not null,
  status integer not null,
  body json not null,
  created_at double precision not null,
  expires_at double precision not null,
  primary key (scope, key)
);

create index if not exists idempotency_expiry_idx on idempotency_keys (expires_at);

-- 审计：经济、繁殖、战斗、放生、改名都可追溯（ONLINE_DESIGN §11.2）。
create table if not exists audit_log (
  id bigserial primary key,
  at double precision not null,
  account_id text not null,
  action text not null,
  detail jsonb,
  request_id text
);

create index if not exists audit_log_account_idx on audit_log (account_id, at);

-- 异步 PvP 战斗会话（CONTRACT §10.2）：先建表留位，M1 不实现重放。
-- 快照必须存 BattleUnitInit[] 而不是引用实时宠物（PITFALLS P-027）。
create table if not exists battle_sessions (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  kind text not null,
  seed double precision not null,
  setup jsonb not null,
  created_at double precision not null,
  expires_at double precision not null
);
