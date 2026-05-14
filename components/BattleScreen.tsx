"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AddCardTile } from "@/components/AddCardTile";
import { BattleCardRow } from "@/components/BattleCardRow";
import type { DisplayCard } from "@/lib/cards";
import { cardPassesBattleValidation } from "@/lib/cards";
import {
  simulate,
  type BattleSimulationResult,
  type FightResult,
} from "@/lib/battle";

type BattlePhase = "roster" | "running" | "verdict";

const FIGHT_MS = 2000;
const PAUSE_MS = 500;
const ROUND_MS = FIGHT_MS + PAUSE_MS;
/** 10 fights × 2s + 9 pauses × 0.5s */
const BATTLE_TOTAL_MS = 10 * FIGHT_MS + 9 * PAUSE_MS;
const TICKER_PHRASE_MS = 600;

type BattleScreenProps = {
  mySide: DisplayCard[];
  theirSide: DisplayCard[];
  maxMy: number;
  maxTheir: number;
  loading: boolean;
  myAddLoading: boolean;
  theirAddLoading: boolean;
  error: string | null;
  onScanMy: () => void;
  onScanTheir: () => void;
  onRequestRemove: (side: "yours" | "theirs", index: number, name: string) => void;
  onGoToMyCards: () => void;
  battleRescanSlot: { side: "yours" | "theirs"; index: number } | null;
  onRescanBattleSlot: (side: "yours" | "theirs", index: number) => void;
};

function filledFightCount(elapsed: number): number {
  let n = 0;
  for (let i = 0; i < 10; i++) {
    if (elapsed >= i * ROUND_MS + FIGHT_MS) n++;
  }
  return n;
}

function activeFightIndex(elapsed: number): number | null {
  if (elapsed >= BATTLE_TOTAL_MS) return null;
  for (let i = 0; i < 10; i++) {
    if (elapsed >= i * ROUND_MS && elapsed < i * ROUND_MS + FIGHT_MS) {
      return i;
    }
  }
  return null;
}

function pauseAfterFightIndex(elapsed: number): number | null {
  for (let i = 0; i < 9; i++) {
    if (
      elapsed >= i * ROUND_MS + FIGHT_MS &&
      elapsed < (i + 1) * ROUND_MS
    ) {
      return i;
    }
  }
  return null;
}

function isBetweenFightPause(elapsed: number): boolean {
  return pauseAfterFightIndex(elapsed) != null;
}

function scoreFromResults(results: FightResult[], filled: number): {
  blue: number;
  gold: number;
} {
  let blue = 0;
  let gold = 0;
  for (let i = 0; i < filled && i < results.length; i++) {
    if (results[i]!.winner === "yours") blue++;
    else gold++;
  }
  return { blue, gold };
}

function tickerLine(args: {
  phase: BattlePhase;
  sim: BattleSimulationResult | null;
  elapsed: number;
}): string {
  const { phase, sim, elapsed } = args;
  if (!sim) return "";
  if (phase === "verdict") return sim.summary.finalTickerCallout;
  if (elapsed >= BATTLE_TOTAL_MS) return sim.summary.finalTickerCallout;
  if (isBetweenFightPause(elapsed)) return "Next fight loading... ⚡";
  const idx = activeFightIndex(elapsed);
  if (idx == null) return sim.summary.finalTickerCallout;
  const fight = sim.results[idx]!;
  const within = elapsed - idx * ROUND_MS;
  const phraseIdx = Math.min(
    fight.tickerPhrases.length - 1,
    Math.floor(within / TICKER_PHRASE_MS),
  );
  return fight.tickerPhrases[phraseIdx] ?? "";
}

export function BattleScreen({
  mySide,
  theirSide,
  maxMy,
  maxTheir,
  loading,
  myAddLoading,
  theirAddLoading,
  error,
  onScanMy,
  onScanTheir,
  onRequestRemove,
  onGoToMyCards,
  battleRescanSlot,
  onRescanBattleSlot,
}: BattleScreenProps) {
  const [phase, setPhase] = useState<BattlePhase>("roster");
  const [sim, setSim] = useState<BattleSimulationResult | null>(null);
  const [goPrimed, setGoPrimed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [verdictTickerVisible, setVerdictTickerVisible] = useState(true);
  const [popCell, setPopCell] = useState<number | null>(null);
  const prevFilledRef = useRef(0);

  const resetRoster = useCallback(() => {
    setPhase("roster");
    setSim(null);
    setGoPrimed(false);
    setElapsed(0);
    setVerdictTickerVisible(true);
    setPopCell(null);
    prevFilledRef.current = 0;
  }, []);

  useEffect(() => {
    if (phase !== "running" || !sim) return;
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const e = Date.now() - t0;
      setElapsed(e);
      if (e >= BATTLE_TOTAL_MS) {
        setPhase("verdict");
      }
    }, 40);
    return () => window.clearInterval(id);
  }, [phase, sim]);

  const filled = phase === "running" && sim ? filledFightCount(elapsed) : 0;

  useEffect(() => {
    if (phase !== "running" || !sim) return;
    if (filled > prevFilledRef.current) {
      const cell = filled - 1;
      setPopCell(cell);
      const t = window.setTimeout(() => setPopCell(null), 220);
      prevFilledRef.current = filled;
      return () => window.clearTimeout(t);
    }
  }, [phase, sim, filled]);

  useEffect(() => {
    if (phase !== "verdict" || !sim) return;
    setVerdictTickerVisible(true);
    const t = window.setTimeout(() => setVerdictTickerVisible(false), 3000);
    return () => window.clearTimeout(t);
  }, [phase, sim]);

  const rosterReady = mySide.length > 0 && theirSide.length > 0;
  const battleStatsOk =
    mySide.every(cardPassesBattleValidation) &&
    theirSide.every(cardPassesBattleValidation);

  const canBattle =
    rosterReady &&
    battleStatsOk &&
    mySide.length <= maxMy &&
    theirSide.length <= maxTheir;

  const startBattleAfterFlash = useCallback(() => {
    const result = simulate(mySide, theirSide);
    setSim(result);
    setElapsed(0);
    prevFilledRef.current = 0;
    setPopCell(null);
    setPhase("running");
    setGoPrimed(false);
  }, [mySide, theirSide]);

  const handleGoBattle = () => {
    if (!canBattle || goPrimed) return;
    setGoPrimed(true);
    window.setTimeout(() => {
      startBattleAfterFlash();
    }, 220);
  };

  const line = tickerLine({ phase, sim, elapsed });
  const af = phase === "running" ? activeFightIndex(elapsed) : null;
  const pw = phase === "running" ? pauseAfterFightIndex(elapsed) : null;
  const phraseKey =
    phase === "running" && sim
      ? af != null
        ? `f${af}-${Math.floor((elapsed - af * ROUND_MS) / TICKER_PHRASE_MS)}`
        : pw != null
          ? `p${pw}`
          : `e-${Math.floor(elapsed)}`
      : phase === "verdict"
        ? "verdict"
        : "idle";

  const scores =
    phase === "running" && sim
      ? scoreFromResults(sim.results, filled)
      : sim
        ? { blue: sim.summary.yourWins, gold: sim.summary.theirWins }
        : { blue: 0, gold: 0 };

  return (
    <>
      <header className="relative z-10 mb-4 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight text-[#F5C518]">
          PokeBlock
        </span>
        <span className="text-sm font-semibold text-[#DC2626]">Battle</span>
      </header>

      <div className="relative z-10 mb-4">
        <h1 className="mb-1 text-center text-2xl font-black tracking-tight text-white">
          Battle Time
        </h1>
        <p className="mb-4 text-center text-[11px] text-zinc-500">
          Same teams as Trade — picks here update there in a flash!
        </p>

        <div className="mb-4 grid grid-cols-2 gap-2">
          <section className="min-w-0 rounded-xl bg-white/[0.04] p-2 ring-1 ring-[#3B82F6]/25">
            <h2 className="mb-2 text-center text-[10px] font-black uppercase tracking-widest text-[#3B82F6]">
              Your team
            </h2>
            <div className="flex flex-col gap-1.5">
              {mySide.map((c, i) => (
                <BattleCardRow
                  key={c.displayId}
                  card={c}
                  teamAccent="blue"
                  onRescanIncomplete={() => onRescanBattleSlot("yours", i)}
                  rescanning={
                    battleRescanSlot?.side === "yours" &&
                    battleRescanSlot.index === i
                  }
                  onRemove={() => onRequestRemove("yours", i, c.name)}
                />
              ))}
            </div>
            <div className="mt-2">
              <AddCardTile
                tone="battle-blue"
                caption="SCAN CARD"
                encouragePulse={mySide.length === 0}
                onClick={onScanMy}
                disabled={loading || mySide.length >= maxMy}
                loading={myAddLoading}
              />
            </div>
          </section>

          <section className="min-w-0 rounded-xl bg-white/[0.04] p-2 ring-1 ring-[#F5C518]/30">
            <h2 className="mb-2 text-center text-[10px] font-black uppercase tracking-widest text-[#F5C518]">
              Their team
            </h2>
            <div className="flex flex-col gap-1.5">
              {theirSide.map((c, i) => (
                <BattleCardRow
                  key={c.displayId}
                  card={c}
                  teamAccent="gold"
                  onRescanIncomplete={() => onRescanBattleSlot("theirs", i)}
                  rescanning={
                    battleRescanSlot?.side === "theirs" &&
                    battleRescanSlot.index === i
                  }
                  onRemove={() => onRequestRemove("theirs", i, c.name)}
                />
              ))}
            </div>
            <div className="mt-2">
              <AddCardTile
                tone="battle-gold"
                caption="SCAN CARD"
                encouragePulse={theirSide.length === 0}
                onClick={onScanTheir}
                disabled={loading || theirSide.length >= maxTheir}
                loading={theirAddLoading}
              />
            </div>
          </section>
        </div>

        {error ? (
          <p className="mb-3 text-center text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        {phase === "roster" && (
          <div className="mt-2 flex w-full max-w-sm flex-col items-center">
            <button
              type="button"
              onClick={handleGoBattle}
              disabled={!canBattle || goPrimed}
              className={
                canBattle
                  ? `pokescan-battle-go w-full rounded-full bg-[#DC2626] py-5 text-center text-xl font-black text-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)] transition active:scale-[0.99] ${goPrimed ? "!bg-white !text-[#0f0f13] !shadow-none" : ""}`
                  : "w-full rounded-full bg-zinc-800 py-5 text-center text-xl font-black text-zinc-500"
              }
            >
              <span aria-hidden>⚔</span> GO BATTLE{" "}
              <span aria-hidden>⚔</span>
            </button>
            {!canBattle ? (
              <p className="mt-2 max-w-xs text-center text-xs text-zinc-500">
                {!rosterReady
                  ? "Add cards to both sides to battle"
                  : "Some cards have missing stats — rescan to fix"}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {phase === "running" && sim ? (
        <div className="fixed inset-x-0 bottom-0 top-12 z-[50] flex flex-col bg-[#0a0a0f]/97 px-3 pb-6 pt-4 backdrop-blur-sm pokescan-battle-arena-bg">
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col">
            <div className="mb-3 flex shrink-0 items-center justify-between text-xs font-black">
              <span className="text-[#3B82F6]">
                <span aria-hidden>🔵</span>
                {" Blue  "}
                {scores.blue}
              </span>
              <span className="text-[#F5C518]">
                {scores.gold}
                {"  Gold "}
                <span aria-hidden>🟡</span>
              </span>
            </div>

            <div className="mb-4 grid w-full shrink-0 grid-cols-10 gap-1">
              {Array.from({ length: 10 }, (_, i) => {
                const done = i < filled;
                const w = sim.results[i]?.winner;
                const fillCls =
                  done && w === "yours"
                    ? "bg-[#3B82F6]"
                    : done && w === "theirs"
                      ? "bg-[#F5C518]"
                      : "bg-transparent";
                const showNum = !done;
                const pop = popCell === i;
                return (
                  <div
                    key={i}
                    className="relative aspect-square min-h-0 w-full"
                  >
                    <div
                      className={`flex h-full w-full items-center justify-center rounded-full border-2 border-[#2a2a2a] ${fillCls} ${
                        pop ? "pokescan-score-circle-pop" : ""
                      }`}
                    >
                      {showNum ? (
                        <span className="text-[10px] font-black text-zinc-500">
                          {i + 1}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="min-h-[3.25rem] shrink-0 rounded-full bg-zinc-900/95 px-3 py-3 ring-1 ring-white/10">
              <p
                key={phraseKey}
                className="pokescan-ticker-phrase-in text-center text-sm font-bold leading-snug text-white"
              >
                {line}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {phase === "verdict" && sim ? (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0a0a0f] px-5 py-10">
          <div
            className={`mx-auto mb-4 w-full max-w-sm transition-opacity duration-500 ${
              verdictTickerVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="rounded-full bg-zinc-900/95 px-3 py-3 ring-1 ring-white/10">
              <p className="text-center text-sm font-bold text-white">
                {sim.summary.finalTickerCallout}
              </p>
            </div>
          </div>

          <div className="mb-4 text-5xl pokescan-trophy-bounce" aria-hidden>
            {sim.summary.overallWinner === "tie" ? "🤝" : "🏆"}
          </div>
          <h2
            className={`text-center text-3xl font-black leading-tight tracking-tight sm:text-4xl ${
              sim.summary.overallWinner === "tie"
                ? "text-white"
                : sim.summary.overallWinner === "yours"
                  ? "text-[#3B82F6] pokescan-verdict-title-blue"
                  : "text-[#F5C518] pokescan-verdict-title-gold"
            }`}
          >
            {sim.summary.overallWinner === "tie"
              ? "WHAT A TIE!"
              : sim.summary.overallWinner === "yours"
                ? "BLUE TEAM WINS!"
                : "GOLD TEAM WINS!"}
          </h2>
          <p className="mt-4 text-center text-2xl font-black">
            <span className="text-[#3B82F6]">{sim.summary.yourWins} wins</span>
            <span className="text-white"> — </span>
            <span className="text-[#F5C518]">{sim.summary.theirWins} wins</span>
          </p>
          <p className="mx-auto mt-5 max-w-[300px] text-center text-base font-medium leading-relaxed text-white">
            {sim.summary.summaryText}
          </p>
          {sim.summary.dramaticMoment ? (
            <p className="mx-auto mt-3 max-w-[300px] text-center text-sm font-semibold text-[#F5C518]/90">
              {sim.summary.dramaticMoment}
            </p>
          ) : null}
          <div className="mt-10 flex w-full max-w-sm flex-col gap-3">
            <button
              type="button"
              onClick={resetRoster}
              className="w-full rounded-full bg-[#DC2626] py-4 text-base font-black text-white shadow-[0_8px_30px_rgba(220,38,38,0.35)] transition hover:bg-red-600"
            >
              <span aria-hidden>⚔</span> Battle Again
            </button>
            <button
              type="button"
              onClick={() => {
                resetRoster();
                onGoToMyCards();
              }}
              className="w-full rounded-full bg-[#F5C518] py-4 text-base font-black text-[#0f0f13] transition hover:bg-[#e6b616]"
            >
              ← Back to Cards
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
