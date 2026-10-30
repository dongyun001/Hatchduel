# 《宠物对决》联机设计（ONLINE_DESIGN）

| 项 | 内容 |
|---|---|
| 项目代号 | PetBattle |
| 文档版本 | v1.1 |
| 日期 | 2026-10-28 |
| 对应需求 | PRD v1.1 / TDD v1.1 |
| 状态 | 待评审 |

> 本文定义账号、云存档、异步 PvP、排行榜、社交、交易、实时房间、反作弊和部署。数据与算法见 `DOMAIN_MODEL.md`。

**修订记录**：

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-10-27 | 初版：账号/云存档/异步 PvP/反作弊 |
| v1.1 | 2026-10-28 | 新增 `/lineup/set`、`/pets/:id/release`；明确异步 PvP 全自动结算；排行榜 Demo 实现口径 |

---

## 1. 目标与非目标

### 1.1 目标

- 微信小游戏与 Steam 共用一套账号、存档和联机服务。
- 联机第一形态是**异步 PvP**，在玩家不足时也能玩。
- 服务器权威，客户端只提交动作，不提交结果。
- 能防住改时间、重放、刷货币、伪造战报这类常见作弊。

### 1.2 非目标

- 不做即时动作同步、帧同步、物理同步。
- 不做跨服大世界、实时语音、UGC 编辑器。
- MVP 不做交易、公会、赛季（Phase 2 再开）。

---

## 2. 身份模型

### 2.1 账号

```ts
interface Account {
  id: string;                    // 平台无关
  displayName: string;
  createdAt: EpochMs;
  region: 'cn' | 'global';
  bindings: {
    wechat?: { openid: string; unionid?: string };
    steam?: { steamId: string };
    guest?: { deviceId: string };
  };
  status: 'active' | 'banned' | 'deleted';
}
```

- **一个账号可以绑定多个平台**，但同一平台身份只能绑定一个账号。
- 游客账号先创建，再绑定微信/Steam。
- 账号 ID 不暴露给客户端以外的第三方；对外用短 ID/昵称。

### 2.2 绑定规则

| 场景 | 规则 |
|---|---|
| 游客 → 微信 | 绑定后游客身份并入微信账号；冲突时提示选择 |
| 微信 → Steam | 在设置页生成绑定码，Steam 端输入；或反向 |
| 同一微信已绑其他账号 | 拒绝，提示解绑或使用原账号 |
| 解绑 | 至少保留一个绑定；解绑有冷静期 |

### 2.3 昵称与展示

- 昵称唯一性不做强约束，用 `#短ID` 区分。
- 敏感词过滤；改名有冷却。
- 排行榜默认显示昵称，不显示平台 ID。

---

## 3. 认证流程

### 3.1 微信

```
客户端 wx.login()
  → code
  → POST /auth/wechat { code }
  → 服务器 code2session → openid / unionid
  → 查绑定 → 创建/登录账号
  → 返回 { token, refreshToken, account, profileRevision, serverTime }
```

- `openid` 按小游戏 appid 区分；`unionid` 用于同主体多应用。
- token 短有效期（如 2 小时），refresh token 长有效期。
- 服务器不保存微信 session_key 到日志。

### 3.2 Steam

```
客户端 Steamworks getAuthSessionTicket()
  → ticket
  → POST /auth/steam { ticket }
  → 服务器调用 Steam Web API 校验
  → 得到 steamId
  → 查绑定 → 创建/登录账号
```

- 必须校验 ticket，不能只信客户端传的 steamId。
- Steam 端可先做“Web 构建 + Electron”验证，再接原生 Steamworks。

### 3.3 游客

```
设备生成 deviceId（本地持久化）
  → POST /auth/guest { deviceId }
  → 创建/登录游客账号
```

- 游客账号可玩单机和异步 PvP 的有限功能。
- 提示绑定，避免换设备丢档。

### 3.4 Token

- JWT 或 opaque token；包含 `accountId`、`sessionId`、过期时间。
- 刷新时轮换 refresh token；检测重放。
- 封禁/删除账号时吊销全部会话。

---

## 4. 云存档

### 4.1 权威模型

- 服务器是唯一权威；客户端本地只做缓存和离线预测。
- 每次写操作：校验 → 核心计算 → 落库 → 返回 patch + revision。
- 客户端不能提交“我获得了 1000 金币”，只能提交“我领取了栖息地产出”。

### 4.2 同步流程

```
客户端动作
  → 本地乐观更新（可选，立即反馈）
  → POST /actions { action, payload, baseRevision, idempotencyKey }
  → 服务器：
       1. 鉴权
       2. 幂等检查
       3. 加载 profile，advanceProfile(now)
       4. 核心校验/计算
       5. 落库（revision++）
       6. 返回 { patch, revision, serverTime }
  → 客户端应用 patch；若 revision 不匹配则拉全量
```

### 4.3 冲突与离线

- `baseRevision` 不匹配：返回 `409` + 最新快照，客户端重建。
- Steam 离线：
  - 本地用同一 core 推进，排队动作。
  - 联网后提交 `lastSeenAt` + 队列；服务器复算并封顶。
  - 服务器赢；超额收益/diff 丢弃并提示。
- 客户端本地时间不可信；服务器拒绝未来时间戳。

### 4.4 存档版本与迁移

- `version` 每次结构变更递增。
- 迁移链：`1→2→3…`，在服务端执行；迁移前备份。
- 客户端只读服务器返回的当前版本，不做本地迁移。
- 迁移失败：回滚 + 告警，不返回半迁移数据。

---

## 5. API 设计

### 5.1 通用

- HTTPS + JSON；WSS 仅用于 Phase 3 实时房间。
- 统一响应：

```ts
interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  revision?: number;
  serverTime: number;
}
```

- 写操作必须带 `Idempotency-Key`。
- 错误码稳定；客户端按 code 处理。
- 限流：登录、写操作、PvP 更严格。

### 5.2 接口表（Phase 1）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/wechat` | 微信登录 |
| POST | `/auth/steam` | Steam 登录 |
| POST | `/auth/guest` | 游客登录 |
| POST | `/auth/refresh` | 刷新 token |
| POST | `/account/bind` | 绑定平台 |
| POST | `/account/unbind` | 解绑 |
| GET | `/profile` | 拉取完整档（或增量） |
| POST | `/profile/rename` | 改名 |
| POST | `/habitat/collect` | 领取产出 |
| POST | `/habitat/feed` | 喂食 |
| POST | `/habitat/clean` | 清理 |
| POST | `/habitat/play` | 玩耍 |
| POST | `/habitat/upgrade` | 升级栖息地 |
| POST | `/pets/:id/rename` | 宠物改名 |
| POST | `/pets/:id/lock` | 锁定/解锁 |
| POST | `/pets/:id/release` | 放生宠物 |
| POST | `/breeding/start` | 开始繁殖 |
| POST | `/breeding/claim` | 领取蛋/孵化 |
| POST | `/battle/pve/start` | 开始 PVE |
| POST | `/battle/pve/claim` | 领取奖励 |
| POST | `/lineup/set` | 设置出战编队（3 只） |
| POST | `/pvp/defense` | 设置防守阵容 |
| GET | `/pvp/opponent` | 获取对手 |
| POST | `/pvp/fight` | 发起异步战斗 |
| GET | `/pvp/replay/:id` | 拉取战报 |
| GET | `/leaderboard` | 排行榜 |
| GET | `/friends` | 好友列表 |
| POST | `/friends/:id/visit` | 访问好友 |

> `lineup`（出战编队）与 `pvp/defense`（防守阵容）是两个独立系统，互不联动。`lineup` 校验：最多 3 只、属于本人、非蛋；幼年可上阵（属性 70%）；引用必须存在。

### 5.3 幂等

- 客户端生成 UUID 作为 `Idempotency-Key`。
- 服务器按 `(accountId, key)` 存储结果；重复请求返回同一结果。
- 关键写操作有唯一约束（如领取产出、PvP 结算）。

---

## 6. 异步 PvP

### 6.1 流程

```
1. 玩家设置防守阵容（3 只）
   → 服务器保存快照：BattleUnitInit[] + 快照时间 + 有效期（24h）

2. 玩家点击“匹配”
   → 服务器按段位/等级选对手（优先异步阵容）
   → 返回对手概览（不暴露完整基因）

3. 玩家发起战斗
   → 服务器用同一 BattleEngine 模拟
   → 生成战报（setup + seed + commands + events）
   → 更新双方段位
   → 返回结果摘要 + replayId

4. 客户端播放战报
   → 拉取 replay，逐事件演出
```

> **Phase 1 为服务器全自动结算**：双方均由 AI 按确定性策略行动，攻方观看战报，不做手动操作。手动操作模式留到后续评估。

### 6.2 防守快照

- 保存 `BattleUnitInit[]`，不保存可变引用。
- 快照 24 小时有效；过期后玩家需重新设置，否则使用最近一次有效快照。
- 快照不包含玩家隐藏信息（基因具体值），只用于战斗。
- 配置变更不回溯修改历史快照，保证战报可复现。

### 6.3 匹配

- 优先段位接近、等级接近、在线状态不敏感。
- 冷启动：用机器人或系统阵容填充；机器人不计入排行榜或单独标记。
- 每个玩家每天可挑战次数有限，防止刷分。

### 6.4 段位

- 采用 Elo/Glicko 简化版；胜/负/平局不同 K 值。
- 赛季重置：软重置，保留部分段位。
- 奖励按赛季结算，不在每场直接发大量资源。

### 6.5 战报回放

- `replay = { setup, seed, commands, version }`。
- 服务端保存 30 天；客户端可分享短链（后续）。
- 回放只依赖 core 的确定性；core 版本升级后，旧战报用对应版本回放或只展示摘要。

---

## 7. 排行榜

- Redis Sorted Set；按赛季分 key。
- **Demo 2C2G 阶段接口不变**：先用 DB/内存实现，Redis 后置。
- 榜单：段位、图鉴、最佳基因、世代。
- 只展示前 N 名 + 自己的排名；防止全量拉取。
- 反作弊：异常分数进入审核队列，不直接展示。

---

## 8. 好友与互访（Phase 2）

- 好友通过短 ID/邀请链接添加。
- 访问好友栖息地：查看宠物、每日互助（加速/喂食）有次数上限。
- “偷取”类互动：每日上限、只能拿产出的一小部分、双方都有收益；需要防刷。
- 所有社交动作服务器校验，不能客户端直接加资源。

---

## 9. 交易（Phase 2，谨慎）

> **RMT = Real Money Trading（现实货币交易）**：玩家在游戏外用真实货币买卖账号、宠物、资源。风险包括诈骗、盗号、洗钱、工作室刷金、破坏经济。反 RMT 的手段是绑定、每日限额、交易税、日志、异常交易检测和封禁。

- **已定：MVP 不做交易，后置到 Phase 2 再评估。**
- 只允许特定宠物/物品；`locked` 宠物不可交易。
- 交易税/手续费；每日限额；账号等级/绑定要求。
- 禁止现实货币交易；异常交易进入审核。
- 交易日志不可篡改；支持回滚/封禁。
- 国内合规风险高，**默认不做**，除非明确评估通过。

---

## 10. 实时房间（Phase 3）

### 10.1 适用

- 好友约战、房间号邀请；不是主要匹配方式。
- 回合制，不需要高频同步；WebSocket 足够。

### 10.2 流程

```
创建房间 → 房间码 → 好友加入 → 双方准备
→ 服务器生成 seed，初始化 BattleEngine
→ 每回合：双方同时盲选 3 只宠物的指令
→ 服务器收齐（或超时补普攻）→ 按速度结算 → 广播事件
→ 一方全灭/30 回合 → 结算
```

### 10.3 输入模型

- **同时盲选**：双方看不到对方本回合选择，减少信息不对称。
- 每回合 30 秒；超时自动普攻（目标按 AI 规则）。
- 指令格式复用 `Command`；服务器校验回合、存活、精力、目标。
- 不能“先手玩家先选、后手看到再选”。

### 10.4 断线重连

- 客户端重连带 `roomId` + `lastSeq`。
- 服务器返回最新状态快照 + 未播事件。
- 超时未重连：判负或由 AI 接管（可配置）。

### 10.5 跨端

- 微信与 Steam 可以互通；延迟以服务器为准。
- 房间服务与账号服务共用；WSS 域名需微信白名单。

---

## 11. 反作弊

### 11.1 威胁模型

| 威胁 | 示例 |
|---|---|
| 客户端改数值 | 改金币、改宠物属性 |
| 改时间 | 本地时间快进刷离线收益 |
| 重放 | 重复提交领奖请求 |
| 伪造战报 | 客户端上报“我赢了” |
| 繁殖重 roll | 客户端反复刷新蛋的结果 |
| 交易 RMT | 线下买卖宠物/资源 |
| 多开/脚本 | 批量账号刷资源 |

### 11.2 控制

- **服务器权威**：所有经济、繁殖、战斗结果由服务器计算。
- **时间**：服务器时间 + 离线上限 + 异常检测。
- **幂等**：Idempotency-Key + 唯一约束 + 审计。
- **校验**：动作合法性、资源非负、容量、冷却、次数。
- **频率**：按账号/IP/设备限流；异常行为进审核。
- **战报**：服务器保存 replay；客户端只播放。
- **繁殖**：结果在服务端生成并落库；客户端只揭晓。
- **审计**：经济变更、交易、封禁可追溯。
- **客户端**：混淆/签名只提高成本，不作为安全边界。

### 11.3 异常检测

- 收益速率、宠物数量、繁殖频率、战斗胜率、交易模式。
- 超阈值进人工/自动审核；先限制，再封禁。
- 误封可申诉；保留证据。

---

## 12. 部署与运维

### 12.1 环境

| 环境 | 用途 |
|---|---|
| dev | 本地/开发服，mock 支付/登录 |
| staging | 真机/审核前验证 |
| prod | 正式 |

### 12.2 组件

- Node 20 + TypeScript（API + 异步 PvP 模拟）。
- PostgreSQL：账号、profile、宠物、战报、交易、审计。
- Redis：会话、限流、排行榜、匹配队列。
- OSS/CDN：配置、资源、战报导出。
- 微信：云托管或腾讯云容器；HTTPS/WSS 域名白名单。
- Steam：同一后端；Demo 单区域，后续再评估多区域。
- **Demo 部署（2C2G）**：单台 2C2G 跑 Node + PostgreSQL；Redis 先不上（或用托管），排行榜/限流先用内存/DB；异步 PvP 模拟限并发。详见 `TECH_DESIGN.md` §16.1。

### 12.3 发布

- 数据库迁移向前兼容；先迁移后发版。
- 配置热更新带版本号；客户端不兼容时提示更新。
- 灰度：按账号/平台放量。
- 回滚：保留上一版本镜像和配置。

### 12.4 监控

- 指标：登录成功率、API p95、PvP 匹配成功率、模拟耗时、错误率、异常收益告警。
- 日志：结构化 JSON，带 `requestId`、`accountId`、`action`。
- 审计：经济、繁殖、交易、封禁。

---

## 13. 合规

- **微信**：小游戏类目、主体、软著、版号/备案、实名与防沉迷；以最新规则为准。
- **随机**：繁殖概率在 UI 公示；若涉及付费随机，按监管要求披露。
- **交易**：虚拟物品交易限制；默认不做，做则先评估。
- **隐私**：收集最小化；隐私政策；账号注销/数据导出。
- **Steam**：全球版与蒸汽平台规则不同；退款、地区、支付。
- **未成年人**：时长/消费限制；家长控制（若平台要求）。

---

## 14. 路线图

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| Phase 1（MVP-B） | 账号、云存档、异步 PvP、排行榜 | 两账号对战、战报回放、段位正确 |
| Phase 2 | 好友互访、赛季、受限交易、公会 | 社交留存提升，交易无重大作弊 |
| Phase 3 | 实时好友房间 | 房间匹配稳定、断线重连可用 |

---

## 15. 决策与待确认

已定：

- 交易：MVP 不做，后置；Phase 2 评估，注意 RMT。
- 实时房间：后置 Phase 3。
- 首发地区：暂不定。
- 服务器：Demo 2C2G 单机，Redis 后置。
- 语言：简体中文。

仍待确认：

1. 微信与 Steam 是否互通（跨端对战）？
2. 游客账号是否允许参与排行榜？
3. 防守快照 24 小时是否合适？
4. 交易形态（若做）：哪些物品可交易？
5. 实时房间是好友约战，还是也做随机匹配？
6. 账号注销后的数据处理策略？
7. 多区域部署的触发条件？

---

## 16. M1 服务端实现记录（C 会话，2026-10-29）

本节记录 `server/**` 的一期落地方式，与 `docs/CONTRACT.md` 的契约不冲突；冲突时以 CONTRACT 为准。

### 16.1 框架与目录

- **框架：`node:http` + 自写轻量路由**（`server/src/http/router.ts`）。理由：锁文件只由 0 号维护，C 不能新增依赖；2C2G 下零框架开销最小；统一响应包/错误码/header 需要完全可控。路由只支持静态段与 `:param`，method 严格匹配。
- 目录：`app.ts`（装配与统一错误出口）→ `routes/`（端点，只做鉴权/校验/编排）→ `services/`（auth/profile/idempotency）→ `domain/`（core 桥接、patch 组合、初始存档）→ `storage/`（Store 接口 + 内存/Postgres）。

### 16.2 请求约定（契约未固化、由服务端先定）

| 用途 | 约定 | 说明 |
|---|---|---|
| 鉴权 | `Authorization: Bearer <accessToken>` | token 为 HMAC-SHA256 自签，payload 带 `accountId`/`sessionId` |
| 协议版本 | `X-Protocol-Version: v1` | 可选；声明了且不等于 `v1` → 400 `VALIDATION_FAILED` |
| 幂等 | `Idempotency-Key` | 与 `@petbattle/protocol` 常量一致 |
| 存档版本 | `X-Base-Revision: <n>` | 与 `@petbattle/protocol` 的 `BASE_REVISION_HEADER` 一致（contract-v1.1 已补） |

- 写操作缺任一 header → 400 `VALIDATION_FAILED`；`baseRevision` 必须是非负整数。
- 幂等命名空间：登录态写操作用 `accountId`；`/auth/guest` 用 `device:<deviceId>`；`/auth/refresh` 用 `refresh:<sha256(refreshToken)>`。同一 key 不同指纹 → 409 `IDEMPOTENCY_CONFLICT`；重放响应带 `Idempotency-Replayed: true`。
- `/health` 响应体保持 contract-v1 原样（`{ ok, serverTime, protocolVersion }`），不套 `ApiResponse`。

### 16.3 写操作流水线

```
按 accountId 互斥 → 读档 → 校验 baseRevision → advanceProfile(now) → 端点改动 → revision++ → revision CAS 落库 → 审计 → 返回 patch
```

- 先校验 revision 再推进：过期客户端不会白白触发一次时间推进。
- CAS 失败（并发/多实例）→ 重新读最新档，返回 409 + `RevisionConflictDetails`。
- `ProfilePatch` 由 `core` 的推进增量与端点增量合并（`server/src/domain/patch.ts`），`revision` 与 `at/lastEvaluatedAt` 由服务端覆写。
- **patch 字段一律是"写入后的值"**，不是增量：`currencies` 下发完整四键、`lineup` 下发完整数组、`pets.upsert` 是整只宠物、`pets.remove` 是要删的 id。放生的返还金额同时出现在 `ReleasePetResponse.refund`（便于客户端做飘字），`currencies` 仍是绝对值。
- **栖息地操作的 patch**：core 的六个函数返回的 `patch.fromRevision = toRevision = 输入 revision`，由服务端在 `composePatch` 时统一覆写成「输入 revision → 输入+1」；同一只宠物不会同时出现在 upsert 与 remove（remove 优先）。
- 审计写入失败不回滚业务写入，但记 `error` 日志。已接入的审计动作：`account.create`、`profile.rename`、`pet.rename`、`pet.lock|unlock`、`pet.release`、`lineup.set`、`habitat.move|collect|feed|clean|play|upgrade`。

### 16.4 core 桥接、初始档与降级

- 服务端只通过 `CoreAdapter` 调领域函数（`advanceProfile` / `releasePet` / 六个栖息地操作 / `buildPveBattleSetup` / `runBattle` / `applyPveRewards` / `startBreeding` / `claimBreeding`）；业务端点不得自行改资源、宠物属性或阶段。
- 繁殖随机源：`startBreeding` 需要注入 `Rng`，但 `@petbattle/core` 公共入口没有导出 `mulberry32`（只能在内部 `rng.ts` 用），服务端按包边界不能深引用，因此 `domain/rng.ts` 用 CSPRNG 构造同接口的 `Rng`（繁殖结果由服务器生成并落库、不重放，不需要跨端确定性）。已按 CONTRACT §9.3 建议 A 导出 `createRng(seed)`，之后替换实现即可。
- 栖息地失败码来自 core 的 `Error`（`name = 'HabitatError'` + `code`，core 未导出 class，服务端按结构化特征识别），映射见 `server/src/errors.ts`：`pet_not_found → PET_NOT_FOUND(404)`、`habitat_not_found|food_not_found → NOT_FOUND(404)`、`capacity_full → CAPACITY_FULL(409)`、`insufficient_resources → INSUFFICIENT_RESOURCES(409)`、`egg_not_allowed|max_level|slot_conflict → VALIDATION_FAILED(400)`。
- `collectHabitat` 只返回 `{ profile, patch }`（CONTRACT D-12），因此 `collected` 由服务端在调用前按同一口径快照：`stored` 的整数部分入账、小数零头留在 `stored`。若 core 以后直接返回 `collected`，服务端改成透传即可。
- **初始档（`domain/starter-profile.ts`）**：调 `createPet` 建 3 只（水龟/雷鱼/草蛙，四项基因 50，generation 1，parents `[null,null]`，性别 male/female/male），出生时间取 `now - hatchMs - juvenileMs`，再对整档调 `advanceProfile(profile, now, cfg)`，断言全部 `adult` 且 `fertility.readyAt <= now`；栖息地 `meadow` 1 级、3 只占位 + 1 空；资源取 `economy.startingResources`；图鉴写 3 个组合、`bestGene = 50`；最终 `revision = 0`、`createdAt = lastEvaluatedAt = now`（首次登录不结算离线产出）。服务端不手写阶段阈值/衰减/产出。
- 降级只保留给"配置仓库缺失"这一种本地开发场景：`PETBATTLE_CORE_STUB=strict`（**compose 默认**）时启动即拒绝，或缺配置直接 501；`memory` 本地模式可显式放宽。core 已无契约桩，正常启动日志不应出现"降级"。
- 需要配置的操作（放生、建宠）没有降级余地：配置缺失返回 `CONFIG_INVALID`。

### 16.5 存储

- `Store` 接口覆盖账号/存档/会话/幂等/审计；内存实现用于测试与无数据库本地开发。
- Postgres：账号的外部身份列各自唯一；存档整档存 `profiles.data`（jsonb），写入按 `revision` 条件更新做 CAS；幂等体用 `json`（**不是 jsonb**）保证重放逐字节一致。
- 迁移：`server/src/storage/migrations/*.sql` 按文件名顺序执行，并由 `schema_migrations` 记录已应用版本；启动时先迁移再监听。**迁移不能每次启动盲跑**：`002_battle_sessions.sql` 含条件 `drop`（清理 001 的占位表），重跑会清掉 PvE 会话——本批实测踩到并已修复，`migrate.test.ts` 覆盖“第二次启动不再执行迁移”。
- PvE 会话表 `battle_sessions`（002）：`battle_id` 主键、`setup` jsonb 快照、`party_pet_ids` jsonb、`expires_at`、`status(started|claimed)`；按 `(account_id, status)` 建索引，`claim` 用 `status='started'` 条件更新做 CAS。
- 2C2G：`PG_POOL_MAX` 默认 10、硬上限 20；容器 `--max-old-space-size=1024`；异步 PvP 用 `Semaphore`（默认并发 2），M1 只留接口不接线。
- `pg` 已是 `server` 的正式依赖（0 号在 M1 首批合并时补齐）；compose 默认 `PETBATTLE_CORE_STUB=strict`。

### 16.6 已实现端点

| 端点 | 行为 |
|---|---|
| `GET /health` | 契约原样 |
| `POST /auth/guest` | `deviceId` → 账号；首次登录用 core 生成初始档（3 只成年宠 + 栖息地 + 图鉴 + 初始资源）；返回 access/refresh token 与 `profileRevision` |
| `GET /profile` | 返回全量档 + `revision`；**只读，不推进时间**；`sinceRevision` 暂忽略（CONTRACT §10.6 的决定） |
| `POST /profile/rename` | 改账号 `displayName`，revision +1 并返回 patch |
| `POST /pets/:id/rename` | 宠物改名（1~12 字符，去除首尾空白；归属校验）；revision +1 |
| `POST /pets/:id/lock` | 设置 `locked`（布尔）；只改标记位，放生时的拒绝由 core 判定 |
| `POST /pets/:id/release` | 调 `core.releasePet`：拒绝映射为 `EGG_NOT_RELEASABLE` / `PET_LOCKED` / `PET_IN_USE`（在编队/栖息地/防守阵容）/ `LAST_ADULT` / `PET_NOT_FOUND`；返还基因尘写回 `currencies`，图鉴 `owned` 不回退，写 `pet.release` 审计。**初始 3 只都在栖息地，必须先 `/habitat/move` 移出才能放生** |
| `POST /lineup/set` | 出战编队：≤3、属于本人、引用存在、非蛋、不重复；幼年可上阵；与 `pvp/defense` 互不联动 |
| `POST /habitat/move` | `{ petId, habitatId \| null }`：放入/移出；容量、归属、非蛋、槽位唯一由 `core.movePetToHabitat` 校验；移出是放生的前置步骤 |
| `POST /habitat/collect` | `{ habitatId }`：`stored` 整数部分转入 `currencies`，零头留存；响应 `collected` 为本次入账快照 |
| `POST /habitat/feed` | `{ petId, foodId }`：扣 `FoodConfig.cost`，恢复 hunger/mood；缺食物/资源返回 `INSUFFICIENT_RESOURCES` |
| `POST /habitat/clean` | `{ petId }`：恢复 hygiene（缺省 +20，可由栖息地 `careRecoveryPerAction` 覆盖），不消耗资源 |
| `POST /habitat/play` | `{ petId }`：恢复 mood（缺省 +20），不消耗资源 |
| `POST /habitat/upgrade` | `{ habitatId }`：扣下一级成本、扩容量；资源不足 `INSUFFICIENT_RESOURCES`，到上限 `VALIDATION_FAILED` |
| `POST /battle/pve/start` | `{ stageId }`：校验关卡解锁（order=1 或前一关 cleared → `STAGE_LOCKED`）与编队（1~3、存在、非蛋 → `INVALID_LINEUP`）；seed 由服务器生成；落会话并返回 `{ battleId, stageId, setup, expiresAt }` |
| `POST /battle/pve/claim` | `{ battleId, commands }`：从会话快照重放指令（`runBattle`），必须打完（否则 `VALIDATION_FAILED`）；`winner===0` 才发奖，平局按失败；返回 `{ patch, winner, rewards }`。会话不存在 `BATTLE_NOT_FOUND`、过期 `BATTLE_EXPIRED`、不同幂等键重复领取 `ALREADY_CLAIMED` |
| `POST /breeding/start` | `{ parentA, parentB }`：调 `core.startBreeding`（校验/扣费/遗传/冷却）；返回 `{ egg, inbred, patch }`。错误映射见下 |
| `POST /breeding/claim` | `{ eggId }`：调 `core.claimBreeding`，成功时服务端把 `stats.hatchlings +1`；返回 `{ pet, patch }` |

- 所有写端点都要求 `Idempotency-Key` + `X-Base-Revision`，并走同一流水线与审计；审计动作含 `battle.pve.claim`、`breeding.start`、`breeding.claim`。

**PvE 会话生命周期（CONTRACT §7.4 E-01/E-02）**

- TTL 30 分钟（`PETBATTLE_BATTLE_TTL_MS`）；同一账号同时只有一个未结束会话，`start` 会把旧会话的 `expires_at` 压到 `now`，旧 `battleId` 再 claim 返回 `BATTLE_EXPIRED`。
- `start` 不做时间推进、不 bump revision，但要求 `baseRevision` 与当前存档一致（过期返回 409）。
- seed 完全由服务器生成（`crypto.randomInt`），客户端在 body 里传 `seed/winner` 一律忽略；claim 只接受有序 `commands`，服务端重放复算胜负与奖励。
- 会话过期不改状态（避免后台任务），靠 `expires_at` 判定。

**繁殖错误映射（CONTRACT §7.4 / §8.3）**

| core reason | 协议码 |
|---|---|
| `not_found`（父母/蛋不存在） | `NOT_FOUND` 404 |
| `not_adult` / `same_pet` / `same_gender` / `infertile` | `VALIDATION_FAILED` 400 |
| `locked` | `PET_LOCKED` 409 |
| `cooldown` | `COOLDOWN_ACTIVE` 409 |
| `no_capacity` | `CAPACITY_FULL` 409 |
| `cost` | `INSUFFICIENT_RESOURCES` 409 |
| `egg_not_ready` | `EGG_NOT_READY` 409 |
| `already_claimed` | `ALREADY_CLAIMED` 409 |
| `BattleReplayError.invalid_command/not_finished` | `VALIDATION_FAILED` 400 |

### 16.7 尚未实现

| 端点 | 缺什么 | 说明 |
|---|---|---|
| `/pvp/defense` `/pvp/opponent` `/pvp/fight` `/pvp/replay/:id` | `buildBattleSetup`/`runBattle` 已可用；匹配、防守快照有效期与战报存储未定义 | 表结构可复用 `battle_sessions` 的思路（存 setup 快照），但 PvP 还需要匹配与回放口径 |
| `/leaderboard` `/friends` `/friends/:id/visit` | — | 指标口径（CONTRACT §10.3）与好友规则未定 |
| `/account/bind` `/account/unbind` `/auth/wechat` `/auth/steam` | — | 需要平台密钥与外部网络校验 |
| 限流与异常检测 | — | 按账号/IP，Redis 后置 |

**产品待确认（按现状实现）**：`feed/clean/play` 目前允许操作不在栖息地的宠物（core 对不在栖息地的情况使用默认恢复量 20/20），服务端不额外加限制；是否收紧为「仅栖息地内互动」等 PRD 口径确认后再改。

- `battle_sessions` 已由 PvE 使用（快照 + 状态 CAS）；PvP 接入时按同样思路扩展 `kind`/防守快照，仍遵循 PITFALLS P-027（快照不可引用实时宠物）。
