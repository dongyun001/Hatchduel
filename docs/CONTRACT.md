# 《宠物对决》契约冻结说明（CONTRACT）

| 项 | 内容 |
|---|---|
| 项目代号 | PetBattle |
| 契约版本 | **contract-v1** |
| 冻结时间 | 2026-10-28 |
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
| 领域类型与函数签名 | `packages/core/src/index.ts`（re-export 各模块） | 冻结；contract-v1.2 全部函数已实现，无剩余桩；签名调整见 §7.1 |
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

### 2.3 CI

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

`UNAUTHENTICATED`、`FORBIDDEN`、`NOT_FOUND`、`VALIDATION_FAILED`、`REVISION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`RATE_LIMITED`、`TIME_BACKWARDS`、`NOT_IMPLEMENTED`、`INTERNAL`、`CONFIG_INVALID`、`INSUFFICIENT_RESOURCES`、`CAPACITY_FULL`、`COOLDOWN_ACTIVE`、`PET_NOT_FOUND`、`PET_LOCKED`、`PET_IN_USE`、`EGG_NOT_RELEASABLE`、`LAST_ADULT`、`INVALID_LINEUP`、`STAGE_LOCKED`、`BATTLE_NOT_FOUND`、`BATTLE_FINISHED`、`ALREADY_CLAIMED`。

只增不改；文案由客户端按 code 本地化，服务端 message 只用于日志。

### 4.3 端点（`src/endpoints.ts`，28 条，其中 23 条写路由）

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
| renamePet | POST | `/pets/:id/rename` | `RenamePetRequest` → `ProfileWriteResponse` |
| setPetLock | POST | `/pets/:id/lock` | `SetPetLockRequest` → `ProfileWriteResponse` |
| releasePet | POST | `/pets/:id/release` | — → `ReleasePetResponse` |
| startBreeding | POST | `/breeding/start` | `StartBreedingRequest` → `StartBreedingResponse` |
| claimBreeding | POST | `/breeding/claim` | `ClaimBreedingRequest` → `ClaimBreedingResponse` |
| startPveBattle | POST | `/battle/pve/start` | `StartPveBattleRequest` → `StartPveBattleResponse` |
| claimPveBattle | POST | `/battle/pve/claim` | `ClaimPveBattleRequest` → `ClaimPveBattleResponse` |
| setLineup | POST | `/lineup/set` | `SetLineupRequest` → `SetLineupResponse` |
| setPvpDefense | POST | `/pvp/defense` | `SetPvpDefenseRequest` → `ProfileWriteResponse` |
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

- **contract-v1.1（2026-10-29）**：新增 `BASE_REVISION_HEADER` 常量（C 实现 `/profile/rename` 时需要的写操作头）。兼容变更，端点与 DTO 不变。
| 删除/重命名字段、改语义、改必填性 | 不兼容；升 `v2`，新建 `docs/CONTRACT-v2.md`，双版本过渡 |
| 错误码新增 | 兼容；只增不改 |

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
| `BattleEngine` | `create` / `availableCommands` / `submit` / `state` / `autoCommand(uid)`（v1.2） |

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

> D-05/D-06 的字段是**可选**的，避免 D 还没填数据时阻断 A；但两者都必须从配置读取，不允许 A 再写死第二套默认值。

---

## 8. 各会话接手点

### 8.1 A：核心领域（`packages/core/**` 除 `config/data`）

读：`DOMAIN_MODEL.md` 全文、本文 §5/§6/§7、`PITFALLS.md` §3.1。

建议顺序：`mulberry32/rng` → `createConfigRepo` → `deriveStats` → `advancePet/advanceHabitat/advanceProfile` → 繁殖/近亲/放生 → `buildBattleSetup/buildEnemyTeam` → `BattleEngine`。

- 不得改 `src/index.ts` 的导出签名、`constants.ts` 数值、`schema.ts` 校验语义；需要时按 §9 提请求。
- 不碰 `config/data/*.json`（D 的）。
- 每步加测试；核心覆盖率 ≥85%；确定性快照（同 setup/seed/commands 逐事件一致）。
- 把 stub 改成实现时，同步删掉 `contract.test.ts` 里对应的“抛 not implemented”用例。

### 8.2 B：客户端（`client/**`）

第一件事：按 `client/README.md` 创建 Cocos Creator 3.x 工程与 Boot 空场景（本机没有 Cocos，0 号无法代建）。

- 只 import `@petbattle/core` 的类型/函数、`@petbattle/protocol` 的 `ROUTES`/`ApiContract`；不复制类型。
- `app/` 不直接调 `wx.*`，走 `platform/` 适配器。
- 构建前把 core/protocol 同步到 `client/assets/lib/`（P-103）。
- mock profile 用 core 类型构造；先跑通 Boot → Home → Habitat。

### 8.3 C：服务端（`server/**`）

现状（M1 首批已合入 main）：`GET /health`、`POST /auth/guest`、`POST /auth/refresh`、`GET /profile`、`POST /profile/rename`。
写操作统一走「鉴权 → Idempotency-Key → X-Base-Revision → core 推进 → revision CAS 落库 → patch」；
Postgres 迁移与 docker-compose 已就绪，`pg` 已成为 `server` 的正式依赖（原先的临时桥已删除）。其余端点仍返回 404。

- 所有响应套 `ApiResponse<T>`；写操作校验 `Idempotency-Key` + `baseRevision`；冲突返回 409 + 最新快照。
- 复用 `@petbattle/core` 计算，不重写战斗/繁殖/时间规则。
- 服务器时间权威；拒绝倒退；离线收益封顶。
- 不接 Redis 直到并发需要；2C2G 约束见 TECH §16.1。
- 框架（node:http / Fastify / Express）由 C 决定，但响应包与错误码必须按 §4。

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
2. **PVE 奖励校验模型**：`claimPveBattle` 提交 commands，服务端重放还是只校验战斗会话？建议 C 先存 `battleId → setup/seed` 会话，再重放；不在 contract 层强制。
3. **排行榜指标口径**：`bestGene` 取四项均值、图鉴数量是否含未拥有剪影，待 D/C 定。
4. **好友互访的每日上限与偷取比例**：Phase 2，接口已冻结，规则后定。
5. **`pnpm build` 产物形态**：M0 仅 typecheck；A 用 esbuild 出 core/protocol，C 用 Docker 出 server，M1 补。
6. ~~协议增量~~：**已定**为返回全量档（C 在 `ONLINE_DESIGN.md` §16.6 记录）；只有客户端出现明确的流量/延迟问题时再加增量 patch。
7. ~~`createPet` 仍为契约桩~~：**已解决**。A 第二批实现了 `createPet` 与 `applyExp`，并按 §7.1 落地 D-01~D-07。D 的批量模拟已可运行，C 可以用 `createPet` 建初始 3 只宠物。

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

## 12. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| contract-v1 | 2026-10-28 | 首次冻结：workspace/CI、protocol v1、core 公共契约、配置 schema 与样例、server Hello、接手点与变更流程 |
| contract-v1.1 | 2026-10-29 | 兼容补充：`BASE_REVISION_HEADER`；记录 M1 首批集成结果与 `createPet` 缺口 |
| contract-v1.2 | 2026-10-29 | core 签名集中调整（D-01~D-07）：`releasePet` 加 cfg、`BreedResult.parentCooldowns`、`BattleEngine.autoCommand`、`applyExp`、栖息地两个可选配置字段；协议不变 |
