-- 002: PvE 战斗会话正式结构（contract-v1.5 E-01）。
--
-- 001 里的 battle_sessions 是 M1 占位表（没有任何写入路径，也没有生产数据）。
-- 只在检测到旧占位列（id/kind）时重建；新库与已迁移库都不会触发 drop。
-- 迁移执行由 `schema_migrations` 记录，不会每次启动重跑。

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_name = 'battle_sessions'
       and column_name = 'id'
  ) then
    drop table battle_sessions;
  end if;
end $$;

create table if not exists battle_sessions (
  battle_id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  stage_id text not null,
  seed double precision not null,
  -- 开战时的完整 BattleSetup 快照（含队伍/技能/属性/seed）；claim 时按它从零重放。
  setup jsonb not null,
  party_pet_ids jsonb not null,
  created_at double precision not null,
  expires_at double precision not null,
  status text not null default 'started'
);

create index if not exists battle_sessions_account_idx
  on battle_sessions (account_id, status);

create index if not exists battle_sessions_expiry_idx
  on battle_sessions (expires_at);
