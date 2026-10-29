# client/ —— Cocos Creator 3.8.8 工程（B 会话）

横屏 2D 工程，设计分辨率 **1920×1080**，虚拟像素基准 **640×360**（3× 整数放大）。
当前 M1 首批：Boot → Home → Habitat 三场景可点，离线 mock profile 可跑，不依赖服务端。

## 打开工程

1. 用本机 Cocos Creator **3.8.8** 打开 `client/`（`C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe`）。
2. 同一时间只允许一个会话打开编辑器（PITFALLS P-102）。
3. 首次打开会自动导入 `assets/`，生成 `library/`、`temp/`（均已 gitignore）。

## 目录

```
client/
  assets/
    scenes/                  Boot / Home / Habitat（场景与 .scene.meta）
    scripts/
      app/                   BootController / HomeController / HabitatController / store / navigation
      platform/              wechat / web / steam 适配器；wx.* 只允许出现在这里
      services/              ApiClient（ROUTES/ApiContract）、bootstrap
      dev/                   DEV_CONFIG、mock profile、离线演示动作
      ui/                    theme / nodes / screens / placeholders
    lib/                     **生成物**：从 packages/core、packages/protocol 同步
    resources/placeholders/  同尺寸占位图（96×96 宠物、32×32 图标、8×8 白图）
  settings/v2/packages/      工程设置（设计分辨率、2D 模块裁剪）
  tools/                     同步、类型检查、占位图生成脚本
```

## 命令（不进入 pnpm workspace，不碰根 lockfile）

```bash
# 构建前同步 core/protocol 到 assets/lib（单向，P-103）
node client/tools/sync-lib.mjs
node client/tools/sync-lib.mjs --check   # CI：不一致则退出 1

# 不打开编辑器做类型检查（使用 Cocos 安装目录里的 cc.d.ts）
node client/tools/typecheck.mjs
# 可用 COCOS_CREATOR_DIR 覆盖 Creator 安装目录

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

## assets/lib 同步规则

`sync-lib.mjs` 会：

1. 复制 `packages/core/src/**`、`packages/protocol/src/**` 的 `.ts` 到 `assets/lib/{core,protocol}`；
2. 去掉相对 import 的 `.js` 后缀（Cocos 用扩展名无关解析）；
3. 把 `@petbattle/core` 改写成指向 `assets/lib/core` 的相对路径；
4. 保留已有 `.meta`（避免每次同步更换 uuid），只清理源里已删除的 `.ts`；
5. 文件头加 `GENERATED FILE - DO NOT EDIT`。

`assets/lib/**` 是提交进仓库的生成物，保证 clone 后能直接打开工程；如果源包变了，先跑同步再提交。

## 场景与脚本

- 三个场景的 Canvas 上各挂一个控制器组件；组件 `__type__` 是脚本 meta uuid 的 **23 位** 压缩 class id（前 5 位 hex 保留 + 每 3 个 hex 编码为 2 个 base64），不是 22 位资源格式（P-113）。
- 修改场景建议用编辑器保存，避免手写 id 不一致。
- 场景 `Camera` 的 orthoHeight 由 Canvas 按窗口计算；不要运行时调 `view.setDesignResolutionSize`（P-115）。

## 占位图

ART_SPEC §8.3：基础尺寸色块 + 1px 描边 + 文字标签（文字用 Label 叠加，不烘焙进图片）。
`gen-placeholders.mjs` 生成 96×96 宠物、32×32 图标、8×8 白图；导入设置已改为 nearest、无 mipmap、无压缩，
运行时 `ui/placeholders.ts` 还会再强制一次 NEAREST（P-109）。
替换正式资源时保持同名同尺寸/pivot 即可。

## 当前状态与已知限制

- `DEV_CONFIG.useServer` 默认 `false`：Boot 直接用 mock profile（水龟公/雷鱼母成年、草蛙幼年）。
- `ApiClient` 已按 `ROUTES`/`ApiContract` 实现响应解析、幂等头、`X-Base-Revision`、409 拉全量；
  但 UI 目前只走离线 mock 动作，服务端写操作（`/habitat/*` 等）等 C 接好后再启用。
- Habitat 的收取/喂食是**本地演示**，不是业务规则；服务器模式下会被禁用。
- 中文正文使用系统字体在原生分辨率渲染，不做低分辨率像素字（P-021）。
