import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeScanResults } from "@/lib/recognition";

/** Set ANTHROPIC_API_KEY (and TCGAPI_KEY for /api/price) in Vercel → Environment Variables. */
export const runtime = "nodejs";
/** Vercel / similar: allow slow vision calls (plan max still applies on Hobby). */
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-5";

type ScanBody = {
  imageBase64: string;
  mediaType?: string;
};

function parseDataUrl(input: string): { base64: string; mediaType: string } {
  const m = input.match(/^data:([^;]+);base64,(.+)$/);
  if (m) {
    return { mediaType: m[1], base64: m[2] };
  }
  return { mediaType: "image/jpeg", base64: input };
}

const prompt = `You are an expert at identifying Pokémon Trading Card Game (TCG) cards from photos.

The user photographs ONE card at a time. Identify the single primary Pokémon TCG card that the photo is meant to show (ignore partial background cards unless they dominate the frame). Return at most ONE recognition: a JSON array with either one object or an empty array if nothing is identifiable.

For that one card, return one JSON object with this exact shape (values are examples only — you must read real values from the photo, never invent plausible stats):
{
  "confidence": "high" | "medium" | "low",
  "card": {
    "name": "Charizard ex",
    "set": "Obsidian Flames",
    "number": "215",
    "variant": "Full Art",
    "rarity": "Double Rare",
    "hp": 330,
    "type": "Fire",
    "attacks": [
      {
        "name": "Explosive Fire",
        "damage": 220,
        "energyCost": 3
      }
    ],
    "weakness": "Water",
    "weaknessMultiplier": 2,
    "resistance": null,
    "retreatCost": 2
  },
  "alternates": []
}

CRITICAL IDENTIFICATION RULES:
- The collector number in the bottom-right corner is the most reliable identifier — read it carefully and copy it exactly when visible.
- Use the set symbol / set logo area and cross-check consistency with that number and the card name.
- Variant matters for value: distinguish Regular vs Holo vs Full Art vs Special Illustration Rare vs Alt Art, etc., from the actual art layout and borders.

CONFIDENCE:
- "high" ONLY if the collector number is clearly visible and unambiguous AND set + variant are clear.
- "medium" if the number is visible but partially obscured OR the variant/printing is uncertain OR set is somewhat uncertain.
- "low" if the collector number is not visible OR the card is hard to identify OR the photo is too blurry/glare-heavy.

BATTLE STATS — for the battle simulator (photos are often casual phone shots, not studio scans):
Read from the image when the text/symbols are clearly visible. If you cannot see it on the photo, return null — do NOT fill in from Pokémon encyclopedia, memory, or typical card databases.

- "hp": integer after "HP" top-right when visible on the photo. If not clearly readable, null.
- "type": prefer the energy symbol top-left when visible. Allowed values: Fire, Water, Grass, Lightning, Psychic, Fighting, Darkness, Metal, Dragon, Fairy, Colorless (also accept Electric as Lightning). If the symbol is unreadable but the Pokémon is identifiable, you may use its usual single TCG type — never return "?".
- "attacks": each attack visible on the card with name, damage (integer on the row), energyCost (symbol count). If the attack block is unreadable, null for the whole array. Do not invent attack names or damage from memory.
- "weakness": ONLY if the bottom weakness label is clearly legible in the photo. Otherwise null. Never infer weakness from the Pokémon's species or from what the card "should" have.
- "weaknessMultiplier": only when weakness is clearly read; usually 2. If weakness is null, both weakness and weaknessMultiplier must be null.
- "resistance": ONLY if the bottom resistance label is clearly legible; otherwise null. Never infer from species knowledge.
- "retreatCost": count retreat symbols when the bottom strip is clearly visible; otherwise null.

The battle app computes super-effective damage from attacker type vs defender type (type chart). Weakness/resistance lines are optional extras — null is better than a guess.

INCOMPLETE CARD POLICY:
- If hp, type, or attacks cannot be read with certainty, return null for those fields. The app may ask for a rescan. Never fabricate hp, damage, or attacks.

ALTERNATES:
- If confidence is NOT high, populate "alternates" with up to 2 other plausible same-name (or same-art) variants (different number and/or variant and/or set) you considered. Each alternate must use the same "card" object shape as above (use nulls when battle fields are not readable).
- If confidence is "high", use "alternates": [].

Return ONLY a valid JSON array with 0 or 1 element (no markdown fences, no commentary). If no card is visible, return [].

Example (one card in frame):
[{"confidence":"medium","card":{"name":"Charizard ex","set":"Obsidian Flames","number":"215","variant":"Full Art","rarity":"Double Rare","hp":330,"type":"Fire","attacks":[{"name":"Explosive Fire","damage":220,"energyCost":3}],"weakness":"Water","weaknessMultiplier":2,"resistance":null,"retreatCost":2},"alternates":[{"name":"Charizard ex","set":"Obsidian Flames","number":"223","variant":"Special Illustration Rare","rarity":"Special Illustration Rare","hp":330,"type":"Fire","attacks":[{"name":"Burning White","damage":180,"energyCost":3}],"weakness":"Water","weaknessMultiplier":2,"resistance":null,"retreatCost":2}]}]`;

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Missing ANTHROPIC_API_KEY" },
      { status: 500 },
    );
  }

  let body: ScanBody;
  try {
    body = (await req.json()) as ScanBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.imageBase64 || typeof body.imageBase64 !== "string") {
    return NextResponse.json(
      { error: "imageBase64 is required" },
      { status: 400 },
    );
  }

  const { base64, mediaType } = parseDataUrl(body.imageBase64.trim());
  const allowed = /^image\/(jpeg|png|gif|webp)$/i;
  const mt = body.mediaType && allowed.test(body.mediaType) ? body.mediaType : mediaType;
  if (!allowed.test(mt)) {
    return NextResponse.json(
      { error: "Unsupported media type; use image/jpeg, png, gif, or webp" },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey: key });

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mt as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: base64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw =
      textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "Model did not return valid JSON", raw },
        { status: 502 },
      );
    }

    let list: unknown[] = [];
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (
      parsed &&
      typeof parsed === "object" &&
      "confidence" in parsed &&
      "card" in parsed
    ) {
      list = [parsed];
    } else if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as Record<string, unknown>).recognitions)
    ) {
      list = (parsed as { recognitions: unknown[] }).recognitions;
    } else {
      return NextResponse.json(
        { error: "Expected JSON array of recognitions from model", raw: cleaned },
        { status: 502 },
      );
    }

    const recognitions = normalizeScanResults(list);

    return NextResponse.json({ recognitions });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json(
      { error: err.message ?? "Anthropic request failed" },
      { status: err.status && err.status >= 400 && err.status < 600 ? err.status : 502 },
    );
  }
}
