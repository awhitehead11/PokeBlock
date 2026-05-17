import type { DisplayCard } from "@/lib/cards";

export type StatusCondition =
  | "none"
  | "poisoned"
  | "burned"
  | "paralyzed"
  | "asleep"
  | "confused";

export type RosterEntry = {
  card: DisplayCard;
  scannedPhotoDataUrl: string | null;
  record: {
    wins: number;
    losses: number;
  };
};

export type ScannedAttack = {
  name: string;
  damage: number;
  energyCost: number;
  text?: string;
};

export type ScannedCard = {
  name: string;
  set: string;
  number: string;
  variant: string;
  rarity: string;
  /** Display string from the card (may be "?" if unreadable). */
  hp: string;
  type: string;
  /** Numeric HP read from the card; null if not clearly readable. */
  battleHp: number | null;
  /** Attacks read from the card; null if not clearly readable. */
  attacks: ScannedAttack[] | null;
  weakness: string | null;
  weaknessMultiplier: number | null;
  resistance: string | null;
  retreatCost: number | null;
};

export function scannedFieldsFromDisplayLike(c: {
  name: string;
  set: string;
  number: string;
  variant: string;
  rarity: string;
  hp: string;
  type: string;
  battleHp: number | null;
  attacks: ScannedAttack[] | null;
  weakness: string | null;
  weaknessMultiplier: number | null;
  resistance: string | null;
  retreatCost: number | null;
}): ScannedCard {
  return {
    name: c.name,
    set: c.set,
    number: c.number,
    variant: c.variant,
    rarity: c.rarity,
    hp: c.hp,
    type: c.type,
    battleHp: c.battleHp,
    attacks: c.attacks,
    weakness: c.weakness,
    weaknessMultiplier: c.weaknessMultiplier,
    resistance: c.resistance,
    retreatCost: c.retreatCost,
  };
}

function parseHpString(s: string): number | null {
  const t = s.replace(/\s+/g, "").replace(/HP/gi, "");
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseAttacks(raw: unknown): ScannedAttack[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ScannedAttack[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : "";
    const damage =
      typeof o.damage === "number" && Number.isFinite(o.damage) && o.damage >= 0
        ? o.damage
        : null;
    const energyCost =
      typeof o.energyCost === "number" &&
      Number.isFinite(o.energyCost) &&
      o.energyCost >= 0
        ? Math.floor(o.energyCost)
        : null;
    if (!name || damage === null || energyCost === null || damage <= 0) {
      continue;
    }
    out.push({ name, damage, energyCost });
  }
  return out.length ? out : null;
}

function parseNullableString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length ? t : null;
}

function parseNullableNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}

function parseHpField(raw: unknown, hpStrFallback: string): {
  hpDisplay: string;
  battleHp: number | null;
} {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return { hpDisplay: String(Math.round(raw)), battleHp: Math.round(raw) };
  }
  if (typeof raw === "string") {
    const parsed = parseHpString(raw);
    if (parsed !== null) {
      return { hpDisplay: String(parsed), battleHp: parsed };
    }
    const t = raw.trim();
    if (t && t !== "?") return { hpDisplay: t, battleHp: null };
  }
  const fromStr = parseHpString(hpStrFallback);
  if (fromStr !== null) return { hpDisplay: String(fromStr), battleHp: fromStr };
  return { hpDisplay: hpStrFallback || "?", battleHp: null };
}

export function normalizeCard(raw: unknown): ScannedCard | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (k: string, fallback = "") =>
    typeof o[k] === "string" ? (o[k] as string) : fallback;
  const name = str("name");
  if (!name) return null;

  const hpField = parseHpField(o.hp, str("hp", "?"));

  const attacks = parseAttacks(o.attacks);

  const weakness = parseNullableString(o.weakness);
  let weaknessMultiplier = parseNullableNumber(o.weaknessMultiplier);
  if (weaknessMultiplier !== null && weaknessMultiplier <= 0) {
    weaknessMultiplier = null;
  }

  const resistance = parseNullableString(o.resistance);
  let retreatCost = parseNullableNumber(o.retreatCost);
  if (retreatCost !== null && (!Number.isInteger(retreatCost) || retreatCost < 0)) {
    retreatCost = null;
  }

  return {
    name,
    set: str("set", "Unknown Set"),
    number: str("number", "?"),
    variant: str("variant", "Normal"),
    rarity: str("rarity", "Unknown"),
    hp: hpField.hpDisplay,
    type: str("type", "?"),
    battleHp: hpField.battleHp,
    attacks,
    weakness,
    weaknessMultiplier,
    resistance,
    retreatCost,
  };
}
