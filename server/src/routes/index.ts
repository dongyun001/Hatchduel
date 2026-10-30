/** 路由注册总入口；新增端点在这里挂载，顺序不影响匹配（method + 段数都严格比较）。 */
import type { RouteHandler, ServerDeps } from '../http/context.js';
import type { Router } from '../http/router.js';
import { registerAuthRoutes } from './auth.routes.js';
import { registerBattleRoutes } from './battle.routes.js';
import { registerBreedingRoutes } from './breeding.routes.js';
import { registerHabitatRoutes } from './habitat.routes.js';
import { registerLineupRoutes } from './lineup.routes.js';
import { registerPetRoutes } from './pets.routes.js';
import { registerProfileRoutes } from './profile.routes.js';

export function registerRoutes(router: Router<RouteHandler>, deps: ServerDeps): void {
  registerAuthRoutes(router, deps);
  registerProfileRoutes(router, deps);
  registerPetRoutes(router, deps);
  registerLineupRoutes(router, deps);
  registerHabitatRoutes(router, deps);
  registerBattleRoutes(router, deps);
  registerBreedingRoutes(router, deps);
}
