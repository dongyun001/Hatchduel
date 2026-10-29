# 并行会话启动提示词（M0 之后）

| 项 | 内容 |
|---|---|
| 用途 | 复制对应代码块，直接粘贴给一个独立会话 |
| 依据 | `contract-v1`（tag 在 `main`）、`docs/CONTRACT.md`、`docs/COLLABORATION.md` |
| 维护者 | 0 号（Lead） |
| 日期 | 2026-10-29 |

---

## 0. 当前进度与并行数量

**首批已合并**（2026-10-29）：A 的 core 实现、D 的内容/sim、C 的 guest 登录/profile/revision/幂等/Postgres 全部进入 `main`，246 个测试、lint、validate、Postgres 冒烟通过。

接下来可以并行：

| 会话 | 状态 | 下一步 |
|---|---|---|
| A | **第二批已完成并合入 main**（createPet/applyExp + v1.2） | 等 D 的平衡反馈；下一批可做 A 报告里列出的剩余项 |
| D | 首批已完成，第二批待做 | 按 §3：分关平衡 + 补栖息地字段 + 修近亲对照 |
| C | 首批已完成，第二批待做 | 按 §2：真实初始档 + 宠物 rename/lock/release + 编队 |
| B | **Cocos Creator 3.8.8 已装**（`C:\ProgramData\cocos\editors\Creator.8.8`） | 按 §4 开工 |
| E | 暂停 | 美术不参与本轮 |

- 可同时跑 **3~4 个**（A、D、C，加 B 装好编辑器后）；上限 4（COLLABORATION §1）。
- 同一时间只允许一个会话开 Cocos Creator；`pnpm install` 不要并行跑。
- 当前契约版本 **contract-v1.1**（新增 `BASE_REVISION_HEADER`，兼容）。

---

## 1. A —— 核心领域

工作目录：`D:\github-mine\petbattle-core`（分支 `wt/core`）

```
你负责 PetBattle 的 A 核心领域会话。

工作目录：D:\github-mine\petbattle-core（分支 wt/core，基于 main 的 contract-v1）。
只改：packages/core/**（除 packages/core/src/config/data/**）。
不要改：packages/protocol/**、client/**、server/**、packages/core/src/config/data/**、
        根配置（package.json / tsconfig / ESLint / CI）、docs/PRD.md、docs/TECH_DESIGN.md、docs/CONTRACT.md。
你可以改：docs/DOMAIN_MODEL.md（实现细节）。

开工前按顺序读：
1. AGENTS.md
2. docs/CONTRACT.md §5（core 公共契约）、§6（配置）、§7（C-01~C-09 澄清）、§8.1（你的接手点）、§9（变更流程）
3. docs/DOMAIN_MODEL.md 全文
4. docs/PITFALLS.md §0 红线、P-001~P-004、P-024、P-025、P-031~P-034、P-039~P-041
5. packages/core/src/index.ts、src/api.ts（stub 签名）、src/constants.ts、src/config/schema.ts

契约已冻结：packages/core 的公共类型、函数签名、常量和配置 schema 都不能改。
需要改签名/加导出/改常量时，先停下，按 docs/CONTRACT.md §9.3 写变更请求并报告，不要私改。

首批任务（按顺序做，每一步都要加/改测试）：
1. src/rng.ts：mulberry32 + Rng（chance / pick；pick 空数组抛错）；同种子序列固定。
2. createConfigRepo(data)：只读索引 + 引用完整性；复用 assertConfig，缺 id 时抛明确错误。
3. deriveStats：严格按 DOMAIN §4.1/§4.2；验证示例（ATK 20 → 35）、crit/dodge/hit clamp、蛋阶段为 0。
4. advancePet / advanceHabitat / advanceProfile：阶段→状态→冷却→产出；产出 8h 上限、
   衰减 24h 上限；同一 now 幂等；now 倒退抛 TimeError；产出按 dtHours 线性插值，0 宠物不除 0。
5. checkBreeding / breed / isInbred / releasePet：物种/属性 50/50、1% 属性突变、Irwin–Hall 波动、
   近亲 3 代（基因 -5、突变 +2%、冷却 ×1.2）、3% 特质突变、祖先去重、放生五类拒绝、返还基因尘。
6. buildBattleSetup / buildEnemyTeam / BattleEngine：初始精力 0、每回合 +20、普攻命中 +10、
   K=400、暴击 150%、克制 1.25/0.85、浮动 0.95~1.05、同速中立 tiebreaker（禁止固定 0 队先手）、
   30 回合平局、确定性 AI 策略。
7. 把 packages/core/test/contract.test.ts 里你已实现函数的“抛 not implemented”用例删掉，保留未实现的。
8. 每完成一个模块跑一次：pnpm typecheck && pnpm test && pnpm lint。

专项验收：
- 确定性：同一 (setup, seed, commands) 双跑，事件流逐条一致；至少一个固定种子快照。
- 同速交换队伍顺序，先手分布接近中立。
- pnpm test:coverage 中 packages/core/src 行覆盖率 ≥85%。
- 无 Math.random / Date.now / cc / wx / DOM / 网络 / 超越函数；ESLint 通过。
- 不改 packages/core/src/config/data/**（D 的），需要改数据样例先报告。

纪律：
- 不并行跑 pnpm install；需要新依赖先报告 0 号。
- 不复制 protocol 类型；core 不 import 任何其他包。
- 每天把可合并的进度报告给 0 号，由 0 号合并；不要自己合并到 main。
- 汇报按 AGENTS.md §7（完成内容/改动文件/接口变化/测试验证/未决问题/下一步）。
```

---

## 2. C —— 服务端（第二批：初始档 + 宠物操作）

工作目录：`D:\github-mine\petbattle-server`（分支 `wt/server`）。开工前先 `git merge main`（当前 `main` 为 `contract-v1.2`，core 已无桩）。

```
你继续负责 PetBattle 的 C 服务端会话，做第二批。

工作目录：D:\github-mine\petbattle-server（分支 wt/server）。
开工前先 git merge main（当前 main d57c66d / contract-v1.2，core 已无桩）。
只改：server/**、docs/ONLINE_DESIGN.md。
不要改：packages/**、client/**、tools/**、根配置、packages/protocol/**、docs/CONTRACT.md。

先读：
- docs/CONTRACT.md §4（协议）、§7.1（v1.2 签名）、§8.3、§9
- docs/ONLINE_DESIGN.md §4/§5
- server/src/domain/{starter-profile,core-adapter,config-provider}.ts
- packages/core/src/api.ts（createPet / releasePet / advanceProfile / applyExp 签名）
- docs/PITFALLS.md P-029、P-042、P-043、P-046

本批目标：新账号有真实初始档；接宠物基础操作与编队；放生按 v1.2 签名。

任务：
1. 初始档（server/src/domain/starter-profile.ts）：
   - 用 @petbattle/core 的 createPet 创建 3 只：水龟(turtle/water)、雷鱼(fish/thunder)、草蛙(frog/grass)；
     基因四项 50、traits 空、generation 1、parents [null,null]。
   - 性别固定 [male, female, male]，保证 1 公 1 母。
   - createPet 的 now 传 `now - breeding.hatchMs - breeding.juvenileMs`，再对整档调用
     advanceProfile(profile, now, repo)，断言三只 stage==='adult'、fertility.readyAt<=now。
     不要在 server 里手写阶段/属性规则。
   - currencies 用 economy.startingResources；栖息地 meadow 1 级，slots 放 3 只（第 4 格 null），
     每只 habitatId 指向它；codex 对 3 个组合写 seen/owned、bestGene=50；
     lineup/defense 空；revision 0，createdAt/lastEvaluatedAt=now（首次登录无离线收益）。
   - 测试：3 只、1 公 1 母、全成年、可繁殖、栖息地槽位、codex、幂等（同 device 重复登录不重复建宠）。
2. 宠物端点：
   - POST /pets/:id/rename：校验归属/长度；返回 patch。
   - POST /pets/:id/lock：locked 切换。
   - POST /pets/:id/release：调用 core releasePet(profile, petId, now, cfg)；
     把 ReleaseError.reason 映射到协议错误码（EGG_NOT_RELEASABLE / PET_LOCKED / PET_IN_USE / LAST_ADULT 等）；
     返还写回 currencies；图鉴 owned 不回退；写审计日志。
3. POST /lineup/set：最多 3、属于本人、非蛋、引用存在、去重；与 pvp/defense 不联动；
   幼年可上阵（属性由战斗时 deriveStats 处理，不在编队接口算）。
4. 生产默认：docker-compose 设 PETBATTLE_CORE_STUB=strict；本地 memory 模式可显式放宽。
5. 测试：初始档、rename/lock/release（含四类拒绝与返还）、lineup 校验、revision/幂等/401 回归。
6. 更新 docs/ONLINE_DESIGN.md §16 的端点列表与初始档说明。

专项验收：
- pnpm typecheck && pnpm test && pnpm lint && pnpm validate:config 通过。
- server 在真实 core 下不再降级（日志无“降级”）；guest 登录后 GET /profile 有三只成年宠。
- Postgres 路径仍可用（本地 docker 起 Postgres，跑一次登录 + 放生）。
- 不放行“客户端提交结果”；不复制 core 规则；所有写操作幂等 + X-Base-Revision。

不要做：栖息地喂食/清理/玩耍/升级、繁殖、战斗、PvP 端点——这些还缺 core 公共函数
（feed/clean/play 的领域函数没有）；需要推进时按 docs/CONTRACT.md §9.3 提请求，不要自己实现规则。

汇报 AGENTS.md §7，额外列出：本批用到的 core 函数、剩余端点还缺哪些 core API、是否需要 A 补函数。
```

## 3. D —— 内容与数值（第二批：平衡 + 新字段）

工作目录：`D:\github-mine\petbattle-content`（分支 `wt/content`）。开工前先 `git merge main`（当前 `main` 为 `contract-v1.2`，sim 已可跑）。

```
你继续负责 PetBattle 的 D 内容与数值会话，做第二批。

工作目录：D:\github-mine\petbattle-content（分支 wt/content）。
开工前先 git merge main（当前 main d57c66d / contract-v1.2；core 已实现 createPet，sim 可跑）。
只改：packages/core/src/config/data/**、packages/sim/**、tools/content/**、docs/BALANCE.md。
不要改：packages/core/src/config/schema.ts、core 其他源码、protocol、server、client、根配置、docs/CONTRACT.md。

先读：
- docs/CONTRACT.md §6、§7.1（D-05/D-06）、§8.4
- docs/BALANCE.md（目标表 §2）
- packages/core/src/config/data/*.json、packages/sim/src/**
- docs/PITFALLS.md P-002、P-042、P-106、P-108

当前 sim 结果（main d57c66d）：
- 5000 场：总胜率 0.300、平局 0、平均 5.39 回合、大招间隔 3
- 7 天：金币 2904 / 食物 858 / 基因尘 210
- 1000 次繁殖：突变率 0.029、近亲比例 0

任务：
1. 先跑 pnpm sim --write，确认报告按关卡输出（每关胜率/回合数/平局率）；
   如果 sim 只汇总总数，补 per-stage 输出。
2. 查“近亲比例 0”：检查 packages/sim/src/breeding.ts 的近亲对照组是否真的构造了 3 代内共同祖先；
   修正后重跑。
3. 按 BALANCE §2 调 5 关：
   - 目标胜率：关1 ≥0.85，关2 0.70，关3 0.55，关4 0.45，关5 0.35~0.60（±0.15）；
   - 平均回合 6~18；平局 <5%；小技能密度 <0.5；大招间隔 2.5~4.5；
   - 只改 skills/stages/traits/economy 数据；技能成本仍守小 40~50、大 70~80。
4. 补两个栖息地字段到 habitats.json：
   - hungerPenaltyWhenNoFoodPerHour（建议 1~2，与食物产出/消耗一起验证不软锁）；
   - productionStageMul { juvenile: 0.5, adult: 1, elder: 0.8 }（确认与 DOMAIN §6.1 一致）。
5. contentVersion 升到 0.3.0；跑 pnpm validate:config。
6. 更新 docs/BALANCE.md：分关结果、调参前后对比、结论；标注“初版，待更多样本”。
7. 不新增未定义 JSON 字段；需要新字段先按 CONTRACT §9.3 提请求。

专项验收：
- pnpm validate:config && pnpm typecheck && pnpm test && pnpm lint 通过。
- pnpm sim 输出分关胜率与回合数，落在目标区间或有明确说明（例如 Boss 偏难的原因）。
- 7 天资源曲线无 NaN/Infinity、无负值、离线封顶生效。
- 近亲对照组非 0（如果仍为 0，说明原因并给出下一步）。

汇报 AGENTS.md §7，额外列出：调参前后对比、仍不达标项及原因、需要 A/C 配合的点。
```

## 4. B —— 客户端（装好 Cocos 后再开）

工作目录：`D:\github-mine\petbattle-client`（分支 `wt/client`）

前提：本机已安装 **Cocos Creator 3.8.8**（`C:\ProgramData\cocos\editors\Creator.8.8\CocosCreator.exe`）。不要用自绘 Canvas 替代（PITFALLS P-006）。

```
你负责 PetBattle 的 B 客户端会话。

工作目录：D:\github-mine\petbattle-client（分支 wt/client，基于 main 的 contract-v1）。
只改：client/**（assets/art、assets/audio 除外；本轮美术暂停）。
不要改：packages/**、server/**、tools/**、根配置、packages/protocol/**、
        docs/PRD.md、docs/TECH_DESIGN.md、docs/CONTRACT.md。

开工前按顺序读：
1. AGENTS.md
2. docs/CONTRACT.md §4（端点/DTO）、§8.2（你的接手点）
3. docs/TECH_DESIGN.md §6（客户端设计）、§5.3（分层）
4. docs/ART_SPEC.md §1（像素基准）、§7（包体）、§8.3（占位图）
5. docs/PITFALLS.md P-005、P-006、P-019~P-021、P-102~P-104、P-109~P-110
6. client/README.md、packages/protocol/src/endpoints.ts

契约已冻结：不要复制 core/protocol 的类型；只 import。
app 层禁止直接调 wx.*，统一走 platform adapter（ESLint 已配置）。

首批任务：
1. 在 client/ 创建 Cocos Creator 3.x 空工程：横屏、设计分辨率 1920×1080、
   虚拟像素基准 640×360；纹理 Point、无 mipmap、无压缩；Boot 空场景并提交。
2. 目录：assets/scripts/{app,platform,services,dev}；Boot → Home → Habitat 三个场景可点。
3. platform adapter：wechat / web / steam 三套接口，wx 只在 platform/ 内出现；
   login、storage、now（仅展示）。
4. mock profile：用 @petbattle/core 的类型构造（初始水龟/雷鱼/草蛙，1 公 1 母成年），
   store 单向数据流；UI 只读 store。
5. ApiClient：基于 protocol 的 ROUTES / ApiContract 发请求；处理 ApiResponse、
   serverTime offset、revision 冲突（409 拉全量）。
6. 同步脚本：构建前把 packages/core、packages/protocol 复制/链接到 client/assets/lib/（单向，P-103），
   验证 Cocos 编译通过；不要反向依赖 Cocos。
7. 用同尺寸占位图（ART_SPEC §8.3）先跑通布局，不等待美术。

专项验收：
- Boot → Home → Habitat 可点；mock profile 可跑，不依赖服务端。
- client/**/scripts/app/ 无直接 wx.*；ESLint 通过。
- 不复制 core/protocol 类型；Cocos 里能编译并导出 WeChat 空包。
- 同一时间只有你一个会话打开 Cocos Creator；构建产物不进 git。

纪律：
- client/ 不进 pnpm workspace；不要改根 lockfile。
- 不并行跑 pnpm install；需要依赖先报告 0 号。
- 每天报告可合并进度，由 0 号合并到 main。
- 汇报按 AGENTS.md §7。
```

---

## 5. 启动检查清单（0 号已代做）

| 项 | 状态 |
|---|---|
| `main` 有 `contract-v1` / `contract-v1.1` tag | ✅ |
| 4 个 worktree 与分支已创建 | ✅（core / server / content / client） |
| 每个 worktree 已 `pnpm install --frozen-lockfile` | ✅（串行安装） |
| 废稿美术已删除 | ✅ |
| `@vitest/coverage-v8`、`pg` 已加入 | ✅ |
| M1 首批 A/C/D 已合并、246 测试全绿 | ✅ |
| A 的 `createPet` 追加任务 | ✅ 已完成并合入（contract-v1.2） |
| B 的 Cocos 编辑器版本 | ✅ Cocos Creator 3.8.8（`C:\ProgramData\cocos\editors\Creator.8.8`） |

每个会话开工先跑：

```bash
git status --porcelain    # 应为空
git log --oneline -1      # 应为 main 上的 contract-v1 之后
pnpm typecheck && pnpm test && pnpm lint && pnpm validate:config
```

---

## 6. A 第二批任务（contract-v1.2，已完成留档）

工作目录：`D:\github-mine\petbattle-core`（分支 `wt/core`）。开工前先 `git merge main`。

```
你继续负责 PetBattle 的 A 核心领域会话，做第二批。

工作目录：D:\github-mine\petbattle-core（分支 wt/core）。
开工前先 git merge main；本批按 contract-v1.2 裁定执行，权威说明见 docs/CONTRACT.md §7.1（D-01~D-07）。

只改：packages/core/src/**（除 config/data/**）、packages/core/test/**、docs/DOMAIN_MODEL.md。
不要改：packages/core/src/config/data/**（D 的）、packages/protocol/**、server/**、client/**、
        根配置、docs/CONTRACT.md、docs/PITFALLS.md。

一、已批准的契约调整（必须落地，不要再提请求）
1. releasePet(profile, petId, now, cfg: ConfigRepo)：cfg 必填；返还按 economy.releaseRefund
   的 base/perLevel/perGeneSumDivisor/rarityBonus 全量计算，不允许再用稀有加成 0 兜底。
2. BreedResult 增加 parentCooldowns: [EpochMs, EpochMs]：普通 cooldownMs；近亲 ×(1+penalty)；
   老年 ×2；两者相乘。服务端直接落库，不再自己推口径。
3. BattleEngine 增加 autoCommand(uid: string): Command：与内置确定性 AI 同一份策略，禁止复制第二套。
4. 新增导出 applyExp(pet: PetInstance, amount: number, cfg: ConfigRepo): PetInstance：
   exp += amount；while (exp >= expToNext(level) && level < 20) { exp -= expToNext(level); level++ }；
   返回新个体。不处理 stageProgress/首通奖励（那属于服务端结算）。
5. HabitatConfig 增加两个可选字段（schema + types）：
   hungerPenaltyWhenNoFoodPerHour?: number；productionStageMul?: { juvenile: number; adult: number; elder: number }。
   - advanceHabitat 食物不足时按前者额外扣 hunger，缺省 0；
   - 产出阶段系数读后者，缺省 0.5 / 1 / 0.8（DOMAIN §6.1）；不要在代码里再写第二套常量。
   - 不修改 config/data/**；D 会补样例值。
6. critDmg × condMul：保留现实现，不改代码；在 docs/DOMAIN_MODEL.md §4 补一句
   “150% 是基础倍率，状态/特质/被动可修正”，并注明这是 v1.2 裁定（D-04）。

二、本批任务（按顺序，每步补测试）
1. createPet：按 DOMAIN §3/§5.1/§8.2 实现。校验 species/element 存在、level 1~20、基因 0~100 取整；
   stage='egg'，stageChangedAt=bornAt=now；fertility.readyAt=now+hatchMs+juvenileMs，
   cooldownUntil=0，penalty 取入参默认 0；condition 全 100；traits/hiddenTraits 去重；
   parents 缺省 [null,null]，ancestors 缺省 []。
   测试：正常建体、未知物种/属性、等级与基因边界、readyAt、蛋阶段。
2. applyExp：公式与 20 级封顶；测试 1→2、一次跨多级、满级溢出、0 经验。
3. D-01~D-03 的签名/返回值调整，更新所有受影响测试；contract.test.ts 里 createPet 的桩用例删除。
   若所有函数都已实现，contract.test.ts 只保留常量断言。
4. D-05/D-06：schema/types + 结算实现；测试“未配置时 = 0 / 0.5,1,0.8”和“配置后生效”。
5. 更新 docs/DOMAIN_MODEL.md：实现说明、critDmg 措辞、D-05/D-06 字段与默认值。
6. 每完成一项跑 pnpm typecheck && pnpm test && pnpm lint；结束跑 pnpm test:coverage，
   packages/core/src 行覆盖率 ≥85%（当前 99.27%，不要明显回退）。
7. 确定性：同 (setup, seed, commands) 事件流逐条一致；签名变化导致快照重建时，必须在报告里单独说明。

三、禁止
- 不改 config/data/**、protocol、server、client、根配置、CONTRACT.md；
- 不新增未批准的公共导出；
- 不自己合并 main、不推送。

四、汇报（AGENTS.md §7），额外回答：
- 是否重建了确定性快照，为什么；
- D 需要补哪些配置字段（名称、建议值、影响）；
- C 接线需要注意的签名变化（releasePet / breed / BattleEngine / applyExp）。

完成后我（0 号）会跑 integration 并合并；D 的批量 sim 和 C 的初始档都在等这一批。
```

## 7. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-10-29 | 初版：A/C/D/B 四份启动提示词；并行数量与前置条件 |
| v1.1 | 2026-10-29 | 首批合并后更新状态；新增 A 的 createPet 追加任务；B 的 Cocos 编辑器仍未安装 |
| v1.2 | 2026-10-29 | §6 替换为 A 第二批任务（createPet + contract-v1.2 的 D-01~D-07） |
| v1.3 | 2026-10-29 | 确认 Cocos Creator 3.8.8 安装路径；B 可开工 |
| v1.4 | 2026-10-29 | A 第二批完成并合入；D/C 解锁；记录 sim 初版结果 |
| v1.5 | 2026-10-29 | §2/§3 替换为 C/D 第二批提示词（初始档+宠物操作 / 分关平衡+新字段） |
