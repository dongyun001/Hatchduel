# M3 并行会话启动提示词（MVP-C / 微信首发）

| 项 | 内容 |
|---|---|
| 用途 | 复制代码块给独立会话；每块是一个**完整批次**（改动 + 测试 + 验收） |
| 依据 | `main` 的 `m2` tag、`docs/PRD.md` §13.3/§14/§16、`docs/CONTRACT.md`、`docs/ART_SPEC.md`、`docs/UI_BACKLOG.md` |
| 维护者 | 0 号（Lead） |
| 日期 | 2026-11-05 |
| 范围 | MVP-C：5 物种内容、正式美术/音频、平衡与概率公示、微信登录、包体压缩、微信提审 |

---

## 0. 会话计划（0 号决定）

**开 4 个会话：C 服务端、D 内容、E 美术、B 客户端。** A 核心按需（只有需要改 core 时才开）；QA 由 0 号在合并阶段承担。

| 会话 | worktree | 分支 | 启动时机 | 合并顺序 |
|---|---|---|---|---|
| C 服务端 | `D:\github-mine\petbattle-server` | `m3/c-server` | 立即 | 2 |
| D 内容 | `D:\github-mine\petbattle-content` | `m3/d-content` | 立即 | 1 |
| E 美术 | `D:\github-mine\petbattle-art` | `m3/e-art` | 立即 | 3 |
| B 客户端 | `D:\github-mine\petbattle-client` | `m3/b-client` | 立即（先做登录/包体/UI，等 E 合并后接正式资源） | 4 |
| A 核心 | `D:\github-mine\petbattle-core` | `m3/a-core` | 按需 | 按请求 |

- 合并顺序固定 **D → C → E → B**；B 最后合并，因为它消费 D/E/C 的产物。
- B 可以先用占位图开发，但**合并前**必须完成正式资源接入与真机验收；半成品不得合入 main。
- 不要并行 `pnpm install`；Cocos Creator 只允许 B 开，Aseprite 只允许 E 开。
- 当前基线：`pnpm typecheck / test（539）/ lint / validate:config`、客户端四项检查、微信 release 预览均通过。
- 正式 AppID：`wx2ee0284751e75999`；构建用 `--appid=` 覆盖，模板保持 `touristappid`。
- 微信开发者工具：`E:\微信web开发者工具\cli.bat`；release 包 3.1MB 可预览/上传，debug 包超过 4MB 不能预览（P-127）。

### 0.1 M3 外部前置（0 号/产品负责，不阻塞代码并行）

- 微信小游戏主体、类目、软著、版号/备案、实名与防沉迷：以微信后台最新要求为准；
- 隐私保护指引、用户协议、账号注销/数据导出流程；
- 繁殖概率公示（物种 50/50、属性 50/50 + 1% 突变、特质 3%、性别随机、近亲修正）；
- 正式 HTTPS 域名、ICP 备案、微信 request 合法域名；
- 商店素材、截图、审核说明。

> 这些不是代码会话能单独解决的；C/B 负责实现可代码化的部分（登录、隐私页、注销、概率公示、内容安全），资质与备案由 0 号跟踪。

---

## 1. C —— 服务端与上线（批次 C2）

工作目录：`D:\github-mine\petbattle-server`（分支 `m3/c-server`）

```
你负责 PetBattle 的 C 服务端会话（M3 批次 C2：微信登录与上线）。

工作目录：D:\github-mine\petbattle-server
分支：m3/c-server（基于 main 的 m2 tag）
开工先跑：git status（干净）、git log -1（应看到 m2 之后的提交）、pnpm typecheck。

只改：server/**、docs/ONLINE_DESIGN.md、server/.env.example（如无则新增）。
不要改：packages/**、client/**、根 package.json/pnpm-lock/CI、docs/CONTRACT.md、AGENTS.md、docs/PRD.md。
需要新协议端点/字段时，按 docs/CONTRACT.md §9.3 写变更请求给 0 号；不要私改 protocol。
密钥只放环境变量，不提交 AppSecret。

开工前读：
1. AGENTS.md、docs/CONTRACT.md §4/§7.5/§7.6/§8.3/§9
2. docs/ONLINE_DESIGN.md §2/§3/§4/§11/§16
3. docs/PRD.md §13.3/§16
4. docs/PITFALLS.md P-022/P-029/P-049/P-050/P-105/P-116
5. server/src/{auth,auth-service,routes,storage,config,errors}.ts 现有实现

本批任务（全部完成再交付）：
1. 微信登录
   - 实现 POST /auth/wechat：wx.login 的 code → 微信 code2session（jscode2session）→ openid/unionid；
   - 环境变量：WECHAT_APPID、WECHAT_SECRET（.env.example 只放占位符）；
   - openid 唯一建号；同 openid 重复登录返回同一账号；openid 已绑其他账号时返回明确错误，
     不要静默合并；合并/绑定策略未定就记变更请求；
   - 网络/微信侧错误映射：code 无效、频率限制、服务端错误分别可诊断；
   - 测试用可注入的 HTTP client 模拟 code2session，不依赖真实微信网络。
2. 账号绑定/解绑
   - /account/bind、/account/unbind 按协议 DTO 实现；guest ↔ wechat 的绑定规则先做最小安全版：
     同一账号只能有一个 wechat openid；解绑前必须至少有另一种登录方式；
   - 冲突（openid 已属他人）返回 VALIDATION_FAILED 或 FORBIDDEN，并写审计。
3. 内容安全（审核要求）
   - 玩家昵称、宠物名等 UGC 在写入前调用微信内容安全接口（msgSecCheck）；
   - 无密钥/开发环境可配置为 mock；失败策略默认拒绝并返回 VALIDATION_FAILED；
   - 记录审计，不把用户原文写进日志。
4. 账号注销 / 数据导出（审核可能要求）
   - 先查微信后台当前要求；需要新端点时写变更请求，由 0 号落协议；
   - 注销必须幂等、可审计、级联清理 profile/会话/战报/快照；
   - 不要删除审计日志本身（脱敏保留）。
5. 部署与 HTTPS
   - 提供 Nginx 反代示例：HTTPS、健康检查、gzip JSON、请求体上限、限流；
   - 明确微信 request 合法域名配置步骤；本地 HTTP 只用于开发；
   - 2C2G：Node 堆 1G、PG pool ≤10、swap 2G、日志轮转、备份脚本说明；
   - 如需要 CORS（仅 web 演示），白名单域名 + OPTIONS，不要 `*` 配凭证；微信端不需要 CORS。
6. 测试
   - 微信登录：新用户、老用户、无效 code、微信 5xx、openid 冲突；
   - 绑定/解绑：正常、重复、最后一种登录方式、跨账号冲突；
   - 内容安全：通过/拒绝/接口失败；
   - 注销：幂等、级联、审计；
   - Postgres：迁移、重启、会话失效；
   - 新增测试 ≥25；全仓测试数不得低于 539。

验收：
pnpm typecheck && pnpm test && pnpm lint
PETBATTLE_STORE=memory PORT=3000 pnpm dev + curl 冒烟
PETBATTLE_TEST_DATABASE_URL=postgres://petbattle:petbattle@127.0.0.1:5433/petbattle pnpm test -- server/test/*postgres*
docker compose -f server/docker-compose.yml up --build（本机 3000 空闲）

交付报告按 AGENTS.md §7：完成内容/改动文件/接口变化/测试与验证/未决问题/下一步。
写清哪些是真实微信接口、哪些是 mock；不要声称未验证的审核结果。
不要自行合并到 main；0 号负责合并。
```

---

## 2. D —— 内容与平衡（批次 D5）

工作目录：`D:\github-mine\petbattle-content`（分支 `m3/d-content`）

```
你负责 PetBattle 的 D 内容与数值会话（M3 批次 D5：内容定稿与概率公示）。

工作目录：D:\github-mine\petbattle-content
分支：m3/d-content（基于 main 的 m2 tag）
开工先跑：pnpm validate:config、pnpm sim，确认基线。

只改：packages/core/src/config/data/**、packages/sim/**、tools/content/**、docs/BALANCE.md。
不要改：schema/公式/protocol/server/client/根配置/docs/CONTRACT.md。
需要新字段：写变更请求给 A/0，不要私塞 JSON。

开工前读：
1. AGENTS.md、docs/CONTRACT.md §6/§7.5
2. docs/DOMAIN_MODEL.md 配置与繁殖章节
3. docs/BALANCE.md 全文、docs/PRD.md §5/§7/§11/§13.3/§16
4. docs/PITFALLS.md P-049/P-116

本批任务：
1. 内容定稿审计
   - 5 物种 / 5 属性 / 16 主动 + 5 被动 / 19 特质 / 5 关卡 / 1 栖息地 / 3 食物；
   - 图鉴 5×5 的可获得路径：初始 3 只 + 关卡首通 + 繁殖，确保 MVP 实际可获得 5~10；
   - 检查关卡奖励模板（stage_2 火猫、stage_4 土蛇）与概率/经验配置一致。
2. 经济与平衡
   - 跑 pnpm sim --ai=both，记录五关胜率/回合/平局/大招间隔/资源曲线/繁殖分布；
   - 目标以 docs/BALANCE.md §2 为准；不达标就调 JSON，不写死代码；
   - 重点复核：第 1 关教学节奏、第 4/5 关难度、离线产出与消耗出口、近亲惩罚幅度。
3. 概率公示数据
   - 整理一份机器可读的繁殖概率说明（物种 50/50、属性 50/50、突变 1%、特质 3%、性别随机、近亲 -5/+2%/+20%），
     给 B 做 UI 公示；如果放 JSON，必须 validate:config 通过。
4. contentVersion 与报告
   - 每次配置变更递增 contentVersion；
   - 更新 docs/BALANCE.md 的自动段落与结论；
   - 在报告里给出“本次改了什么、为什么、sim 前后对比”。

验收：
pnpm validate:config
pnpm test
pnpm sim --ai=both
pnpm sim --write（如适用）

交付报告按 AGENTS.md §7；不要自行合并到 main。
```

---

## 3. E —— 美术与音频（批次 E1）

工作目录：`D:\github-mine\petbattle-art`（分支 `m3/e-art`）

```
你负责 PetBattle 的 E 美术/音频会话（M3 批次 E1：正式资源替换占位）。

工作目录：D:\github-mine\petbattle-art
分支：m3/e-art（基于 main 的 m2 tag）
开工先读：docs/ART_SPEC.md 全文、docs/PITFALLS.md 像素/资源相关条目、client/assets/art 现有占位。

只改：client/assets/art/**、client/assets/audio/**、docs/ART_SPEC.md。
不要改代码/场景/根配置/protocol/server；不改 B 的 scripts。
交付 .aseprite 源文件 + PNG 精灵表 + JSON + 调色板 + 清单。

本批任务（按 ART_SPEC §3/§9 的 M3 顺序）：
1. 宠物资源（MVP 实际可获得 5~10 个组合）
   - 战斗精灵：96×96（大号 128、小号 64），idle/attack/hit/faint/sleep/happy；
   - 立绘 256×256、头像 32/48、蛋按物种；
   - 单只全套 ≤60KB（PNG-8），立绘 ≤100KB，头像 ≤5KB；
   - 调色板 32~48 色、1px 深色描边、光源左上；Aseprite 序列帧，不用 Spine。
2. UI kit
   - 面板/按钮/条/图标/框架/控件/装饰；9-slice 拉伸不变形；
   - 通用 UI 图集 ≤500KB；元素色 + 图标双重编码。
3. 场景与特效
   - 栖息地背景 640×360、主界面背景、战斗背景 1~2；
   - 受击/暴击/治疗/护盾/增益/减益/升级/孵化/领取/元素技能色变体；
   - 背景 ≤100KB/张。
4. 音频
   - BGM 1~2 首（≤1MB/首）、SFX 20~30（≤30KB/个）、UI 音效 5~8；
   - 循环点、命名、音量归一；不要版权不明素材。
5. 交付
   - 命名符合 ART_SPEC §6；图集 2px padding；pivot/baseline 说明；
   - 提供资源清单（文件名/尺寸/帧数/体积/用途）和包体统计；
   - 主包相关资源与分包资源分开标注，配合 B 做 ≤2MB 主包。

验收：
- ART_SPEC §8.2 清单逐项通过；
- 2×/3× 整数缩放清晰，无模糊/拉伸/串色；
- 所有占位替换后同尺寸/pivot；
- 包体在预算内（主包 ≤2MB、总资源 ≤15MB 的目标由 B 最终验证）。

交付报告按 AGENTS.md §7；不要自行合并到 main；不要打开 Cocos Creator。
```

---

## 4. B —— 客户端与提审（批次 B2）

工作目录：`D:\github-mine\petbattle-client`（分支 `m3/b-client`）

```
你负责 PetBattle 的 B 客户端会话（M3 批次 B2：微信登录、M3 UI、包体、提审）。

工作目录：D:\github-mine\petbattle-client
分支：m3/b-client（基于 main 的 m2 tag）
开工先跑：git status（干净）、node client/tools/sync-lib.mjs --check、node client/tools/typecheck.mjs。

只改：client/**（除 client/assets/art/**、client/assets/audio/**）。
不要改：packages/**、server/**、根配置/CI、docs/CONTRACT.md、AGENTS.md、docs/PRD.md。
需要新协议字段/端点时写变更请求给 0 号；不要私改 protocol。

开工前读：
1. docs/PRD.md §13.3/§16、docs/CONTRACT.md §4/§7.5/§7.6/§8.2
2. docs/UI_BACKLOG.md（M3-01~M3-08）
3. docs/ART_SPEC.md §7（包体预算）、docs/PITFALLS.md P-103/P-116~P-127
4. 现有 client 结构、platform adapter、ApiClient、devConfig

本批任务（全部完成再交付）：
1. 微信登录
   - Boot 调 platform.wechat 的 wx.login → POST /auth/wechat；token 持久化、刷新、失效重登；
   - 未登录/登录失败/网络失败三态；guest 降级策略按产品决定，不要静默换号；
   - 账号绑定/解绑 UI（若 C 已实现）；隐私协议/用户协议入口。
2. M3 UI
   - 图鉴 5×5：seen 剪影、owned 彩色、bestGene；与排行榜 codex 口径一致；
   - 设置：BGM/SFX、账号、隐私/协议、注销入口（若 C 已实现）；
   - 战斗表现：命中/暴击/克制/状态图标、回合节奏、跳过/自动；不改变结算；
   - 繁殖概率公示页：直接读 D 的概率数据，不写死第二套；
   - 多语言键名预留（先简中）；安全区/可读性/点击热区 ≥44pt。
3. 正式资源接入
   - 等 E 合并后替换占位图/音频；保持尺寸/pivot；Point/无 mipmap/无压缩；
   - 资源分包：主包 ≤2MB，立绘/音频/宠物分包按需加载；首屏 ≤3s。
4. 包体与构建
   - 只用 node client/tools/build.mjs；微信 release + `--appid=wx2ee0284751e75999`；
   - 主包 ≤2MB、总资源 ≤15MB；记录 debug/release 包体；
   - 不要手写 startScene=db://...（P-125）；不要提交 build 产物。
5. 提审准备
   - 微信开发者工具上传新版本（版本号/描述规范）；体验版真机走通登录→主循环→PvP→排行；
   - 隐私保护指引、用户协议、概率公示、内容安全文案；
   - 截图/审核说明清单；修复审核反馈（由 0 号转达）。
6. 验收
   - node client/tools/sync-lib.mjs --check
   - node client/tools/typecheck.mjs
   - pnpm exec tsx client/tools/verify-errors.ts
   - pnpm exec tsx client/tools/verify-api-client.ts
   - pnpm exec tsx client/tools/verify-pvp.ts
   - node client/tools/build.mjs --platform=wechatgame --release --appid=wx2ee0284751e75999
   - 微信开发者工具预览/上传；真机至少 iOS/Android 各一台。

交付报告按 AGENTS.md §7：完成内容/改动文件/接口变化/测试与验证/未决问题/下一步。
必须写清：包体数字、真机型号、审核未闭合项；不要声称审核已通过。
不要自行合并到 main；0 号负责合并。
```

---

## 5. A —— 核心（按需，批次 A2）

只有 D/B/C 确实需要 core 新函数或修 bug 时才启动；否则不要开。

```
你负责 PetBattle 的 A 核心会话（M3 按需批次 A2）。

工作目录：D:\github-mine\petbattle-core
分支：m3/a-core（基于 main 的 m2 tag）
只改：packages/core/**（除 config/data）、packages/core/test/**、docs/DOMAIN_MODEL.md。
不要改 protocol/server/client/根配置/共享文档。

任务以 0 号转交的具体缺口为准（例如：概率公示需要的只读查询、审核需要的统计口径）。
要求：
- 不改变已有签名/常量/schema 语义；需要破坏性变更先提契约变更；
- 新增函数必须有单测、确定性回归、覆盖率不低于现有；
- 纯 TS：无 Math.random/Date.now/cc/wx/DOM/网络/fs。

验收：pnpm typecheck && pnpm test && pnpm lint && pnpm test:coverage。
报告按 AGENTS.md §7；不要自行合并。
```

---

## 6. 0 号合并与 M3 验收清单

### 6.1 合并顺序

1. **D**：配置/平衡先合，B/E 用最终数值验收。
2. **C**：微信登录/绑定/内容安全/部署合入；0 号跑 Postgres 与 HTTPS 冒烟。
3. **E**：正式美术/音频合入；检查包体与 ART_SPEC 清单。
4. **B**：最后合入客户端；跑全量基线、构建、真机、上传体验版。

每次合并前要求会话基于最新 main rebase/merge；冲突由文件所有者解决，0 号合并。

### 6.2 每批必跑

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm validate:config
node client/tools/sync-lib.mjs --check
node client/tools/typecheck.mjs
pnpm exec tsx client/tools/verify-errors.ts
pnpm exec tsx client/tools/verify-api-client.ts
pnpm exec tsx client/tools/verify-pvp.ts
```

服务端额外：

```bash
PETBATTLE_STORE=memory PORT=3000 pnpm dev
curl -s http://127.0.0.1:3000/health
PETBATTLE_TEST_DATABASE_URL=postgres://petbattle:petbattle@127.0.0.1:5433/petbattle pnpm test -- server/test/*postgres*
```

客户端额外：

```bash
node client/tools/build.mjs --platform=wechatgame --release --appid=wx2ee0284751e75999
cmd /c "E:\微信web开发者工具\cli.bat" upload --project "D:\github-mine\petbattle\client\build\wechatgame" -v "0.3.0" -d "M3 提审"
```

### 6.3 M3 退出条件（PRD §13.3）

- 5 物种 / 5 属性 / 16 主动 + 5 被动 / 19 特质 / 5 关卡 / 图鉴 5×5 可玩；
- 繁殖完整（突变/近亲/代数）、概率公示可见；
- 基础 UI、BGM 1 首、关键音效；正式美术替换占位；
- 云存档、异步 PvP、排行榜在真机可用；
- 微信登录/绑定/注销/隐私协议/内容安全闭合；
- 微信主包 ≤2MB、总资源 ≤15MB、首屏 ≤3s；
- 微信审核通过（外部依赖：主体/类目/软著/版号/备案/实名防沉迷）；
- 全量测试 ≥539、客户端四项检查、构建/上传/体验版真机全部通过。

> 审核通过与版号/备案是外部流程，代码会话只负责把可代码化的部分做完并留证据；0 号负责跟踪资质与提审。
