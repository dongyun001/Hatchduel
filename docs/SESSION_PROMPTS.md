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
| A | 首批已完成；**第二批待做**（createPet + contract-v1.2 调整） | 按 §6 执行；它阻塞 D 的批量模拟和 C 的初始 3 只宠物 |
| D | 已完成首批 | 等 `createPet` 后跑真实批量模拟，产出 BALANCE 报告 |
| C | 已完成首批 | 等 `createPet` 后接初始存档；继续栖息地/宠物端点 |
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

## 2. C —— 服务端

工作目录：`D:\github-mine\petbattle-server`（分支 `wt/server`）

```
你负责 PetBattle 的 C 服务端会话。

工作目录：D:\github-mine\petbattle-server（分支 wt/server，基于 main 的 contract-v1）。
只改：server/**。
不要改：packages/**、client/**、tools/**、根配置、packages/protocol/**、
        docs/PRD.md、docs/TECH_DESIGN.md、docs/CONTRACT.md。
你可以改：docs/ONLINE_DESIGN.md（实现细节）。

开工前按顺序读：
1. AGENTS.md
2. docs/CONTRACT.md §4（协议清单）、§7、§8.3（你的接手点）、§9（变更流程）、§10 未决项 2/6
3. docs/ONLINE_DESIGN.md §3/§4/§5/§11/§12
4. docs/TECH_DESIGN.md §3/§10/§11/§14/§16.1
5. docs/PITFALLS.md P-011、P-022、P-027~P-029、P-105、P-107
6. packages/protocol/src/**（ROUTES / ApiContract / ApiResponse / 错误码）、server/src/server.ts

契约已冻结：端点和响应包不能改；错误码只增不改；所有写操作必须校验 Idempotency-Key + baseRevision。
需要新端点/改响应时，按 docs/CONTRACT.md §9.3 提变更请求，不要私改 protocol。

首批任务：
1. 框架选型（node:http 加轻量路由，或 Fastify；选一个说明理由），保留 GET /health。
2. 统一响应与错误映射：ApiResponse<T>；CoreNotImplementedError → NOT_IMPLEMENTED，
   TimeError → TIME_BACKWARDS，ReleaseError.reason → PET_*/LAST_ADULT 等；未知 → INTERNAL。
3. 存储层：定义 ProfileStore 接口；先做内存实现跑测试，再做 Postgres 适配 + 迁移脚本 + docker-compose。
   遵守 2C2G：连接池 ≤20、Node 堆 ≤1G、异步 PvP 限并发（先留接口）。
4. 端点（首批）：POST /auth/guest（deviceId → account + token）、GET /profile、
   POST /profile/rename；Idempotency-Key 中间件（按 accountId+key 去重，重复请求返回同一结果）；
   baseRevision 不匹配返回 409 + RevisionConflictDetails{latestProfile, latestRevision}。
5. 写操作的领域计算等 A 的 core 实现：先把 “加载 profile → advanceProfile → 校验 → 落库 → 返回 patch+revision”
   的流水线搭好，core 还是 stub 时用假数据跑通契约；A 交付后直接接线，不要自己实现战斗/繁殖/时间规则。
6. 集成测试：/health、游客登录两次同 key、profile 读写、revision 冲突、401、幂等重放。

专项验收：
- pnpm typecheck && pnpm test && pnpm lint 通过；server 测试覆盖上述用例。
- docker compose up 能起 Postgres 和 server，curl /health 200（CI 不加 docker，先本地验证）。
- 客户端只交动作：不接受客户端提交“我赢了/我获得资源”；奖励由服务器调用 core 计算。
- 不 import client，不复制 protocol/core 类型。

纪律：
- 不并行跑 pnpm install；需要依赖先报告 0 号（锁文件只有 0 号改）。
- 不要把领域规则写进 server（P-030 同类问题）。
- 每天报告可合并进度，由 0 号合并到 main。
- 汇报按 AGENTS.md §7。
```

---

## 3. D —— 内容与数值

工作目录：`D:\github-mine\petbattle-content`（分支 `wt/content`）

```
你负责 PetBattle 的 D 内容与数值会话。

工作目录：D:\github-mine\petbattle-content（分支 wt/content，基于 main 的 contract-v1）。
只改：packages/core/src/config/data/**、packages/sim/**、tools/content/**。
不要改：packages/core/src/config/schema.ts、packages/core/src/{api,constants,types}/**、
        packages/protocol/**、client/**、server/**、根配置、docs/PRD.md、docs/CONTRACT.md。
你可以改：docs/BALANCE.md（若创建）、docs/DOMAIN_MODEL.md 中数值说明（先与 A 打招呼）。

开工前按顺序读：
1. AGENTS.md
2. docs/CONTRACT.md §6（配置契约）、§7（C-01/C-02/C-03/C-05/C-09）、§8.4（你的接手点）
3. docs/DOMAIN_MODEL.md §2/§8/§10
4. docs/PRD.md §5/§11/§13.3
5. packages/core/src/config/types.ts 与 data/*.json
6. docs/PITFALLS.md P-002、P-017、P-024、P-033、P-036、P-106、P-108

契约已冻结：schema 与校验规则的语义不能改；JSON 里不能塞未定义字段。
需要新字段时，按 docs/CONTRACT.md §9.3 写给 A/0 号，不要私加。

首批任务：
1. 特质扩到 15~20 条，覆盖 common/rare/epic，继承权重与稀有度匹配；不引入未定义字段。
2. 5 关数值校准：敌方等级/基因质量、首通与重复奖励；petExp 必须满足首通 30+order×10、重复 floor(首通/3)。
3. 经济参数：初始资源、放生返还、资源上限；检查没有负收益或死循环。
4. 每次改 JSON 后跑 pnpm validate:config；contentVersion 递增。
5. packages/sim：写批量模拟 CLI（先搭框架，A 的 core 实现后即可跑）：
   - 1000+ 场对局：胜率、平均回合数、平局率、技能释放间隔（验证小技能不是每回合可放、大招约 3 回合一次）；
   - 7 天资源曲线（在线/离线 8h 封顶）；1000 次繁殖的基因分布与近亲影响；
   - 输出 docs/BALANCE.md（D 拥有），标注“初版，待 sim”。
6. 保持“配置只改数据、不改公式”：发现公式问题报告 A，不要改 core。

专项验收：
- pnpm validate:config 通过；pnpm typecheck && pnpm test && pnpm lint 通过。
- 模拟报告有结论：胜率区间、平均回合数、资源曲线、繁殖分布；无 NaN/Infinity。
- 关卡只使用龟/鱼/青蛙/猫/蛇；图鉴组合 25 个概念不变。

纪律：
- 不并行跑 pnpm install；不新增依赖，需要时报告 0 号。
- 每天报告可合并进度，由 0 号合并到 main。
- 汇报按 AGENTS.md §7。
```

---

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
| A 的 `createPet` 追加任务 | ❌ 待做（见 §6） |
| B 的 Cocos 编辑器版本 | ✅ Cocos Creator 3.8.8（`C:\ProgramData\cocos\editors\Creator.8.8`） |

每个会话开工先跑：

```bash
git status --porcelain    # 应为空
git log --oneline -1      # 应为 main 上的 contract-v1 之后
pnpm typecheck && pnpm test && pnpm lint && pnpm validate:config
```

---

## 6. A 第二批任务（contract-v1.2）

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
