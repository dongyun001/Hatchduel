# client/ —— Cocos Creator 3.8.8 工程（B 会话）

横屏 2D 工程，设计分辨率 **1920×1080**，虚拟像素基准 **640×360**（3× 整数放大）。
当前 M1 第三批：Boot / Home / PetList / PetDetail / Breeding / Habitat / StageSelect / Battle 八个场景；
PvE 战斗与繁殖支持 **mock / server 双路径**，UI 流程一致。

## 打开工程

1. 用本机 Cocos Creator **3.8.8** 打开 `client/`（`C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe`）。
2. 同一时间只允许一个会话打开编辑器（PITFALLS P-102）。
3. 首次打开会自动导入 `assets/`，生成 `library/`、`temp/`（均已 gitignore）。

## 目录

```
client/
  assets/
    scenes/                  Boot / Home / PetList / PetDetail / Breeding / Habitat / StageSelect / Battle
    scripts/
      app/                   各场景控制器、store、navigation、SceneView 壳
      platform/              wechat / web / steam 适配器；wx.* 只允许出现在这里
      services/              ApiClient、bootstrap、config、habitat/battle/breeding actions、errors
      dev/                   DEV_CONFIG、mock profile、本地 clone/rng
      ui/                    theme / nodes / screens / sceneView / placeholders
    lib/                     **生成物**：从 packages/core、packages/protocol 同步
    resources/
      config/                **生成物**：从 core/src/config/data 同步的 12 份 JSON
      placeholders/          同尺寸占位图（96×96 宠物/剪影、256×256 立绘、48×48 蛋、32×32 图标）
  settings/v2/packages/      工程设置（设计分辨率、2D 模块裁剪）
  tools/                     同步、类型检查、占位图生成、ApiClient 验证
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

# 验证错误码文案（BATTLE_EXPIRED / EGG_NOT_READY / 放生拒绝等）
pnpm exec tsx client/tools/verify-errors.ts

# 重新生成占位图
node client/tools/gen-placeholders.mjs

# 构建（CLI；退出码 36 表示成功）
# 必须带 startScene=<Boot uuid>，否则新增场景会改变默认启动场景（P-118）
"C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe" \
  --project "D:/github-mine/petbattle-client/client" \
  --build "platform=wechatgame;debug=true;startScene=a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
# 预览可把 platform 换成 web-mobile，产物在 client/build/<platform>/
```

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
| StageSelect | `StageSelectController` | 关卡解锁、敌方与克制、编队、开战 |
| Battle | `BattleController` | BattleEngine 本地演出、手动/自动指令、结算 |

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
- `services/petActions.ts`：放生/锁定。
  - 放生前置：蛋 / 锁定 / 编队 / 防守 / 最后一只成年本地先提示；栖息地中的宠物由动作自动 `/habitat/move` 移出后再放生；
  - 服务端模式仍会发一次请求，展示 `EGG_NOT_RELEASABLE` / `PET_LOCKED` / `PET_IN_USE` / `LAST_ADULT` 的权威错误；
  - 二次确认展示预计返还基因尘（core 计算），成功后 `applyProfilePatch`；**core 只返回 refund，离线动作自行入账（P-119）**。
- `services/localSave.ts`：本地存档缓存（key `petbattle.profile.v1`，`schemaVersion=1`，存 `{ profile, revision, savedAt }`）。
  - 只存 profile，不存 token/密钥；
  - mock 启动优先读本地并 `advanceProfile` 到当前时间；结构异常/schema 不符清理并新建；
  - 时钟回拨导致推进失败时**保留原档**（P-120）；
  - server 登录/同步/409 都会以服务器档覆盖本地；每次 `store.setProfile` 自动写回。
- 开发故障注入：`localStorage.setItem('petbattle.simulateBattleFault', JSON.stringify('BATTLE_EXPIRED'))`，
  下一次 PvE 结算会失败并显示「重开」；读取后自动清除（一次性）。

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

- mock：PvE 完整流程（开始→手动/自动→结算→首通奖励/关卡解锁）、繁殖（产蛋→倒计时→领取）均可跑。
- server：已实测 guest 登录、编队保存、PvE start/claim（服务端重放 33 条指令、8 回合胜利）、繁殖 start/claim。
- 放生已做服务端成功 + 蛋/锁定/最后成年三种拒绝；「在编队/防守」的拒绝依赖服务端，未单独构造。
- 列表最多显示 5 只，未做 ScrollView 虚拟化。
- 编队选择在 StageSelect 内完成（1~3 只、非蛋），服务端模式会先 `POST /lineup/set`。
- PvP/排行榜/好友不在本批范围；宠物改名 UI 未做（锁定/放生已接）。
- 中文正文使用系统字体在原生分辨率渲染，不做低分辨率像素字（P-021）。
