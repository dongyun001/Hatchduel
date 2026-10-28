# 《宠物对决》协作与分工规范（COLLABORATION）

| 项 | 内容 |
|---|---|
| 项目代号 | PetBattle |
| 文档版本 | v1.3 |
| 日期 | 2026-10-28 |
| 适用范围 | 多会话/多人并行开发 |
| 对应文档 | PRD v1.1 / TECH_DESIGN v1.1 / DOMAIN_MODEL v1.1 / ONLINE_DESIGN v1.1 / ART_SPEC v1.2 |

> 本文只管**怎么并行、谁改什么、怎么合并**。产品决策以 `PRD.md` §17 为准；技术方案以 `TECH_DESIGN.md` 为准。发生冲突时，先改 PRD，再回来改本文。

---

## 1. 总原则

1. **先冻结契约，再并行。** 协议、核心类型、配置 schema 没定之前，不要开多个业务会话。
2. **按层分工，不按玩法分工。** 繁殖、战斗、联机都会同时改 core/client/server；按玩法分会互相踩。
3. **一个目录只归一个会话。** 同一个文件同一时间只有一个负责人。
4. **共享文件只由 Lead（0 号会话）改。** 其他会话需要变更时先提请求。
5. **每天合并一次。** 不允许分支飘一周再合。
6. **决策只写 `PRD.md` §17。** 其他文档和会话只读，避免五份文档各说各话。
7. **并行不超过 4~5 个会话。** 超过 5 个，review、合并、环境冲突会变成瓶颈。
8. **AI 会话先读 `AGENTS.md`；新坑写 `PITFALLS.md`。** 踩坑记录只追加，不删除。

---

## 2. 分工总览

### 2.1 第 0 波：契约会话（串行，1 个，2~3 天）

只做“让别人能并行”的事，不写业务实现。

| 交付 | 内容 |
|---|---|
| 仓库骨架 | `git init`、pnpm workspace、tsconfig、ESLint 分层规则、CI |
| 协议 | `packages/protocol`：API DTO、错误码、`ProfilePatch`、战斗指令/事件 |
| 核心契约 | `packages/core` 公共类型与函数签名，先抛 `not implemented` |
| 配置 | 配置 schema、最小样例、`validateConfig` |
| 服务器 | Hello 服务 + `/health` |
| 文档 | 目录所有权、合并顺序、会话模板（本文）；`AGENTS.md`、`PITFALLS.md` 初版 |

**退出条件**：

- `pnpm typecheck`、`pnpm test`、`pnpm lint` 全绿
- `validateConfig` 能跑
- 服务器 `/health` 返回正常
- **`contract-v1` 打 tag 或合并到主分支**

> Cocos 空工程可以在这波由 Lead 纳入仓库，也可以由客户端会话开工第一件事创建；不要为了等 Cocos 拖住契约冻结。

### 2.2 第 1 波：并行（4 个 + 可选 1 个）

| 会话 | 角色 | 负责目录 | 首批任务 |
|---|---|---|---|
| A | 核心领域 | `packages/core/**`（除 `config/data`） | RNG、个体/属性、时间推进、栖息地、繁殖、放生、战斗引擎、确定性测试 |
| B | 客户端 | `client/**` | Cocos 工程、Boot/Home/Habitat/UI kit、store、平台适配、mock 数据 |
| C | 服务端 | `server/**` | 游客/微信登录、profile、revision/patch、云存档、异步 PvP、排行榜、Postgres、2C2G 部署 |
| D | 内容/数值 | `packages/core/src/config/data/**`、`packages/sim/**`、`tools/content/**` | 3 宠物、5 技能、1 关卡、繁殖/经济配置、校验、模拟报告 |
| E（可选） | 美术/音频 | `client/assets/art/**`、`client/assets/audio/**` | 像素样张（水龟）、调色板、UI kit、占位图、Aseprite 导入链路 |

> 没有独立美术时，E 合并到 B 或 Lead，不要为了“凑并行”开空会话。

### 2.3 第 2 波：集成/QA（后置，1 个）

等 A/B/C/D 有可合并内容后再开：

- 端到端（收菜 → 喂养 → 繁殖 → 战斗）
- 确定性回归、配置校验、构建上传
- 压测、修集成 bug、发布检查

---

## 3. 目录所有权矩阵

| 目录/文件 | 所有者 | 说明 |
|---|---|---|
| `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` | 0 | 其他会话不要改；需要依赖先提请求 |
| `tsconfig*.json`、`.eslintrc*`、`.prettierrc*`、`.github/workflows/**` | 0 | 工具链 |
| `packages/protocol/**` | 0 | 协议冻结后按版本演进 |
| `packages/core/src/index.ts`、`config/schema.ts` | 0 初始化，之后 A | 公共 API 与 schema |
| `packages/core/**`（其余） | A | 领域、战斗、时间、经济 |
| `packages/core/src/config/data/**` | D | 只改 JSON 数据 |
| `packages/sim/**`、`tools/content/**` | D | 模拟与内容工具 |
| `client/assets/scenes/**`、`prefabs/**`、`scripts/**`、`settings/**`、`project.config.json` | B | 场景/UI/平台适配 |
| `client/assets/art/**`、`client/assets/audio/**` | E | 像素图/音频 |
| `client/assets/config/**` | B | 运行时配置打包；数据源来自 D |
| `server/**` | C | API、存储、部署 |
| `tests/e2e/**`、`tools/release/**` | QA（第 2 波） | 端到端与发布 |
| 根 `README.md`、`docs/PRD.md`、`docs/TECH_DESIGN.md`、`docs/INDEX.md`、`docs/COLLABORATION.md` | 0 | 项目介绍/产品/技术/索引/本文 |
| `AGENTS.md` | 0 | AI 工作约定 |
| `docs/PITFALLS.md` | 共用（只追加） | 踩坑记录；不删除/不改写他人条目 |
| `docs/DOMAIN_MODEL.md` | A | 数据与算法 |
| `docs/ONLINE_DESIGN.md` | C | 账号/联机 |
| `docs/ART_SPEC.md` | E | 美术规格 |
| `docs/BALANCE.md`（如创建） | D | 数值报告与调参记录 |

> 表里没有的目录，默认归 0；新增目录先登记，再开工。

---

## 4. 各会话职责

### 4.1 0 号：契约与集成（Lead）

- 维护仓库骨架、CI、共享文件、协议版本。
- 冻结 `contract-v1`，之后只做兼容性变更。
- 每天合并各分支，跑 CI，解决跨会话冲突。
- 维护 `PRD.md` §17 决策记录。
- 不写业务实现；业务问题交给对应会话。

### 4.2 A：核心领域

- `packages/core`：RNG、`PetInstance`、`deriveStats`、`advancePet/advanceHabitat`、繁殖、放生、经济、战斗引擎、AI。
- 纯 TS，不引入 Cocos/微信/DOM/网络；时间和随机由调用方注入。
- 维护 `DOMAIN_MODEL.md` 的实现细节。
- 对 D 的配置数据做 schema 校验；对 B/C 提供稳定 API。
- 验收：单测、确定性快照、配置校验、覆盖率 ≥85%。

### 4.3 B：客户端

- Cocos 工程、场景、Prefab、UI kit、store、平台适配器、API 客户端。
- 用 mock profile 跑通页面；不直接调 `wx.*`，统一走 platform adapter。
- 消费 A 的 core 和 0 的 protocol；不复制类型。
- 验收：Boot → Home → Habitat 可点；无 mock 也能启动；不直接依赖服务端实现。

### 4.4 C：服务端

- Node API、游客/微信登录、profile、revision/patch、云存档、异步 PvP、排行榜、审计。
- 复用 A 的 core；不重写战斗/繁殖规则。
- 2C2G 部署：Node + PostgreSQL 同机，Redis 后置，异步 PvP 限并发。
- 验收：`/health`、游客登录、profile 读写、revision 冲突处理、Docker 启动。

### 4.5 D：内容与数值

- 只改配置数据：物种、属性、相性、技能、特质、栖息地、食物、繁殖、关卡、经济。
- 维护 `packages/sim` 和 `tools/content`，输出平衡报告。
- 不改 `schema.ts`、不改 core 公式；需要新字段先找 A。
- 验收：`validateConfig` 通过；3 宠物/5 技能/1 关卡可跑；模拟报告有结论。

### 4.6 E：美术/音频（可选）

- 像素样张、全局调色板、UI kit、宠物精灵表、背景、FX、音效。
- 维护 `ART_SPEC.md`；不改代码。
- 验收：2×/3× 整数缩放下清晰；Aseprite 导入链路跑通；占位图与最终资源同尺寸/pivot。

### 4.7 QA（第 2 波）

- 端到端、确定性、构建、上传、压测、回归。
- 不改业务实现；bug 按目录派给对应会话。

---

## 5. 依赖与合并顺序

```
第 0 波：契约（串行）
   │
   ├── A 核心 ──────────────┐
   ├── D 内容（等 schema） ──┤
   ├── B 客户端（等 protocol + core API）
   ├── C 服务端（等 protocol + core API）
   └── E 美术（等 ART_SPEC，可立即开工）
                            │
                    第 2 波：集成/QA
```

**合并顺序**：契约 → 核心 → 内容 → 服务端/客户端 → 美术 → QA。

- 服务端和客户端可以并行合并，但都必须先基于 `contract-v1`。
- 内容和核心有 schema 边界：A 改 schema，D 改 data；不要互相越界。
- 美术不阻塞代码合并，但会影响客户端最终表现。

---

## 6. 协作规则

### 6.1 共享文件

以下文件只由 0 号会话改：

- 根 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`
- `tsconfig*.json`、ESLint/Prettier 配置、CI
- `packages/protocol/**`
- 根 `README.md`、`docs/PRD.md`、`docs/TECH_DESIGN.md`、`docs/INDEX.md`、`docs/COLLABORATION.md`、`AGENTS.md`
- `docs/PITFALLS.md` 只允许追加；不要删除或改写他人条目

需要变更时：在自己的会话里写清楚“要什么、为什么”，交给 0 号会话改；不要直接动。

### 6.2 目录边界

- 一个目录只归一个会话；跨目录修改视为违规。
- 需要另一个会话的文件时，提请求，不要“顺手改一下”。
- 新增目录先在本文 §3 登记，再开工。

### 6.3 Cocos 编辑器

- **同一时间只允许一个会话打开 Cocos Creator 工程。**
- `.scene`、`.prefab`、`.meta` 冲突很难合；客户端只开一个会话。
- 美术会话只改 PNG/Aseprite/音频，不需要打开编辑器。
- 微信开发者工具也只由客户端会话使用。

### 6.4 配置与 schema

- A 拥有 `schema.ts` 和校验逻辑；D 拥有 `config/data/**`。
- D 需要新字段：先在报告里写清楚，A 加 schema 和校验，D 再加数据。
- D 不得在 JSON 里塞未定义的字段；校验失败即阻断。

### 6.5 Git worktree / 分支

并行会话不要共用同一个工作目录。推荐：

```bash
git init
git add .
git commit -m "docs: v1.0"

git worktree add ../petbattle-contracts -b wt/contracts
git worktree add ../petbattle-core      -b wt/core
git worktree add ../petbattle-client    -b wt/client
git worktree add ../petbattle-server    -b wt/server
git worktree add ../petbattle-content   -b wt/content
git worktree add ../petbattle-art       -b wt/art
```

- 每个会话在自己的 worktree 里工作。
- 只有 0 号会话（或你）合并到主分支。
- 合并前必须 rebase 到最新主分支并跑 CI。

### 6.6 每日合并

- 每天至少一次：0 号会话合并已通过验收的分支。
- 合并顺序见 §5。
- 合并后跑：`pnpm typecheck && pnpm test && pnpm lint` + 服务器冒烟 + 客户端 Boot。
- 冲突由文件所有者解决；0 号会话负责推动。

### 6.7 环境隔离

- 服务端每个 worktree 用独立数据库名/端口；Docker Compose 加项目名前缀。
- 不要同时跑 `pnpm install`；lockfile 由 0 号会话维护。
- 构建产物（`dist/`、`temp/`、`library/`、`build/`）不提交。
- 微信/Steam 的密钥放本地环境变量，不进仓库。

### 6.8 决策与变更

- 跨会话决策写进 `PRD.md` §17，0 号会话维护。
- 协议变更：升 `protocol` 版本，0 号会话通知所有会话。
- 核心 API 变更：A 负责通知 B/C，并提供迁移说明。
- 配置 schema 变更：A 通知 D，D 修数据。
- 新坑：发现者追加到 `docs/PITFALLS.md`，写清现象/原因/规避/验证；只追加，不删除他人条目。
- 不允许“我先复制一份类型，回头再统一”。

---

## 7. 会话启动模板

每个会话开工时，把下面这段贴进去：

```
你负责 PetBattle 的 <范围>。先读根目录 README.md 了解项目、AGENTS.md、docs/INDEX.md、docs/COLLABORATION.md、
docs/PITFALLS.md 中与你范围相关的条目，以及 PRD/TECH/DOMAIN/ONLINE/ART 的相关章节。

工作目录：<worktree 路径>。
只改：<目录列表>。
不要改：<禁止目录列表>。

契约：packages/protocol 和 packages/core 公共类型已冻结（contract-v1）。
需要变更先报告，不要直接改共享文件。

任务：<首批任务>。
验收：pnpm typecheck && pnpm test && pnpm lint，以及 <专项验收>。
完成后汇报：改了哪些文件、接口变化、未决问题、下一步。
```

---

## 8. 验收门槛

| 会话 | 必须通过 |
|---|---|
| 0 契约 | `typecheck/test/lint` 全绿；`validateConfig`；服务器 `/health` |
| A 核心 | 单测 + 确定性快照 + 配置校验；覆盖率 ≥85% |
| B 客户端 | Boot → Home → Habitat 可点；无直接 `wx.*`；mock profile 可跑 |
| C 服务端 | 游客登录、profile 读写、revision 冲突、Docker 启动 |
| D 内容 | `validateConfig`；3 宠物/5 技能/1 关卡；模拟报告 |
| E 美术 | 像素样张 2×/3× 清晰；Aseprite 导入链路；占位图同尺寸 |
| QA | 端到端闭环；构建/上传 dry run；无 P0/P1 bug |

---

## 9. 冲突与异常处理

| 情况 | 处理 |
|---|---|
| 协议/核心接口不够用 | 停止改动，报告 0/A；等契约更新后再继续 |
| 配置 schema 不匹配 | D 停止，报告 A；不要私加字段 |
| 合并冲突 | 文件所有者解决；0 号会话合并 |
| 两个会话改了同一文件 | 以所有者为准；另一个回滚并改请求 |
| 被阻塞超过半天 | 报告，切换到本会话其他任务 |
| 发现跨会话 bug | 按目录派给所有者，不“顺手修” |
| 需要新目录 | 先在本文 §3 登记，再开工 |

---

## 10. 不建议的做法

- 一上来开 6 个以上会话。
- 按玩法分：繁殖会话、战斗会话、联机会话各改一套。
- 两个会话同时开 Cocos 编辑器。
- 所有人直接改 `packages/protocol`。
- 复制类型而不是 import。
- 客户端 `app/` 里直接调 `wx.*`。
- 内容会话改公式或 `schema.ts`。
- 并行跑 `pnpm install` 改 lockfile。
- 长分支不合并，最后一次性解决冲突。
- 把决策只写在聊天里，不写进 `PRD.md` §17。
- 不读 `AGENTS.md` / `PITFALLS.md` 就开工。
- 删除或改写别人写的 `PITFALLS.md` 条目。

---

## 11. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-10-27 | 初版：分工、目录所有权、合并顺序、会话模板、验收门槛 |
| v1.1 | 2026-10-27 | 增加 `AGENTS.md` 与 `docs/PITFALLS.md` 的引用和所有权 |
| v1.2 | 2026-10-28 | 根 `README.md` 改为客户向项目介绍；原文档索引改为 `docs/INDEX.md` |
| v1.3 | 2026-10-28 | 同步各文档 v1.1/v1.2 版本号与 MVP 收窄决策 |
