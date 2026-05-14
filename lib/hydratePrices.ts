import type { Dispatch, SetStateAction } from "react";
import { applyPriceApiToCard, type DisplayCard } from "@/lib/cards";

export function hydrateCardPrices(
  rows: DisplayCard[],
  setRows: Dispatch<SetStateAction<DisplayCard[]>>,
): void {
  for (const row of rows) {
    void (async () => {
      try {
        const res = await fetch("/api/price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: row.name,
            set: row.set,
            number: row.number,
            variant: row.variant,
          }),
        });
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          json = { error: "pricing_unavailable" } as const;
        }
        setRows((prev) =>
          prev.map((c) =>
            c.displayId === row.displayId ? applyPriceApiToCard(c, json) : c,
          ),
        );
      } catch {
        setRows((prev) =>
          prev.map((c) =>
            c.displayId === row.displayId
              ? { ...c, priceStatus: "pricing_unavailable" as const }
              : c,
          ),
        );
      }
    })();
  }
}
