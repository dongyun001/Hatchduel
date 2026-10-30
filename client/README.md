# client/ —— Cocos Creator 3.8.8 工程（B 会话）

横屏 2D 工程，设计分辨率 **1920×1080**，虚拟像素基准 **640×360**（3× 整数放大）。
当前 M1 第二批：Boot / Home / PetList / PetDetail / Breeding / Habitat 六个场景可点；
离线 mock 存档由 core 的 `createPet` + `advanceProfile` 生成，不依赖服务端。

## 打开工程

1. 用本机 Cocos Creator **3.8.8** 打开 `client/`（`C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe`）。
2. 同一时间只允许一个会话打开编辑器（PITFALLS P-102）。
3. 首次打开会自动导入 `assets/`，生成 `library/`、`temp/`（均已 gitignore）。

## 目录

```
client/
  assets/
    scenes/                  Boot / Home / PetList / PetDetail / Breeding / Habitat
    scripts/
      app/                   各场景控制器、store、navigation、storeScene 壳
      platform/              wechat / web / steam 适配器；wx.* 只允许出现在这里
      services/              ApiClient、bootstrap、config（运行时配置）、habitatActions
      dev/                   DEV_CONFIG、mock profile、离线 clone/rng、mock 动作说明
      ui/                    theme / nodes / screens / sceneView / placeholders
    lib/                     **生成物**：从 packages/core、packages/protocol 同步
    resources/
      config/                **生成物**：从 core/src/config/data 同步的 12 份 JSON
      placeholders/          同尺寸占位图（96×96 宠物、256×256 立绘、48×48 蛋、32×32 图标）
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

# 重新生成占位图
node client/tools/gen-placeholders.mjs

# 构建（CLI；退出码 36 表示成功）
"C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe" \
  --project "D:/github-mine/petbattle-client/client" \
  --build "platform=wechatgame;debug=true"
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
| Home | `HomeController` | 资源栏、3 只宠物卡片、进入列表/繁殖/栖息地 |
| PetList | `PetListController` | 阶段筛选、状态图标、5×5 图鉴剪影、最佳基因 |
| PetDetail | `PetDetailController` | deriveStats 八项属性、基因、显性/隐性特质、血统、相性/克制、技能 |
| Breeding | `BreedingController` | 双亲选择、基因区间、近亲警告、成本、离线产蛋 |
| Habitat | `HabitatController` | 槽位、收取/喂食/清洁/陪玩/升级/移出；服务端模式走 ROUTES |

- 场景 Canvas 上各挂一个控制器组件；组件 `__type__` 是脚本 meta uuid 的 **23 位**压缩 class id
  （前 5 位 hex 保留 + 每 3 个 hex 编码为 2 个 base64），不是 22 位资源格式（P-113）。
- 修改场景建议用编辑器保存，避免手写 id 不一致。
- 设计分辨率只放工程设置，不要运行时调 `view.setDesignResolutionSize`（P-115）。

## 数据与动作

- `services/config.ts`：`resources.load` 12 份配置 → `createConfigRepo`；Boot 时加载一次，失败直接报错。
- `dev/mockProfile.ts`：`createPet` 建三只蛋（水龟公 / 雷鱼母 / 草蛙），放进草甸后
  `advanceProfile(profile, now)` 推到成年并结算一次产出；不再字面构造 `PetInstance`。
- `services/habitatActions.ts`：栖息地写操作的唯一入口。
  - `remote.mode === 'mock'`：调用 core 的 `collectHabitat/feedPet/cleanPet/playWithPet/upgradeHabitat/movePetToHabitat`；
  - `remote.mode === 'server'`：走 `ApiClient` 的 ROUTES 方法，成功后再 `GET /profile` 拉全量
    （`applyProfilePatch` 尚未落地，contract-v1.4 D-16）。
- `BreedingController`：校验用 `checkBreeding`/`isInbred`，产蛋用 core `breed` + 本地 Rng；
  **这是 mock**，等 C 的 `/breeding/start` 就绪后换成 ApiClient，不重写公式。
- 409 处理：`ApiClient` 优先用 `error.details.latestProfile` 重建；details 缺失时才回退拉全量。

## 占位图

ART_SPEC §8.3：基础尺寸色块 + 1px 描边 + 文字标签（文字用 Label 叠加，不烘焙进图片）。
`gen-placeholders.mjs` 生成 96×96 宠物/剪影、256×256 立绘、48×48 蛋、32×32 图标、8×8 白图；
导入设置已改为 nearest、无 mipmap、无压缩，运行时 `ui/placeholders.ts` 还会再强制一次 NEAREST（P-109）。
替换正式资源时保持同名同尺寸/pivot 即可。

## 当前状态与已知限制

- `DEV_CONFIG.useServer` 默认 `false`：Boot 直接用 core 生成的 mock profile。
- 服务端模式下栖息地动作已接 `ROUTES`；但 C 的 `/habitat/*` 与 `/breeding/*` 尚未全部可用，
  离线路径才是当前默认可跑路径。
- `ApiClient` 的 409/时间偏移用 `client/tools/verify-api-client.ts` 验证，不依赖真实服务端。
- 列表暂未做 ScrollView 虚拟化：最多显示 5 只，超出提示“还有 N 只未显示”。
- 中文正文使用系统字体在原生分辨率渲染，不做低分辨率像素字（P-021）。
