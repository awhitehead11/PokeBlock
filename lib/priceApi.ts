export type PriceApiSuccess = {
  price: number;
  trend: "up" | "down" | "stable";
  trendPercent: number;
  priceRange: { low: number; mid: number; high: number };
  imageUrl?: string | null;
};

export type PriceApiErrorBody = {
  error: "not_found" | "pricing_unavailable";
};

export type PriceApiResponse = PriceApiSuccess | PriceApiErrorBody;

export function isPriceError(
  j: PriceApiResponse,
): j is PriceApiErrorBody {
  return (
    "error" in j &&
    (j.error === "not_found" || j.error === "pricing_unavailable")
  );
}
