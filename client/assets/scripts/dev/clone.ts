import type { Profile } from '../../lib/core';

/** Profile 是纯 JSON 数据；本地演示动作用深拷贝保证不原地改 store 里的对象。 */
export function cloneProfile(profile: Profile): Profile {
  return JSON.parse(JSON.stringify(profile)) as Profile;
}
