# M2 并行会话启动提示词（contract-v1.6）

| 项 | 内容 |
|---|---|
| 用途 | 复制代码块给独立会话；每块是一个**完整批次**（改动 + 测试 + 验收） |
| 依据 | `main` 的 `contract-v1.6` tag、`docs/CONTRACT.md` §7.5、`docs/COLLABORATION.md` |
| 维护者 | 0 号（Lead） |
| 日期 | 2026-11-02 |
| 范围 | MVP-B：异步 PvP + 排行榜（微信/Steam 登录后置） |

---

## 0. 会话数量与节奏（0 号决定）

**开 3 个会话：A 核心、C 服务端、B 客户端。** D 本批不开（第 4 个名额留给“机器人模板/赛季配置必须数据化”时才启用）；E 美术暂停到 M3。

| 会话 | worktree | 分支 | 启动时机 | 合并顺序 |
|---|---|---|---|---|
| A 核心 | `D:\github-mine\petbattle-core` | `m2/a-core` | 立即 | 1 |
| B 客户端 | `D:\github-mine\petbattle-client` | `m2/b-client` | 立即（先 UI kit + mock 页面） | 3 |
| C 服务端 | `D:\github-mine\petbattle-server` | `m2/c-server` | **A 合并后** | 2 |

- B 可以先用 mock 做 UI，但**合并前**必须完成真实接口接线与两账号验收；mock 版本不得合入 main。
- C 必须基于 A 合并后的 main；开工先确认 `@petbattle/core` 已导出 `createRng/buildDefenseSnapshot/buildPvpBattleSetup/applyPvpOutcome`。
- 合并顺序固定 **A → C → B**；每次合并后 0 号跑全量基线，失败由对应会话修。
- 不要并行 `pnpm install`；不要同时开两个 Cocos Creator。

### 启动前（0 号已做）

- `main` 已打 `contract-v1.6`；protocol 增量与三个错误码已入库。
- 三个 worktree 已重置到该提交；依赖已安装。
- 基线：`pnpm typecheck / test（455）/ lint / validate:config`、`node client/tools/sync-lib.mjs --check` 全绿。

---

## 1. A —— 核心领域（批次 A1）

工作目录：`D:\github-mine\petbattle-core`（分支 `m2/a-core`）

```
你负责 PetBattle 的 A 核心领域会话（M2 批次 A1，contract-v1.6）。

工作目录：D:\github-mine\petbattle-core
分支：m2/a-core（基于 main 的 contract-v1.6）
开工先跑：git status（必须干净）、git log -1（应能看到 contract-v1.6 相关提交）。

只改：packages/core/**（除 packages/core/src/config/data/**）、packages/core/test/**、docs/DOMAIN_MODEL.md。
不要改：packages/protocol/**、server/**、client/**、packages/core/src/config/data/**、packages/sim/**、
        根配置/tsconfig/ESLint/CI、docs/CONTRACT.md、AGENTS.md、docs/PRD.md、docs/TECH_DESIGN.md。

开工前按顺序读：
1. AGENTS.md（纯度、确定性、汇报格式）
2. docs/CONTRACT.md §5、§7.5（F-01/F-03/F-09）、§8.1、§9
3. docs/DOMAIN_MODEL.md（战斗输入、Profile、派生属性）
4. docs/PITFALLS.md（P-030/P-031/P-032/P-039~P-041）
5. packages/core/src/api.ts、types/profile.ts、types/battle.ts、battle/setup.ts、
   profile-patch.ts、rng.ts、errors.ts、index.ts

契约已冻结：不要改已有导出签名、constants 数值、schema 语义。
确实不够用时：不要私改，按 CONTRACT §9.3 写变更请求；能绕开的先绕开并在报告里写明。

本批任务（全部完成再交付，不要只做一半）：
1. createRng(seed: number): Rng
   - 复用 mulberry32；从 packages/core/src/index.ts 公共入口可见（关闭 E-09）。
   - 测试：同种子序列一致、不同种子不同、Rng 接口与现有实现一致。
2. PvpState 增加可选字段
   - `ranked?: { wins: number; losses: number; draws: number }`（真人排位战绩）。
   - 不破坏现有构造；检查所有直接构造 PvpState 的测试/工厂，按需补默认。
3. buildDefenseSnapshot(profile, petIds, now, cfg)
   - 返回 { petIds, units, contentVersion, createdAt, expiresAt }。
   - 校验：1~MAX_LINEUP_SIZE、去重、存在、非蛋；失败抛 DefenseError(reason)。
   - units 的 uid 固定 d0/d1/d2；stats 用 deriveStats；skills/traits/passive 与 buildBattleSetup 同口径。
   - contentVersion = cfg.contentVersion；expiresAt = now + DEFENSE_SNAPSHOT_TTL_MS（24h，导出常量）。
   - 纯函数：不改 profile/pets。
4. buildPvpBattleSetup(attackerPets, defenseUnits, cfg, seed): BattleSetup
   - team0 = attacker（uid a0..），team1 = defense（uid 重排 b0..）；不得改入参数组。
   - 空队或超过 3 只抛错；同 setup/seed 必须逐事件确定（复用 BattleEngine）。
5. applyPvpOutcome(profile, outcome): { profile, patch }
   - outcome: { result: 'win'|'loss'|'draw'; ranked: boolean; ratingAfter: number; seasonId: string }。
   - ranked=true：pvp.rating = ratingAfter，pvp.ranked 对应 +1；ranked=false：rating 必须等于原值，ranked 不变。
   - stats.battlesWon/Lost 按 result 计（平局不计）；pvp.seasonId 写入 outcome.seasonId。
   - patch.fromRevision = patch.toRevision = profile.revision；不推进时间、不改 lastEvaluatedAt（保持原值）。
   - 纯函数：不改入参；Elo 公式不在 core 实现（服务端负责）。
6. 测试（新增，不改旧测试语义）
   - createRng 序列；防守快照四类错误；快照属性与 buildBattleSetup 同宠物一致；
   - team1 uid 重排且 a/b 唯一；同 setup/seed 双跑事件指纹一致；
   - applyPvpOutcome 胜/负/平/机器人、ranked 计数、patch 形状、纯函数；
   - 覆盖率不低于现有（行 ≥98%）。
7. docs/DOMAIN_MODEL.md 补一段“PvP 防守快照与结算辅助”（只写实现细节，不改产品决策）。

验收（在 worktree 内）：
pnpm typecheck
pnpm test
pnpm lint
pnpm test:coverage   # 确认 core 行覆盖率

交付报告按 AGENTS.md §7 的格式；写清接口变化与给 C 的接线点。
不要自行合并到 main；0 号负责合并。
```

---

## 2. C —— 服务端（批次 C1）

工作目录：`D:\github-mine\petbattle-server`（分支 `m2/c-server`）

```
你负责 PetBattle 的 C 服务端会话（M2 批次 C1，contract-v1.6）。

工作目录：D:\github-mine\petbattle-server
分支：m2/c-server（基于 A 已合并后的 main）
开工先确认：
  git status 干净；git log -1 能看到 contract-v1.6 与 A 的批次提交；
  pnpm exec tsx -e "import { createRng, buildDefenseSnapshot, buildPvpBattleSetup, applyPvpOutcome } from '@petbattle/core'; console.log(typeof createRng, typeof buildDefenseSnapshot, typeof buildPvpBattleSetup, typeof applyPvpOutcome)"
  四个都必须是 function；否则停止 PvP 战斗部分，先做存储/迁移/排行榜，并在报告里写明阻塞。
  注意：不要用 `node -e "import('@petbattle/core')"`（源码用 .js 扩展名指向 .ts，Node 直跑会 ERR_MODULE_NOT_FOUND，见 P-040）。

只改：server/**（含 src/storage/migrations、server/test）、docs/ONLINE_DESIGN.md。
不要改：packages/**、client/**、根配置/CI、docs/CONTRACT.md、AGENTS.md、docs/PRD.md。

开工前按顺序读：
1. AGENTS.md
2. docs/CONTRACT.md §4（协议）、§5（core）、§7.5（F-01~F-11）、§8.3、§9
3. docs/ONLINE_DESIGN.md §4~§7、§11、§16（现有实现记录）
4. docs/PITFALLS.md P-022/P-027/P-029/P-049/P-050/P-105/P-116
5. server/src/{config.ts,errors.ts,deps.ts,concurrency.ts}、services/{profile-service,battle-service,idempotency}.ts、
   storage/{types,memory,postgres,pg-driver,migrations}、routes/{write-shell,index}.ts

本批任务（全部完成再交付）：
1. 存储与迁移
   - 新增 003_pvp.sql（进 schema_migrations 台账，可重复执行、不丢数据，P-050）：
     * pvp_defense_snapshots(account_id PK, pet_ids jsonb, units jsonb, content_version, created_at, expires_at)
     * pvp_replays(replay_id PK, attacker_id, defender_id, is_bot, season_id, setup jsonb, seed,
       commands jsonb, events jsonb, winner, turns, attacker_rating_before/after,
       defender_rating_before/after, created_at, expires_at)
     * pvp_daily_counters(account_id, day_key, used, PK(account_id, day_key)) 或等价
     * 必要索引：defender_id+created_at、attacker_id+created_at、season+rating、expires_at
   - Store 接口补：savePvpDefense/getPvpDefense/listPvpCandidates、createPvpReplay/getPvpReplay、
     getDailyUsed/incrementDailyUsed（原子）、leaderboard 查询（或由服务层用 listProfiles）。
   - memory 与 Postgres 双实现；重启后数据不丢。
2. 配置
   - ServerConfig 增加 PvpSettings，默认值按 CONTRACT §7.5 F-04 表；环境变量覆盖；
     保留现有 pvpSimulationConcurrency（Semaphore 已存在，接线）。
3. 端点（全部按 §7.5）
   - POST /pvp/defense：校验 1~3/去重/存在/非蛋；core.buildDefenseSnapshot；
     写快照 + profile.pvp.defense；revision CAS + patch；返回 ProfileWriteResponse。
   - GET /pvp/defense：未设置返回 200 + defense 缺省；stale = now > expiresAt。
   - GET /pvp/opponent：候选、窗口 200→600→∞、rating/avgLevel/accountId 排序、
     最近 24h 3 个对手排除、机器人兜底；返回 challengesRemaining/dailyLimit/seasonId。
   - POST /pvp/fight：按 F-03 全流程（服务器 seed、core.buildPvpBattleSetup、autoCommand 双 AI、
     Semaphore(2)、双方 rating/stats、replay 落库、幂等、审计、机器人不计分）。
   - GET /pvp/replay/:id：仅攻守双方可读；不存在 NOT_FOUND；超过 30 天 REPLAY_EXPIRED。
   - GET /leaderboard：四种 kind、资格、排序（value desc → rating desc → accountId asc）、
     limit 默认 20/最大 50、self/selfEligible、赛季校验；机器人排除。
4. 错误与限流
   - 使用协议新错误码 DAILY_LIMIT_REACHED / OPPONENT_UNAVAILABLE / REPLAY_EXPIRED；
     不改已有错误码语义。
   - 日报 10 次，按 Asia/Shanghai 00:00 切日；只由成功落库的 fight 扣；幂等重放不扣。
   - 同账号互打拒绝；客户端不能提交阵容/属性/seed/结果。
5. E-09 收尾
   - 删除本地 CSPRNG 适配，改用 core.createRng；更新注释与 docs/ONLINE_DESIGN.md §16。
6. 测试（memory + Postgres；新增 ≥25 个）
   - 防守：设置/读取/未设置/stale/非法 1~3/重复/蛋/不存在。
   - 匹配：窗口、排序、最近对手排除、机器人、自己排除、无候选。
   - 结算：Elo 胜/负/平、双方 stats、机器人不变分、日报、幂等、409/429/410、
     快照不回溯（改配置/升级后旧战报仍一致）。
   - 回放：双方可读、第三人 FORBIDDEN、过期 REPLAY_EXPIRED。
   - 排行榜：四榜 value/资格/排序/self/selfEligible/limit 上限/赛季错误。
   - 并发：同一防守方同时被两人打，rating 与 stats 不丢更新（P-105）。
   - Postgres：迁移 001~003、重启后快照/战报/评分仍在、两账号完整流程。
7. 文档
   - 更新 docs/ONLINE_DESIGN.md §16 的已实现端点、表结构、参数口径；不要改 §6/§7 的产品描述。

验收（在 worktree 内）：
pnpm typecheck
pnpm test
pnpm lint
PETBATTLE_STORE=memory pnpm dev   # 另开终端 curl 冒烟
docker compose -f server/docker-compose.yml up --build   # Postgres 全链路
全仓测试数不得低于 455；新增测试 ≥25。

交付报告按 AGENTS.md §7；写清迁移、端点、E2E 证据、遗留。
不要自行合并到 main；0 号负责合并。
```

---

## 3. B —— 客户端（批次 B1）

工作目录：`D:\github-mine\petbattle-client`（分支 `m2/b-client`）

```
你负责 PetBattle 的 B 客户端会话（M2 批次 B1，contract-v1.6）。

工作目录：D:\github-mine\petbattle-client
分支：m2/b-client（基于 main 的 contract-v1.6）
开工先跑：git status（干净）；node client/tools/sync-lib.mjs --check（应通过）。

只改：client/**（除 client/assets/art/**、client/assets/audio/**）。
不要改：packages/**、server/**、根配置/CI、docs/CONTRACT.md、AGENTS.md、docs/PRD.md。

开工前按顺序读：
1. AGENTS.md
2. docs/CONTRACT.md §4（协议）、§7.5（PvP/回放/排行榜）、§8.2
3. docs/UI_BACKLOG.md（本批 UI-01~UI-09 + M2-01~M2-09）
4. docs/ART_SPEC.md（尺寸/像素规则）、docs/PITFALLS.md P-103/P-116~P-123
5. client/assets/scripts/** 现有场景/服务/状态管理；client/tools/*.mjs

本批分两段，但**合并前必须两段都完成**：
A. 现在（不依赖 C）：UI kit + 三态 + 安全区 + 构建固定 + PvP 页面（mock）
B. C 合并后（0 号通知）：PvP 页面切真实接口、两账号验收、构建

任务 A（现在）：
1. UI kit 与三态（UI_BACKLOG UI-01~UI-03）
   - Button/Panel/Modal/Confirm/Toast/Tag/ResourceBar/PetCard/Loading；Loading/Empty/Error 三态。
   - 安全区组件；横屏逻辑分辨率 640×360 下无裁切。
   - 旧页面至少接入 3 个新组件，避免“只给新页面用”。
2. 构建配置固定（UI-04 / P-123）
   - 横屏 orientation、AppID、urlCheck、startScene 走构建脚本或模板，不再手改产物。
   - 在 client/README.md 写清构建命令与参数。
3. 协议同步
   - 跑 node client/tools/sync-lib.mjs 更新 assets/lib 与 assets/resources/config；不要手改生成文件。
4. PvP 页面（mock 优先，按 §7.5 DTO）
   - Home PvP 入口：段位、剩余次数、防守状态（未设置/已设置/stale）。
   - 防守设置页：1~3 只、非蛋、快照时间/24h、stale 提示；调 POST/GET /pvp/defense。
   - 对手页：名称、段位、物种预览、平均等级、isBot 标记、刷新；调 GET /pvp/opponent。
   - 结果页：胜负/平、回合数、双方 rating 变化、replayId；调 POST /pvp/fight。
   - 战报回放页：只播 events，播放/暂停/倍速/跳到结算；调 GET /pvp/replay/:id；不重新模拟。
   - 排行榜页：四个 tab、前 N + self、selfEligible=false 文案；调 GET /leaderboard。
5. 错误与本地态
   - services/errors.ts 补 DAILY_LIMIT_REACHED / OPPONENT_UNAVAILABLE / REPLAY_EXPIRED；verify-errors.ts 覆盖。
   - devFaults 覆盖上述三个 + PET_IN_USE（编队/防守）。
   - 请求中禁用重复点击；409 用 latestProfile 重建；serverTime 偏移沿用现有实现。
6. 列表与改名（UI-05/UI-06/UI-07）
   - 宠物列表虚拟化（≥40 只节点数受控）；PetDetail 改名；编队编辑抽成可复用组件。

任务 B（C 合并后）：
7. 把 PvP 页面切真实接口（保留 DEV mock 开关）；两账号跑通：防守→匹配→fight→回放→排行榜。
8. 构建与冒烟
   - 统一用 `node client/tools/build.mjs --platform=...`；脚本固定 Boot uuid 并断言 launchScene。
     Cocos 3.8.8 CLI 不认 `startScene=db://assets/scenes/Boot.scene`（P-118 / P-125），不要手写。
   - web-mobile + wechatgame 构建成功；WeChat 预览/真机冒烟；记录包体。
9. 验收脚本
   - node client/tools/sync-lib.mjs --check
   - node client/tools/typecheck.mjs
   - pnpm exec tsx client/tools/verify-errors.ts
   - pnpm exec tsx client/tools/verify-api-client.ts

约束：
- 只 import @petbattle/core 的类型/函数、@petbattle/protocol 的 ROUTES/ApiContract；不复制类型。
- app/ 不直接调 wx.*，走 platform/ 适配器。
- 回放只播 events，不能用本地重算覆盖服务端结果。
- mock 版本不得单独合入 main；合并前必须完成真实接口验收。

交付报告按 AGENTS.md §7；写清页面、构建参数、mock/server 两种模式的验收证据。
不要自行合并到 main；0 号负责合并。
```

---

### 3.1 B 任务 B 续跑提示词（A/C 已合并后）

> 当前 main 已含 A/C；B 分支已合并 main 并同步 core。复制下面整段给 B 会话。

```
你继续 PetBattle 的 B 客户端任务 B（contract-v1.6，A/C 已合并）。

工作目录：D:\github-mine\petbattle-client
分支：m2/b-client
开工先跑：git status（必须干净）、git log -1（应能看到 main 的 merge）：
  node client/tools/sync-lib.mjs --check   # 应通过
如果 check 失败，先 node client/tools/sync-lib.mjs 再继续。

背景（已完成）：
- A 的 core PvP 辅助（createRng/buildDefenseSnapshot/buildPvpBattleSetup/applyPvpOutcome）已在 main；
- C 的 /pvp/defense（POST/GET）、/pvp/opponent、/pvp/fight、/pvp/replay/:id、/leaderboard 已合并；
- 你上一批的 UI kit、三态、安全区、构建固定、PvP 五个 mock 页面已提交在 m2/b-client；
- 合并顺序是 A → C → B，本批完成后由 0 号合并，你不要自行合 main。

只改：client/**（除 client/assets/art/**、client/assets/audio/**）。
不要改：packages/**、server/**、根配置/CI、docs/CONTRACT.md、AGENTS.md、docs/PRD.md。
需要协议/服务端变更时停下来写变更请求，不要私改。

开工前读：
1. docs/CONTRACT.md §7.5（F-01~F-11）、§11.16、§11.17
2. docs/SESSION_PROMPTS_M2.md 本段
3. docs/UI_BACKLOG.md（M2-01~M2-09）
4. docs/PITFALLS.md P-103、P-116~P-125
5. client/README.md、client/tools/build.mjs、client/assets/scripts/services/{apiClient,pvpActions,errors}.ts

本批任务（全部完成再交付）：
1. 真实接口接线
   - 保留 DEV mock 开关；server 模式下 PvP 五个页面只走 ROUTES/ApiClient，不再走 mockPvp。
   - 确认不再有页面直接调用 mockPvp；mockPvp 只允许在 mock 模式使用。
   - 处理 409（latestProfile 重建）、429 DAILY_LIMIT_REACHED、409 OPPONENT_UNAVAILABLE、
     410 REPLAY_EXPIRED、PET_IN_USE（编队/防守）；请求在途禁用重复点击。
2. 两账号验收（真实服务端）
   - 账号 A：客户端（微信开发者工具或真机，server 模式），设置防守 + 出战线。
   - 账号 B：第二实例 / 清存储的新游客 / curl 登录，设置防守 + 出战线。
   - 跑通：A 防守 → A 匹配到 B（不出现自己）→ fight → 结果页 rating 双方变化 →
     A 读回放（events 完整、播放/暂停/倍速/跳结算）→ 四人榜（段位/图鉴/基因/世代）前 N+self。
   - 用 B 再打 A，确认防守方 rating/stats 在下一次 GET /profile 变化。
   - 机器人兜底：让场上只有一个真人候选，确认 isBot 标记、rating 不变、不计榜。
   - 快速边界（用环境变量起服务端）：
     * PETBATTLE_PVP_DAILY_LIMIT=1 → 第 2 次 fight 429；
     * PETBATTLE_PVP_SNAPSHOT_TTL_MS=1000 → 等待后 GET /pvp/defense stale=true；
     * PETBATTLE_PVP_REPLAY_TTL_MS=1000 → 等待后回放 410。
3. 构建与真机
   - 只用 node client/tools/build.mjs；不要手写 startScene=db://...（P-125）。
   - web-mobile + wechatgame 构建；记录包体（debug/release 分开）。
   - 微信预览/真机：横屏、AppID（模板内 touristappid 占位）、urlCheck=false、launchScene=Boot。
   - 备注：服务端没有 CORS；浏览器 web-mobile 直连 127.0.0.1:3000 会被拦。
     真实接口验收用微信开发者工具/真机，或临时本地同源代理；不要改 server/**。
   - 本地可用 storage 覆盖：petbattle.useServer=true、petbattle.apiBaseUrl=http://<LAN-IP>:3000；
     正式包/提交前确认 DEV_CONFIG 仍是 useServer=false。
4. 补上批欠账
   - PetList 虚拟列表与改名 UI 的视觉/交互验收（上次被 IAB splash 卡住）：
     用干净浏览器会话或微信开发者工具；40+ 宠物的列表节点数受控；改名 1~12 字/非法字符提示。
   - 防守/编队选择共用组件在两处都可用。
5. 验收命令
   - node client/tools/sync-lib.mjs --check
   - node client/tools/typecheck.mjs
   - pnpm exec tsx client/tools/verify-errors.ts
   - pnpm exec tsx client/tools/verify-api-client.ts
   - pnpm exec tsx client/tools/verify-pvp.ts
   - node client/tools/build.mjs --platform=web-mobile --debug
   - node client/tools/build.mjs --platform=wechatgame --debug
   - 如做 release，再跑一次 --release 并记录包体。

服务端启动（在 D:\github-mine\petbattle 主仓库，不要在 client 里改 server）：
  # Postgres（petbattle-db-1 已在 127.0.0.1:5433 运行；3000 端口已释放）
  DATABASE_URL=postgres://petbattle:petbattle@127.0.0.1:5433/petbattle PETBATTLE_STORE=postgres PORT=3000 pnpm dev
  # 或内存
  PETBATTLE_STORE=memory PORT=3101 pnpm dev

交付报告按 AGENTS.md §7：完成内容/改动文件/接口变化/测试与验证/未决问题/下一步。
必须写清：真实接口两账号证据、web/微信构建参数与包体、仍未闭合的项。
不要自行合并到 main；0 号负责合并。
```

---

## 4. D —— 内容与数值（可选，暂不启动）

只有出现“机器人阵容/赛季/榜位需要数据化”时才开，否则 M2 不动 D。

```
你负责 PetBattle 的 D 内容与数值会话（M2 可选批次 D1）。

工作目录：D:\github-mine\petbattle-content（分支 m2/d-content）
只改：packages/core/src/config/data/**、packages/sim/**、tools/content/**、docs/BALANCE.md。
不要改 schema/公式/protocol/server/client/根配置。

先读：AGENTS.md、docs/CONTRACT.md §6/§7.5、docs/DOMAIN_MODEL.md、docs/BALANCE.md、docs/PITFALLS.md P-049。

任务（按 0 号的实际缺口二选一）：
A. 若 C 需要外置机器人模板：与 A/0 确认 pvp.json schema 后再填；机器人 3 套×3 只，
   只用 MVP 5 物种、等级 5/8/12，标注“初版待 sim”。
B. 若只做平衡复测：跑 pnpm sim --ai=both，记录分关胜率/回合/平局/大招间隔；
   更新 docs/BALANCE.md 的自动段落；contentVersion 递增。

验收：pnpm validate:config（A 方案）；pnpm test；pnpm sim（B 方案）。
报告按 AGENTS.md §7；不要自行合并。
```

---

## 5. 0 号合并与 M2 验收清单

### 5.1 合并顺序

1. **A**：`git checkout main && git merge --no-ff m2/a-core` → 全量基线 → 通知 C 开工。
2. **C**：合并 `m2/c-server` → 全量基线 + Postgres 冒烟 → 通知 B 切真实接口。
3. **B**：合并 `m2/b-client` → 客户端四项检查 + 构建 → 打 `m2` tag。

每次合并前要求对应会话先 `git fetch` / 基于最新 main rebase；冲突由文件所有者解决，0 号合并。

### 5.2 每批必跑

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm validate:config
node client/tools/sync-lib.mjs --check        # 合并 B 时
node client/tools/typecheck.mjs               # 合并 B 时
pnpm exec tsx client/tools/verify-errors.ts            # 合并 B 时
pnpm exec tsx client/tools/verify-api-client.ts        # 合并 B 时
```

服务端合并后额外：

```bash
PETBATTLE_STORE=memory pnpm dev
curl -s http://127.0.0.1:3000/health
docker compose -f server/docker-compose.yml up --build
```

### 5.3 M2 退出条件（与 CONTRACT §7.5 F-10 一致）

- 两个账号完成：设置防守 → 匹配 → 自动结算 → 战报回放 → 段位变化 → 排行榜。
- 日报/幂等/409/429/410 都有运行时用例。
- 旧战报在配置/宠物变化后仍可播放。
- 2C2G 下 2 个并发模拟排队完成，无 5xx。
- Postgres 重启后快照/战报/评分仍在。
- `createRng` 导出，E-09 关闭。
- `pnpm test` 全绿且新增测试覆盖上述路径。
