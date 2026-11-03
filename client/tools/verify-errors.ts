/* global console, process */
/**
 * 错误码文案/重开路径的静态回归（不依赖 Cocos/服务端）。
 * 运行：pnpm exec tsx client/tools/verify-errors.ts
 */
import { apiErrorText } from '../assets/scripts/services/errors';
import type { ApiErrorCode } from '../assets/lib/protocol';

const CASES: Array<{ code: ApiErrorCode; mustContain: string }> = [
  { code: 'BATTLE_EXPIRED', mustContain: '过期' },
  { code: 'BATTLE_NOT_FOUND', mustContain: '重开' },
  { code: 'VALIDATION_FAILED', mustContain: '参数' },
  { code: 'EGG_NOT_READY', mustContain: '孵化' },
  { code: 'EGG_NOT_RELEASABLE', mustContain: '蛋' },
  { code: 'PET_LOCKED', mustContain: '锁定' },
  { code: 'PET_IN_USE', mustContain: '使用' },
  { code: 'LAST_ADULT', mustContain: '成年' },
  { code: 'REVISION_CONFLICT', mustContain: '冲突' },
  { code: 'DAILY_LIMIT_REACHED', mustContain: '次数' },
  { code: 'OPPONENT_UNAVAILABLE', mustContain: '对手' },
  { code: 'REPLAY_EXPIRED', mustContain: '战报' },
];

let failed = 0;
for (const item of CASES) {
  const text = apiErrorText(item.code);
  if (!text.includes(item.mustContain)) {
    console.error(`FAIL ${item.code}: "${text}" 不含 "${item.mustContain}"`);
    failed += 1;
  } else {
    console.log(`PASS ${item.code}: ${text}`);
  }
}

if (failed > 0) process.exit(1);
console.log(`PASS 全部 ${CASES.length} 个错误码文案`);
