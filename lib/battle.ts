import type { DisplayCard } from "@/lib/cards";
import { cardPassesBattleValidation } from "@/lib/cards";
import type { ScannedAttack, StatusCondition } from "@/lib/types";

/** Standard Pokémon TCG type chart — fallback when printed weakness is missing. */
const STANDARD_WEAKNESSES: Record<string, string[]> = {
  Fire: ["Grass", "Ice", "Bug", "Steel"],
  Water: ["Fire", "Rock", "Ground"],
  Grass: ["Water", "Rock", "Ground"],
  Electric: ["Water", "Flying"],
  Psychic: ["Fighting", "Poison"],
  Fighting: ["Normal", "Ice", "Rock", "Dark", "Steel"],
  Ice: ["Grass", "Ground", "Flying", "Dragon"],
  Rock: ["Fire", "Ice", "Flying", "Bug"],
  Ground: ["Fire", "Electric", "Poison", "Rock", "Steel"],
  Flying: ["Grass", "Fighting", "Bug"],
  Bug: ["Grass", "Psychic", "Dark"],
  Ghost: ["Psychic", "Ghost"],
  Dragon: ["Dragon"],
  Dark: ["Psychic", "Ghost"],
  Steel: ["Ice", "Rock", "Fairy"],
  Fairy: ["Fighting", "Dragon", "Dark"],
  Poison: ["Grass", "Fairy"],
};

export type BattleSide = "yours" | "theirs";

export type FightResult = {
  fightNumber: number;
  winner: BattleSide;
  feedLine: string;
  narrative: string;
  finalCard: string;
  turnsPlayed: number;
  mainTitle: string;
  subDetail: string;
  winnerPokemonName: string;
  loserPokemonName: string;
  winningMoveName: string | null;
  hadCriticalHit: boolean;
  wasCloseFight: boolean;
  wasDominant: boolean;
  tickerPhrases: string[];
  hadMiss: boolean;
  decidedByTime: boolean;
  wasUpset: boolean;
  weaknessCritCombo: boolean;
  hadMomentumShift: boolean;
};

export type BattleSimulationResult = {
  results: FightResult[];
  summary: {
    yourWins: number;
    theirWins: number;
    overallWinner: BattleSide | "tie";
    summaryText: string;
    dramaticMoment: string | null;
    starPerformerName: string | null;
    starPerformerSide: BattleSide | null;
    finalTickerCallout: string;
  };
};

type InternalFighter = {
  name: string;
  type: string;
  maxHp: number;
  hp: number;
  attacks: ScannedAttack[];
  weakness: string | null;
  weaknessMultiplier: number | null;
  resistance: string | null;
};

function assertBattleRoster(cards: DisplayCard[], label: string) {
  for (const c of cards) {
    if (!cardPassesBattleValidation(c)) {
      throw new Error(
        `[Battle] Invalid roster (${label}): "${c.name}" is missing required battle stats`,
      );
    }
  }
}

function normType(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Maps Pokémon TCG printed / OCR type labels to keys used by STANDARD_WEAKNESSES.
 * Cards print Lightning, Darkness, Metal, Colorless; the chart uses Electric, Dark, Steel, Normal.
 */
const TCG_TYPE_CHART_ALIASES: Record<string, string> = {
  Lightning: "Electric",
  Electric: "Electric",
  Darkness: "Dark",
  Dark: "Dark",
  Metal: "Steel",
  Steel: "Steel",
  Colorless: "Normal",
  Normal: "Normal",
};

const TYPE_NORMALIZATION_HINT =
  "Lightning→Electric, Darkness→Dark, Metal→Steel, Colorless→Normal";

function canonicalTcgType(type: string): string {
  const t = type.trim();
  if (!t || t === "?") return "";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** Normalize scanned/printed type labels to chart keys (e.g. Lightning → Electric). */
function chartTypeKey(type: string): string {
  const c = canonicalTcgType(type);
  return TCG_TYPE_CHART_ALIASES[c] ?? c;
}

function isRecognizedTcgType(type: string): boolean {
  const key = chartTypeKey(type);
  if (!key) return false;
  if (key in STANDARD_WEAKNESSES || key === "Normal") return true;
  return Object.values(STANDARD_WEAKNESSES).some((targets) =>
    targets.includes(key),
  );
}

/** Ignore OCR garbage on weakness/resistance so the standard chart fallback can apply. */
function getEffectivePrintedType(field: string | null): string | null {
  if (!field?.trim()) return null;
  const trimmed = field.trim();
  return isRecognizedTcgType(trimmed) ? trimmed : null;
}

function typesMatch(attackerType: string, defenderField: string | null): boolean {
  if (!defenderField?.trim()) return false;
  const a = normType(chartTypeKey(attackerType));
  const b = normType(chartTypeKey(defenderField));
  if (!a || a === "?" || !b) return false;
  return a === b;
}

function resolveResistanceReduction(
  attacker: Pick<InteractiveFighter, "type">,
  defender: Pick<InteractiveFighter, "resistance">,
): { isResistance: boolean; reduction: number } {
  const printedRes = getEffectivePrintedType(defender.resistance);
  if (printedRes && typesMatch(attacker.type, printedRes)) {
    return { isResistance: true, reduction: 30 };
  }
  return { isResistance: false, reduction: 0 };
}

function weaknessFromTypeChart(
  attacker: Pick<InteractiveFighter, "type">,
  defender: Pick<InteractiveFighter, "type">,
): { isWeakness: boolean; weaknessMultiplier: number } {
  const attackerType = chartTypeKey(attacker.type);
  const defenderType = chartTypeKey(defender.type);
  if (
    attackerType &&
    defenderType &&
    (STANDARD_WEAKNESSES[attackerType] ?? []).includes(defenderType)
  ) {
    return { isWeakness: true, weaknessMultiplier: 2 };
  }
  return { isWeakness: false, weaknessMultiplier: 1 };
}

function describeWeaknessResolution(
  attacker: Pick<InteractiveFighter, "type">,
  defender: Pick<
    InteractiveFighter,
    "type" | "weakness" | "weaknessMultiplier"
  >,
  result: { isWeakness: boolean },
): string {
  if (!result.isWeakness) {
    return "No super-effective weakness this turn.";
  }
  const chart = weaknessFromTypeChart(attacker, defender);
  if (chart.isWeakness) {
    return `Type matchup chart (${chartTypeKey(attacker.type)} → ${chartTypeKey(defender.type)}).`;
  }
  const printed = getEffectivePrintedType(defender.weakness);
  if (printed && typesMatch(attacker.type, printed)) {
    return `Printed weakness line (${defender.weakness} → ${chartTypeKey(printed)}).`;
  }
  return "Weakness applied.";
}

function toFighter(card: DisplayCard): InternalFighter {
  if (!cardPassesBattleValidation(card)) {
    throw new Error(`[Battle] Card not battle-ready: ${card.name}`);
  }
  const attacks = card.attacks!.filter(
    (a) => typeof a.damage === "number" && Number.isFinite(a.damage) && a.damage > 0,
  );
  if (attacks.length === 0) {
    throw new Error(`[Battle] No damaging attacks on card: ${card.name}`);
  }
  return {
    name: card.name,
    type: card.type.trim(),
    maxHp: card.battleHp!,
    hp: card.battleHp!,
    attacks,
    weakness: card.weakness,
    weaknessMultiplier: card.weaknessMultiplier,
    resistance: card.resistance,
  };
}

function sortTeam(cards: DisplayCard[]): InternalFighter[] {
  const fighters = cards.map(toFighter);
  fighters.sort((a, b) => b.maxHp - a.maxHp);
  return fighters;
}

function pickAttack(attacks: ScannedAttack[]): ScannedAttack {
  let best = attacks[0]!;
  let minE = best.energyCost;
  let maxD = best.damage;
  for (const a of attacks) {
    if (a.energyCost < minE) {
      minE = a.energyCost;
      maxD = a.damage;
      best = a;
    } else if (a.energyCost === minE && a.damage > maxD) {
      maxD = a.damage;
      best = a;
    }
  }
  return best;
}

function minEnergyCost(attacks: ScannedAttack[]): number {
  return Math.min(...attacks.map((a) => a.energyCost));
}

function maxDamageAtMinEnergy(attacks: ScannedAttack[]): number {
  const m = minEnergyCost(attacks);
  return Math.max(...attacks.filter((a) => a.energyCost === m).map((a) => a.damage));
}

/** Faster side goes first by printed energy / damage — no random tie-break here. */
function firstAttackerSide(a: InternalFighter, b: InternalFighter): BattleSide {
  const ae = minEnergyCost(a.attacks);
  const be = minEnergyCost(b.attacks);
  if (ae < be) return "yours";
  if (be < ae) return "theirs";
  const ad = maxDamageAtMinEnergy(a.attacks);
  const bd = maxDamageAtMinEnergy(b.attacks);
  if (ad > bd) return "yours";
  if (bd > ad) return "theirs";
  return "yours";
}

function applyWeaknessResistance(
  amount: number,
  attacker: InternalFighter,
  defender: InternalFighter,
): { final: number; weak: boolean; resist: boolean } {
  if (amount <= 0) {
    return { final: 0, weak: false, resist: false };
  }
  let d = amount;
  let weak = false;
  let resist = false;
  if (typesMatch(attacker.type, defender.weakness)) {
    const mult = defender.weaknessMultiplier;
    if (mult != null && mult > 0 && Number.isFinite(mult)) {
      d = Math.floor(d * mult);
      weak = true;
    }
  }
  if (typesMatch(attacker.type, defender.resistance)) {
    d = Math.max(0, d - 30);
    resist = true;
  }
  return { final: Math.max(0, Math.floor(d)), weak, resist };
}

/** Inclusive random integer in [lo, hi]. */
function randInt(lo: number, hi: number): number {
  const a = Math.ceil(Math.min(lo, hi));
  const b = Math.floor(Math.max(lo, hi));
  if (b < a) return a;
  return a + Math.floor(Math.random() * (b - a + 1));
}

function rollVarianceDamage(base: number): number {
  const lo = Math.floor(base * 0.75);
  const hi = Math.floor(base * 1.25);
  return randInt(lo, hi);
}

function words(s: string, max = 14): string {
  const w = s.trim().split(/\s+/).filter(Boolean);
  if (w.length <= max) return w.join(" ");
  return w.slice(0, max).join(" ") + "…";
}

type NarrativeCtx = {
  decidedByTime: boolean;
  hadMiss: boolean;
  hadCrit: boolean;
  weaknessCritCombo: boolean;
  hadMomentumShift: boolean;
  wasUpset: boolean;
  dominantHealth: boolean;
  hangingWin: boolean;
  hadWeakness: boolean;
  winnerName: string;
  loserName: string;
  moveName: string | null;
  turnsPlayed: number;
};

function buildMainTitle(ctx: NarrativeCtx): string {
  if (ctx.decidedByTime) {
    return words("What a battle! Had to go to the judges! ⏱");
  }
  if (ctx.weaknessCritCombo) {
    return words("WEAKNESS + CRIT! Massive damage! 🔥💥");
  }
  if (ctx.hangingWin) {
    return words(`Hanging on by a thread! 😰 So close! ${ctx.winnerName} pulled it off!`);
  }
  if (ctx.dominantHealth) {
    return words("Total domination! Wasn't even close! 💪");
  }
  if (ctx.wasUpset) {
    return words("Nobody saw that coming! What an upset! 🤯");
  }
  if (ctx.hadMiss) {
    return words(`${ctx.winnerName} stayed cool after a wild miss and still won!`);
  }
  if (ctx.moveName) {
    return words(`${ctx.winnerName} sealed it with ${ctx.moveName}!`);
  }
  return words(`${ctx.winnerName} took ${ctx.loserName} down in a fierce fight!`);
}

function buildSubDetail(ctx: NarrativeCtx): string {
  const bits: string[] = [];
  if (ctx.decidedByTime) {
    bits.push("Time's up! Closest HP wins this one! ⏱");
  }
  if (ctx.hadCrit) bits.push("CRITICAL HIT! That one really hurt! 💥");
  if (ctx.hadMiss) bits.push("Oh no — the attack missed completely! 😬");
  if (ctx.hadMomentumShift) bits.push("Quick move! They struck first! ⚡");
  if (ctx.hadWeakness && !ctx.weaknessCritCombo) {
    bits.push("Super effective! That did double damage! 🎯");
  }
  bits.push(`Fight wrapped in ${ctx.turnsPlayed} turns`);
  return bits.join(" · ");
}

function buildTickerPhrases(
  winnerName: string,
  loserName: string,
  moveName: string | null,
  ctx: NarrativeCtx,
): string[] {
  const a =
    ctx.hadMomentumShift && Math.random() < 0.5
      ? "Quick move! They struck first! ⚡"
      : words(`${winnerName} attacks! 💥`);
  const b = ctx.hadMiss
    ? "Oh no — the attack missed completely! 😬"
    : ctx.hadCrit
      ? "CRITICAL HIT! That one really hurt! 💥"
      : moveName
        ? words(`${winnerName} fires ${moveName}! ⚡`)
        : words(`${winnerName} pushes hard! 🔥`);
  const c = ctx.decidedByTime
    ? "What a battle! Had to go to the judges! ⏱"
    : words(`${loserName} is down! 😱`);
  return [a, b, c];
}

function makeFightResult(
  fightNumber: number,
  winner: BattleSide,
  winnerName: string,
  loserName: string,
  moveName: string | null,
  turnsPlayed: number,
  ctx: NarrativeCtx,
  narrativeLines: string[],
): FightResult {
  const mainTitle = buildMainTitle(ctx);
  const subDetail = buildSubDetail(ctx);
  const narrative = narrativeLines.length
    ? words(narrativeLines.slice(-6).join(" "))
    : words(`${mainTitle} ${subDetail}`);
  const feedLine = `${winner === "yours" ? "Blue" : "Gold"} took fight ${fightNumber}!`;
  const tickerPhrases = buildTickerPhrases(winnerName, loserName, moveName, ctx);
  return {
    fightNumber,
    winner,
    feedLine,
    narrative,
    finalCard: winnerName,
    turnsPlayed,
    mainTitle,
    subDetail,
    winnerPokemonName: winnerName,
    loserPokemonName: loserName,
    winningMoveName: moveName,
    hadCriticalHit: ctx.hadCrit,
    wasCloseFight: ctx.hangingWin,
    wasDominant: ctx.dominantHealth,
    tickerPhrases,
    hadMiss: ctx.hadMiss,
    decidedByTime: ctx.decidedByTime,
    wasUpset: ctx.wasUpset,
    weaknessCritCombo: ctx.weaknessCritCombo,
    hadMomentumShift: ctx.hadMomentumShift,
  };
}

function runSingleFight(
  yourTeam: InternalFighter[],
  theirTeam: InternalFighter[],
  fightNumber: number,
): FightResult {
  const yours = yourTeam.map((f) => ({ ...f, hp: f.maxHp }));
  const theirs = theirTeam.map((f) => ({ ...f, hp: f.maxHp }));

  let yi = 0;
  let ti = 0;
  let yActive = yours[yi];
  let tActive = theirs[ti];
  if (!yActive || !tActive) {
    throw new Error("[Battle] Empty team in fight — roster should be validated first");
  }

  const startYMax = yActive.maxHp;
  const startTMax = tActive.maxHp;

  let turnSide: BattleSide = firstAttackerSide(yActive, tActive);
  let turnsPlayed = 0;
  const log: string[] = [];

  let anyCrit = false;
  let anyMiss = false;
  let anyWeak = false;
  let weaknessCritCombo = false;
  let momentumShift = false;
  let lastKoMove: string | null = null;

  const advanceYours = () => {
    yi++;
    yActive = yours[yi];
  };
  const advanceTheirs = () => {
    ti++;
    tActive = theirs[ti];
  };

  const MAX_TURNS = 20;

  console.log(
    `[Battle] Fight ${fightNumber} starting: ${yActive.name} (${yActive.hp}hp) vs ${tActive.name} (${tActive.hp}hp)`,
  );

  while (yActive && tActive) {
    if (turnsPlayed >= MAX_TURNS) {
      break;
    }
    turnsPlayed++;

    const fasterSide = firstAttackerSide(yActive!, tActive!);
    const slowerSide: BattleSide = fasterSide === "yours" ? "theirs" : "yours";

    let attackerSide = turnSide;
    if (attackerSide === fasterSide && Math.random() < 0.15) {
      attackerSide = slowerSide;
      momentumShift = true;
      log.push("Quick move! They struck first! ⚡");
    }

    const attacker = attackerSide === "yours" ? yActive! : tActive!;
    const defender = attackerSide === "yours" ? tActive! : yActive!;
    const atk = pickAttack(attacker.attacks);
    const base = atk.damage;

    const miss = Math.random() < 0.1;
    let crit = false;
    let variedCore = 0;
    let final = 0;
    let weak = false;
    let resist = false;

    if (miss) {
      anyMiss = true;
      final = 0;
      console.log(
        `[Battle] Turn ${turnsPlayed}: ${attacker.name} hits for 0 damage (base: ${base}, variance: 0, crit: no, miss: yes)`,
      );
    } else {
      variedCore = rollVarianceDamage(base);
      crit = Math.random() < 0.2;
      const dmgForWeak = crit ? Math.floor(variedCore * 1.75) : variedCore;
      if (crit) anyCrit = true;
      const applied = applyWeaknessResistance(dmgForWeak, attacker, defender);
      final = applied.final;
      weak = applied.weak;
      resist = applied.resist;
      if (weak) anyWeak = true;
      if (crit && weak) weaknessCritCombo = true;
      console.log(
        `[Battle] Turn ${turnsPlayed}: ${attacker.name} hits for ${final} damage (base: ${base}, variance: ${variedCore}, crit: ${crit ? "yes" : "no"}, miss: no)`,
      );
    }

    defender.hp -= final;

    const hitLine = miss
      ? words(`${attacker.name} whiffed — no damage!`)
      : words(
          `${attacker.name} hit ${defender.name} for ${final}${crit ? " CRIT" : ""}${weak ? " SE" : ""}!`,
        );
    log.push(hitLine);
    if (resist && !miss) log.push(words("Resistance softened the blow."));

    if (defender.hp <= 0) {
      log.push(words(`${defender.name} could not keep fighting!`));
      lastKoMove = atk.name;

      if (attackerSide === "yours") advanceTheirs();
      else advanceYours();

      const winnerSide: BattleSide = yActive ? "yours" : "theirs";
      const winner = (yActive ?? tActive)!;
      const loserName = defender.name;
      const winnerHp = winner.hp;
      const hangingWin = winnerHp > 0 && winnerHp < 15;
      const dominantHealth = winnerHp / winner.maxHp >= 0.5;
      const oppStartMax = winnerSide === "yours" ? startTMax : startYMax;
      const wasUpset = winner.maxHp < oppStartMax;
      const decidedByTime = false;

      const ctx: NarrativeCtx = {
        decidedByTime,
        hadMiss: anyMiss,
        hadCrit: anyCrit,
        weaknessCritCombo,
        hadMomentumShift: momentumShift,
        wasUpset,
        dominantHealth,
        hangingWin,
        hadWeakness: anyWeak,
        winnerName: winner.name,
        loserName,
        moveName: lastKoMove,
        turnsPlayed,
      };

      console.log(
        `[Battle] Fight ${fightNumber} result: ${winner.name} wins with ${winnerHp}hp remaining after ${turnsPlayed} turns`,
      );

      return makeFightResult(
        fightNumber,
        winnerSide,
        winner.name,
        loserName,
        lastKoMove,
        turnsPlayed,
        ctx,
        log,
      );
    }

    turnSide = attackerSide === "yours" ? "theirs" : "yours";
  }

  const decidedByTime = true;
  const yHp = yActive.hp;
  const tHp = tActive.hp;
  let winnerSide: BattleSide;
  if (yHp > tHp) winnerSide = "yours";
  else if (tHp > yHp) winnerSide = "theirs";
  else winnerSide = Math.random() < 0.5 ? "yours" : "theirs";

  const winner = winnerSide === "yours" ? yActive : tActive;
  const loser = winnerSide === "yours" ? tActive : yActive;
  const winnerHp = winner.hp;
  const hangingWin = winnerHp > 0 && winnerHp < 15;
  const dominantHealth = winnerHp / winner.maxHp >= 0.5;
  const wasUpset = winner.maxHp < loser.maxHp;

  const ctx: NarrativeCtx = {
    decidedByTime,
    hadMiss: anyMiss,
    hadCrit: anyCrit,
    weaknessCritCombo,
    hadMomentumShift: momentumShift,
    wasUpset,
    dominantHealth,
    hangingWin,
    hadWeakness: anyWeak,
    winnerName: winner.name,
    loserName: loser.name,
    moveName: null,
    turnsPlayed,
  };

  console.log(
    `[Battle] Fight ${fightNumber} result: ${winner.name} wins with ${winnerHp}hp remaining after ${turnsPlayed} turns (time limit)`,
  );

  return makeFightResult(
    fightNumber,
    winnerSide,
    winner.name,
    loser.name,
    null,
    turnsPlayed,
    ctx,
    log,
  );
}

function buildSummary(
  results: FightResult[],
  yourCards: DisplayCard[],
  theirCards: DisplayCard[],
): BattleSimulationResult["summary"] {
  let yourWins = 0;
  let theirWins = 0;
  const yourFinisher: Record<string, number> = {};
  const theirFinisher: Record<string, number> = {};

  let dramaScore = -1;
  let dramaticMoment: string | null = null;

  for (const r of results) {
    if (r.winner === "yours") {
      yourWins++;
      yourFinisher[r.winnerPokemonName] =
        (yourFinisher[r.winnerPokemonName] ?? 0) + 1;
    } else if (r.winner === "theirs") {
      theirWins++;
      theirFinisher[r.winnerPokemonName] =
        (theirFinisher[r.winnerPokemonName] ?? 0) + 1;
    }
    const d =
      (r.hadCriticalHit ? 2 : 0) +
      (r.wasCloseFight ? 2 : 0) +
      (r.wasDominant ? 1 : 0) +
      (r.decidedByTime ? 1 : 0) +
      (r.weaknessCritCombo ? 2 : 0);
    if (d > dramaScore) {
      dramaScore = d;
      if (r.weaknessCritCombo) {
        dramaticMoment = words(
          `Fight ${r.fightNumber} exploded with weakness plus crit!`,
        );
      } else if (r.decidedByTime) {
        dramaticMoment = words(
          `Fight ${r.fightNumber} hit the time buzzer — judges picked the edge!`,
        );
      } else if (r.hadCriticalHit && r.wasCloseFight) {
        dramaticMoment = words(
          `Fight ${r.fightNumber} had a giant crit and almost no HP left — wild!`,
        );
      } else if (r.hadCriticalHit) {
        dramaticMoment = words(
          `Fight ${r.fightNumber} blew up with a massive critical hit!`,
        );
      } else if (r.wasCloseFight) {
        dramaticMoment = words(
          `Fight ${r.fightNumber} came down to a sliver of HP!`,
        );
      } else if (r.wasDominant) {
        dramaticMoment = words(
          `Fight ${r.fightNumber} was a total stomp — one squad never lost a card!`,
        );
      }
    }
  }

  const overallWinner: BattleSide | "tie" =
    yourWins > theirWins
      ? "yours"
      : theirWins > yourWins
        ? "theirs"
        : "tie";

  const topName = (o: Record<string, number>) => {
    let best = "";
    let n = 0;
    for (const [k, v] of Object.entries(o)) {
      if (v > n) {
        n = v;
        best = k;
      }
    }
    return { name: best, wins: n };
  };

  const yStar = topName(yourFinisher);
  const tStar = topName(theirFinisher);

  let starPerformerName: string | null = null;
  let starPerformerSide: BattleSide | null = null;
  if (overallWinner === "yours" && yStar.wins > 0) {
    starPerformerName = yStar.name;
    starPerformerSide = "yours";
  } else if (overallWinner === "theirs" && tStar.wins > 0) {
    starPerformerName = tStar.name;
    starPerformerSide = "theirs";
  } else if (yStar.wins >= tStar.wins && yStar.wins > 0) {
    starPerformerName = yStar.name;
    starPerformerSide = "yours";
  } else if (tStar.wins > 0) {
    starPerformerName = tStar.name;
    starPerformerSide = "theirs";
  }

  const yLead = yourCards[0]?.name ?? "Blue Team";
  const tLead = theirCards[0]?.name ?? "Gold Team";

  const finalTickerCallout =
    overallWinner === "yours"
      ? "BLUE TEAM DOMINATES! 🔵"
      : overallWinner === "theirs"
        ? "GOLD TEAM TAKES IT! 🟡"
        : "WHAT A TIE! 🤝";

  let summaryText: string;
  if (overallWinner === "tie") {
    summaryText = words(
      `What a tie! ${yourWins} wins each! ${yLead} and ${tLead} brought huge energy for Blue Team and Gold Team!`,
    );
  } else if (overallWinner === "yours") {
    summaryText = words(
      `Blue Team was on fire today! Blue Team grabbed ${yourWins} wins!`,
    );
    if (starPerformerName) {
      const wc =
        starPerformerSide === "yours"
          ? yourFinisher[starPerformerName] ?? 0
          : theirFinisher[starPerformerName] ?? 0;
      const sideLabel =
        starPerformerSide === "yours" ? "Blue Team" : "Gold Team";
      summaryText +=
        " " +
        words(
          `${starPerformerName} won ${wc} fights and was the real star for ${sideLabel}!`,
        );
    }
    summaryText +=
      " " +
      words(
        dramaticMoment
          ? dramaticMoment
          : `Gold Team still snagged ${theirWins} wins — respect!`,
      );
  } else {
    summaryText = words(
      `Gold Team roared louder this time with ${theirWins} wins!`,
    );
    if (starPerformerName) {
      summaryText +=
        " " +
        words(`${starPerformerName} led the charge for Gold Team!`);
    }
    summaryText +=
      " " +
      words(
        dramaticMoment
          ? dramaticMoment
          : `Blue Team still pocketed ${yourWins} wins — never count them out!`,
      );
  }

  summaryText = words(summaryText, 40);

  return {
    yourWins,
    theirWins,
    overallWinner,
    summaryText,
    dramaticMoment,
    starPerformerName,
    starPerformerSide,
    finalTickerCallout,
  };
}

export function simulate(
  mySide: DisplayCard[],
  theirSide: DisplayCard[],
): BattleSimulationResult {
  assertBattleRoster(mySide, "yours");
  assertBattleRoster(theirSide, "theirs");
  const yourSorted = sortTeam(mySide);
  const theirSorted = sortTeam(theirSide);
  const results: FightResult[] = [];
  for (let i = 1; i <= 10; i++) {
    results.push(runSingleFight(yourSorted, theirSorted, i));
  }
  return {
    results,
    summary: buildSummary(results, mySide, theirSide),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERACTIVE TURN-BASED BATTLE
// Bench rosters, status conditions, substitutions
// ─────────────────────────────────────────────────────────────────────────────

export type BattleTeam = "blue" | "gold";

export type InteractiveFighter = {
  displayId: string;
  name: string;
  type: string;
  maxHp: number;
  currentHp: number;
  attacks: ScannedAttack[];
  weakness: string | null;
  weaknessMultiplier: number | null;
  resistance: string | null;
  imageUrl?: string | null;
  scannedPhotoDataUrl?: string | null;
  isKnockedOut: boolean;
  statusCondition: StatusCondition;
};

export type InteractiveBattleStatus =
  | "active"
  | "blue_wins"
  | "gold_wins";

export type TurnStatus =
  | "coin_flip"
  | "choosing"
  | "status_blocked"
  | "resolving"
  | "animating"
  | "choosing_replacement"
  | "complete";

export type TurnLogEntry = {
  turn: number;
  attackerTeam: BattleTeam;
  attackerName: string;
  defenderName: string;
  attackUsed: string;
  wasSubstitute: boolean;
  substitutedInName?: string;
  baseDamage: number;
  finalDamage: number;
  hpBefore: number;
  hpAfter: number;
  isWeakness: boolean;
  isResistance: boolean;
  wasKnockedOut: boolean;
  statusApplied?: StatusCondition;
  statusDamageTaken?: number;
  confusionSelfHit?: boolean;
  statusCured?: boolean;
  narrative: string;
  effectResolved?: string;
  coinFlipResult?: "Heads" | "Tails" | null;
};

export type TeamState = {
  activeIndex: number;
  roster: InteractiveFighter[];
};

export type InteractiveBattleState = {
  status: InteractiveBattleStatus;
  turnStatus: TurnStatus;
  turn: number;
  activeTeam: BattleTeam;
  teams: {
    blue: TeamState;
    gold: TeamState;
  };
  pendingKo: boolean;
  log: TurnLogEntry[];
  lastTurnResult: TurnLogEntry | null;
};

export type TurnResolution = {
  attackerTeam: BattleTeam;
  defenderTeam: BattleTeam;
  attackerName: string;
  defenderName: string;
  attackUsed: string;
  baseDamage: number;
  finalDamage: number;
  finalHp: number;
  isWeakness: boolean;
  isResistance: boolean;
  statusApplied: StatusCondition | null;
  confusionSelfHit: boolean;
  selfDamage: number;
  effectResolved: string;
  coinFlipResult: "Heads" | "Tails" | null;
  narrative: string;
};

function toInteractiveFighter(
  card: DisplayCard,
  scannedPhotoDataUrl?: string | null,
): InteractiveFighter {
  if (!cardPassesBattleValidation(card)) {
    throw new Error(`[InteractiveBattle] Card not battle-ready: ${card.name}`);
  }
  const attacks = card.attacks!.filter(
    (a) => typeof a.damage === "number" && a.damage > 0,
  );
  return {
    displayId: card.displayId,
    name: card.name,
    type: card.type.trim(),
    maxHp: card.battleHp!,
    currentHp: card.battleHp!,
    attacks,
    weakness: card.weakness,
    weaknessMultiplier: card.weaknessMultiplier,
    resistance: card.resistance,
    imageUrl: card.imageUrl ?? null,
    scannedPhotoDataUrl: scannedPhotoDataUrl ?? null,
    isKnockedOut: false,
    statusCondition: "none",
  };
}

export function createInteractiveBattle(
  blueRoster: Array<[DisplayCard, string | null]>,
  goldRoster: Array<[DisplayCard, string | null]>,
): InteractiveBattleState {
  if (blueRoster.length < 1 || blueRoster.length > 3) {
    throw new Error("[InteractiveBattle] Blue roster must have 1–3 Pokémon");
  }
  if (goldRoster.length < 1 || goldRoster.length > 3) {
    throw new Error("[InteractiveBattle] Gold roster must have 1–3 Pokémon");
  }

  return {
    status: "active",
    turnStatus: "coin_flip",
    turn: 1,
    activeTeam: "blue",
    pendingKo: false,
    teams: {
      blue: {
        activeIndex: 0,
        roster: blueRoster.map(([card, photo]) =>
          toInteractiveFighter(card, photo),
        ),
      },
      gold: {
        activeIndex: 0,
        roster: goldRoster.map(([card, photo]) =>
          toInteractiveFighter(card, photo),
        ),
      },
    },
    log: [],
    lastTurnResult: null,
  };
}

export function getActiveFighter(
  state: InteractiveBattleState,
  team: BattleTeam,
): InteractiveFighter {
  const t = state.teams[team];
  return t.roster[t.activeIndex];
}

export function getBenchFighters(
  state: InteractiveBattleState,
  team: BattleTeam,
): InteractiveFighter[] {
  const t = state.teams[team];
  return t.roster.filter(
    (_, i) => i !== t.activeIndex && !t.roster[i].isKnockedOut,
  );
}

export function getOpponentTeam(team: BattleTeam): BattleTeam {
  return team === "blue" ? "gold" : "blue";
}

export function applyTurnResolution(
  state: InteractiveBattleState,
  resolution: TurnResolution,
): InteractiveBattleState {
  const next: InteractiveBattleState = JSON.parse(JSON.stringify(state));

  const atkTeam = next.teams[resolution.attackerTeam];
  const attacker = atkTeam.roster[atkTeam.activeIndex];
  const defTeam = next.teams[resolution.defenderTeam];
  const defender = defTeam.roster[defTeam.activeIndex];

  const hpBefore = defender.currentHp;

  if (resolution.confusionSelfHit && resolution.selfDamage > 0) {
    attacker.currentHp = Math.max(0, attacker.currentHp - resolution.selfDamage);
  } else {
    defender.currentHp = Math.max(0, resolution.finalHp);
  }

  if (
    resolution.statusApplied &&
    resolution.statusApplied !== "none" &&
    !resolution.confusionSelfHit
  ) {
    defender.statusCondition = resolution.statusApplied;
  }

  if (attacker.statusCondition === "paralyzed") {
    attacker.statusCondition = "none";
  }

  let statusDamageTaken = 0;
  if (attacker.statusCondition === "poisoned") {
    statusDamageTaken = 10;
    attacker.currentHp = Math.max(0, attacker.currentHp - 10);
  } else if (attacker.statusCondition === "burned") {
    statusDamageTaken = 20;
    attacker.currentHp = Math.max(0, attacker.currentHp - 20);
    const burnFlip = Math.random() < 0.5 ? "Heads" : "Tails";
    if (burnFlip === "Heads") attacker.statusCondition = "none";
  }

  const defenderWasKnockedOut = defender.currentHp === 0;
  const attackerWasKnockedOut = attacker.currentHp === 0;

  if (defenderWasKnockedOut) defender.isKnockedOut = true;
  if (attackerWasKnockedOut) attacker.isKnockedOut = true;

  const engineWeakness = resolveWeaknessAndMultiplier(attacker, defender);
  const engineResistance = resolveResistanceReduction(attacker, defender);

  const entry: TurnLogEntry = {
    turn: next.turn,
    attackerTeam: resolution.attackerTeam,
    attackerName: resolution.attackerName,
    defenderName: resolution.defenderName,
    attackUsed: resolution.attackUsed,
    wasSubstitute: false,
    baseDamage: resolution.baseDamage,
    finalDamage: resolution.confusionSelfHit ? 0 : resolution.finalDamage,
    hpBefore,
    hpAfter: defender.currentHp,
    isWeakness: engineWeakness.isWeakness,
    isResistance: engineResistance.isResistance,
    wasKnockedOut: defenderWasKnockedOut || attackerWasKnockedOut,
    statusApplied: resolution.statusApplied ?? undefined,
    statusDamageTaken: statusDamageTaken > 0 ? statusDamageTaken : undefined,
    confusionSelfHit: resolution.confusionSelfHit || undefined,
    narrative: resolution.narrative,
    effectResolved: resolution.effectResolved,
    coinFlipResult: resolution.coinFlipResult,
  };

  next.log.push(entry);
  next.lastTurnResult = entry;

  const checkKo = (koTeam: BattleTeam) => {
    const team = next.teams[koTeam];
    const remaining = team.roster.filter((f) => !f.isKnockedOut);
    if (remaining.length === 0) {
      next.status = koTeam === "blue" ? "gold_wins" : "blue_wins";
      next.turnStatus = "complete";
    } else {
      next.pendingKo = true;
      next.turnStatus = "choosing_replacement";
      next.activeTeam = koTeam;
    }
  };

  if (next.turnStatus !== "complete") {
    if (defenderWasKnockedOut) checkKo(resolution.defenderTeam);
    else if (attackerWasKnockedOut) checkKo(resolution.attackerTeam);
    else next.turnStatus = "animating";
  }

  return next;
}

export function applySubstitute(
  state: InteractiveBattleState,
  incomingRosterIndex: number,
): InteractiveBattleState {
  const next: InteractiveBattleState = JSON.parse(JSON.stringify(state));
  const team = next.teams[state.activeTeam];
  const outgoing = team.roster[team.activeIndex];
  const incoming = team.roster[incomingRosterIndex];

  if (incoming.statusCondition === "confused") {
    incoming.statusCondition = "none";
  }

  const entry: TurnLogEntry = {
    turn: next.turn,
    attackerTeam: state.activeTeam,
    attackerName: outgoing.name,
    defenderName: getActiveFighter(state, getOpponentTeam(state.activeTeam)).name,
    attackUsed: "SUBSTITUTE",
    wasSubstitute: true,
    substitutedInName: incoming.name,
    baseDamage: 0,
    finalDamage: 0,
    hpBefore: getActiveFighter(state, getOpponentTeam(state.activeTeam)).currentHp,
    hpAfter: getActiveFighter(state, getOpponentTeam(state.activeTeam)).currentHp,
    isWeakness: false,
    isResistance: false,
    wasKnockedOut: false,
    narrative: `${outgoing.name} retreats to the bench. ${incoming.name} steps up! (Turn used)`,
  };

  team.activeIndex = incomingRosterIndex;
  next.log.push(entry);
  next.lastTurnResult = entry;

  next.turn += 1;
  next.activeTeam = getOpponentTeam(state.activeTeam);
  next.turnStatus = "choosing";

  return next;
}

export function applyChooseReplacement(
  state: InteractiveBattleState,
  incomingRosterIndex: number,
): InteractiveBattleState {
  const next: InteractiveBattleState = JSON.parse(JSON.stringify(state));
  const team = next.teams[state.activeTeam];
  team.activeIndex = incomingRosterIndex;
  next.pendingKo = false;
  next.turn += 1;
  next.activeTeam = state.activeTeam;
  next.turnStatus = "choosing";
  return next;
}

export function applyStatusBlock(
  state: InteractiveBattleState,
): InteractiveBattleState {
  const next: InteractiveBattleState = JSON.parse(JSON.stringify(state));
  const fighter = getActiveFighter(next, state.activeTeam);
  const opponent = getActiveFighter(state, getOpponentTeam(state.activeTeam));

  let narrative = "";
  let statusCured = false;
  let coinFlipResult: "Heads" | "Tails" | null = null;

  if (fighter.statusCondition === "paralyzed") {
    narrative = `${fighter.name} is paralyzed and can't move!`;
    fighter.statusCondition = "none";
    statusCured = true;
  } else if (fighter.statusCondition === "asleep") {
    const flip = Math.random() < 0.5 ? "Heads" : "Tails";
    coinFlipResult = flip;
    if (flip === "Heads") {
      fighter.statusCondition = "none";
      narrative = `${fighter.name} woke up!`;
      statusCured = true;
    } else {
      narrative = `${fighter.name} is fast asleep and can't move!`;
    }
  }

  const entry: TurnLogEntry = {
    turn: next.turn,
    attackerTeam: state.activeTeam,
    attackerName: fighter.name,
    defenderName: opponent.name,
    attackUsed: "STATUS_BLOCKED",
    wasSubstitute: false,
    baseDamage: 0,
    finalDamage: 0,
    hpBefore: opponent.currentHp,
    hpAfter: opponent.currentHp,
    isWeakness: false,
    isResistance: false,
    wasKnockedOut: false,
    statusCured,
    narrative,
    coinFlipResult,
  };

  next.log.push(entry);
  next.lastTurnResult = entry;
  next.turn += 1;
  next.activeTeam = getOpponentTeam(state.activeTeam);
  next.turnStatus = "choosing";
  return next;
}

export function advanceTurn(
  state: InteractiveBattleState,
): InteractiveBattleState {
  const next: InteractiveBattleState = JSON.parse(JSON.stringify(state));
  next.turn += 1;
  next.activeTeam = getOpponentTeam(state.activeTeam);

  const nextFighter = getActiveFighter(next, next.activeTeam);
  if (
    nextFighter.statusCondition === "paralyzed" ||
    nextFighter.statusCondition === "asleep"
  ) {
    next.turnStatus = "status_blocked";
  } else {
    next.turnStatus = "choosing";
  }

  return next;
}

export const INTERACTIVE_BATTLE_SYSTEM_PROMPT = `
You are the rules engine for a Pokémon Trading Card Game turn-based battle.
Your only job is to resolve a single attack turn and return structured JSON.

DAMAGE RULES:
- Weakness and resistance are pre-calculated by the game engine in PRE-CALCULATED ESTIMATE. Trust those values.
- TCG formula: finalDamage = (baseDamage × weaknessMultiplier) − resistanceReduction, floor 0.
- Super-effective (×2) is determined from ATTACKER TYPE vs DEFENDER TYPE using the standard type chart — not from scanned "weakness" text (photos are often wrong or missing that line).
- TYPE NORMALIZATION (label variants → chart key): ${TYPE_NORMALIZATION_HINT}
- Examples: Lightning/Electric → Water is ×2; Fire → Grass is ×2; Water → Fire is ×2; Fighting → Dark is ×2.
- Resistance still uses the scanned resistance field when present and recognizable.

DAMAGE AUTHORITY RULE:
When isWeakness is true, finalDamage MUST equal exactly (baseDamage × weaknessMultiplier)
before resistance is subtracted. The pre-calculated estimate you receive is authoritative —
you MUST NOT silently output a different number.

The ONE exception: if the attack's own effect text explicitly states it modifies the base
damage amount (e.g. "does 30 more damage", "damage is halved", "flip a coin, if tails
this attack does nothing"), apply that modifier to baseDamage first, then apply weakness
and resistance on top.

If the effect text contains no explicit base-damage modifier, output finalDamage exactly
as provided.

WEAKNESS / RESISTANCE FLAGS (engine-owned):
- Copy "Is weakness" and "Is resistance" from PRE-CALCULATED ESTIMATE exactly into isWeakness and isResistance.
- Do NOT re-derive weakness from effect text, narrative, or the defender's scanned weakness line.
- If Is weakness is true, mention super-effective damage in the narrative when appropriate.

STATUS CONDITIONS — resolve these from attack effect text:
- "poisoned": defender takes 10 damage at the end of each of their turns. Set statusApplied = "poisoned".
- "burned": defender takes 20 damage at end of each turn; flip coin, heads = cured. Set statusApplied = "burned".
- "paralyzed": defender cannot attack next turn (handled by game engine). Set statusApplied = "paralyzed".
- "asleep": defender flips coin at start of their turn; tails = still asleep. Set statusApplied = "asleep".
- "confused": before attacking, flip coin — heads = attack normally, tails = deal 30 damage to self instead.
  If attacker is confused:
  - Flip the coin NOW.
  - If tails: set confusionSelfHit = true, selfDamage = 30, finalDamage = 0 (attack fails, hits self).
  - If heads: attack proceeds normally, confusionSelfHit = false.

ATTACK EFFECT TEXT:
- Read the effect text carefully. Apply any damage bonuses, conditions, or coin flips it describes.
- "Flip a coin. If heads, do X more damage" → flip coin, apply bonus if heads.
- "This attack does X damage for each [condition]" → count the condition and multiply.
- If effect text inflicts a status condition on the DEFENDER, set statusApplied to that condition.
- If effect text inflicts a status on the ATTACKER (rare), note it in effectResolved but do not set statusApplied.
- Only set ONE statusApplied per turn (the most significant one if multiple are possible).

CURRENT ATTACKER STATUS (already applied by engine — you do NOT need to re-apply these):
- Paralysis and sleep are handled before this prompt is called. If you see this prompt, the attacker CAN act.
- Poison and burn end-of-turn damage is applied by the engine AFTER your response.
- Confusion IS your responsibility — check the attacker's current status and resolve it.

Return ONLY valid JSON. No markdown, no explanation outside the JSON.
`.trim();

function resolveWeaknessAndMultiplier(
  attacker: Pick<InteractiveFighter, "type">,
  defender: Pick<
    InteractiveFighter,
    "type" | "weakness" | "weaknessMultiplier"
  >,
): { isWeakness: boolean; weaknessMultiplier: number } {
  // Primary: roster types + standard chart (photo scans rarely yield reliable weakness text).
  const chart = weaknessFromTypeChart(attacker, defender);
  if (chart.isWeakness) return chart;

  // Secondary: printed weakness only when chart did not apply (e.g. special card text).
  const printedWeakness = getEffectivePrintedType(defender.weakness);
  if (printedWeakness && typesMatch(attacker.type, printedWeakness)) {
    const mult = defender.weaknessMultiplier;
    const effectiveMult =
      mult != null && mult > 0 && Number.isFinite(mult) ? mult : 2;
    return { isWeakness: true, weaknessMultiplier: effectiveMult };
  }

  return { isWeakness: false, weaknessMultiplier: 1 };
}

export function buildInteractiveTurnPrompt(
  state: InteractiveBattleState,
  chosenAttack: ScannedAttack,
): string {
  const attackerTeam = state.activeTeam;
  const defenderTeam = getOpponentTeam(attackerTeam);
  const attacker = getActiveFighter(state, attackerTeam);
  const defender = getActiveFighter(state, defenderTeam);

  const { isWeakness, weaknessMultiplier } = resolveWeaknessAndMultiplier(
    attacker,
    defender,
  );
  const { isResistance, reduction: resistanceReduction } =
    resolveResistanceReduction(attacker, defender);
  const weaknessNote = describeWeaknessResolution(attacker, defender, {
    isWeakness,
  });
  const estimatedFinal = Math.max(
    0,
    Math.floor(chosenAttack.damage * weaknessMultiplier) - resistanceReduction,
  );
  const atkNorm = chartTypeKey(attacker.type) || attacker.type;
  const defNorm = chartTypeKey(defender.type) || defender.type;

  const attackerBench =
    getBenchFighters(state, attackerTeam)
      .map(
        (f) =>
          `  - ${f.name} (${f.currentHp}/${f.maxHp} HP, status: ${f.statusCondition})`,
      )
      .join("\n") || "  (none)";

  const defenderBench =
    getBenchFighters(state, defenderTeam)
      .map(
        (f) =>
          `  - ${f.name} (${f.currentHp}/${f.maxHp} HP, status: ${f.statusCondition})`,
      )
      .join("\n") || "  (none)";

  return `
Resolve this Pokémon TCG battle turn and return a JSON object.

=== TURN ${state.turn} ===
Active team: ${attackerTeam.toUpperCase()}

=== ATTACKER (${attackerTeam.toUpperCase()}) ===
Name:             ${attacker.name}
Type:             ${attacker.type}
Current HP:       ${attacker.currentHp} / ${attacker.maxHp}
Status condition: ${attacker.statusCondition}
Attack used:      ${chosenAttack.name}
Base damage:      ${chosenAttack.damage}
Effect text:      "${chosenAttack.text ?? "No effect text"}"
Bench:
${attackerBench}

=== DEFENDER (${defenderTeam.toUpperCase()}) ===
Name:             ${defender.name}
Type:             ${defender.type}
Current HP:       ${defender.currentHp} / ${defender.maxHp}
Weakness:         ${defender.weakness ?? "None"} (×${defender.weaknessMultiplier ?? "N/A"})
Resistance:       ${defender.resistance ?? "None"} (−30)
Status condition: ${defender.statusCondition}
Bench:
${defenderBench}

=== TYPE NORMALIZATION (engine) ===
${TYPE_NORMALIZATION_HINT}
Attacker: ${attacker.type} → ${atkNorm}
Defender: ${defender.type} → ${defNorm}
Scanned weakness line (may be wrong — not used for ×2): ${defender.weakness ?? "none"}
Scanned resistance line: ${defender.resistance ?? "none"}
Weakness resolution: ${weaknessNote}

=== PRE-CALCULATED ESTIMATE ===
Is weakness: ${isWeakness}
Weakness multiplier: ×${weaknessMultiplier}
Is resistance: ${isResistance}
Resistance reduction: −${resistanceReduction}
Pre-calculated finalDamage: ${estimatedFinal}. This value is authoritative. Output this exact number unless the attack's effect text explicitly modifies base damage (e.g. "does X more damage", "damage is halved"). If no such modifier exists in the effect text, do not deviate.
Estimated HP after: ${Math.max(0, defender.currentHp - estimatedFinal)}

=== RESPONSE FORMAT (exact JSON, no markdown) ===
{
  "attackerTeam":    "${attackerTeam}",
  "defenderTeam":    "${defenderTeam}",
  "attackerName":    "${attacker.name}",
  "defenderName":    "${defender.name}",
  "attackUsed":      "${chosenAttack.name}",
  "baseDamage":      <number>,
  "finalDamage":     <number: damage dealt to DEFENDER after all modifiers; 0 if confusion self-hit>,
  "finalHp":         <number: defender HP after finalDamage, floor 0>,
  "isWeakness":      <boolean — copy "Is weakness" from PRE-CALCULATED ESTIMATE exactly>,
  "isResistance":    <boolean — copy "Is resistance" from PRE-CALCULATED ESTIMATE exactly>,
  "statusApplied":   <StatusCondition string or null: status inflicted on DEFENDER this turn>,
  "confusionSelfHit":<boolean: true if attacker was confused and coin was tails>,
  "selfDamage":      <number: damage to ATTACKER from confusion self-hit; 0 otherwise>,
  "effectResolved":  <string: plain English description of how effect text was resolved>,
  "coinFlipResult":  <"Heads" | "Tails" | null>,
  "narrative":       <string: 1-2 dramatic sentences for the battle UI>
}
`.trim();
}

export function formatTurnLog(log: TurnLogEntry[]): string[] {
  return log.map((e) => {
    if (e.wasSubstitute) {
      return `Turn ${e.turn} [${e.attackerTeam.toUpperCase()}]: ${e.attackerName} → ${e.substitutedInName ?? "?"} (sub)`;
    }
    if (e.attackUsed === "STATUS_BLOCKED") {
      return `Turn ${e.turn} [${e.attackerTeam.toUpperCase()}]: ${e.narrative}`;
    }
    return `Turn ${e.turn} [${e.attackerTeam.toUpperCase()}]: ${e.attackerName} used ${e.attackUsed} → ${e.finalDamage} dmg${e.isWeakness ? " · Super Effective! ⚡💥" : ""}${e.isResistance ? " 🛡RESIST" : ""}${e.statusApplied && e.statusApplied !== "none" ? ` [${e.statusApplied}]` : ""} · ${e.defenderName} HP: ${e.hpAfter}${e.wasKnockedOut ? " 💀 KO!" : ""}`;
  });
}
