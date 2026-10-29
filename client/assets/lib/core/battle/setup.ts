// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
/**
 * 战斗输入构建（DOMAIN_MODEL §9、§9.4）。
 *
 * - `buildBattleSetup` 只读个体快照 + 配置，不读全局状态；uid 固定为 `a0/a1/a2`、`b0/b1/b2`。
 * - `buildEnemyTeam` 由关卡配置确定性生成敌方 `BattleUnitInit[]`：同一 stage/seed 必然同一队伍；
 *   敌方按满状态（condition = 100）计算；技能固定为 [普攻, 属性小技能, 属性大招, 物种技能]。
 */
import type { ConfigRepo, StageConfig } from '../config/types';
import { computeStats, deriveStatsImpl } from '../stats';
import type { PetInstance } from '../types/pet';
import type { BattleSetup, BattleUnitInit } from '../types/battle';
import type { StatKey } from '../types/stats';

const MAX_TEAM_SIZE = 3;

type StatMods = Partial<Record<StatKey, number>>;

function uidFor(team: 0 | 1, slot: number): string {
  return `${team === 0 ? 'a' : 'b'}${slot}`;
}

function traitMods(cfg: ConfigRepo, traits: readonly string[]): StatMods[] {
  const mods: StatMods[] = [];
  for (const traitId of traits) {
    const trait = cfg.allTraits().find((item) => item.id === traitId);
    if (trait?.statMods) mods.push(trait.statMods);
  }
  return mods;
}

function passiveMods(cfg: ConfigRepo, passiveId: string | undefined): StatMods[] {
  if (!passiveId) return [];
  const passive = cfg.passive(passiveId);
  return passive.statMods ? [passive.statMods] : [];
}

export function buildBattleSetupImpl(
  teams: readonly [readonly PetInstance[], readonly PetInstance[]],
  cfg: ConfigRepo,
  seed: number,
): BattleSetup {
  const teamInits = teams.map((pets, teamIndex) =>
    pets.slice(0, MAX_TEAM_SIZE).map((pet, slot) => {
      const species = cfg.species(pet.speciesId);
      return {
        uid: uidFor(teamIndex === 0 ? 0 : 1, slot),
        petId: pet.id,
        speciesId: pet.speciesId,
        elementId: pet.elementId,
        level: pet.level,
        stats: deriveStatsImpl(pet, cfg),
        skills: cfg.skillsFor(pet),
        traits: [...pet.traits],
        ...(species.passiveId ? { passiveId: species.passiveId } : {}),
      } satisfies BattleUnitInit;
    }),
  );

  const first = teamInits[0] ?? [];
  const second = teamInits[1] ?? [];
  return { seed, teams: [first, second] };
}

function normalSkillId(cfg: ConfigRepo): string {
  const normal = cfg.allSkills().find((skill) => skill.kind === 'normal');
  if (!normal) throw new Error('@petbattle/core: 配置缺少普攻技能（kind = "normal"）');
  return normal.id;
}

export function buildEnemyTeamImpl(
  stage: StageConfig,
  cfg: ConfigRepo,
  _seed: number,
): BattleUnitInit[] {
  const normalId = normalSkillId(cfg);

  return stage.enemies.map((enemy, index) => {
    const species = cfg.species(enemy.speciesId);
    const element = cfg.element(enemy.elementId);
    const geneQuality = Math.max(0, Math.min(100, enemy.geneQuality));

    const stats = computeStats({
      base: species.base,
      growth: species.growth,
      level: enemy.level,
      stage: 'adult',
      gene: { hp: geneQuality, atk: geneQuality, def: geneQuality, spd: geneQuality },
      condition: { hunger: 100, mood: 100, hygiene: 100, health: 100 },
      affinity: cfg.affinity(enemy.elementId, enemy.speciesId),
      traitMods: traitMods(cfg, enemy.traits),
      passiveMods: passiveMods(cfg, species.passiveId),
    });

    return {
      uid: `b${index}`,
      petId: `enemy_${stage.id}_${index}`,
      speciesId: enemy.speciesId,
      elementId: enemy.elementId,
      level: enemy.level,
      stats,
      skills: [normalId, element.skillPool[0], element.skillPool[1], species.signatureSkillId],
      traits: [...enemy.traits],
      ...(species.passiveId ? { passiveId: species.passiveId } : {}),
    } satisfies BattleUnitInit;
  });
}
