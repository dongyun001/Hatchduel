# 《宠物对决》领域模型（DOMAIN_MODEL）

| 项 | 内容 |
|---|---|
| 项目代号 | PetBattle |
| 文档版本 | v1.4 |
| 日期 | 2026-10-28 |
| 对应需求 | PRD v1.1 |
| 状态 | 待评审 |

> 本文定义**数据结构、公式、算法和不变量**。实现位于 `packages/core`，客户端与服务器共用。与 PRD 冲突时以 PRD 为准。

**修订记录**：

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-10-27 | 初版：个体/基因/繁殖/时间/经济/战斗接口 |
| v1.1 | 2026-10-28 | 新增被动表、经验曲线、回合结算顺序、敌方快照；修复突变计数、产出系数、状态边界、不变量 |
| v1.2 | 2026-10-29 | 追加 §15 实现说明（A 会话，contract-v1）：派生属性取整口径、推进顺序落地、繁殖冷却、战斗状态与契约缺口 |
| v1.3 | 2026-10-29 | contract-v1.2 D-01~D-07：releasePet 带 cfg、BreedResult.parentCooldowns、autoCommand、applyExp、栖息地两个可选字段、暴击倍率口径 |
| v1.4 | 2026-10-29 | contract-v1.3 D-08~D-14：测试与生产数据解耦、AI 留能量、PvE setup、放生拒绝防守阵容、栖息地操作函数与 careRecoveryPerAction、hit 加法语义、inheritance.weight 标 reserved |

---

## 1. 约定

| 项 | 约定 |
|---|---|
| 时间 | `EpochMs = number`，UTC 毫秒；由调用方传入，core 内禁止 `Date.now` |
| ID | `Id = string`；宠物、栖息地、账号各自唯一 |
| 基因 | `number`，0~100，整数 |
| 状态值 | `number`，0~100，允许小数，展示时取整 |
| 概率 | `number`，0~1 |
| 倍率 | 保留 4 位小数；伤害最终 `Math.floor` |
| 随机 | 调用方注入 `Rng`；core 内禁止 `Math.random` |
| 序列化 | 所有状态可 JSON 序列化；禁止函数、Map/Set、循环引用 |
| 浮点 | 禁止 `Math.sin/cos/exp` 等超越函数参与数值；只用 `+ - * /`、`Math.floor`、`Math.min/max`、`Math.imul` |
| 正态分布 | 用 Irwin–Hall 近似：`gaussian(rng) = Σ(12 次 rng()) − 6`，均值 0、方差 1；不依赖 `log/sqrt/cos` |

### 1.1 确定性 RNG

```ts
interface Rng {
  (): number;                         // [0, 1)
  chance(p: number): boolean;         // rng() < p
  pick<T>(items: readonly T[]): T;    // 均匀选择
}

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (() => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.chance = (p: number) => next() < p;
  next.pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)];
  return next;
}
```

- 种子由调用方提供：单机由 `game/` 层生成并写入战报；联机由服务器开战时下发。
- 同一场战斗/繁殖只使用一个 rng 实例，按固定顺序消费；不要在不同分支里“多抽一次”。
- `pick` 的数组长度为 0 时抛错，不做隐式回退。

---

## 2. 配置表

### 2.1 基础属性

```ts
type StatKey = 'hp' | 'atk' | 'def' | 'spd' | 'crit' | 'critDmg' | 'hit' | 'dodge';

interface StatBlock {
  hp: number;       // 生命
  atk: number;      // 攻击
  def: number;      // 防御
  spd: number;      // 速度
  crit: number;     // 暴击率，0~1
  critDmg: number;  // 暴击伤害倍率，默认 1.5
  hit: number;      // 命中修正，-0.5~0.5
  dodge: number;    // 闪避，0~0.9
}
```

> **HIT 语义已修正**：`hit` 只表示命中率修正。MVP 不做“效果命中”属性，控制/减益概率由技能的 `chance` 决定。后续若需要，再加独立字段 `effectHit`。

### 2.2 物种

```ts
type Grade = 'S' | 'A' | 'B' | 'C' | 'D';
type ElementId = 'water' | 'fire' | 'grass' | 'earth' | 'thunder';

interface SpeciesConfig {
  id: Id;
  name: string;
  grade: { hp: Grade; atk: Grade; def: Grade; spd: Grade };
  base: StatBlock;              // 1 级基准，构建时由 grade 换算或直接填写
  growth: { hp: number; atk: number; def: number; spd: number }; // 每级增量系数，默认 0.08
  signatureSkillId: Id;
  passiveId?: Id;               // 指向 passives.json 的 PassiveConfig
  counters: Id[];               // 单向克制
  habitatTags: ElementId[];     // 栖息地偏好
  rarity: 'common' | 'rare' | 'epic';
  breedable: boolean;
  spriteId: string;
}
```

档位到系数：S=1.30、A=1.15、B=1.00、C=0.85、D=0.72；基准 HP=100、ATK=20、DEF=12、SPD=10。每项 = `round(基准 × 档位系数)`。

### 2.3 属性

```ts
interface ElementConfig {
  id: ElementId;
  name: string;
  skillPool: [Id, Id];          // [小技能, 大招]
  color: string;
  habitatTag: ElementId;
}
```

### 2.4 相性

```ts
type Affinity = 1 | 0 | -1;
type AffinityTable = Record<ElementId, Partial<Record<Id, Affinity>>>;
// 缺省 = 0（普通）；只存非 0 项
```

### 2.5 技能

```ts
interface SkillConfig {
  id: Id;
  name: string;
  kind: 'normal' | 'active';
  cost: number;                 // 普攻 0；小技能 40~50；大招 70~80
  target: 'single' | 'all' | 'self' | 'ally' | 'allyAll';
  power: number;                // 伤害倍率
  effects: EffectSpec[];
  cooldown?: number;            // 回合数，MVP 可不用
}

interface EffectSpec {
  kind: 'damage' | 'heal' | 'shield' | 'buff' | 'debuff'
      | 'stun' | 'silence' | 'slow' | 'dot' | 'cleanse';
  value: number;
  duration: number;
  chance: number;               // 0~1
  stat?: 'atk' | 'def' | 'spd';
}
```

### 2.6 特质

```ts
interface TraitConfig {
  id: Id;
  name: string;
  rarity: 'common' | 'rare' | 'epic';
  description: string;
  statMods?: Partial<Record<StatKey, number>>; // 乘数，如 { atk: 1.05 }
  productionMod?: number;                       // 产出乘数，默认 1
  battleTags?: string[];                        // 供 AI/技能判定
  inheritance: { weight: number };              // reserved：MVP 不消费，等显隐性模型定案（D-14）
}
```

### 2.6.1 被动技能

被动独立建表，避免 `SpeciesConfig.passiveId` 悬空。

```ts
interface PassiveConfig {
  id: Id;
  name: string;
  description: string;
  statMods?: Partial<Record<StatKey, number>>; // 战斗创建时的乘数，如 { def: 1.08 }
  effects?: EffectSpec[];                      // 开场一次性效果
}
```

- `SpeciesConfig.passiveId` 指向 `passives.json`。
- **MVP 只在战斗创建时生效**：`statMods` 计入派生属性；`effects` 作为开场一次性事件，由引擎在 `battleStart` 阶段应用；不做每回合触发/运行时 hook。
- 被动不参与繁殖遗传；它属于物种配置，不属于个体基因。

### 2.7 栖息地、食物、繁殖、关卡、经济

```ts
interface HabitatConfig {
  id: Id;
  name: string;
  capacity: number;
  elementBonus: Partial<Record<ElementId, number>>; // 匹配时的产出加成，如 0.15
  productionPerHour: ResourceRate[];
  upkeepPerPetPerHour: ResourceRate[];
  conditionDecayPerHour: { hunger: number; mood: number; hygiene: number };
  healthDecayWhenStarving: number;
  healthRecoveryPerHour: number; // 初版，待 sim 验证；饥饿/清洁均 >=50 时每小时恢复
  /** 食物（upkeep）不足时，每只宠物每小时额外扣的饥饿；缺省 0（contract-v1.2 D-05）。 */
  hungerPenaltyWhenNoFoodPerHour?: number;
  /** 产出阶段系数；缺省 0.5 / 1 / 0.8（contract-v1.2 D-06）。 */
  productionStageMul?: { juvenile: number; adult: number; elder: number };
  /** 照料恢复量：clean 恢复 hygiene、play 恢复 mood；缺省 20 / 20（contract-v1.3 D-12）。 */
  careRecoveryPerAction?: { clean?: number; play?: number };
  offlineCapMs: number;         // 默认 8h
  decayCapMs: number;           // 默认 24h
  // 数据化（CONTRACT C-01）：JSON 不能存函数，等级表代替函数。
  upgrade: {
    maxLevel: number;
    levels: Array<{ level: number; cost: ResourceCost[]; capacity: number; productionMul: number }>;
  };
}

interface FoodConfig {
  id: Id;
  name: string;
  cost: ResourceCost[];
  nutrition: number;            // 恢复饥饿
  mood: number;                 // 恢复心情
}

interface BreedingConfig {
  hatchMs: number;              // 默认 30 分钟
  juvenileMs: number;           // 默认 2 小时
  elderAfterMs: number;         // 默认 7 天
  cooldownMs: number;           // 默认 2 小时
  cost: ResourceCost[];
  mutation: {
    geneSigma: number;          // 基因波动标准差，默认 8
    traitChance: number;        // 默认 0.03
    elementChance: number;      // 默认 0.01
  };
  inbreeding: {
    generations: number;        // 默认 3
    genePenalty: number;        // 默认 5
    mutationBonus: number;      // 默认 0.02
    fertilityPenalty: number;   // 默认 0.2
  };
  maxExpressedTraits: number;   // 默认 3
  maxHiddenTraits: number;      // 默认 3
}

interface StageConfig {
  id: Id;
  name: string;
  order: number;
  enemies: Array<{
    speciesId: Id;
    elementId: ElementId;
    level: number;
    geneQuality: number;        // 0~100，用于生成敌方快照
    traits: Id[];
  }>;
  rewards: {
    firstClear?: { pets?: Id[]; eggs?: Id[]; resources?: ResourceBag; petExp?: number };
    repeat?: { resources?: ResourceBag; petExp?: number };
  };
}
```

### 2.7.1 经验与升级

- **经验只来自 PVE 胜利**；异步 PvP 不给宠物经验。
- 首通经验：`30 + stage.order × 10`；重复经验：`floor(首通 / 3)`。初版数值，待 sim 验证。
- 升级曲线：`expToNext(level) = 40 + level × 20`。初版数值，待 sim 验证。
- 升级规则：`while (exp >= expToNext(level) && level < 20) { exp -= expToNext(level); level++; }`；升级后重新计算派生属性。
- `StageConfig.rewards.firstClear.petExp` / `rewards.repeat.petExp` 由配置直接给出；上面的公式用于填表，不在运行时临时计算。

### 2.8 配置仓库

```ts
interface ConfigRepo {
  species(id: Id): SpeciesConfig;
  element(id: ElementId): ElementConfig;
  skill(id: Id): SkillConfig;
  trait(id: Id): TraitConfig;
  passive(id: Id): PassiveConfig;
  habitat(id: Id): HabitatConfig;
  food(id: Id): FoodConfig;
  stage(id: Id): StageConfig;

  affinity(elementId: ElementId, speciesId: Id): Affinity;
  counterMultiplier(atkSpeciesId: Id, defSpeciesId: Id): 1.25 | 0.85 | 1.0;

  skillsFor(pet: PetInstance): Id[];   // [普攻, 小技能, 大招, 物种技能]
  traitsFor(pet: PetInstance): TraitConfig[];
  allElements(): ElementConfig[];
  allTraits(): TraitConfig[];
}
```

- 只读；加载时完成校验（见 `TECH_DESIGN.md` §8）。
- `counterMultiplier` 先查攻方 `counters` 是否含守方 → 1.25；再查守方 `counters` 是否含攻方 → 0.85；否则 1.0。
- 不做运行时热改；配置版本变更通过重新加载/重启生效。

---

## 3. 宠物个体

```ts
type PetId = Id;
type HabitatId = Id;
type Stage = 'egg' | 'juvenile' | 'adult' | 'elder';

interface TraitAllele {
  traitId: Id;
  dominant: boolean;
}

interface Genome {
  stats: Record<'hp' | 'atk' | 'def' | 'spd', number>; // 0~100
  speciesAlleles: [Id, Id];                             // 父母物种，供未来杂交
  elementAlleles: [ElementId, ElementId];               // 父母属性
  traitAlleles: TraitAllele[];
  mutationCount: number;
}

interface Condition {
  hunger: number;   // 0~100
  mood: number;     // 0~100
  hygiene: number;  // 0~100
  health: number;   // 1~100，地板 1
}

interface AncestorRef {
  id: PetId;
  depth: number;    // 1=父母，2=祖父母，3=曾祖父母
}

interface PetInstance {
  id: PetId;
  name?: string;                // 玩家可改名；缺省用物种名
  speciesId: Id;
  elementId: ElementId;
  genome: Genome;
  traits: Id[];                 // 已表达
  hiddenTraits: Id[];           // 隐性
  gender: 'male' | 'female';
  generation: number;           // 1 起
  parents: [PetId | null, PetId | null];
  ancestors: AncestorRef[];     // 最多 3 代，去重
  bornAt: EpochMs;
  stage: Stage;
  stageChangedAt: EpochMs;
  level: number;                // 1~20（MVP）
  exp: number;
  condition: Condition;
  fertility: {
    readyAt: EpochMs;
    cooldownUntil: EpochMs;
    penalty: number;            // 0~1，近亲惩罚
  };
  habitatId: HabitatId | null;
  locked: boolean;              // 锁定后不可分解/交易
  createdAt: EpochMs;
  updatedAt: EpochMs;
}
```

---

## 4. 派生属性

### 4.1 公式

```
等级系数  levelMul(key) = 1 + growth[key] × (level − 1)
阶段系数  stageMul = { egg: 0, juvenile: 0.7, adult: 1.0, elder: 0.9 }
基因系数  geneMul(g) = 0.85 + (g / 100) × 0.30        # 0.85~1.15
状态系数  condMul = 0.90 + (hunger + mood + hygiene + health) / 400 × 0.20   # 0.90~1.10
特质系数  traitMul(key) = ∏ trait.statMods[key]         # 默认 1
被动系数  passiveMul(key) = ∏ passive.statMods[key]       # 默认 1
相性系数  affinityMul = 1 + affinity × 0.10             # 0.90 / 1.00 / 1.10

最终值(key) = floor(
  base[key]
  × levelMul(key)      # 仅 hp/atk/def/spd
  × stageMul           # 仅 hp/atk/def/spd
  × geneMul(gene)      # 仅 hp/atk/def/spd
  × condMul            # 全部属性
  × traitMul(key)      # 全部属性
  × passiveMul(key)    # 全部属性
  × affinityMul        # 仅 hp/atk/def/spd
)
```

- `crit/critDmg/dodge` 不参与等级、阶段、基因、相性；只乘 `condMul`、`traitMul`、`passiveMul`。
- **`hit` 的 `statMods` 是加法增量**（contract-v1.3 D-13）：`(base.hit + Σ hitMods) × condMul`，再 clamp ±0.5；
  基础 hit 为 0 时乘数没有意义，所以特质/被动一律按“+0.02 = +2 个百分点”叠加。
- **暴击倍率口径（contract-v1.2 D-04）**：150%（`CRIT_DAMAGE_DEFAULT`）是**基础倍率**；`condMul`、特质、被动会修正它，
  满状态的实际暴击倍率可以高于 150%（如 `1.5 × 1.1 = 1.65`）。不要把 150% 当成结算后的固定值。
- 取整只在最后一步；中间保留 double。比例属性（`crit/critDmg/hit/dodge`）实现时保留 4 位小数后 clamp（见 §15.1）。
- `crit` 结果 clamp 到 0~1；`dodge` clamp 到 0~0.9；`hit` clamp 到 -0.5~0.5。
- 蛋阶段不参与战斗；如需展示，用 0。

### 4.2 示例

物种基础 ATK=20，等级 10（`1 + 0.08×9 = 1.72`），基因 62（`0.85 + 0.62×0.3 = 1.036`），状态均值 80（`0.9 + 0.8×0.2 = 1.06`），特质 ×1.05，相性冲突 ×0.9：

```
floor(20 × 1.72 × 1.036 × 1.06 × 1.05 × 0.9) = floor(35.70) = 35
```

### 4.3 命中与伤害

```
命中率 = clamp(0.90 + hit − target.dodge, 0.05, 1.00)
暴击判定 = rng() < crit
基础伤害 = ATK × skill.power × K / (K + target.DEF)      # K = 400
克制倍率：攻方克制守方 1.25；攻方被守方克制 0.85；否则 1.0
最终伤害 = floor(基础伤害 × critDmg^(是否暴击) × 克制倍率 × 浮动)
浮动 = 0.95 + rng() × 0.10
```

- 相性已在 `deriveStats` 中计入，不在这里再乘。
- 治疗/护盾/减益的数值也走 `floor`，但概率判定用原始 chance。
- 群体技能对每个目标独立判定命中和暴击。

---

## 5. 阶段与状态

### 5.1 阶段推进

| 转移 | 条件 |
|---|---|
| 蛋 → 幼年 | `now >= bornAt + hatchMs` |
| 幼年 → 成年 | `now >= stageChangedAt + juvenileMs` |
| 成年 → 老年 | `now >= stageChangedAt + elderAfterMs` |

- `stageChangedAt` 在每次转移时更新。
- 蛋不产出、不战斗、不消耗食物。
- 老年繁殖力 ×0.5，产出 ×0.8。

### 5.2 状态衰减

```
每小时：
  hunger  -= habitat.conditionDecayPerHour.hunger
  mood    -= habitat.conditionDecayPerHour.mood
  hygiene -= habitat.conditionDecayPerHour.hygiene

if hunger <= 0 or hygiene <= 0:
  health -= habitat.healthDecayWhenStarving × dtHours
else if hunger >= 50 and hygiene >= 50:
  health += habitat.healthRecoveryPerHour × dtHours

clamp: hunger/mood/hygiene 0~100, health 1~100
```

- 状态参与 `condMul`，直接反映到战斗和产出。
- 离线衰减上限 24 小时，避免长期不上线导致不可恢复；健康地板 1，不死亡。
- **不做主动治疗**；健康只在饥饿/清洁都达标时自然恢复。

---

## 6. 栖息地

```ts
interface HabitatInstance {
  id: HabitatId;
  configId: Id;
  level: number;
  slots: Array<PetId | null>;   // 长度 = capacity(level)
  lastEvaluatedAt: EpochMs;
  stored: ResourceBag;          // 未领取的产出
}
```

### 6.1 产出

```
dtHours = clamp(now − lastEvaluatedAt, 0, offlineCapMs) / 3600000

对每种资源：
  baseRate = config.productionPerHour[resource]
  elementMul = 1 + Σ(每只宠物匹配 elementBonus)   # 可叠加，按配置上限
  stageMul = Σ(pet.stage 产出系数) / 宠物数       # juvenile 0.5 / adult 1 / elder 0.8
  moodMul = 0.8 + avg(mood)/100 × 0.2
  levelMul = upgrade.productionMul(habitat.level)
  amount = floor(baseRate × elementMul × stageMul × moodMul × levelMul × dtHours)

stored += amount
```

- 宠物数为 0 时产出为 0；`stageMul` 按 0 处理，不要除以 0。
- 产出按 `dtHours` 线性插值；不足 10 分钟的零头保留，不取整丢弃。

### 6.2 消耗

- 每只成年/幼年宠物每小时消耗食物；食物不足时 `hunger` 额外下降。
- 蛋不消耗。
- 消耗在产出之后结算；不足时欠账不跨期，直接转为饥饿惩罚。

### 6.3 领取

- 玩家点击领取，`stored` 转入 `profile.currencies`。
- 领取是幂等操作；服务器用 `revision` 防止重复。

---

## 7. 时间推进

```ts
function advanceProfile(
  profile: Profile,
  now: EpochMs,
  cfg: ConfigRepo,
): { profile: Profile; patch: ProfilePatch } {
  if (now < profile.lastEvaluatedAt) throw new TimeError('time_backwards');

  // 1. 先推进宠物（阶段、状态、冷却）
  for (const pet of profile.pets) advancePet(pet, now, cfg);

  // 2. 再结算栖息地产出（使用推进后的状态）
  for (const habitat of profile.habitats) advanceHabitat(habitat, petsOf(habitat), now, cfg);

  // 3. 更新权威时间戳
  profile.lastEvaluatedAt = now;
  return { profile, patch: diff(before, profile) };
}
```

- 顺序固定：宠物 → 栖息地。不要交换，否则产出会用到旧状态。
- `advanceProfile` 必须幂等：同一 `now` 调两次，第二次不产生变化。
- 服务器保存 `lastEvaluatedAt`；客户端只做预测。
- 离线事件（疾病、突变等）如果需要随机，由服务器生成种子并写入，客户端不自行决定。

---

## 8. 繁殖

### 8.1 条件校验

```ts
type BreedError =
  | 'not_adult' | 'cooldown' | 'same_pet' | 'same_gender'
  | 'no_capacity' | 'cost' | 'locked' | 'infertile';

interface BreedCheck {
  ok: boolean;
  reason?: BreedError;
}
```

校验顺序：同一只 → 性别 → 阶段 → 锁定 → 可繁殖时间 → 冷却 → 空位 → 成本。

### 8.2 遗传算法

```ts
function breed(a: PetInstance, b: PetInstance, now: EpochMs, cfg: ConfigRepo, rng: Rng): PetInstance {
  // 1. 物种：父母之一
  const speciesId = rng.pick([a.speciesId, b.speciesId]);

  // 2. 属性：父母之一；小概率突变
  let mutations = 0;
  let elementId = rng.pick([a.elementId, b.elementId]);
  if (rng.chance(cfg.breeding.mutation.elementChance)) {
    elementId = rng.pick(cfg.elements.map(e => e.id));
    mutations++;
  }

  // 3. 基因：均值 + 正态波动 + 近亲惩罚
  const inbred = isInbred(a, b, cfg.breeding.inbreeding.generations);
  const stats = {} as Genome['stats'];
  for (const key of ['hp', 'atk', 'def', 'spd'] as const) {
    const mean = (a.genome.stats[key] + b.genome.stats[key]) / 2;
    let gene = mean + gaussian(rng) * cfg.breeding.mutation.geneSigma;
    if (inbred) gene -= cfg.breeding.inbreeding.genePenalty;
    stats[key] = clamp(Math.round(gene), 0, 100);
  }

  // 4. 特质：显性优先，隐性按概率保留
  const pool = [
    ...a.traits.map(t => ({ traitId: t, dominant: true })),
    ...a.hiddenTraits.map(t => ({ traitId: t, dominant: false })),
    ...b.traits.map(t => ({ traitId: t, dominant: true })),
    ...b.hiddenTraits.map(t => ({ traitId: t, dominant: false })),
  ];
  const byTrait = groupBy(pool, x => x.traitId);
  const traits: Id[] = [];
  const hiddenTraits: Id[] = [];
  for (const [traitId, alleles] of byTrait) {
    if (alleles.some(x => x.dominant)) traits.push(traitId);
    else if (rng.chance(0.5)) hiddenTraits.push(traitId);
  }
  const ownedTraits = new Set([...traits, ...hiddenTraits]);
  const availableTraits = cfg.traits.filter(t => !ownedTraits.has(t.id));
  if (availableTraits.length > 0 &&
      rng.chance(cfg.breeding.mutation.traitChance + (inbred ? cfg.breeding.inbreeding.mutationBonus : 0))) {
    traits.push(rng.pick(availableTraits).id);
    mutations++;
  }
  capTraits(traits, cfg.breeding.maxExpressedTraits);
  capTraits(hiddenTraits, cfg.breeding.maxHiddenTraits);

  // 5. 代数与祖先
  const generation = Math.max(a.generation, b.generation) + 1;
  const ancestors = buildAncestors(a, b, cfg.breeding.inbreeding.generations);

  // 6. 性别与出生时间
  const gender = rng.chance(0.5) ? 'male' : 'female';
  const bornAt = now;
  const stage = 'egg';
  const hatchAt = now + cfg.breeding.hatchMs;

  return {
    id: newId(),
    speciesId, elementId,
    genome: {
      stats,
      speciesAlleles: [a.speciesId, b.speciesId],
      elementAlleles: [a.elementId, b.elementId],
      traitAlleles: buildTraitAlleles(traits, hiddenTraits),
      mutationCount: mutations,
    },
    traits, hiddenTraits, gender, generation,
    parents: [a.id, b.id],
    ancestors,
    bornAt,
    stage,
    stageChangedAt: bornAt,
    level: 1,
    exp: 0,
    condition: { hunger: 100, mood: 100, hygiene: 100, health: 100 },
    fertility: {
      readyAt: hatchAt + cfg.breeding.juvenileMs,
      cooldownUntil: 0,
      penalty: inbred ? cfg.breeding.inbreeding.fertilityPenalty : 0,
    },
    habitatId: null,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}
```

### 8.2.1 辅助函数

```ts
// 近似标准正态，均值 0、方差 1；只用加法，跨平台一致
function gaussian(rng: Rng): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += rng();
  return sum - 6;
}

// 显性特质进 traits，隐性进 hiddenTraits；超出上限时按稀有度/配置优先级裁剪
function capTraits(list: Id[], max: number): void {
  if (list.length <= max) return;
  list.sort((a, b) => rarityRank(b) - rarityRank(a));
  list.length = max;
}

function buildTraitAlleles(expressed: Id[], hidden: Id[]): TraitAllele[] {
  return [
    ...expressed.map(traitId => ({ traitId, dominant: true })),
    ...hidden.map(traitId => ({ traitId, dominant: false })),
  ];
}
```

> 辅助函数 `groupBy`、`dedupeKeepMinDepth`、`rarityRank`、`newId` 按常规实现；`newId` 在客户端用本地临时 ID，正式 ID 由服务器生成。
> `traits`/`hiddenTraits` 在返回前用 `Set` 去重；`mutationCount` 只统计元素/特质突变，基因波动不算突变。

### 8.3 近亲判定

```ts
function isInbred(a, b, maxDepth): boolean {
  const aSet = new Set([a.id, ...a.ancestors.filter(x => x.depth <= maxDepth).map(x => x.id)]);
  const bSet = new Set([b.id, ...b.ancestors.filter(x => x.depth <= maxDepth).map(x => x.id)]);
  return [...aSet].some(id => bSet.has(id));
}
```

- 共同祖先在任一方 3 代以内 → 近亲。
- 子代 `fertility.penalty = 0.2`；繁殖冷却延长为 `cooldownMs × (1 + penalty)`。MVP 不做受孕失败，避免玩家反复失败。
- 老年繁殖力 ×0.5 同样体现为冷却 ×2（与近亲惩罚相乘）。
- UI 必须显示共同祖先或“近亲”警告。

### 8.4 祖先构建

```ts
function buildAncestors(a, b, maxDepth): AncestorRef[] {
  const out: AncestorRef[] = [
    { id: a.id, depth: 1 },
    { id: b.id, depth: 1 },
  ];
  for (const parent of [a, b]) {
    for (const ref of parent.ancestors) {
      const depth = ref.depth + 1;
      if (depth <= maxDepth) out.push({ id: ref.id, depth });
    }
  }
  return dedupeKeepMinDepth(out);
}
```

### 8.5 孵化

- 蛋的阶段推进见 §5.1；孵化后进入幼年。
- 孵化不需要玩家在线；服务器在 `advanceProfile` 时自动推进。
- 孵化结果在创建时已经确定并落库，客户端只做揭晓动画，不能重roll。

### 8.6 放生

宠物不会死亡；放生是玩家主动的资源回收，不可撤销。

```ts
function releasePet(
  profile: Profile,
  petId: PetId,
  now: EpochMs,
): { profile: Profile; refund: ResourceBag } {
  const pet = profile.pets[petId];
  if (!pet) throw new ReleaseError('pet_not_found');
  if (pet.stage === 'egg') throw new ReleaseError('cannot_release_egg');
  if (pet.locked) throw new ReleaseError('pet_locked');
  if (profile.lineup.includes(petId)) throw new ReleaseError('in_lineup');
  if (profile.pvp.defense.includes(petId)) throw new ReleaseError('in_defense');
  if (pet.habitatId) throw new ReleaseError('in_habitat');
  if ((pet.stage === 'adult' || pet.stage === 'elder') && countAdults(profile) <= 1) {
    throw new ReleaseError('last_adult');
  }

  const refund: ResourceBag = { geneDust: releaseValue(pet) };
  delete profile.pets[petId];
  profile.stats.released += 1;
  // 图鉴的 owned 保持 true，不因放生回退
  return { profile, refund };
}

function releaseValue(pet: PetInstance): number {
  const geneSum =
    pet.genome.stats.hp + pet.genome.stats.atk +
    pet.genome.stats.def + pet.genome.stats.spd;
  const rarityBonus = pet.traits.reduce(
    (sum, id) => sum + ({ common: 1, rare: 3, epic: 8 }[rarity(id)]),
    0,
  );
  return Math.max(1, Math.floor(5 + pet.level * 2 + geneSum / 10 + rarityBonus));
}
```

- 放生前必须移出编队、PvP 防守阵容和栖息地；锁定宠物不可放生（`in_defense` 为 contract-v1.3 D-11）。
- 至少保留 1 只成年宠物，避免软锁；`countAdults` 统计成年 + 老年。老年可放，但不能放走最后一只可战斗/可繁殖的宠物。
- 蛋不可放生，避免“刷蛋/退成本”。
- 放生返还以基因尘为主，数值配置化；服务器写审计日志。
- 放生不会清空图鉴的“已拥有”记录。

---

## 9. 战斗输入

```ts
interface BattleUnitInit {
  uid: string;              // "a0" / "b0"
  petId: PetId;
  speciesId: Id;
  elementId: ElementId;
  level: number;
  stats: StatBlock;         // deriveStats 结果
  skills: Id[];             // [普攻, 小技能, 大招, 物种技能]
  traits: Id[];             // 影响战斗的特质
  passiveId?: Id;           // 物种被动；statMods 已计入 stats，effects 开场一次性应用
}

interface BattleSetup {
  seed: number;
  teams: [BattleUnitInit[], BattleUnitInit[]];
}
```

- `buildBattleSetup` 不读全局状态，只接收个体快照和配置。
- `buildPveBattleSetup(party, stage, cfg, seed)`（contract-v1.3 D-10）：`team0` = 玩家队伍（uid `a*`）、
  `team1` = `buildEnemyTeam(stage, cfg, seed)`（uid `b*`）；同一输入必然同一输出。
- 状态差的宠物属性会被降低；这是圈养与战斗的连接点。
- PvP 防守快照保存 `BattleSetup` 或可重建的个体快照；建议保存 `BattleUnitInit[]`，避免后续配置变更影响历史战报。

### 9.1 战斗状态与事件

```ts
interface BattleState {
  seed: number;
  turn: number;             // 1 起，>30 平局
  units: BattleUnit[];
  order: string[];
  cursor: number;
  phase: 'ongoing' | 'finished';
  winner: 0 | 1 | null;
  log: BattleEvent[];
}

type BattleEvent =
  | { type: 'battleStart'; state: BattleState }
  | { type: 'turnStart'; turn: number; order: string[] }
  | { type: 'cast'; uid: string; skillId: Id; targets: string[] }
  | { type: 'hit'; src: string; dst: string; damage: number; crit: boolean; countered: 1.25 | 0.85 | 1.0 }
  | { type: 'miss'; src: string; dst: string }
  | { type: 'heal' | 'shield' | 'buffApply' | 'buffExpire' | 'dotTick' | 'energyTick'; ... }
  | { type: 'death'; uid: string }
  | { type: 'battleEnd'; winner: 0 | 1 | null; turns: number };
```

- 每条事件带 `turn` 和递增 `seq`。
- 回放 = `{ setup, seed, commands }`，事件流不作为回放依赖。

### 9.2 同速排序

```
按 SPD 降序；同速时按 (team 交替, 槽位) 或种子决定，禁止固定 0 队优先。
```

推荐：`sortKey = (-spd, tieBreaker)`，`tieBreaker` 由 seed 生成的随机序预先确定，保证确定性且中立。

### 9.3 回合结算顺序

```
回合开始（每轮）：
  1. 全体精力 +20，clamp 到 100
  2. DOT 结算（按施加顺序）
  3. buff/debuff 计时递减，移除过期
  4. 重排行动序（SPD 降序，同速用中立 tiebreaker）

单个行动：
  1. 指令校验：回合/存活/轮到/精力/目标合法
  2. 效果结算：命中判定 → 伤害/治疗/护盾 → 附加状态（chance）
  3. 精力结算：技能扣 cost；普攻命中 +10
  4. 死亡检查：产出 death；行动方死亡则跳过其后续
  5. cursor 前进；本轮走完进入下一轮
```

- **初始精力 0**。
- 同类 buff 不叠加，只刷新时长与数值（取更强）。
- 眩晕：轮到该单位时跳过行动，当回合消耗。
- DOT 不占行动。
- 一方全灭 → `finished`；`turn > 30` → 平局。

### 9.4 敌方快照生成

```
buildEnemySetup(stage, cfg, seed):
  for enemy in stage.enemies:
    species = cfg.species(enemy.speciesId)
    element = cfg.element(enemy.elementId)
    stats = buildStats(
      base = species.base,
      level = enemy.level,
      geneQuality = enemy.geneQuality,   // 映射到四项基因
      condition = 100,                    // 敌方按满状态
      affinity = cfg.affinity(element, species),
    )
    skills = [normal, element.skillPool[0], element.skillPool[1], species.signatureSkillId]
    traits = pickTraits(enemy.traits, seed, enemyIndex)
    passiveId = species.passiveId
```

- 敌方快照由 `StageConfig.enemies` + 战斗种子确定性生成；同一关卡/种子必须得到同一队伍。
- MVP 关卡只使用龟/鱼/青蛙/猫/蛇 5 个物种；后续物种不进 MVP 关卡配置。
- 技能固定为“普攻 + 属性小技能 + 属性大招 + 物种技能”。
- 特质按配置的 `traits` 选取；`geneQuality` 映射到四项基因（初版四项相同，后续可细化）。
- 生成结果是 `BattleUnitInit[]`，保存进战报；配置变更不回溯历史战报。

---

## 10. 经济

```ts
type ResourceId = 'coin' | 'food' | 'geneDust' | 'premium';
type ResourceBag = Partial<Record<ResourceId, number>>;
interface ResourceCost { resource: ResourceId; amount: number; }
interface ResourceRate { resource: ResourceId; amountPerHour: number; }
```

- 软资源：`coin`、`food`、`geneDust`。
- `premium` 在 Demo 阶段不启用；正式版商业化确定后再开。
- 放生返还基因尘，公式见 §8.6。
- 所有收支走 `applyCost/applyGain`，检查非负和整数。
- 产出、繁殖、升级的数值全部配置化。
- 反通胀：产出入上限、升级成本递增、离线封顶、无货币交易。

---

## 11. Profile

```ts
interface Profile {
  version: number;              // 存档结构版本
  accountId: string;
  revision: number;             // 服务器乐观锁
  createdAt: EpochMs;
  lastEvaluatedAt: EpochMs;

  currencies: Record<ResourceId, number>;
  pets: Record<PetId, PetInstance>;
  habitats: Record<HabitatId, HabitatInstance>;

  codex: Record<string, {
    seen: boolean;
    owned: boolean;
    bestGene: number;           // 四项基因均值，0~100
  }>;                           // key = `${speciesId}:${elementId}`

  lineup: PetId[];              // 战斗队伍，最多 3
  stageProgress: Record<Id, {
    cleared: boolean;
    bestTurns?: number;
    firstClearAt?: EpochMs;
  }>;

  breeding: {
    eggs: PetId[];
    cooldowns: Record<PetId, EpochMs>;
  };

  pvp: {
    defense: PetId[];
    rating: number;
    seasonId: string;
  };

  settings: { sfx: boolean; bgm: boolean };
  stats: {
    battlesWon: number;
    battlesLost: number;
    breeds: number;
    hatchlings: number;
    mutations: number;
    released: number;
  };
}
```

- 服务端为权威；客户端缓存用于展示。
- `revision` 每次写操作 +1。
- 迁移链见 `TECH_DESIGN.md`。

---

## 12. 不变量

以下条件在每次写入/读取时校验，失败即拒绝并记录：

1. `pets` 的 key 与 `pet.id` 一致；ID 唯一。
2. 所有引用（`habitatId`、`lineup`、`parents`、`ancestors`）存在或允许为空。
3. 货币为整数且 ≥0。
4. 基因 0~100；条件 0~100；`health >= 1`；等级 1~20。
5. 栖息地槽位长度 = 容量；一个宠物只能在一个槽位。
6. `lastEvaluatedAt` 单调不减，且不晚于服务器时间 + 容差。
7. 阶段与时间戳一致（蛋的 `stageChangedAt + hatchMs` 已过则应为幼年）。
8. 没有 `NaN`/`Infinity`。
9. 战斗日志 `seq` 严格递增。
10. 繁殖/战斗/奖励操作有幂等键。
11. `codex` 的 key 为 `speciesId:elementId`，且物种/属性存在；`seen`/`owned` 只能由 false 变 true，不因放生回退。
12. 放生后宠物从 `pets`、栖息地槽位、`lineup` 中清理干净；至少保留 1 只成年宠物。
13. `lineup` 最多 3 只、属于本人、非蛋；引用必须存在；幼年可上阵（属性 70%）。
14. 战斗初始精力 0；`energy` 始终在 0~100。

---

## 13. 示例：雷鱼 × 火猫

- 雷鱼：物种鱼、属性雷；基因 ATK 70。
- 火猫：物种猫、属性火；基因 ATK 60。
- 子代物种 50/50 → 鱼；属性 50/50 → 火（或雷）。
- 若抽到“鱼 + 火” → **火鱼**，相性冲突（火 × 鱼 = -1），全基础属性 -10%。
- ATK 基因 ≈ (70+60)/2 + 波动 ≈ 65 ± 8，限制 0~100。
- 代数 = max(1,1)+1 = 2。
- 若双方有共同祖先且在 3 代内 → 基因 -5、突变 +2%、繁殖力 -20%，UI 警告。

这个例子是 MVP 的繁殖教学：玩家会第一次直观看到“相性冲突”的代价。

---

## 14. 待确认问题

1. 特质显隐性模型是否够用，还是需要更细的等位基因/多基因。
2. 是否允许杂交物种（如龟 × 鱼），还是只继承父母之一。
3. 基因波动标准差 8 是否合适；突变率是否要按代数调整。
4. 离线衰减 24 小时上限是否足够宽容。
5. 放生返还公式是否需要按代数/稀有特质再调。

---

## 15. 实现说明（contract-v1.3，A 会话）

> 本节只记录 `packages/core` 的实现口径，不改变 §1~§13 的产品规则。

### 15.1 派生属性（§4.1）

- `hp/atk/def/spd`：`floor(base × levelMul × stageMul × geneMul × condMul × traitMul × passiveMul × affinityMul)`。
- `crit/critDmg/dodge`：只乘 `condMul/traitMul/passiveMul`，**保留 4 位小数**后 clamp（`crit 0~1`、`dodge 0~0.9`）。
  若对这些比例值也 `floor`，`0.05 × 1.06 = 0` 会把暴击率直接抹平；DOMAIN §1「倍率保留 4 位小数」按此执行。
- `hit`（D-13）：`(base.hit + Σ traitMods.hit + Σ passiveMods.hit) × condMul`，保留 4 位小数后 clamp ±0.5；
  `statMods.hit = 0.02` 表示 +2 个百分点，不再是乘数。schema 仍要求 `statMods` 数值 > 0。
- 蛋阶段 8 项全部返回 0（不参与战斗与产出）。
- 暴击倍率：`150%` 是基础值，`condMul`/特质/被动会修正它（contract-v1.2 D-04 已裁定，见 §4.1）。

### 15.2 时间推进（§5/§6/§7）

- `advancePet`：只做阶段推进（`egg → juvenile → adult → elder`，长时间离线可一次跨多级，`stageChangedAt` 落在阈值时刻）与 `updatedAt`；繁殖冷却 `cooldownUntil` 是绝对时间戳，到期即可繁殖，无需清零。
- 状态衰减依赖栖息地的 `conditionDecayPerHour`，而个体只持有 `habitatId`（实例 id，不是 configId），
  所以衰减在 `advanceProfile` 内、产出之前完成（等价于「先宠物、后栖息地」）：先按宠物所在栖息地找配置，衰减 `decayCapMs` 封顶的时长，再用推进后的状态算产出。
- 产出：`dtHours` 不截断到整小时（不足 10 分钟按比例算），每个资源单独 `floor`；宠物数为 0 或全为蛋时产出 0。
  阶段产出系数读 `habitat.productionStageMul`，缺省 0.5 / 1 / 0.8（contract-v1.2 D-06）。
- 消耗：每只非蛋宠物按 `upkeepPerPetPerHour × dtHours` 从 `habitat.stored` 扣，不足时归零、欠账不跨期。
  food 有缺口且配置了 `hungerPenaltyWhenNoFoodPerHour` 时，每只非蛋宠物额外扣 `rate × dtHours` 饥饿（缺省 0，contract-v1.2 D-05）。
  该扣减在 `advanceHabitat` 内**就地**写入传入的宠物（契约签名不返回宠物；`advanceProfile` 传的是副本）。
- `advanceProfile` 不改入参：返回新的 `profile` 与 `patch`；有变化才 `revision + 1`，同一 `now` 第二次调用 patch 不含 upsert。

### 15.3 建个体 / 升级（§3/§8）

- `createPet`：校验 species/element 存在、`level` 为 1~20 整数；四项基因四舍五入后 clamp 0~100；`traits/hiddenTraits` 去重。
  新个体一律 `stage = 'egg'`、`bornAt = stageChangedAt = now`、`fertility.readyAt = now + hatchMs + juvenileMs`、
  `cooldownUntil = 0`、`penalty = 0`、状态全 100、`parents` 缺省 `[null, null]`、`ancestors` 缺省 `[]`。
- `applyExp(pet, amount, cfg)`（contract-v1.2 D-07）：`exp += amount`，然后
  `while (level < 20 && exp >= expToNext(level)) { exp -= expToNext(level); level++ }`；满级后经验继续保留。
  `amount <= 0` 或非有限值原样返回；不碰 `stageProgress`/首通奖励（服务端结算）。`cfg` 目前是签名保留位。

### 15.4 繁殖 / 放生（§8）

- `breed` 的 rng 消费顺序固定：物种 pick → 属性 pick → 属性突变 chance(+pick) → 四项基因各 12 次 → 隐性特质 chance → 特质突变 chance(+pick) → 性别 chance。改动顺序等于改确定性。
- 子代 `id` 用 `egg_{a.id}_{b.id}_{now}`（正式 id 由服务器生成）；`mutationCount` 只统计属性/特质突变。
- 父母冷却：`cooldownMs × (1 + 近亲惩罚) × (老年 ×2)`，由 `BreedResult.parentCooldowns: [a, b]` 直接返回（contract-v1.2 D-02），服务端直接落库。
- `checkBreeding` 的「空位」= 存档内各栖息地实例当前等级容量之和；占位 = 宠物数 + 蛋数。
- `releasePet(profile, petId, now, cfg)`（contract-v1.2 D-01）：返还按 `economy.releaseRefund` 全量计算，
  `max(1, floor(base + level×perLevel + geneSum÷perGeneSumDivisor + Σ traitRarityBonus))`；配置中已删除的特质按 0 计。

### 15.5 战斗（§9）

- 指令驱动：`submit` 推进当前行动者的一个动作，返回该步事件（含回合切换、精力、DOT、buff 计时、重排）。
  `availableCommands(uid)` 只在轮到该单位时非空，按「技能顺序 × 合法目标」展开，最后附 `surrender`。
- `BattleEngine.autoCommand(uid)`（contract-v1.2 D-03）：内置确定性 AI 的公开入口，与引擎内部选择逻辑是**同一份实现**；
  未轮到该单位或战斗已结束时抛错。
- AI 留能量策略（contract-v1.3 D-09）：队友血量 <50% 且能治疗 → 治疗；否则有大招且精力够 → 大招；
  精力 ≥ 最便宜大招 cost − 20 → 普攻攒能量（不再乱放小技能）；否则精力够小技能 → 小技能；否则普攻。
- 精力：创建时 0，第 1 回合开始即 +20；普攻命中 +10；技能在伤害结算后扣 cost（与 §9.3 顺序一致）。
- 伤害：命中 = `clamp(0.90 + hit − dodge, 0.05, 1)`；暴击 `rng() < crit`，倍率取 `stats.critDmg`；
  克制由 `ConfigRepo.counterMultiplier` 给 1.25/0.85/1；浮动 `0.95 + rng()×0.10`；最后 `floor`。
- 同速：创建时用独立种子流 `seed ^ 0x9E3779B9` 给每个单位分配随机 tiebreaker，排序键 `(-spd, tiebreak, uid)`；交换队伍不影响分布（P-004）。
- 状态：`stun` 在轮到该单位时消耗并跳过；`silence` 禁主动技能；`slow/debuff/buff` 按 `stat` 修正 atk/def/spd；`dot` 在回合开始按施加顺序结算；`shield` 优先吸收伤害。
  同类 buff 不叠加，取更强数值并刷新更长时间。技能效果未填 `target` 时跟随技能目标；被动开场效果必须带 `target`。
- 30 回合：第 30 回合结算完仍未分胜负 → `battleEnd { winner: null, turns: 30 }`。
- `battleStart` 内嵌的 `state` 是**不含日志**的快照，避免循环引用。

### 15.6 剩余待办（非阻塞）

| 项 | 说明 | 建议 |
|---|---|---|
| 技能 `cooldown`（回合）未实现 | 配置里有该字段但 MVP 数据未用 | MVP 明确忽略；后续加独立冷却表 |
| 食物不足惩罚只按“有无缺口”判定 | D-05 字段名是 `WhenNoFoodPerHour`，未按缺口大小缩放 | 若要做“欠多少扣多少”，需要新系数，再改一行 |

### 15.7 栖息地操作（D-12）

六个函数都返回 `{ profile, patch }`：不改入参；`patch.fromRevision = patch.toRevision = profile.revision`
（revision 由服务端写操作统一 +1）；`patch.at = now`；`patch.lastEvaluatedAt` = 存档当前值（时间推进仍由 `advanceProfile` 负责）。
`now < profile.lastEvaluatedAt` 抛 `TimeError('time_backwards')`。

| 函数 | 行为 | 失败 code |
|---|---|---|
| `movePetToHabitat(profile, petId, habitatId \| null, now, cfg)` | 放入/移出；先从所有槽位清除该宠物（保证唯一占位），再找空位；同一栖息地重复放入幂等 | `pet_not_found` / `egg_not_allowed` / `habitat_not_found` / `capacity_full` / `slot_conflict` |
| `feedPet(profile, petId, foodId, now, cfg)` | 扣 `FoodConfig.cost`，`hunger += nutrition`、`mood += mood`，clamp 100 | `pet_not_found` / `egg_not_allowed` / `food_not_found` / `insufficient_resources` |
| `cleanPet(profile, petId, now, cfg)` | `hygiene += careRecovery.clean`（缺省 20），不消耗资源 | `pet_not_found` / `egg_not_allowed` |
| `playWithPet(profile, petId, now, cfg)` | `mood += careRecovery.play`（缺省 20），不消耗资源 | `pet_not_found` / `egg_not_allowed` |
| `upgradeHabitat(profile, habitatId, now, cfg)` | 扣下一级 `cost`，`level + 1`，slots 补齐到新容量 | `habitat_not_found` / `max_level` / `insufficient_resources` / `slot_conflict` |
| `collectHabitat(profile, habitatId, now, cfg)` | `stored` 转入 `currencies`；货币按整数入账，小数零头保留在 `stored` | `habitat_not_found` |

- 失败抛 `Error`：`name = 'HabitatError'`，`code` 为上表字符串；服务端按 code 映射协议错误码。
- `careRecovery` 取宠物所在栖息地的 `HabitatConfig.careRecoveryPerAction`；不在栖息地时用缺省 20 / 20。

### 15.8 PvE 入口（D-10）

- `buildPveBattleSetup(party, stage, cfg, seed)`：`team0` 复用 `buildBattleSetup`（uid `a*`，最多 3 只），
  `team1` 复用 `buildEnemyTeam`（uid `b*`）；只做组合，不新增数值规则。

