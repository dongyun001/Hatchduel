# 《宠物对决》契约冻结说明（CONTRACT）

| 项 | 内容 |
|---|---|
| 项目代号 | PetBattle |
| 契约版本 | **contract-v1.6** |
| 冻结时间 | 2026-10-28（v1）；2026-11-02（v1.6 增量） |
| 对应文档 | PRD v1.1 / TECH_DESIGN v1.1 / DOMAIN_MODEL v1.1 / ONLINE_DESIGN v1.1 / ART_SPEC v1.2 / COLLABORATION v1.3 |
| 维护者 | 0 号会话（Lead） |
| 读者 | A（核心）、B（客户端）、C（服务端）、D（内容）、E（美术）、QA |

> 本文是**并行开发的唯一入口**。开工前读本文 §8 对应小节；接口以代码为准（`packages/protocol`、`packages/core`），本文解释“为什么这样冻结、接手点在哪、怎么改”。
> 与 PRD 冲突时以 PRD 为准；发现契约缺口，按 §9 提变更请求，不要私改共享文件。

---

## 1. 冻结了什么

| 契约 | 位置 | 状态 |
|---|---|---|
| 传输协议 v1 | `packages/protocol/src/**` | 冻结；`PROTOCOL_VERSION = 'v1'` |
| 领域类型与函数签名 | `packages/core/src/index.ts`（re-export 各模块） | 冻结；contract-v1.5 及以前全部实现。contract-v1.6 的 `createRng` / 防守快照 / PvP 结算辅助已由 A M2 批次实现（§11.15） |
| 配置 schema | `packages/core/src/config/schema.ts` + `config/types.ts` | 冻结校验规则；数据由 D 填 |
| 配置数据样例 | `packages/core/src/config/data/*.json` | 初版样例，**不调平衡**，待 sim |
| 错误码 | `packages/protocol/src/errors.ts` | 冻结；只增不改 |
| 数值常量 | `packages/core/src/constants.ts` | 冻结；改动等于改契约 |

**不在契约内**：具体战斗/繁殖/圈养/经济实现、数据库结构、Cocos 工程、生产数值。这些分别是 A/B/C/D 的工作。

---

## 2. 仓库与工具链

### 2.1 workspace 成员

`pnpm-workspace.yaml`：

- `packages/core`（`@petbattle/core`）
- `packages/protocol`（`@petbattle/protocol`）
- `packages/sim`（`@petbattle/sim`，占位）
- `server`（`@petbattle/server`）
- `tools`（`@petbattle/tools`）
- `tests/e2e`（占位）

**`client/` 不在 workspace**：Cocos 工程独立管理，构建前把 core/protocol 同步到 `client/assets/lib/`（PITFALLS P-103）。

### 2.2 根命令

| 命令 | M0 状态 | 说明 |
|---|---|---|
| `pnpm typecheck` | ✅ 可用 | `tsc -p tsconfig.json --noEmit` |
| `pnpm test` | ✅ 可用 | Vitest，41 个用例 |
| `pnpm lint` | ✅ 可用 | ESLint flat config + 分层规则 |
| `pnpm validate:config` | ✅ 可用 | 结构/范围/引用/语义校验 |
| `pnpm dev` | ✅ 可用 | 启动 server（tsx watch） |
| `pnpm build` | ⚠️ 占位 | M0 等同 typecheck；真正的产物构建由 A/C 在 M1 补（esbuild / Docker） |
| `pnpm sim` | ⚠️ 占位 | 打印占位信息；D 接入 core 后实现 |

- Node ≥ 20（CI 用 20；本机 24 验证过）。
- TypeScript 5.9 / ESLint 9 / Vitest 3；**不要单个包自行升级大版本**，由 0 号统一。
- 不要并行跑 `pnpm install`；lockfile 只由 0 号维护。

### 2.3 CI 与客户端构建

CI 只跑 Node 侧（install / typecheck / test / lint / validate / health / client lib sync），
**不跑 Cocos 构建**（CI 无编辑器）。客户端合并前由 B 本地构建，统一走构建脚本：

```
node client/tools/build.mjs --platform=wechatgame --debug
node client/tools/build.mjs --platform=web-mobile --debug
```

- 脚本固定 `startScene` 为 Boot 场景 **uuid** `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`，
  并在构建后断言产物 `launchScene` 是 Boot。Cocos 3.8.8 CLI **不认** `db://assets/scenes/Boot.scene`
  写法（会回退到场景列表第一个），所以不要再用字面 `db://` 参数（P-118 / P-125）。
- 微信横屏、AppID、`urlCheck` 由 `client/build-templates/wechatgame/**` + 构建后处理固定（P-123）。



`.github/workflows/ci.yml`：install → typecheck → test → lint → validate:config → 启动 server 并 curl `/health`。
失败即阻断合并。

---

## 3. 分层与依赖方向

```
presentation (client) ──► protocol ──► core
server ─────────────────► protocol ──► core
tools / sim ─────────────────────────► core
```

- **core 只被引用，不引用任何 workspace 包**；也不依赖 Cocos/微信/DOM/网络/fs/时钟/随机源。
- **protocol 只放 DTO / 错误码 / 端点常量**；可 `import type` core 的领域类型，不复制。
- **core 不 import protocol**（增量 patch 定义在 core，protocol re-export，见 C-06）。
- 规则由 ESLint 强制：
  - `packages/core/src/**`：禁 `Math.random`、`Date.now`、`performance.now`、`window`/`document`/`fetch`/`process`、`cc`/`wx`、`node:*` 与 `@petbattle/*`；
  - `packages/protocol/src/**`：禁 Cocos/微信/IO/网络/`@petbattle/sim`/`@petbattle/server`；
  - `client/**/scripts/app/**`：禁直接 `wx.*`（目前无该目录）。
- 已验证：向 core 写入 `Math.random()`、`Date.now()`、`window` 会被 ESLint 拒绝。

---

## 4. `@petbattle/protocol` 接口清单

### 4.1 统一响应

```ts
interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: ApiErrorCode; message: string; details?: unknown };
  revision?: number;
  serverTime: EpochMs;   // 服务器权威时间
}
```

- 成功用 `ApiSuccess<T>`，失败用 `ApiFailure`（联合写法见 `src/api.ts`）。
- 写操作必须带 header `Idempotency-Key`（常量 `IDEMPOTENCY_KEY_HEADER`）和 `X-Base-Revision`（常量 `BASE_REVISION_HEADER`），后者携带客户端上次看到的 `profile.revision`。
- `revision` 不匹配返回 `REVISION_CONFLICT`，`details` 为 `RevisionConflictDetails { latestProfile, latestRevision }`，客户端拉全量重建。
- 协议版本 header：`X-Protocol-Version`（`PROTOCOL_VERSION_HEADER`）。
- 路径参数（`:id`）放 URL，不放 body；`ApiContract` 里这些端点的 `request` 为 `void` 或只含 body 字段。

### 4.2 错误码（`src/errors.ts`）

`UNAUTHENTICATED`、`FORBIDDEN`、`NOT_FOUND`、`VALIDATION_FAILED`、`REVISION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`RATE_LIMITED`、`TIME_BACKWARDS`、`NOT_IMPLEMENTED`、`INTERNAL`、`CONFIG_INVALID`、`INSUFFICIENT_RESOURCES`、`CAPACITY_FULL`、`COOLDOWN_ACTIVE`、`PET_NOT_FOUND`、`PET_LOCKED`、`PET_IN_USE`、`EGG_NOT_RELEASABLE`、`EGG_NOT_READY`、`LAST_ADULT`、`INVALID_LINEUP`、`STAGE_LOCKED`、`BATTLE_NOT_FOUND`、`BATTLE_EXPIRED`、`BATTLE_FINISHED`、`ALREADY_CLAIMED`、`DAILY_LIMIT_REACHED`、`OPPONENT_UNAVAILABLE`、`REPLAY_EXPIRED`。

只增不改；文案由客户端按 code 本地化，服务端 message 只用于日志。

### 4.3 端点（`src/endpoints.ts`，30 条，其中 24 条写路由）

| 路由 key | 方法 | 路径 | 请求 → 响应 |
|---|---|---|---|
| authWechat | POST | `/auth/wechat` | `AuthWechatRequest` → `AuthResponse` |
| authSteam | POST | `/auth/steam` | `AuthSteamRequest` → `AuthResponse` |
| authGuest | POST | `/auth/guest` | `AuthGuestRequest` → `AuthResponse` |
| authRefresh | POST | `/auth/refresh` | `AuthRefreshRequest` → `AuthResponse` |
| accountBind | POST | `/account/bind` | `AccountBindRequest` → `AccountOpResponse` |
| accountUnbind | POST | `/account/unbind` | `AccountUnbindRequest` → `AccountOpResponse` |
| getProfile | GET | `/profile` | `GetProfileQuery` → `GetProfileResponse` |
| renameProfile | POST | `/profile/rename` | `RenameProfileRequest` → `ProfileWriteResponse` |
| collectHabitat | POST | `/habitat/collect` | `CollectHabitatRequest` → `CollectHabitatResponse` |
| feedPet | POST | `/habitat/feed` | `FeedPetRequest` → `ProfileWriteResponse` |
| cleanPet | POST | `/habitat/clean` | `CleanPetRequest` → `ProfileWriteResponse` |
| playWithPet | POST | `/habitat/play` | `PlayWithPetRequest` → `ProfileWriteResponse` |
| upgradeHabitat | POST | `/habitat/upgrade` | `UpgradeHabitatRequest` → `ProfileWriteResponse` |
| movePetToHabitat | POST | `/habitat/move` | `MovePetToHabitatRequest` → `ProfileWriteResponse`（v1.3） |
| renamePet | POST | `/pets/:id/rename` | `RenamePetRequest` → `ProfileWriteResponse` |
| setPetLock | POST | `/pets/:id/lock` | `SetPetLockRequest` → `ProfileWriteResponse` |
| releasePet | POST | `/pets/:id/release` | — → `ReleasePetResponse` |
| startBreeding | POST | `/breeding/start` | `StartBreedingRequest` → `StartBreedingResponse` |
| claimBreeding | POST | `/breeding/claim` | `ClaimBreedingRequest` → `ClaimBreedingResponse` |
| startPveBattle | POST | `/battle/pve/start` | `StartPveBattleRequest` → `StartPveBattleResponse` |
| claimPveBattle | POST | `/battle/pve/claim` | `ClaimPveBattleRequest` → `ClaimPveBattleResponse` |
| setLineup | POST | `/lineup/set` | `SetLineupRequest` → `SetLineupResponse` |
| setPvpDefense | POST | `/pvp/defense` | `SetPvpDefenseRequest` → `ProfileWriteResponse` |
| getPvpDefense | GET | `/pvp/defense` | — → `GetPvpDefenseResponse`（v1.6） |
| getPvpOpponent | GET | `/pvp/opponent` | — → `GetPvpOpponentResponse` |
| fightPvp | POST | `/pvp/fight` | `FightPvpRequest` → `FightPvpResponse` |
| getPvpReplay | GET | `/pvp/replay/:id` | — → `GetPvpReplayResponse` |
| getLeaderboard | GET | `/leaderboard` | `LeaderboardQuery` → `LeaderboardResponse` |
| listFriends | GET | `/friends` | — → `ListFriendsResponse` |
| visitFriend | POST | `/friends/:id/visit` | `VisitFriendRequest` → `VisitFriendResponse` |

- `ApiContract` 把每个 key 映射到 `{ request, response }`，编译期保证两端一致；测试会校验 key 集合完全对齐。
- `lineup`（出战编队）与 `pvp/defense`（防守阵容）**独立**，互不联动。
- 战斗的 `BattleSetup` / `Command` / `BattleEvent` 从 core re-export，protocol 内**不复制**。

### 4.4 协议演进

| 变更 | 版本动作 |
|---|---|
| 新增可选字段 / 新端点 | 兼容；`contract-v1.x`，`PROTOCOL_VERSION` 仍为 `v1` |
| 删除/重命名字段、改语义、改必填性 | 不兼容；升 `v2`，新建 `docs/CONTRACT-v2.md`，双版本过渡 |
| 错误码新增 | 兼容；只增不改 |

版本记录：

- **contract-v1.1（2026-10-29）**：新增 `BASE_REVISION_HEADER` 常量（C 实现 `/profile/rename` 时需要的写操作头）。兼容变更，端点与 DTO 不变。
- **contract-v1.3（2026-10-29）**：新增 `POST /habitat/move`（放入/移出栖息地），解决“初始宠在栖息地内 → 无法放生”的死路；兼容变更。
- **contract-v1.6（2026-11-02）**：M2 异步 PvP + 排行榜（§7.5）：新增 `GET /pvp/defense`、三个错误码、PvP/回放/排行榜 DTO 字段；兼容变更。

---

## 5. `@petbattle/core` 公共契约

### 5.1 类型（`src/types/**`、`src/config/types.ts`）

- 基础：`Id`、`EpochMs`、`Probability`、`Rng`、`ElementId`、`ResourceId`、`Affinity`、`CounterMultiplier`
- 属性：`StatKey`、`CoreStatKey`、`StatBlock`、`Grade`
- 个体：`PetInstance`、`Genome`、`TraitAllele`、`AncestorRef`、`Condition`、`FertilityState`、`Stage`、`Gender`
- 存档：`Profile`、`ProfilePatch`、`HabitatInstance`、`ResourceBag`、`ResourceCost`、`ResourceRate`、`CodexEntry`、`StageProgress`、`BreedingState`、`PvpState`
- 战斗：`BattleSetup`、`BattleUnitInit`、`BattleUnit`、`BattleBuff`、`Command`、`BattleEvent`、`BattleState`
- 配置：`SpeciesConfig`、`ElementConfig`、`SkillConfig`、`PassiveConfig`、`TraitConfig`、`HabitatConfig`、`FoodConfig`、`BreedingConfig`、`StageConfig`、`EconomyConfig`、`ConfigData`、`ConfigRepo`

### 5.2 `ConfigRepo`

```ts
species/element/skill/passive/trait/habitat/food/stage(id)
breeding() / economy()
affinity(elementId, speciesId): Affinity
counterMultiplier(atkSpeciesId, defSpeciesId): 1.25 | 0.85 | 1
skillsFor(pet): Id[]        // [普攻, 属性小技能, 属性大招, 物种技能]
traitsFor(pet): TraitConfig[]
allSpecies/allElements/allSkills/allPassives/allTraits/allHabitats/allFoods/allStages()
contentVersion: string
```

只读；`createConfigRepo(data)` 加载时校验，失败抛 `ConfigValidationError`。

### 5.3 函数签名

| 函数 | 语义要点 |
|---|---|
| `createPet(input, cfg)` | 建个体；派生属性不落库 |
| `deriveStats(pet, cfg)` | base × level × stage × gene × condition × trait × passive × affinity，最后一次性 floor；相性只作用于 hp/atk/def/spd |
| `advancePet(pet, now, cfg)` | 阶段 → 状态 → 繁殖冷却；`now` 倒退抛 `TimeError` |
| `advanceHabitat(habitat, pets, now, cfg)` | 产出（8h 上限）+ 消耗；宠物数为 0 时产出 0 |
| `advanceProfile(profile, now, cfg)` | **先宠物、后栖息地**；幂等；返回 `{ profile, patch }` |
| `checkBreeding(a, b, now, profile, cfg)` | 顺序：同一只 → 性别 → 阶段 → 锁定 → readyAt → 冷却 → 空位 → 成本 |
| `breed(a, b, now, cfg, rng)` | 物种/属性 50/50；基因均值 + Irwin–Hall；近亲 -5/+2%/+20%；特质 3% 突变；返回 `parentCooldowns: [EpochMs, EpochMs]`（v1.2） |
| `isInbred(a, b, maxDepth)` | 3 代内共同祖先 |
| `releasePet(profile, petId, now, cfg)` | 蛋/锁定/上阵/栖息地/最后成年 都拒绝；按 `economy.releaseRefund` 返还基因尘（v1.2 增加 `cfg`） |
| `buildBattleSetup(teams, cfg, seed)` | 个体快照 → 3v3；uid 由本函数生成 |
| `buildEnemyTeam(stage, cfg, seed)` | 同 stage/seed 同队伍；敌方满状态 |
| `expToNext(level)` | `40 + level × 20`（M0 唯一实现的公式） |
| `applyExp(pet, amount, cfg)` | 加经验并按 `expToNext` 循环升级（≤20 级），返回新个体（v1.2 新增） |
| `validateConfig(input)` / `assertConfig(input)` | 配置校验 |
| `applyProfilePatch(profile, patch)` | 纯函数：remove 优先于 upsert、currencies 覆盖、codex 不回退（v1.4） |
| `runBattle(setup, cfg, commands)` | 从零重放指令到结束；非法/未结束抛 `BattleReplayError`；返回 `{winner, turns, events}`（v1.5） |
| `applyPveRewards(profile, stage, ctx, now, cfg)` | 首通/重复/经验/首通蛋/图鉴/bestTurns；返回 `{profile, patch, rewards}`（v1.5） |
| `claimBreeding(profile, eggId, now, cfg)` | 从 `breeding.eggs` 领取已孵化的蛋；错误 `BreedingClaimError`（v1.5） |
| `startBreeding(profile, a, b, now, cfg, rng)` | 校验/扣费/产蛋/父母冷却/统计，返回 `{profile, patch, child, inbred, parentCooldowns}`（v1.4） |
| `BattleEngine` | `create` / `availableCommands` / `submit` / `state` / `autoCommand(uid)`（v1.2）；技能回合冷却由 `BattleUnit.cooldowns?` 承载（v1.4） |

contract-v1.2 的全部函数已实现，`contract.test.ts` 只保留常量与公式断言，不再有契约桩。

### 5.4 冻结常量（`src/constants.ts`）

- 战斗：`DAMAGE_K=400`、`ENERGY_MAX=100`、`ENERGY_INITIAL=0`、`ENERGY_PER_TURN=20`、`ENERGY_ON_NORMAL_HIT=10`、小技能 40~50、大招 70~80、`MAX_TURNS=30`、`CRIT_DAMAGE_DEFAULT=1.5`、`COUNTER_STRONG=1.25`、`COUNTER_WEAK=0.85`
- 成长：`STAGE_MULTIPLIERS`（0 / 0.7 / 1 / 0.9）、`GENE_MUL_BASE=0.85`、`CONDITION_MUL_BASE=0.9`、`MAX_LEVEL=20`
- 经验：`EXP_BASE=40`、`EXP_PER_LEVEL=20`、首通 `30 + order×10`、重复 `÷3`
- 时间：`OFFLINE_CAP_MS=8h`、`DECAY_CAP_MS=24h`、`HEALTH_FLOOR=1`
- 编队：`MAX_LINEUP_SIZE=3`
- 集合：`MVP_SPECIES_IDS`、`MVP_ELEMENT_IDS`、`INITIAL_SPECIES_IDS`

### 5.5 纯度规则（ESLint + 评审双重把关）

- 无 `Math.random` / `Date.now` / `performance.now` / `cc` / `wx` / DOM / 网络 / fs。
- 无 `Math.sin/cos/tan/exp/log/log2/log10/sqrt/pow`；正态用 Irwin–Hall。
- 时间由调用方传入；随机由 `Rng` 注入；全程 double，最终 floor。

---

## 6. 配置契约

### 6.1 文件（`packages/core/src/config/data/`，归 D）

`content.json`（contentVersion）、`species.json`(5)、`elements.json`(5)、`affinity.json`、`skills.json`(16 主动)、`passives.json`(5)、`traits.json`(6)、`habitats.json`(1)、`foods.json`(3)、`breeding.json`、`stages.json`(5)、`economy.json`。

样例数值是**初版**，只保证校验通过，不保证平衡；所有数值标注“待 sim”。

### 6.2 校验规则（`validateConfig`）

1. 结构：字段类型、必填、范围（cost 0~100、chance 0~1、基因/状态 0~100、等级 ≤20）。
2. 引用：`speciesId` / `elementId` / `skillId` / `traitId` / `passiveId` / `foodId` / `stageId` 必须存在。
3. 语义：无自克制、无双向克制、相性只存 ±1（不写 0）、关卡只用 MVP 5 物种、被动 `effects` 必须带 `target`、`upgrade.levels` 与 `maxLevel` 对齐。
4. 唯一性：同表 id 不重复；关卡 `order` 不重复。

`pnpm validate:config` 失败逐条打印 `[code] path: message` 并以 1 退出。

### 6.3 样例计数

| 表 | 数量 |
|---|---|
| species | 5（turtle / fish / frog / cat / snake） |
| elements | 5（water / fire / grass / earth / thunder） |
| skills（主动） | 16（普攻 1 + 属性 10 + 物种 5） |
| passives | 5 |
| traits | 6（够铺结构，不是最终 15~20） |
| habitats | 1（meadow，4 格） |
| foods | 3 |
| stages | 5（第 2 关给火猫、第 4 关给土蛇） |

---

## 7. 契约澄清（相对旧文档的最小修正）

文档与 JSON/TS 落地时发现 9 处无法直接照抄，按“不改变产品决策、只消除歧义”处理。**A/D 实现时以本节为准**。

| 编号 | 问题 | 处理 | 影响 |
|---|---|---|---|
| C-01 | `HabitatConfig.upgrade.cost/capacity/productionMul` 在 DOMAIN §2.7 是函数，JSON 不能存函数 | 改为数据化：`upgrade: { maxLevel, levels: [{ level, cost, capacity, productionMul }] }`，等级从 1 连续 | A（实现）、D（填数据） |
| C-02 | `StageConfig.rewards.pets/eggs: Id[]` 语义不明（物种？模板？） | 改为内联模板 `PetRewardSpec { speciesId, elementId, gender? }[]` | D、C |
| C-03 | `EffectSpec` 没有目标；被动开场效果无处指定作用对象 | `EffectSpec` 增加可选 `target`；`PassiveConfig.effects` 每条**必须**填 `target` | A、D |
| C-04 | DOMAIN §2.8 的 `ConfigRepo` 缺 `breeding()/economy()/all*()`，但 `breed` 和校验都需要 | 补齐（见 §5.2） | A |
| C-05 | 技能 `power` 与 `effects.kind='damage'` 可能重复计伤 | 伤害只由 `power` 表示；`damage` 效果保留给“无 power 的纯功能技能”，MVP 样例不使用 | A、D |
| C-06 | `ProfilePatch` 放 protocol 还是 core？ | 放 core（存档增量是领域数据），protocol re-export；避免 core 反向依赖 protocol | A、B、C |
| C-07 | `Command.surrender` 没有行动者/回合，服务端无法校验 | 增加 `turn` 与 `uid` | A、C |
| C-08 | `expToNext` 是否也在“一律 stub”范围？ | 公式已冻结且无副作用，M0 直接实现；其余仍 stub | A |
| C-09 | TECH §8.1 没有 `contentVersion` 的落点 | 新增 `content.json`；`ConfigData.contentVersion` | D |

这些澄清已记录进 `docs/PITFALLS.md`（P-038/P-039/P-040），不再逐份改 A/C/E 拥有的文档；A/D 在各自文档里同步实现细节即可。

### 7.1 A 首批实现反馈的裁定（contract-v1.2，2026-10-29）

A 首批完成后提了 4 条变更请求和 3 条待明确项。裁定如下；**M1 早期允许一次集中的 core 签名调整（当前无外部消费者），统一记在 contract-v1.2；M2 起按 §9.2 的 v2 规则执行**。

| 编号 | 议题 | 裁定 | 落地 |
|---|---|---|---|
| D-01 | `releasePet` 拿不到配置，特质稀有度加成恒为 0 | **补必填 `cfg: ConfigRepo`**，按 `economy.releaseRefund` 计算返还；无配置不是合法调用 | A 改签名 + 测试；C 接线时按新签名 |
| D-02 | 父母繁殖冷却口径只在 A 内部，服务端会另写一套 | **扩展 `BreedResult.parentCooldowns: [EpochMs, EpochMs]`**（与 `child` 同时返回）；不额外导出函数 | A 改实现 + 测试 |
| D-03 | 敌方/自动战斗的 AI 入口不可用 | **`BattleEngine.autoCommand(uid): Command`** 公开；确定性策略与内置 AI 同一份 | A 加方法 + 测试 |
| D-04 | `critDmg` 是否吃 `condMul`（满状态 165% vs AGENTS 写 150%） | **保留 DOMAIN §4.1 实现**：150% 是基础倍率，状态/特质/被动可修正；PRD §8.3 原文“可被特质调整”支持这一点。更新 docs 措辞，不改代码 | A 在 DOMAIN 补一句；0 号在本文件 §5.4 注明 |
| D-05 | 食物不足的额外饥饿惩罚缺系数 | **`HabitatConfig.hungerPenaltyWhenNoFoodPerHour?: number`**（可选，缺省 0）；A 加 schema 字段与结算，D 填数值 | A 改 schema/结算；D 补数据 |
| D-06 | 产出阶段系数 0.5/1/0.8 写死在代码 | **`HabitatConfig.productionStageMul?: { juvenile; adult; elder }`**（可选，缺省 0.5/1/0.8）；A 改为读配置，D 填数值 | A 改实现；D 补数据 |
| D-07 | `createPet` 与升级经验 | `createPet` **本批必做**；新增 `applyExp(pet, amount, cfg)`（按 `expToNext` 循环升级，≤20 级） | A 实现 + 测试 |

### 7.2 D/C 第二批反馈的裁定（contract-v1.3，2026-10-29）

| 编号 | 议题 | 裁定 | 落地 |
|---|---|---|---|
| D-08 | A 的测试写死 `normal_strike` power、`stage_1` 敌人数量与固定快照，锁住 D 调水/土系 | **测试与生产数据解耦**：battle/determinism 用 `test/factory` 的合成配置；删除“stage_1 恰好 2 个敌人”的断言；D-05 用例显式 `delete` 字段 | A 改测试 |
| D-09 | `autoCommand` 45 能量就交小技能，几乎攒不到大招 | 留能量策略：`energy >= 大招cost` 放大招；`energy >= 大招cost-20` 普攻攒能量；否则再考虑小技能；加“自动战斗能看到大招”的回归测试 | A 改引擎 |
| D-10 | PvE 只有单边 setup 入口 | 新增 `buildPveBattleSetup(party, stage, cfg, seed): BattleSetup`，team0=party、team1=`buildEnemyTeam` | A 实现；C 接 `/battle/pve/start` |
| D-11 | 放行防守阵容中的宠物放生会留下悬空 id | `releasePet` 检查 `profile.pvp.defense`，命中抛 `ReleaseError('in_defense')` → `PET_IN_USE` | A + C |
| D-12 | 栖息地操作没有 core 函数，C 无法实现 `/habitat/*` | 新增 `movePetToHabitat` / `feedPet` / `cleanPet` / `playWithPet` / `upgradeHabitat` / `collectHabitat`，统一返回 `{ profile, patch }`；`clean/play` 恢复量进 `HabitatConfig.careRecoveryPerAction?`（可选，默认 hygiene +20 / mood +20）；**新增 `POST /habitat/move`** | A 实现 + C 接端点（协议已由 0 号加好） |
| D-13 | `hit` 用乘数语义（有符号值 × 1.05）不合理 | `statMods` 中 hp/atk/def/spd/crit/critDmg/dodge 仍是乘数；`hit` 改为**加法增量**（如 +0.02）；`deriveStats` 与文档同步 | A 改实现 |
| D-14 | `inheritance.weight` 未被消费 | MVP 标记为 **reserved**，保留字段不删；文档写明暂不参与遗传，等显性/隐性模型确定后再用 | A 补文档 |
| D-15 | 宠物名 12 字符是服务端暂定值 | 保持 12（中文 12 字足够，UI 可自行更短）；不改协议 | 无代码改动 |

> D-05/D-06 的字段是**可选**的，避免 D 还没填数据时阻断 A；但两者都必须从配置读取，不允许 A 再写死第二套默认值。

---

### 7.3 第四批预裁定（contract-v1.4，2026-10-29）

| 编号 | 议题 | 裁定 | 落地 |
|---|---|---|---|
| D-16 | 服务端/客户端都需要把 patch 应用到存档 | 新增 `applyProfilePatch(profile, patch): Profile` 纯函数；**remove 优先于 upsert**；`currencies` 按 patch 绝对值覆盖；`codex` 只允许 false→true；不校验 revision | A 实现 + 测试；C/B 复用 |
| D-17 | 繁殖的校验、扣费、冷却、落蛋散在服务端 | 新增 `startBreeding(profile, aId, bId, now, cfg, rng): StartBreedingResult`，含 `BreedingError(reason: BreedError)`；服务端只负责 `advanceProfile → startBreeding → CAS` | A 实现；C 接 `/breeding/start` |
| D-18 | `SkillConfig.cooldown` 未被引擎消费 | `BattleUnit.cooldowns?: Record<Id, number>`；回合开始递减、cast 后设置、`availableCommands` 过滤冷却中的技能；无该字段时行为不变 | A 实现 + 测试 |

---

### 7.4 PvE 会话/奖励与繁殖领取（contract-v1.5，2026-10-29）

> 本节关闭 §10 的两个未决项。协议已先行落地：错误码 `BATTLE_EXPIRED` / `EGG_NOT_READY`，
> `StartPveBattleResponse.expiresAt`，`BattleRewards` 改为 re-export core 的 `PveRewards`。

| 编号 | 议题 | 裁定 |
|---|---|---|
| E-01 | PvE 会话生命周期 | 服务端持有 `BattleSession { battleId, accountId, stageId, seed, setup, partyPetIds, createdAt, expiresAt, status }`；**TTL 30 分钟**；同一账号同时只有 1 个未结束会话，再次 `start` 使旧会话失效；`start` 校验关卡解锁（order=1 或前一关 cleared）与 lineup（1~3 只、非蛋、存在），失败 `STAGE_LOCKED` / `INVALID_LINEUP` |
| E-02 | claim 校验 | 客户端提交**完整有序 commands**；服务端用 `setup + seed` 从零重放（core `runBattle`），必须 `finished`，否则 `VALIDATION_FAILED`；不接受客户端结果；过期 `BATTLE_EXPIRED`；不同幂等键重复领取 `ALREADY_CLAIMED`；battleId 不存在 `BATTLE_NOT_FOUND` |
| E-03 | 首通/重复 | 只有 `winner===0` 发奖；loss/draw 不发（平局按失败计），`battlesLost++`；`firstClear = winner===0 && !stageProgress.cleared`；更新 `cleared/bestTurns/firstClearAt`（bestTurns 取胜场最小值） |
| E-04 | 经验 | 用 `start` 时的 lineup 快照；claim 时仍存在的宠物才加经验（已放生/缺失跳过，不报错）；每只都按对应档 `petExp` 用 `applyExp` |
| E-05 | 首通宠物 | `rewards.pets` 以**蛋阶段**交付：`createPet`（四项基因 50、generation 1、parents null、traits 空），性别按发放序号确定性交替（0=male,1=female）；加入 `profile.pets`，**不**进 `breeding.eggs`；`rewards.eggs` 保留但 MVP 不使用 |
| E-06 | 图鉴 | claim 时敌方每个 `species:element` 标 `seen=true`；发放的宠物标 `seen/owned=true`、`bestGene=50` |
| E-07 | 繁殖领取 | `eggId` 必须在 `breeding.eggs`；宠物缺失 `NOT_FOUND`；仍是蛋 `EGG_NOT_READY`(409)；已领取（不在 eggs 但宠物存在）`ALREADY_CLAIMED`(409)；成功后从 eggs 移除并返回 pet；幂等键重放返回同一结果；领取不做阶段推进（服务端先 `advanceProfile`） |
| E-08 | core 签名 | `runBattle(setup, cfg, commands): { winner, turns, events }` + `BattleReplayError('invalid_command'|'not_finished')`；`applyPveRewards(profile, stage, { firstClear, winner, partyPetIds, turns }, now, cfg): { profile, patch, rewards }`；`claimBreeding(profile, eggId, now, cfg): { profile, patch, pet }` + `BreedingClaimError('not_found'|'egg_not_ready'|'already_claimed')` |
**补充口径（A 第五批实现后确认）**

- **E-02a 多余指令**：`runBattle` 在 `finished` 之后忽略剩余命令（容错，不算作弊）；但命令序列必须能重放到 `finished`，否则 `not_finished`。
- **E-06a 图鉴 seen**：敌方 `species:element` 在 claim 时标记 `seen`，胜负/平局都标（打过即见过）；`owned` 只有发放/拥有才为 true。
- **E-07a 孵化统计**：`stats.hatchlings` 由服务端在繁殖领取成功后 `+1`，core 不处理（`claimBreeding` 只管 eggs 与宠物）。
- **E-05a 首通蛋 ID**：`reward_{stageId}_{index}` 确定性生成；冲突时确定性追加序号。基因固定 50、level 1，不读数据。


---

### 7.5 M2 异步 PvP 与排行榜（contract-v1.6，2026-11-02）

> 本节是 M2 / MVP-B 的唯一口径，关闭 §10 的第 3 项与 ONLINE_DESIGN §6/§7 的歧义。
> 范围只含**异步 PvP + 排行榜**；微信/Steam 登录与账号绑定不阻塞本批，见 §7.6。
> 全部为兼容变更：只加可选字段、新端点、新错误码；`PROTOCOL_VERSION` 仍为 `v1`。

#### F-01 防守快照

- 存储：服务端表 `pvp_defense_snapshots`（或等价持久化），字段：

```ts
interface PvpDefenseSnapshot {
  accountId: string;
  petIds: PetId[];            // 1~3 只，顺序即出场顺序
  units: BattleUnitInit[];    // 已定格：derived stats / skills / traits / passive
  contentVersion: string;
  createdAt: EpochMs;
  expiresAt: EpochMs;         // createdAt + 24h
}
```

- **存 `BattleUnitInit[]`，不存 `BattleSetup`**：seed 每场由服务端生成，不能跨场复用。`units` 的 uid 固定 `d0/d1/d2`，`petId` 保留防守方原 id。
- 生成：`POST /pvp/defense` 用 core `buildDefenseSnapshot(profile, petIds, now, cfg)`（F-09）从本人宠物构建；core 不返回 `accountId`，由服务端落库时补上。客户端永远不提交属性/单位。
- 校验：`petIds` 为 1~3 个、不重复、存在、非蛋；否则 `INVALID_LINEUP`。锁定不阻止进防守；同一只可以同时在出战编队与防守阵容。
- 有效期 **24h**。**过期策略（二选一已定）**：过期快照仍作为对战输入，不会让不活跃玩家的防守消失；但 `GET /pvp/defense` 返回 `stale=true`，客户端提示“重新设置”。设置新快照直接替换旧快照。
- 配置变更不回溯：快照内的 `units` 已含 `deriveStats` 结果；改配置、改基因、升级、放生都不修改旧快照。战报回放只认存储的 `setup`。
- 防守宠物不可放生：沿用 D-11（`profile.pvp.defense` 命中 → `PET_IN_USE`）。`profile.pvp.defense` 与快照 `petIds` 必须一致。
- 一致性：快照写入与 `profile.pvp.defense` 的 revision CAS 必须同事务（Postgres）或失败补偿（内存）；不允许只写一边。

#### F-02 匹配

`GET /pvp/opponent`，**服务端选对手**，客户端不能指定。

- 候选：`status=active`、非本账号、有非空防守快照的账号。
- 排序：`|rating 差|` 升序 → `|平均等级差|` 升序 → `accountId` 升序（稳定）。
- 窗口：`200 → 600 → 不限`，取第一个非空窗口。窗口内有 ≥3 个候选时，排除最近 24h 已打过的 3 个对手；排除后为空则忽略排除。
- 冷启动：没有真人候选时用机器人（`botsEnabled=true`）。机器人 `isBot=true`、`displayName="训练师·<物种>"`、`rating=1000`、3 只固定模板（5 物种轮换，等级 = 攻方平均等级钳制在 1~20）。**机器人不计榜、不改段位**。
- 响应：对手概览 + `challengesRemaining`、`dailyLimit`、`seasonId`。只暴露 `speciesPreview`（物种 id）与 `avgLevel`，不暴露基因、属性、技能、快照。
- 匹配**不消耗**次数；`fight` 才消耗。

#### F-03 异步结算

`POST /pvp/fight`（写操作，带 `Idempotency-Key` + `X-Base-Revision`）。

1. 校验：攻方 `profile.lineup` 为 1~3 只合法宠物（非蛋、存在），否则 `INVALID_LINEUP`；对手存在、非自己、有非空快照，否则 `OPPONENT_UNAVAILABLE`；当日次数未用完，否则 `DAILY_LIMIT_REACHED`。
2. 构建：`seed` 只能由服务端 CSPRNG 生成；`setup = buildPvpBattleSetup(attackerPets, snapshot.units, cfg, seed)`（team0 = 攻方，team1 = 防守方，uid 重排为 `a*`/`b*`）。
3. 模拟：双方都用 core `autoCommand` 逐回合出令，记录**实际执行的指令序列**；30 回合 / 600 条指令上限。
4. 结算：真人对手按 F-04 更新双方 `pvp.rating` 与 `stats`；机器人只更新攻方 `stats`，双方 `rating` 不变。攻方响应带 `patch`；防守方在下一次 `GET /profile` 看到变化。调用 `applyPvpOutcome` 时，防守方的 `result` 取攻方视角的反面（`win`↔`loss`，`draw` 不变），`ranked` 与攻方一致（真人 true、机器人 false）。
5. 落库：`pvp_replays` 保存 `setup + seed + commands + events + winner + turns + 双方结算信息 + contentVersion`，保留 **30 天**。
6. 并发：模拟经 `Semaphore(2)`；同一账号的写经 `KeyedMutex`；双方评分更新按 `accountId` 升序加锁并 CAS 重试，避免双打丢更新（P-105）。
7. 幂等：同一 `Idempotency-Key` 返回首次结果（含 `replayId`），不重复扣次数；不同 key = 新一场。
8. 审计：`pvp.fight` 记录 `replayId / attacker / defender / result / ratingBefore/After / seasonId / isBot`。

请求/响应（`result` 即引擎 winner，team0 为攻方）：

```ts
interface FightPvpRequest { opponentAccountId: string }

interface FightPvpResponse extends ProfileWriteResponse {
  replayId: string;
  result: 0 | 1 | null;          // 攻方视角：0 胜、1 负、null 平
  turns: number;
  isBot: boolean;
  seasonId: string;
  ratingBefore: number;          // 攻方
  ratingAfter: number;           // 攻方
  challengesRemaining: number;
  opponent: {
    accountId: string;
    displayName: string;
    ratingBefore: number;
    ratingAfter: number;
    isBot: boolean;
  };
}
```

#### F-04 段位

- 初值 `1000`；下限 `0`；无上限。
- Elo 期望：`Ea = 1 / (1 + 10^((Rb - Ra) / 400))`（服务端计算，不进 core）。
- `K`：胜 32、负 24、平 16；`delta = round(K × (S − Ea))`；攻方 `+delta`，防守方 `−delta`（零和），最后各自钳到 ≥0。
- 机器人对局：双方 rating 不变。真人之间：双方都变。
- 每日次数：**10 次**，按 `Asia/Shanghai` 00:00 切日；只由成功落库的 `fight` 扣减，幂等重放不扣。
- 赛季：默认 `s1`（服务端配置）。换季软重置 `rating = round((rating + 1000) / 2)` 并清空次数；M2 不做定时器，在下次读/写档发现 `profile.pvp.seasonId !== 当前赛季` 时触发一次。
- 统计：`stats.battlesWon/Lost` 双方都计（含机器人）；平局不计。`pvp.ranked` 只计真人排位对局。
- 参数归 `server/src/config.ts` 的 `PvpSettings`（环境变量可覆盖）；M3 再迁 `config/data/pvp.json`（D）。

M2 默认参数（服务端常量/环境变量，冻结口径）：

| 参数 | 默认 | 环境变量 |
|---|---|---|
| `seasonId` | `s1` | `PETBATTLE_PVP_SEASON_ID` |
| `initialRating` | 1000 | — |
| `kWin / kLoss / kDraw` | 32 / 24 / 16 | — |
| `dailyChallenges` | 10 | `PETBATTLE_PVP_DAILY_LIMIT` |
| `snapshotTtlMs` | 24h | `PETBATTLE_PVP_SNAPSHOT_TTL_MS` |
| `replayTtlMs` | 30d | `PETBATTLE_PVP_REPLAY_TTL_MS` |
| `matchWindows` | `[200, 600, ∞]` | — |
| `leaderboardDefault / max` | 20 / 50 | — |
| `botsEnabled` / `botRating` | true / 1000 | `PETBATTLE_PVP_BOTS` |
| 模拟并发 | 2 | `PETBATTLE_PVP_CONCURRENCY`（已存在） |

#### F-05 排行榜

`GET /leaderboard?kind=rating|codex|gene|generation&seasonId=&limit=`。

| kind | value 定义 | 资格 |
|---|---|---|
| `rating` | `profile.pvp.rating`（当前赛季） | `profile.pvp.ranked` 至少 1 场真人排位 |
| `codex` | `codex` 中 `owned=true` 的条目数（0~25） | 至少 1 条 owned |
| `gene` | 非蛋宠物四项基因均值 `floor((hp+atk+def+spd)/4)` 的最大值 | 至少 1 只非蛋宠物 |
| `generation` | 非蛋宠物 `generation` 的最大值 | 至少 1 只非蛋宠物 |

- 排除机器人；排除 `status != active` 的账号。
- 排序：`value` 降序 → `rating` 降序 → `accountId` 升序（稳定）。
- 返回前 `limit` 名（默认 20，最大 50）+ `self`；`self` 的 rank 按全体合格账号计算。本人不合格时 `selfEligible=false` 且无 `self`。
- `seasonId` 默认当前赛季；M2 只支持当前赛季，传其他值 `VALIDATION_FAILED`。
- `codex` 只算 `owned`，不含 `seen` 剪影；`gene`/`generation` 不含蛋（避免刷榜）。
- M2 不做分页；前 N + 自己足够 Demo 使用。

#### F-06 战报回放

`GET /pvp/replay/:id`：

- 只有该场攻方/防守方可读，否则 `FORBIDDEN`；不存在 `NOT_FOUND`；超过 30 天 `REPLAY_EXPIRED`。
- 回放以存储的 `events` 为准；`setup+seed+commands` 只用于调试/复算。客户端**不得**重新模拟后覆盖结果。
- `BattleReplay.version = contentVersion`；版本不一致时只播放已存 `events`，不重算。

```ts
interface PvpReplaySummary {
  replayId: string;
  seasonId: string;
  createdAt: EpochMs;
  attacker: { accountId; displayName; ratingBefore; ratingAfter };
  defender: { accountId; displayName; ratingBefore; ratingAfter };
  resultForAttacker: 0 | 1 | null;
  isBot: boolean;
}

interface GetPvpReplayResponse {
  replay: BattleReplay;      // version = contentVersion
  summary: PvpReplaySummary;
  serverTime: EpochMs;
}
```

#### F-07 反作弊与限流

- 客户端不能提交阵容、属性、seed、结果；防守快照只能由 `setPvpDefense` 从本人宠物生成。
- 同账号互打禁止（匹配与结算都校验）。
- 模拟并发 2（2C2G）；超出排队而不是直接拒绝。单次模拟超过 10s 记 `pvp.slow` 审计（M2 只告警，不封禁）。
- 每场不发资源；赛季奖励 M5 再做，避免刷分套利。
- 所有评分变化写审计；异常评分只进日志，不自动改结果。

#### F-08 协议增量

新增错误码（只增不改）：

| code | HTTP | 场景 |
|---|---|---|
| `DAILY_LIMIT_REACHED` | 429 | 当日 PvP 次数用完 |
| `OPPONENT_UNAVAILABLE` | 409 | 对手不存在/无快照/被禁用/是自己 |
| `REPLAY_EXPIRED` | 410 | 战报超过保留期 |

新增端点：

| 路由 key | 方法 | 路径 | 请求 → 响应 |
|---|---|---|---|
| `getPvpDefense` | GET | `/pvp/defense` | — → `GetPvpDefenseResponse` |

```ts
interface PvpDefenseInfo {
  petIds: PetId[];
  createdAt: EpochMs;
  expiresAt: EpochMs;
  stale: boolean;
  contentVersion: string;
}

interface GetPvpDefenseResponse {
  defense?: PvpDefenseInfo;   // 未设置时缺省
  serverTime: EpochMs;
}
```

`LeaderboardResponse` 增加必填 `selfEligible: boolean`，`seasonId` 改为必填（服务端总会返回）。

#### F-09 core 增量（A 批次）

```ts
// contract-v1.6
createRng(seed: number): Rng                                   // 关闭 E-09
buildDefenseSnapshot(profile, petIds, now, cfg): {
  petIds: PetId[];
  units: BattleUnitInit[];        // uid = d0/d1/d2，属性已定格
  contentVersion: string;
  createdAt: EpochMs;
  expiresAt: EpochMs;
}                                                               // 校验 1~3/不重复/存在/非蛋；失败抛 DefenseError
buildPvpBattleSetup(attackerPets, defenseUnits, cfg, seed): BattleSetup
                                                               // team0=attacker、team1=defense；uid 重排 a*/b*
applyPvpOutcome(profile, outcome): { profile; patch }           // 只改 pvp/stats；不推进时间
```

`PvpState` 增加可选字段（兼容）：

```ts
interface PvpState {
  defense: PetId[];
  rating: number;
  seasonId: string;
  /** 真人排位战绩；机器人对局不计。缺省视为 0 场。 */
  ranked?: { wins: number; losses: number; draws: number };
}
```

- `outcome: { result: 'win' | 'loss' | 'draw'; ranked: boolean; ratingAfter: number; seasonId: string }`。
- `ranked=false` 时 `rating` 保持不变（必须等于入参）、`ranked` 计数不变；`stats.battlesWon/Lost` 仍按 `result` 计。
- `patch.fromRevision = patch.toRevision = profile.revision`，revision 由服务端统一 +1（与现有 core 函数一致）。
- `DefenseError.reason`: `'invalid_count' | 'duplicate' | 'pet_not_found' | 'pet_is_egg'`；服务端统一映射 `INVALID_LINEUP`。

#### F-10 验收（M2）

1. 两个新账号：设置防守 → A 匹配到 B → fight 生成战报 → A/B 都看到 rating 变化；B 的 `stats.battlesLost` +1。
2. `GET /pvp/replay/:id` 只对双方可见；`events` 可完整播放；超过 30 天 `REPLAY_EXPIRED`。
3. 第 11 次 fight 返回 `DAILY_LIMIT_REACHED`；`GET /pvp/opponent` 不受影响。
4. 四个排行榜的 top N + self 正确；机器人不出现；`rating` 榜只含打过真人排位者；`codex` 不含 `seen` 剪影。
5. 改配置/升级/放生后，旧快照与旧战报仍可复现（不回溯）。
6. 2C2G：2 个并发模拟排队完成、无 5xx；Postgres 重启后快照/战报/评分仍在。
7. `createRng` 导出后，服务端删除临时 CSPRNG 适配（E-09 关闭）。

#### F-11 M2 明确不做

手动 PvP、实时房间、观战、分享短链、好友挑战、赛季奖励、全量榜分页、机器人计榜、跨端限制。
微信/Steam 登录、账号绑定/解绑见 §7.6（可同批实现，但不在本契约的验收内）。

### 7.6 登录与账号绑定（M2 后置，未冻结）

- `/auth/wechat|steam`、`/account/bind|unbind` 的 DTO 已存在，语义按 ONLINE_DESIGN §3/§2.2。
- 在本节补裁定前，C 不得改变 guest 登录与 `X-Base-Revision` 语义；B 不得假设微信登录可用。
- 待定：`code2session` 的 AppID/Secret 注入方式、Steam ticket 校验目标、绑定冲突（同三方 id 已绑其他账号）的提示与合并策略。

---

## 8. 各会话接手点

### 8.1 A：核心领域（`packages/core/**` 除 `config/data`）

读：`DOMAIN_MODEL.md` 全文、本文 §5/§6/§7（M2 读 §7.5 F-09）、`PITFALLS.md` §3.1。

建议顺序：`mulberry32/rng` → `createConfigRepo` → `deriveStats` → `advancePet/advanceHabitat/advanceProfile` → 繁殖/近亲/放生 → `buildBattleSetup/buildEnemyTeam` → `BattleEngine`。

- 不得改 `src/index.ts` 的导出签名、`constants.ts` 数值、`schema.ts` 校验语义；需要时按 §9 提请求。
- 不碰 `config/data/*.json`（D 的）。
- 每步加测试；核心覆盖率 ≥85%；确定性快照（同 setup/seed/commands 逐事件一致）。
- **M2 批次（contract-v1.6）**：导出 `createRng`；实现 `buildDefenseSnapshot` / `buildPvpBattleSetup` / `applyPvpOutcome`；`PvpState` 加可选 `ranked`；补单元测试与 PvP 形态的确定性回归。**不要把 Elo 公式放进 core**（服务端负责）。

### 8.2 B：客户端（`client/**`）

第一件事：按 `client/README.md` 创建 Cocos Creator 3.x 工程与 Boot 空场景（本机没有 Cocos，0 号无法代建）。

- 只 import `@petbattle/core` 的类型/函数、`@petbattle/protocol` 的 `ROUTES`/`ApiContract`；不复制类型。
- `app/` 不直接调 `wx.*`，走 `platform/` 适配器。
- 构建前把 core/protocol 同步到 `client/assets/lib/`（P-103）。
- mock profile 用 core 类型构造；先跑通 Boot → Home → Habitat。
- **M2 批次（contract-v1.6）**：先做 UI kit / 加载·空·错误三态 / 安全区 / 构建配置固定（P-123），再接防守、对手、战报回放、排行榜页面；回放只播 `events`，不改结果。具体顺序见 `SESSION_PROMPTS_M2.md`。

### 8.3 C：服务端（`server/**`）

现状（M1 已合入 main）：`GET /health`、`/auth/guest|refresh`、`/profile`、`/profile/rename`、`/habitat/*`、`/pets/:id/{rename,lock,release}`、`/lineup/set`、`/battle/pve/{start,claim}`、`/breeding/{start,claim}`。
写操作统一走「鉴权 → Idempotency-Key → X-Base-Revision → core 推进 → revision CAS 落库 → patch」；
Postgres 迁移与 docker-compose 已就绪。其余端点仍返回 404。

- 所有响应套 `ApiResponse<T>`；写操作校验 `Idempotency-Key` + `baseRevision`；冲突返回 409 + 最新快照。
- 复用 `@petbattle/core` 计算，不重写战斗/繁殖/时间规则。
- 服务器时间权威；拒绝倒退；离线收益封顶。
- 不接 Redis 直到并发需要；2C2G 约束见 TECH §16.1。
- 框架（node:http / Fastify / Express）由 C 决定，但响应包与错误码必须按 §4。
- **M2 批次（contract-v1.6）**：按 §7.5 实现 `/pvp/defense`（POST/GET）、`/pvp/opponent`、`/pvp/fight`、`/pvp/replay/:id`、`/leaderboard`；快照表/战报表迁移；Elo、日报、匹配、机器人、Semaphore(2)、幂等与审计；关闭 E-09 临时 CSPRNG。微信/Steam 登录可后置。

### 8.4 D：内容与数值（`packages/core/src/config/data/**`、`packages/sim/**`、`tools/content/**`）

- 只改 JSON；改完必须跑 `pnpm validate:config`。
- 需要新字段：写变更请求给 A/0，不要私塞 JSON。
- 数值全部标“初版，待 sim”；跑 `pnpm sim` 输出胜率/回合数/资源曲线/繁殖分布。
- `contentVersion` 随配置变更递增。
- 当前 `traits` 只有 6 条，扩到 15~20 条时保持 rarity 分布与继承权重。

### 8.5 E：美术（`client/assets/art/**`、`client/assets/audio/**`）

- 按 `ART_SPEC.md`；已有 turtle water idle 样张。
- 不改代码、不开 Cocos 编辑器（只交付 PNG/JSON/`.aseprite`）。
- 占位图与最终资源同尺寸/pivot；命名 `pet_{species}_{element}_{action}`。

### 8.6 QA（第 2 波）

- 端到端闭环、确定性回归、构建/上传 dry run；bug 按目录派给所有者。

---

## 9. 变更流程

### 9.1 谁能改

| 内容 | 所有者 | 流程 |
|---|---|---|
| 根配置、lockfile、CI、`packages/protocol/**` | 0 | 直接改；改协议按 §4.4 升版本并通知全体 |
| `packages/core/src/index.ts`、`constants.ts`、`schema.ts` | 0 初始化，之后 A | A 提变更请求 → 0 确认 → A 改；破坏性变更升契约版本 |
| `packages/core/**`（其余） | A | 直接改；接口变化通知 B/C |
| `config/data/**` | D | 只改 JSON；schema 不够找 A |
| `server/**` | C | 直接改；协议响应包变化找 0 |
| `client/**` | B | 直接改；类型变化找 A/0 |
| `docs/CONTRACT.md` | 0 | 只有 0 改；变更请求写 §9.3 |

### 9.2 版本规则

- **兼容变更**：只增可选字段/新端点/新错误码 → `contract-v1.x`，`PROTOCOL_VERSION` 保持 `v1`。
- **不兼容变更**：删改字段、改语义、改必填、改数值常量 → `v2`；新建契约文档，客户端/服务端按 `X-Protocol-Version` 过渡。
- 任何契约变更都要在提交信息里写 `contract:` 前缀，并更新本文 §11 变更记录。

### 9.3 变更请求（其他会话在这里追加，不要直接改共享文件）

| 日期 | 会话 | 需要什么 | 为什么 | 状态 |
|---|---|---|---|---|
| 2026-10-28 | 0 | 建立 contract-v1 | 让 A/B/C/D 可并行 | 已冻结 |
|  |  |  |  |  |

提交格式建议：

```
## 变更请求
- 会话：A/B/C/D/E
- 目标文件/接口：
- 要什么：
- 为什么（对应 PRD/文档/阻塞点）：
- 破坏性：是/否
```

---

## 10. 未决项（阻塞面很小，可并行推进）

1. **被动 `effects` 的具体结算规则**：C-03 只要求填 `target`；开场效果的数值是否吃暴击/克制、是否可被驱散，由 A 在实现 `BattleEngine` 时定义并在 `DOMAIN_MODEL.md` 补一段。
2. ~~PVE 奖励校验模型~~：**已定**（§7.4 E-02）：服务端存会话并从 `setup+seed` 重放。
3. ~~排行榜指标口径~~：**已定**（§7.5 F-05）：`gene` 取四项均值向下取整、`codex` 只算 `owned`、不含蛋。
4. **微信/Steam 登录与账号绑定**：M2 后置，语义未冻结（§7.6）；不影响异步 PvP 与排行榜。
5. **好友互访的每日上限与偷取比例**：Phase 2，接口已冻结，规则后定。
6. **`pnpm build` 产物形态**：M0 仅 typecheck；A 用 esbuild 出 core/protocol，C 用 Docker 出 server，M1 补。
7. ~~协议增量~~：**已定**为返回全量档（C 在 `ONLINE_DESIGN.md` §16.6 记录）；只有客户端出现明确的流量/延迟问题时再加增量 patch。
8. ~~`createPet` 仍为契约桩~~：**已解决**。A 第二批实现了 `createPet` 与 `applyExp`，并按 §7.1 落地 D-01~D-07。D 的批量模拟已可运行，C 可以用 `createPet` 建初始 3 只宠物。
9. **战报体积与压缩**：Demo 先存完整 `events` JSON；若单场超过 256KB 或库增长过快，再评估 gzip/事件裁剪（M3）。
10. **赛季切换的执行点**：M2 在读写档时惰性触发；若 M5 需要准点结算，加定时任务与冻结窗口。

---

## 11. 验收记录

### 11.1 contract-v1（2026-10-28）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型 | `pnpm typecheck` | 通过 |
| 单测 | `pnpm test` | 41 passed（core 33 / protocol 6 / server 2） |
| 规范 | `pnpm lint` | 通过；已验证 core 写入 `Math.random`/`Date.now`/`window` 会报错 |
| 配置 | `pnpm validate:config` | 通过（5/5/16/5/6/1/3/5） |
| 服务 | `tsx server/src/main.ts` + `curl /health` | `{"ok":true,"serverTime":...,"protocolVersion":"v1"}` |
| core 纯度 | ESLint + 代码审查 | 无 `Math.random`/`Date.now`/`cc`/`wx`/DOM/网络 |
| protocol 纯度 | ESLint + 代码审查 | 无业务逻辑；只 type-only 引用 core |
| core 依赖 | 依赖方向 | core 不 import 任何 workspace / client / server |
| 客户端 wx | ESLint 规则 | 已配置；`client/assets/scripts/app` 目前为空 |
| tag | `git tag contract-v1` | 见仓库 |

### 11.2 M1 首批集成（2026-10-29）

| 项 | 结果 |
|---|---|
| A 核心 | 165 测试；`packages/core/src` 行覆盖率 99.27%；同种子事件流一致；同速中立 |
| D 内容 | contentVersion 0.2.0；18 特质；5 关；`validate:config` 通过；sim 静态检查 12/12 |
| C 服务端 | 246 总测试；guest 登录幂等、profile 读写、409 + 最新快照、缺幂等头 400 |
| 合并后 | `typecheck / test（246） / lint / validate:config` 全绿 |
| Postgres | 迁移应用；重启后同 device 仍读到 revision=1 的同一存档 |
| 真实 core | server 日志无降级；`advanceProfile` 正常推进 |
| 已知缺口 | ~~createPet~~ 已补齐；sim 可跑（初版胜率 0.300 / 平均 5.39 回合，待 D 调参） |
| 契约补口 | `BASE_REVISION_HEADER` 进 protocol；`pg` 进 server 依赖；strict 模式不再静默降级 |

### 11.3 A 第二批集成（2026-10-29）

| 项 | 结果 |
|---|---|
| 测试 | 275 passed（22 文件） |
| core 覆盖率 | 行 99.35%，分支 96.45%，函数 100% |
| contract-v1.2 | `releasePet(..., cfg)`、`BreedResult.parentCooldowns`、`BattleEngine.autoCommand`、`applyExp`、栖息地两个可选字段全部落地 |
| 批量模拟 | 5000 场：胜率 0.300、平局 0、平均 5.39 回合、大招间隔 3；7 天资源 金币 2904 / 食物 858 / 基因尘 210；1000 次繁殖突变率 0.029 |
| 结论 | 框架与数据流已通；胜率偏低、回合偏短，属于 D 的初版调参范围（目标见 BALANCE §2） |

### 11.4 B 客户端首批集成（2026-10-29）

| 项 | 结果 |
|---|---|
| 工程 | Cocos Creator 3.8.8，横屏 1920×1080（640×360 的 3×），Point/无 mipmap/无压缩 |
| 场景 | Boot → Home → Habitat 闭环；Home 资源栏/宠物卡，Habitat 槽位/产出/收取/喂食 |
| 平台 | wechat / web / steam 适配器；`wx.*` 只在 `platform/wechat.ts` |
| 状态 | app/store 单向数据流；mock profile 用 core 类型构造（未复制） |
| ApiClient | 按 ROUTES/ApiContract 泛型；带幂等/revision/协议头；409 用 latestProfile 重建 |
| 同步 | `client/assets/lib` 由 `sync-lib.mjs` 生成，`--check` 已进 CI |
| 构建 | web-mobile 与 wechatgame 均成功；debug 包 6.2MB，正式包需 release + 分包 |
| 冒烟 | headless 浏览器 Boot→Home→Habitat，收取后金币/食物同步 |
| 已知 | Habitat 动作仍是 mock（`DEV_CONFIG.useServer=false`）；mock profile 可改用 `createPet`；场景为手写，后续用编辑器保存 |

### 11.5 A 第三批集成（2026-10-29）

| 项 | 结果 |
|---|---|
| 测试 | 342 passed（26 文件）；core 行覆盖率 98.97% |
| D-08 | 测试切到合成配置；删掉 stage_1 敌人数量断言；D 可自由调水/土系 |
| D-09 | `autoCommand` 留能量：大招够就放，距大招 ≤20 时普攻攒能量 |
| D-10 | `buildPveBattleSetup(party, stage, cfg, seed)` |
| D-11 | 放生拒绝防守阵容：`ReleaseError('in_defense')` |
| D-12 | 6 个栖息地操作函数；`careRecoveryPerAction?`（clean/play 默认 20/20） |
| D-13 | `statMods.hit` 改为加法增量，其余比例属性仍是乘数 |
| D-14 | `inheritance.weight` 标 reserved，MVP 不消费 |
| 例外 | A 为保持 `Record<ReleaseErrorReason, …>` 穷尽性，在 `server/src/errors.ts` 加了唯一一行 `in_defense` 映射；0 号确认保留，后续 server 改动归 C |
| 注意事项 | `collectHabitat` 只返回 `{profile, patch}`；`collected` 由 C 在调用前快照 `habitat.stored` 计算 |
| 未决 | `feed/clean/play` 目前不要求宠物在栖息地（不在时用默认恢复量），是否限制为“栖息地内互动”待产品确认 |

### 11.6 A 第四批集成（2026-10-29）

| 项 | 结果 |
|---|---|
| 测试 | 分支 369；合并后全仓 393；core 行覆盖率 98.8% |
| applyProfilePatch | remove 优先、currencies 覆盖、codex 不回退；纯函数 |
| startBreeding | 校验/扣费/产蛋/父母冷却/统计；`BreedingError(reason)`；返回 `{profile, patch, child, inbred, parentCooldowns}` |
| 技能冷却 | `BattleUnit.cooldowns?`；回合递减、cast 设置、availableCommands 过滤；无字段时行为不变 |
| 兼容性 | 新增导出 + 可选字段；无签名破坏 |

### 11.7 C 第三批集成（2026-10-29）

| 项 | 结果 |
|---|---|
| 端点 | `/habitat/move|collect|feed|clean|play|upgrade` 全部接线 |
| 放生闭环 | 初始档 → move 移出 → release 成功；返还基因尘 27；codex owned 不回退 |
| 错误映射 | HabitatError → NOT_FOUND/CAPACITY_FULL/INSUFFICIENT_RESOURCES/VALIDATION_FAILED |
| 冒烟 | 内存：move 200、release 200、feed/clean/play 200、collect 200、upgrade 409（资源不足）、move-back 200；日志无降级 |
| 测试 | 全仓 393 |
| Postgres E2E | 登录 3 只 → move 移出 → release 返还 27 → 重启后 2 只、revision 2、codex owned 保持 true；迁移正常 |

### 11.8 B 第二批集成（2026-10-29）

| 项 | 结果 |
|---|---|
| 场景 | PetList / PetDetail / Breeding |
| 建体 | mockProfile 改用 `createPet` + advanceProfile，不再字面构造 |
| 写操作 | Habitat 动作接入 ApiClient（mock 开关保留）；409 重建与 serverTime 偏移验证 |
| 同步 | `assets/lib` + `assets/resources/config` 由 sync-lib 生成，CI 检查 |
| 构建 | 客户端 typecheck、WeChat 空包、P-116 记录 |

### 11.9 A 第五批集成（2026-10-29）

| 项 | 结果 |
|---|---|
| 测试 | 分支 422；core 行覆盖率 99.07% |
| runBattle | 按序重放；非法命令 `invalid_command`、未结束 `not_finished`；结束后多余命令忽略 |
| applyPveRewards | 仅胜利发奖；首通/重复；经验给仍存在队员；首通蛋（基因 50、性别按序号）；codex；bestTurns |
| claimBreeding | not_found / egg_not_ready / already_claimed；成功移出 eggs |
| 协议 | 无新增改动；`BattleRewards = PveRewards` 自动成立 |
| 确定性 | 指纹 b661e370 未变（不改战斗数值/顺序） |

### 11.10 D 第四批集成（2026-10-29）

| 项 | 结果 |
|---|---|
| 测试 | 424 passed；validate:config 通过（content 0.5.0，19 特质） |
| 奖励模板 | 首通 pets 仅 stage_2 cat/fire、stage_4 snake/earth；repeat 全不发宠物；经验 40/13、50/16、60/20、70/23、80/26 |
| 首通蛋 | 按 E-05 蛋阶段、基因 50、generation 1；30min + 2h = 2.5h 成年；不进 breeding.eggs |
| AI 口径 | **core AI 为主目标**（自动战斗/PvP 防守），sim AI 为人类近似对照；sim 能量阈值对齐 core |
| core AI | 分关 0.979 / 0.825 / 0.614 / 0.589 / 0.480；平均 9.91 回合、平局 1.9%、大招间隔 3.20 |
| sim AI | 分关 0.934 / 0.788 / 0.450 / 0.380 / 0.557；平均 7.43 回合、平局 0.1% |
| 经济/繁殖 | 只产出 2445/621/173；玩家路径 6844/958/211；5000 次突变率 0.037 [0.032,0.043] |
| 已知偏差 | stage_1 5.62 回合作教学关节奏；stage_4 core 0.589 接近上限；近亲加成实测 +0.013；玩家路径仍偏乐观 |

### 11.11 C 第四批集成（2026-10-29）

| 项 | 结果 |
|---|---|
| 测试 | 454 passed（36 文件，本批 +30） |
| PvE | start 校验解锁/编队/seed 服务端生成；claim 重放、首通/重复、失败无奖、平局按失败、多余指令忽略；旧会话 start 失效 |
| 繁殖 | `/breeding/start` 错误按 reason 映射；`/breeding/claim` 三态；成功后 `stats.hatchlings + 1` |
| 迁移 | `schema_migrations` 台账；002 条件重建；重启不再清空会话（P-050） |
| 冒烟 | 登录 → 编队 → start → 重放 6 回合 → claim：winner 0、firstClear、资源 120/10/3 + petExp 40；重放 409 ALREADY_CLAIMED；stage_1 cleared；繁殖 start 200、claim 409 EGG_NOT_READY；stage_1 无首通蛋，宠物仍 3 只（符合数据） |
| Postgres | 迁移台账 001/002；PvE/繁殖全链路；重启后 hatchlings=1、蛋出栏、started 会话保留 |
| 待办 | `createRng(seed)` 尚未从 core 公共入口导出；服务端暂用本地 CSPRNG 适配（繁殖结果落库、不重放） |

**E-09（待 A 补）**：从 `@petbattle/core` 公共入口导出 `createRng(seed: number): Rng`（内部复用 mulberry32）。导出后服务端一行替换本地适配；在此之前允许服务端用 CSPRNG 构造同接口 Rng，但必须在文档注明“繁殖结果落库、不重放”。

### 11.12 B 第三批与 MVP-A 验收（2026-10-29）

| 项 | 结果 |
|---|---|
| 测试 | 454 passed；客户端 sync-lib / typecheck 通过 |
| 客户端 | StageSelect（解锁/编队/克制）+ Battle（本地 BattleEngine、手动/自动、claim）+ Breeding 真实接口；mock/server 同构建切换 |
| mock 主流程 | 自动战斗 21 条指令 6 回合胜利 → 首通 120/10/3 + exp 40 → cleared；繁殖产蛋→快进→领取 |
| server 主流程 | 编队 → start → 33 条指令 8 回合 → claim 成功；繁殖 start → 孵化后 claim 成功 |
| Lead Postgres E2E | 登录 → 编队 → start → claim：winner 0、firstClear、120/10/3 + exp 40；繁殖 start、立即 claim EGG_NOT_READY；重启后 cleared=true、eggs=1、pets=4（3 只 + 蛋）、revision 3 |
| MVP-A 结论 | **主循环闭环成立**：收菜/喂养 → 繁殖 → 战斗（客户端 UI + 服务端结算 + Postgres 持久化） |
| 未覆盖 | BATTLE_EXPIRED/VALIDATION_FAILED 的运行时回归；独立编队页；列表虚拟化；PvP/排行/好友/微信登录 |
| 构建 | P-117/P-118；客户端构建必须带 `startScene=db://assets/scenes/Boot.scene` |

### 11.13 B 第四批与 M1 验收（2026-11-01）

| 项 | 结果 |
|---|---|
| 测试 | 455 passed；客户端 sync-lib / typecheck 通过 |
| 放生 UI | PetDetail 支持移出/放入栖息地、锁定/解锁、放生；二次确认与返还预览；蛋/锁定/编队/防守/最后成年拒绝文案 |
| 本地存档 | `petbattle.profile.v1`，mock 优先读本地、server 覆盖、坏档回退；P-120 时钟超前不覆盖 |
| 错误态 | 9 个错误码文案静态校验；devFaults 注入 BATTLE_EXPIRED，运行时出现“结算失败 + 重开” |
| 计时 | 新档主循环 250 秒（含 26 秒 Cocos 启动）；孵化用页面时钟快进 30 分钟，刷新后进度保留 |
| P-121 修复 | core 放生清理 `breeding.eggs`；server release patch 在变化时下发 `breeding`；Postgres E2E：release 200、patch eggs 0、profile eggs 0、pets 3、返还 27 |
| M1 结论 | **MVP-A 验收项全部闭合**：圈养/繁殖/战斗/放生/本地+云存档/计时；tag `m1` |
| 非阻塞 | 宠物改名 UI、PET_IN_USE 的编队/防守运行时用例、列表虚拟化、正式美术、PvP/排行/好友 |

### 11.14 contract-v1.6 与 M2 契约冻结（2026-11-02）

| 项 | 结果 |
|---|---|
| 基线 | main `0abc6ae`（logo 入库后）；`typecheck / test 455 / lint / validate:config / sync-lib --check` 全绿 |
| 契约 | §7.5 F-01~F-11：防守快照 24h（过期仍可用 + stale）、匹配窗口/机器人、双 AI 重放、Elo K=32/24/16、日报 10 次、四榜口径、战报 30 天 |
| 协议 | `GET /pvp/defense`、`DAILY_LIMIT_REACHED`/`OPPONENT_UNAVAILABLE`/`REPLAY_EXPIRED`、PvP/回放/排行榜 DTO 扩展；`PROTOCOL_VERSION` 仍为 `v1` |
| core 待实现 | `createRng`、`buildDefenseSnapshot`、`buildPvpBattleSetup`、`applyPvpOutcome`、`PvpState.ranked?`（A 批次） |
| 服务端骨架 | 仅 `server/src/errors.ts` 三个状态映射，保证 main 绿；PvP 端点仍 404 |
| 后续 | A → C → B 三批；D 在机器人模板/赛季配置需要时再开；E 暂停 |

### 11.15 A M2 批次集成（2026-11-02）

| 项 | 结果 |
|---|---|
| 测试 | 480 passed（37 文件，本批 +24）；core 行 99.26% / 分支 94.44% / 函数 100% |
| createRng | 从公共入口导出，复用 `mulberry32`；E-09 在 core 侧关闭，服务端适配待 C 删除 |
| PvpState.ranked | 可选 `{ wins, losses, draws }`；旧档无需迁移；patch 深拷贝避免共享引用 |
| buildDefenseSnapshot | 校验顺序 数量→重复→存在→非蛋；uid `d0/d1/d2`；24h TTL；属性/技能/特质/被动与 `buildBattleSetup` 同口径 |
| buildPvpBattleSetup | team0 `a*`、team1 重排 `b*`；空队/超限抛错；不改入参数组 |
| applyPvpOutcome | 胜/负/平/机器人；`stats` 同口径；patch revision 不前移、时间不动；Elo 未进 core |
| 确定性 | 同一 `(attackerPets, snapshot.units, seed)` 双跑事件流与指纹一致 |
| 客户端同步 | `sync-lib` 重新生成 7 个 core 文件；客户端 typecheck、verify-errors、verify-api-client 通过 |
| 接线口径 | 防守方调用 `applyPvpOutcome` 时 `result` 取反（win↔loss，draw 不变）；已写入 §7.5 F-03 |
| 遗留 | C 删除 `server/src/domain/rng.ts` 的临时 CSPRNG 适配；按 §7.5 F-01 做快照与 profile 同事务 |

### 11.16 B 任务 A 预验收（2026-11-02，分支 `m2/b-client`，未合并）

| 项 | 结果 |
|---|---|
| 范围 | UI kit/三态/安全区/虚拟列表/改名/编队组件；PvP 防守/对手/结果/回放/排行榜（mock）；构建脚本与微信模板 |
| 提交 | `af19da6`（基于 `c7c0961`；尚未合并 main，等 C 完成后切真实接口） |
| 验证 | `sync-lib --check`、`typecheck.mjs`、`verify-errors`（12 码）、`verify-api-client`（含 PvP 路由）、`verify-pvp`（防守/匹配/Elo/回放/日报/四榜）全部通过 |
| 构建 | web-mobile 7.22MB、wechatgame 6.45MB（debug 未压缩）；`launchScene=Boot`、横屏、AppID/urlCheck 固定 |
| 浏览冒烟 | mock 模式 Home→防守→匹配→战斗→结果→回放→排行榜全链路通过 |
| 已知 | 真机/真实接口验收待 C；PetList 虚拟列表与改名 UI 的浏览器视觉验收被 IAB splash 卡住，任务 B 补；AppID 仍为 `touristappid`；P-125（CLI 只认 startScene uuid）已记录 |
| 合并门禁 | mock 版不得单独合入 main；C 合并后 B 切真实接口并复验，再按 A → C → B 合并 |

## 12. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| contract-v1 | 2026-10-28 | 首次冻结：workspace/CI、protocol v1、core 公共契约、配置 schema 与样例、server Hello、接手点与变更流程 |
| contract-v1.1 | 2026-10-29 | 兼容补充：`BASE_REVISION_HEADER`；记录 M1 首批集成结果与 `createPet` 缺口 |
| contract-v1.2 | 2026-10-29 | core 签名集中调整（D-01~D-07）：`releasePet` 加 cfg、`BreedResult.parentCooldowns`、`BattleEngine.autoCommand`、`applyExp`、栖息地两个可选配置字段；协议不变 |
| contract-v1.3 | 2026-10-29 | 解除 D/C 阻塞（D-08~D-15）：测试解耦、AI 留能量、PvE setup、放生拒绝防守阵容、栖息地操作函数与 `/habitat/move` 端点、`hit` 修正 |
| contract-v1.4 | 2026-10-29 | 预裁定第四批（D-16~D-18）：`applyProfilePatch`、`startBreeding`、技能回合冷却 |
| contract-v1.5 | 2026-10-29 | 关闭 PvE 与繁殖领取未决项（E-01~E-08）：会话 TTL/重放/奖励/首通蛋/图鉴/繁殖领取；新增两个错误码与 `expiresAt` |
| contract-v1.5.1 | 2026-10-29 | E-09：待导出 `createRng(seed)`；服务端 CSPRNG 适配为临时方案（不改变 E-01~E-08） |
| contract-v1.6 | 2026-11-02 | M2 异步 PvP + 排行榜（§7.5 F-01~F-11）：防守快照/匹配/双 AI 结算/回放/段位/四榜/限流；`GET /pvp/defense` 与三个错误码；core 四个待实现函数 |
