# M1 → M2 交接文档

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-02 |
| 交接对象 | 新的 0 号总管理会话 |
| 仓库 | `D:\github-mine\petbattle`（remote: `https://github.com/dongyun001/Hatchduel`） |
| 当前 main | `7fe2aa6` |
| 已完成里程碑 | M0（contract-v1）、M1 / MVP-A（tag `m1`） |
| 下一步 | M2 / MVP-B：账号、云存档、异步 PvP、排行榜 |
| 文档权威 | 产品范围：`docs/PRD.md` §13/§14；技术交付：`docs/TECH_DESIGN.md` §19；联机：`docs/ONLINE_DESIGN.md` §14 |

> 本文件替代上一轮会话的上下文。新会话 0 开工先读 `AGENTS.md`、`docs/INDEX.md`、`docs/CONTRACT.md`、本文件，再按 §7 启动。

---

## 1. 一句话状态

M1 已验收：圈养/繁殖/战斗/放生/本地+云存档闭环可玩，455 测试、core 覆盖率约 99%，客户端已在微信真机连上本地服务端。M2 尚未开始，**PvP/排行榜契约还没定**，这是新会话 0 的第一件事。

---

## 2. 仓库、分支与环境

### 2.1 目录与 worktree

| 用途 | 路径 | 分支 | 当前提交 |
|---|---|---|---|
| 主仓库 / Lead | `D:\github-mine\petbattle` | `main` | `7fe2aa6` |
| A 核心 | `D:\github-mine\petbattle-core` | `wt/core` | 已合并，停在 main |
| C 服务端 | `D:\github-mine\petbattle-server` | `wt/server` | 已合并，停在 main |
| D 内容 | `D:\github-mine\petbattle-content` | `wt/content` | 已合并，停在 main |
| B 客户端 | `D:\github-mine\petbattle-client` | `wt/client` | 已合并，停在 main |
| 契约旧 worktree | `D:\github-mine\petbattle-contracts` | `wt/contracts` | 已合并，停在 main |

- 所有分支已合并进 `main`；`main` 与全部 tag 已推送到 GitHub。
- `wt/*` 分支本身没有单独推送到远程（只是本地并行记录）；需要留档可再推。
- 所有 worktree 共用同一个仓库对象库；不要在两个 worktree 同时跑 `pnpm install`。

### 2.2 环境

| 项 | 值 |
|---|---|
| Node | 24（CI 用 20，target ES2020） |
| pnpm | 10.34.5（`packageManager` 已固定） |
| TypeScript / Vitest / ESLint | 5.9 / 3.2 / 9 |
| Cocos Creator | 3.8.8，`C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe` |
| 微信开发者工具 | 已装；测试 AppID `wxb3a3bc030a88e47f` |
| Docker | 29.x，可跑 `postgres:16-alpine` |
| 测试服务器 | 之前用 `192.168.43.7:3000`（网络换了会变） |

### 2.3 常用命令

```bash
# 根校验（Node 侧）
pnpm typecheck && pnpm test && pnpm lint && pnpm validate:config
pnpm test:coverage
pnpm sim                 # 平衡模拟；--ai=both|sim|core
pnpm sim --write         # 写 BALANCE 自动段落

# 服务端
PETBATTLE_STORE=memory pnpm dev
docker compose -f server/docker-compose.yml up --build
curl http://127.0.0.1:3000/health

# 客户端
node client/tools/sync-lib.mjs
node client/tools/sync-lib.mjs --check
node client/tools/typecheck.mjs
pnpm exec tsx client/tools/verify-errors.ts
pnpm exec tsx client/tools/verify-api-client.ts

# Cocos 构建（exit 36 才是 CLI 的成功码；实际本次返回 0，以产物为准）
"C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe" \
  --project "D:/github-mine/petbattle-client/client" \
  --build "platform=wechatgame;debug=false;startScene=a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
```

### 2.4 当前收尾状态

- 上一轮临时把 `client/assets/scripts/dev/devConfig.ts` 改成 `useServer=true` + 固定 LAN IP，**已还原为 mock 默认**。
- 后台 dev server 已停止，3000 端口空闲。
- `client/build/**` 是构建产物（已 gitignore）：`build/wechatgame-server` 是上一轮真机测试包，内含旧 IP 和测试 AppID，不能作为基线，重新构建前不要复用。
- 根目录有三个未跟踪文件：`assets/logo-lockup.svg`、`assets/logo-mark.svg`、`assets/logo-petbattle.jpg`。来源不明、未提交；新 0 号决定是否入库。

---

## 3. M0/M1 已交付

### 3.1 契约与标签

| tag | 含义 |
|---|---|
| `contract-v1` | M0 契约冻结：protocol v1、core 公共签名、配置 schema、server Hello、CI |
| `contract-v1.1` | `BASE_REVISION_HEADER` |
| `contract-v1.2` | `releasePet` 加 cfg、`BreedResult.parentCooldowns`、`autoCommand`、`applyExp`、栖息地字段 |
| `contract-v1.3` | `/habitat/move`、测试解耦、AI 留能量、PvE setup、`in_defense`、`hit` 加法 |
| `contract-v1.4` | `applyProfilePatch`、`startBreeding`、技能回合冷却 |
| `contract-v1.5` | `runBattle`、`applyPveRewards`、`claimBreeding`；PvE 会话/奖励/繁殖领取规则（CONTRACT §7.4 E-01~E-08） |
| `m1-a` | MVP-A 主循环闭环 |
| `m1` | MVP-A 完整验收（放生/本地存档/计时/P-121） |

### 3.2 包与职责

- `packages/protocol`：29 条路由（24 写）、`ApiResponse`、错误码、DTO、`BattleRewards = PveRewards` re-export。
- `packages/core`：RNG、ConfigRepo、deriveStats、advancePet/Habitat/Profile、繁殖/近亲/放生、战斗引擎+AI、PvE 重放/奖励、`startBreeding`、`claimBreeding`、`applyProfilePatch`、技能冷却、栖息地 6 个操作。**无桩**。
- `server`：Node 20+、node:http 轻量路由、guest 登录/刷新、profile 读写、revision/幂等、栖息地、宠物 rename/lock/release、编队、PvE 会话（30min TTL）、繁殖 start/claim、Postgres + 迁移台账、审计、strict 模式。
- `client`：Cocos 3.8.8；Boot/Home/Habitat/PetList/PetDetail/Breeding/StageSelect/Battle；平台适配器（wx/web/steam）；ApiClient；mock/server 双模式；本地存档；放生/锁定；PvE/繁殖完整交互。
- `packages/sim`：双 AI 批量战斗、经济两条口径、繁殖 5000 样本、静态检查 14 项。
- `tools`：`validate:config`、配置加载。

### 3.3 测试与验收证据

- `pnpm test`：**455 passed / 36 文件**。
- core 行覆盖率约 99%，分支 93%+，函数 100%。
- 客户端 `sync-lib --check`、`typecheck.mjs`、`verify-errors.ts`（9 码）、`verify-api-client.ts` 通过。
- 服务端内存 + Postgres：登录/编队/PvE start→claim→奖励、繁殖 start→claim、栖息地 move→release、重启持久化、迁移台账。
- 真机：微信预览连本地服务端成功（Home 3 宠、请求 200）。
- 平衡（content 0.5.0，core AI 主口径）：分关 0.979 / 0.825 / 0.614 / 0.589 / 0.480，平均 9.91 回合；sim AI 0.934 / 0.788 / 0.450 / 0.380 / 0.557。

---

## 4. 必须继承的契约与纪律

1. `packages/core` 纯 TS：无 `cc`/`wx`/DOM/网络/`Math.random`/`Date.now`/超越函数；时间 `EpochMs` 与 `Rng` 由调用方注入。
2. 服务器权威：客户端只交动作；写操作必须 `Idempotency-Key` + `X-Base-Revision`；409 返回最新档；PvE 由服务端从 setup+seed 重放。
3. 类型单一来源：领域类型在 core，protocol 只 re-export/加传输壳；禁止复制。
4. 配置数据驱动：`config/data/**` 归内容；schema/公式归核心。
5. 一个目录一个会话；共享文件（根配置、protocol、CONTRACT、INDEX、AGENTS 等）只由 0 号改。
6. 契约变更流程：`docs/CONTRACT.md` §9；破坏性变更升 v2；兼容变更记 v1.x。
7. 每批交付必须带测试；core 覆盖率 ≥85%；确定性双跑一致。

---

## 5. 已知缺口 / 技术债

### 5.1 阻塞 M2 的

1. **M2 契约未定义**：PvP 匹配、防守快照、战报、段位、排行榜口径都还没定（见 §6）。
2. **PvP/排行榜服务端未实现**：`/pvp/defense|opponent|fight|replay/:id`、`/leaderboard` 路由已在 protocol，server 返回 404。
3. **微信/Steam 登录未实现**：只有 guest；`/auth/wechat|steam`、`/account/bind|unbind` 未接。
4. **`createRng(seed)` 未从 core 公共入口导出**（E-09）：服务端暂用 CSPRNG 适配；建议并入 M2 的 core 批次。
5. **限流/异常检测未做**：2C2G 下 PvP 模拟需要限并发（已有 Semaphore 位，未接线）。

### 5.2 非阻塞，但 M2 UI 前建议处理

1. **UI kit / 三态 / 安全区**：页面是手写场景 + 零散节点；加载/空/错误态不统一；建议先抽组件再写 PvP/排行 UI。
2. **构建配置漂移**：Cocos CLI 的 `orientation=landscape` 参数不生效，`game.json` 默认 portrait；AppID 和 `urlCheck` 只在上次构建产物里手工改过。**需要 B 在构建配置或脚本里固定横屏/AppID/URL 校验**（建议记为 P-123）。
3. **列表虚拟化、宠物改名 UI、独立编队页**未做；编队目前只在 StageSelect 内。
4. **错误态运行时覆盖不足**：`BATTLE_NOT_FOUND` / `VALIDATION_FAILED` 只有静态文案校验；`PET_IN_USE` 的编队/防守分支未在运行时构造。
5. **正式美术/音频未开始**：全部占位图；ART_SPEC 规格已定，按 M3 推进。
6. **Steam 端未做**：M4。
7. **开发默认密钥**：`PETBATTLE_TOKEN_SECRET` 默认值、compose Postgres 密码。公开仓库可接受，但上线前必须改为环境变量注入。

### 5.3 已修复但值得知道

- P-121/P-122：放生未领取孵化体会留下悬空蛋 id；已在 core 清理 + server patch 下发，Postgres 验证通过。
- P-050：迁移盲跑会清空 PvE 会话；已加 `schema_migrations` 台账。
- P-049：sim 自带 AI 与 core `autoCommand` 曾漂移；D 已加双 AI 口径。

---

## 6. M2 范围与需要先定的契约

来源：`PRD.md` §13.2/§14、`TECH_DESIGN.md` §19、`ONLINE_DESIGN.md` §6/§7/§14 Phase 1。

### 6.1 范围（MVP-B）

- 账号：游客已有；补微信 `code2session`、Steam ticket、绑定/解绑。
- 云存档：已有 Postgres + revision，需补跨端与离线同步策略（Steam 离线后置）。
- 异步 PvP：防守阵容快照、匹配、服务器全自动结算、战报回放、段位变化。
- 排行榜：段位/图鉴/最佳基因/世代；Demo 先 DB/内存，Redis 后置。
- 好友互访属于 Phase 2，不在 MVP-B，不要提前做。

### 6.2 必须在 contract-v1.6 定死的点

| 议题 | 需要定 |
|---|---|
| 防守快照 | 存 `BattleUnitInit[]` 还是 `BattleSetup`；24h 有效期；过期后“重新设置”还是“用最近有效快照”（ONLINE §6.2 两句话有歧义，必须二选一）；配置变更不回溯 |
| 匹配 | 段位/等级权重、每日挑战次数、冷启动机器人规则与标记、是否允许同账号互打 |
| 异步结算 | 双 AI 重放（core `autoCommand`）、战报存储（setup+seed+commands+events）、保留天数、版本兼容 |
| 段位 | Elo/Glicko 简化版、胜/负/平 K 值、赛季软重置、初始分 |
| 排行榜 | 四个榜的具体指标（bestGene 是否四项均值、codex 是否含未拥有）、前 N + 自己、分页、赛季 key |
| 反作弊/限流 | 每日次数、快照篡改、模拟并发上限、异常检测 |
| 机器人 | 是否计榜、是否标记、阵容来源（MVP 可用 5 物种固定模板） |

建议在 `docs/CONTRACT.md` 新增 §7.5（F-01…），协议侧只加必要字段/错误码，不改已有 v1 语义。

---

## 7. 给新会话 0 的启动步骤

1. **读**：`AGENTS.md`、`docs/INDEX.md`、`docs/CONTRACT.md`（§3/§4/§7.4/§11）、`PRD.md` §13.2/§14/§17、`ONLINE_DESIGN.md` §4~§7/§14、`TECH_DESIGN.md` §10~§13/§16.1、`PITFALLS.md`。
2. **验基线**：确认 `main` 干净、`pnpm install` 已装；跑 `typecheck/test(455)/lint/validate:config`；客户端 `sync-lib --check`。处理三个未跟踪 logo 文件（入库或忽略）。
3. **定契约**：按 §6.2 写 contract-v1.6（建议先只定 PvP + 排行榜，微信/Steam 登录可后置）。先改 protocol 的 DTO/错误码/端点常量，保持 main 绿。
4. **建会话**：建议先开 **3 个**——A 核心、C 服务端、B 客户端；D 内容在需要机器人阵容/赛季配置时再加，上限 4。E 美术继续暂停。
5. **派完整批次**：每批包含该会话全部改动、测试、验收，不允许“先做一半等别人”；合并顺序 A → C → B。
6. **验收 M2**：两个账号完成异步 PvP、战报可回放、段位变化、排行榜正确；2C2G 下模拟限并发可跑。

### 7.1 会话建议（新 0 自行决定）

| 会话 | M2 主要工作 |
|---|---|
| A 核心 | 导出 `createRng`；PvP 快照/重放所需的 core 辅助（若需要）；段位计算若决定放 core；确定性回归 |
| C 服务端 | 微信/Steam 登录、防守快照存储/过期、匹配、异步结算、战报、段位、排行榜、限流；工作量最大 |
| B 客户端 | 先 UI kit/三态/安全区/横屏构建固定；再做 PvP 防守/对手/战报/排行榜页面；接真实接口 |
| D 内容 | 机器人阵容模板、赛季/榜位配置、平衡复测（按需，不必一开始就开） |
| E 美术 | 暂停到 M3 |

### 7.2 新 0 的第一批交付（建议）

1. `docs/CONTRACT.md` §7.5 + contract-v1.6 裁定表。
2. protocol 增量（PvP 快照/战报/排行榜 DTO、必要错误码）。
3. `docs/UI_BACKLOG.md`（现在修 / M2 / M3），把 UI kit、三态、适配、构建配置漂移列清楚。
4. 重建 3 个 worktree/分支（或复用现有的，先确认干净）并完成依赖安装。
5. 给 A/C/B 的完整批次提示词。

---

## 8. 速查：当前实现了什么、没实现什么

**已实现端点**

`/auth/guest|refresh`、`/profile`、`/profile/rename`、`/habitat/{move,collect,feed,clean,play,upgrade}`、`/pets/:id/{rename,lock,release}`、`/lineup/set`、`/battle/pve/{start,claim}`、`/breeding/{start,claim}`、`/health`。

**未实现端点**

`/auth/wechat|steam`、`/account/bind|unbind`、`/pvp/{defense,opponent,fight,replay/:id}`、`/leaderboard`、`/friends*`（Phase 2）。

**已知刻意后置**

交易、公会、赛季、实时房间、宠物死亡、转生、抽卡、付费、Steam、正式美术。

---

## 9. 交接检查清单

- [ ] `main` 干净，remote 可推（GitHub 凭据已在 Credential Manager）
- [ ] 三个未跟踪 logo 文件已决定去留
- [ ] `pnpm test` = 455，客户端检查通过
- [ ] 旧 dev server 已停止（3000 空闲）；需要时用 `PETBATTLE_STORE=memory pnpm dev` 重启
- [ ] 上一轮真机测试包（`client/build/wechatgame-server`）不作为基线
- [ ] M2 契约（§6.2）逐项有裁定
- [ ] 新 worktree/分支与依赖就绪
- [ ] A/C/B 批次提示词写好，合并顺序明确
