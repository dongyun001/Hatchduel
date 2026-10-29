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
| [CONTRACT.md](./CONTRACT.md) | **contract-v1 冻结内容**：protocol/core/配置接口清单、各会话接手点、变更流程 | A/B/C/D/E 与所有并行会话 |
| [SESSION_PROMPTS.md](./SESSION_PROMPTS.md) | 并行会话启动提示词（可直接粘贴）；一次能跑几个会话、前置条件 | 并行会话 |
| [AGENTS.md](../AGENTS.md) | AI 工作约定、硬性规则、验收与汇报格式 | AI/维护者 |

文档冲突时以 `PRD.md` 为准，并回头修订其他文档。

## 五个关键决策

1. **客户端用 Cocos Creator 3.x**：一套代码导出微信小游戏和 Steam；放弃“零依赖自绘 Canvas”。
2. **领域核心是纯 TS 包**：不依赖 Cocos/微信/Steam，服务器复用同一套规则。
3. **异步 PvP 优先**：先账号、云存档、异步 PvP、排行榜；实时房间 Phase 3。
4. **时间是一等公民**：圈养、成长、繁殖、离线收益都由“状态 + 时间戳 + 推进函数”驱动。
5. **服务器权威**：货币、宠物、繁殖、战斗结果不由客户端决定。

## 当前状态

- 文档版本：v1.3（新增 `docs/CONTRACT.md`，contract-v1 已冻结）。
- M0 契约：`contract-v1` 冻结于 2026-10-28；仓库骨架、protocol/core 公共契约、配置校验、server Hello、CI 已就绪。
- 并行（2026-10-29）：A/C/D 首批已合入 main（246 测试、Postgres 冒烟通过）；A 还差 `createPet`；B 需先在 Cocos Dashboard 安装 3.x 编辑器；美术暂停。启动提示词见 `SESSION_PROMPTS.md`。
- 已定：Demo 免费、像素风、MVP 物种 5 种（龟/鱼/青蛙/猫/蛇）、宠物不死亡可放生、不做主动治疗、性别保留、简体中文、2C2G Demo 服务器、不做转生、实时房间后置、交易后做。
- 仍待定：正式版商业模式、Steam 首发地区、交易形态、扩容阈值。
- 下一步：B 会话创建 Cocos 工程（本机无 Cocos，`client/README.md` 已说明）；A 按 `docs/CONTRACT.md` §8.1 补齐 core 实现。

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
