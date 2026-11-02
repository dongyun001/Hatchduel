# build-templates

构建产物在 `client/build/**`，不进 git；这里的模板是微信配置的**唯一来源**（P-123）。

| 文件 | 作用 |
|---|---|
| `wechatgame/game.json` | `deviceOrientation=landscape`、关闭状态栏；构建后由 `build.mjs` 合并进产物 |
| `wechatgame/project.config.json` | AppID（默认 `touristappid` 游客模式）、`setting.urlCheck=false` |

## 固定构建

```bash
node client/tools/build.mjs --platform=wechatgame --debug
node client/tools/build.mjs --platform=web-mobile --debug
```

- `startScene` 固定为 `db://assets/scenes/Boot.scene`（P-118），不随场景顺序漂移。
- 构建后脚本会强制写入横屏/AppID/urlCheck，并校验 `src/settings.json` 的 `launchScene`。
- 换正式 AppID：只改本目录 `project.config.json` 的 `appid`，重新构建即可，不要手改产物。
- 只验证后处理/产物配置（不跑 Cocos）：

```bash
node client/tools/build.mjs --platform=wechatgame --postprocess-only=client/build/wechatgame
```
