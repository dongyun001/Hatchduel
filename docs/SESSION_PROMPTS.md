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
| A | 第二批已完成；**第三批待做**（v1.3：测试解耦 + 栖息地函数 + PvE setup） | 按 §6；解 D/C 阻塞 |
| D | 第二批已完成并合入（分关平衡/近亲修复/栖息地字段） | 等 A 测试解耦后调水/土系；用真实路径复跑 |
| C | 第二批已完成并合入（初始档/宠物操作/编队） | **等 A 第三批**，然后按 §2 接栖息地端点与放生闭环 |
| B | **首批已完成并合入**（Boot/Home/Habitat、平台层、ApiClient） | 下一批 PetList/PetDetail/Breeding；C 接口就绪后接真实数据 |
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

## 2. C —— 服务端（第三批：栖息地操作）

工作目录：`D:\github-mine\petbattle-server`（分支 `wt/server`）。**前置：A 第三批已合并**（core 有 `movePetToHabitat`/`feedPet`/`cleanPet`/`playWithPet`/`upgradeHabitat`/`collectHabitat`，protocol 已有 `/habitat/move`）。先 `git merge main` 并确认这些导出存在；没有就先做不依赖它们的部分并报告。

```
你继续负责 PetBattle 的 C 服务端会话，做第三批：栖息地与放生闭环。

工作目录：D:\github-mine\petbattle-server（分支 wt/server）。
开工前先 git merge main（contract-v1.3；A 第三批应已合入）。先确认 @petbattle/core 导出：
movePetToHabitat / feedPet / cleanPet / playWithPet / upgradeHabitat / collectHabitat，
以及 ROUTES.movePetToHabitat。缺任何一个就先报告，不要自己实现领域规则。
只改：server/**、docs/ONLINE_DESIGN.md。
不要改：packages/**、client/**、tools/**、根配置、docs/CONTRACT.md。

先读：docs/CONTRACT.md §4.3/§7.2（D-12/D-11）、docs/ONLINE_DESIGN.md §5.2、
server/src/domain/{starter-profile,core-adapter,patch}.ts、packages/core/src/api.ts。

任务：
1. POST /habitat/move（新端点）：调用 core movePetToHabitat(profile, petId, habitatId|null, now, cfg)；
   返回 patch；校验容量/归属/非蛋/槽位去重由 core 负责，服务端只做参数与 revision/幂等。
2. POST /habitat/collect：调用 core collectHabitat，把 stored 转入 currencies；返回 collected。
3. POST /habitat/feed、/clean、/play、/upgrade：分别调用对应 core 函数；
   - 食物不足/资源不足映射 INSUFFICIENT_RESOURCES；
   - 容量满映射 CAPACITY_FULL；等级上限映射 VALIDATION_FAILED；
   - 统一走既有写流水线（advanceProfile → 端点改动 → revision CAS → patch）。
4. 放生闭环：初始 3 只在栖息地中；新增 move 后：
   测试“初始档 → move 移出 → release 成功”，并覆盖 release 的 in_habitat / in_lineup /
   in_defense（A 第三批新增）→ PET_IN_USE 映射。
5. Postgres 端到端测试改用真实接口，不再手工改 profiles.data：
   guest 登录 → move 移出 → release → 重启后 GET /profile 少一只、codex owned 不回退。
6. 生产默认 strict 保持；更新 docs/ONLINE_DESIGN.md §16 端点表与流水线说明。

专项验收：
- pnpm typecheck && pnpm test && pnpm lint && pnpm validate:config 通过。
- 内存 + Postgres 各跑一次“登录 → 移出 → 放生 → 重启读档”链路。
- 所有写操作带 Idempotency-Key + X-Base-Revision；重复请求返回同一结果。
- 不改 core 规则；缺函数按 CONTRACT §9.3 提请求。

不要做：繁殖、战斗/PvE、PvP 端点（breeding 编排与 battle session 还没定）；
`/battle/pve/start` 等 A 的 buildPveBattleSetup 合并后再接。

汇报 AGENTS.md §7，额外列出：本批用到的 core 函数、剩余端点缺口、Postgres 验证结果。
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
| B 客户端首批 | ✅ 已合入；`sync-lib --check` 已进 CI |

每个会话开工先跑：

```bash
git status --porcelain    # 应为空
git log --oneline -1      # 应为 main 上的 contract-v1 之后
pnpm typecheck && pnpm test && pnpm lint && pnpm validate:config
```

---

## 6. A 第三批任务（contract-v1.3：解 D/C 阻塞）

工作目录：`D:\github-mine\petbattle-core`（分支 `wt/core`）。开工前先 `git merge main`（contract-v1.3；`/habitat/move` 已在 protocol 中）。

```
你继续负责 PetBattle 的 A 核心领域会话，做第三批：解 D/C 的阻塞，并把测试与生产数据解耦。

工作目录：D:\github-mine\petbattle-core（分支 wt/core）。开工前先 git merge main（contract-v1.3）。
只改：packages/core/src/**（除 config/data/**）、packages/core/test/**、docs/DOMAIN_MODEL.md。
不要改：config/data/**、packages/protocol/**（/habitat/move 已由 0 号加好）、server/**、client/**、
        根配置、docs/CONTRACT.md。

任务按优先级：
1. 测试与生产数据解耦（D-08，先做，解 D 的锁）：
   - advance.test 的 D-05 用例显式 `delete habitat.hungerPenaltyWhenNoFoodPerHour`，不要依赖示例配置缺失；
   - battle.test 不再写死 normal_strike power=1.0 的 360/190/570/475：用 test/factory 构造合成配置
     （固定数值的最小 ConfigRepo），伤害断言基于合成配置；
   - determinism.test 的固定快照改用合成配置，不再锁 stage_1 / water / earth / fish_tide；
   - 删除“stage_1 恰好 2 个敌人”的断言（允许 2~3）。
   验收：D 修改 water/earth/fish_tide 与 stage_1 敌人数量时，core 测试不受影响。
2. autoCommand 留能量（D-09）：energy >= 大招 cost 放大招；energy >= 大招 cost - 20 普攻攒能量；
   否则 energy >= 小技能 cost 放小技能；否则普攻。加回归测试：自动战斗在可放大招后 1 回合内放大招，
   且不会因为放小技能把大招无限推后。
3. 栖息地操作函数（D-12，新增导出，统一返回 { profile, patch }，patch 的 revision 保持输入值）：
   - movePetToHabitat(profile, petId, habitatId | null, now, cfg)
   - feedPet(profile, petId, foodId, now, cfg)
   - cleanPet(profile, petId, now, cfg)
   - playWithPet(profile, petId, now, cfg)
   - upgradeHabitat(profile, habitatId, now, cfg)
   - collectHabitat(profile, habitatId, now, cfg)
   校验：宠物归属/非蛋/容量/槽位去重/成本/等级上限；feed 扣食物并按 FoodConfig 恢复 hunger/mood；
   clean/play 恢复量读 HabitatConfig.careRecoveryPerAction?（新增可选字段，默认 hygiene +20 / mood +20）；
   upgrade 扣 coin/geneDust 并按 levels 扩容量、重算 slots；collect 把 stored 转入 currencies。
   测试：容量满、重复槽位、非本人、蛋、资源不足、升级扩容、collect 后 stored 清零、patch 正确。
4. PvE 单边 setup（D-10）：新增
   buildPveBattleSetup(party: readonly PetInstance[], stage: StageConfig, cfg, seed): BattleSetup，
   team0 = party（uid a*），team1 = buildEnemyTeam（uid b*）；同 seed 确定性。
5. 放生拒绝防守阵容（D-11）：releasePet 检查 profile.pvp.defense，命中抛 ReleaseError('in_defense')；
   同步 ReleaseErrorReason。测试：防守中的宠物被拒绝，移出后可放生。
6. hit 的 statMods 语义（D-13）：hp/atk/def/spd/crit/critDmg/dodge 仍是乘数；hit 改为加法增量；
   deriveStats 与 DOMAIN 文档同步，加测试。
7. inheritance.weight（D-14）：MVP 暂不消费，在 DOMAIN 标注 reserved，不删字段。
8. 门槛：pnpm typecheck && pnpm test && pnpm lint；pnpm test:coverage core 行覆盖率 ≥85%；
   同 (setup, seed, commands) 双跑事件流一致。

不要做：繁殖编排（startBreeding/cost 扣费）、战斗 session 落库、PvP 编排——这些等 D 的数值与 C 的服务端流程稳定后再做；
本次只做上面列出的公共函数，不新增其他导出。

汇报 AGENTS.md §7，额外列出：新增导出清单、D 需要重跑的 sim、C 可接的端点、是否有破坏性变化。
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
| v1.6 | 2026-10-29 | C/D 第二批合并；§2/§6 替换为 C 第三批与 A 第三批提示词（contract-v1.3） |
| v1.7 | 2026-10-29 | B 客户端首批合入；状态表与检查清单更新 |
