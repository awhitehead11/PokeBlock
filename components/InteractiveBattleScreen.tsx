"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DisplayCard } from "@/lib/cards";
import {
  advanceTurn,
  applyTurnResolution,
  applySubstitute,
  applyChooseReplacement,
  applyStatusBlock,
  buildInteractiveTurnPrompt,
  createInteractiveBattle,
  formatTurnLog,
  getActiveFighter,
  getBenchFighters,
  INTERACTIVE_BATTLE_SYSTEM_PROMPT,
  type BattleTeam,
  type InteractiveBattleState,
  type InteractiveFighter,
  type TurnLogEntry,
  type TurnResolution,
} from "@/lib/battle";
import { CoinFlipModal } from "@/components/CoinFlipModal";
import type { ScannedAttack, StatusCondition } from "@/lib/types";

type Props = {
  blueRoster: Array<[DisplayCard, string | null]>;
  goldRoster: Array<[DisplayCard, string | null]>;
  onCheckRosters: (finalState: InteractiveBattleState) => void;
};

const BLUE = "#3B82F6";
const GOLD = "#F59E0B";

/** Blue always left / first, Gold always right / second — never reorder by active team. */
const TEAM_DISPLAY_ORDER: BattleTeam[] = ["blue", "gold"];

function turnRecapBody(entry: TurnLogEntry): string {
  const line = formatTurnLog([entry])[0] ?? "";
  return line.replace(/^Turn \d+ /, "");
}

function BattleTurnRecap({ log }: { log: TurnLogEntry[] }) {
  if (log.length === 0) {
    return (
      <p className="mt-4 text-center text-sm text-zinc-500">No turn history.</p>
    );
  }

  const lastIndex = log.length - 1;

  return (
    <div className="mt-4">
      <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Turn by turn
      </p>
      <div className="max-h-52 overflow-y-auto overscroll-y-contain rounded-xl bg-black/35 p-3 ring-1 ring-white/10">
        <ul className="space-y-2.5">
          {log.map((entry, i) => {
            const isLast = i === lastIndex;
            const isFinisher =
              isLast && (entry.wasKnockedOut || entry.finalDamage > 0);
            return (
              <li
                key={`${entry.turn}-${i}-${entry.attackUsed}`}
                className={`text-sm leading-snug ${
                  isFinisher
                    ? "rounded-lg bg-white/[0.06] px-2 py-1.5 text-white ring-1 ring-white/15"
                    : "text-zinc-400"
                }`}
              >
                <span
                  className={`mr-1.5 font-bold tabular-nums ${
                    isFinisher ? "text-yellow-300" : "text-zinc-500"
                  }`}
                >
                  T{entry.turn}:
                </span>
                {turnRecapBody(entry)}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function teamColor(team: BattleTeam): string {
  return team === "blue" ? BLUE : GOLD;
}

function teamLabel(team: BattleTeam): string {
  return team === "blue" ? "BLUE" : "GOLD";
}

const STATUS_BADGE: Record<
  Exclude<StatusCondition, "none">,
  { label: string; bg: string; text: string }
> = {
  poisoned: { label: "PSN", bg: "#7C3AED", text: "#EDE9FE" },
  burned: { label: "BRN", bg: "#EA580C", text: "#FFEDD5" },
  paralyzed: { label: "PAR", bg: "#EAB308", text: "#422006" },
  asleep: { label: "SLP", bg: "#2563EB", text: "#DBEAFE" },
  confused: { label: "CNF", bg: "#EC4899", text: "#FCE7F3" },
};

function fighterImageSrc(fighter: InteractiveFighter): string | null {
  return fighter.scannedPhotoDataUrl ?? fighter.imageUrl ?? null;
}

function typeInitial(type: string): string {
  const t = type.trim();
  if (!t || t === "?") return "?";
  return t.charAt(0).toUpperCase();
}

function benchWithIndices(
  state: InteractiveBattleState,
  team: BattleTeam,
): Array<{ fighter: InteractiveFighter; index: number }> {
  const t = state.teams[team];
  return t.roster
    .map((fighter, index) => ({ fighter, index }))
    .filter(
      ({ fighter, index }) =>
        index !== t.activeIndex && !fighter.isKnockedOut,
    );
}

function StatusBadge({ status }: { status: StatusCondition }) {
  if (status === "none") return null;
  const badge = STATUS_BADGE[status];
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
      style={{ backgroundColor: badge.bg, color: badge.text }}
    >
      {badge.label}
    </span>
  );
}

function HpBar({
  current,
  max,
  team,
}: {
  current: number;
  max: number;
  team: BattleTeam;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  const fill = teamColor(team);
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${pct}%`, backgroundColor: fill }}
      />
    </div>
  );
}

function FighterPortrait({
  fighter,
  compact,
}: {
  fighter: InteractiveFighter;
  compact?: boolean;
}) {
  const src = fighterImageSrc(fighter);
  const h = compact ? "h-12" : "h-24";
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={fighter.name}
        className={`${h} w-full object-contain`}
      />
    );
  }
  return (
    <div
      className={`flex ${h} w-full items-center justify-center rounded-lg font-bold text-white/30 ${compact ? "text-lg" : "text-3xl"}`}
      style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
      aria-hidden
    >
      {typeInitial(fighter.type)}
    </div>
  );
}

function FighterPanel({
  fighter,
  team,
  dimmed,
}: {
  fighter: InteractiveFighter;
  team: BattleTeam;
  dimmed: boolean;
}) {
  const color = teamColor(team);
  return (
    <div
      className={`flex flex-col rounded-2xl bg-white/[0.04] p-3 transition-opacity ${
        dimmed ? "opacity-40 ring-1 ring-white/10" : "ring-2"
      }`}
      style={{
        boxShadow: dimmed ? undefined : `0 0 20px ${color}22`,
        ...(dimmed ? {} : { borderColor: color }),
      }}
    >
      <p
        className="mb-2 text-center text-[10px] font-bold uppercase tracking-widest"
        style={{ color }}
      >
        {teamLabel(team)} TEAM
      </p>
      <div className="relative">
        <FighterPortrait fighter={fighter} />
        {fighter.statusCondition !== "none" && (
          <div className="absolute right-0 top-0">
            <StatusBadge status={fighter.statusCondition} />
          </div>
        )}
      </div>
      <h3 className="mt-2 line-clamp-2 text-center text-base font-bold leading-tight text-white">
        {fighter.name}
      </h3>
      <span
        className="mx-auto mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
        style={{ backgroundColor: `${color}33`, color }}
      >
        {fighter.type}
      </span>
      <div className="mt-2">
        <HpBar current={fighter.currentHp} max={fighter.maxHp} team={team} />
        <p className="mt-1 text-center text-sm font-medium text-zinc-300">
          {fighter.currentHp} / {fighter.maxHp} HP
        </p>
      </div>
      {fighter.isKnockedOut && (
        <p className="mt-1 text-center text-xs font-semibold text-red-400">
          KO
        </p>
      )}
    </div>
  );
}

function BenchRow({
  state,
  team,
  dimmed,
  onPick,
  picking,
}: {
  state: InteractiveBattleState;
  team: BattleTeam;
  dimmed: boolean;
  onPick?: (index: number) => void;
  picking?: boolean;
}) {
  const bench = benchWithIndices(state, team);
  if (bench.length === 0) return null;

  return (
    <div
      className="mt-2 transition-opacity"
      style={{ opacity: dimmed ? 0.4 : 1 }}
    >
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        Bench
      </p>
      <div className="flex gap-2">
        {bench.map(({ fighter, index }) => {
          const src = fighterImageSrc(fighter);
          return (
            <button
              key={fighter.displayId}
              type="button"
              disabled={!picking}
              onClick={() => onPick?.(index)}
              className={`flex flex-1 flex-col items-center rounded-lg bg-white/[0.04] p-2 ring-1 ring-white/10 ${
                picking
                  ? "cursor-pointer hover:bg-white/[0.08]"
                  : "cursor-default"
              }`}
            >
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={fighter.name}
                  className="h-10 w-full object-contain"
                />
              ) : (
                <div className="flex h-10 w-full items-center justify-center text-sm font-bold text-white/25">
                  {typeInitial(fighter.type)}
                </div>
              )}
              <span className="mt-1 truncate text-[10px] text-zinc-300">
                {fighter.name}
              </span>
              <span className="text-[9px] text-zinc-500">
                {fighter.currentHp} HP
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NarrativePanel({ result }: { result: TurnLogEntry | null }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!result) {
      setVisible(false);
      return;
    }
    setVisible(false);
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [result]);

  if (!result) return null;

  const borderColor = teamColor(result.attackerTeam);

  return (
    <div className="my-4">
      <div
        className={`rounded-r-xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/10 transition-opacity duration-500 ${visible ? "opacity-100" : "opacity-0"}`}
        style={{ borderLeft: `4px solid ${borderColor}` }}
      >
        <p className="text-sm italic leading-relaxed text-zinc-300">
          {result.narrative}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {result.isWeakness && (
            <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-[10px] font-semibold text-yellow-300">
              Super Effective
            </span>
          )}
          {result.isResistance && (
            <span className="rounded-full bg-zinc-500/20 px-2 py-0.5 text-[10px] font-semibold text-zinc-300">
              Resisted
            </span>
          )}
          {result.statusApplied && result.statusApplied !== "none" && (
            <StatusBadge status={result.statusApplied} />
          )}
        </div>
      </div>
    </div>
  );
}

function WinnerOverlay({
  state,
  onCheckRosters,
}: {
  state: InteractiveBattleState;
  onCheckRosters: () => void;
}) {
  const winnerTeam: BattleTeam =
    state.status === "blue_wins" ? "blue" : "gold";
  const winner = getActiveFighter(state, winnerTeam);
  const photo = fighterImageSrc(winner);
  const color = teamColor(winnerTeam);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 p-4 backdrop-blur-sm sm:items-center">
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-[#18181f] p-6 ring-1 ring-white/10">
        <p className="text-center text-5xl">🏆</p>
        <h2 className="mt-3 text-center text-2xl font-bold" style={{ color }}>
          {teamLabel(winnerTeam)} TEAM WINS!
        </h2>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={winner.name}
            className="mx-auto mt-4 h-40 w-full max-w-xs rounded-xl object-contain"
          />
        ) : (
          <div
            className="mx-auto mt-4 flex h-40 w-32 items-center justify-center rounded-xl text-5xl font-bold text-white/20"
            style={{ backgroundColor: `${color}22` }}
          >
            {typeInitial(winner.type)}
          </div>
        )}
        <p className="mt-2 text-center text-lg font-semibold text-white">
          {winner.name}
        </p>
        <BattleTurnRecap log={state.log} />
        <div className="mt-6">
          <button
            type="button"
            onClick={onCheckRosters}
            className="w-full rounded-full py-3.5 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: color }}
          >
            Check Rosters →
          </button>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin text-zinc-400"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export function InteractiveBattleScreen({
  blueRoster,
  goldRoster,
  onCheckRosters,
}: Props) {
  const [state, setState] = useState<InteractiveBattleState>(() =>
    createInteractiveBattle(blueRoster, goldRoster),
  );
  const [error, setError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [substituteOpen, setSubstituteOpen] = useState(false);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (state.turnStatus !== "status_blocked") return;

    statusTimerRef.current = setTimeout(() => {
      setState((s) => applyStatusBlock(s));
    }, 2000);

    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, [state.turnStatus, state.turn, state.activeTeam]);

  const handleAttack = useCallback(
    async (attack: ScannedAttack) => {
      if (state.turnStatus !== "choosing" || state.status !== "active") return;

      setError(null);
      setSubstituteOpen(false);
      setState((s) => ({ ...s, turnStatus: "resolving" }));

      const snapshot = state;

      try {
        const res = await fetch("/api/battle-turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: buildInteractiveTurnPrompt(snapshot, attack),
            systemPrompt: INTERACTIVE_BATTLE_SYSTEM_PROMPT,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          const detail =
            typeof data.detail === "string" ? data.detail : null;
          throw new Error(
            data.error === "parse_error"
              ? "Could not parse battle result — try again."
              : detail ??
                  (data.error === "claude_error"
                    ? "Battle resolution failed — try again."
                    : typeof data.error === "string"
                      ? data.error
                      : "Battle resolution failed — try again."),
          );
        }
        const resolution = data as TurnResolution;
        const after = applyTurnResolution(snapshot, resolution);
        setState(after);

        if (after.turnStatus === "animating") {
          animTimerRef.current = setTimeout(() => {
            setState((s) => advanceTurn(s));
          }, 800);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
        setState({ ...snapshot, turnStatus: "choosing" });
      }
    },
    [state],
  );

  const handleSubstitute = useCallback(
    (rosterIndex: number) => {
      setState((s) => applySubstitute(s, rosterIndex));
      setSubstituteOpen(false);
    },
    [],
  );

  const handleReplacement = useCallback((rosterIndex: number) => {
    setState((s) => applyChooseReplacement(s, rosterIndex));
  }, []);

  const handleCoinFlipResult = useCallback((firstTeam: BattleTeam) => {
    setState((prev) => ({
      ...prev,
      activeTeam: firstTeam,
      turnStatus: "choosing",
    }));
  }, []);

  const activeTeam = state.activeTeam;
  const activeColor = teamColor(activeTeam);
  const activeFighter = getActiveFighter(state, activeTeam);
  const benchAvailable = getBenchFighters(state, activeTeam).length > 0;
  const isChoosing =
    state.turnStatus === "choosing" && state.status === "active";
  const isBlocked = state.turnStatus === "status_blocked";
  const blockedFighter = isBlocked
    ? getActiveFighter(state, activeTeam)
    : null;

  const logLines = formatTurnLog(state.log).reverse();

  const coinFlipOpen = state.turnStatus === "coin_flip";

  return (
    <div
      className={`flex min-h-dvh flex-col bg-[#0f0f13] text-white ${coinFlipOpen ? "pointer-events-none" : ""}`}
    >
      {coinFlipOpen && (
        <CoinFlipModal onResult={handleCoinFlipResult} />
      )}
      <header
        className="shrink-0 border-b border-white/10 px-4 py-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
        style={{ backgroundColor: `${activeColor}14` }}
      >
        <p
          className="text-center text-base font-semibold tracking-wide"
          style={{ color: activeColor }}
        >
          {coinFlipOpen
            ? "Coin flip"
            : `${teamLabel(activeTeam)}'s turn · Turn ${state.turn}`}
        </p>
      </header>

      {isBlocked && blockedFighter && (
        <div
          className="px-4 py-2 text-center text-sm font-medium"
          style={{
            backgroundColor: `${activeColor}22`,
            color: activeColor,
          }}
        >
          {blockedFighter.statusCondition === "asleep"
            ? `${blockedFighter.name} is fast asleep…`
            : `${blockedFighter.name} is paralyzed and can't move!`}
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3">
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {TEAM_DISPLAY_ORDER.map((team) => (
            <div key={team}>
              <FighterPanel
                fighter={getActiveFighter(state, team)}
                team={team}
                dimmed={activeTeam !== team}
              />
              <BenchRow
                state={state}
                team={team}
                dimmed={activeTeam !== team}
                picking={
                  substituteOpen &&
                  activeTeam === team &&
                  state.turnStatus === "choosing"
                }
                onPick={
                  substituteOpen && activeTeam === team
                    ? handleSubstitute
                    : undefined
                }
              />
            </div>
          ))}
        </div>

        <NarrativePanel result={state.lastTurnResult} />

        <div className="mt-4 border-t border-white/10 pt-3">
          <button
            type="button"
            onClick={() => setLogOpen((o) => !o)}
            className="ps-touch w-full py-2 text-left text-sm font-medium text-zinc-500"
          >
            {logOpen ? "▼" : "▶"} Battle Log
          </button>
          {logOpen && (
            <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs leading-relaxed text-zinc-500">
              {logLines.map((line, i) => (
                <li key={`${i}-${line.slice(0, 24)}`}>{line}</li>
              ))}
            </ul>
          )}
        </div>
        </div>

        <section className="shrink-0 space-y-3 border-t border-white/10 bg-[#0f0f13]/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
          {error && (
            <p className="text-center text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          {isChoosing && (
            <div
              className="rounded-2xl p-4 ring-1"
              style={{
                backgroundColor: `${activeColor}10`,
                borderColor: `${activeColor}44`,
              }}
            >
              <p className="mb-3 text-sm text-zinc-300">
                <span className="font-semibold text-white">
                  {activeFighter.name}
                </span>{" "}
                — choose an action
              </p>

              {substituteOpen ? (
                <div>
                  <p className="mb-2 text-xs text-zinc-400">
                    Tap a bench Pokémon to substitute in
                  </p>
                  <button
                    type="button"
                    onClick={() => setSubstituteOpen(false)}
                    className="w-full rounded-xl bg-white/[0.06] py-2 text-sm text-zinc-400 ring-1 ring-white/10"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    {activeFighter.attacks.map((atk) => (
                      <button
                        key={atk.name}
                        type="button"
                        onClick={() => handleAttack(atk)}
                        className="ps-touch ps-btn w-full rounded-xl px-4 py-3.5 text-left text-base text-white active:brightness-110"
                        style={{
                          backgroundColor: `${activeColor}33`,
                          border: `1px solid ${activeColor}66`,
                        }}
                      >
                        <span className="font-semibold">{atk.name}</span>
                        <span className="text-white/70"> — {atk.damage}</span>
                        {atk.text ? (
                          <span className="mt-1 block text-xs text-white/50">
                            {atk.text}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  {benchAvailable && (
                    <button
                      type="button"
                      onClick={() => setSubstituteOpen(true)}
                      className="ps-touch ps-btn mt-2 w-full rounded-xl py-3 text-sm font-semibold active:brightness-110"
                      style={{
                        color: activeColor,
                        border: `1px solid ${activeColor}55`,
                        backgroundColor: `${activeColor}18`,
                      }}
                    >
                      ⇄ Substitute (skips turn)
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {state.turnStatus === "resolving" && (
            <div className="flex items-center justify-center gap-2 py-8">
              <Spinner />
              <span className="text-sm text-zinc-400">Resolving turn…</span>
            </div>
          )}

          {state.turnStatus === "animating" && (
            <p className="py-4 text-center text-sm text-zinc-500">
              Turn resolving…
            </p>
          )}
        </section>
      </main>

      {state.turnStatus === "choosing_replacement" && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-[#18181f] p-5 ring-1 ring-white/10">
            <h3
              className="text-lg font-bold"
              style={{ color: activeColor }}
            >
              Choose a replacement
            </h3>
            <p className="mt-1 text-sm text-zinc-400">
              {teamLabel(activeTeam)} needs a new active Pokémon
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {benchWithIndices(state, activeTeam).map(({ fighter, index }) => (
                <button
                  key={fighter.displayId}
                  type="button"
                  onClick={() => handleReplacement(index)}
                  className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-4 py-3 text-left ring-1 ring-white/10 transition hover:bg-white/10"
                >
                  <div className="w-14 shrink-0">
                    <FighterPortrait fighter={fighter} compact />
                  </div>
                  <div>
                    <p className="font-semibold text-white">{fighter.name}</p>
                    <p className="text-xs text-zinc-400">
                      {fighter.currentHp} / {fighter.maxHp} HP · {fighter.type}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {state.status !== "active" && (
        <WinnerOverlay
          state={state}
          onCheckRosters={() => onCheckRosters(state)}
        />
      )}
    </div>
  );
}
