# client/ —— Cocos Creator 工程（由 B 会话创建）

本目录当前只有 `assets/art/` 的像素样张（E 会话产出，见 `docs/ART_SPEC.md`），**还不是一个可打开的 Cocos 工程**。

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

## 现有资源

```
client/assets/art/pets/turtle/water/
  pet_turtle_water_idle.png / .json / _00.._03.png
  preview_turtle_water_juvenile.png
client/assets/art/.src/gen_turtle.py
```

命名规范见 `docs/ART_SPEC.md` §6。
