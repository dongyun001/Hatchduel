import type { ApiErrorCode } from '../../lib/protocol';

/**
 * 协议错误码 → 客户端文案。服务端 message 只用于日志，UI 一律按 code 本地化。
 * 未列出的 code 直接显示 code，避免误吞新错误。
 */
const CODE_TEXT: Partial<Record<ApiErrorCode, string>> = {
  UNAUTHENTICATED: '未登录',
  FORBIDDEN: '无权限',
  NOT_FOUND: '目标不存在',
  VALIDATION_FAILED: '请求参数不合法',
  REVISION_CONFLICT: '存档版本冲突，已刷新到最新档',
  IDEMPOTENCY_CONFLICT: '重复请求，请重试',
  RATE_LIMITED: '操作太频繁',
  TIME_BACKWARDS: '时间异常',
  NOT_IMPLEMENTED: '服务端尚未实现',
  INTERNAL: '服务器错误',
  CONFIG_INVALID: '服务端配置异常',
  INSUFFICIENT_RESOURCES: '资源不足',
  CAPACITY_FULL: '容量已满',
  COOLDOWN_ACTIVE: '还在冷却中',
  PET_NOT_FOUND: '宠物不存在',
  PET_LOCKED: '宠物已锁定',
  PET_IN_USE: '宠物正在使用中',
  EGG_NOT_RELEASABLE: '蛋不能放生',
  LAST_ADULT: '至少保留一只成年宠物',
  INVALID_LINEUP: '出战编队不合法（需要 1~3 只非蛋宠物）',
  STAGE_LOCKED: '关卡尚未解锁',
  BATTLE_NOT_FOUND: '战斗不存在，请重开',
  BATTLE_FINISHED: '战斗已结束',
  BATTLE_EXPIRED: '战斗已过期，请重开',
  ALREADY_CLAIMED: '奖励已领取',
  EGG_NOT_READY: '蛋还没孵化',
  DAILY_LIMIT_REACHED: '今日 PvP 次数已用完（每天 10 次）',
  OPPONENT_UNAVAILABLE: '对手不可用，请刷新后再试',
  REPLAY_EXPIRED: '战报已过期（保留 30 天）',
};

export function apiErrorText(code: ApiErrorCode | undefined): string {
  if (!code) return '未知错误';
  return CODE_TEXT[code] ?? code;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** core 抛出的领域错误（HabitatError / BreedingError / BattleReplayError…）统一取 message。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
