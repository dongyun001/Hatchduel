/**
 * core 桥接层：服务端唯一的领域入口。
 *
 * 规则（AGENTS §3.3 / CONTRACT §8.3）：
 * - 时间推进、繁殖、战斗、经济一律调用 `@petbattle/core`，服务端不重写；
 * - core 尚未实现时（M1 早期，A 还在补）允许“恒等推进”，否则所有写操作都会 501，
 *   登录/改名等与领域无关的契约测试跑不起来；
 * - 恒等推进**不伪造**任何领域结果：不改宠物、不产资源，只把 patch 的 revision/时间补齐；
 * - 可通过 `PETBATTLE_CORE_STUB=strict` 关闭降级，让未实现直接暴露为 501。
 */
import {
  BattleEngine,
  CoreNotImplementedError,
  advancePet as coreAdvancePet,
  advanceProfile as coreAdvanceProfile,
  applyPveRewards as coreApplyPveRewards,
  applyPvpOutcome as coreApplyPvpOutcome,
  buildDefenseSnapshot as coreBuildDefenseSnapshot,
  buildPveBattleSetup as coreBuildPveBattleSetup,
  buildPvpBattleSetup as coreBuildPvpBattleSetup,
  claimBreeding as coreClaimBreeding,
  cleanPet as coreCleanPet,
  collectHabitat as coreCollectHabitat,
  createPet as coreCreatePet,
  feedPet as coreFeedPet,
  movePetToHabitat as coreMovePetToHabitat,
  playWithPet as corePlayWithPet,
  releasePet as coreReleasePet,
  runBattle as coreRunBattle,
  startBreeding as coreStartBreeding,
  upgradeHabitat as coreUpgradeHabitat,
} from '@petbattle/core';
import type {
  AdvancePetResult,
  BattleEvent,
  BattleSetup,
  BattleUnitInit,
  BattleWinner,
  BreedingConfig,
  ClaimBreedingResult,
  Command,
  ConfigRepo,
  CreatePetInput,
  DefenseSnapshot,
  EpochMs,
  HabitatId,
  Id,
  PetId,
  PetInstance,
  Profile,
  ProfilePatch,
  PveRewardContext,
  PveRewardResult,
  PvpOutcome,
  PvpOutcomeResult,
  ReleaseResult,
  Rng,
  StageConfig,
  StartBreedingResult,
} from '@petbattle/core';

import { AppError } from '../errors.js';
import type { Logger } from '../logger.js';
import { identityPatch } from './patch.js';

export interface AdvanceResult {
  profile: Profile;
  patch: ProfilePatch;
  /** true 表示这次没有真正推进（core 仍是契约桩，或配置仓库不可用）。 */
  degraded: boolean;
}

/** 栖息地操作统一返回；`patch` 的 revision 由服务端写操作覆写（DOMAIN §15.7）。 */
export interface HabitatOpResult {
  profile: Profile;
  patch: ProfilePatch;
}

export interface CoreAdapter {
  advanceProfile(profile: Profile, now: EpochMs): AdvanceResult;
  /** 放生：拒绝原因由 core 抛 `ReleaseError`，服务端按 reason 映射错误码。 */
  releasePet(profile: Profile, petId: PetId, now: EpochMs): ReleaseResult;

  // 栖息地操作（contract-v1.3 D-12）：失败抛 `name='HabitatError'` 的 Error，按 code 映射。
  movePetToHabitat(
    profile: Profile,
    petId: PetId,
    habitatId: HabitatId | null,
    now: EpochMs,
  ): HabitatOpResult;
  feedPet(profile: Profile, petId: PetId, foodId: Id, now: EpochMs): HabitatOpResult;
  cleanPet(profile: Profile, petId: PetId, now: EpochMs): HabitatOpResult;
  playWithPet(profile: Profile, petId: PetId, now: EpochMs): HabitatOpResult;
  upgradeHabitat(profile: Profile, habitatId: HabitatId, now: EpochMs): HabitatOpResult;
  collectHabitat(profile: Profile, habitatId: HabitatId, now: EpochMs): HabitatOpResult;

  // PvE 与繁殖（contract-v1.5）。
  /** 全部关卡配置（按 order 排序由调用方处理），用于解锁校验与奖励档查找。 */
  allStages(): readonly StageConfig[];
  buildPveBattleSetup(party: readonly PetInstance[], stage: StageConfig, seed: number): BattleSetup;
  /** 从零重放；失败抛 `BattleReplayError`（invalid_command / not_finished）。 */
  runBattle(
    setup: BattleSetup,
    commands: readonly Command[],
  ): { winner: BattleWinner; turns: number; events: BattleEvent[] };
  applyPveRewards(
    profile: Profile,
    stage: StageConfig,
    ctx: PveRewardContext,
    now: EpochMs,
  ): PveRewardResult;
  /** 失败抛 `BreedingError`（reason 见 CONTRACT §7.4 E-01/§8.3）。 */
  startBreeding(
    profile: Profile,
    parentAId: PetId,
    parentBId: PetId,
    now: EpochMs,
    rng: Rng,
  ): StartBreedingResult;
  /** 失败抛 `BreedingClaimError`。 */
  claimBreeding(profile: Profile, eggId: PetId, now: EpochMs): ClaimBreedingResult;

  // 异步 PvP（contract-v1.6 F-09）。
  /** 建个体；机器人阵容与测试用。 */
  createPet(input: CreatePetInput): PetInstance;
  /** 推进单只宠物（阶段/状态/冷却）；机器人需要从出生时间推进到成年。 */
  advancePet(pet: PetInstance, now: EpochMs): AdvancePetResult;
  breedingConfig(): BreedingConfig;
  contentVersion(): string;
  /** 物种展示名（机器人 `训练师·<物种>`）。 */
  speciesName(speciesId: Id): string;
  /** 把本人宠物定格成防守快照；失败抛 `DefenseError`。 */
  buildDefenseSnapshot(profile: Profile, petIds: readonly PetId[], now: EpochMs): DefenseSnapshot;
  /** team0 = 攻方、team1 = 防守快照；不改入参数组。 */
  buildPvpBattleSetup(
    attackerPets: readonly PetInstance[],
    defenseUnits: readonly BattleUnitInit[],
    seed: number,
  ): BattleSetup;
  /** 双方都用 core 内置 `autoCommand`；返回实际执行的指令与完整事件流。 */
  simulatePvp(setup: BattleSetup): {
    commands: Command[];
    events: BattleEvent[];
    winner: BattleWinner;
    turns: number;
  };
  /** 只改 pvp/stats；Elo 已在服务端算好并传入 `ratingAfter`。 */
  applyPvpOutcome(profile: Profile, outcome: PvpOutcome): PvpOutcomeResult;

  /** 是否曾经降级过；用于日志告警与运维排查。 */
  readonly degraded: boolean;
}

/** 与 PvE 相同的指令上限：30 回合 × 双方各 3 只，留余量防死循环。 */
const MAX_PVP_COMMANDS = 600;

export interface CoreAdapterOptions {
  allowStub: boolean;
  logger: Logger;
  /** A 的 `createConfigRepo` 可用时传入；null 表示配置仓库不可用。 */
  configRepo?: ConfigRepo;
}

export function createCoreAdapter(options: CoreAdapterOptions): CoreAdapter {
  let degraded = false;
  let warned = false;

  const warnOnce = (reason: string): void => {
    degraded = true;
    if (warned) return;
    warned = true;
    options.logger.warn(
      '领域推进降级为恒等推进（仅用于契约联调；PETBATTLE_CORE_STUB=strict 可关闭）',
      {
        reason,
      },
    );
  };

  /** 放生/繁殖这类必须读配置的操作没有降级余地：没配置就直接报配置错误。 */
  const requireRepo = (): ConfigRepo => {
    const repo = options.configRepo;
    if (repo === undefined) {
      throw new AppError('CONFIG_INVALID', '配置仓库不可用，无法执行需要配置的领域操作');
    }
    return repo;
  };

  return {
    advanceProfile(profile, now) {
      const repo = options.configRepo;
      if (repo === undefined) {
        // strict 模式必须暴露失败，不能静默降级（CONTRACT §8.3：生产不允许假推进）。
        if (!options.allowStub) {
          throw new CoreNotImplementedError('createConfigRepo（配置仓库不可用）');
        }
        warnOnce('配置仓库不可用（createConfigRepo 尚未实现或配置目录缺失）');
        return { profile, patch: identityPatch(profile, now), degraded: true };
      }

      try {
        const result = coreAdvanceProfile(profile, now, repo);
        return { profile: result.profile, patch: result.patch, degraded: false };
      } catch (error) {
        if (!(error instanceof CoreNotImplementedError)) throw error;
        if (!options.allowStub) throw error;
        warnOnce('core.advanceProfile 尚未实现');
        return { profile, patch: identityPatch(profile, now), degraded: true };
      }
    },

    releasePet(profile, petId, now) {
      return coreReleasePet(profile, petId, now, requireRepo());
    },

    movePetToHabitat(profile, petId, habitatId, now) {
      return coreMovePetToHabitat(profile, petId, habitatId, now, requireRepo());
    },

    feedPet(profile, petId, foodId, now) {
      return coreFeedPet(profile, petId, foodId, now, requireRepo());
    },

    cleanPet(profile, petId, now) {
      return coreCleanPet(profile, petId, now, requireRepo());
    },

    playWithPet(profile, petId, now) {
      return corePlayWithPet(profile, petId, now, requireRepo());
    },

    upgradeHabitat(profile, habitatId, now) {
      return coreUpgradeHabitat(profile, habitatId, now, requireRepo());
    },

    collectHabitat(profile, habitatId, now) {
      return coreCollectHabitat(profile, habitatId, now, requireRepo());
    },

    allStages() {
      return requireRepo().allStages();
    },

    buildPveBattleSetup(party, stage, seed) {
      return coreBuildPveBattleSetup(party, stage, requireRepo(), seed);
    },

    runBattle(setup, commands) {
      return coreRunBattle(setup, requireRepo(), commands);
    },

    applyPveRewards(profile, stage, ctx, now) {
      return coreApplyPveRewards(profile, stage, ctx, now, requireRepo());
    },

    startBreeding(profile, parentAId, parentBId, now, rng) {
      return coreStartBreeding(profile, parentAId, parentBId, now, requireRepo(), rng);
    },

    claimBreeding(profile, eggId, now) {
      return coreClaimBreeding(profile, eggId, now, requireRepo());
    },

    createPet(input) {
      return coreCreatePet(input, requireRepo());
    },

    advancePet(pet, now) {
      return coreAdvancePet(pet, now, requireRepo());
    },

    breedingConfig() {
      return requireRepo().breeding();
    },

    contentVersion() {
      return requireRepo().contentVersion;
    },

    speciesName(speciesId) {
      return requireRepo().species(speciesId).name;
    },

    buildDefenseSnapshot(profile, petIds, now) {
      return coreBuildDefenseSnapshot(profile, petIds, now, requireRepo());
    },

    buildPvpBattleSetup(attackerPets, defenseUnits, seed) {
      return coreBuildPvpBattleSetup(attackerPets, defenseUnits, requireRepo(), seed);
    },

    simulatePvp(setup) {
      const repo = requireRepo();
      const engine = BattleEngine.create(setup, repo);
      const commands: Command[] = [];

      while (engine.state.phase === 'ongoing') {
        if (commands.length >= MAX_PVP_COMMANDS) {
          throw new AppError('INTERNAL', `PvP 模拟指令超过上限 ${MAX_PVP_COMMANDS}`);
        }
        const actor = engine.state.order[engine.state.cursor];
        if (actor === undefined) {
          throw new AppError('INTERNAL', 'PvP 模拟找不到当前行动单位');
        }
        const command = engine.autoCommand(actor);
        commands.push(command);
        engine.submit(command);
      }

      return {
        commands,
        events: [...engine.state.log],
        winner: engine.state.winner,
        turns: engine.state.turn,
      };
    },

    applyPvpOutcome(profile, outcome) {
      return coreApplyPvpOutcome(profile, outcome);
    },

    get degraded() {
      return degraded;
    },
  };
}
