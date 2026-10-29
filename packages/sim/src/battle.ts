/**
 * 批量 PVE 对局模拟（TECH_DESIGN §15，PITFALLS P-002）。
 *
 * 驱动 core 的 `BattleEngine`：sim 只负责“选一个合法指令并提交”，
 * 伤害/精力/排序/胜负全部由 core 计算。core 尚未实现时返回 `unavailable`，
 * 不伪造数据。
 */
import {
  BattleEngine,
  CoreNotImplementedError,
  MAX_TURNS,
  buildBattleSetup,
  buildEnemyTeam,
  type BattleEvent,
  type BattleSetup,
  type Command,
  type ConfigData,
  type ConfigRepo,
  type PetInstance,
  type Rng,
  type StageConfig,
} from '@petbattle/core';

import { PLAYER_LEVEL_BY_ORDER, STARTERS, makeAdultPet } from './fixtures.js';
import { createRng } from './rng.js';
import type { BattleMetrics, SimStatus, StageBattleStats } from './types.js';

export interface BattleBatchOptions {
  /** 每关对局数；默认 1000。 */
  battlesPerStage: number;
  seed: number;
  stageId?: string;
}

interface BattleOutcome {
  winner: 0 | 1 | null;
  turns: number;
  smallCasts: number;
  ultimateCasts: number;
  unitTurns: number;
  ultimateGaps: number[];
  invalidNumbers: number;
}

const SMALL_SKILL_MIN = 40;
const ULTIMATE_SKILL_MIN = 70;

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function describeError(error: unknown): string {
  if (error instanceof CoreNotImplementedError) return error.message;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function unavailableBattle(reason: string): BattleMetrics {
  return {
    status: 'unavailable',
    reason,
    battles: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: 0,
    drawRate: 0,
    avgTurns: 0,
    minTurns: 0,
    maxTurns: 0,
    smallCastsPerUnitTurn: 0,
    ultimateCastsPerUnitTurn: 0,
    avgUltimateInterval: 0,
    invalidNumbers: 0,
    perStage: [],
  };
}

function pickCommand(commands: readonly Command[], cfg: ConfigRepo, rng: Rng): Command {
  const skills = commands.filter(
    (command): command is Extract<Command, { type: 'skill' }> => command.type === 'skill',
  );
  if (skills.length === 0) {
    const fallback = commands[0];
    if (!fallback) throw new Error('没有可提交的指令');
    return fallback;
  }

  let bestCost = -1;
  let best: Command[] = [];
  for (const command of skills) {
    const cost = cfg.skill(command.skillId).cost;
    if (cost > bestCost) {
      bestCost = cost;
      best = [command];
    } else if (cost === bestCost) {
      best.push(command);
    }
  }
  return rng.pick(best);
}

function currentActor(order: readonly string[], cursor: number): string | undefined {
  return order[cursor] ?? order[0];
}

function playOneBattle(
  setup: BattleSetup,
  cfg: ConfigRepo,
  rng: Rng,
): BattleOutcome {
  const engine = BattleEngine.create(setup, cfg);
  const ultimateTurnsByUnit = new Map<string, number[]>();
  let smallCasts = 0;
  let ultimateCasts = 0;
  let guard = 0;

  while (engine.state.phase === 'ongoing' && guard < MAX_TURNS * 8) {
    const state = engine.state;
    const uid = currentActor(state.order, state.cursor);
    if (!uid) break;
    const commands = engine.availableCommands(uid);
    if (commands.length === 0) break;
    engine.submit(pickCommand(commands, cfg, rng));
    guard += 1;
  }

  const state = engine.state;
  const events: readonly BattleEvent[] = state.log;

  let invalidNumbers = 0;
  let turns = state.turn;
  for (const event of events) {
    switch (event.type) {
      case 'hit':
        if (!Number.isFinite(event.damage)) invalidNumbers += 1;
        break;
      case 'heal':
      case 'shield':
        if (!Number.isFinite(event.amount)) invalidNumbers += 1;
        break;
      case 'dotTick':
        if (!Number.isFinite(event.damage)) invalidNumbers += 1;
        break;
      case 'buffApply':
        if (!Number.isFinite(event.value)) invalidNumbers += 1;
        break;
      case 'cast': {
        const cost = cfg.skill(event.skillId).cost;
        if (cost >= ULTIMATE_SKILL_MIN) {
          ultimateCasts += 1;
          const turnsList = ultimateTurnsByUnit.get(event.uid) ?? [];
          turnsList.push(event.turn);
          ultimateTurnsByUnit.set(event.uid, turnsList);
        } else if (cost >= SMALL_SKILL_MIN) {
          smallCasts += 1;
        }
        break;
      }
      case 'battleEnd':
        turns = event.turns;
        break;
      default:
        break;
    }
  }

  for (const unit of state.units) {
    if (!Number.isFinite(unit.hp) || !Number.isFinite(unit.maxHp)) invalidNumbers += 1;
  }

  const ultimateGaps: number[] = [];
  for (const turnsList of ultimateTurnsByUnit.values()) {
    turnsList.sort((a, b) => a - b);
    for (let index = 1; index < turnsList.length; index += 1) {
      const gap = (turnsList[index] ?? 0) - (turnsList[index - 1] ?? 0);
      if (gap > 0) ultimateGaps.push(gap);
    }
  }

  const unitCount = setup.teams[0].length + setup.teams[1].length;
  const winner = state.phase === 'finished' ? state.winner : null;

  return {
    winner,
    turns,
    smallCasts,
    ultimateCasts,
    unitTurns: turns * unitCount,
    ultimateGaps,
    invalidNumbers,
  };
}

function playerTeamForStage(
  cfg: ConfigRepo,
  stage: StageConfig,
  stageIndex: number,
): PetInstance[] {
  const level = PLAYER_LEVEL_BY_ORDER[stage.order] ?? 1;
  return STARTERS.map((starter, index) =>
    makeAdultPet(cfg, {
      id: `sim_p_${stageIndex}_${index}`,
      speciesId: starter.speciesId,
      elementId: starter.elementId,
      gender: starter.gender,
      gene: 50,
      level,
    }),
  );
}

export function runBattleBatch(
  cfg: ConfigRepo,
  data: ConfigData,
  options: BattleBatchOptions,
): BattleMetrics {
  const stages = options.stageId
    ? data.stages.filter((stage) => stage.id === options.stageId)
    : [...data.stages].sort((a, b) => a.order - b.order);

  if (stages.length === 0) {
    return unavailableBattle(`找不到关卡 ${options.stageId ?? '<all>'}`);
  }

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let totalTurns = 0;
  let minTurns = Number.POSITIVE_INFINITY;
  let maxTurns = 0;
  let smallCasts = 0;
  let ultimateCasts = 0;
  let unitTurns = 0;
  let ultimateGapSum = 0;
  let ultimateGapCount = 0;
  let invalidNumbers = 0;
  let battles = 0;
  const perStage: StageBattleStats[] = [];
  let firstError: unknown = null;

  try {
    stages.forEach((stage, stageIndex) => {
      const pets = playerTeamForStage(cfg, stage, stageIndex);
      let stageWins = 0;
      let stageDraws = 0;
      let stageTurns = 0;
      let stageBattles = 0;

      for (let index = 0; index < options.battlesPerStage; index += 1) {
        const seed = options.seed + stageIndex * 100_000 + index;
        const rng = createRng(seed);
        try {
          const playerSetup = buildBattleSetup([pets, pets], cfg, seed);
          const enemy = buildEnemyTeam(stage, cfg, seed);
          const setup: BattleSetup = { seed, teams: [playerSetup.teams[0], enemy] };
          const outcome = playOneBattle(setup, cfg, rng);

          battles += 1;
          stageBattles += 1;
          totalTurns += outcome.turns;
          stageTurns += outcome.turns;
          minTurns = Math.min(minTurns, outcome.turns);
          maxTurns = Math.max(maxTurns, outcome.turns);
          smallCasts += outcome.smallCasts;
          ultimateCasts += outcome.ultimateCasts;
          unitTurns += outcome.unitTurns;
          invalidNumbers += outcome.invalidNumbers;
          for (const gap of outcome.ultimateGaps) {
            ultimateGapSum += gap;
            ultimateGapCount += 1;
          }

          if (outcome.winner === 0) {
            wins += 1;
            stageWins += 1;
          } else if (outcome.winner === 1) {
            losses += 1;
          } else {
            draws += 1;
            stageDraws += 1;
          }
        } catch (error) {
          if (firstError === null) firstError = error;
        }
      }

      if (stageBattles > 0) {
        perStage.push({
          stageId: stage.id,
          battles: stageBattles,
          winRate: round(stageWins / stageBattles),
          drawRate: round(stageDraws / stageBattles),
          avgTurns: round(stageTurns / stageBattles),
        });
      }
    });
  } catch (error) {
    firstError = firstError ?? error;
  }

  if (battles === 0) {
    return unavailableBattle(firstError ? describeError(firstError) : '没有成功完成任何对局');
  }

  const status: SimStatus = 'ok';
  return {
    status,
    reason: firstError ? `部分对局失败：${describeError(firstError)}` : undefined,
    battles,
    wins,
    losses,
    draws,
    winRate: round(wins / battles),
    drawRate: round(draws / battles),
    avgTurns: round(totalTurns / battles, 2),
    minTurns: Number.isFinite(minTurns) ? minTurns : 0,
    maxTurns,
    smallCastsPerUnitTurn: round(smallCasts / Math.max(1, unitTurns)),
    ultimateCastsPerUnitTurn: round(ultimateCasts / Math.max(1, unitTurns)),
    avgUltimateInterval: ultimateGapCount > 0 ? round(ultimateGapSum / ultimateGapCount, 2) : 0,
    invalidNumbers,
    perStage,
  };
}
