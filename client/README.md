# client/ —— Cocos Creator 工程（由 B 会话创建）

本目录目前**还不是一个可打开的 Cocos 工程**。之前的像素废稿已按项目决定移除（需要时从 git 历史 `contract-v1` 之前的提交取回，或按 `docs/ART_SPEC.md` 重新产出）。

## 为什么没有工程文件

M0 契约会话（0 号）所在机器没有安装 Cocos Creator，无法生成合法的 `.meta` / `project.json` / `settings/`；
按 `docs/COLLABORATION.md` §2.1 的约定，不为了等 Cocos 阻塞契约冻结。

## B 会话开工第一件事

1. 用 **Cocos Creator 3.x LTS** 在 `client/` 创建空工程（横屏，设计分辨率 1920×1080）。
2. 建 `Boot` 空场景并提交；先跑通编辑器 + 构建 WeChat / Web 的空包。
3. 工程设置按 `docs/ART_SPEC.md` §1：Point 过滤、无 mipmap、无纹理压缩、整数缩放。
4. 把 `packages/core`、`packages/protocol` 同步/引用到 `client/assets/lib/`（构建前脚本复制，单向依赖，PITFALLS P-103）。
5. 在 `docs/COLLABORATION.md` §3 登记新增目录后再开工。

## 硬性约束

- `client/` **不进入 pnpm workspace**（`pnpm-workspace.yaml` 不包含它）。
- `assets/scripts/app/**` 禁止直接调 `wx.*`，统一走 `platform/` 适配器；ESLint 已配置该规则。
- 不复制 `@petbattle/core` / `@petbattle/protocol` 的类型，统一 import。
- 同一时间只允许一个会话打开 Cocos Creator；`temp/`、`library/`、`build/`、`profiles/`、`native/` 已在 `.gitignore`。
- 中文正文用系统字体在原生分辨率渲染，不做低分辨率中文像素字（ART_SPEC §1）。

## 美术资源

M0 的像素草稿已全部废弃并移除。后续按 `docs/ART_SPEC.md` 重新产出，命名规范见该文档 §6。
美术不属于本轮并行开发范围，B 用同尺寸占位图跑通布局即可（ART_SPEC §8.3）。
