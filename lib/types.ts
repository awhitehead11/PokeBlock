export type ScannedCard = {
  name: string;
  set: string;
  number: string;
  variant: string;
  rarity: string;
  hp: string;
  type: string;
};

export function normalizeCard(raw: unknown): ScannedCard | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (k: string, fallback = "") =>
    typeof o[k] === "string" ? (o[k] as string) : fallback;
  const name = str("name");
  if (!name) return null;
  return {
    name,
    set: str("set", "Unknown Set"),
    number: str("number", "?"),
    variant: str("variant", "Normal"),
    rarity: str("rarity", "Unknown"),
    hp: str("hp", "?"),
    type: str("type", "?"),
  };
}
