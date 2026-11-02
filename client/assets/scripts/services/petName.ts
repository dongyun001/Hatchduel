/** 宠物名规则（UI-06）：1~12 字，仅中文/字母/数字/空格/`·_-`。 */
export const PET_NAME_MAX = 12;

const ALLOWED_NAME = /^[\p{L}\p{N} _·-]+$/u;

export interface NameValidation {
  ok: boolean;
  name: string;
  error?: string;
}

export function normalizePetName(raw: string): NameValidation {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, name, error: '名字不能为空' };
  if (Array.from(name).length > PET_NAME_MAX) {
    return { ok: false, name, error: `名字最多 ${PET_NAME_MAX} 个字` };
  }
  if (!ALLOWED_NAME.test(name)) {
    return { ok: false, name, error: '只能使用中文、字母、数字、空格和 ·_-' };
  }
  return { ok: true, name };
}
