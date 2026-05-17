"use client";

import { useCallback, useRef, useState } from "react";
import {
  cardPassesBattleValidation,
  displayCardFromRecognition,
  type DisplayCard,
} from "@/lib/cards";
import { normalizeScanResults } from "@/lib/recognition";
import { ScanProgressBar } from "@/components/ScanProgressBar";
import { prepareImageForScan } from "@/lib/scanImage";
import type { RosterEntry } from "@/lib/types";

type BattleTeam = "blue" | "gold";

export type HpSnapshot = {
  displayId: string;
  currentHp: number;
  maxHp: number;
};

type RosterReviewScreenProps = {
  blueRoster: RosterEntry[];
  goldRoster: RosterEntry[];
  hpByDisplayId: Record<string, HpSnapshot>;
  onBlueRosterChange: (roster: RosterEntry[]) => void;
  onGoldRosterChange: (roster: RosterEntry[]) => void;
  onReady: () => void;
};

const BLUE = "#3B82F6";
const GOLD = "#F59E0B";

function recordBadgeStyle(wins: number, losses: number): string {
  if (wins > losses) return "bg-emerald-600/90";
  if (losses > wins) return "bg-red-600/90";
  return "bg-zinc-600/90";
}

function teamReady(roster: RosterEntry[]): boolean {
  return (
    roster.length > 0 &&
    roster.every(
      (e) =>
        !e.card.pendingConfirmation && cardPassesBattleValidation(e.card),
    )
  );
}

export function RosterReviewScreen({
  blueRoster,
  goldRoster,
  hpByDisplayId,
  onBlueRosterChange,
  onGoldRosterChange,
  onReady,
}: RosterReviewScreenProps) {
  const scanInputRef = useRef<HTMLInputElement>(null);
  const scanTargetRef = useRef<{ team: BattleTeam; slot: number }>({
    team: "blue",
    slot: 0,
  });
  const [loading, setLoading] = useState<{ team: BattleTeam; slot: number } | null>(
    null,
  );
  const [confirmRemove, setConfirmRemove] = useState<{
    team: BattleTeam;
    slot: number;
  } | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);

  const runScan = useCallback(
    async (file: File, team: BattleTeam, slot: number) => {
      setSlotError(null);
      setLoading({ team, slot });
      try {
        const dataUrl = await prepareImageForScan(file);
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: dataUrl }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) throw new Error(data.error ?? "Scan failed");

        const recs = normalizeScanResults(
          data.recognitions ?? data.cards ?? [],
        ).filter((r) => r.confidence !== "low");
        if (recs.length === 0) {
          setSlotError("Could not read card — try again");
          return;
        }

        const raw = displayCardFromRecognition(recs[0]);
        const card: DisplayCard = { ...raw, priceStatus: "deferred" };
        if (
          card.recognitionConfidence === "high" &&
          !cardPassesBattleValidation(card)
        ) {
          setSlotError("Card missing battle data — try another");
          return;
        }

        const entry: RosterEntry = {
          card,
          scannedPhotoDataUrl: dataUrl,
          record: { wins: 0, losses: 0 },
        };

        const setter =
          team === "blue" ? onBlueRosterChange : onGoldRosterChange;
        const roster = team === "blue" ? [...blueRoster] : [...goldRoster];
        roster[slot] = entry;
        setter(roster);
      } catch (e) {
        setSlotError(e instanceof Error ? e.message : "Scan failed");
      } finally {
        setLoading(null);
      }
    },
    [blueRoster, goldRoster, onBlueRosterChange, onGoldRosterChange],
  );

  const openScan = (team: BattleTeam, slot: number) => {
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

  const removeAt = (team: BattleTeam, slot: number) => {
    const setter = team === "blue" ? onBlueRosterChange : onGoldRosterChange;
    const roster = (team === "blue" ? blueRoster : goldRoster).filter(
      (_, i) => i !== slot,
    );
    setter(roster);
    setConfirmRemove(null);
  };

  const bothReady = teamReady(blueRoster) && teamReady(goldRoster);

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

      <header className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 text-center">
        <h1 className="text-xl font-bold text-white">Roster Review</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Check your teams before the next battle
        </p>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-4">
        <div className="flex flex-col gap-4 md:flex-row">
        <TeamReviewPanel
          label="BLUE TEAM"
          color={BLUE}
          roster={blueRoster}
          hpByDisplayId={hpByDisplayId}
          confirmRemove={confirmRemove?.team === "blue" ? confirmRemove.slot : null}
          loadingSlot={loading?.team === "blue" ? loading.slot : null}
          onRequestRemove={(slot) => setConfirmRemove({ team: "blue", slot })}
          onCancelRemove={() => setConfirmRemove(null)}
          onConfirmRemove={(slot) => removeAt("blue", slot)}
          onScan={(slot) => openScan("blue", slot)}
        />
        <TeamReviewPanel
          label="GOLD TEAM"
          color={GOLD}
          roster={goldRoster}
          hpByDisplayId={hpByDisplayId}
          confirmRemove={confirmRemove?.team === "gold" ? confirmRemove.slot : null}
          loadingSlot={loading?.team === "gold" ? loading.slot : null}
          onRequestRemove={(slot) => setConfirmRemove({ team: "gold", slot })}
          onCancelRemove={() => setConfirmRemove(null)}
          onConfirmRemove={(slot) => removeAt("gold", slot)}
          onScan={(slot) => openScan("gold", slot)}
        />
        </div>
      </main>

      <footer className="ps-sticky-footer px-4">
        {slotError && (
          <p className="mb-2 text-center text-sm text-red-400">{slotError}</p>
        )}
        <button
          type="button"
          disabled={!bothReady || loading !== null}
          onClick={onReady}
          className="ps-btn ps-touch w-full rounded-full bg-[#DC2626] py-4 text-lg font-bold text-white disabled:opacity-40"
        >
          ⚔ Battle Again!
        </button>
      </footer>
    </div>
  );
}

function TeamReviewPanel({
  label,
  color,
  roster,
  hpByDisplayId,
  confirmRemove,
  loadingSlot,
  onRequestRemove,
  onCancelRemove,
  onConfirmRemove,
  onScan,
}: {
  label: string;
  color: string;
  roster: RosterEntry[];
  hpByDisplayId: Record<string, HpSnapshot>;
  confirmRemove: number | null;
  loadingSlot: number | null;
  onRequestRemove: (slot: number) => void;
  onCancelRemove: () => void;
  onConfirmRemove: (slot: number) => void;
  onScan: (slot: number) => void;
}) {
  const slots = roster.length;
  const showEmptySlot = slots < 3;

  return (
    <section
      className="flex flex-1 flex-col gap-3 rounded-2xl border p-4"
      style={{
        borderColor: `${color}55`,
        boxShadow: `0 0 24px ${color}18`,
      }}
    >
      <h2
        className="text-center text-sm font-bold tracking-widest"
        style={{ color }}
      >
        {label}
      </h2>
      {roster.map((entry, slot) => (
        <CardReviewTile
          key={entry.card.displayId}
          entry={entry}
          hp={hpByDisplayId[entry.card.displayId]}
          color={color}
          confirmRemove={confirmRemove === slot}
          onRequestRemove={() => onRequestRemove(slot)}
          onCancelRemove={onCancelRemove}
          onConfirmRemove={() => onConfirmRemove(slot)}
        />
      ))}
      {showEmptySlot && (
        <button
          type="button"
          onClick={() => onScan(roster.length)}
          disabled={loadingSlot === roster.length}
          className="ps-touch flex min-h-[7rem] flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/20 disabled:pointer-events-none disabled:opacity-60"
        >
          {loadingSlot === roster.length ? (
            <ScanProgressBar
              accentColor={color}
              className="w-full max-w-[10.5rem] px-3"
            />
          ) : (
            <>
              <span className="text-2xl text-zinc-500">+</span>
              <span className="text-xs text-zinc-500">Scan new card</span>
            </>
          )}
        </button>
      )}
    </section>
  );
}

function CardReviewTile({
  entry,
  hp,
  color,
  confirmRemove,
  onRequestRemove,
  onCancelRemove,
  onConfirmRemove,
}: {
  entry: RosterEntry;
  hp?: HpSnapshot;
  color: string;
  confirmRemove: boolean;
  onRequestRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}) {
  const { card, scannedPhotoDataUrl, record } = entry;
  const currentHp = hp?.currentHp ?? card.battleHp ?? 0;
  const maxHp = hp?.maxHp ?? card.battleHp ?? 1;
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (currentHp / maxHp) * 100)) : 0;
  const badgeClass = recordBadgeStyle(record.wins, record.losses);
  const isNew = record.wins === 0 && record.losses === 0;

  return (
    <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
      <div className="relative mx-auto w-24">
        {scannedPhotoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={scannedPhotoDataUrl}
            alt={card.name}
            className="aspect-[63/88] w-full rounded-lg object-contain"
          />
        ) : (
          <div className="flex aspect-[63/88] w-full items-center justify-center rounded-lg bg-white/5 text-zinc-600">
            ?
          </div>
        )}
        <span
          className={`absolute bottom-1 right-1 rounded px-1.5 py-0.5 text-[9px] font-bold text-white ${badgeClass}`}
        >
          W: {record.wins} L: {record.losses}
        </span>
      </div>
      <p className="mt-2 text-center text-sm font-semibold">{card.name}</p>
      <p className="text-center text-[10px] text-zinc-500">{card.type}</p>
      {isNew && (
        <p className="text-center text-[10px] text-zinc-600">New — 0W 0L</p>
      )}
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="mt-0.5 text-center text-[10px] text-zinc-500">
        {currentHp} / {maxHp} HP
      </p>
      {confirmRemove ? (
        <div className="mt-2 space-y-2 text-center text-xs">
          <p className="text-zinc-400">
            Remove {card.name} from roster?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirmRemove}
              className="flex-1 rounded-lg bg-red-600/80 py-1.5 font-medium text-white"
            >
              Yes, remove
            </button>
            <button
              type="button"
              onClick={onCancelRemove}
              className="flex-1 rounded-lg border border-white/15 py-1.5 text-zinc-400"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onRequestRemove}
          className="ps-btn ps-touch mt-2 w-full rounded-lg border border-white/15 py-2.5 text-sm text-zinc-400"
        >
          Remove
        </button>
      )}
    </div>
  );
}
