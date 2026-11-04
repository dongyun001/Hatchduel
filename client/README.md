# client/ —— Cocos Creator 3.8.8 工程（B 会话）

横屏 2D 工程，设计分辨率 **1920×1080**，虚拟像素基准 **640×360**（3× 整数放大）。
M1 场景：Boot / Home / PetList / PetDetail / Breeding / Habitat / StageSelect / Battle。
M2 批次 B1 新增：PvpDefense / PvpOpponent / PvpResult / PvpReplay / Leaderboard；
PvP 为 **mock / server 双路径**，server 已按 contract-v1.6 接通 `/pvp/*` 与 `/leaderboard`。

## 打开工程

1. 用本机 Cocos Creator **3.8.8** 打开 `client/`（`C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe`）。
2. 同一时间只允许一个会话打开编辑器（PITFALLS P-102）。
3. 首次打开会自动导入 `assets/`，生成 `library/`、`temp/`（均已 gitignore）。

## 目录

```
client/
  assets/
    scenes/                  Boot / Home / PetList / PetDetail / Breeding / Habitat / StageSelect / Battle
                             + PvpDefense / PvpOpponent / PvpResult / PvpReplay / Leaderboard
    scripts/
      app/                   各场景控制器、store、navigation、SceneView 壳
      platform/              wechat / web / steam 适配器；wx.* 只允许出现在这里
      services/              ApiClient、bootstrap、config、habitat/battle/breeding/pvp actions、errors
      dev/                   DEV_CONFIG、mock profile、mock PvP、本地 clone/rng、devFaults
      ui/                    kit / states / safeArea / virtualList / lineupEditor / renameDialog
                             theme / nodes / screens / sceneView / placeholders
    lib/                     **生成物**：从 packages/core、packages/protocol 同步
    resources/
      config/                **生成物**：从 core/src/config/data 同步的 12 份 JSON
      placeholders/          同尺寸占位图（96×96 宠物/剪影、256×256 立绘、48×48 蛋、32×32 图标）
  build-templates/           微信构建模板（game.json / project.config.json，UI-04）
  settings/v2/packages/      工程设置（设计分辨率、2D 模块裁剪）
  tools/                     同步、类型检查、构建固定、占位图生成、ApiClient/PvP 验证
```

## 命令（不进入 pnpm workspace，不碰根 lockfile）

```bash
# 构建前同步 core/protocol + 配置 JSON（单向，P-103）
node client/tools/sync-lib.mjs
node client/tools/sync-lib.mjs --check   # CI：不一致则退出 1

# 不打开编辑器做类型检查（使用 Cocos 安装目录里的 cc.d.ts）
node client/tools/typecheck.mjs
# 可用 COCOS_CREATOR_DIR 覆盖 Creator 安装目录

# 验证 ApiClient：serverTime 偏移、409 latestProfile 重建、幂等/版本头
pnpm exec tsx client/tools/verify-api-client.ts

# 验证错误码文案（含 DAILY_LIMIT_REACHED / OPPONENT_UNAVAILABLE / REPLAY_EXPIRED）
pnpm exec tsx client/tools/verify-errors.ts

# 验证离线 PvP：防守校验/24h stale、匹配、真实事件流、回放、日报、Elo、四榜
pnpm exec tsx client/tools/verify-pvp.ts

# 真实服务端两账号验收（需先起服务端；默认 http://127.0.0.1:3101）
pnpm exec tsx client/tools/verify-server-pvp.ts
# 边界场景（各起一个对应环境变量的干净内存服务端）：
PETBATTLE_API_URL=http://127.0.0.1:3102 VERIFY_SCENARIO=bot pnpm exec tsx client/tools/verify-server-pvp.ts
PETBATTLE_API_URL=http://127.0.0.1:3103 VERIFY_SCENARIO=daily pnpm exec tsx client/tools/verify-server-pvp.ts
PETBATTLE_API_URL=http://127.0.0.1:3104 VERIFY_SCENARIO=snapshot pnpm exec tsx client/tools/verify-server-pvp.ts
PETBATTLE_API_URL=http://127.0.0.1:3105 VERIFY_SCENARIO=replay pnpm exec tsx client/tools/verify-server-pvp.ts

# 重新生成占位图
node client/tools/gen-placeholders.mjs

# 构建（固定参数 + 后处理；P-118/P-123）
node client/tools/build.mjs --platform=wechatgame --debug
node client/tools/build.mjs --platform=web-mobile --debug
# 上传正式号：直接覆盖产物 AppID，不用改模板
node client/tools/build.mjs --platform=wechatgame --release --appid=wxXXXXXXXXXXXXXXXX
# 只对已有产物做后处理/校验（不跑 Cocos）
node client/tools/build.mjs --platform=wechatgame --postprocess-only=client/build/wechatgame --appid=wxXXXXXXXXXXXXXXXX
```

### 构建固定项（UI-04 / P-123）

`build.mjs` 不再依赖手工改产物：

| 项 | 固定值 |
|---|---|
| `startScene` | Boot 场景 uuid `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d`（Cocos 3.8.8 CLI 不认 `db://` 路径，实测会回退到 Battle；P-118） |
| 微信 `game.json` | `deviceOrientation=landscape`、`showStatusBar=false` |
| 微信 `project.config.json` | 模板 `build-templates/wechatgame/project.config.json`；AppID 默认 `touristappid`，`setting.urlCheck=false`；可用 `--appid=` 覆盖 |
| 校验 | 产物 `src/settings.json` 的 `launchScene` 必须包含 `Boot.scene`，否则退出 1 |

正式号上传用 `--appid=wx...` 覆盖即可，模板保持 `touristappid`；`client/build/**` 是产物，不作为基线。

## 约束

- `client/` **不在 pnpm workspace**；不要新增根依赖或改 `pnpm-lock.yaml`。
- `assets/scripts/app/**` 禁止直接 `wx.*`；统一走 `platform/`。
- 不复制 `@petbattle/core` / `@petbattle/protocol` 的类型；`assets/lib/**` 是同步后的源码副本，改源包再同步。
- `library/`、`temp/`、`build/`、`profiles/`、`native/`、`logs/` 不进 git。

## 同步规则

`sync-lib.mjs` 会：

1. 复制 `packages/core/src/**`、`packages/protocol/src/**` 的 `.ts` 到 `assets/lib/{core,protocol}`；
2. 去掉相对 import 的 `.js` 后缀（Cocos 用扩展名无关解析）；
3. 把 `@petbattle/core` 改写成指向 `assets/lib/core` 的相对路径；
4. 把 `[...new Set(x)]` 等价改写为 `Array.from(new Set(x))`（Cocos loose spread 会编译成 `[Set]`，P-116）；
5. 保留已有 `.meta`（避免每次同步更换 uuid），只清理源里已删除的文件；
6. 把 `packages/core/src/config/data/*.json` 复制到 `assets/resources/config/`（配置数据也是单源）。

`assets/lib/**` 与 `assets/resources/config/**` 是提交进仓库的生成物，保证 clone 后能直接打开工程；
源包/配置变了，先跑同步再提交。

## 场景与脚本

| 场景 | 控制器 | 内容 |
|---|---|---|
| Boot | `BootController` | 平台适配器、配置加载、mock/服务端存档、占位图预加载 |
| Home | `HomeController` | 资源栏、宠物卡片、列表/繁殖/关卡/栖息地入口 |
| PetList | `PetListController` | 阶段筛选、状态图标、5×5 图鉴剪影、最佳基因 |
| PetDetail | `PetDetailController` | deriveStats 八项属性、基因、显性/隐性特质、血统、相性/克制、技能 |
| Breeding | `BreedingController` | 双亲、基因区间、近亲警告、成本、产蛋、孵化倒计时、领取 |
| Habitat | `HabitatController` | 槽位、收取/喂食/清洁/陪玩/升级/移出 |
| StageSelect | `StageSelectController` | 关卡解锁、敌方与克制、编队（复用 `ui/lineupEditor`）、开战 |
| Battle | `BattleController` | BattleEngine 本地演出、手动/自动指令、结算 |
| PvpDefense | `PvpDefenseController` | 防守 1~3 只、快照时间/24h、stale、保存 |
| PvpOpponent | `PvpOpponentController` | 对手概览、isBot 标记、剩余次数、刷新、更换编队、开战 |
| PvpResult | `PvpResultController` | 胜负/平、回合数、双方 rating 变化、replayId；错误码分支 |
| PvpReplay | `PvpReplayController` | 只播 events；播放/暂停/倍速/跳到结算 |
| Leaderboard | `LeaderboardController` | 段位/图鉴/最佳基因/世代四 tab、前 N + self |

- 场景 Canvas 上各挂一个控制器组件；组件 `__type__` 是脚本 meta uuid 的 **23 位**压缩 class id（P-113）。
- 修改场景建议用编辑器保存，避免手写 id 不一致。
- 设计分辨率只放工程设置，不要运行时调 `view.setDesignResolutionSize`（P-115）。

## 数据与动作

- `services/config.ts`：`resources.load` 12 份配置 → `createConfigRepo`；Boot 时加载一次。
- `dev/mockProfile.ts`：`createPet` 建三只蛋（水龟公 / 雷鱼母 / 草蛙），再 `advanceProfile` 推到成年。
- `services/habitatActions.ts`：栖息地动作；`remote.mode === 'mock'` 用 core，`server` 走 `ROUTES` 并用 `applyProfilePatch` 合并 patch。
- `services/battleActions.ts`：
  - 开战：server 先保存编队 + `POST /battle/pve/start`；mock 用 `buildPveBattleSetup`。
  - 结算：server `POST /battle/pve/claim`（完整有序 commands）→ `applyProfilePatch`；
    mock `runBattle` + `applyPveRewards`。
- `services/breedingActions.ts`：
  - server `POST /breeding/start|claim` → `applyProfilePatch`；
  - mock `startBreeding` / `claimBreeding`；蛋到 `bornAt + hatchMs` 后调 `advanceProfile` 一次。
- `BreedingController` 的倒计时按**客户端配置**的 hatchMs 计算；正式环境两端 contentVersion 应一致。
- `services/petActions.ts`：放生/锁定/改名。
  - 改名前本地校验 1~12 字与字符集（`services/petName.ts`），服务端模式调 `/pets/:id/rename`；
  - 放生前置：蛋 / 锁定 / 编队 / 防守 / 最后一只成年本地先提示；栖息地中的宠物由动作自动 `/habitat/move` 移出后再放生；
  - 服务端模式仍会发一次请求，展示 `EGG_NOT_RELEASABLE` / `PET_LOCKED` / `PET_IN_USE` / `LAST_ADULT` 的权威错误；
  - 二次确认展示预计返还基因尘（core 计算），成功后 `applyProfilePatch`；**core 只返回 refund，离线动作自行入账（P-119）**。
- `services/pvpActions.ts` + `dev/mockPvp.ts`（contract-v1.6 §7.5）：
  - server 模式：`GET /pvp/defense`、`POST /pvp/defense`、`GET /pvp/opponent`、`POST /pvp/fight`、`GET /pvp/replay/:id`、`GET /leaderboard`；
  - mock 模式：防守快照/24h stale、机器人/真人混合匹配、core `buildBattleSetup` + `BattleEngine.autoCommand` 真实模拟、Elo（只在 mock 结算层）、日报 10 次、战报保存 events；
  - 所有动作带去重 guard；`fight` 失败写入 store，由结果页按 `DAILY_LIMIT_REACHED / OPPONENT_UNAVAILABLE / REPLAY_EXPIRED` 展示；
  - 回放只读 `replay.events`，不重新模拟、不覆盖结果。
- `services/localSave.ts`：本地存档缓存（key `petbattle.profile.v1`，`schemaVersion=1`，存 `{ profile, revision, savedAt }`）。
  - 只存 profile，不存 token/密钥；
  - mock 启动优先读本地并 `advanceProfile` 到当前时间；结构异常/schema 不符清理并新建；
  - 时钟回拨导致推进失败时**保留原档**（P-120）；
  - server 登录/同步/409 都会以服务器档覆盖本地；每次 `store.setProfile` 自动写回。
- 开发故障注入（读取后自动清除，一次性）：
  - `petbattle.simulateBattleFault`：下一次 PvE 结算失败（`BATTLE_EXPIRED` / `BATTLE_NOT_FOUND` / `VALIDATION_FAILED`）；
  - `petbattle.simulatePvpFault`：下一次对应 PvP 动作失败（`DAILY_LIMIT_REACHED` / `OPPONENT_UNAVAILABLE` / `REPLAY_EXPIRED` / `PET_IN_USE` / `VALIDATION_FAILED`）；只有匹配的动作会消费（`PET_IN_USE` 同时覆盖编队保存与防守保存），Home 概览不会吞掉故障。
  - 例：`localStorage.setItem('petbattle.simulatePvpFault', JSON.stringify('DAILY_LIMIT_REACHED'))`。

## mock / server 切换

`DEV_CONFIG.useServer` 默认 false。为在同一个构建里验证两条路径，Boot 还会读取平台存储覆盖：

```js
localStorage.setItem('petbattle.useServer', JSON.stringify(true));
localStorage.setItem('petbattle.apiBaseUrl', JSON.stringify('http://127.0.0.1:8126')); // 同源代理或服务端地址
// 然后刷新页面
```

- 正式包应把 `DEV_CONFIG.allowRuntimeStorageOverrides` 设为 false。
- 服务端为内存模式时可用 `PETBATTLE_STORE=memory PETBATTLE_CORE_STUB=strict PETBATTLE_CONFIG_DIR=file:///...` 本地起。

## 占位图

ART_SPEC §8.3：基础尺寸色块 + 1px 描边 + 文字标签（文字用 Label 叠加）。
**纯色底图必须无描边**（`white.png`），否则拉伸成大面板会出现粗边框（P-117）。
`gen-placeholders.mjs` 生成 96×96 宠物/剪影、256×256 立绘、48×48 蛋、32×32 图标、8×8 无边框白图；
导入设置已改为 nearest、无 mipmap、无压缩，运行时 `ui/placeholders.ts` 再强制一次 NEAREST（P-109）。

## 当前状态与已知限制

- mock：PvE 完整流程、繁殖、PvP 全链路（防守→匹配→fight→结果→回放→四榜）均可跑。
- server：已实测 guest 登录、编队保存、PvE start/claim、繁殖 start/claim；M1 阶段放生成功 + 蛋/锁定/最后成年拒绝。
- **M2-A/B（本批）**：UI kit/三态/安全区、构建固定、列表虚拟化、改名、编队组件、PvP 五页已完成；
  server 模式已接通 `/pvp/*` 与 `/leaderboard`，两账号验收（防守→匹配→fight→回放→四榜、B 反打 A、机器人兜底、日报/快照/回放 TTL）通过。
- 列表虚拟化：PetList / 防守/编队选择只实例化视口内的行；40 只时实测仅 4 个 `virtual-row-*` 节点。
- 构建：debug web-mobile 7.23 MB / wechatgame 6.46 MB；release web-mobile 3.63 MB / wechatgame 3.14 MB（均未压缩）。
- 限制：release 未压缩微信包 3.14 MB 仍大于 2 MB，正式提审前按 M3-06 做压缩/分包；`touristappid` 只用于模板，正式上传用 `--appid=`。微信开发者工具预览已跑通（P-127），真机交互待扫码；体验版需在微信后台设版本并加体验成员。
- 中文正文使用系统字体在原生分辨率渲染，不做低分辨率像素字（P-021）。
