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
| A | 第五批已完成并合入（v1.5） | 暂停；M2 契约确定后做 PvP 战斗/AI 公共函数 |
| D | 第四批已完成并合入（content 0.5.0） | 暂停；等 M2 内容/奖励需求 |
| C | 第四批已完成并合入 | 等 M2 契约：PvP 三端点 + 排行榜 |
| B | 第三批已完成并合入 | **第四批待做**：M1 收尾——放生 UI、本地存档、验收（§4） |
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

## 2. C —— 服务端（第四批：PvE 会话与繁殖端点）

工作目录：`D:\github-mine\petbattle-server`（分支 `wt/server`）。**前置：A 第五批已合并**（`runBattle`/`applyPveRewards`/`claimBreeding` 存在）。先 `git merge main` 并确认导出；缺就报告，不要自己实现领域规则。

```
你继续负责 PetBattle 的 C 服务端会话，做第四批：PvE 会话/奖励与繁殖端点。按 order 一次做完。

工作目录：D:\github-mine\petbattle-server（分支 wt/server）。
开工前先 git merge main（contract-v1.5；A 第五批已合入）。确认 @petbattle/core 导出：
runBattle / applyPveRewards / claimBreeding / buildPveBattleSetup / startBreeding /
BattleReplayError / BreedingClaimError，以及 protocol 的 BATTLE_EXPIRED / EGG_NOT_READY / expiresAt。
缺任何一个先报告。
只改：server/**、docs/ONLINE_DESIGN.md。
不要改：packages/**、client/**、tools/**、根配置、docs/CONTRACT.md。

先读：docs/CONTRACT.md §7.4（E-01~E-08）、§4.3；docs/ONLINE_DESIGN.md §5.2/§6；
server/src/{storage,services,routes,domain}/**、server/src/storage/migrations/001_init.sql。

任务：
1. BattleSession 存储（内存 + Postgres 迁移 002）：
   字段 battleId/accountId/stageId/seed/setup/partyPetIds/createdAt/expiresAt/status(started|claimed)；
   TTL 30 分钟；同一账号只保留 1 个未结束会话，start 时使旧会话失效。
2. POST /battle/pve/start：
   - 校验关卡解锁（order=1 或前一关 cleared）→ STAGE_LOCKED；
   - 校验 lineup 1~3 只、非蛋、存在 → INVALID_LINEUP；
   - party = lineup 对应 PetInstance；buildPveBattleSetup(party, stage, cfg, seed)；
     seed 由服务器生成（crypto），不得由客户端指定；
   - 落 session，返回 { battleId, stageId, setup, expiresAt }。
3. POST /battle/pve/claim：
   - 幂等键；session 不存在→BATTLE_NOT_FOUND；过期→BATTLE_EXPIRED；已领取（不同键）→ALREADY_CLAIMED；
   - runBattle(setup, cfg, commands) 重放；invalid_command/not_finished→VALIDATION_FAILED；
   - firstClear = winner===0 && !stageProgress.cleared；
   - applyPveRewards(profile, stage, {firstClear, winner, partyPetIds, turns}, now, cfg)；
   - 会话置 claimed；返回 patch/winner/rewards；重复同键返回同一响应；
   - core 会忽略结束后多余指令，不要当作弊；命令序列必须能重放到 finished。
4. POST /breeding/start：调 startBreeding；BreedingError 映射：
   not_adult/same_pet/same_gender/infertile→VALIDATION_FAILED；cooldown→COOLDOWN_ACTIVE；
   no_capacity→CAPACITY_FULL；cost→INSUFFICIENT_RESOURCES；locked→PET_LOCKED；
   返回 egg/inbred/patch。
5. POST /breeding/claim：调 claimBreeding；not_found→NOT_FOUND；egg_not_ready→EGG_NOT_READY；
   already_claimed→ALREADY_CLAIMED；成功后 stats.hatchlings += 1，返回 pet/patch。
6. 测试：内存 + Postgres 全链路；用可控时钟测过期；同键重放；错误命令拒绝；
   胜利首通/重复、失败无奖励、平局按失败；繁殖 start 各错误 + claim 三态。
7. 更新 docs/ONLINE_DESIGN.md §16 端点表与流程。

专项验收：
- pnpm typecheck && pnpm test && pnpm lint && pnpm validate:config 通过。
- 内存 + Postgres 各跑一次：登录 → start → 本地/脚本生成 commands → claim → 再 claim；
  以及 繁殖 start → 等孵化（推进时间）→ claim。
- 所有写操作 Idempotency-Key + X-Base-Revision；客户端不提交胜负结果。
- 不复制 core 规则；缺函数按 CONTRACT §9.3 提请求。

不要做：PvP 编排、排行榜、好友；这些不在本批。

汇报 AGENTS.md §7，额外列出：会话表结构、错误映射、Postgres 验证、剩余端点缺口。
```

## 3. D —— 内容与数值（第四批：奖励模板与最终平衡）

工作目录：`D:\github-mine\petbattle-content`（分支 `wt/content`）。开工前先 `git merge main`（`contract-v1.5`）。

```
你继续负责 PetBattle 的 D 内容与数值会话，做第四批：奖励模板核对与最终平衡。

工作目录：D:\github-mine\petbattle-content（分支 wt/content）。
开工前先 git merge main（contract-v1.5；PvE 首通宠物按蛋阶段交付）。
只改：packages/core/src/config/data/**、packages/sim/**、tools/content/**、docs/BALANCE.md。
不要改：core 源码、schema、protocol、server、client、根配置、docs/CONTRACT.md。

任务：
1. 核对 stage.rewards：
   - firstClear.pets 是首通蛋模板（species/element 必须存在、只用 MVP 5 物种）；
   - repeat 不发 pets；petExp 满足首通 30+order×10、重复 floor(首通/3)；
   - 首通蛋（stage_2 火猫、stage_4 土蛇）与孵化/幼年节奏（30min/2h）能接上主循环。
2. 双 AI 曲线定口径：明确 BALANCE 以 core AI（自动战斗/PvP 防守）还是 sim AI（人类近似）为主目标；
   stage_4 当前 sim 0.321 / core 0.597 跨度大，决定是否收窄并说明理由。
3. 最终调参（只改数据）：分关胜率、平均回合、平局率、大招间隔、资源曲线仍按 BALANCE §2；
   如需动 stage_1 敌人数量（2~3）或水/土系 power，直接改。
4. contentVersion 升 0.5.0（有数据变更时）；跑 validate:config、typecheck、test、lint、sim --write。
5. 更新 BALANCE：两套 AI 的结论、首通蛋节奏、调参前后对比。

汇报 AGENTS.md §7，额外列出：奖励模板核对结果、AI 口径决定、仍不达标项、需要 A/C 配合的点。
```

## 4. B —— 客户端（第四批：M1 收尾——放生 + 本地存档 + 验收）

工作目录：`D:\github-mine\petbattle-client`（分支 `wt/client`）。开工前先 `git merge main`（`6571236`），再跑 `node client/tools/sync-lib.mjs --check`，不一致就重新生成并提交。

```
你继续负责 PetBattle 的 B 客户端会话，做第四批：M1 收尾。按 order 一次做完。

工作目录：D:\github-mine\petbattle-client（分支 wt/client）。
开工前先 git merge main（6571236）；跑 node client/tools/sync-lib.mjs --check，不一致就重新生成并提交。
只改：client/**（assets/art、assets/audio 除外）。
不要改：packages/**、server/**、tools/**、根配置、docs/CONTRACT.md。

先读：docs/CONTRACT.md §4.3（release / habitat move）、docs/DOMAIN_MODEL.md §8.6（放生规则）、
client/assets/scripts/{app,services,platform,dev}/**、packages/protocol/src/{pets,habitat}.ts。

任务：
1. 放生闭环 UI（服务端已就绪：/habitat/move、/pets/:id/release）：
   - 在 PetDetail（或 Habitat 选中宠物）加“移出栖息地”和“放生”入口；
   - 放生前置：在栖息地中的先调 /habitat/move 移出；蛋 / 锁定 / 上阵 / 防守 / 最后一只成年
     分别显示不可放生原因（服务端错误码 EGG_NOT_RELEASABLE / PET_LOCKED / PET_IN_USE / LAST_ADULT 本地化）；
   - 放生二次确认，展示返还基因尘；成功后用 applyProfilePatch 或刷新 profile；
   - ApiClient 补 releasePet（如未加），复用 Idempotency-Key / X-Base-Revision / 409 重建；
   - 可选：PetDetail 加锁定开关，便于触发 PET_LOCKED；不做也要展示服务端返回的锁定文案。
2. 本地存档（MVP-A 要求“本地存档 + 云存档接口预留”）：
   - 新增 services/localSave.ts：用 platform adapter 的 getStorage/setStorage 持久化
     { profile, revision, savedAt, schemaVersion }，key 形如 petbattle.profile.v1；
   - mock 模式启动优先读本地，没有/版本不匹配/解析失败则回退 createMockProfile 并清理坏档；
   - 每次写操作成功后保存；server 模式登录/同步后以服务器档覆盖本地；409 以服务器为准；
   - 不把 token、密钥写进存档；存档只做缓存，服务器权威。
3. 错误态回归（低成本优先）：
   - 给 ApiClient/服务层加可测的错误映射用例，或 dev 注入开关，覆盖
     BATTLE_EXPIRED / BATTLE_NOT_FOUND / VALIDATION_FAILED 的提示与“重开”路径；
   - 如果 Cocos 依赖让单测成本过高，就在报告里说明，改为手动触发记录，不要硬塞。
4. 验收（必须真跑并记录）：
   - MVP-A 计时：新档 30 分钟内完成 收菜→喂养→繁殖→战斗；含孵化的完整切片 60 分钟内可验证
     （允许时间快进，但记录快进口径）；
   - mock 重启：金币/食物/基因尘、宠物、蛋、关卡 cleared 都保留；
   - server 模式：移出→放生成功并返还；蛋/锁定/最后成年至少各触发一次拒绝提示；
   - 根 pnpm lint / typecheck / test；node client/tools/sync-lib.mjs --check；
     node client/tools/typecheck.mjs；WeChat 空包可导出；Cocos 构建带 startScene=Boot（P-118）。
5. 更新 client/README.md 的本地存档与放生说明；PITFALLS 新坑按模板追加。

不要做：PvP/排行榜/好友 UI、服务端规则、领域公式、复制 core/protocol 类型、直接调 wx.*。

汇报 AGENTS.md §7，额外列出：计时结果、放生/存档验证、错误态覆盖方式、仍未做项。
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

## 6. A 第五批任务（contract-v1.5：PvE 重放/奖励、繁殖领取）

工作目录：`D:\github-mine\petbattle-core`（分支 `wt/core`）。开工前先 `git merge main`（`contract-v1.5`；协议已含 `BATTLE_EXPIRED`/`EGG_NOT_READY`/`expiresAt`/`PveRewards`）。

```
你继续负责 PetBattle 的 A 核心领域会话，做第五批：PvE 重放/奖励与繁殖领取。按 order 一次做完。

工作目录：D:\github-mine\petbattle-core（分支 wt/core）。开工前先 git merge main（contract-v1.5）。
只改：packages/core/src/**（除 config/data/**）、packages/core/test/**、docs/DOMAIN_MODEL.md。
不要改：config/data/**、protocol、server、client、根配置、docs/CONTRACT.md。

先读：docs/CONTRACT.md §7.4（E-01~E-08）、packages/core/src/{api,battle/*,exp,profile-patch}.ts、
docs/DOMAIN_MODEL.md §8/§9。

任务：
1. runBattle(setup: BattleSetup, cfg, commands: readonly Command[]): { winner, turns, events }
   - 用 BattleEngine.create(setup, cfg)，按顺序 submit；
   - 命令非法/不轮流/目标不合法 → BattleReplayError('invalid_command')；
   - commands 用尽仍 phase!=finished → BattleReplayError('not_finished')；
   - finished 后返回 winner/turns/事件序列；不得绕过 30 回合规则。
2. applyPveRewards(profile, stage, ctx: { firstClear; winner; partyPetIds; turns }, now, cfg):
   { profile, patch, rewards: PveRewards }
   - winner===0：发 firstClear/repeat 的资源与 petExp；firstClear 发 stage.rewards.firstClear.pets；
   - winner!==0（含平局）：不发奖励，stats.battlesLost++；
   - 首通宠物用 createPet 以蛋阶段交付：四项基因 50、generation 1、parents null、traits 空，
     性别按发放序号交替（0=male,1=female），加入 profile.pets，不进 breeding.eggs；
   - 对 partyPetIds 中仍存在的宠物 applyExp(petExp)，缺失跳过；
   - stageProgress：胜利时 cleared=true、firstClearAt（首通时写）、bestTurns=min；
   - codex：敌方 species:element seen=true；发放宠物 seen/owned=true、bestGene=50；
   - stats.battlesWon++（胜利）；返回 patch（revision 保持输入值）；不推进时间。
3. claimBreeding(profile, eggId, now, cfg): { profile, patch, pet }
   - 宠物缺失→BreedingClaimError('not_found')；
   - 仍在 breeding.eggs 且 stage==='egg'→'egg_not_ready'；
   - 不在 eggs 但宠物存在→'already_claimed'；
   - 成功从 eggs 移除，返回 pet；不改 stage；不推进时间。
4. 导出：BattleReplayError、PveRewardContext/PveRewardResult、BreedingClaimError、ClaimBreedingResult。
5. 测试：胜负平、首通/重复、经验只给仍存在队员、首通蛋确定性与性别、codex、bestTurns、
   patch 正确；繁殖领取三种错误 + 成功。
6. 门槛：typecheck/test/lint/validate；coverage core ≥85%；确定性双跑一致。
7. DOMAIN §15 补 runBattle/applyPveRewards/claimBreeding 的规则与错误表。

不要做：服务端会话存储、PvP、排行榜、改数据。协议改动已完成，不要再动 protocol。
汇报 AGENTS.md §7，额外列出：新增导出、破坏性变化、C/B 接线注意、D 需要知道的数据口径。
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
| v1.11 | 2026-10-29 | contract-v1.5：写入 A 第五、C 第四、B 第三、D 第四完整批次提示词 |
| v1.12 | 2026-10-29 | A 第五批合入；补充 E-02a/E-06a/E-07a/E-05a 口径；C 提示词补 hatchlings 与多余指令 |
| v1.13 | 2026-10-29 | D 第四批合入（content 0.5.0，core AI 主口径）；C 仍在跑 |
| v1.14 | 2026-10-29 | C 第四批合入；P-050；E-09 createRng 待办；B 第三批可开工 |
| v1.15 | 2026-10-29 | B 第三批合入；MVP-A 主循环验收通过；下一步转 M2 契约 |
| v1.16 | 2026-10-29 | B 第四批：M1 收尾（放生 UI、本地存档、计时验收） |
