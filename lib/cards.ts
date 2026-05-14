import type { ScannedCard } from "@/lib/types";

/** Deterministic pseudo-price and trend for demo UI (stateless, no DB). */
export function enrichCard(card: ScannedCard, salt: string): DisplayCard {
  const seed = hashString(`${salt}|${card.name}|${card.set}|${card.number}`);
  const base = 8 + (seed % 220);
  const jitter = (seed >> 8) % 40;
  const priceUsd = base + jitter;
  const trendUp = ((seed >> 16) & 1) === 1;
  return { ...card, priceUsd, trendUp };
}

export type DisplayCard = ScannedCard & {
  priceUsd: number;
  trendUp: boolean;
};

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function sumPrices(cards: DisplayCard[]): number {
  return cards.reduce((a, c) => a + c.priceUsd, 0);
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
  const picks = [...yours, ...theirs].slice(0, 4);
  if (picks.length === 0) return "Scan cards to see market-style trend hints.";
  const parts = picks.map((c) => {
    const verb = c.trendUp ? "trending ↑" : "trending ↓";
    const mood =
      hashString(c.name + c.set) % 3 === 0 ? "stable" : verb;
    return mood === "stable"
      ? `${c.name} stable`
      : `${c.name} ${verb}`;
  });
  return parts.join(" · ");
}
