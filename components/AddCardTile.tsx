import { ScanProgressBar } from "@/components/ScanProgressBar";

type AddCardTileProps = {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Caption under the + icon (default: Add card) */
  caption?: string;
  /** Trade flow vs battle column accents */
  tone?: "gold" | "battle-blue" | "battle-gold";
  /** When true with a battle tone, soft pulsing glow when roster is empty */
  encouragePulse?: boolean;
};

export function AddCardTile({
  onClick,
  disabled,
  loading,
  caption = "Add card",
  tone = "gold",
  encouragePulse = false,
}: AddCardTileProps) {
  const isGold = tone === "gold";
  const isBattleBlue = tone === "battle-blue";
  const isBattleGold = tone === "battle-gold";
  const accentColor = isBattleBlue
    ? "#3B82F6"
    : isBattleGold || isGold
      ? "#F5C518"
      : "#F5C518";
  const pulseBlue = isBattleBlue && encouragePulse && !disabled && !loading;
  const pulseGold = isBattleGold && encouragePulse && !disabled && !loading;

  const shell = isGold
    ? "flex w-[5.5rem] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#F5C518]/45 bg-white/[0.02] px-2 py-4 text-center transition hover:border-[#F5C518]/80 hover:bg-white/[0.05] disabled:pointer-events-none disabled:opacity-45"
    : isBattleBlue
      ? "flex w-full shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[#3B82F6]/55 bg-[#3B82F6]/[0.07] px-2 py-3 text-center transition hover:border-[#3B82F6] hover:bg-[#3B82F6]/12 disabled:pointer-events-none disabled:opacity-45"
      : "flex w-full shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[#F5C518]/55 bg-[#F5C518]/[0.06] px-2 py-3 text-center transition hover:border-[#F5C518] hover:bg-[#F5C518]/10 disabled:pointer-events-none disabled:opacity-45";

  const pulseClass = pulseBlue
    ? " pokescan-battle-scan-pulse-blue"
    : pulseGold
      ? " pokescan-battle-scan-pulse-gold"
      : "";

  const iconWrap = isGold
    ? "flex h-9 w-9 items-center justify-center rounded-full bg-[#F5C518]/15 text-lg font-light text-[#F5C518]"
    : isBattleBlue
      ? "flex h-8 w-8 items-center justify-center rounded-full bg-[#3B82F6]/20 text-lg font-light text-[#3B82F6]"
      : "flex h-8 w-8 items-center justify-center rounded-full bg-[#F5C518]/20 text-lg font-light text-[#F5C518]";

  const captionCls = isGold
    ? "text-[10px] font-medium uppercase tracking-wide text-zinc-500"
    : isBattleBlue
      ? "text-[10px] font-bold uppercase tracking-wide text-blue-200/90"
      : "text-[10px] font-bold uppercase tracking-wide text-[#F5C518]/90";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={shell + pulseClass}
    >
      <span className={iconWrap} aria-hidden>
        +
      </span>
      {loading ? (
        <ScanProgressBar
          accentColor={accentColor}
          className="mt-1 w-full min-w-0 px-1"
        />
      ) : (
        <span className={captionCls}>{caption}</span>
      )}
    </button>
  );
}
