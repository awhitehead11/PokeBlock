/**
 * TCG API proxy — never expose TCGAPI_KEY to the client.
 *
 * Reminder: add TCGAPI_KEY (and ANTHROPIC_API_KEY) in the Vercel project
 * → Settings → Environment Variables for production/preview; .env.local is not deployed from Git.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const TCG_BASE = "https://api.tcgapi.dev/v1";
/** Card discovery uses GET /v1/search (documented); there is no /v1/cards?q= listing. */

type PriceBody = {
  name?: string;
  set?: string;
  number?: string;
  variant?: string;
};

type SearchHit = {
  id?: number;
  name?: string;
  set_name?: string;
  number?: string;
  printing?: string;
  market_price?: number;
  low_price?: number;
  median_price?: number;
  image_url?: string;
  product_type?: string;
  foil_only?: number;
};

type PricesRow = {
  printing?: string;
  market_price?: number;
  low_price?: number;
  median_price?: number;
  price_change_7d?: number | null;
};

function normCollector(n: string): string {
  const part = n.split("/")[0]?.trim().replace(/^#/, "") ?? "";
  const stripped = part.replace(/^0+(?=\d)/, "");
  return stripped === "" ? "0" : stripped;
}

function setMatchScore(apiSet: string, wantSet: string): number {
  if (!wantSet || wantSet === "Unknown Set") return 1;
  const a = apiSet.trim().toLowerCase();
  const b = wantSet.trim().toLowerCase();
  if (a === b) return 4;
  if (a.includes(b) || b.includes(a)) return 2;
  return 0;
}

function wantsFoilPrinting(variant: string): boolean {
  const v = variant.toLowerCase();
  return (
    v.includes("foil") ||
    v.includes("holo") ||
    v.includes("reverse") ||
    v.includes("full art") ||
    v.includes("alt art") ||
    v.includes("illustration rare") ||
    v.includes("special illustration") ||
    v.includes("ultra rare") ||
    v.includes("secret")
  );
}

function pickPrinting(
  candidates: SearchHit[],
  variant: string,
): SearchHit | undefined {
  if (candidates.length === 0) return undefined;
  const foil = wantsFoilPrinting(variant);
  const preferred = candidates.filter((c) =>
    foil ? c.printing === "Foil" : c.printing === "Normal",
  );
  return preferred[0] ?? candidates[0];
}

function selectBestHit(
  hits: SearchHit[],
  wantSet: string,
  wantNumber: string,
  variant: string,
): SearchHit | undefined {
  const cards = hits.filter(
    (h) => (h.product_type ?? "Cards") === "Cards" && h.id != null,
  );
  if (cards.length === 0) return undefined;

  const wantNorm = normCollector(wantNumber);
  const unknownNum = wantNumber === "?" || wantNumber.trim() === "";

  const scored = cards
    .map((h) => {
      let score = setMatchScore(h.set_name ?? "", wantSet) * 10;
      if (!unknownNum && normCollector(h.number ?? "") === wantNorm) {
        score += 100;
      }
      return { h, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.score ?? -1;
  const top = scored.filter((s) => s.score === best).map((s) => s.h);

  const exactNum = top.filter(
    (h) => unknownNum || normCollector(h.number ?? "") === wantNorm,
  );
  const pool = exactNum.length > 0 ? exactNum : top;

  return pickPrinting(pool, variant);
}

function trendFrom7d(change: number | null | undefined): {
  trend: "up" | "down" | "stable";
  trendPercent: number;
} {
  if (change == null || Number.isNaN(change)) {
    return { trend: "stable", trendPercent: 0 };
  }
  const abs = Math.abs(change);
  if (change > 0.25) return { trend: "up", trendPercent: Math.round(abs) };
  if (change < -0.25) return { trend: "down", trendPercent: Math.round(abs) };
  return { trend: "stable", trendPercent: Math.round(abs) };
}

function trendFromHistory(
  points: { date?: string; market_price?: number }[],
): { trend: "up" | "down" | "stable"; trendPercent: number } | null {
  if (!points || points.length < 2) return null;
  const sorted = [...points]
    .filter((p) => typeof p.market_price === "number")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  if (sorted.length < 2) return null;
  const old = sorted[Math.max(0, sorted.length - 8)];
  const latest = sorted[sorted.length - 1];
  const o = old.market_price ?? 0;
  const n = latest.market_price ?? 0;
  if (o <= 0) return null;
  const pct = ((n - o) / o) * 100;
  if (pct > 1) return { trend: "up", trendPercent: Math.round(Math.abs(pct)) };
  if (pct < -1)
    return { trend: "down", trendPercent: Math.round(Math.abs(pct)) };
  return { trend: "stable", trendPercent: Math.round(Math.abs(pct)) };
}

async function tcgJson<T>(
  path: string,
  apiKey: string,
): Promise<{ ok: boolean; data: T }> {
  const res = await fetch(`${TCG_BASE}${path}`, {
    headers: { "X-API-Key": apiKey },
    cache: "no-store",
  });
  const data = (await res.json()) as T;
  return { ok: res.ok, data };
}

export async function POST(req: Request) {
  const apiKey = process.env.TCGAPI_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "pricing_unavailable" } as const);
  }

  let body: PriceBody;
  try {
    body = (await req.json()) as PriceBody;
  } catch {
    return NextResponse.json({ error: "pricing_unavailable" } as const);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length < 2) {
    return NextResponse.json({ error: "not_found" } as const);
  }

  const set = typeof body.set === "string" ? body.set.trim() : "";
  const number = typeof body.number === "string" ? body.number.trim() : "?";
  const variant = typeof body.variant === "string" ? body.variant.trim() : "";

  try {
    const q = encodeURIComponent(name);
    const searchPath = `/search?q=${q}&game=pokemon&type=Cards&per_page=100`;
    const { ok: searchOk, data: searchRaw } = await tcgJson<{
      data?: SearchHit[];
      error?: { message?: string };
    }>(searchPath, apiKey);

    if (!searchOk) {
      return NextResponse.json({ error: "pricing_unavailable" } as const);
    }

    const hits = Array.isArray(searchRaw.data) ? searchRaw.data : [];
    if (hits.length === 0) {
      return NextResponse.json({ error: "not_found" } as const);
    }

    const withPrinting = selectBestHit(hits, set, number, variant);
    if (!withPrinting?.id) {
      return NextResponse.json({ error: "not_found" } as const);
    }

    const cardId = withPrinting.id;
    const printingParam =
      withPrinting.printing === "Foil" ? "Foil" : "Normal";
    const pricePath = `/cards/${cardId}/prices?printing=${encodeURIComponent(printingParam)}`;

    let market = withPrinting.market_price;
    let low = withPrinting.low_price;
    let mid = withPrinting.median_price;
    let change7d: number | null | undefined = undefined;

    const { ok: priceOk, data: priceRaw } = await tcgJson<{
      data?: PricesRow | PricesRow[];
    }>(pricePath, apiKey);

    if (priceOk && priceRaw.data != null) {
      const rows = Array.isArray(priceRaw.data)
        ? priceRaw.data
        : [priceRaw.data];
      const row =
        rows.find((r) => r.printing === printingParam) ?? rows[0] ?? {};
      if (typeof row.market_price === "number") market = row.market_price;
      if (typeof row.low_price === "number") low = row.low_price;
      if (typeof row.median_price === "number") mid = row.median_price;
      change7d = row.price_change_7d ?? undefined;
    }

    if (market == null || Number.isNaN(market)) {
      return NextResponse.json({ error: "not_found" } as const);
    }

    let trend = trendFrom7d(change7d);
    if (trend.trend === "stable" && trend.trendPercent === 0) {
      const histPath = `/cards/${cardId}/history?range=month&printing=${encodeURIComponent(printingParam)}`;
      const { ok: histOk, data: histRaw } = await tcgJson<{
        data?: { date?: string; market_price?: number }[];
      }>(histPath, apiKey);
      if (histOk && Array.isArray(histRaw.data) && histRaw.data.length >= 2) {
        const hTrend = trendFromHistory(histRaw.data);
        if (hTrend) trend = hTrend;
      }
    }

    const lowN = typeof low === "number" && !Number.isNaN(low) ? low : market;
    const midN =
      typeof mid === "number" && !Number.isNaN(mid) ? mid : market;
    const highN = Math.max(market, midN, lowN);

    return NextResponse.json({
      price: Math.round(market * 100) / 100,
      trend: trend.trend,
      trendPercent: trend.trendPercent,
      priceRange: {
        low: Math.round(Math.min(lowN, midN, market) * 100) / 100,
        mid: Math.round(midN * 100) / 100,
        high: Math.round(highN * 100) / 100,
      },
      imageUrl: withPrinting.image_url ?? null,
    });
  } catch {
    return NextResponse.json({ error: "pricing_unavailable" } as const);
  }
}
