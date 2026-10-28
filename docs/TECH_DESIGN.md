# 《宠物对决》技术设计文档（TDD）

| 项 | 内容 |
|---|---|
| 项目代号 | PetBattle |
| 文档版本 | v1.1 |
| 日期 | 2026-10-28 |
| 对应需求 | PRD v1.1 |
| 状态 | 待评审 |

> 本文回答“怎么实现”。数据与算法见 `DOMAIN_MODEL.md`；账号与联机见 `ONLINE_DESIGN.md`；美术规格见 `ART_SPEC.md`。与 PRD 冲突时以 PRD 为准。

**修订记录**：

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-10-27 | 多端重构版 |
| v1.1 | 2026-10-28 | 统一时间推进顺序为 `advanceProfile`；配置清单加 `passives.json`；包体口径与 ART/PRD 对齐；战斗细则指向 DOMAIN |

---

## 1. 目标与非目标

### 1.1 目标

- 一套领域核心同时服务微信小游戏、Steam 客户端和 Node 服务器。
- 圈养、繁殖、离线收益、异步 PvP 的数据边界清楚，可校验、可迁移。
- 内容数据驱动，新增物种/特质/关卡不改业务代码。
- 单人可维护：本地开发、自动化测试、可观测、可回滚。

### 1.2 非目标（v1.0）

- 不做即时动作/帧同步战斗。
- 不做微服务拆分；MVP 是一个 Node 服务 + 一个数据库。
- 不做实时语音、UGC 编辑器、跨服大世界。
- 不追求 3D；2D 横屏。

---

## 2. 关键决策（ADR）

### ADR-001：客户端使用 Cocos Creator 3.x（推翻 v0.1 的“零依赖自绘 Canvas”）

**背景**：产品从“战斗 UI 为主”变成“圈养/繁殖/图鉴/背包/联机”的 UI 密集型游戏，且要同时上微信小游戏和 Steam。

**决策**：客户端使用 Cocos Creator 3.x（当前 LTS）+ TypeScript。

**理由**：

- 一套代码导出微信小游戏和 Windows/Web，避免维护两套前端。
- 自带 UI（Widget/Layout/ScrollView/Label 自动换行）、Prefab、动画、图集、资源管理。
- Steam 端可原生导出，或 Web 构建 + Electron 包装。
- TypeScript 与纯 TS 核心包兼容。

**代价**：

- 小游戏包体需要裁剪，引擎运行时本身占空间。
- 需要学习编辑器工作流。
- Steamworks 需要插件或 Electron 桥接。

**被否决的方案**：

- 纯 Canvas 自绘：UI 工作量过大，无法复用到 Steam。
- Godot：Steam 友好，但微信小游戏支持不成熟。
- Unity：对 2D 养成偏重，WebGL/小游戏包体和性能风险大。

### ADR-002：领域与战斗核心是纯 TS 包，客户端和服务器共用

- `packages/core` 不依赖 Cocos、微信、Steam、DOM、网络、`Math.random`、`Date.now`。
- 服务器用同一个包做校验和模拟；客户端用它做本地预测/离线推进。
- 这样换渲染层、加服务器、做批量模拟都不需要重写规则。

### ADR-003：服务器权威 + 异步优先

- 货币、宠物、繁殖、战斗结果、离线收益都由服务器最终确认。
- 联机第一形态是异步 PvP，不是实时房间。
- 客户端负责表现和即时反馈，不负责“我获得了什么”。

### ADR-004：时间是一等公民

- 圈养、成长、繁殖、产出、离线收益都是“状态 + 时间戳 + 推进函数”。
- 服务器用同一套 `advanceProfile` 复算，客户端只做展示和预测。
- 服务器时间 + 上限 + 异常检测是防作弊基础。

### ADR-005：配置数据驱动

- 物种、属性、相性、克制、技能、特质、栖息地、食物、繁殖、关卡、经济全部 JSON。
- 启动/测试时校验结构和引用完整性；新增内容只改配置。

---

## 3. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│  客户端（Cocos Creator 3.x）                                  │
│                                                              │
│  Presentation   scenes / prefabs / UI / tween / audio        │
│  App services   store / navigation / telemetry / devFlags    │
│  Platform       wx adapter | steam adapter | web adapter      │
│  Transport      ApiClient (HTTPS) | RealtimeClient (WSS)      │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTPS / WSS
┌───────────────▼──────────────────────────────────────────────┐
│  服务器（Node 20 + TypeScript）                               │
│                                                              │
│  API            auth / profile / habitat / breeding / battle │
│  Realtime       room / match / broadcast（Phase 3）           │
│  Services       economy / progression / pvp / leaderboard    │
│  Core           packages/core（同一套领域与战斗规则）          │
│  Storage        PostgreSQL / Redis / object storage          │
└──────────────────────────────────────────────────────────────┘
```

**核心原则**：依赖方向单向。

```
presentation → app services → platform/transport → protocol
                                      ↓
                                    core
server → core + protocol + storage
```

`core` 只被引用，不引用任何人。

---

## 4. 仓库结构（monorepo）

```
petbattle/
├── client/                         # Cocos Creator 工程
│   ├── assets/
│   │   ├── scenes/                 # Boot/Home/Habitat/PetList/...
│   │   ├── prefabs/                # UI 与宠物单元
│   │   ├── scripts/
│   │   │   ├── app/                # 场景、UI、表现、商店
│   │   │   ├── platform/           # wx/steam/web 适配器
│   │   │   ├── services/           # api、store、audio、telemetry
│   │   │   └── dev/                # 调试开关
│   │   ├── art/                    # 图集、立绘、背景、FX
│   │   ├── audio/
│   │   └── config/                 # 运行时配置（构建时注入）
│   ├── settings/                   # Cocos 项目设置
│   └── package.json
├── packages/
│   ├── core/                       # 纯 TS：领域 + 战斗 + 配置校验
│   │   ├── src/
│   │   │   ├── config/
│   │   │   ├── pet/
│   │   │   ├── genetics/
│   │   │   ├── breeding/
│   │   │   ├── habitat/
│   │   │   ├── economy/
│   │   │   ├── time/
│   │   │   ├── battle/
│   │   │   └── index.ts
│   │   └── package.json
│   ├── protocol/                   # DTO、事件、错误码、版本
│   └── sim/                        # 批量模拟与平衡工具
├── server/
│   ├── src/
│   │   ├── api/                    # HTTP 路由
│   │   ├── realtime/               # WSS（Phase 3）
│   │   ├── services/               # 业务编排
│   │   ├── storage/                # DB/Redis/OSS
│   │   └── main.ts
│   └── package.json
├── docs/
├── tools/
├── tests/
│   └── e2e/                        # 端到端（第 2 波）
├── pnpm-workspace.yaml
└── package.json
```

### 4.1 Cocos 与 workspace 的兼容

Cocos 对 `node_modules` 中纯 TS/JS 包的支持有边界。实施顺序：

1. 首选：`tsconfig` paths + 构建前把 `packages/core`、`packages/protocol` 同步到 `client/assets/lib/`（脚本复制）。
2. 若编辑器解析稳定，再直接用 workspace 依赖。
3. 同步是单向的：只允许 `client` 依赖包，不允许包反向依赖 Cocos。

> 不要为了“少一次复制”把领域逻辑写进 `client/`，那是后期换端和上服务器时最贵的债。

---

## 5. 分层与依赖规则

### 5.1 `packages/core`

允许：纯 TS、ES2020、无副作用、可序列化。
禁止：

- `cc`（Cocos）、`wx`、DOM、`window`、`document`
- `Math.random`、`Date.now`、`performance.now`
- HTTP/WebSocket、文件系统、数据库
- 任何全局单例

> 时间由调用方传入；随机数由调用方注入 RNG。

### 5.2 `packages/protocol`

- 只有 DTO、事件、错误码、JSON Schema/校验器。
- 不含业务逻辑。
- 版本号随协议变更递增。

### 5.3 `client`

- `app/` 可以 import `core`、`protocol`、`services`。
- `platform/` 是 wx/Steam/Web API 的唯一入口；`app/` 不直接调 `wx.*`。
- 表现层不计算战斗结果，只消费核心/服务器返回的事件流。

### 5.4 `server`

- 可以 import `core`、`protocol`。
- 业务编排在 `services/`；路由只做鉴权、参数校验、调用服务。
- 数据库访问集中在 `storage/`。

### 5.5 强制手段

- ESLint `no-restricted-imports` 禁止跨层引用。
- `no-restricted-properties` 禁止 `Math.random` / `Date.now`（仅 core 包）。
- `dependency-cruiser` 或自定义脚本检查包依赖方向。
- CI 中跑分层检查，失败即阻断。

---

## 6. 客户端设计（Cocos）

### 6.1 场景

| 场景 | 职责 |
|---|---|
| Boot | 初始化、平台适配、配置加载、登录 |
| Home | 主界面/栖息地入口、资源栏 |
| Habitat | 宠物展示、喂食/清理/玩耍、产出、升级 |
| PetList | 列表/图鉴、筛选、状态 |
| PetDetail | 属性、基因、特质、血统、技能 |
| Breeding | 双亲选择、预览、近亲警告、开蛋 |
| StageSelect | 关卡、敌方预览、首通 |
| Battle | 演出、指令、日志、倍速/自动/跳过 |
| Online | 防守队伍、匹配、战报、排行、好友 |
| Settings | 音效、账号、清档（开发） |

### 6.2 UI 与适配

- 设计分辨率 1920×1080，横屏；`Widget` 适配安全区。
- 列表用 `ScrollView` + 虚拟化（宠物多时）；图鉴用分页。
- 中文文本用 `Label` 自动换行；避免把文字烘焙进图片。
- 字体：系统字体优先；需要统一字形时再引入位图字体。
- 预制体：`PetCard`、`StatBar`、`SkillButton`、`Dialog`、`Toast`、`ResourceBar`。
- 桌面端（Steam）：tooltip、快捷键、更大的信息密度；不强制联网。

### 6.3 资源与包体

- 主包：Boot/Home/Habitat/通用 UI/初始宠物。
- Asset Bundle：`pets`（战斗图）、`portraits`（立绘）、`battle`（背景/FX）、`audio`。
- 微信：主包 ≤2MB（内部预算），分包/远程资源按需加载。
- Steam：本地资源，首包可大，但仍按需加载。
- 资源版本号 + 清单，支持热更新（微信远程资源需合规域名）。

### 6.4 平台适配器

```ts
interface PlatformAdapter {
  readonly kind: 'wechat' | 'steam' | 'web';
  login(): Promise<PlatformLoginResult>;
  getStorage<T>(key: string): Promise<T | null>;
  setStorage<T>(key: string, value: T): Promise<void>;
  now(): number;                    // 仅用于展示；权威时间来自服务器
  share?(payload: SharePayload): Promise<void>;
  vibrate?(type: 'light' | 'medium'): void;
  iap?(sku: string): Promise<PurchaseResult>;
  cloudSave?(data: unknown): Promise<void>;  // 可选桥接
}
```

- `wx`：`wx.login`、`wx.setStorageSync`、`wx.shareAppMessage`。
- Steam：Steamworks SDK（原生）或 Electron 桥接；登录用 Steam 会话票据。
- Web：开发调试用，localStorage。

### 6.5 状态管理

- 轻量 store：`{ profile, ui, session }`，单向数据流。
- 服务器返回 `ProfilePatch`，客户端合并；不做复杂状态机。
- UI 只读 store；动作通过 service 发往服务器/本地核心。

---

## 7. 核心包设计

### 7.1 模块

| 模块 | 职责 |
|---|---|
| `config` | 配置类型、加载、校验、只读查询 |
| `pet` | 个体创建、派生属性、阶段、状态 |
| `genetics` | 基因、特质、遗传、近亲判定 |
| `breeding` | 条件校验、成本、产蛋、孵化 |
| `habitat` | 产出、消耗、容量、升级 |
| `economy` | 货币、收支、幂等 |
| `time` | 时间推进、离线上限 |
| `battle` | 回合引擎、指令、事件流、AI |
| `rng` | 确定性 PRNG |

### 7.2 对外接口（示意）

```ts
// packages/core/src/index.ts
export function createPet(input: CreatePetInput, cfg: ConfigRepo): PetInstance;
export function deriveStats(pet: PetInstance, cfg: ConfigRepo): StatBlock;
export function advancePet(pet: PetInstance, now: EpochMs, cfg: ConfigRepo): PetPatch;
export function advanceHabitat(
  habitat: HabitatInstance,
  pets: PetInstance[],
  now: EpochMs,
  cfg: ConfigRepo,
): HabitatResult;

export function checkBreeding(
  a: PetInstance, b: PetInstance, now: EpochMs,
  profile: Profile, cfg: ConfigRepo,
): BreedCheck;

export function breed(
  a: PetInstance, b: PetInstance, now: EpochMs,
  cfg: ConfigRepo, rng: Rng,
): BreedResult;

export function buildBattleSetup(
  team: PetInstance[], cfg: ConfigRepo, seed: number,
): BattleSetup;

export class BattleEngine {
  static create(setup: BattleSetup, cfg: ConfigRepo): BattleEngine;
  availableCommands(uid: string): Command[];
  submit(cmd: Command): BattleEvent[];
  get state(): Readonly<BattleState>;
}
```

### 7.3 纯函数与状态

- `advancePet`/`advanceHabitat` 输入 `(state, now)`，输出 delta/patch；重复调用相同 `now` 不产生额外变化。
- `breed` 需要注入 RNG；结果必须落库，不能依赖客户端重算。
- `BattleEngine` 内部持有状态；对外 `get state()` 返回深拷贝或只读快照。

### 7.4 确定性

- PRNG：`mulberry32`（见 `DOMAIN_MODEL.md`）。
- `core` 禁止 `Math.random`、`Date.now`。
- 禁止 `Math.sin/cos/exp` 等超越函数参与数值（跨平台 libm 可能不同）。
- 全程 double；最终 `Math.floor` 取整；倍率保留两位小数。
- 同 `(setup, seed, commands)` 必须逐事件一致；CI 用快照回归。

---

## 8. 配置与内容管线

### 8.1 文件

```
packages/core/src/config/data/
├── species.json
├── elements.json
├── affinity.json
├── counters.json          # 也可写在 species.counters
├── skills.json
├── passives.json
├── traits.json
├── habitats.json
├── foods.json
├── breeding.json
├── stages.json
└── economy.json
```

### 8.2 校验

1. 结构：字段类型、范围（cost 0~100、genes 0~100、chance 0~1）。
2. 引用：`speciesId`、`elementId`、`skillId`、`traitId`、`stageId` 必须存在。
3. 语义：禁止自克制；同一对物种不能双向克制（除非配置明确允许）；相性只允许非 0 项；关卡等级在范围内。
4. 经济：产出的资源 id 必须有对应货币/物品。

启动和 CI 都校验；失败时打印具体条目。

### 8.3 内容版本

- `contentVersion` 随配置变更递增。
- 客户端启动时对比服务器版本；不一致时拉取新配置或提示更新。
- 微信远程资源需要合规域名和版本清单。

---

## 9. 时间与离线

### 9.1 时间来源

- 服务器返回 `serverTime`；客户端计算 `offset`。
- 展示用本地时间 + offset；权威判断永远在服务器。

### 9.2 推进模型

```
profile.lastEvaluatedAt = T0
client/server now = T1
advanceProfile(profile, T1):
  dt = clamp(T1 - T0, 0, cap)
  1. 推进宠物：阶段推进 → 状态衰减 → 繁殖冷却/可繁殖时间
  2. 结算栖息地产出（使用推进后的状态）
  3. 返回 patch；lastEvaluatedAt = T1
```

- 顺序固定：宠物先行，栖息地后结算；与 `DOMAIN_MODEL.md` §7、`AGENTS.md` §3.4 一致。
- 产出用 8 小时上限；需求衰减用 24 小时上限；两者分开配置。
- `advanceProfile` 幂等：同一 `T1` 调两次不产生额外变化。
- 任何时间倒退（`T1 < T0`）视为异常，服务器拒绝。
- 离线事件（生病、突变等）如果需要随机，必须由服务器种子或确定性规则产生。

### 9.3 防作弊

- 服务器时间 + 上限 + 合理频率。
- 客户端上报的“我离线了多久”只作为提示，不作为权威。
- 服务器保存最近一次权威快照；客户端同步时提交动作，不提交资源结果。
- 异常检测：收益速率、宠物数量、繁殖频率、战斗胜率。

---

## 10. 存档与同步

### 10.1 Profile

服务器权威的 `Profile` 包含：

- 账号、版本、`revision`
- 货币、宠物、栖息地、编队
- 关卡进度、繁殖状态、设置
- `lastEvaluatedAt`、`createdAt`
- 统计数据

字段定义见 `DOMAIN_MODEL.md`。

### 10.2 同步模型

```
客户端动作 → 本地乐观更新（可选）
          → POST /actions（带 Idempotency-Key、revision）
          → 服务器校验 + 核心计算 + 落库
          → 返回 { patch, revision }
          → 客户端应用 patch
```

- `revision` 不匹配：返回最新快照，客户端重建。
- 所有写操作幂等；重复提交不会重复发奖。
- 客户端本地缓存用于离线展示；不做本地权威。

### 10.3 离线（Steam）

- 离线时本地推进并排队动作。
- 联网后提交 `lastSeenAt` + 排队动作；服务器复算。
- 服务器只接受上限内的收益；超出部分丢弃。
- 冲突时服务器赢，并给客户端提示。

### 10.4 迁移与容错

- `version` + 迁移链（1→2→3…）。
- 写前备份；解析失败回退备份；再失败用默认档。
- 服务器数据库备份 + 审计日志。

---

## 11. 网络与协议

### 11.1 传输

- 普通操作：HTTPS + JSON。
- 实时房间（Phase 3）：WSS + JSON 事件。
- 客户端只依赖 `ApiClient` / `RealtimeClient` 接口；本地开发用 mock。

### 11.2 统一响应

```ts
interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
  revision?: number;
  serverTime: number;
}
```

### 11.3 约定

- 所有写操作带 `Idempotency-Key`。
- 错误码稳定，客户端按 code 处理，不解析文案。
- 协议版本 `v1`；不兼容变更升 `v2`。
- 限流：按账号/IP/接口；写操作更严格。
- 微信域名白名单：HTTPS/WSS 域名需在小游戏后台配置。

---

## 12. 战斗实现

### 12.1 输入

`BattleSetup` 由个体快照构建：

```ts
interface BattleSetup {
  seed: number;
  teams: [BattleUnitInit[], BattleUnitInit[]];
}
interface BattleUnitInit {
  uid: string;
  petId: string;
  speciesId: string;
  elementId: string;
  level: number;
  stats: StatBlock;       // 已含等级/基因/状态/特质/相性/被动 statMods
  skills: SkillId[];
  traits: TraitId[];
  passiveId?: string;     // 物种被动；effects 在 battleStart 一次性应用
}
```

### 12.2 指令与事件

```ts
type Command =
  | { type: 'skill'; turn: number; uid: string; skillId: string; targetUids: string[] }
  | { type: 'surrender' };
```

- 指令校验：回合、存活、轮到、精力、目标合法性。
- 事件流：`battleStart / turnStart / cast / hit / miss / heal / shield / buff / dot / death / battleEnd`。
- 回放 = `{ setup, seed, commands }`；事件流用于演出和调试。
- **战斗结算细则（回合顺序、状态、死亡、平局、初始精力 0）以 `DOMAIN_MODEL.md` §9.3 为准。**

### 12.3 服务器权威

- PvP：服务器创建战斗、持有引擎、接收指令、广播事件。
- PVE：可本地跑，但首通奖励由服务器校验（关卡 id、阵容、幂等键）。
- 客户端不能提交“战斗结果”，只能提交指令。

### 12.4 AI

- 确定性优先级策略；与玩家共用 `availableCommands/submit`。
- 自动战斗 = AI 提交指令；跳过动画 = 消费事件到终态。

---

## 13. 联机实现（概要）

详细见 `ONLINE_DESIGN.md`。

- Phase 1：账号、云存档、异步 PvP、排行榜。
- 异步 PvP：防守快照 → 服务器模拟 → 战报 → 段位。
- Phase 2：好友互访、赛季、受限交易。
- Phase 3：实时房间（回合制、同时盲选、30 秒超时、快照+日志重连）。

---

## 14. 安全与反作弊

| 威胁 | 对策 |
|---|---|
| 改客户端刷货币/宠物 | 服务器权威；客户端只提交动作 |
| 改本地时间刷离线 | 服务器时间；离线上限；异常检测 |
| 重放请求重复领奖 | Idempotency-Key；唯一约束；审计 |
| 伪造战斗结果 | 服务器模拟；只接受指令 |
| 繁殖结果篡改 | 服务器生成并落库；客户端只展示 |
| 交易 RMT | Phase 2 设计：绑定、限额、税、日志 |
| 撞库/盗号 | Token 短有效期、刷新、设备管理、异常登录 |

- 客户端混淆只是提高成本，不作为安全边界。
- 所有经济变更写入审计日志，可追溯。

---

## 15. 测试与工具

| 测试 | 内容 | 工具 |
|---|---|---|
| 单元 | 属性公式、阶段、需求、遗传、近亲、经济 | Vitest |
| 确定性 | 同 setup/seed/commands 双跑一致 | Vitest 快照 |
| 配置 | 结构、引用、语义 | Vitest + tools/validateConfig |
| 模拟 | 1000+ 场战斗/养成路径统计 | packages/sim |
| 服务器 | API、幂等、并发、迁移 | Vitest + 测试库 |
| 客户端 | 关键场景冒烟 | 手工 + 自动化（后续） |
| 负载 | 登录/异步 PvP/排行 | k6（Phase 2） |

- `core` 覆盖率 ≥85%。
- `tools/repl.ts`：终端跑一场战斗/一次繁殖，不进模拟器。
- `tools/sim.ts`：批量跑对局，输出胜率、回合数、资源曲线。

---

## 16. 构建与 CI/CD

| 环节 | 工具 |
|---|---|
| 包管理 | pnpm workspace |
| 类型检查 | `tsc --noEmit` |
| 测试 | Vitest |
| 代码规范 | ESLint + Prettier |
| 分层检查 | dependency-cruiser / 自定义脚本 |
| 核心构建 | esbuild（target `es2020`，**不要 ES5**） |
| 客户端 | Cocos Creator 构建（WeChat / Windows / Web） |
| 微信上传 | miniprogram-ci |
| 服务器 | Docker + 迁移脚本 |
| Steam | Cocos Windows 构建 + Steamworks 插件，或 Web + Electron |

**关于 ES2020**：微信小游戏运行时支持 ES2015+；esbuild 对 ES5 降级支持不完整（async/generator 等会报错），不要设 ES5。

### 16.1 Demo 部署（2C2G）

- 单台 2C2G VPS：Node（API）+ PostgreSQL 同机；Redis 先不上，排行榜/限流用内存或数据库，等并发上来再拆。
- Nginx 反向代理 + HTTPS；WSS 同端口升级（Phase 3 再开）。
- 2G swap；Postgres 连接池上限 20；Node 堆上限 1G。
- 异步 PvP 模拟**限并发**（例如同时 2 个），排队执行，避免 2C2G 被 CPU 打满。
- 备份：每日全量 + 增量；资源/战报放 OSS/CDN。
- 扩容信号：CPU 持续 >70%、API p95 >300ms、模拟排队 >5s；先升 4C4G，再拆 DB/Redis。

---

## 17. 性能预算

| 项 | 预算 | 手段 |
|---|---|---|
| 微信主包 | ≤2MB（内部） | 裁剪、Asset Bundle、远程资源 |
| 微信总资源 | ≤15MB（内部） | 像素图集、按需加载；官方上限以最新规则为准 |
| 首屏 | ≤3s（4G 中端机） | 主包小、Boot 不加载图鉴 |
| 战斗单回合 | ≤50ms | 纯逻辑；Node 实测 |
| UI | 60fps | 实例池、合批、避免逐字重绘 |
| 内存 | ≤200MB（小游戏） | 资源释放、图集上限 |
| 服务端 API | p95 ≤200ms | 索引、缓存、异步 PvP 预计算 |
| 异步 PvP 模拟 | ≤100ms | 纯逻辑、限并发 |

---

## 18. 可观测性

- **日志**：结构化 JSON，带 `accountId`、`requestId`、`action`。
- **指标**：DAU、循环完成率、繁殖次数、PvP 参与率、匹配成功 rate、API p95、错误率。
- **崩溃**：客户端崩溃上报；小游戏后台 + 自建。
- **审计**：经济变更、繁殖、交易、封禁。
- **告警**：错误率、延迟、数据库连接、异常收益。

---

## 19. 里程碑交付物

| 阶段 | 技术交付物 |
|---|---|
| M0 | Cocos 工程 + Boot/Home；`packages/core` 骨架与 RNG；配置校验；`packages/protocol`；服务器 Hello；CI（tsc/Vitest/lint/分层）；美术规格 |
| M1 | 个体/属性/时间/栖息地/繁殖/战斗核心；本地存档；MVP-A 闭环；核心测试 ≥85% |
| M2 | 账号（微信/游客）、云存档、revision/patch、异步 PvP、排行榜；服务器部署 |
| M3 | 5 关内容、10 宠物、图鉴、平衡报告；微信构建/提审；埋点 |
| M4 | Steam 构建、Steamworks 登录/云存档/成就、桌面 UX、跨端绑定 |
| M5 | 实时房间、交易、公会、赛季、Live Ops |

---

## 20. 风险与对策

| 风险 | 对策 |
|---|---|
| Cocos 对 workspace 包解析不稳 | 构建前同步到 `assets/lib/`；保持包无副作用 |
| 小游戏包体超限 | 主包瘦身 + Asset Bundle + 远程资源 |
| Aseprite 导入链路 | M0 验证转换脚本/序列帧；必要时改用 TexturePacker |
| Steamworks 接入复杂 | 先用 Web+Electron 验证，再评估原生插件 |
| 跨端数值不一致 | 纯 TS、无超越函数、最终 floor、确定性回归 |
| 服务器成本 | 云托管、按需扩容、异步优先 |
| Demo 2C2G 容量不足 | 限并发、排队、监控、先升配再拆服务 |
| 存档迁移出错 | 版本链、备份、回滚、审计 |
| 单人维护不过来 | MVP 三段拆分、自动化、先小规模 |
