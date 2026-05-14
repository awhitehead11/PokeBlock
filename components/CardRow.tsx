import type { DisplayCard } from "@/lib/cards";

type CardRowProps = { card: DisplayCard };

export function CardRow({ card }: CardRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-3 ring-1 ring-white/[0.06]">
      <PlaceholderThumb type={card.type} name={card.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{card.name}</p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {card.set} · {card.rarity} · {card.hp} HP
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-sm font-semibold text-[#F5C518]">
          ${card.priceUsd}
        </span>
        <span
          className={
            card.trendUp ? "text-xs text-[#00E5A0]" : "text-xs text-red-400"
          }
          aria-label={card.trendUp ? "Up last 7 days" : "Down last 7 days"}
        >
          {card.trendUp ? "↑" : "↓"}
        </span>
      </div>
    </div>
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
