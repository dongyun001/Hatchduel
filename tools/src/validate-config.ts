/**
 * `pnpm validate:config`
 *
 * 校验 packages/core/src/config/data 下的配置：结构、范围、引用完整性、语义。
 * 失败时逐条打印并以退出码 1 结束（CI 以此阻断）。
 */
import { validateConfig } from '@petbattle/core';

import { loadConfigBundle } from './load-config.js';

const bundle = loadConfigBundle();
const result = validateConfig(bundle);

if (!result.ok) {
  console.error(`配置校验失败：${result.issues.length} 项\n`);
  for (const issue of result.issues) {
    console.error(`- [${issue.code}] ${issue.path || '<root>'}: ${issue.message}`);
  }
  process.exit(1);
}

console.log('配置校验通过');
console.log(`  contentVersion: ${bundle.contentVersion}`);
console.log(`  species:   ${bundle.species.length}`);
console.log(`  elements:  ${bundle.elements.length}`);
console.log(`  skills:    ${bundle.skills.length}（主动 = skills 表，被动 = passives 表）`);
console.log(`  passives:  ${bundle.passives.length}`);
console.log(`  traits:    ${bundle.traits.length}`);
console.log(`  habitats:  ${bundle.habitats.length}`);
console.log(`  foods:     ${bundle.foods.length}`);
console.log(`  stages:    ${bundle.stages.length}`);
console.log('  数值为初版样例，待 sim 调参（docs/CONTRACT.md §8）。');
