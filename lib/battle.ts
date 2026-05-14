import type { DisplayCard } from "@/lib/cards";
import { cardPassesBattleValidation } from "@/lib/cards";
import type { ScannedAttack } from "@/lib/types";

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

function typesMatch(attackerType: string, defenderField: string | null): boolean {
  if (!defenderField) return false;
  const a = normType(attackerType);
  const b = normType(defenderField);
  if (!a || a === "?" || !b) return false;
  return a === b;
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
