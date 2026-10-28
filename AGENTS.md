# AGENTS.md

| 项 | 内容 |
|---|---|
| 项目 | PetBattle（《宠物对决》） |
| 版本 | v1.1 |
| 日期 | 2026-10-28 |
| 当前阶段 | **M0 未开始：仓库里只有文档，没有代码** |
| 读者 | AI 编码助手；玩家/客户请看根目录 `README.md`，开发文档索引见 `docs/INDEX.md` |

> 开工前完整读一遍。之后按任务查对应章节。每次发现新坑，追加到 `docs/PITFALLS.md`，不要只留在聊天里。

---

## 0. 项目一句话

微信小游戏首发的宠物养成/繁殖/基因收集游戏；战斗是核心玩法之一；异步联机是核心卖点；后续上 Steam。Demo 免费、像素风、简体中文、2C2G 服务器。

当前已定：MVP 物种 5 种（龟/鱼/青蛙/猫/蛇）、宠物不死亡但可放生、不做主动治疗、性别保留、不做转生/威望、交易后做、实时房间后置、首发地区暂不定。

---

## 1. 开工前必读

按顺序读，不要跳过：

1. 根目录 `README.md`（项目是什么，1 分钟）
2. `docs/INDEX.md`（开发文档索引）
3. `docs/PRD.md` §1~4（定位/核心循环/系统权重）、§13~14（MVP/里程碑）、§17（决策记录）
4. `docs/TECH_DESIGN.md` §2~7（ADR/架构/分层/客户端/核心包）
5. `docs/DOMAIN_MODEL.md`（与你范围相关的章节）
6. `docs/ONLINE_DESIGN.md`（做服务端/联机时）
7. `docs/ART_SPEC.md`（做美术/客户端表现时）
8. `docs/COLLABORATION.md`（分工、目录所有权、合并规则）
9. `docs/PITFALLS.md`（对应领域的坑）

**没读完对应章节，不要开始写代码。** 文档冲突时以 `PRD.md` 为准；发现冲突先报告，不要自行改共享文件。

---

## 2. 边界与所有权

### 2.1 只改你负责的目录

- 一个目录只归一个会话；不要跨目录“顺手改一下”。
- 完整矩阵见 `docs/COLLABORATION.md` §3。
- 共享文件（根 `README.md`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig*`、ESLint/Prettier、`packages/protocol/**`、`docs/PRD.md`、`docs/TECH_DESIGN.md`、`docs/INDEX.md`、`AGENTS.md`、`docs/COLLABORATION.md`）**只由 Lead（0 号会话）改**。
- 你需要共享文件变更时：写清楚“要什么、为什么”，报告给 Lead；不要直接动。

### 2.2 目录速查

| 会话 | 目录 |
|---|---|
| 0 Lead | 根配置、`packages/protocol/**`、PRD/TECH/README/AGENTS/COLLABORATION |
| A 核心 | `packages/core/**`（除 `config/data`）、`docs/DOMAIN_MODEL.md` |
| B 客户端 | `client/**`（除 `assets/art`、`assets/audio`） |
| C 服务端 | `server/**`、`docs/ONLINE_DESIGN.md` |
| D 内容 | `packages/core/src/config/data/**`、`packages/sim/**`、`tools/content/**` |
| E 美术 | `client/assets/art/**`、`client/assets/audio/**`、`docs/ART_SPEC.md` |

表里没有的目录，默认归 0；新增目录先登记再开工。

---

## 3. 硬性技术规则

### 3.1 `packages/core` 纯度

**禁止**：`cc`（Cocos）、`wx`、DOM、`window`、`document`、HTTP/WebSocket、文件系统、数据库、全局单例、`Math.random`、`Date.now`、`performance.now`。

**必须**：时间由调用方传入（`now: EpochMs`）；随机由调用方注入 `Rng`；纯 TS、可序列化、无副作用。

### 3.2 确定性

- PRNG：`mulberry32`；同一场战斗/繁殖只用一个 rng 实例，按固定顺序消费。
- 正态分布用 Irwin–Hall：`Σ(12 次 rng()) − 6`，不要用 Box–Muller。
- 禁止 `Math.sin/cos/exp` 等超越函数参与数值。
- 全程 double；最终 `Math.floor`；倍率保留两位/四位小数（按各模块约定）。
- 同 `(setup, seed, commands)` 必须逐事件一致；改了核心逻辑要跑确定性快照。

### 3.3 服务器权威

- 客户端只提交**动作**，不提交结果（不能提交“我赢了”“我获得 1000 金币”）。
- 所有写操作带 `Idempotency-Key`；`revision` 不匹配返回最新快照。
- 货币、宠物、繁殖、战斗结果由服务器计算；客户端只做表现和乐观更新。
- 离线收益封顶，服务器时间权威，拒绝时间倒退。

### 3.4 时间

- 统一用 `advanceProfile(profile, now, cfg)`：先推进宠物（阶段/状态/冷却），再结算栖息地产出。
- 产出上限 8 小时；需求衰减上限 24 小时；两者分开配置。
- `advanceProfile` 幂等：同一 `now` 调两次不产生额外变化。
- 不允许在 core 里读本地时钟。

### 3.5 战斗

- 3v3 回合制；30 回合上限；平局 `winner = null`。
- 精力：上限 100；回合开始 +20；普攻命中 +10；小技能 40~50；大招 70~80。
- 伤害：`ATK × power × K/(K+DEF)`，K=400；暴击 150%；克制 1.25/0.85；浮动 0.95~1.05。
- 相性在 `deriveStats` 时修正基础属性（±10%），不在伤害里二次乘算。
- 同速排序必须中立（按种子/队伍交替），禁止固定 0 队先手。
- 战斗输入是**个体快照**，不是静态配置；状态差会降低属性。

### 3.6 繁殖、放生、成长

- 物种 50/50；属性 50/50 + 1% 突变；数值基因 = 父母均值 + 波动；特质 3% 突变；性别随机；代数 = max(父母)+1。
- 近亲（3 代内共同祖先）：基因 -5、突变 +2%、繁殖冷却 +20%；MVP 不做受孕失败。
- 计时默认：孵化 30 分钟、幼年 2 小时、成年 7 天后老年、繁殖冷却 2 小时。
- **宠物不死亡**；可放生。蛋、锁定、上阵、栖息地中的宠物不可放生；至少保留 1 只成年宠物。
- 放生返还基因尘；图鉴 `owned` 不回退；服务器写审计日志。
- **不做转生/威望**；世代只是血统/收集维度。

### 3.7 像素风

- 虚拟像素基准 640×360；1920×1080 用 3× 整数放大；1280×720 用 2×。
- 纹理过滤 Point，关闭 mipmap/压缩；禁止非整数缩放和亚像素位移。
- 宠物战斗精灵基础 96×96（大号 128，小号 64）；立绘 256×256；图标 32/48。
- 用 Aseprite 序列帧，**不用 Spine**；8~12fps。
- 中文正文用系统字体在原生分辨率渲染；不要把中文正文做成低分辨率像素字。
- 调色板受限（每宠物 32~48 色）；1px 深色描边；光源统一左上。

### 3.8 平台与数据

- 微信小游戏首发；Steam（Windows）后续；同一账号/存档跨端是设计目标。
- Demo 免费；正式版商业模式待定；MVP 不做付费点。
- 2C2G：Node + PostgreSQL 同机；Redis 后置；异步 PvP 限并发；详见 `TECH_DESIGN.md` §16.1。
- 简体中文；所有文案外置，预留多语言。
- 配置数据驱动：物种/属性/相性/技能/特质/栖息地/食物/繁殖/关卡/经济全部 JSON；不得写死在代码里。
- 交易后做；不做 RMT；随机繁殖概率要公示。

---

## 4. 命令

M0 建立后以根 `package.json` 的 scripts 为准；**不要假设这些脚本已经存在**。目标脚本：

```bash
pnpm install          # 只有 Lead 跑，避免 lockfile 冲突
pnpm typecheck        # tsc --noEmit
pnpm test             # Vitest
pnpm lint             # ESLint + 分层检查
pnpm validate:config  # 配置结构/引用/语义校验
pnpm sim              # 批量模拟与平衡报告
pnpm dev              # 客户端/服务器开发模式
pnpm build            # 构建
```

如果脚本不存在：先报告，不要自己发明一套命令。

---

## 5. 工作流

1. 读文档 + `PITFALLS.md` 对应章节。
2. 确认当前 worktree/分支；不要切换或修改其他会话的分支。
3. 跑基线：`pnpm typecheck && pnpm test && pnpm lint`（若已存在）。
4. 做**最小必要改动**，只碰你负责的目录。
5. 核心逻辑改动必须加/改测试；配置改动必须跑 `validate:config`。
6. 跑验收（见 §6）。
7. 按 §7 格式汇报。

---

## 6. 验收门槛

| 范围 | 必须通过 |
|---|---|
| 核心 | 单测 + 确定性快照 + 配置校验；覆盖率 ≥85% |
| 客户端 | Boot → Home → Habitat 可点；无直接 `wx.*`；mock profile 可跑 |
| 服务端 | `/health`、游客登录、profile 读写、revision 冲突、Docker 启动 |
| 内容 | `validateConfig`；3 宠物/5 技能/1 关卡；模拟报告 |
| 美术 | 像素样张 2×/3× 清晰；Aseprite 导入链路；占位图同尺寸/pivot |
| 文档 | 与 PRD §17 一致；新增决策只由 Lead 写 |

---

## 7. 汇报格式

每次结束按这个格式：

```md
## 完成内容
- ...

## 改动文件
- `path/to/file`：...

## 接口/契约变化
- 无 / 具体变化

## 测试与验证
- 命令：
- 结果：

## 未决问题
- ...

## 下一步
- ...
```

---

## 8. 禁止事项

- 改别人负责的目录或共享文件。
- 复制类型而不是从 `packages/protocol` / `packages/core` import。
- 在 `client/app` 里直接调 `wx.*`；统一走 platform adapter。
- 在 core 里用 `Math.random` / `Date.now` / `cc` / `wx`。
- 把配置写死在代码里。
- 两个会话同时开 Cocos Creator 编辑器。
- 并行跑 `pnpm install` 改 lockfile。
- 提交密钥、构建产物（`dist/`、`temp/`、`library/`、`build/`）。
- 静默修改协议或核心公共类型。
- 删除或改写别人写的 `PITFALLS.md` 条目。
- 未经决策加入死亡、转生、交易、实时房间、付费点。
- 用 ES5 作为构建目标；用 Spine 做像素宠物。
- 把“先这样，回头统一”当成理由复制一套实现。

---

## 9. 遇到问题

| 情况 | 处理 |
|---|---|
| 协议/核心接口不够用 | 停止改动，报告 Lead/A；等契约更新 |
| 配置 schema 不匹配 | 停止，报告 A；不要私加字段 |
| 合并冲突 | 文件所有者解决；Lead 合并 |
| 被阻塞超过半天 | 报告，切换到本会话其他任务 |
| 发现跨会话 bug | 按目录派给所有者，不“顺手修” |
| 发现新坑 | 追加到 `docs/PITFALLS.md`，写清现象/原因/规避/验证 |
| 文档冲突 | 以 PRD 为准，报告 Lead 修订 |

---

## 10. 关联文档

- 产品：`docs/PRD.md`
- 技术：`docs/TECH_DESIGN.md`
- 领域：`docs/DOMAIN_MODEL.md`
- 联机：`docs/ONLINE_DESIGN.md`
- 美术：`docs/ART_SPEC.md`
- 分工：`docs/COLLABORATION.md`
- 踩坑：`docs/PITFALLS.md`
- 人类入口（项目介绍）：根目录 `README.md`；开发文档索引：`docs/INDEX.md`。

---

## 11. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-10-27 | 初版：AI 工作约定、验收与汇报格式 |
| v1.1 | 2026-10-28 | §0 补充 MVP 物种 5 种、不做主动治疗；与 PRD v1.1 同步 |
