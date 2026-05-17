"use client";

import { useCallback, useRef, useState } from "react";
import { InteractiveBattleScreen } from "@/components/InteractiveBattleScreen";
import {
  RosterReviewScreen,
  type HpSnapshot,
} from "@/components/RosterReviewScreen";
import {
  cardPassesBattleValidation,
  displayCardFromRecognition,
  type DisplayCard,
} from "@/lib/cards";
import type { BattleTeam, InteractiveBattleState } from "@/lib/battle";
import { normalizeScanResults } from "@/lib/recognition";
import { prepareImageForScan } from "@/lib/scanImage";
import type { RosterEntry, ScannedCard } from "@/lib/types";
import {
  ScanLoadingOverlay,
  ScanProgressBar,
} from "@/components/ScanProgressBar";
import { scannedFieldsFromDisplayLike } from "@/lib/types";

type TeamSetup = {
  roster: RosterEntry[];
};

function updateRecordsAfterBattle(
  blueRoster: RosterEntry[],
  goldRoster: RosterEntry[],
  winner: BattleTeam,
): { blueRoster: RosterEntry[]; goldRoster: RosterEntry[] } {
  const update = (roster: RosterEntry[], won: boolean): RosterEntry[] =>
    roster.map((entry) => ({
      ...entry,
      record: {
        wins: entry.record.wins + (won ? 1 : 0),
        losses: entry.record.losses + (won ? 0 : 1),
      },
    }));

  return {
    blueRoster: update(blueRoster, winner === "blue"),
    goldRoster: update(goldRoster, winner === "gold"),
  };
}

function extractHpFromBattle(
  state: InteractiveBattleState,
): Record<string, HpSnapshot> {
  const out: Record<string, HpSnapshot> = {};
  for (const team of ["blue", "gold"] as const) {
    for (const fighter of state.teams[team].roster) {
      out[fighter.displayId] = {
        displayId: fighter.displayId,
        currentHp: fighter.currentHp,
        maxHp: fighter.maxHp,
      };
    }
  }
  return out;
}

const MAX_SLOTS = 3;

async function parseScanResponse(res: Response): Promise<{
  ok: boolean;
  status: number;
  data: {
    cards?: unknown[];
    recognitions?: unknown[];
    error?: string;
    raw?: string;
  };
}> {
  const text = await res.text();
  if (!text) {
    return {
      ok: res.ok,
      status: res.status,
      data: { error: res.ok ? undefined : `Empty response (${res.status})` },
    };
  }
  try {
    return {
      ok: res.ok,
      status: res.status,
      data: JSON.parse(text) as {
        cards?: unknown[];
        recognitions?: unknown[];
        error?: string;
        raw?: string;
      },
    };
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 180);
    return {
      ok: false,
      status: res.status,
      data: {
        error:
          res.status === 413
            ? "Image too large. Try a smaller photo."
            : snippet
              ? `Server returned non-JSON (${res.status}): ${snippet}`
              : `Bad response (${res.status})`,
      },
    };
  }
}

function teamIsReady(setup: TeamSetup): boolean {
  if (setup.roster.length === 0) return false;
  return setup.roster.every(
    (e) =>
      !e.card.pendingConfirmation && cardPassesBattleValidation(e.card),
  );
}

export default function Home() {
  const [blueSetup, setBlueSetup] = useState<TeamSetup>({ roster: [] });
  const [goldSetup, setGoldSetup] = useState<TeamSetup>({ roster: [] });
  const [inBattle, setInBattle] = useState(false);
  const [battleKey, setBattleKey] = useState(0);
  const [loadingSlot, setLoadingSlot] = useState<{
    team: BattleTeam;
    slot: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slotErrors, setSlotErrors] = useState<
    Record<string, string>
  >({});
  const [lowScanOpen, setLowScanOpen] = useState(false);
  const [showRosterReview, setShowRosterReview] = useState(false);
  const [lastBattleHp, setLastBattleHp] = useState<Record<string, HpSnapshot>>(
    {},
  );
  const [setupTab, setSetupTab] = useState<BattleTeam>("blue");

  const scanInputRef = useRef<HTMLInputElement>(null);
  const scanTargetRef = useRef<{ team: BattleTeam; slot: number }>({
    team: "blue",
    slot: 0,
  });

  const runScan = useCallback(
    async (file: File, team: BattleTeam, slot: number) => {
      setError(null);
      setSlotErrors((prev) => {
        const next = { ...prev };
        delete next[`${team}-${slot}`];
        return next;
      });
      setLoadingSlot({ team, slot });
      try {
        const dataUrl = await prepareImageForScan(file);
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: dataUrl }),
        });
        const { ok, status, data } = await parseScanResponse(res);
        if (!ok) {
          throw new Error(
            data.error ||
              (status === 500
                ? "Server error — check ANTHROPIC_API_KEY."
                : `Scan failed (${status})`),
          );
        }
        const rawPayload = data.recognitions ?? data.cards;
        const recs = normalizeScanResults(rawPayload ?? []);
        const accepted = recs.filter((r) => r.confidence !== "low");

        if (accepted.length === 0) {
          setLowScanOpen(true);
          return;
        }

        const raw = displayCardFromRecognition(accepted[0]);
        const display: DisplayCard = { ...raw, priceStatus: "deferred" };

        if (
          display.recognitionConfidence === "high" &&
          !cardPassesBattleValidation(display)
        ) {
          setSlotErrors((prev) => ({
            ...prev,
            [`${team}-${slot}`]:
              "This card doesn't have enough battle data — try another card",
          }));
          return;
        }

        const entry: RosterEntry = {
          card: display,
          scannedPhotoDataUrl: dataUrl,
          record: { wins: 0, losses: 0 },
        };
        const setter = team === "blue" ? setBlueSetup : setGoldSetup;
        setter((prev) => {
          const roster = [...prev.roster];
          roster[slot] = entry;
          return { roster: roster.slice(0, MAX_SLOTS) };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setLoadingSlot(null);
      }
    },
    [],
  );

  const openScan = (team: BattleTeam, slot: number) => {
    setError(null);
    scanTargetRef.current = { team, slot };
    scanInputRef.current?.click();
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const { team, slot } = scanTargetRef.current;
    await runScan(file, team, slot);
  };

  const removeSlot = (team: BattleTeam, slot: number) => {
    const setter = team === "blue" ? setBlueSetup : setGoldSetup;
    setter((prev) => ({
      roster: prev.roster.filter((_, i) => i !== slot),
    }));
    setSlotErrors((prev) => {
      const next = { ...prev };
      delete next[`${team}-${slot}`];
      return next;
    });
  };

  const confirmCard = (
    team: BattleTeam,
    slot: number,
    displayId: string,
    selected: ScannedCard,
  ) => {
    const setter = team === "blue" ? setBlueSetup : setGoldSetup;
    setter((prev) => {
      const entry = prev.roster[slot];
      if (!entry || entry.card.displayId !== displayId) return prev;
      const nextCard: DisplayCard = {
        ...entry.card,
        ...selected,
        displayId: entry.card.displayId,
        pendingConfirmation: false,
        alternates: [],
        recognitionConfidence: "medium",
        priceStatus: "deferred",
      };
      if (!cardPassesBattleValidation(nextCard)) {
        setSlotErrors((e) => ({
          ...e,
          [`${team}-${slot}`]:
            "This card doesn't have enough battle data — try another card",
        }));
        return prev;
      }
      const roster = [...prev.roster];
      roster[slot] = { ...entry, card: nextCard };
      return { roster };
    });
  };

  const bothReady = teamIsReady(blueSetup) && teamIsReady(goldSetup);
  const isLoading = loadingSlot !== null;

  const toRosterTuples = (setup: TeamSetup) =>
    setup.roster.map(
      (e) => [e.card, e.scannedPhotoDataUrl] as [DisplayCard, string | null],
    );

  const handleCheckRosters = (finalState: InteractiveBattleState) => {
    const winner: BattleTeam =
      finalState.status === "blue_wins" ? "blue" : "gold";
    const updated = updateRecordsAfterBattle(
      blueSetup.roster,
      goldSetup.roster,
      winner,
    );
    setBlueSetup({ roster: updated.blueRoster });
    setGoldSetup({ roster: updated.goldRoster });
    setLastBattleHp(extractHpFromBattle(finalState));
    setInBattle(false);
    setShowRosterReview(true);
  };

  const handleBattleAgain = () => {
    setShowRosterReview(false);
    setBattleKey((k) => k + 1);
    setInBattle(true);
  };

  if (showRosterReview) {
    return (
      <RosterReviewScreen
        blueRoster={blueSetup.roster}
        goldRoster={goldSetup.roster}
        hpByDisplayId={lastBattleHp}
        onBlueRosterChange={(roster) => setBlueSetup({ roster })}
        onGoldRosterChange={(roster) => setGoldSetup({ roster })}
        onReady={handleBattleAgain}
      />
    );
  }

  if (inBattle && bothReady) {
    return (
      <InteractiveBattleScreen
        key={battleKey}
        blueRoster={toRosterTuples(blueSetup)}
        goldRoster={toRosterTuples(goldSetup)}
        onCheckRosters={handleCheckRosters}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col bg-[#0f0f13] text-white">
      <input
        ref={scanInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPickFile}
      />

      {lowScanOpen && (
        <LowScanOverlay
          onDismiss={() => setLowScanOpen(false)}
          onRetry={() => {
            setLowScanOpen(false);
            const { team, slot } = scanTargetRef.current;
            openScan(team, slot);
          }}
        />
      )}

      <header className="shrink-0 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] text-center">
        <span className="text-xl font-bold tracking-tight text-[#F5C518]">
          PokeBlock
        </span>
        <p className="mt-1 text-sm text-zinc-500">
          Photograph each Pokémon card — AI reads HP, type &amp; attacks from your
          photo. Super-effective hits use type matchups, not the card footer.
        </p>
      </header>

      <div className="flex shrink-0 gap-2 px-4 pb-3 md:hidden">
        <SetupTeamTab
          label="Blue"
          color="#3B82F6"
          active={setupTab === "blue"}
          ready={teamIsReady(blueSetup)}
          onClick={() => setSetupTab("blue")}
        />
        <SetupTeamTab
          label="Gold"
          color="#F59E0B"
          active={setupTab === "gold"}
          ready={teamIsReady(goldSetup)}
          onClick={() => setSetupTab("gold")}
        />
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-4">
        <div className="hidden flex-col gap-4 md:flex md:flex-row">
          <TeamPanel
            label="BLUE TEAM"
            color="#3B82F6"
            setup={blueSetup}
            loadingSlot={loadingSlot?.team === "blue" ? loadingSlot.slot : null}
            slotErrors={slotErrors}
            onScan={openScan}
            onRemove={removeSlot}
            onConfirm={confirmCard}
          />
          <TeamPanel
            label="GOLD TEAM"
            color="#F59E0B"
            setup={goldSetup}
            loadingSlot={loadingSlot?.team === "gold" ? loadingSlot.slot : null}
            slotErrors={slotErrors}
            onScan={openScan}
            onRemove={removeSlot}
            onConfirm={confirmCard}
          />
        </div>
        <div className="md:hidden">
          {setupTab === "blue" ? (
            <TeamPanel
              label="BLUE TEAM"
              color="#3B82F6"
              setup={blueSetup}
              loadingSlot={loadingSlot?.team === "blue" ? loadingSlot.slot : null}
              slotErrors={slotErrors}
              onScan={openScan}
              onRemove={removeSlot}
              onConfirm={confirmCard}
            />
          ) : (
            <TeamPanel
              label="GOLD TEAM"
              color="#F59E0B"
              setup={goldSetup}
              loadingSlot={loadingSlot?.team === "gold" ? loadingSlot.slot : null}
              slotErrors={slotErrors}
              onScan={openScan}
              onRemove={removeSlot}
              onConfirm={confirmCard}
            />
          )}
        </div>
      </main>

      <footer className="ps-sticky-footer px-4">
        {error && (
          <p className="mb-2 text-center text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={!bothReady || isLoading}
          onClick={() => {
            setError(null);
            setInBattle(true);
          }}
          className="ps-btn ps-touch w-full rounded-full bg-[#DC2626] py-4 text-lg font-bold text-white shadow-[0_8px_30px_rgba(220,38,38,0.25)] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40"
        >
          ⚔ BATTLE
        </button>
      </footer>
    </div>
  );
}

const SLOT_LABELS = ["Active", "Bench 1", "Bench 2"] as const;

function SetupTeamTab({
  label,
  color,
  active,
  ready,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  ready: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ps-touch ps-btn flex-1 rounded-xl py-3 text-sm font-bold transition ${
        active ? "text-white ring-2" : "bg-white/[0.04] text-zinc-400 ring-1 ring-white/10"
      }`}
      style={
        active
          ? { backgroundColor: `${color}33`, borderColor: color, boxShadow: `0 0 20px ${color}33` }
          : undefined
      }
    >
      {label}
      {ready ? " ✓" : ""}
    </button>
  );
}

function TeamPanel({
  label,
  color,
  setup,
  loadingSlot,
  slotErrors,
  onScan,
  onRemove,
  onConfirm,
}: {
  label: string;
  color: string;
  setup: TeamSetup;
  loadingSlot: number | null;
  slotErrors: Record<string, string>;
  onScan: (team: BattleTeam, slot: number) => void;
  onRemove: (team: BattleTeam, slot: number) => void;
  onConfirm: (
    team: BattleTeam,
    slot: number,
    displayId: string,
    selected: ScannedCard,
  ) => void;
}) {
  const team: BattleTeam = label.startsWith("BLUE") ? "blue" : "gold";
  const hasActive = setup.roster.length > 0;
  const visibleSlots = hasActive
    ? Math.min(MAX_SLOTS, setup.roster.length + (setup.roster.length < MAX_SLOTS ? 1 : 0))
    : 1;

  const glowStyle = {
    boxShadow: `0 0 32px ${color}22`,
    borderColor: `${color}55`,
  };

  return (
    <section
      className="flex flex-1 flex-col gap-3 rounded-2xl border bg-white/[0.03] p-4"
      style={glowStyle}
    >
      <h2
        className="text-center text-sm font-bold tracking-widest"
        style={{ color }}
      >
        {label}
      </h2>
      {Array.from({ length: visibleSlots }, (_, slot) => {
        const entry = setup.roster[slot];
        const slotLabel = SLOT_LABELS[slot];
        const err = slotErrors[`${team}-${slot}`];
        const loading = loadingSlot === slot;

        if (!entry) {
          return (
            <button
              key={slot}
              type="button"
              onClick={() => onScan(team, slot)}
              disabled={loading}
              className="ps-touch flex min-h-[11rem] flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 bg-white/[0.02] active:bg-white/[0.04] disabled:pointer-events-none disabled:opacity-60"
            >
              {loading ? (
                <ScanProgressBar
                  accentColor={color}
                  className="w-full max-w-[10.5rem] px-3"
                />
              ) : (
                <>
                  <span className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                    {slotLabel}
                  </span>
                  <CameraGlyph className="mb-2 h-8 w-8 text-zinc-500" />
                  <span className="text-xs text-zinc-500">Scan card</span>
                </>
              )}
            </button>
          );
        }

        const pending =
          entry.card.pendingConfirmation &&
          entry.card.recognitionConfidence === "medium";

        if (pending) {
          return (
            <ScanLoadingOverlay
              key={slot}
              active={loading}
              accentColor={color}
              className="rounded-xl"
            >
              <div className="rounded-xl ring-1 ring-yellow-500/30">
                <p className="bg-yellow-500/10 px-2 py-1 text-center text-[10px] font-medium text-yellow-200">
                  {slotLabel} — Is this right?
                </p>
                <MediumConfirmPanel
                  card={entry.card}
                  onConfirm={(id, sel) => onConfirm(team, slot, id, sel)}
                  onRescan={() => onScan(team, slot)}
                  onRemove={() => onRemove(team, slot)}
                />
              </div>
            </ScanLoadingOverlay>
          );
        }

        return (
          <ScanLoadingOverlay
            key={slot}
            active={loading}
            accentColor={color}
            className="rounded-xl"
          >
          <div className="relative rounded-xl bg-white/[0.02] p-2 ring-1 ring-white/10">
            <span className="mb-1 block text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
              {slotLabel}
            </span>
            <button
              type="button"
              onClick={() => onRemove(team, slot)}
              className="ps-touch absolute right-1 top-1 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-lg text-zinc-200 active:bg-black/90"
              aria-label="Remove"
            >
              ×
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={entry.scannedPhotoDataUrl ?? ""}
              alt={entry.card.name}
              className="mx-auto mb-2 aspect-[63/88] w-28 max-w-full rounded-lg object-contain sm:w-24"
            />
            <p className="text-center text-sm font-semibold text-white">
              {entry.card.name}
            </p>
            <p className="text-center text-xs text-zinc-500">{entry.card.type}</p>
            <p className="text-center text-sm font-medium" style={{ color }}>
              {entry.card.battleHp} HP
            </p>
            {err && (
              <p className="mt-1 text-center text-[10px] text-red-400">{err}</p>
            )}
          </div>
          </ScanLoadingOverlay>
        );
      })}
    </section>
  );
}

function MediumConfirmPanel({
  card,
  onConfirm,
  onRescan,
  onRemove,
}: {
  card: DisplayCard;
  onConfirm: (displayId: string, selected: ScannedCard) => void;
  onRescan: () => void;
  onRemove: () => void;
}) {
  const primary = scannedFieldsFromDisplayLike(card);
  return (
    <div className="space-y-2 p-3">
      <p className="text-center text-sm font-semibold text-white">{card.name}</p>
      <button
        type="button"
        onClick={() => onConfirm(card.displayId, primary)}
        className="ps-btn ps-touch w-full rounded-lg bg-[#F5C518]/15 px-3 py-3 text-sm font-medium text-[#F5C518] ring-1 ring-[#F5C518]/40"
      >
        Yes — use this match
      </button>
      {card.alternates.map((alt, i) => (
        <button
          key={`${alt.number}-${i}`}
          type="button"
          onClick={() => onConfirm(card.displayId, alt)}
          className="w-full rounded-lg bg-white/5 px-3 py-2 text-xs text-white ring-1 ring-white/10"
        >
          {alt.name} · #{alt.number}
        </button>
      ))}
      <button
        type="button"
        onClick={onRescan}
        className="w-full text-center text-xs text-zinc-500 underline"
      >
        Rescan
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="w-full text-center text-xs text-zinc-600"
      >
        Cancel
      </button>
    </div>
  );
}

function LowScanOverlay({
  onDismiss,
  onRetry,
}: {
  onDismiss: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[#18181f] p-5 ring-1 ring-white/10">
        <h2 className="text-lg font-semibold text-white">
          Couldn&apos;t read this card clearly
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-zinc-400">
          <li>One card in the photo — fill the frame</li>
          <li>Make sure the card number is visible</li>
          <li>Try better lighting — avoid glare</li>
        </ul>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="w-full rounded-full bg-[#F5C518] py-3 text-sm font-semibold text-[#0f0f13]"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="w-full rounded-full bg-white/10 py-3 text-sm font-semibold text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CameraGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 7h3l2-2h6l2 2h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
      <circle cx="12" cy="13" r="3.25" />
    </svg>
  );
}
