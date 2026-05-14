import type { ScannedCard } from "@/lib/types";
import type { PriceApiResponse, PriceApiSuccess } from "@/lib/priceApi";
import { isPriceError } from "@/lib/priceApi";

export type PriceStatus =
  | "loading"
  | "ok"
  | "not_found"
  | "pricing_unavailable";

export type DisplayCard = ScannedCard & {
  displayId: string;
  priceStatus: PriceStatus;
  priceUsd?: number;
  trend?: "up" | "down" | "stable";
  trendPercent?: number;
  priceRange?: { low: number; mid: number; high: number };
  imageUrl?: string | null;
};

export function createDisplayCard(card: ScannedCard): DisplayCard {
  const displayId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return {
    ...card,
    displayId,
    priceStatus: "loading",
  };
}

export function applyPriceApiToCard(
  card: DisplayCard,
  json: unknown,
): DisplayCard {
  if (!json || typeof json !== "object") {
    return { ...card, priceStatus: "pricing_unavailable" };
  }
  const body = json as PriceApiResponse;
  if (isPriceError(body)) {
    return {
      ...card,
      priceStatus:
        body.error === "not_found" ? "not_found" : "pricing_unavailable",
      priceUsd: undefined,
      trend: undefined,
      trendPercent: undefined,
      priceRange: undefined,
    };
  }
  if (
    typeof (body as { price?: unknown }).price !== "number" ||
    typeof (body as { trend?: unknown }).trend !== "string"
  ) {
    return { ...card, priceStatus: "pricing_unavailable" };
  }
  const ok = body as PriceApiSuccess;
  return {
    ...card,
    priceStatus: "ok",
    priceUsd: ok.price,
    trend: ok.trend,
    trendPercent: ok.trendPercent,
    priceRange: ok.priceRange,
    imageUrl: ok.imageUrl ?? card.imageUrl ?? null,
  };
}

export function sumPrices(cards: DisplayCard[]): number {
  return cards.reduce((a, c) => {
    if (c.priceStatus === "ok" && typeof c.priceUsd === "number") {
      return a + c.priceUsd;
    }
    return a;
  }, 0);
}

export function hasPriceLoading(cards: DisplayCard[]): boolean {
  return cards.some((c) => c.priceStatus === "loading");
}

export function gradeFromDiff(
  yourTotal: number,
  theirTotal: number,
): { grade: string; diff: number; favor: "yours" | "theirs" | "even" } {
  if (theirTotal <= 0 && yourTotal <= 0) {
    return { grade: "—", diff: 0, favor: "even" };
  }
  const diff = yourTotal - theirTotal;
  const denom = Math.max(yourTotal, theirTotal, 1);
  const pct = diff / denom;

  let grade: string;
  if (pct >= 0.2) grade = "A";
  else if (pct >= 0.08) grade = "B";
  else if (pct >= -0.08) grade = "C";
  else if (pct >= -0.2) grade = "D";
  else grade = "F";

  const favor =
    diff > 0.5 ? "yours" : diff < -0.5 ? "theirs" : "even";

  return { grade, diff, favor };
}

export function tradeSummary(
  favor: "yours" | "theirs" | "even",
  absDiff: number,
): string {
  const rounded = Math.round(absDiff);
  if (favor === "even") {
    return `Stacks are close in value (within about $${rounded}) — small extras could balance it either way.`;
  }
  if (favor === "yours") {
    return `You’re ahead by about $${rounded} on paper — consider asking for a small add or a pick to even things out if you want it cleaner.`;
  }
  return `You’re behind by about $${rounded} — you may want another card or cash to bridge the gap.`;
}

export function trendFlagLine(
  yours: DisplayCard[],
  theirs: DisplayCard[],
): string {
  const picks = [...yours, ...theirs]
    .filter((c) => c.priceStatus === "ok" && c.trend)
    .slice(0, 4);
  if (picks.length === 0) {
    return "Pricing will appear here as lookups complete.";
  }
  const parts = picks.map((c) => {
    if (c.trend === "stable") return `${c.name} stable`;
    if (c.trend === "up") return `${c.name} trending ↑`;
    return `${c.name} trending ↓`;
  });
  return parts.join(" · ");
}
