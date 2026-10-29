/**
 * 测试用配置仓库：读真实的 `packages/core/src/config/data/`，不另造一套 fixture。
 * 这样 D 调数值时测试跟着走（PITFALLS P-042：不要写死配置数值）。
 */
import { createConfigRepo } from '@petbattle/core';
import type { ConfigRepo } from '@petbattle/core';

import { readConfigData, resolveConfigDir } from '../src/domain/config-provider.js';

let cached: Promise<ConfigRepo> | undefined;

export function testConfigRepo(): Promise<ConfigRepo> {
  cached ??= readConfigData(resolveConfigDir()).then((data) => createConfigRepo(data));
  return cached;
}
