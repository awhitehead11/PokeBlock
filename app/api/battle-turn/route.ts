import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** Same model as /api/scan — known to work with this project's API key. */
const MODEL = "claude-sonnet-4-5";

type BattleTurnBody = {
  prompt?: string;
  systemPrompt?: string;
};

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Missing ANTHROPIC_API_KEY" },
      { status: 500 },
    );
  }

  let body: BattleTurnBody;
  try {
    body = (await req.json()) as BattleTurnBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { prompt, systemPrompt } = body;
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  if (!systemPrompt || typeof systemPrompt !== "string") {
    return NextResponse.json(
      { error: "systemPrompt is required" },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey: key });

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw =
      textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

    const clean = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      const parsed = JSON.parse(clean);
      return NextResponse.json(parsed);
    } catch {
      return NextResponse.json(
        { error: "parse_error", raw },
        { status: 500 },
      );
    }
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    const message = err.message ?? "Anthropic request failed";
    return NextResponse.json(
      { error: "claude_error", detail: message },
      {
        status:
          err.status && err.status >= 400 && err.status < 600
            ? err.status
            : 502,
      },
    );
  }
}
