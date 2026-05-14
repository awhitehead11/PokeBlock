"use client";

import { useCallback, useRef, useState } from "react";
import { AddCardTile } from "@/components/AddCardTile";
import { CardRow } from "@/components/CardRow";
import { RemoveCardModal } from "@/components/RemoveCardModal";
import {
  createDisplayCard,
  gradeFromDiff,
  hasPriceLoading,
  sumPrices,
  tradeSummary,
  trendFlagLine,
  type DisplayCard,
} from "@/lib/cards";
import { hydrateCardPrices } from "@/lib/hydratePrices";
import { prepareImageForScan } from "@/lib/scanImage";
import { normalizeCard, type ScannedCard } from "@/lib/types";

type Screen = "scanner" | "results" | "trade";

type ScanIntent =
  | "replace-your-results"
  | "append-your-trade"
  | "append-their-trade";

async function parseScanResponse(res: Response): Promise<{
  ok: boolean;
  status: number;
  data: { cards?: unknown[]; error?: string; raw?: string };
}> {
  const text = await res.text();
  if (!text) {
    return {
      ok: res.ok,
      status: res.status,
      data: { error: res.ok ? undefined : `Empty response (${res.status})` },
    };
  }
  try {
    return {
      ok: res.ok,
      status: res.status,
      data: JSON.parse(text) as {
        cards?: unknown[];
        error?: string;
        raw?: string;
      },
    };
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 180);
    return {
      ok: false,
      status: res.status,
      data: {
        error:
          res.status === 413
            ? "Image too large for this host. Try again or use a smaller photo."
            : snippet
              ? `Server returned non-JSON (${res.status}): ${snippet}`
              : `Bad response (${res.status})`,
      },
    };
  }
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("scanner");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [yourCards, setYourCards] = useState<DisplayCard[]>([]);
  const [theirCards, setTheirCards] = useState<DisplayCard[]>([]);

  const [removeConfirm, setRemoveConfirm] = useState<{
    side: "yours" | "theirs";
    index: number;
    name: string;
  } | null>(null);

  const scanInputRef = useRef<HTMLInputElement>(null);
  const scanIntentRef = useRef<ScanIntent>("replace-your-results");

  const [appendLoadingSide, setAppendLoadingSide] = useState<
    "yours" | "theirs" | null
  >(null);

  const runScan = useCallback(async (file: File) => {
    setError(null);
    setLoading(true);
    const intent = scanIntentRef.current;
    if (intent === "append-your-trade") setAppendLoadingSide("yours");
    else if (intent === "append-their-trade") setAppendLoadingSide("theirs");
    else setAppendLoadingSide(null);
    try {
      const dataUrl = await prepareImageForScan(file);
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: dataUrl }),
      });
      const { ok, status, data } = await parseScanResponse(res);
      if (!ok) {
        throw new Error(
          data.error ||
            (status === 500
              ? "Server error — check host logs and ANTHROPIC_API_KEY."
              : `Scan failed (${status})`),
        );
      }
      const rawList = Array.isArray(data.cards) ? data.cards : [];
      const normalized: ScannedCard[] = [];
      for (const item of rawList) {
        const c = normalizeCard(item);
        if (c) normalized.push(c);
      }
      const display = normalized.map(createDisplayCard);

      if (intent === "replace-your-results") {
        setYourCards(display);
        hydrateCardPrices(display, setYourCards);
        setScreen("results");
      } else if (intent === "append-your-trade") {
        const first = normalized[0];
        if (!first) {
          throw new Error(
            "No card detected. Center one card and try again.",
          );
        }
        const one = createDisplayCard(first);
        setYourCards((prev) => [...prev, one]);
        hydrateCardPrices([one], setYourCards);
      } else if (intent === "append-their-trade") {
        const first = normalized[0];
        if (!first) {
          throw new Error(
            "No card detected. Center one card and try again.",
          );
        }
        const one = createDisplayCard(first);
        setTheirCards((prev) => [...prev, one]);
        hydrateCardPrices([one], setTheirCards);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
      setAppendLoadingSide(null);
    }
  }, []);

  const onPickFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      await runScan(file);
    },
    [runScan],
  );

  const openYourScan = () => {
    scanIntentRef.current = "replace-your-results";
    scanInputRef.current?.click();
  };

  const openAddYourToTrade = useCallback(() => {
    setError(null);
    scanIntentRef.current = "append-your-trade";
    scanInputRef.current?.click();
  }, []);

  const openAddTheirToTrade = useCallback(() => {
    setError(null);
    scanIntentRef.current = "append-their-trade";
    scanInputRef.current?.click();
  }, []);

  const requestRemoveCard = (
    side: "yours" | "theirs",
    index: number,
    name: string,
  ) => {
    setRemoveConfirm({ side, index, name });
  };

  const cancelRemoveCard = () => setRemoveConfirm(null);

  const confirmRemoveCard = () => {
    if (!removeConfirm) return;
    const { side, index } = removeConfirm;
    if (side === "yours") {
      setYourCards((prev) => prev.filter((_, i) => i !== index));
    } else {
      setTheirCards((prev) => prev.filter((_, i) => i !== index));
    }
    setRemoveConfirm(null);
  };

  const yourTotal = sumPrices(yourCards);
  const theirTotal = sumPrices(theirCards);
  const verdict = gradeFromDiff(yourTotal, theirTotal);
  const absDiff = Math.abs(verdict.diff);
  const summary = tradeSummary(verdict.favor, absDiff);
  const trends = trendFlagLine(yourCards, theirCards);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]">
      <input
        ref={scanInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPickFile}
      />

      <RemoveCardModal
        open={removeConfirm !== null}
        pokemonName={removeConfirm?.name ?? ""}
        onKeep={cancelRemoveCard}
        onRemove={confirmRemoveCard}
      />

      {screen === "scanner" && (
        <ScannerView
          loading={loading}
          error={error}
          onScan={openYourScan}
        />
      )}

      {screen === "results" && (
        <ResultsView
          cards={yourCards}
          total={yourTotal}
          loading={loading}
          error={error}
          onBack={() => {
            setError(null);
            setScreen("scanner");
          }}
          onScanAgain={openYourScan}
          onTrade={() => {
            setError(null);
            setTheirCards([]);
            setScreen("trade");
          }}
        />
      )}

      {screen === "trade" && (
        <TradeView
          yourCards={yourCards}
          theirCards={theirCards}
          yourTotal={yourTotal}
          theirTotal={theirTotal}
          verdict={verdict}
          absDiff={absDiff}
          summary={summary}
          trends={trends}
          loading={loading}
          yourAddLoading={loading && appendLoadingSide === "yours"}
          theirAddLoading={loading && appendLoadingSide === "theirs"}
          error={error}
          onBack={() => setScreen("results")}
          onAddYourCard={openAddYourToTrade}
          onAddTheirCard={openAddTheirToTrade}
          onRequestRemoveCard={requestRemoveCard}
        />
      )}
    </div>
  );
}

function ScannerView({
  loading,
  error,
  onScan,
}: {
  loading: boolean;
  error: string | null;
  onScan: () => void;
}) {
  return (
    <>
      <header className="mb-6 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight text-[#F5C518]">
          PokéScan
        </span>
      </header>

      <button
        type="button"
        onClick={onScan}
        disabled={loading}
        className="flex flex-1 flex-col items-stretch rounded-2xl text-left disabled:opacity-60"
      >
        <div className="flex min-h-[min(52vh,420px)] flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#F5C518]/70 bg-white/[0.03] px-6 py-10 ring-1 ring-[#F5C518]/15">
          <CameraGlyph className="mb-4 h-14 w-14 text-[#F5C518]/90" />
          <p className="text-center text-sm leading-relaxed text-zinc-400">
            Place up to 4 cards · Tap to scan
          </p>
        </div>
      </button>

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={onScan}
          disabled={loading}
          className="w-full rounded-full bg-[#F5C518] py-3.5 text-center text-sm font-semibold text-[#0f0f13] shadow-[0_8px_30px_rgba(245,197,24,0.18)] transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? "Reading your cards..." : "Scan Cards"}
        </button>
        {loading && (
          <p className="text-center text-sm text-zinc-500">
            Reading your cards...
          </p>
        )}
        {error && (
          <p className="text-center text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

function ResultsView({
  cards,
  total,
  loading,
  error,
  onBack,
  onScanAgain,
  onTrade,
}: {
  cards: DisplayCard[];
  total: number;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onScanAgain: () => void;
  onTrade: () => void;
}) {
  return (
    <>
      <header className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full px-2 py-1 text-sm text-zinc-400 transition hover:text-white"
        >
          ← Back
        </button>
      </header>

      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-white">
        Your Cards
      </h1>

      <div className="flex flex-1 flex-col gap-3">
        {cards.length === 0 && !loading && (
          <p className="text-sm text-zinc-500">
            No cards detected. Try a clearer photo with less glare.
          </p>
        )}
        {cards.map((c) => (
          <CardRow key={c.displayId} card={c} />
        ))}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-auto pt-8">
        <p className="mb-3 text-center text-sm text-zinc-500">
          {cards.length} card{cards.length === 1 ? "" : "s"} scanned ·{" "}
          <span className="font-medium text-white">${total}</span>
          {hasPriceLoading(cards) ? (
            <span className="text-zinc-600"> · …</span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onTrade}
          className="mb-2 w-full rounded-full bg-[#F5C518] py-3.5 text-center text-sm font-semibold text-[#0f0f13]"
        >
          ⇄ Propose a Trade
        </button>
        <button
          type="button"
          onClick={onScanAgain}
          disabled={loading}
          className="w-full rounded-full py-2 text-center text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline disabled:opacity-50"
        >
          Scan again
        </button>
      </div>
    </>
  );
}

function TradeView({
  yourCards,
  theirCards,
  yourTotal,
  theirTotal,
  verdict,
  absDiff,
  summary,
  trends,
  loading,
  yourAddLoading,
  theirAddLoading,
  error,
  onBack,
  onAddYourCard,
  onAddTheirCard,
  onRequestRemoveCard,
}: {
  yourCards: DisplayCard[];
  theirCards: DisplayCard[];
  yourTotal: number;
  theirTotal: number;
  verdict: ReturnType<typeof gradeFromDiff>;
  absDiff: number;
  summary: string;
  trends: string;
  loading: boolean;
  yourAddLoading: boolean;
  theirAddLoading: boolean;
  error: string | null;
  onBack: () => void;
  onAddYourCard: () => void;
  onAddTheirCard: () => void;
  onRequestRemoveCard: (
    side: "yours" | "theirs",
    index: number,
    name: string,
  ) => void;
}) {
  const diffLabel =
    verdict.favor === "even"
      ? "Even trade"
      : verdict.favor === "yours"
        ? `+$${absDiff} in your favor`
        : `-$${absDiff}`;

  return (
    <>
      <header className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full px-2 py-1 text-sm text-zinc-400 transition hover:text-white"
        >
          ← Back
        </button>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-white">Your Cards</h2>
        <div className="flex items-start gap-3">
          <div className="flex min-h-[4.5rem] min-w-0 flex-1 flex-col gap-3">
            {yourCards.length === 0 && !yourAddLoading && (
              <p className="text-xs text-zinc-600">
                Add cards one at a time with the camera.
              </p>
            )}
            {yourCards.map((c, i) => (
              <CardRow
                key={c.displayId}
                card={c}
                showRemove
                onRemoveClick={() =>
                  onRequestRemoveCard("yours", i, c.name)
                }
              />
            ))}
          </div>
          <AddCardTile
            onClick={onAddYourCard}
            disabled={loading}
            loading={yourAddLoading}
          />
        </div>
        <p className="mt-2 text-right text-xs text-zinc-500">
          Subtotal · ${yourTotal}
          {hasPriceLoading(yourCards) ? " · …" : ""}
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-white">Their Cards</h2>
        <div className="flex items-start gap-3">
          <div className="flex min-h-[4.5rem] min-w-0 flex-1 flex-col gap-3">
            {theirCards.length === 0 && !theirAddLoading && (
              <p className="text-xs text-zinc-600">
                Scan their cards one at a time.
              </p>
            )}
            {theirCards.map((c, i) => (
              <CardRow
                key={c.displayId}
                card={c}
                showRemove
                onRemoveClick={() =>
                  onRequestRemoveCard("theirs", i, c.name)
                }
              />
            ))}
          </div>
          <AddCardTile
            onClick={onAddTheirCard}
            disabled={loading}
            loading={theirAddLoading}
          />
        </div>
        <p className="mt-2 text-right text-xs text-zinc-500">
          Subtotal · ${theirTotal}
          {hasPriceLoading(theirCards) ? " · …" : ""}
        </p>
      </section>

      {error && (
        <p className="mb-4 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-auto space-y-3 rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/[0.08]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Trade grade
            </p>
            <p className="text-4xl font-bold text-[#F5C518]">{verdict.grade}</p>
          </div>
          <p
            className={
              verdict.favor === "theirs"
                ? "text-right text-sm font-semibold text-red-400"
                : verdict.favor === "yours"
                  ? "text-right text-sm font-semibold text-[#00E5A0]"
                  : "text-right text-sm font-semibold text-zinc-300"
            }
          >
            {diffLabel}
          </p>
        </div>
        <p className="text-sm leading-relaxed text-zinc-400">{summary}</p>
        <p className="text-xs leading-relaxed text-[#00E5A0]">{trends}</p>
      </div>
    </>
  );
}

function CameraGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 7h3l2-2h6l2 2h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
      <circle cx="12" cy="13" r="3.25" />
    </svg>
  );
}
