// GENERATED FILE - DO NOT EDIT.
// 由 client/tools/sync-lib.mjs 从 packages/{core,protocol}/src 同步并改写 import；
// 修改请改源包（所有者 A/0），然后重新运行同步脚本。
// 另：`[...new Set(x)]` 已改写为 Array.from（Cocos loose spread 兼容，P-116）。
/**
 * 回合制战斗引擎（DOMAIN_MODEL §9.3，AGENTS §3.5）。
 *
 * 设计要点：
 * - 指令驱动：`submit` 每次推进一步（当前行动者的一个动作），返回本步事件；
 *   回合切换、精力、DOT、buff 计时的结算并入同一次返回。
 * - 初始精力 0；每回合开始 +20；普攻命中 +10；技能扣 cost（先结算伤害，再结算精力）。
 * - 同速排序用「种子随机序」做 tiebreaker（P-004），禁止固定 0 队先手。
 * - 30 回合结束仍未分胜负 → `winner = null`（平局）。
 * - 纯函数 + 注入 rng：同 `(setup, seed, commands)` 必须逐事件一致。
 */
import {
  DAMAGE_FLOAT_MIN,
  DAMAGE_FLOAT_SPAN,
  DAMAGE_K,
  ENERGY_MAX,
  ENERGY_INITIAL,
  ENERGY_ON_NORMAL_HIT,
  ENERGY_PER_TURN,
  HIT_BASE,
  HIT_CLAMP_MAX,
  HIT_CLAMP_MIN,
  MAX_TURNS,
  SMALL_SKILL_ENERGY_MIN,
  ULTIMATE_ENERGY_MIN,
} from '../constants';
import type { ConfigRepo, EffectSpec, SkillConfig } from '../config/types';
import { mulberry32 } from '../rng';
import type { BattleBuff, BattleEvent, BattleSetup, BattleState, BattleUnit, BattleWinner, Command } from '../types/battle';
import type { Rng } from '../types/common';

const ORDER_SEED_XOR = 0x9e3779b9;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventPayload = DistributiveOmit<BattleEvent, 'seq' | 'turn'>;

export interface BattleContext {
  state: BattleState;
  cfg: ConfigRepo;
  rng: Rng;
  /** 同速 tiebreaker：由独立种子流生成的随机键（中立）。 */
  tiebreak: Map<string, number>;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function emit(ctx: BattleContext, payload: EventPayload): BattleEvent {
  const event = { seq: ctx.state.log.length + 1, turn: ctx.state.turn, ...payload } as BattleEvent;
  ctx.state.log.push(event);
  return event;
}

function cloneUnit(unit: BattleUnit): BattleUnit {
  return {
    ...unit,
    stats: { ...unit.stats },
    skills: [...unit.skills],
    traits: [...unit.traits],
    buffs: unit.buffs.map((buff) => ({ ...buff })),
  };
}

function snapshot(state: BattleState): BattleState {
  return {
    ...state,
    units: state.units.map(cloneUnit),
    order: [...state.order],
    // 避免 battleStart 内嵌自身日志造成循环引用。
    log: [],
  };
}

function findUnit(ctx: BattleContext, uid: string): BattleUnit | undefined {
  return ctx.state.units.find((unit) => unit.uid === uid);
}

function aliveOf(ctx: BattleContext, team: 0 | 1): BattleUnit[] {
  return ctx.state.units.filter((unit) => unit.team === team && unit.alive);
}

function enemiesOf(ctx: BattleContext, unit: BattleUnit): BattleUnit[] {
  return aliveOf(ctx, unit.team === 0 ? 1 : 0);
}

function alliesOf(ctx: BattleContext, unit: BattleUnit): BattleUnit[] {
  return aliveOf(ctx, unit.team);
}

function buffModifier(unit: BattleUnit, key: 'atk' | 'def' | 'spd'): number {
  let sum = 0;
  for (const buff of unit.buffs) {
    if (buff.stat !== key) continue;
    if (buff.kind === 'buff') sum += buff.value;
    else if (buff.kind === 'debuff' || buff.kind === 'slow') sum -= buff.value;
  }
  return sum;
}

function effectiveStat(unit: BattleUnit, key: 'atk' | 'def' | 'spd'): number {
  const mul = 1 + buffModifier(unit, key);
  return unit.stats[key] * (mul > 0 ? mul : 0);
}

function sortOrder(ctx: BattleContext): string[] {
  return [...ctx.state.units]
    .sort((a, b) => {
      const spdDiff = effectiveStat(b, 'spd') - effectiveStat(a, 'spd');
      if (spdDiff !== 0) return spdDiff;
      const ta = ctx.tiebreak.get(a.uid) ?? 0;
      const tb = ctx.tiebreak.get(b.uid) ?? 0;
      if (ta !== tb) return ta - tb;
      return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
    })
    .map((unit) => unit.uid);
}

function addBuff(ctx: BattleContext, source: BattleUnit, target: BattleUnit, spec: EffectSpec): void {
  const kind: BattleBuff['kind'] =
    spec.kind === 'stun' ||
    spec.kind === 'silence' ||
    spec.kind === 'slow' ||
    spec.kind === 'dot' ||
    spec.kind === 'shield'
      ? spec.kind
      : spec.kind === 'buff'
        ? 'buff'
        : 'debuff';
  const stat = spec.stat;
  const id = `${kind}:${stat ?? '-'}:${source.uid}`;
  const duration = spec.duration > 0 ? spec.duration : 1;
  const existing = target.buffs.find((buff) => buff.id === id);
  let value = spec.value;
  if (existing) {
    // 同类 buff 不叠加：取更强的数值，刷新为更长的时长。
    if (Math.abs(existing.value) > Math.abs(value)) value = existing.value;
    existing.value = value;
    existing.remainingTurns = Math.max(existing.remainingTurns, duration);
    existing.sourceUid = source.uid;
  } else {
    target.buffs.push({
      id,
      kind,
      ...(stat ? { stat } : {}),
      value,
      remainingTurns: duration,
      sourceUid: source.uid,
    });
  }
  emit(ctx, {
    type: 'buffApply',
    src: source.uid,
    dst: target.uid,
    buffId: id,
    kind,
    ...(stat ? { stat } : {}),
    value,
    remainingTurns: duration,
  });
}

function removeBuff(ctx: BattleContext, unit: BattleUnit, index: number): void {
  const [buff] = unit.buffs.splice(index, 1);
  if (buff) emit(ctx, { type: 'buffExpire', dst: unit.uid, buffId: buff.id });
}

function applyDamage(ctx: BattleContext, target: BattleUnit, damage: number): void {
  if (damage <= 0) return;
  let remaining = damage;
  const shieldIndex = target.buffs.findIndex((buff) => buff.kind === 'shield');
  if (shieldIndex >= 0) {
    const shield = target.buffs[shieldIndex];
    if (shield) {
      const absorbed = Math.min(shield.value, remaining);
      shield.value -= absorbed;
      remaining -= absorbed;
      if (shield.value <= 0) removeBuff(ctx, target, shieldIndex);
    }
  }
  if (remaining <= 0) return;
  target.hp = Math.max(0, target.hp - remaining);
  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    emit(ctx, { type: 'death', uid: target.uid });
  }
}

function resolveEffectTargets(
  ctx: BattleContext,
  source: BattleUnit,
  spec: EffectSpec,
): BattleUnit[] {
  switch (spec.target) {
    case 'self':
      return [source];
    case 'allAllies':
      return alliesOf(ctx, source);
    case 'ally': {
      const allies = alliesOf(ctx, source);
      return allies.length > 0 ? [allies[0] as BattleUnit] : [];
    }
    case 'allEnemies':
      return enemiesOf(ctx, source);
    case 'enemy': {
      const enemies = enemiesOf(ctx, source);
      return enemies.length > 0 ? [enemies[0] as BattleUnit] : [];
    }
    default:
      return [];
  }
}

function applyEffect(
  ctx: BattleContext,
  source: BattleUnit,
  spec: EffectSpec,
  targets: readonly BattleUnit[],
): void {
  for (const target of targets) {
    if (!target.alive) continue;
    if (spec.chance < 1 && !ctx.rng.chance(spec.chance)) continue;

    switch (spec.kind) {
      case 'heal': {
        const amount = Math.floor(spec.value);
        const before = target.hp;
        target.hp = Math.min(target.maxHp, target.hp + Math.max(0, amount));
        emit(ctx, { type: 'heal', src: source.uid, dst: target.uid, amount: target.hp - before });
        break;
      }
      case 'shield':
        addBuff(ctx, source, target, { ...spec, kind: 'shield' });
        break;
      case 'buff':
      case 'debuff':
      case 'stun':
      case 'silence':
      case 'slow':
      case 'dot':
        addBuff(ctx, source, target, spec);
        break;
      case 'damage':
        applyDamage(ctx, target, Math.max(0, Math.floor(spec.value)));
        break;
      case 'cleanse': {
        for (let i = target.buffs.length - 1; i >= 0; i -= 1) {
          const buff = target.buffs[i];
          if (!buff) continue;
          if (
            buff.kind === 'debuff' ||
            buff.kind === 'dot' ||
            buff.kind === 'slow' ||
            buff.kind === 'stun' ||
            buff.kind === 'silence'
          ) {
            removeBuff(ctx, target, i);
          }
        }
        break;
      }
      default:
        break;
    }
  }
}

function legalTargetsFor(
  ctx: BattleContext,
  unit: BattleUnit,
  skill: SkillConfig,
): BattleUnit[][] {
  switch (skill.target) {
    case 'single':
      return enemiesOf(ctx, unit).map((enemy) => [enemy]);
    case 'all': {
      const enemies = enemiesOf(ctx, unit);
      return enemies.length > 0 ? [enemies] : [];
    }
    case 'self':
      return [[unit]];
    case 'ally':
      return alliesOf(ctx, unit).map((ally) => [ally]);
    case 'allyAll': {
      const allies = alliesOf(ctx, unit);
      return allies.length > 0 ? [allies] : [];
    }
    default:
      return [];
  }
}

function resolveCommandTargets(
  ctx: BattleContext,
  unit: BattleUnit,
  skill: SkillConfig,
  targetUids: readonly string[],
): BattleUnit[] {
  const legal = legalTargetsFor(ctx, unit, skill);
  if (skill.target === 'all' || skill.target === 'allyAll' || skill.target === 'self') {
    return legal[0] ?? [];
  }
  const wanted = targetUids[0];
  if (!wanted) throw new Error('@petbattle/core: 单体技能必须指定目标');
  for (const group of legal) {
    const found = group.find((target) => target.uid === wanted);
    if (found) return [found];
  }
  throw new Error(`@petbattle/core: 非法目标 "${wanted}"`);
}

function attack(
  ctx: BattleContext,
  source: BattleUnit,
  target: BattleUnit,
  skill: SkillConfig,
): boolean {
  const hitChance = clamp(
    HIT_BASE + source.stats.hit - target.stats.dodge,
    HIT_CLAMP_MIN,
    HIT_CLAMP_MAX,
  );
  if (ctx.rng() >= hitChance) {
    emit(ctx, { type: 'miss', src: source.uid, dst: target.uid });
    return false;
  }
  if (skill.power <= 0) return true;

  const crit = ctx.rng() < source.stats.crit;
  const counter = ctx.cfg.counterMultiplier(source.speciesId, target.speciesId);
  const baseDamage =
    (effectiveStat(source, 'atk') * skill.power * DAMAGE_K) /
    (DAMAGE_K + effectiveStat(target, 'def'));
  const float = DAMAGE_FLOAT_MIN + ctx.rng() * DAMAGE_FLOAT_SPAN;
  const damage = Math.max(
    0,
    Math.floor(baseDamage * (crit ? source.stats.critDmg : 1) * counter * float),
  );

  emit(ctx, {
    type: 'hit',
    src: source.uid,
    dst: target.uid,
    damage,
    crit,
    countered: counter,
  });
  applyDamage(ctx, target, damage);
  return true;
}

function executeSkill(ctx: BattleContext, unit: BattleUnit, cmd: Extract<Command, { type: 'skill' }>): void {
  const skill = ctx.cfg.skill(cmd.skillId);
  if (!unit.skills.includes(cmd.skillId)) {
    throw new Error(`@petbattle/core: "${unit.uid}" 没有技能 "${cmd.skillId}"`);
  }
  if (skill.kind === 'active' && unit.buffs.some((buff) => buff.kind === 'silence')) {
    throw new Error(`@petbattle/core: "${unit.uid}" 被沉默，不能使用主动技能`);
  }
  if (skill.cost > unit.energy) {
    throw new Error(`@petbattle/core: 精力不足（需要 ${skill.cost}，当前 ${unit.energy}）`);
  }

  const targets = resolveCommandTargets(ctx, unit, skill, cmd.targetUids);
  emit(ctx, {
    type: 'cast',
    uid: unit.uid,
    skillId: skill.id,
    targets: targets.map((target) => target.uid),
  });

  let hitSomething = false;
  for (const target of targets) {
    if (!target.alive) continue;
    if (target.team === unit.team) continue;
    if (skill.power > 0 && attack(ctx, unit, target, skill)) hitSomething = true;
  }

  const effectTargets = targets.filter((target) => target.alive);
  for (const effect of skill.effects) {
    const override = effect.target ? resolveEffectTargets(ctx, unit, effect) : [];
    const resolved = effect.target ? override : effectTargets;
    applyEffect(ctx, unit, effect, resolved);
  }

  unit.energy = clamp(unit.energy - skill.cost, 0, ENERGY_MAX);
  if (skill.kind === 'normal' && hitSomething) {
    unit.energy = clamp(unit.energy + ENERGY_ON_NORMAL_HIT, 0, ENERGY_MAX);
  }
}

function checkEnd(ctx: BattleContext): boolean {
  if (ctx.state.phase === 'finished') return true;
  const a = aliveOf(ctx, 0).length;
  const b = aliveOf(ctx, 1).length;
  if (a > 0 && b > 0) return false;
  const winner: BattleWinner = a > 0 ? 0 : b > 0 ? 1 : null;
  finish(ctx, winner);
  return true;
}

function finish(ctx: BattleContext, winner: BattleWinner): void {
  if (ctx.state.phase === 'finished') return;
  ctx.state.phase = 'finished';
  ctx.state.winner = winner;
  emit(ctx, { type: 'battleEnd', winner, turns: ctx.state.turn });
}

function startNextTurn(ctx: BattleContext): void {
  ctx.state.turn += 1;

  // 1. 精力 +20
  for (const unit of ctx.state.units) {
    if (!unit.alive) continue;
    unit.energy = clamp(unit.energy + ENERGY_PER_TURN, 0, ENERGY_MAX);
    emit(ctx, { type: 'energyTick', uid: unit.uid, energy: unit.energy });
  }

  // 2. DOT 结算（按单位顺序、buff 施加顺序）
  for (const uid of ctx.state.order) {
    const unit = findUnit(ctx, uid);
    if (!unit || !unit.alive) continue;
    for (const buff of [...unit.buffs]) {
      if (buff.kind !== 'dot') continue;
      const damage = Math.max(0, Math.floor(buff.value));
      if (damage <= 0) continue;
      emit(ctx, { type: 'dotTick', src: buff.sourceUid, dst: unit.uid, damage });
      applyDamage(ctx, unit, damage);
    }
  }
  if (checkEnd(ctx)) return;

  // 3. buff 计时递减（stun 在轮到时消耗，不在这里递减）
  for (const unit of ctx.state.units) {
    if (!unit.alive) continue;
    for (let i = unit.buffs.length - 1; i >= 0; i -= 1) {
      const buff = unit.buffs[i];
      if (!buff || buff.kind === 'stun') continue;
      buff.remainingTurns -= 1;
      if (buff.remainingTurns <= 0) removeBuff(ctx, unit, i);
    }
  }

  // 4. 重排行动序
  ctx.state.order = sortOrder(ctx);
  ctx.state.cursor = 0;
  emit(ctx, { type: 'turnStart', order: [...ctx.state.order] });
}

/** 推进 cursor：跳过死亡 / 眩晕，必要时结算到下一回合；停在下一位可行动的单位。 */
function settle(ctx: BattleContext): void {
  for (;;) {
    if (ctx.state.phase === 'finished') return;
    while (ctx.state.cursor < ctx.state.order.length) {
      const uid = ctx.state.order[ctx.state.cursor];
      const unit = uid ? findUnit(ctx, uid) : undefined;
      if (!unit || !unit.alive) {
        ctx.state.cursor += 1;
        continue;
      }
      const stunIndex = unit.buffs.findIndex((buff) => buff.kind === 'stun');
      if (stunIndex >= 0) {
        removeBuff(ctx, unit, stunIndex);
        ctx.state.cursor += 1;
        continue;
      }
      return;
    }

    if (checkEnd(ctx)) return;
    if (ctx.state.turn >= MAX_TURNS) {
      finish(ctx, null);
      return;
    }
    startNextTurn(ctx);
  }
}

function applyPassives(ctx: BattleContext): void {
  for (const unit of ctx.state.units) {
    if (!unit.passiveId) continue;
    const passive = ctx.cfg.passive(unit.passiveId);
    for (const effect of passive.effects ?? []) {
      const targets = resolveEffectTargets(ctx, unit, effect);
      applyEffect(ctx, unit, effect, targets);
    }
  }
}

export function createBattleContextImpl(setup: BattleSetup, cfg: ConfigRepo): BattleContext {
  const state: BattleState = {
    seed: setup.seed,
    turn: 1,
    units: [],
    order: [],
    cursor: 0,
    phase: 'ongoing',
    winner: null,
    log: [],
  };

  const tiebreak = new Map<string, number>();
  const orderRng = mulberry32((setup.seed ^ ORDER_SEED_XOR) >>> 0);

  setup.teams.forEach((team, teamIndex) => {
    team.forEach((init, slot) => {
      const unit: BattleUnit = {
        uid: init.uid,
        team: teamIndex === 0 ? 0 : 1,
        slot,
        petId: init.petId,
        speciesId: init.speciesId,
        elementId: init.elementId,
        level: init.level,
        stats: { ...init.stats },
        skills: [...init.skills],
        traits: [...init.traits],
        ...(init.passiveId ? { passiveId: init.passiveId } : {}),
        hp: init.stats.hp,
        maxHp: init.stats.hp,
        energy: ENERGY_INITIAL,
        alive: init.stats.hp > 0,
        buffs: [],
      };
      state.units.push(unit);
      tiebreak.set(unit.uid, orderRng());
    });
  });

  const ctx: BattleContext = { state, cfg, rng: mulberry32(setup.seed), tiebreak };
  state.order = sortOrder(ctx);

  emit(ctx, { type: 'battleStart', state: snapshot(state) });
  applyPassives(ctx);

  // 初始精力 0；第 1 回合开始同样 +20（DOMAIN §9.3）。
  for (const unit of state.units) {
    if (!unit.alive) continue;
    unit.energy = clamp(unit.energy + ENERGY_PER_TURN, 0, ENERGY_MAX);
    emit(ctx, { type: 'energyTick', uid: unit.uid, energy: unit.energy });
  }

  return ctx;
}

export function availableCommandsImpl(ctx: BattleContext, uid: string): Command[] {
  if (ctx.state.phase !== 'ongoing') return [];
  const actor = ctx.state.order[ctx.state.cursor];
  if (actor !== uid) return [];
  const unit = findUnit(ctx, uid);
  if (!unit || !unit.alive) return [];

  const silenced = unit.buffs.some((buff) => buff.kind === 'silence');
  const commands: Command[] = [];

  for (const skillId of unit.skills) {
    let skill: SkillConfig;
    try {
      skill = ctx.cfg.skill(skillId);
    } catch {
      continue;
    }
    if (skill.kind === 'active' && silenced) continue;
    if (skill.cost > unit.energy) continue;
    const targetSets = legalTargetsFor(ctx, unit, skill);
    for (const targets of targetSets) {
      commands.push({
        type: 'skill',
        turn: ctx.state.turn,
        uid,
        skillId,
        targetUids: targets.map((target) => target.uid),
      });
    }
  }

  commands.push({ type: 'surrender', turn: ctx.state.turn, uid });
  return commands;
}

export function submitCommandImpl(ctx: BattleContext, cmd: Command): BattleEvent[] {
  if (ctx.state.phase !== 'ongoing') return [];
  if (cmd.turn !== ctx.state.turn) {
    throw new Error(
      `@petbattle/core: 指令回合 ${cmd.turn} 与当前回合 ${ctx.state.turn} 不一致`,
    );
  }
  const actor = ctx.state.order[ctx.state.cursor];
  if (actor !== cmd.uid) {
    throw new Error(`@petbattle/core: 还没轮到 "${cmd.uid}"（当前 "${actor ?? '-'}"）`);
  }
  const unit = findUnit(ctx, cmd.uid);
  if (!unit || !unit.alive) {
    throw new Error(`@petbattle/core: "${cmd.uid}" 已阵亡`);
  }

  const from = ctx.state.log.length;

  if (cmd.type === 'surrender') {
    finish(ctx, unit.team === 0 ? 1 : 0);
    return ctx.state.log.slice(from);
  }

  executeSkill(ctx, unit, cmd);
  ctx.state.cursor += 1;
  if (!checkEnd(ctx)) settle(ctx);

  return ctx.state.log.slice(from);
}

/**
 * 确定性 AI 策略（给 PVE 敌方 / 模拟器用）：
 * 1. 有队友血量低于 50% 且能放治疗技能 → 治疗；
 * 2. 否则选可用技能中 power 最高者，打血量比例最低的敌人；
 * 3. 同分按技能 id、目标 uid 字典序，保证完全确定。
 */
function isHealSkill(skill: SkillConfig): boolean {
  return skill.power === 0 && skill.effects.some((effect) => effect.kind === 'heal');
}

/** 伤害技能打分：power 高者优先；同分打血量更低的敌人；同分按指令顺序（确定性）。 */
function pickBestDamage(
  ctx: BattleContext,
  commands: ReadonlyArray<Extract<Command, { type: 'skill' }>>,
): Extract<Command, { type: 'skill' }> | null {
  let best: Extract<Command, { type: 'skill' }> | null = null;
  let bestPower = Number.NEGATIVE_INFINITY;
  let bestTargetHp = Number.POSITIVE_INFINITY;

  for (const cmd of commands) {
    const skill = ctx.cfg.skill(cmd.skillId);
    const targetUid = cmd.targetUids[0];
    const target = targetUid ? findUnit(ctx, targetUid) : undefined;
    const targetHp = target ? target.hp : 0;
    if (skill.power > bestPower || (skill.power === bestPower && targetHp < bestTargetHp)) {
      best = cmd;
      bestPower = skill.power;
      bestTargetHp = targetHp;
    }
  }
  return best;
}

/** 治疗技能打分：效果数值高者优先；同分按指令顺序。 */
function pickBestHeal(
  ctx: BattleContext,
  commands: ReadonlyArray<Extract<Command, { type: 'skill' }>>,
): Extract<Command, { type: 'skill' }> | null {
  let best: Extract<Command, { type: 'skill' }> | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const cmd of commands) {
    const skill = ctx.cfg.skill(cmd.skillId);
    let value = 0;
    for (const effect of skill.effects) if (effect.kind === 'heal') value += effect.value;
    if (value > bestValue) {
      best = cmd;
      bestValue = value;
    }
  }
  return best;
}

/** 单位技能里最便宜的大招成本；没有大招返回 Infinity。 */
function cheapestUltimateCost(ctx: BattleContext, unit: BattleUnit): number {
  let cheapest = Number.POSITIVE_INFINITY;
  for (const skillId of unit.skills) {
    let skill: SkillConfig;
    try {
      skill = ctx.cfg.skill(skillId);
    } catch {
      continue;
    }
    if (skill.cost >= ULTIMATE_ENERGY_MIN && skill.cost < cheapest) cheapest = skill.cost;
  }
  return cheapest;
}

/**
 * 确定性 AI 策略（D-09 留能量版）：
 * 1. 有队友血量低于 50% 且能放治疗 → 治疗；
 * 2. 大招可用（精力 ≥ 大招 cost）→ 放大招；
 * 3. 精力 ≥ 大招 cost − 20 → 用普攻攒能量，不再乱放小技能；
 * 4. 否则有小技能可用 → 放小技能；
 * 5. 否则普攻。
 *
 * 同分按技能/指令顺序，保证完全确定。
 */
export function chooseAiCommandImpl(ctx: BattleContext): Command | null {
  const actor = ctx.state.order[ctx.state.cursor];
  if (!actor) return null;
  const unit = findUnit(ctx, actor);
  if (!unit) return null;

  const commands = availableCommandsImpl(ctx, actor).filter(
    (cmd): cmd is Extract<Command, { type: 'skill' }> => cmd.type === 'skill',
  );
  if (commands.length === 0) return null;

  const hurt = alliesOf(ctx, unit).some((ally) => ally.hp / ally.maxHp < 0.5);
  if (hurt) {
    const heals = commands.filter((cmd) => isHealSkill(ctx.cfg.skill(cmd.skillId)));
    const heal = pickBestHeal(ctx, heals);
    if (heal) return heal;
  }

  const ultimates = commands.filter(
    (cmd) => ctx.cfg.skill(cmd.skillId).cost >= ULTIMATE_ENERGY_MIN,
  );
  const ultimate = pickBestDamage(ctx, ultimates);
  if (ultimate) return ultimate;

  const normal = commands.find((cmd) => ctx.cfg.skill(cmd.skillId).kind === 'normal') ?? null;

  // 距最便宜的大招只差一回合的回能时，普攻攒能量（避免小技能把大招无限推后）。
  const ultCost = cheapestUltimateCost(ctx, unit);
  if (normal && unit.energy >= ultCost - ENERGY_PER_TURN) return normal;

  const smalls = commands.filter((cmd) => {
    const cost = ctx.cfg.skill(cmd.skillId).cost;
    return cost >= SMALL_SKILL_ENERGY_MIN && cost < ULTIMATE_ENERGY_MIN;
  });
  const small = pickBestDamage(ctx, smalls);
  if (small) return small;

  return normal ?? commands[0] ?? null;
}

/**
 * 内置 AI 的公开入口（contract-v1.2 D-03）：只对当前行动者生效，
 * 策略与 `chooseAiCommandImpl` 完全相同（同一份实现，不复制第二套）。
 */
export function autoCommandImpl(ctx: BattleContext, uid: string): Command {
  if (ctx.state.phase !== 'ongoing') {
    throw new Error('@petbattle/core: 战斗已结束，没有可用指令');
  }
  const actor = ctx.state.order[ctx.state.cursor];
  if (actor !== uid) {
    throw new Error(`@petbattle/core: 还没轮到 "${uid}"（当前 "${actor ?? '-'}"）`);
  }
  const command = chooseAiCommandImpl(ctx);
  if (!command) throw new Error(`@petbattle/core: "${uid}" 没有可用指令`);
  return command;
}
