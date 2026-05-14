import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

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

  const prompt = `You are an expert at identifying Pokémon Trading Card Game (TCG) cards from photos.

Look at this image. Identify every distinct Pokémon TCG card that is clearly visible (up to 4 if shown). For each card, return an object with these exact string fields:
- name: full card name as printed (e.g. "Charizard ex")
- set: English set name if you can infer it, otherwise "Unknown Set"
- number: collector number if visible, otherwise "?"
- variant: e.g. "Normal", "Full Art", "Holo" — best guess from the image
- rarity: rarity symbol/text if inferable, else "Unknown"
- hp: HP number as string if visible, else "?"
- type: primary Pokémon type (Fire, Water, etc.) if inferable from artwork or text, else "?"

Return ONLY a valid JSON array (no markdown fences, no commentary). If no cards are visible, return [].

Example format:
[{"name":"Charizard ex","set":"Obsidian Flames","number":"215","variant":"Full Art","rarity":"Double Rare","hp":"330","type":"Fire"}]`;

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

    if (!Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "Expected JSON array from model", raw: cleaned },
        { status: 502 },
      );
    }

    return NextResponse.json({ cards: parsed });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json(
      { error: err.message ?? "Anthropic request failed" },
      { status: err.status && err.status >= 400 && err.status < 600 ? err.status : 502 },
    );
  }
}
