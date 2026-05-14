"use client";

import { CardRow } from "@/components/CardRow";
import type { DisplayCard } from "@/lib/cards";
import type { ScannedCard } from "@/lib/types";
import { scannedFieldsFromDisplayLike } from "@/lib/types";

type ScanResultCardProps = {
  card: DisplayCard;
  showRemove?: boolean;
  onRemoveClick?: () => void;
  onConfirmIdentity?: (displayId: string, selected: ScannedCard) => void;
  onNotListed?: () => void;
};

export function ScanResultCard({
  card,
  showRemove,
  onRemoveClick,
  onConfirmIdentity,
  onNotListed,
}: ScanResultCardProps) {
  const pendingMedium =
    card.pendingConfirmation &&
    card.recognitionConfidence === "medium" &&
    onConfirmIdentity &&
    onNotListed;

  if (pendingMedium) {
    const primary = scannedFieldsFromDisplayLike(card);
    return (
      <div className="overflow-hidden rounded-xl ring-1 ring-white/[0.08]">
        <div className="flex items-center gap-2 bg-yellow-500/15 px-3 py-2.5 text-xs font-medium text-yellow-100 ring-1 ring-inset ring-yellow-500/30">
          <span className="text-base leading-none text-yellow-300" aria-hidden>
            ⚠
          </span>
          Confirm this card
        </div>
        <div className="space-y-3 bg-[#0f0f13]/80 p-3">
          <CardRow card={card} showRemove={showRemove} onRemoveClick={onRemoveClick} />
          <p className="text-xs text-zinc-500">Is this the right card?</p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onConfirmIdentity(card.displayId, primary)}
              className="rounded-lg bg-[#F5C518]/12 px-3 py-2.5 text-left text-sm font-medium text-[#F5C518] ring-1 ring-[#F5C518]/40 transition hover:bg-[#F5C518]/20"
            >
              Yes — use this match
              <span className="mt-0.5 block text-xs font-normal text-zinc-400">
                {primary.variant} · {primary.set} · #{primary.number}
              </span>
            </button>
            {card.alternates.map((alt, i) => (
              <button
                key={`${alt.number}-${alt.variant}-${i}`}
                type="button"
                onClick={() => onConfirmIdentity(card.displayId, alt)}
                className="rounded-lg bg-white/[0.04] px-3 py-2 text-left text-sm text-white ring-1 ring-white/10 transition hover:bg-white/[0.08]"
              >
                <span className="font-medium">{alt.name}</span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {alt.variant} · {alt.set} · #{alt.number}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onNotListed?.()}
            className="w-full pt-1 text-center text-xs text-zinc-500 underline-offset-2 hover:text-zinc-400 hover:underline"
          >
            Not listed — try rescanning
          </button>
        </div>
      </div>
    );
  }

  const showBadge =
    !card.pendingConfirmation &&
    (card.recognitionConfidence === "high" || card.showGoldConfirmRing);

  return (
    <CardRow
      card={card}
      showRemove={showRemove}
      onRemoveClick={onRemoveClick}
      showConfirmedBadge={showBadge}
    />
  );
}
