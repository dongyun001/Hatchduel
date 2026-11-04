# PetBattle 开发文档索引

> **项目介绍、玩法与开发状态请看根目录 [README.md](../README.md)。** 本文是开发文档索引，面向开发者与 AI 会话。
>
> AI 编码助手请先读仓库根目录的 [AGENTS.md](../AGENTS.md)；踩坑记录见 [PITFALLS.md](./PITFALLS.md)。

## 一页结论

- **产品**：以圈养、繁殖、基因收集为核心的宠物养成游戏；战斗是核心玩法之一；异步联机是核心卖点；微信小游戏首发，后续 Steam。
- **技术**：Cocos Creator 3.x 客户端 + 纯 TS 领域核心包（客户端/服务器共用）+ Node 服务端；服务器权威、时间驱动、配置驱动。
- **联机**：异步 PvP 优先，实时房间后置；微信与 Steam 共用账号与云存档。
- **美术**：像素风；先定规格再量产；占位图跑通布局；包体按微信预算裁剪。

## 文档地图

| 文档 | 回答什么 | 读者 |
|---|---|---|
| [README.md](../README.md) | 项目是什么、玩法、平台、状态、FAQ | 玩家/客户 |
| [PRD.md](./PRD.md) | 做什么、为什么、MVP 和里程碑 | 所有人 |
| [TECH_DESIGN.md](./TECH_DESIGN.md) | 怎么实现、架构、分层、构建 | 开发 |
| [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) | 数据结构、公式、繁殖/时间算法 | 开发 |
| [ONLINE_DESIGN.md](./ONLINE_DESIGN.md) | 账号、云存档、异步 PvP、反作弊 | 开发/运维 |
| [ART_SPEC.md](./ART_SPEC.md) | 资源清单、尺寸、动画、包体预算 | 美术/开发 |
| [COLLABORATION.md](./COLLABORATION.md) | 分工、目录所有权、合并规则、会话模板 | 所有人/并行会话 |
| [PITFALLS.md](./PITFALLS.md) | 踩坑记录、规避方法、领域检查清单 | 所有人 |
| [CONTRACT.md](./CONTRACT.md) | **contract-v1.6 冻结内容**：protocol/core/配置接口清单、各会话接手点、变更流程、M2 PvP/排行榜口径（§7.5） | A/B/C/D/E 与所有并行会话 |
| [SESSION_PROMPTS.md](./SESSION_PROMPTS.md) | M0/M1 并行会话启动提示词（历史） | 并行会话 |
| [SESSION_PROMPTS_M2.md](./SESSION_PROMPTS_M2.md) | **M2 并行会话启动提示词**（A/C/B，可直接粘贴）；会话数量、节奏、合并顺序 | M2 并行会话 |
| [SESSION_PROMPTS_M3.md](./SESSION_PROMPTS_M3.md) | **M3 并行会话启动提示词**（C/D/E/B，可直接粘贴）；微信登录、正式美术、包体、提审 | M3 并行会话 |
| [UI_BACKLOG.md](./UI_BACKLOG.md) | UI 欠账：现在修 / M2 / M3；UI kit、三态、安全区、构建配置漂移 | B 与所有做界面的会话 |
| [HANDOFF_M2.md](./HANDOFF_M2.md) | M1→M2 交接：仓库/契约/缺口/M2 待定项/新 0 启动步骤与会话建议 | 新 0 号与 M2 并行会话 |
| [AGENTS.md](../AGENTS.md) | AI 工作约定、硬性规则、验收与汇报格式 | AI/维护者 |

文档冲突时以 `PRD.md` 为准，并回头修订其他文档。

## 五个关键决策

1. **客户端用 Cocos Creator 3.x**：一套代码导出微信小游戏和 Steam；放弃“零依赖自绘 Canvas”。
2. **领域核心是纯 TS 包**：不依赖 Cocos/微信/Steam，服务器复用同一套规则。
3. **异步 PvP 优先**：先账号、云存档、异步 PvP、排行榜；实时房间 Phase 3。
4. **时间是一等公民**：圈养、成长、繁殖、离线收益都由“状态 + 时间戳 + 推进函数”驱动。
5. **服务器权威**：货币、宠物、繁殖、战斗结果不由客户端决定。

## 当前状态

- 文档版本：v1.7（M3 会话计划与提示词已就绪；M2 tag 已验收）。
- M0 契约 `contract-v1`（2026-10-28）与 M1 / MVP-A（tag `m1`）已完成。
- **M2 契约已冻结：contract-v1.6（2026-11-02）**，见 `docs/CONTRACT.md` §7.5：
  防守快照/匹配/双 AI 结算/战报/段位/四榜/日报限流/机器人；协议增量已入库（`GET /pvp/defense` + 3 个错误码）。
- M2 进度：**A（core）、C（server）、B（client）均已合并**（§11.15/§11.17/§11.18）；
  两账号异步 PvP、战报回放、段位变化、四榜全部跑通，539 测试（Postgres 全链路已验证）。
- 已知收尾项：微信开发者工具预览已跑（mock/server 两张二维码），真机扫码待用户；微信 release 包 3.14MB 仍高于 2MB（M3-06）；
  AppID 仍为 `touristappid`；服务端无 CORS（web 真实接口需同源代理或微信端）。
- 下一步：按 `docs/SESSION_PROMPTS_M3.md` 开 **C/D/E/B** 四个会话（A 按需），合并顺序 D → C → E → B；
  M3 重点是微信登录/内容安全、正式美术音频、包体 ≤2MB、提审与真机。
- 已定：Demo 免费、像素风、MVP 物种 5 种（龟/鱼/青蛙/猫/蛇）、宠物不死亡可放生、不做主动治疗、性别保留、简体中文、2C2G Demo 服务器、不做转生、实时房间后置、交易后做。
- 仍待定：正式版商业模式、Steam 首发地区、交易形态、扩容阈值、微信/Steam 登录细节。

## 建议阅读顺序

0. 玩家/客户先看根目录 `README.md`；开发者从 `PRD.md` 开始。
1. 先读 `PRD.md` 第 1~4 章，确认产品定位、核心循环和系统权重。
2. 再读 `PRD.md` 第 13~14 章，确认 MVP 和里程碑。
3. 开发读 `TECH_DESIGN.md` + `DOMAIN_MODEL.md`。
4. 做联机前读 `ONLINE_DESIGN.md`。
5. 美术介入前读 `ART_SPEC.md`。
6. 开并行会话前读 `COLLABORATION.md`，按目录所有权和会话模板分工。
7. AI 会话先读 `AGENTS.md`；开工前读 `PITFALLS.md` 对应领域。
8. 并行会话开工前必读 `CONTRACT.md`（接口清单、接手点、变更流程）；契约以代码为准。

## 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.2 | 2026-10-28 | MVP 物种收窄为 5 种；同步 README/INDEX/AGENTS 的已定决策 |
| v1.3 | 2026-10-28 | 新增 CONTRACT.md 索引；记录 contract-v1 冻结与 M0 骨架状态 |
| v1.4 | 2026-11-02 | contract-v1.6（M2 PvP/排行榜）；新增 SESSION_PROMPTS_M2.md、UI_BACKLOG.md；更新当前状态 |
| v1.5 | 2026-11-02 | A/C M2 批次已合并（539 测试、Postgres 全链路）；B 任务 A 预验收，待真实接口 |
| v1.6 | 2026-11-03 | B M2 批次合并；两账号 PvP/回放/段位/四榜验收通过；M2 完成，tag `m2` |
| v1.7 | 2026-11-05 | 新增 SESSION_PROMPTS_M3.md；M3 四会话（C/D/E/B）与合并顺序 |
