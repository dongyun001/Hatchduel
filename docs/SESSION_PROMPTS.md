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
| A | **第四批已完成并合入**（v1.4） | 下一批：PvE battle session/奖励口径、繁殖 claim、PvP 编排 |
| D | **第三批已完成并合入**（content 0.4.0、双 AI、真实路径） | 下一批：按 P-116/BALANCE 微调；hit 特质如需要加法量级 |
| C | **第三批已完成并合入**（栖息地端点 + 放生闭环） | 下一批：`/breeding/*`（用 startBreeding）、PvE session |
| B | **第二批已完成并合入**（列表/详情/繁殖、真实建体） | 下一批：繁殖接口联调、UI 打磨、Steam/微信适配细节 |
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

工作目录：`D:\github-mine\petbattle-server`（分支 `wt/server`）。**前置已满足：A 第三批已合并到 main `29c258c`**（core 有 `movePetToHabitat`/`feedPet`/`cleanPet`/`playWithPet`/`upgradeHabitat`/`collectHabitat`，protocol 已有 `/habitat/move`）。先 `git merge main` 并确认这些导出存在。

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

A 第三批已提供（HabitatError.name === 'HabitatError'，带 code）：
- pet_not_found → PET_NOT_FOUND(404)
- habitat_not_found / food_not_found → NOT_FOUND(404)
- capacity_full → CAPACITY_FULL(409)
- insufficient_resources → INSUFFICIENT_RESOURCES(409)
- egg_not_allowed / max_level / slot_conflict → VALIDATION_FAILED(400)

注意：`collectHabitat` 只返回 `{ profile, patch }`，`collected` 必须在调用前快照
`habitat.stored`（整数部分）算出来；`feed/clean/play` 当前允许宠物不在栖息地（默认恢复量），
先按现状接，是否限制为“栖息地内互动”等产品确认。`in_defense` 映射已由 A 加在
`server/src/errors.ts`（一行），本批确认保留即可。

专项验收：
- pnpm typecheck && pnpm test && pnpm lint && pnpm validate:config 通过。
- 内存 + Postgres 各跑一次“登录 → 移出 → 放生 → 重启读档”链路。
- 所有写操作带 Idempotency-Key + X-Base-Revision；重复请求返回同一结果。
- 不改 core 规则；缺函数按 CONTRACT §9.3 提请求。

不要做：繁殖、战斗/PvE、PvP 端点（breeding 编排与 battle session 还没定）；
`/battle/pve/start` 等 A 的 buildPveBattleSetup 合并后再接。

汇报 AGENTS.md §7，额外列出：本批用到的 core 函数、剩余端点缺口、Postgres 验证结果。
```

## 3. D —— 内容与数值（第三批：解锁水/土、真实路径、sim AI 口径）

工作目录：`D:\github-mine\petbattle-content`（分支 `wt/content`）。开工前先 `git merge main`（`29c258c`，A 第三批已合并，测试已与生产数据解耦）。

```
你继续负责 PetBattle 的 D 内容与数值会话，做第三批。

工作目录：D:\github-mine\petbattle-content（分支 wt/content）。
开工前先 git merge main（29c258c；core 测试已切到合成配置，A 的 autoCommand 已改留能量策略）。
只改：packages/core/src/config/data/**、packages/sim/**、tools/content/**、docs/BALANCE.md。
不要改：core 其他源码、schema.ts、protocol、server、client、根配置、docs/CONTRACT.md。

先读：
- docs/CONTRACT.md §6、§7.2（D-08~D-15）
- docs/PITFALLS.md P-049（sim 自带 AI 与 core autoCommand 漂移）
- docs/BALANCE.md §2（目标表）、packages/sim/src/{battle,breeding,report}.ts

任务：
1. 解锁水/土系：A 的测试不再锁 normal_strike / stage_1，可调 water_* / earth_* / fish_tide 的 power 与
   stage_1 敌人（允许 2~3 个）；目标仍是 BALANCE §2：
   关1 ≥0.85、关2 0.70、关3 0.55、关4 0.45、关5 0.35~0.60（±0.15），平均 6~18 回合。
   当前 stage_1 平均 3.70 回合偏短，明确处理方式（加敌人/调等级/调基因）并记录理由。
2. habitats.json：hungerPenaltyWhenNoFoodPerHour 改为 1.5；补 careRecoveryPerAction { clean: 20, play: 20 }；
   contentVersion 升 0.4.0。
3. P-049：给 sim 增加 `--ai=core|sim`（core 用 engine.autoCommand 驱动；sim 保留现有 pickCommand），
   或至少让报告明确标注曲线来自哪套策略。两套结果都输出更好。
4. 用“真实玩家路径”复跑：明确重复刷关次数、繁殖次数、等级假设；7 天资源曲线加入喂养/繁殖/升级支出
   （可以按典型路径近似），不要只算被动产出。
5. 繁殖样本加到 5000 次，复核近亲突变率与基因分布；如果给特质加 hit，必须是加法量级 0.02~0.05，
   不能写 1.05 这类乘数（会被 clamp）。
6. 跑 pnpm sim --write 更新 BALANCE；确保 validate:config / typecheck / test / lint 通过。

专项验收：
- 分关胜率、回合数、平局率、大招间隔全部有数据；不达标项写原因与下一步。
- 资源曲线无 NaN/Infinity、无负值、离线封顶生效；至少覆盖“只产出”和“真实路径”两种口径。
- 近亲对照组非 0；5000 次样本的突变率/近亲率有置信区间说明。
- 不新增未定义 JSON 字段；需要新字段按 CONTRACT §9.3 提请求。

汇报 AGENTS.md §7，额外列出：调参前后对比、sim AI 口径、仍不达标项、需要 A/C 配合的点。
```

## 4. B —— 客户端（第二批：详情/图鉴/繁殖 + 真实建体）

工作目录：`D:\github-mine\petbattle-client`（分支 `wt/client`）。开工前先 `git merge main`（`29c258c`，core 已有 `createPet`/`applyExp`/栖息地操作）。

```
你继续负责 PetBattle 的 B 客户端会话，做第二批。

工作目录：D:\github-mine\petbattle-client（分支 wt/client）。
开工前先 git merge main（29c258c）；然后跑 node client/tools/sync-lib.mjs --check，
不一致就运行 node client/tools/sync-lib.mjs 重新生成并提交（不要手改 assets/lib）。
只改：client/**（assets/art、assets/audio 除外，美术暂停）。
不要改：packages/**、server/**、tools/**、根配置、docs/CONTRACT.md。

先读：
- docs/CONTRACT.md §4/§7.2（D-12 栖息地端点、D-10 PvE setup）
- docs/ART_SPEC.md §3/§8.3（列表/详情/繁殖的占位与尺寸）
- packages/core/src/api.ts（createPet/applyExp/deriveStats/checkBreeding/isInbred/技能与配置）
- client/assets/scripts/{app,platform,services,dev}/**

任务：
1. mockProfile 改用 core：用 createPet 建水龟(公)/雷鱼(母)/草蛙，再按
   `now - hatchMs - juvenileMs` + advanceProfile 推到成年；不要字面构造 PetInstance。
2. PetList 场景：列表/筛选、状态图标、图鉴剪影（5×5 组合）、最佳基因；数据只读 store。
3. PetDetail 场景：八项属性（deriveStats）、基因、特质（显性/隐性）、血统、相性/克制、技能列表。
4. Breeding 场景：双亲选择、基因区间预览、近亲警告（checkBreeding/isInbred）、成本；
   提交动作先走 mock，等 C 的 /breeding/* 就绪再切 ApiClient。
5. ApiClient：把 Habitat 的收取/喂食/清理/玩耍/升级/移出接到 ROUTES/ApiContract（保留 mock 开关）；
   验证 409 用 latestProfile 重建、serverTime 偏移。
6. 导航与 store 扩展；占位图同尺寸/pivot；场景优先用编辑器保存，手写场景遵守 P-113。
7. 验收：pnpm lint / typecheck / test（根）通过；node client/tools/sync-lib.mjs --check 通过；
   node client/tools/typecheck.mjs 通过；WeChat 空包可导出。

不要做：服务端业务逻辑、领域公式（deriveStats/checkBreeding 只调用）、复制 core/protocol 类型；
app 层不直接调 wx.*。

汇报 AGENTS.md §7，额外列出：新增场景、mock 动作替换情况、仍缺的接口。
```

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
| A 第三批（v1.3） | ✅ 已完成并合入（342 测试，core 覆盖 98.97%） |
| B 的 Cocos 编辑器版本 | ✅ Cocos Creator 3.8.8（`C:\ProgramData\cocos\editors\Creator.8.8`） |
| B 客户端首批 | ✅ 已合入；`sync-lib --check` 已进 CI |

每个会话开工先跑：

```bash
git status --porcelain    # 应为空
git log --oneline -1      # 应为 main 上的 contract-v1 之后
pnpm typecheck && pnpm test && pnpm lint && pnpm validate:config
```

---

## 6. A 第四批任务（繁殖编排、补丁应用、技能冷却）

工作目录：`D:\github-mine\petbattle-core`（分支 `wt/core`）。开工前先 `git merge main`（`29c258c`）。

```
你继续负责 PetBattle 的 A 核心领域会话，做第四批。

工作目录：D:\github-mine\petbattle-core（分支 wt/core）。开工前先 git merge main（29c258c）。
只改：packages/core/src/**（除 config/data/**）、packages/core/test/**、docs/DOMAIN_MODEL.md。
不要改：config/data/**、protocol、server、client、根配置、docs/CONTRACT.md。

本批解决三件事：服务端组合 patch、繁殖编排、技能冷却。

任务：
1. applyProfilePatch(profile, patch): Profile（新增导出，纯函数）：
   - remove 优先于 upsert（P-047）；同一 id 两边出现时删除生效；
   - currencies 视为绝对值快照直接覆盖（文档写清，不做累加）；
   - codex 只允许 false→true，不因放生回退；lineup/stageProgress/breeding/pvp/settings/stats 整体替换；
   - 不校验 revision（调用方负责）；不修改入参。
   测试：remove+upsert 同 id、currencies 覆盖、codex 不回退、空 patch。
2. startBreeding(profile, parentAId, parentBId, now, cfg, rng): StartBreedingResult（新增导出）：
   - 用 checkBreeding 校验；失败抛 BreedingError（新错误类型，reason 复用 BreedError）；
   - 扣 breeding.cost（金币+食物），不足抛 BreedingError('cost')；
   - 调 breed 生成 child；child 进 profile.pets 与 breeding.eggs；
     父母 cooldownUntil 用 breed 返回的 parentCooldowns；stats.breeds += 1；
   - 不推进时间（服务端先 advanceProfile）；返回 { profile, patch, child, inbred, parentCooldowns }，
     patch 的 revision 保持输入值。
   测试：成功、每种拒绝原因、资源不足、冷却写入、蛋进 breeding.eggs、近亲标记。
3. 技能回合冷却：BattleUnit 增加可选 cooldowns?: Record<Id, number>；
   回合开始递减、cast 后按 SkillConfig.cooldown 设置、availableCommands 过滤冷却中的技能；
   无 cooldown 字段时行为不变。测试：冷却中不可选、到期恢复、确定性不变。
4. 组合写回归（P-047）：advanceProfile 后接 startBreeding/feedPet 的 patch，按 applyProfilePatch 应用，
   验证被删除的宠物不会复活、资源与冷却正确。
5. 文档：DOMAIN §15 补 applyProfilePatch / startBreeding / 冷却规则；标注新增错误类型。
6. 门槛：typecheck/test/lint/validate；test:coverage core ≥85%；确定性双跑一致。

不要做：battle session/奖励、PvP 编排、feed/clean/play 的栖息地限制（产品未定）、改 config/data。
汇报 AGENTS.md §7，额外列出：新增导出、破坏性变化、C/B 接线注意、D 需要重跑的内容。
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
| v1.8 | 2026-10-29 | A 第三批合入；C 第三批补错误映射与 collected 口径；D 下一步更新 |
| v1.9 | 2026-10-29 | 写入 A 第四批、D 第三批、B 第二批提示词；C 第三批前置更新 |
| v1.10 | 2026-10-29 | 四批全部合入：A v1.4、D content 0.4.0、C 栖息地、B 列表/详情/繁殖 |
