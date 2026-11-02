# 《宠物对决》踩坑记录（PITFALLS）

| 项 | 内容 |
|---|---|
| 项目代号 | PetBattle |
| 文档版本 | v1.1 |
| 日期 | 2026-10-28 |
| 读者 | 所有人（尤其 AI 会话） |
| 关联 | `AGENTS.md`、`docs/COLLABORATION.md`、各专题文档 |

> **用法**：开工前读你负责领域的条目；发现新坑追加到文末，写清“现象 / 原因 / 规避 / 验证 / 关联”。**只追加，不删除或改写别人的条目**；合并冲突时保留双方。

---

## 0. 快速红线（开工前 30 秒）

- core 里不能有 `Math.random`、`Date.now`、`cc`、`wx`、DOM、网络。
- 精力：+20/回合、+10/普攻命中；小技能 40~50；大招 70~80。
- `hit` 只表示命中率修正；MVP 不做“效果命中”。
- 同速排序必须中立，禁止固定 0 队先手。
- 构建目标 ES2020，不是 ES5。
- 配置数据与 schema 分家：A 改 schema，D 改 JSON。
- 一个目录一个会话；Cocos 同时只开一个编辑器。
- 像素：Point 过滤、整数缩放、Aseprite 序列帧、不用 Spine。
- 中文正文用系统字体，不做低分辨率中文像素字。
- 服务器权威：客户端只交动作，不交结果；写操作幂等。
- 离线产出上限 8 小时；状态衰减上限 24 小时；健康地板 1。
- 宠物不死亡、可放生；不做转生/威望；交易后做。
- **MVP 物种 5 种**：龟、鱼、青蛙、猫、蛇；恐龙、鼠、象、河马、鸟 后续。

---

## 1. 已修正的设计坑

这些是在文档重构阶段发现并已经改掉的，不要再改回去。

### P-001 产品定位漂移：战斗中心 vs 养成/繁殖/联机/Steam

- **现象**：旧 PRD 以战斗为中心，MVP 是 10 关 PVE + 图鉴 + 编队；繁殖、圈养、离线、联机都不在范围。
- **原因**：需求从“战斗游戏”变成“养成/繁殖为核心，战斗是玩法之一，联机是核心卖点，后续 Steam”。
- **规避**：以 `PRD.md` §17 决策记录为准；新系统必须先能放进核心循环（圈养→繁殖→战斗→资源），放不进就开决策。
- **验证**：新需求能否回答“它服务哪个循环、MVP 做多深、后续怎么扩”。
- **关联**：`PRD.md` §3、§4、§17。

### P-002 精力数值导致小技能每回合可放

- **现象**：旧版小技能 30~40，回合开始 +20、普攻命中 +10，实际每回合都能放；旧文“每 2 回合攒 40”也算错。
- **原因**：只算了回合恢复，漏了普攻回能；成本下限太低。
- **规避**：小技能 40~50、大招 70~80；所有文档统一；用 `sim` 看释放间隔。
- **验证**：模拟输出中，小技能不应每回合可放；大招约 3 回合一次。
- **关联**：`PRD.md` §8.2、`DOMAIN_MODEL.md` §2.5/§8。

### P-003 HIT 语义混用：效果命中 vs 命中率

- **现象**：旧 PRD 把 HIT 定义成“效果命中”，伤害公式却把它当命中率修正。
- **原因**：一个字段承担了两个概念。
- **规避**：`hit` 只做命中率修正；MVP 不做效果命中，控制概率由技能 `chance` 决定；以后需要再加 `effectHit`。
- **验证**：`StatBlock` 没有 `effectHit`；命中公式只用 `hit`/`dodge`；控制概率只读技能。
- **关联**：`DOMAIN_MODEL.md` §2.1、§4.3。

### P-004 同速排序偏向 0 队

- **现象**：PRD 说“同速按站位顺序”，TDD 说“按 uid 字典序”；两种都会让 0 队稳定先手。
- **原因**：不同文档各写一套 tiebreaker。
- **规避**：中立 tiebreaker（种子随机序或队伍交替），禁止固定 0 队。
- **验证**：同速对局交换队伍顺序，先手分布接近 50/50。
- **关联**：`PRD.md` §8.1、`DOMAIN_MODEL.md` §9.2。

### P-005 esbuild 目标设成 ES5

- **现象**：旧 TDD 写“ES5 目标”。
- **原因**：esbuild 对 ES5 降级不完整（async/generator 等会报错）；微信小游戏运行时本来就支持 ES2015+。
- **规避**：target `es2020`。
- **验证**：构建不出现 lowering 错误；真机启动正常。
- **关联**：`TECH_DESIGN.md` §16。

### P-006 零依赖自绘 Canvas UI

- **现象**：旧方案为了“包体小、可控”选择自绘 UI，理由是“回合制 UI 简单”。
- **原因**：加上圈养/繁殖/图鉴/背包/联机/Steam 后，UI 变成密集型；自绘成本高，且无法复用到 Steam。
- **规避**：客户端用 Cocos Creator 3.x；纯 TS 领域核心保留。
- **验证**：M0 用 Cocos 跑通 Boot/Home；不再引入自绘 UI 框架。
- **关联**：`TECH_DESIGN.md` ADR-001。

### P-007 孵化 30 分钟 vs 30 分钟验收

- **现象**：孵化要 30 分钟，验收却要求 30 分钟内完成含孵化闭环。
- **原因**：把“主循环”和“完整切片”混成一个时间指标。
- **规避**：主循环 30 分钟；含孵化 60 分钟可验证；孵化可离线等待。
- **验证**：新手流程计时；孵化不阻塞主循环。
- **关联**：`PRD.md` §13.1、`DOMAIN_MODEL.md` §2.7。

### P-008 初始宠物可能同性别/未成年，第一次繁殖做不了

- **现象**：只写了“初始 3 只”，没保证性别和阶段。
- **规避**：初始保证至少 1 公 1 母，且直接成年；后续获得的按正常阶段走。
- **验证**：新档开局可直接完成第一次繁殖。
- **关联**：`PRD.md` §5.5。

### P-009 决策只留在聊天里，文档和实现漂移

- **现象**：口头决定的商业模式、美术风格、联机形态，没有落到文档。
- **规避**：所有跨会话决策写进 `PRD.md` §17；AI 会话开工先读 `AGENTS.md`；文档冲突以 PRD 为准。
- **验证**：新会话只读文档能复现决策，不需要翻聊天记录。
- **关联**：`PRD.md` §17、`AGENTS.md` §0。

### P-010 包体预算口径不一致

- **现象**：一处写总资源 20MB，一处写 15MB；像素资源单预算缺失。
- **规避**：主包 ≤2MB（内部，官方 4MB）；总资源 ≤15MB（内部）；单资源预算见 ART。
- **验证**：构建产物统计与预算表对照。
- **关联**：`PRD.md` §15、`TECH_DESIGN.md` §17、`ART_SPEC.md` §7。

### P-011 云存档后置，但联机是核心卖点

- **现象**：旧文档本地存档为主、联机阶段再加云存档。
- **风险**：跨微信/Steam 存档、反作弊、断线重连全部返工。
- **规避**：MVP-B 就做账号 + 云存档；服务器权威；客户端只缓存。
- **验证**：两设备/两平台登录同一账号看到同一进度。
- **关联**：`PRD.md` §9/§13.2、`ONLINE_DESIGN.md` §4。

### P-012 把实时 PvP 当第一联机形态

- **现象**：实时房间听起来是核心，但冷启动、匹配、运维、作弊都难。
- **规避**：异步 PvP 优先；实时房间 Phase 3。
- **验证**：异步 PvP 两账号跑通、战报可回放后，再排实时。
- **关联**：`PRD.md` §9.3、`ONLINE_DESIGN.md` §6/§10。

### P-013 “同屏实时对战”歧义

- **现象**：一句话可以理解成本地同屏、双方在线回合制、即时动作三种，文档无法落。
- **规避**：已定不做同屏；只做在线异步 PvP + 后续实时房间。
- **验证**：文档中不再出现“同屏”需求。
- **关联**：`PRD.md` §17。

### P-014 宠物死亡 vs 放生

- **现象**：早期讨论寿命/死亡，后来确定“不死亡但可放生”。
- **规避**：不实现死亡；放生规则：蛋/锁定/上阵/栖息地中/最后成年不可放生；图鉴 `owned` 不回退。
- **验证**：四类不可放生用例；放生后无悬空引用、不会软锁。
- **关联**：`PRD.md` §7.5/§7.6、`DOMAIN_MODEL.md` §8.6。

### P-015 把世代做成转生/威望

- **现象**：早期把世代当作长期威望维度。
- **规避**：不做转生/威望重置；世代只做血统与收集维度，不重置进度。
- **验证**：存档/代码中没有 prestige/reset 字段；升级不重置。
- **关联**：`PRD.md` §10/§17。

### P-016 有宠物清单，没有获取途径

- **现象**：列了 10 只 MVP 宠物，但没写怎么获得；没有抽卡，也没有掉落。
- **规避**：初始 3 只、关卡首通给 2 只、繁殖/活动补全；不做抽卡。
- **验证**：新玩家能在正常流程内获得至少 5 只、能繁殖、能组 3 人队。
- **关联**：`PRD.md` §5.5/§13。

### P-017 “繁殖力 -20%”没有定义

- **现象**：近亲惩罚写“繁殖力 -20%”，但没说是失败率还是冷却。
- **规避**：体现为繁殖冷却 ×(1+penalty)；MVP 不做受孕失败，避免反复失败。
- **验证**：近亲子代繁殖冷却更长；UI 有警告。
- **关联**：`DOMAIN_MODEL.md` §8.3。

### P-018 3v3 的 PvP 输入模型缺失

- **现象**：`Command` 是单条行动，但一轮最多 6 次行动；没定义两人怎么提交。
- **规避**：Phase 1 异步；Phase 3 同时盲选 + 30 秒超时补普攻；服务器收齐后按速度结算。
- **验证**：同时提交、超时、断线重连、先手信息不对称测试。
- **关联**：`ONLINE_DESIGN.md` §10、`TECH_DESIGN.md` §13。

### P-019 美术规格缺失，量产后才发现对不上

- **现象**：只有“风格待定”，没有尺寸/帧数/图集/预算；M3 才接美术。
- **规避**：`ART_SPEC.md` v1.1 像素风；M0 先出样张、调色板、UI kit、占位图。
- **验证**：样张按 2×/3× 验收；占位图与最终资源同尺寸/pivot。
- **关联**：`ART_SPEC.md`。

### P-020 以为 Cocos 原生识别 Aseprite JSON

- **现象**：像素动画计划用 Aseprite 导出 JSON，但 Cocos 没有原生导入。
- **规避**：M0 验证导入链路：自写转换脚本生成 SpriteFrame/AnimationClip，或导出 PNG 序列帧；备选 TexturePacker。
- **验证**：一张 6 帧精灵在 Cocos 里能播。
- **关联**：`ART_SPEC.md` §5、`TECH_DESIGN.md` §20。

### P-021 中文像素字体不可读/字库过大

- **现象**：640×360 虚拟分辨率下，中文像素字容易糊；完整中文字库也大。
- **规避**：正文用系统字体在原生分辨率渲染；数字/英文标题可用像素字体；文案外置。
- **验证**：2×/3× 下正文可读；不把文字烘焙进图片。
- **关联**：`ART_SPEC.md` §1/§10、`PRD.md` §15。

### P-022 2C2G 塞 Node+Postgres+Redis+模拟

- **现象**：全塞一台 2G 内存机器会 OOM/CPU 打满。
- **规避**：Redis 后置；Postgres 连接池 ≤20；Node 堆 ≤1G；2G swap；异步 PvP 限并发；先升配再拆服务。
- **验证**：压测 CPU/内存/p95；模拟排队时长。
- **关联**：`TECH_DESIGN.md` §16.1、`ONLINE_DESIGN.md` §12。

### P-023 交易与 RMT 未定义

- **现象**：想做交易，但没定义绑定/限额/税/审计，容易踩合规和经济坑。
- **规避**：MVP 不做；Phase 2 再评估；反 RMT = 绑定、每日限额、交易税、日志、异常检测、封禁。
- **验证**：交易开关默认关闭；审计日志可追溯。
- **关联**：`ONLINE_DESIGN.md` §9。

### P-024 正态分布引入超越函数

- **现象**：Box–Muller 需要 `log/cos/sqrt`，与“core 禁止超越函数”冲突。
- **规避**：Irwin–Hall 近似：`Σ(12 次 rng()) − 6`。
- **验证**：core 中无 `sin/cos/exp/log/sqrt`；同种子结果一致。
- **关联**：`DOMAIN_MODEL.md` §1、§8.2.1。

### P-025 时间上限一刀切

- **现象**：产出和状态衰减共用一个 8 小时上限，长期不上线宠物状态处理不清。
- **规避**：产出 8 小时、衰减 24 小时、健康地板 1；两者分开配置。
- **验证**：离线 1 天/7 天回归；不会全死、不会无限产出。
- **关联**：`DOMAIN_MODEL.md` §6/§7、`TECH_DESIGN.md` §9。

### P-026 放生规则不完整

- **现象**：只写“可放生”，没写蛋/锁定/上阵/最后成年。
- **规避**：规则化；返还基因尘；图鉴 `owned` 不回退；服务器审计。
- **验证**：四类不可放生用例；放生后无悬空引用。
- **关联**：`DOMAIN_MODEL.md` §8.6、`PRD.md` §7.6。

### P-027 异步 PvP 防守快照引用可变数据

- **现象**：快照若引用实时宠物/配置，改配置后历史战报会变。
- **规避**：保存 `BattleUnitInit[]`；24 小时有效；配置变更不回溯；战报带版本。
- **验证**：改配置后旧战报仍可回放。
- **关联**：`ONLINE_DESIGN.md` §6.2。

### P-028 只信客户端传的 Steam ID

- **现象**：客户端可以伪造 `steamId`。
- **规避**：服务端校验 Steam 会话票据；微信走 `code2session`；游客后续绑定。
- **验证**：伪造 ticket 被拒；跨端绑定到同一账号。
- **关联**：`ONLINE_DESIGN.md` §3。

### P-029 重试导致重复领奖/覆盖存档

- **现象**：网络重试、双击、并发写。
- **规避**：`Idempotency-Key` + `revision` + 唯一约束；客户端收到 `409` 拉全量。
- **验证**：重复请求返回同一结果；并发写不丢档。
- **关联**：`ONLINE_DESIGN.md` §4/§5、`TECH_DESIGN.md` §10。

### P-030 客户端/服务端各自复制 DTO

- **现象**：字段名/可空性不一致，联调时才发现。
- **规避**：`packages/protocol` 单一来源；禁止复制类型；协议版本检查。
- **验证**：两端编译同一版本；契约测试。
- **关联**：`TECH_DESIGN.md` §5、`AGENTS.md` §8。

---

## 2. 实施前必看的高风险坑

### P-101 多会话并行改同一文件

- **规避**：worktree/分支隔离；一个目录一个会话；共享文件只 Lead 改；每天合并。
- **验证**：`git status` 干净；CI 通过；无跨目录 diff。

### P-102 两个会话同时开 Cocos 编辑器

- **现象**：`.scene`/`.prefab`/`.meta` 冲突极难合。
- **规避**：客户端只开一个会话；美术只改图片/音频；微信开发者工具也只给客户端。
- **验证**：同一时间只有一个 Cocos 实例。

### P-103 Cocos 对 workspace 包解析不稳

- **规避**：构建前把 `packages/core`、`packages/protocol` 同步到 `client/assets/lib/`；保持包无副作用；不要反向依赖 Cocos。
- **验证**：CI 里跑一次“干净同步 + 构建”。

### P-104 微信主包超限/域名未配置

- **规避**：主包 ≤2MB；Asset Bundle 分包；远程资源走合规域名；真机测试。
- **验证**：开发者工具包体分析；真机首屏 ≤3s。

### P-105 数据库迁移/revision 处理不当

- **规避**：迁移向前兼容；先迁移后发版；备份；`revision` 冲突返回快照。
- **验证**：迁移回滚演练；并发写测试。

### P-106 配置 schema 漂移

- **规避**：A 拥有 `schema.ts`；D 只改 JSON；CI 跑 `validate:config`；引用完整性校验。
- **验证**：CI 阻断未定义字段/缺失引用。

### P-107 确定性漂移

- **规避**：无超越函数；统一 floor；固定种子快照；同 setup/seed/commands 双跑一致。
- **验证**：CI 跑 100 场固定对局快照。

### P-108 经济通胀/资源死锁

- **规避**：产出入上限、离线上限、升级成本递增、消耗出口；`sim` 跑 1000+ 场/路径。
- **验证**：资源曲线、胜率、平局率、平均回合数达标。

### P-109 像素资源导入设置错误

- **规避**：Point 过滤、无压缩、无 mipmap、整数缩放；图集 2px padding；禁止 JPG 背景。
- **验证**：2×/3× 截图无模糊/串色。

### P-110 性能预算失守

- **规避**：对象池、合批、图集、按需加载；同帧 draw call <200；内存 ≤200MB。
- **验证**：中端机 60fps；首屏 ≤3s；战斗回合 ≤50ms。

### P-111 放生/资源导致软锁

- **规避**：至少保留 1 只成年；初始保底 1 公 1 母；放生不可逆但有确认；资源不足有保底产出。
- **验证**：极端账号（只剩 1 只、零资源）仍能恢复。

### P-112 合规漏项

- **规避**：微信类目/主体/软著/版号备案；实名/防沉迷；随机概率公示；隐私政策；Steam 地区规则。
- **验证**：提审清单逐项打勾；M2 前落实主体与类目。

### P-113 手写场景的脚本组件 class id 不是 22 位 uuid

- **日期**：2026-10-29
- **发现者/会话**：B
- **范围**：client
- **现象**：构建日志出现 `Missing class: <id>` / `Script ... attached to "Canvas" ... is missing or invalid`，运行时场景组件不执行（黑屏）。
- **原因**：脚本组件的 `__type__` 是 `cclegacy._RF.push({}, "<compressedUUID>", ...)` 注入的 class id。它保留 uuid 前 **5** 位十六进制再编码，长度 **23**；而引擎 `decodeUuid` 处理的是 22 位资源压缩格式。按 22 位算法手写会与构建注入值不一致。
- **规避**：优先让编辑器保存场景；确需手写/生成场景时，从构建产物 `assets/main/index.js` 的 `_RF.push` 行取 id，或按“前 5 位 + 每 3 个 hex 编码成 2 个 base64”生成；`.scene.meta` 的 uuid 必须与脚本 `.ts.meta` 一致。
- **验证**：构建日志无 `Missing class`；场景能加载且组件逻辑执行。
- **关联**：`client/assets/scenes/*.scene`。

### P-114 赋 spriteFrame 会重置节点尺寸

- **日期**：2026-10-29
- **发现者/会话**：B
- **范围**：client
- **现象**：纯色底板/按钮不显示，或只有 8×8；运行时 `UITransform.contentSize` 等于贴图原始尺寸而不是布局尺寸。
- **原因**：先 `sprite.spriteFrame = frame` 会按贴图尺寸重置 contentSize；之后再设 `sizeMode = CUSTOM` 不会把尺寸改回来。
- **规避**：统一先设 `sprite.sizeMode = Sprite.SizeMode.CUSTOM`、`type`，再赋 `spriteFrame`，最后 `transform.setContentSize(width, height)`。`client/assets/scripts/ui/nodes.ts` 已封装。
- **验证**：运行时检查面板/按钮 contentSize 等于设计尺寸；1×1/8×8 白图能铺满面板。
- **关联**：`client/assets/scripts/ui/nodes.ts`。

### P-115 运行时 setDesignResolutionSize 与 Canvas 相机初始化竞争

- **日期**：2026-10-29
- **发现者/会话**：B
- **范围**：client
- **现象**：UI 整体缩小/偏移；`Camera.orthoHeight` 实测 810，而期望 540（1920×1080 的一半）。
- **原因**：Boot 里调用 `view.setDesignResolutionSize(1920,1080,...)` 会同步触发 `design-resolution-changed`，Canvas 用当时的 `screen.windowSize` 计算 `orthoHeight`；窗口尺寸随后才稳定，但相机没有再重算。
- **规避**：设计分辨率只放工程设置 `settings/v2/packages/project.json`（1920×1080，fitWidth+fitHeight=true 即 SHOW_ALL），不要在场景脚本里重复设置；需要动态改分辨率时，监听 `canvas-resize` 后重算。
- **验证**：`view.getDesignResolutionSize()` 为 1920×1080、scale 为 1280/1920、`Camera.orthoHeight` 为 540。
- **关联**：`client/assets/scripts/app/BootController.ts`、`client/settings/v2/packages/project.json`。

### P-116 Cocos 构建把 `[...new Set(x)]` 编译成 `[].concat(new Set(x))`

- **日期**：2026-10-30
- **发现者/会话**：B
- **范围**：client / core
- **现象**：宠物详情页报错 `配置表 "traits" 中不存在 id "[object Set]"`；`createPet` 返回的 `traits` 是 `[Set]` 而不是字符串数组（Node/tsx 下正常）。
- **原因**：Cocos 构建的 loose spread 只按数组处理，`[...new Set(list)]` 被编译成 `[].concat(new Set(list))`，把 Set 本身塞进数组。core 的 `pet.ts`/`breeding.ts` 的 `dedupe` 命中该模式。
- **规避**：`client/tools/sync-lib.mjs` 在生成 `assets/lib` 时把 `[...new Set(x)]` 等价改写为 `Array.from(new Set(x))`；源头建议 A 直接用 `Array.from`，避免所有构建目标踩坑。
- **验证**：构建后 `assets/main/index.js` 中不再出现 `[].concat(new Set(`；详情页 traits 正常显示名称。
- **关联**：`client/tools/sync-lib.mjs`、`packages/core/src/pet.ts`、`packages/core/src/breeding.ts`。

### P-117 占位底图带描边，拉伸成大面板后变成粗边框

- **日期**：2026-10-30
- **发现者/会话**：B
- **范围**：client
- **现象**：全屏背景四周出现约 160px 宽的深色边框；面板/按钮也有很粗的暗边，看起来像游戏只渲染了 960×540。
- **原因**：`white.png` 是 8×8 且带 1px 描边；用作纯色底图拉伸到 1920×1080 时，1/8 的描边被放大成 240 设计像素的粗边。
- **规避**：纯色底图必须用**无描边**白图（`gen-placeholders.mjs` 对 `white` 关闭 border）；宠物/图标占位图保留描边。
- **验证**：全屏背景下四角像素等于背景色（不是描边色）；面板无粗边框。
- **关联**：`client/tools/gen-placeholders.mjs`、`client/assets/scripts/ui/nodes.ts`。

### P-118 新增场景后 CLI 构建的默认初始场景漂移

- **日期**：2026-10-30
- **发现者/会话**：B
- **范围**：client
- **现象**：加入 `Battle.scene` 后，`--build "platform=web-mobile;debug=true"` 的 `settings.launch.launchScene` 变成 `Battle.scene`，启动直接进 Battle 且配置未加载，报“配置尚未加载”。
- **原因**：CLI 未指定 `startScene` 时按场景资源顺序选第一个；新增场景改变了顺序（Battle 排在 Boot 前）。
- **规避**：构建命令必须带 `startScene=<Boot 场景 uuid>`；Boot uuid 为 `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`。README 已更新。
- **验证**：构建产物 `src/settings.json` 的 `launch.launchScene` 为 `db://assets/scenes/Boot.scene`。
- **关联**：`client/README.md` 构建命令。

### P-119 `releasePet` 只返回 refund，不入账

- **日期**：2026-10-31
- **发现者/会话**：B
- **范围**：client / core
- **现象**：离线模式放生成功、宠物消失，但基因尘没有增加；服务端模式正常。
- **原因**：`core.releasePet` 按契约只返回 `{ profile, refund }`，不写 `currencies`；服务端在接口层入账，客户端 mock 动作漏了这一步。
- **规避**：离线动作在拿到 refund 后自行加进 `currencies`（`client/assets/scripts/services/petActions.ts`）；不要改 core 语义。
- **验证**：mock 放生前后 `geneDust` 差值等于 `refund.geneDust`。
- **关联**：`client/assets/scripts/services/petActions.ts`、`packages/core/src/release.ts`。

### P-120 本地存档时间戳超前会丢档

- **日期**：2026-10-31
- **发现者/会话**：B
- **范围**：client
- **现象**：开发时把 `Date.now` 快进 31 分钟验证孵化，之后刷新页面：`advanceProfile` 因 `now < lastEvaluatedAt` 抛 `TimeError`，原逻辑回退新建 mock，本地进度被覆盖。
- **原因**：时钟回拨/快进后，`advanceProfile` 拒绝倒退；启动时把异常当成坏档处理。
- **规避**：mock 启动读取本地档后，`advanceProfile` 失败时**保留原档**（不推进也不重建）；只有结构损坏/schema 不匹配才清理。真实设备改时间同理，服务器模式以服务器时间与 revision 为准。
- **验证**：快进后刷新，金币/宠物/蛋/关卡进度仍在；本地档 revision 不回退。
- **关联**：`client/assets/scripts/services/bootstrap.ts`、`client/assets/scripts/services/localSave.ts`。

### P-121 放生“已孵化但仍未领取”的宠物会留下悬空蛋 id

- **日期**：2026-10-31
- **发现者/会话**：B（联调中发现，待 A/C 处理）
- **范围**：core / server
- **现象**：服务端用短孵化配置时，蛋在放生前已变成幼年；`/pets/:id/release` 放生成功，但 `profile.breeding.eggs` 仍保留该 id，后续 claim 会 `NOT_FOUND`。
- **原因**：`core.releasePet` 只删 `pets`，不清理 `breeding.eggs`；拒绝规则只拦 `stage === 'egg'`，不拦“仍在 eggs 列表”。
- **规避（建议）**：A 在 `releasePet` 里同时从 `breeding.eggs` 移除该 id（或把“在 eggs 中”加入拒绝规则）；C 的 claim 对悬空 id 返回 `NOT_FOUND` 已有处理。客户端目前只能展示服务器结果。
- **验证**：放生幼年但仍在 eggs 的宠物后，`breeding.eggs` 不包含该 id。
- **关联**：`packages/core/src/release.ts`、`server` 繁殖领取。

---

## 2.1 2026-10-28 评审补记

### P-031 时间推进顺序在 TECH 与 DOMAIN/AGENTS 相反

- **日期**：2026-10-28
- **发现者/会话**：0 Lead
- **范围**：core / tech
- **现象**：TECH §9.2 先结算栖息地产出、再推进宠物；DOMAIN §7 与 AGENTS §3.4 是“先宠物、后栖息地”。
- **原因**：三处分别编写，未统一顺序；函数名还残留旧的推进函数名。
- **规避**：统一为 `advanceProfile`：阶段→状态→冷却 → 栖息地产出；TECH/DOMAIN/AGENTS 同序。
- **验证**：全文 grep 无旧推进函数名；三处顺序一致；同一 `now` 调两次无额外变化。
- **关联**：`TECH_DESIGN.md` §9.2、`DOMAIN_MODEL.md` §7、`AGENTS.md` §3.4。

### P-032 物种被动无数据落点

- **日期**：2026-10-28
- **发现者/会话**：0 Lead
- **范围**：content / core
- **现象**：`SpeciesConfig.passiveId` 指向一个不存在的配置表；被动效果没地方配，校验会悬空。
- **原因**：技能表只覆盖主动技能，被动被当成代码逻辑。
- **规避**：新增 `passives.json` + `PassiveConfig`；MVP 仅建战时生效（静态修正或开场一次性效果）。
- **验证**：`validate:config` 检查 `passiveId` 引用；无悬空；16 主动 + 5 被动计数一致。
- **关联**：`DOMAIN_MODEL.md` §2.6.1、`TECH_DESIGN.md` §8.1。

### P-033 经验闭环断裂

- **日期**：2026-10-28
- **发现者/会话**：0 Lead
- **范围**：core / content
- **现象**：`PetInstance.exp` 有字段，但没有经验来源、升级曲线和升级规则；旧文档写“战斗与喂养成长”。
- **原因**：先定了等级成长，后补经验系统。
- **规避**：经验仅来自 PVE 胜利；首通/重复不同档；`expToNext(level) = 40 + level×20`；异步 PvP 不给经验；`StageConfig.rewards` 增加 `petExp`。
- **验证**：新档打通第 1 关能升级；经验不来自 PvP/喂养；曲线可模拟。初版数值待 sim。
- **关联**：`PRD.md` §5.4/§8.6、`DOMAIN_MODEL.md` §2.7.1。

### P-034 编队无页面无 API

- **日期**：2026-10-28
- **发现者/会话**：0 Lead
- **范围**：client / server / core
- **现象**：Profile 有 `lineup` 字段，但 PRD 页面没有编队页、ONLINE 没有 `/lineup/set`，且与 PvP 防守阵容混在一起。
- **原因**：编队被当成战斗内部状态，没有独立系统边界。
- **规避**：PRD §12 加编队页；ONLINE §5.2 加 `/lineup/set`；与 `/pvp/defense` 分离；DOMAIN 不变量约束 3 只/非蛋/本人/引用存在。
- **验证**：两套阵容互不影响；幼年可上阵（70%）；引用失效被拒绝。
- **关联**：`PRD.md` §12、`ONLINE_DESIGN.md` §5.2、`DOMAIN_MODEL.md` §12。

### P-035 PRD 放生措辞与 DOMAIN 不一致（老年）

- **日期**：2026-10-28
- **发现者/会话**：0 Lead
- **范围**：product / core
- **现象**：PRD 写“幼年/成年可放生”，DOMAIN/AGENTS/PITFALLS 允许老年，规则不一致。
- **原因**：放生规则分散在四份文档，未统一。
- **规避**：PRD 改为“蛋不可；锁定/上阵/栖息地不可；至少保留 1 只成年”；老年可放。
- **验证**：蛋/锁定/上阵/栖息地/老年/最后成年六类用例。
- **关联**：`PRD.md` §7.6、`DOMAIN_MODEL.md` §8.6。

### P-036 MVP 物种 10→5 范围决策

- **日期**：2026-10-28
- **发现者/会话**：0 Lead
- **范围**：product / content / art
- **现象**：文档仍按旧物种数、旧图鉴组合数、10 条物种技能写；获取途径却只有 5 种。
- **原因**：MVP 范围收窄后未同步到图鉴、技能、克制网和美术。
- **规避**：统一为 5 物种/25 组合；技能 16 主动 + 5 被动；克制网 5 行；移除物种单列“后续物种”。
- **验证**：grep 已移除的物种名只在“后续物种”语境；技能计数一致。
- **关联**：`PRD.md` §4/§5/§13、`ART_SPEC.md` §3/§6/§9、`README.md`。

### P-037 已定决策残留在待确认清单

- **日期**：2026-10-28
- **发现者/会话**：0 Lead
- **范围**：product / docs
- **现象**：效果命中、中文正文字体已定，却还挂在 PRD/DOMAIN/ART 的待确认清单。
- **原因**：决策更新后只改了正文，没清理旧清单。
- **规避**：决策写 `PRD.md` §17；已定项从 §18/§14/§10 删除；只留真未定。
- **验证**：待确认列表无已定项；grep 已定关键词只出现在决策/历史语境。
- **关联**：`PRD.md` §17/§18、`DOMAIN_MODEL.md` §14、`ART_SPEC.md` §10。

---

## 2.2 2026-10-28 M0 契约冻结补记

### P-038 配置表里放函数，JSON 存不下

- **日期**：2026-10-28
- **发现者/会话**：0 Lead
- **范围**：core / content
- **现象**：DOMAIN_MODEL §2.7 `HabitatConfig.upgrade.cost/capacity/productionMul` 写成函数，但配置源是 JSON，序列化后函数丢失，校验器也读不到。
- **原因**：先写类型后定存储格式，把“计算规则”当成了“配置数据”。
- **规避**：`upgrade` 改为等级表 `{ maxLevel, levels: [{ level, cost, capacity, productionMul }] }`；等级从 1 连续；校验器检查长度与序号。见 `docs/CONTRACT.md` C-01。
- **验证**：`pnpm validate:config`；构造 maxLevel 不匹配用例会报 `invalid_value`。
- **关联**：`DOMAIN_MODEL.md` §2.7、`docs/CONTRACT.md` §7、`packages/core/src/config/schema.ts`。

### P-039 领域类型在 protocol 里复制一份

- **日期**：2026-10-28
- **发现者/会话**：0 Lead
- **范围**：protocol / core / server / client
- **现象**：协议需要 `Profile`、`PetInstance`、`BattleSetup`、`ProfilePatch` 等 DTO，最省事的做法是复制一遍；字段名/可空性随后漂移，联调才发现。
- **原因**：把“传输契约”和“领域契约”当成两套模型。
- **规避**：领域类型唯一定义在 `@petbattle/core`；`@petbattle/protocol` 只 `import type` / `re-export`；依赖方向固定为 protocol → core，core 不 import protocol；ESLint 禁止 core 引用其他 workspace 包。
- **验证**：protocol 测试校验 `ApiContract` 与 `ROUTES` 对齐；任何复制会在 typecheck 阶段出现重复定义或字段不一致。
- **关联**：`docs/CONTRACT.md` C-06/§3、PITFALLS P-030。

### P-040 NodeNext 下相对导入漏写 `.js`

- **日期**：2026-10-28
- **发现者/会话**：0 Lead
- **范围**：core / protocol / server / tools
- **现象**：`tsconfig` 用 `module: NodeNext`，写成 `import './types/pet'` 时 tsc 或运行时解析失败；写成 `.ts` 又会和构建产物冲突。
- **原因**：Node ESM 要求显式扩展名，TypeScript 的 NodeNext 按产物 `.js` 解析。
- **规避**：源码里的相对导入统一写 `.js`（`./types/pet.js`），由 tsx/Vitest/esbuild 映射到 `.ts`；不要写 `.ts` 扩展名。
- **验证**：`pnpm typecheck` + `npx tsx server/src/main.ts` 能直接跑通。
- **关联**：`tsconfig.base.json`、`docs/CONTRACT.md` §2。

### P-041 workspace 包的 exports 指向 TS 源码

- **日期**：2026-10-28
- **发现者/会话**：0 Lead
- **范围**：core / protocol / server / tools
- **现象**：M0 为了零构建，`@petbattle/core`、`@petbattle/protocol` 的 `exports` 直接指向 `src/index.ts`；这在 tsx/Vitest 下可用，但生产 Node 不能直接加载 TS。
- **原因**：契约会话不引入构建链，先用 TS 源码联调。
- **规避**：M1 由 A 用 esbuild（target es2020）产出 `dist/`，把 `exports` 改为 `import: ./dist/index.js` + `types: ./dist/index.d.ts`；在此之前不要用 `node file.js` 直接跑依赖这些包的代码。
- **验证**：M1 增加“干净构建 + node 启动”CI 步骤。
- **关联**：`TECH_DESIGN.md` §16、`docs/CONTRACT.md` §2.2、未决项 5。

---

## 2.3 2026-10-29 M1 首批集成补记

### P-042 测试写死配置数值，D 一调参就全红

- **日期**：2026-10-29
- **发现者/会话**：0 Lead（集成合并时）
- **范围**：core / content
- **现象**：A 的 `config-repo.test.ts` 断言 `contentVersion === '0.1.0'`、初始资源 `{coin:200,food:50}`。D 把内容升到 0.2.0、初始资源调成 300/60 后，A×D 合并测试失败 2 条，但两边代码都没错。
- **原因**：测试把“样例数据”当成“契约常量”。契约冻结的是结构、公式、范围，不是 D 的调参数值。
- **规避**：测试对配置的断言一律对照 fixture 本身（`expect(repo.contentVersion).toBe(fixture.contentVersion)`），只写死必须稳定的语义（物种数、技能数、相性方向）。数值断言放 D 的 sim/BALANCE，不放 core 单测。
- **验证**：`pnpm test` 在 contentVersion 0.2.0 下 246 条全绿；D 再调数值不需要改 core 测试。
- **关联**：`packages/core/test/config-repo.test.ts`、`docs/CONTRACT.md` §6.2、P-106。

### P-043 `strict` 分支漏判，静默降级掩盖失败

- **日期**：2026-10-29
- **发现者/会话**：0 Lead（集成合并时）
- **范围**：server
- **现象**：C 的 `CoreAdapter` 在“配置仓库不可用”分支直接降级，没有检查 `allowStub`；即使 `PETBATTLE_CORE_STUB=strict`，服务端仍静默恒等推进，线上会表现为“写成功但数据没变”。
- **原因**：降级逻辑分两个出口（无配置仓库 / core 抛未实现），只有一个出口判断了 strict。
- **规避**：所有降级出口统一先判 `allowStub`；strict 下抛 `CoreNotImplementedError`，由统一错误映射返回 501。降级必须留日志，不允许无声。
- **验证**：`server/test/domain.test.ts` 覆盖 strict + 无配置仓库 → 抛错；真实 core 下 `degraded=false`，日志无“降级”。
- **关联**：`server/src/domain/core-adapter.ts`、`docs/CONTRACT.md` §8.3、P-107。

---

## 2.4 2026-10-29 A 首批实现反馈

### P-044 比例属性不能 floor

- **日期**：2026-10-29
- **发现者/会话**：A 核心
- **范围**：core / battle
- **现象**：`crit`、`critDmg`、`hit`、`dodge` 是比例属性（0~1、1.5 之类），如果和 hp/atk 一样在最后统一 `floor`，暴击率会被抹成 0、暴伤变成 1。
- **原因**：把“所有属性最终取整”的规则套到了比例属性上。
- **规避**：只有 hp/atk/def/spd 取整；比例属性保留 double，按各自区间 clamp（crit 0~1、dodge 0~0.9、hit -0.5~0.5、critDmg 默认 1.5）。
- **验证**：`stats.test.ts` 覆盖满状态/低状态的比例属性；`deriveStats` 不产生 0 暴击。
- **关联**：`DOMAIN_MODEL.md` §4.1、`packages/core/src/stats.ts`。

### P-045 状态衰减依赖栖息地配置，不能只在 advancePet 里做

- **日期**：2026-10-29
- **发现者/会话**：A 核心
- **范围**：core / content
- **现象**：`advancePet` 单独调用时拿不到宠物所在的栖息地配置，衰减速率、健康恢复、食物惩罚都无从计算；如果在那里硬编码一份速率，会与 `habitats.json` 漂移。
- **原因**：把“状态衰减”当成宠物自身规则，实际它由栖息地配置驱动。
- **规避**：`advancePet` 只负责阶段与冷却；状态衰减/恢复由 `advanceProfile` 结合宠物所在栖息地统一结算。蛋不衰减、不消耗。
- **验证**：`advance.test.ts` 覆盖“先宠物、后栖息地”的顺序与 24h 衰减封顶；同一 now 幂等。
- **关联**：`DOMAIN_MODEL.md` §5.2/§7、`AGENTS.md` §3.4、P-031。

### P-046 契约函数缺少配置/冷却出口，服务端只能另写一套

- **日期**：2026-10-29
- **发现者/会话**：A 核心
- **范围**：core / server
- **现象**：`releasePet` 没有配置参数，算不出特质稀有度加成；`breed` 不返回父母冷却，服务端要接繁殖就得自己再实现一遍“×1.2 / 老年 ×2”的口径。
- **原因**：M0 冻结签名时按“最小参数”设计，没考虑服务端落库需要完整结果。
- **规避**：接口返回**服务端落库所需的全部派生结果**（返还资源、父母冷却），而不是只返回领域对象让调用方推导。已在 contract-v1.2 裁定（CONTRACT §7.1 D-01/D-02）。
- **验证**：`release.test.ts` 用配置里的 rarityBonus 断言返还；`breeding.test.ts` 断言 `parentCooldowns` 的普通/近亲/老年口径。
- **关联**：`docs/CONTRACT.md` §7.1、`packages/core/src/release.ts`、`packages/core/src/breeding.ts`。

---

## 2.5 2026-10-29 D/C 第二批反馈

### P-047 patch 里同一个 id 既 upsert 又 remove

- **日期**：2026-10-29
- **发现者/会话**：C 服务端
- **范围**：server / core
- **现象**：一次放生写操作里，`advanceProfile` 产出的 patch 会 upsert 该宠物（时间/状态变化），端点逻辑又把它 remove。合并时若 upsert 覆盖 remove，客户端会重新出现已放生的宠物。
- **原因**：增量 patch 的两份来源（时间推进、端点改动）没有约定冲突优先级。
- **规避**：`composePatch` 中 **remove 优先于 upsert**；同一 id 出现在两边时删除生效。补单测锁定。
- **验证**：`server/test/domain.test.ts` 有 upsert+remove 同 id 用例；放生后客户端不再显示该宠物。
- **关联**：`server/src/domain/patch.ts`、`docs/CONTRACT.md` §4.1。

### P-048 宠物在栖息地里，却没有“移出”入口，导致无法放生

- **日期**：2026-10-29
- **发现者/会话**：C 服务端（联调时）
- **范围**：protocol / core / server
- **现象**：初始 3 只宠物都放进栖息地槽位；`releasePet` 按 DOMAIN §8.6 拒绝 `in_habitat`，但 ONLINE_DESIGN 的端点表只有喂食/清理/玩耍/升级，没有“放入/移出栖息地”。玩家无法把宠物移出，也就永远放生不了。
- **原因**：端点按“日常照料动作”设计，漏了槽位管理；规则和入口没有对齐。
- **规避**：新增 `POST /habitat/move`（`petId` + `habitatId | null`）与 core `movePetToHabitat`；容量/归属/非蛋/去重由 core 校验。见 contract-v1.3 D-12。
- **验证**：E2E：初始档 → move 移出 → release 成功；容量满、重复槽位、非本人宠物被拒绝。
- **关联**：`docs/CONTRACT.md` §7.2 D-12、`docs/ONLINE_DESIGN.md` §5.2、`DOMAIN_MODEL.md` §8.6。

---

## 2.6 2026-10-29 A 第三批反馈

### P-049 模拟器自带 AI 与 core `autoCommand` 漂移

- **日期**：2026-10-29
- **发现者/会话**：A 核心 / 0 Lead
- **范围**：sim / core
- **现象**：A 改了 `autoCommand` 的留能量策略，但 `pnpm sim` 的 5000 场结果（0.598 / 6.14 回合 / 大招间隔 2.94）一字未变。原因是 `packages/sim/src/battle.ts` 用自己的 `pickCommand`，没有调用 `BattleEngine.autoCommand`。
- **原因**：sim 把自己定位成“玩家策略”，core 的 AI 是“自动战斗/防守 AI”，两套策略各自演化。
- **规避**：BALANCE 报告必须写明该曲线由哪套策略产生；需要评估自动战斗/PvP 防守时应改用 `engine.autoCommand`，或同时输出两套结果。不要让“改了 AI 但数字没变”被误读为 AI 无效。
- **验证**：`pnpm sim` 增加 `--ai=core|sim`（或两列并排）；同一 seed 下两套策略的结果可对比。
- **关联**：`packages/sim/src/battle.ts`、`packages/core/src/battle/engine.ts`、`docs/BALANCE.md`。

---

## 2.7 2026-10-29 C 第四批反馈

### P-050 迁移脚本每次启动盲跑，会重复执行 drop/alter

- **日期**：2026-10-29
- **发现者/会话**：C 服务端
- **范围**：server / storage
- **现象**：`migrate()` 每次启动按文件名顺序执行全部 SQL；002 里有条件 `drop` 旧占位表，重启后把 `battle_sessions` 一起清空，PvE 会话凭空消失。
- **原因**：没有迁移台账，SQL 被当成幂等脚本使用；条件重建在“每次启动”语义下变成破坏性操作。
- **规避**：新增 `schema_migrations` 记录已应用版本；迁移只跑一次；需要重建的迁移用“仅当旧结构存在”的守卫。`migrate.test.ts` 断言第二次启动不再执行。
- **验证**：预置 started 会话 → 重启进程 → 会话仍在；迁移台账记录 001/002 各一行。
- **关联**：`server/src/storage/postgres.ts`、`server/src/storage/migrations/**`、PITFALLS P-105。

---

## 2.8 2026-11-01 M1 收尾补记

### P-122 放生未领取孵化体，breeding.eggs 留下悬空 id（P-121 修复记录）

- **日期**：2026-11-01
- **发现者/会话**：B 客户端 / 0 Lead
- **范围**：core / server / client
- **现象**：蛋已孵化（stage 变 juvenile/adult）但未领取，仍在 `breeding.eggs`。此时放生成功，宠物已删除，但 `breeding.eggs` 仍保留该 id；客户端可能继续显示一颗幽灵蛋。
- **原因**：`releasePet` 只清理 `pets`、栖息地槽位、`lineup`；服务端 release patch 也没有下发 `breeding` 的变化。
- **规避**：core `releasePet` 在删除宠物时同步从 `breeding.eggs` 移除同 id；服务端 release patch 在 `breeding` 变化时下发新值；客户端用 `applyProfilePatch` 合并。DOMAIN 不变量“放生后清理干净”应把 `breeding.eggs` 也算进去（A 下次同步 DOMAIN）。
- **验证**：core 单测覆盖“已孵化未领取 → 放生 → eggs 清空”；Postgres E2E：release 200、patch.breeding.eggs=0、profile.breeding.eggs=0、pets 3、返还 27。
- **关联**：P-121、`packages/core/src/release.ts`、`server/src/services/profile-service.ts`、`DOMAIN_MODEL.md` §8.6/§12。

---

## 2.9 2026-11-02 M2 契约补记

### P-123 Cocos CLI 构建的横屏/AppID/urlCheck 不随命令参数稳定生效

- **日期**：2026-11-02
- **发现者/会话**：B（M1 真机测试），0 Lead 记录
- **范围**：client / build
- **现象**：CLI 传 `orientation=landscape` 不生效，`game.json` 仍是 portrait；AppID 与 `urlCheck` 只在上次构建产物里手工改过，重新构建后参数漂移。
- **原因**：构建参数与工程 `settings/` 的优先级不一致，且没有把微信侧配置纳入版本控制/构建脚本。
- **规避**：B 在 M2 把横屏、AppID、`urlCheck` 固定到构建脚本或模板（M2 批次任务 A2）；构建产物不作为基线；每次构建后检查 `game.json`。构建必须显式带 `startScene=db://assets/scenes/Boot.scene`（P-118）。
- **验证**：删除 `client/build/**` 后重新构建，`game.json` 仍为横屏且 AppID/urlCheck 正确；真机预览可进 Home。
- **关联**：`client/README.md`、`client/settings/**`、`HANDOFF_M2.md` §5.2、P-116/P-118。

### P-124 Node 24 直接跑客户端校验脚本会因无扩展名 import 失败

- **日期**：2026-11-02
- **发现者/会话**：0 Lead
- **范围**：client / tooling
- **现象**：`node client/tools/verify-errors.ts` 报 `ERR_MODULE_NOT_FOUND`（找不到 `services/errors` 的扩展名），但脚本本身没报业务错误；退出码仍可能是 0，容易被误判为通过。
- **原因**：Node 24 的原生 TS 类型擦除不解析无扩展名 import；脚本原本按 `tsx` 运行。
- **规避**：校验脚本统一用 `pnpm exec tsx client/tools/verify-errors.ts` / `verify-api-client.ts`；不要把 `node xxx.ts` 写进验收命令。
- **验证**：两条命令均以 0 退出并打印 PASS；`node` 直跑的错误不被当作通过。
- **关联**：`client/tools/verify-errors.ts`、`client/tools/verify-api-client.ts`、`HANDOFF_M2.md` §2.3。

### P-125 Cocos 3.8.8 CLI 的 `startScene` 只认 uuid，`db://` 会被静默忽略

- **日期**：2026-11-02
- **发现者/会话**：B 客户端
- **范围**：client / build
- **现象**：按 P-118 传 `startScene=db://assets/scenes/Boot.scene`，CLI 不报错但启动场景回退到场景列表第一个（Battle）；产物 `src/settings.json` 的 `launchScene` 不是 Boot。
- **原因**：3.8.8 的命令行构建参数只解析场景 uuid；`db://` 字面量不匹配任何资源，被静默忽略。
- **规避**：构建统一用 `node client/tools/build.mjs`，脚本固定 Boot uuid `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`，并在构建后断言 `launchScene` 包含 `Boot.scene`；不要再手写 `db://` 参数。
- **验证**：删除 `client/build/**` 后重新构建，脚本打印 `launchScene=db://assets/scenes/Boot.scene`；改回 `db://` 参数会触发脚本的 launchScene 断言失败。
- **关联**：P-118、P-123、`client/tools/build.mjs`、`docs/CONTRACT.md` §2.3。

---

## 3. 按领域的检查清单

### 3.1 core

- [ ] 无 `Math.random` / `Date.now` / `cc` / `wx` / DOM / 网络
- [ ] 时间由调用方传入；随机由 `Rng` 注入
- [ ] 同种子确定性一致；无超越函数
- [ ] 最终 `floor`；无 `NaN/Infinity`
- [ ] 单测 + 确定性快照；覆盖率 ≥85%
- [ ] 配置校验：结构/引用/范围/语义

### 3.2 client / Cocos / 微信

- [ ] 只有一个会话开编辑器
- [ ] `app/` 不直接调 `wx.*`，走 platform adapter
- [ ] 不复制 core/protocol 类型
- [ ] Point 过滤、整数缩放、无压缩
- [ ] 主包 ≤2MB；首屏 ≤3s
- [ ] 场景/预制体改动前先同步

### 3.3 server / online

- [ ] 客户端只交动作，不交结果
- [ ] 写操作幂等；revision 冲突处理
- [ ] 服务器时间/离线上限/异常检测
- [ ] 微信 code2session / Steam ticket 校验
- [ ] 2C2G：Redis 后置、PvP 限并发、连接池/堆上限
- [ ] 审计日志：经济、繁殖、战斗、放生

### 3.4 content / economy

- [ ] 只改 JSON，不改 schema/公式
- [ ] `validateConfig` 通过
- [ ] 产出/消耗/升级曲线有模拟报告
- [ ] 不做抽卡；获取途径覆盖初始/关卡/繁殖
- [ ] 文案外置，不在图片里烘焙文字

### 3.5 art

- [ ] 640×360 虚拟基准；2×/3× 整数缩放
- [ ] Point 过滤；无抗锯齿；1px 描边
- [ ] Aseprite 序列帧，不用 Spine
- [ ] 图集 2px padding；无 JPG 背景
- [ ] 中文正文系统字体
- [ ] 占位图与最终资源同尺寸/pivot

### 3.6 collaboration

- [ ] 只改自己目录；共享文件找 Lead
- [ ] 分支/worktree 隔离；每天合并
- [ ] 协议/核心类型不复制、不私改
- [ ] 决策写进 `PRD.md` §17
- [ ] 新坑追加到本文，不删除他人条目

---

## 4. 新增记录模板

```md
### P-XXX 标题

- **日期**：YYYY-MM-DD
- **发现者/会话**：<A/B/C/D/E/0>
- **范围**：core / client / server / content / art / collaboration
- **现象**：发生了什么，报错/表现是什么
- **原因**：根因，不要只写“手误”
- **规避**：以后怎么做，最好能落到规则/检查项
- **验证**：怎么确认不会再犯（测试/命令/检查清单）
- **关联**：文档章节、文件、PR
```

---

## 5. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-10-27 | 初版：设计阶段已修正坑 + 实施高风险 + 领域检查清单 |
| v1.1 | 2026-10-28 | 追加 P-031~P-037（评审补记）；红线补 MVP 物种 5 种 |
| v1.2 | 2026-10-28 | 追加 P-038~P-041（M0 契约冻结补记：配置序列化、类型单一来源、NodeNext 扩展名、exports 指向源码） |
| v1.3 | 2026-10-29 | 追加 P-042/P-043（M1 首批集成：测试写死配置数值、strict 降级漏判） |
| v1.4 | 2026-10-29 | 追加 P-044~P-046（A 首批实现反馈：比例属性取整、状态衰减归属、契约缺落库出口） |
| v1.5 | 2026-10-29 | 追加 P-047/P-048（D/C 第二批：patch 同 id 冲突、栖息地无移出入口） |
| v1.6 | 2026-10-29 | 追加 P-113~P-115（B 客户端：手写场景 class id、spriteFrame 重置尺寸、设计分辨率与相机竞争） |
| v1.7 | 2026-10-29 | 追加 P-049（sim 自带 AI 与 core autoCommand 漂移） |
| v1.8 | 2026-10-29 | 追加 P-050（迁移盲跑重复 drop，清空 PvE 会话） |
| v1.9 | 2026-10-30 | 追加 P-116（Cocos loose spread 把 `[...new Set]` 编译成 `[Set]`，客户端同步时改写） |
| v1.10 | 2026-10-30 | 追加 P-117/P-118（占位底图描边被拉伸成粗边框；CLI 构建初始场景漂移） |
| v1.11 | 2026-10-31 | 追加 P-119~P-121（放生返还入账、本地档时钟超前、悬空蛋 id 待 A/C 处理） |
| v1.12 | 2026-11-01 | 追加 P-122（P-121 修复：放生清理 breeding.eggs，server patch 下发） |
| v1.13 | 2026-11-02 | 追加 P-123/P-124（构建配置漂移；Node 直跑校验脚本的扩展名坑） |
| v1.14 | 2026-11-02 | 追加 P-125（Cocos 3.8.8 CLI 只认 startScene uuid，db:// 被忽略） |
