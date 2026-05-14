"use client";

import type { DisplayCard } from "@/lib/cards";
import { cardPassesBattleValidation } from "@/lib/cards";

type BattleCardRowProps = {
  card: DisplayCard;
  onRemove: () => void;
  /** Battle roster: Blue Team vs Gold Team accents */
  teamAccent?: "blue" | "gold";
  /** Opens camera to rescan this slot when battle stats are incomplete */
  onRescanIncomplete?: () => void;
  /** This row is currently being rescanned */
  rescanning?: boolean;
};

const TYPE_STYLES: Record<string, string> = {
  fire: "bg-red-600/90 text-white ring-red-400/40",
  water: "bg-blue-600/90 text-white ring-blue-400/40",
  grass: "bg-emerald-600/90 text-white ring-emerald-400/40",
  electric: "bg-yellow-500/95 text-[#0f0f13] ring-yellow-300/50",
  psychic: "bg-purple-600/90 text-white ring-purple-400/40",
  fighting: "bg-orange-600/90 text-white ring-orange-400/40",
  darkness: "bg-slate-700/95 text-white ring-slate-500/40",
  dark: "bg-slate-700/95 text-white ring-slate-500/40",
  metal: "bg-slate-500/90 text-white ring-slate-400/40",
  steel: "bg-slate-500/90 text-white ring-slate-400/40",
  fairy: "bg-pink-500/90 text-white ring-pink-400/40",
  dragon: "bg-indigo-600/90 text-white ring-indigo-400/40",
  ice: "bg-cyan-500/90 text-[#0f0f13] ring-cyan-300/50",
  bug: "bg-lime-600/85 text-[#0f0f13] ring-lime-400/40",
  rock: "bg-amber-800/90 text-white ring-amber-600/40",
  ground: "bg-amber-600/90 text-white ring-amber-500/40",
  ghost: "bg-violet-700/90 text-white ring-violet-400/40",
  poison: "bg-fuchsia-700/90 text-white ring-fuchsia-400/40",
  flying: "bg-sky-500/90 text-[#0f0f13] ring-sky-300/50",
  normal: "bg-zinc-500/90 text-white ring-zinc-400/40",
  colorless: "bg-zinc-500/90 text-white ring-zinc-400/40",
};

function typeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "");
}

function typeBadgeClass(type: string): string {
  const k = typeKey(type);
  const base =
    "inline-flex max-w-full shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ring-1";
  const entries = Object.entries(TYPE_STYLES).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [key, cls] of entries) {
    if (k.includes(key)) return `${base} ${cls}`;
  }
  return `${base} ${TYPE_STYLES.normal}`;
}

/** Same high-contrast warning on blue and gold columns (avoids warm-on-washout). */
const INCOMPLETE_WARN =
  "w-full rounded-md bg-zinc-950/90 px-2 py-1.5 text-left shadow-md ring-2 ring-amber-400/70";

export function BattleCardRow({
  card,
  onRemove,
  teamAccent,
  onRescanIncomplete,
  rescanning = false,
}: BattleCardRowProps) {
  const ready = cardPassesBattleValidation(card);
  const incomplete = !ready;
  const hp = ready && card.battleHp != null ? card.battleHp : null;
  const hpPct =
    hp != null ? Math.min(100, Math.round((hp / 330) * 100)) : 0;
  const barColor =
    teamAccent === "blue"
      ? "bg-[#3B82F6]"
      : teamAccent === "gold"
        ? "bg-[#F5C518]"
        : hpPct >= 66
          ? "bg-emerald-500"
          : hpPct >= 33
            ? "bg-[#F5C518]"
            : "bg-orange-500";
  const rowRing =
    teamAccent === "blue"
      ? "ring-1 ring-[#3B82F6]/35"
      : teamAccent === "gold"
        ? "ring-1 ring-[#F5C518]/35"
        : "ring-1 ring-white/10";

  return (
    <div
      className={`relative rounded-lg bg-white/[0.06] px-2 py-2 pr-8 ${rowRing} ${
        rescanning ? "opacity-60" : ""
      }`}
    >
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-[#DC2626] text-white shadow ring-2 ring-[#0f0f13] transition hover:bg-red-600 active:scale-95"
        aria-label={`Remove ${card.name}`}
      >
        <MinusIcon className="h-2.5 w-2.5" />
      </button>

      <div className="flex flex-col gap-1.5 pr-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate text-xs font-semibold text-white">
            {card.name}
          </p>
          <span
            className={`shrink-0 ${typeBadgeClass(card.type)} ${
              teamAccent === "blue"
                ? "outline outline-1 -outline-offset-1 outline-[#3B82F6]/45"
                : teamAccent === "gold"
                  ? "outline outline-1 -outline-offset-1 outline-[#F5C518]/40"
                  : ""
            }`}
            title={card.type}
          >
            {card.type}
          </span>
        </div>

        {incomplete && onRescanIncomplete ? (
          <button
            type="button"
            onClick={onRescanIncomplete}
            className={INCOMPLETE_WARN}
          >
            <span className="text-[9px] font-black uppercase tracking-wide text-amber-200">
              ⚠ Incomplete scan
            </span>
            <span className="mt-0.5 block text-[10px] font-medium leading-snug text-amber-50/95">
              Missing battle stats — tap to rescan
            </span>
          </button>
        ) : incomplete ? (
          <div className={INCOMPLETE_WARN}>
            <span className="text-[9px] font-black uppercase tracking-wide text-amber-200">
              ⚠ Incomplete scan
            </span>
            <span className="mt-0.5 block text-[10px] font-medium leading-snug text-amber-50/95">
              Missing battle stats — rescan from the scan button
            </span>
          </div>
        ) : null}

        <div
          className={`h-1.5 overflow-hidden rounded-full bg-black/40 ${
            teamAccent === "blue"
              ? "ring-1 ring-[#3B82F6]/30"
              : teamAccent === "gold"
                ? "ring-1 ring-[#F5C518]/30"
                : "ring-1 ring-white/10"
          }`}
        >
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${hpPct}%` }}
          />
        </div>
        <p className="text-[10px] text-zinc-500">
          {hp != null ? `${hp} HP` : "—"}
        </p>
      </div>
    </div>
  );
}

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
    >
      <path
        d="M2 6h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
