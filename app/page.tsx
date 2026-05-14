"use client";

import { useCallback, useRef, useState } from "react";
import { CardRow } from "@/components/CardRow";
import {
  enrichCard,
  gradeFromDiff,
  sumPrices,
  tradeSummary,
  trendFlagLine,
  type DisplayCard,
} from "@/lib/cards";
import { normalizeCard, type ScannedCard } from "@/lib/types";

type Screen = "scanner" | "results" | "trade";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      if (typeof r.result === "string") resolve(r.result);
      else reject(new Error("read failed"));
    };
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("scanner");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [yourCards, setYourCards] = useState<DisplayCard[]>([]);
  const [theirCards, setTheirCards] = useState<DisplayCard[]>([]);

  const scanInputRef = useRef<HTMLInputElement>(null);
  const theirScanInputRef = useRef<HTMLInputElement>(null);
  const scanTargetRef = useRef<"yours" | "theirs">("yours");

  const runScan = useCallback(async (file: File) => {
    setError(null);
    setLoading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: dataUrl }),
      });
      const data = (await res.json()) as {
        cards?: unknown[];
        error?: string;
        raw?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Scan failed");
      }
      const rawList = Array.isArray(data.cards) ? data.cards : [];
      const normalized: ScannedCard[] = [];
      for (const item of rawList) {
        const c = normalizeCard(item);
        if (c) normalized.push(c);
      }
      const salt =
        scanTargetRef.current === "yours" ? "your-scan" : "their-scan";
      const display = normalized.map((c) => enrichCard(c, salt));

      if (scanTargetRef.current === "yours") {
        setYourCards(display);
        setScreen("results");
      } else {
        setTheirCards(display);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
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
    scanTargetRef.current = "yours";
    scanInputRef.current?.click();
  };

  const openTheirScan = () => {
    scanTargetRef.current = "theirs";
    theirScanInputRef.current?.click();
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
      <input
        ref={theirScanInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPickFile}
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
          error={error}
          onBack={() => setScreen("results")}
          onScanTheirs={openTheirScan}
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
          <CardRow key={`${c.name}-${c.set}-${c.number}`} card={c} />
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
  error,
  onBack,
  onScanTheirs,
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
  error: string | null;
  onBack: () => void;
  onScanTheirs: () => void;
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
        <div className="flex flex-col gap-3">
          {yourCards.map((c) => (
            <CardRow key={`y-${c.name}-${c.set}-${c.number}`} card={c} />
          ))}
        </div>
        <p className="mt-2 text-right text-xs text-zinc-500">
          Subtotal · ${yourTotal}
        </p>
      </section>

      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Their Cards</h2>
          <button
            type="button"
            onClick={onScanTheirs}
            disabled={loading}
            className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-[#F5C518] ring-1 ring-white/10 transition hover:bg-white/[0.14] disabled:opacity-50"
          >
            {loading ? "Scanning…" : "Scan their stack"}
          </button>
        </div>
        {theirCards.length === 0 && !loading && (
          <p className="mb-3 text-sm text-zinc-500">
            Scan their cards to compare piles.
          </p>
        )}
        <div className="flex flex-col gap-3">
          {theirCards.map((c) => (
            <CardRow key={`t-${c.name}-${c.set}-${c.number}`} card={c} />
          ))}
        </div>
        <p className="mt-2 text-right text-xs text-zinc-500">
          Subtotal · ${theirTotal}
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
