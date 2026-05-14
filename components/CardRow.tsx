import type { DisplayCard } from "@/lib/cards";

type CardRowProps = {
  card: DisplayCard;
  showRemove?: boolean;
  onRemoveClick?: () => void;
  /** High-confidence scan, or a medium row after the user confirmed. */
  showConfirmedBadge?: boolean;
};

export function CardRow({
  card,
  showRemove,
  onRemoveClick,
  showConfirmedBadge,
}: CardRowProps) {
  const goldRing = card.showGoldConfirmRing;
  return (
    <div
      className={`relative flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-3 ${showRemove ? "pr-9" : ""} ${goldRing ? "ring-2 ring-[#F5C518]/85 ring-offset-2 ring-offset-[#0f0f13]" : "ring-1 ring-white/[0.06]"}`}
    >
      {showRemove && onRemoveClick && (
        <button
          type="button"
          onClick={onRemoveClick}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-red-500 text-white shadow ring-2 ring-[#0f0f13] transition hover:bg-red-600 active:scale-95"
          aria-label={`Remove ${card.name} from trade`}
        >
          <MinusIcon className="h-2.5 w-2.5" />
        </button>
      )}
      <CardThumb card={card} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold text-white">{card.name}</p>
          {showConfirmedBadge ? (
            <span className="shrink-0 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400 ring-1 ring-emerald-500/25">
              ✓ Confirmed
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {card.set} · {card.rarity} · {card.hp} HP
        </p>
      </div>
      <div className="flex min-h-[2.75rem] min-w-[4.25rem] shrink-0 flex-col items-end justify-center gap-0.5">
        {card.priceStatus === "deferred" && (
          <span className="text-sm text-zinc-600" aria-hidden>
            —
          </span>
        )}
        {card.priceStatus === "loading" && (
          <span
            className="pokescan-price-shimmer block h-4 w-[3.25rem] rounded-md"
            aria-hidden
          />
        )}
        {card.priceStatus === "ok" && (
          <>
            <span className="text-sm font-semibold text-[#F5C518]">
              ${card.priceUsd?.toFixed(2)}
            </span>
            <span
              className={
                card.trend === "up"
                  ? "text-xs text-[#00E5A0]"
                  : card.trend === "down"
                    ? "text-xs text-red-400"
                    : "text-xs text-zinc-500"
              }
              aria-label={
                card.trend === "up"
                  ? "Up vs last week"
                  : card.trend === "down"
                    ? "Down vs last week"
                    : "Stable vs last week"
              }
            >
              {card.trend === "up"
                ? "↑"
                : card.trend === "down"
                  ? "↓"
                  : "—"}
            </span>
          </>
        )}
        {card.priceStatus === "not_found" && (
          <span className="max-w-[5.5rem] text-right text-xs leading-snug text-zinc-500">
            Price unavailable
          </span>
        )}
        {card.priceStatus === "pricing_unavailable" && (
          <span className="max-w-[5.5rem] text-right text-xs leading-snug text-zinc-500">
            Pricing offline
          </span>
        )}
      </div>
    </div>
  );
}

function CardThumb({ card }: { card: DisplayCard }) {
  if (card.imageUrl) {
    return (
      // TCGPlayer CDN URLs: use native img (remote host varies).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={card.imageUrl}
        alt=""
        className="h-14 w-10 shrink-0 rounded-md object-cover ring-1 ring-white/10"
        loading="lazy"
      />
    );
  }
  return <PlaceholderThumb type={card.type} name={card.name} />;
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

function PlaceholderThumb({ type, name }: { type: string; name: string }) {
  const hue =
    (name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360) || 210;
  return (
    <div
      className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md ring-1 ring-white/10"
      style={{
        background: `linear-gradient(145deg, hsla(${hue},70%,45%,0.35), rgba(255,255,255,0.06))`,
      }}
      aria-hidden
    >
      <div className="absolute inset-x-1 top-1 h-1 rounded-full bg-white/20" />
      <div className="absolute bottom-1 left-1 right-1 text-[7px] font-medium uppercase tracking-wide text-white/50">
        {type}
      </div>
    </div>
  );
}
