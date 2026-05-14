import { normalizeCard, type ScannedCard } from "@/lib/types";

export type Confidence = "high" | "medium" | "low";

export type RecognitionResult = {
  confidence: Confidence;
  card: ScannedCard;
  alternates: ScannedCard[];
};

export function parseRecognition(raw: unknown): RecognitionResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const cRaw = o.confidence;
  const conf =
    typeof cRaw === "string" ? cRaw.toLowerCase().trim() : "";
  if (conf !== "high" && conf !== "medium" && conf !== "low") return null;
  const card = normalizeCard(o.card);
  if (!card) return null;
  const altsRaw = Array.isArray(o.alternates) ? o.alternates : [];
  const alternates = altsRaw
    .slice(0, 2)
    .map((a) => normalizeCard(a))
    .filter((x): x is ScannedCard => x != null);
  return { confidence: conf as Confidence, card, alternates };
}

/** Accepts new `{ confidence, card, alternates }[]` or legacy flat card objects. */
export function normalizeScanResults(raw: unknown): RecognitionResult[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object") {
    const r = (raw as Record<string, unknown>).recognitions;
    if (Array.isArray(r)) list = r;
  }
  if (list.length === 0) return [];

  const first = list[0];
  if (
    first &&
    typeof first === "object" &&
    "confidence" in first &&
    "card" in first
  ) {
    return list.map(parseRecognition).filter((x): x is RecognitionResult => x != null);
  }

  return list
    .map((item) => {
      const card = normalizeCard(item);
      if (!card) return null;
      const rec: RecognitionResult = {
        confidence: "high",
        card,
        alternates: [],
      };
      return rec;
    })
    .filter((x): x is RecognitionResult => x != null);
}
