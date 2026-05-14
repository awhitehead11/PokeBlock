"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AddCardTile } from "@/components/AddCardTile";
import { BattleScreen } from "@/components/BattleScreen";
import { RemoveCardModal } from "@/components/RemoveCardModal";
import { ScanResultCard } from "@/components/ScanResultCard";
import {
  displayCardFromRecognition,
  gradeFromDiff,
  hasPriceLoading,
  sumPrices,
  tradeSummary,
  trendFlagLine,
  type DisplayCard,
} from "@/lib/cards";
import { hydrateCardPrices } from "@/lib/hydratePrices";
import { normalizeScanResults } from "@/lib/recognition";
import { prepareImageForScan } from "@/lib/scanImage";
import type { ScannedCard } from "@/lib/types";

type MainTab = "cards" | "trade" | "battle";
const MAX_YOUR_CARDS = 4;
const MAX_THEIR_CARDS = 4;

type ScanIntent =
  | "replace-your-results"
  | "append-your-results"
  | "append-your-trade"
  | "append-their-trade"
  | "rescan-battle-slot";

async function parseScanResponse(res: Response): Promise<{
  ok: boolean;
  status: number;
  data: {
    cards?: unknown[];
    recognitions?: unknown[];
    error?: string;
    raw?: string;
  };
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
        recognitions?: unknown[];
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
  const [mainTab, setMainTab] = useState<MainTab>("cards");
  const [lowConfidenceOpen, setLowConfidenceOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mySide, setMySide] = useState<DisplayCard[]>([]);
  const [theirSide, setTheirSide] = useState<DisplayCard[]>([]);
  const [lowScanOverlay, setLowScanOverlay] = useState(false);
  const [skippedOnLastScan, setSkippedOnLastScan] = useState(0);

  const [removeConfirm, setRemoveConfirm] = useState<{
    side: "yours" | "theirs";
    index: number;
    name: string;
  } | null>(null);

  const scanInputRef = useRef<HTMLInputElement>(null);
  const scanIntentRef = useRef<ScanIntent>("replace-your-results");
  const battleRescanRef = useRef<{
    side: "yours" | "theirs";
    index: number;
  } | null>(null);
  const lowAppendSideRef = useRef<"yours" | "theirs" | null>(null);

  const [battleRescanSlot, setBattleRescanSlot] = useState<{
    side: "yours" | "theirs";
    index: number;
  } | null>(null);

  const [appendLoadingSide, setAppendLoadingSide] = useState<
    "yours" | "theirs" | null
  >(null);

  const mySideRef = useRef(mySide);
  const theirSideRef = useRef(theirSide);
  useEffect(() => {
    mySideRef.current = mySide;
  }, [mySide]);
  useEffect(() => {
    theirSideRef.current = theirSide;
  }, [theirSide]);

  const runScan = useCallback(async (file: File) => {
    setError(null);
    setLoading(true);
    const intent = scanIntentRef.current;
    if (intent === "append-your-trade") lowAppendSideRef.current = "yours";
    else if (intent === "append-their-trade") lowAppendSideRef.current = "theirs";
    else if (intent === "rescan-battle-slot") {
      lowAppendSideRef.current = battleRescanRef.current?.side ?? null;
    } else lowAppendSideRef.current = null;
    if (intent === "append-your-trade" || intent === "append-your-results") {
      setAppendLoadingSide("yours");
    } else if (intent === "append-their-trade") {
      setAppendLoadingSide("theirs");
    } else if (intent === "rescan-battle-slot") {
      const s = battleRescanRef.current?.side;
      if (s === "yours") setAppendLoadingSide("yours");
      else if (s === "theirs") setAppendLoadingSide("theirs");
      else setAppendLoadingSide(null);
    } else {
      setAppendLoadingSide(null);
    }
    try {
      if (
        (intent === "append-your-results" ||
          intent === "append-your-trade") &&
        mySideRef.current.length >= MAX_YOUR_CARDS
      ) {
        setError(
          `You can keep up to ${MAX_YOUR_CARDS} cards on your side. Remove one to add another.`,
        );
        return;
      }
      if (
        intent === "append-their-trade" &&
        theirSideRef.current.length >= MAX_THEIR_CARDS
      ) {
        setError(
          `You can keep up to ${MAX_THEIR_CARDS} cards on their side. Remove one to add another.`,
        );
        return;
      }

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
      const rawPayload = data.recognitions ?? data.cards;
      const recs = normalizeScanResults(rawPayload ?? []);
      const lowCount = recs.filter((r) => r.confidence === "low").length;
      setSkippedOnLastScan(lowCount);
      const accepted = recs.filter((r) => r.confidence !== "low");

      if (accepted.length === 0) {
        if (intent === "replace-your-results") {
          setLowConfidenceOpen(true);
        } else if (intent === "append-your-results") {
          setError(
            "Could not read a card in that photo. Try again with one card in frame.",
          );
        } else {
          setLowScanOverlay(true);
        }
        return;
      }

      const onePerPhoto = accepted.slice(0, 1);
      const display = onePerPhoto.map(displayCardFromRecognition);
      const toPrice = display.filter((d) => d.priceStatus === "loading");

      if (intent === "replace-your-results") {
        setMySide(display);
        if (toPrice.length > 0) hydrateCardPrices(toPrice, setMySide);
        setLowConfidenceOpen(false);
        setMainTab("cards");
      } else if (intent === "append-your-results") {
        const row = display[0];
        if (!row) {
          throw new Error(
            "No card detected. Put one card in frame and try again.",
          );
        }
        setMySide((prev) => [...prev, row]);
        if (row.priceStatus === "loading") {
          hydrateCardPrices([row], setMySide);
        }
      } else if (intent === "append-your-trade") {
        const row = display[0];
        if (!row) {
          throw new Error(
            "No card detected. Center one card and try again.",
          );
        }
        setMySide((prev) => [...prev, row]);
        if (row.priceStatus === "loading") {
          hydrateCardPrices([row], setMySide);
        }
      } else if (intent === "append-their-trade") {
        const row = display[0];
        if (!row) {
          throw new Error(
            "No card detected. Center one card and try again.",
          );
        }
        setTheirSide((prev) => [...prev, row]);
        if (row.priceStatus === "loading") {
          hydrateCardPrices([row], setTheirSide);
        }
      } else if (intent === "rescan-battle-slot") {
        const slot = battleRescanRef.current;
        const row = display[0];
        if (!slot) {
          throw new Error("Missing rescan slot — try again.");
        }
        if (!row) {
          setError(
            "Could not read a card in that photo. Try again with one card in frame.",
          );
          return;
        }
        const patch = (prev: DisplayCard[]) =>
          prev.map((c, i) =>
            i === slot.index
              ? ({
                  ...row,
                  displayId: c.displayId,
                } as DisplayCard)
              : c,
          );
        if (slot.side === "yours") {
          setMySide((prev) => {
            const next = patch(prev);
            const m = next[slot.index];
            if (m?.priceStatus === "loading") {
              hydrateCardPrices([m], setMySide);
            }
            return next;
          });
        } else {
          setTheirSide((prev) => {
            const next = patch(prev);
            const m = next[slot.index];
            if (m?.priceStatus === "loading") {
              hydrateCardPrices([m], setTheirSide);
            }
            return next;
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
      setAppendLoadingSide(null);
      battleRescanRef.current = null;
      setBattleRescanSlot(null);
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

  const openYourScan = useCallback(() => {
    setError(null);
    if (mySideRef.current.length >= MAX_YOUR_CARDS) {
      setError(
        `You already have ${MAX_YOUR_CARDS} cards. Remove one to scan another.`,
      );
      return;
    }
    scanIntentRef.current =
      mySideRef.current.length === 0
        ? "replace-your-results"
        : "append-your-results";
    scanInputRef.current?.click();
  }, []);

  const openAddYourFromResults = useCallback(() => {
    setError(null);
    if (mySideRef.current.length >= MAX_YOUR_CARDS) {
      setError(
        `You can keep up to ${MAX_YOUR_CARDS} cards. Remove one to add another.`,
      );
      return;
    }
    scanIntentRef.current = "append-your-results";
    scanInputRef.current?.click();
  }, []);

  const openAddYourToTrade = useCallback(() => {
    setError(null);
    if (mySideRef.current.length >= MAX_YOUR_CARDS) {
      setError(
        `You can keep up to ${MAX_YOUR_CARDS} cards on your side. Remove one to add another.`,
      );
      return;
    }
    scanIntentRef.current = "append-your-trade";
    scanInputRef.current?.click();
  }, []);

  const openAddTheirToTrade = useCallback(() => {
    setError(null);
    if (theirSideRef.current.length >= MAX_THEIR_CARDS) {
      setError(
        `You can keep up to ${MAX_THEIR_CARDS} cards on their side. Remove one to add another.`,
      );
      return;
    }
    scanIntentRef.current = "append-their-trade";
    scanInputRef.current?.click();
  }, []);

  const openBattleRescan = useCallback(
    (side: "yours" | "theirs", index: number) => {
      setError(null);
      battleRescanRef.current = { side, index };
      setBattleRescanSlot({ side, index });
      scanIntentRef.current = "rescan-battle-slot";
      if (side === "yours") setAppendLoadingSide("yours");
      else setAppendLoadingSide("theirs");
      scanInputRef.current?.click();
    },
    [],
  );

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
      setMySide((prev) => prev.filter((_, i) => i !== index));
    } else {
      setTheirSide((prev) => prev.filter((_, i) => i !== index));
    }
    setRemoveConfirm(null);
  };

  const confirmYourCardIdentity = useCallback(
    (displayId: string, selected: ScannedCard) => {
      const toHydrate: DisplayCard = {
        ...selected,
        displayId,
        priceStatus: "loading",
        recognitionConfidence: "medium",
        pendingConfirmation: false,
        alternates: [],
        showGoldConfirmRing: true,
      };
      setMySide((prev) =>
        prev.map((c) =>
          c.displayId === displayId
            ? {
                ...c,
                ...selected,
                displayId: c.displayId,
                priceStatus: "loading",
                pendingConfirmation: false,
                alternates: [],
                showGoldConfirmRing: true,
                recognitionConfidence: "medium",
                imageUrl: undefined,
                priceUsd: undefined,
                trend: undefined,
                trendPercent: undefined,
                priceRange: undefined,
              }
            : c,
        ),
      );
      hydrateCardPrices([toHydrate], setMySide);
    },
    [],
  );

  const confirmTheirCardIdentity = useCallback(
    (displayId: string, selected: ScannedCard) => {
      const toHydrate: DisplayCard = {
        ...selected,
        displayId,
        priceStatus: "loading",
        recognitionConfidence: "medium",
        pendingConfirmation: false,
        alternates: [],
        showGoldConfirmRing: true,
      };
      setTheirSide((prev) =>
        prev.map((c) =>
          c.displayId === displayId
            ? {
                ...c,
                ...selected,
                displayId: c.displayId,
                priceStatus: "loading",
                pendingConfirmation: false,
                alternates: [],
                showGoldConfirmRing: true,
                recognitionConfidence: "medium",
                imageUrl: undefined,
                priceUsd: undefined,
                trend: undefined,
                trendPercent: undefined,
                priceRange: undefined,
              }
            : c,
        ),
      );
      hydrateCardPrices([toHydrate], setTheirSide);
    },
    [],
  );

  const notListedResultsRescan = useCallback(() => {
    setMySide([]);
    setMainTab("cards");
  }, []);

  const notListedYourTradeRow = useCallback((displayId: string) => {
    setMySide((prev) => prev.filter((c) => c.displayId !== displayId));
    setError(null);
    scanIntentRef.current = "append-your-trade";
    scanInputRef.current?.click();
  }, []);

  const notListedTheirTradeRow = useCallback((displayId: string) => {
    setTheirSide((prev) => prev.filter((c) => c.displayId !== displayId));
    setError(null);
    scanIntentRef.current = "append-their-trade";
    scanInputRef.current?.click();
  }, []);

  const retryAppendAfterLow = useCallback(() => {
    setLowScanOverlay(false);
    setError(null);
    if (lowAppendSideRef.current === "yours") {
      scanIntentRef.current = "append-your-trade";
      scanInputRef.current?.click();
    } else if (lowAppendSideRef.current === "theirs") {
      scanIntentRef.current = "append-their-trade";
      scanInputRef.current?.click();
    }
  }, []);

  const yourTotal = sumPrices(mySide);
  const theirTotal = sumPrices(theirSide);
  const verdict = gradeFromDiff(yourTotal, theirTotal);
  const absDiff = Math.abs(verdict.diff);
  const summary = tradeSummary(verdict.favor, absDiff);
  const trends = trendFlagLine(mySide, theirSide);

  const yourListAddLoading = loading && appendLoadingSide === "yours";
  const theirListAddLoading = loading && appendLoadingSide === "theirs";

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
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

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))]">
        {lowConfidenceOpen ? (
          <LowConfidenceView
            onTryAgain={() => {
              setSkippedOnLastScan(0);
              setLowConfidenceOpen(false);
            }}
          />
        ) : (
          <>
            {mainTab === "cards" &&
              (mySide.length === 0 ? (
                <ScannerView
                  mySideCount={mySide.length}
                  maxCards={MAX_YOUR_CARDS}
                  loading={loading}
                  error={error}
                  onScan={openYourScan}
                />
              ) : (
                <ResultsView
                  cards={mySide}
                  cardCount={mySide.length}
                  maxCards={MAX_YOUR_CARDS}
                  total={yourTotal}
                  loading={loading}
                  yourAddLoading={yourListAddLoading}
                  error={error}
                  skippedOnLastScan={skippedOnLastScan}
                  onConfirmIdentity={confirmYourCardIdentity}
                  onNotListed={notListedResultsRescan}
                  onAddYourCard={openAddYourFromResults}
                  onRequestRemoveCard={(index, name) =>
                    requestRemoveCard("yours", index, name)
                  }
                  onScanAgain={openYourScan}
                />
              ))}

            {mainTab === "trade" && (
              <TradeView
                mySide={mySide}
                theirSide={theirSide}
                maxYourCards={MAX_YOUR_CARDS}
                maxTheirCards={MAX_THEIR_CARDS}
                yourTotal={yourTotal}
                theirTotal={theirTotal}
                verdict={verdict}
                absDiff={absDiff}
                summary={summary}
                trends={trends}
                loading={loading}
                yourAddLoading={yourListAddLoading}
                theirAddLoading={theirListAddLoading}
                error={error}
                onAddYourCard={openAddYourToTrade}
                onAddTheirCard={openAddTheirToTrade}
                onRequestRemoveCard={requestRemoveCard}
                onConfirmYour={confirmYourCardIdentity}
                onConfirmTheir={confirmTheirCardIdentity}
                onNotListedYour={notListedYourTradeRow}
                onNotListedTheir={notListedTheirTradeRow}
              />
            )}

            {mainTab === "battle" && (
              <BattleScreen
                mySide={mySide}
                theirSide={theirSide}
                maxMy={MAX_YOUR_CARDS}
                maxTheir={MAX_THEIR_CARDS}
                loading={loading}
                myAddLoading={yourListAddLoading}
                theirAddLoading={theirListAddLoading}
                error={error}
                onScanMy={openAddYourToTrade}
                onScanTheir={openAddTheirToTrade}
                onRequestRemove={requestRemoveCard}
                battleRescanSlot={battleRescanSlot}
                onRescanBattleSlot={openBattleRescan}
                onGoToMyCards={() => {
                  setError(null);
                  setMainTab("cards");
                }}
              />
            )}
          </>
        )}
      </div>

      {!lowConfidenceOpen && (
        <BottomTabNav
          active={mainTab}
          onChange={(t) => {
            setError(null);
            setMainTab(t);
          }}
        />
      )}

      {lowScanOverlay && (
        <LowConfidenceAppendOverlay
          onTryAgain={retryAppendAfterLow}
          onDismiss={() => setLowScanOverlay(false)}
        />
      )}
    </div>
  );
}

function BottomTabNav({
  active,
  onChange,
}: {
  active: MainTab;
  onChange: (t: MainTab) => void;
}) {
  const btn = (t: MainTab, label: string, activeClass: string) => (
    <button
      type="button"
      onClick={() => onChange(t)}
      className={`flex-1 py-3.5 text-center text-xs font-semibold tracking-wide transition ${
        active === t ? activeClass : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#0f0f13]/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-md">
      <div className="mx-auto flex max-w-md px-1">
        {btn("cards", "My Cards", "text-[#F5C518]")}
        {btn("trade", "Trade", "text-[#F5C518]")}
        {btn("battle", "Battle", "text-[#DC2626]")}
      </div>
    </nav>
  );
}

function LowConfidenceView({ onTryAgain }: { onTryAgain: () => void }) {
  return (
    <>
      <header className="mb-6 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight text-[#F5C518]">
          PokeBlock
        </span>
      </header>
      <div className="flex flex-1 flex-col px-1">
        <h1 className="text-center text-xl font-semibold leading-snug text-white">
          Couldn&apos;t read this card clearly
        </h1>
        <ul className="mx-auto mt-8 max-w-sm list-disc space-y-3 pl-5 text-sm leading-relaxed text-zinc-400">
          <li>Photo one card at a time — fill the frame with that card</li>
          <li>Make sure the card number (bottom right) is visible</li>
          <li>Try better lighting — avoid glare</li>
          <li>Hold the camera steady</li>
        </ul>
        <button
          type="button"
          onClick={onTryAgain}
          className="mt-auto w-full rounded-full bg-[#F5C518] py-3.5 text-sm font-semibold text-[#0f0f13]"
        >
          Try again
        </button>
      </div>
    </>
  );
}

function LowConfidenceAppendOverlay({
  onTryAgain,
  onDismiss,
}: {
  onTryAgain: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/80 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-2xl bg-[#18181f] p-5 shadow-2xl ring-1 ring-white/10"
      >
        <h2 className="text-lg font-semibold text-white">
          Couldn&apos;t read this card clearly
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-zinc-400">
          <li>One card in the photo — avoid extra cards in frame</li>
          <li>Make sure the card number (bottom right) is visible</li>
          <li>Try better lighting — avoid glare</li>
          <li>Hold the camera steady and fill the frame</li>
        </ul>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onTryAgain}
            className="w-full rounded-full bg-[#F5C518] py-3 text-sm font-semibold text-[#0f0f13] sm:flex-1"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="w-full rounded-full bg-white/10 py-3 text-sm font-semibold text-white ring-1 ring-white/15 sm:flex-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ScannerView({
  mySideCount,
  maxCards,
  loading,
  error,
  onScan,
}: {
  mySideCount: number;
  maxCards: number;
  loading: boolean;
  error: string | null;
  onScan: () => void;
}) {
  const atCap = mySideCount >= maxCards;
  return (
    <>
      <header className="mb-6 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight text-[#F5C518]">
          PokeBlock
        </span>
      </header>

      <button
        type="button"
        onClick={onScan}
        disabled={loading || atCap}
        className="flex flex-1 flex-col items-stretch rounded-2xl text-left disabled:opacity-60"
      >
        <div className="flex min-h-[min(52vh,420px)] flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#F5C518]/70 bg-white/[0.03] px-6 py-10 ring-1 ring-[#F5C518]/15">
          <CameraGlyph className="mb-4 h-14 w-14 text-[#F5C518]/90" />
          <p className="text-center text-sm leading-relaxed text-zinc-400">
            One card in frame · tap to scan
          </p>
          <p className="mt-2 text-center text-xs text-zinc-600">
            Photo one card at a time. You can keep up to {maxCards} cards.
          </p>
        </div>
      </button>

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={onScan}
          disabled={loading || atCap}
          className="w-full rounded-full bg-[#F5C518] py-3.5 text-center text-sm font-semibold text-[#0f0f13] shadow-[0_8px_30px_rgba(245,197,24,0.18)] transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
        >
          {loading
            ? "Reading your card..."
            : atCap
              ? `${maxCards} cards — remove one to scan`
              : "Scan a card"}
        </button>
        {loading && (
          <p className="text-center text-sm text-zinc-500">
            Reading your card...
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
  cardCount,
  maxCards,
  total,
  loading,
  yourAddLoading,
  error,
  skippedOnLastScan,
  onConfirmIdentity,
  onNotListed,
  onAddYourCard,
  onRequestRemoveCard,
  onScanAgain,
}: {
  cards: DisplayCard[];
  cardCount: number;
  maxCards: number;
  total: number;
  loading: boolean;
  yourAddLoading: boolean;
  error: string | null;
  skippedOnLastScan: number;
  onConfirmIdentity: (displayId: string, selected: ScannedCard) => void;
  onNotListed: () => void;
  onAddYourCard: () => void;
  onRequestRemoveCard: (index: number, name: string) => void;
  onScanAgain: () => void;
}) {
  const showAddTile = cardCount >= 1 && cardCount < maxCards;
  const atCap = cardCount >= maxCards;

  return (
    <>
      <header className="mb-5 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight text-[#F5C518]">
          PokeBlock
        </span>
      </header>

      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-white">
        Your Cards
      </h1>
      <p className="mb-4 text-xs text-zinc-500">
        One card per photo · up to {maxCards} cards · use the bar below for
        Trade or Battle — your list stays in sync everywhere.
      </p>

      {skippedOnLastScan > 0 ? (
        <p className="mb-3 text-xs text-zinc-500">
          Couldn&apos;t read {skippedOnLastScan} card
          {skippedOnLastScan === 1 ? "" : "s"} in that photo (too uncertain).
        </p>
      ) : null}

      <div className="flex flex-1 items-start gap-3">
        <div className="flex min-h-[4.5rem] min-w-0 flex-1 flex-col gap-3">
          {cards.length === 0 && !loading && (
            <p className="text-sm text-zinc-500">
              No card detected. Try one card in frame with less glare.
            </p>
          )}
          {cards.map((c, i) => (
            <ScanResultCard
              key={c.displayId}
              card={c}
              showRemove
              onRemoveClick={() => onRequestRemoveCard(i, c.name)}
              onConfirmIdentity={onConfirmIdentity}
              onNotListed={onNotListed}
            />
          ))}
        </div>
        {showAddTile ? (
          <AddCardTile
            onClick={onAddYourCard}
            disabled={loading || atCap}
            loading={yourAddLoading}
          />
        ) : null}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-auto pt-8">
        <p className="mb-3 text-center text-sm text-zinc-500">
          {cardCount} of {maxCards} card{cardCount === 1 ? "" : "s"} ·{" "}
          <span className="font-medium text-white">${total}</span>
          {hasPriceLoading(cards) ? (
            <span className="text-zinc-600"> · …</span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={onScanAgain}
          disabled={loading || atCap}
          className="w-full rounded-full py-2 text-center text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline disabled:opacity-40"
        >
          {atCap
            ? `${maxCards} cards — remove one to scan again`
            : "Scan another card"}
        </button>
      </div>
    </>
  );
}

function TradeView({
  mySide,
  theirSide,
  maxYourCards,
  maxTheirCards,
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
  onAddYourCard,
  onAddTheirCard,
  onRequestRemoveCard,
  onConfirmYour,
  onConfirmTheir,
  onNotListedYour,
  onNotListedTheir,
}: {
  mySide: DisplayCard[];
  theirSide: DisplayCard[];
  maxYourCards: number;
  maxTheirCards: number;
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
  onAddYourCard: () => void;
  onAddTheirCard: () => void;
  onRequestRemoveCard: (
    side: "yours" | "theirs",
    index: number,
    name: string,
  ) => void;
  onConfirmYour: (displayId: string, selected: ScannedCard) => void;
  onConfirmTheir: (displayId: string, selected: ScannedCard) => void;
  onNotListedYour: (displayId: string) => void;
  onNotListedTheir: (displayId: string) => void;
}) {
  const diffLabel =
    verdict.favor === "even"
      ? "Even trade"
      : verdict.favor === "yours"
        ? `+$${absDiff} in your favor`
        : `-$${absDiff}`;

  return (
    <>
      <header className="mb-5 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight text-[#F5C518]">
          PokeBlock
        </span>
        <span className="text-sm font-semibold text-zinc-400">Trade</span>
      </header>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-semibold text-white">Your Cards</h2>
        <p className="mb-3 text-xs text-zinc-600">
          One card per photo · up to {maxYourCards} cards · same list as on the
          home results screen and in Battle Mode.
        </p>
        <div className="flex items-start gap-3">
          <div className="flex min-h-[4.5rem] min-w-0 flex-1 flex-col gap-3">
            {mySide.length === 0 && !yourAddLoading && (
              <p className="text-xs text-zinc-600">
                Add your cards one at a time (max {maxYourCards}).
              </p>
            )}
            {mySide.map((c, i) => (
              <ScanResultCard
                key={c.displayId}
                card={c}
                showRemove
                onRemoveClick={() =>
                  onRequestRemoveCard("yours", i, c.name)
                }
                onConfirmIdentity={onConfirmYour}
                onNotListed={() => onNotListedYour(c.displayId)}
              />
            ))}
          </div>
          <AddCardTile
            onClick={onAddYourCard}
            disabled={loading || mySide.length >= maxYourCards}
            loading={yourAddLoading}
          />
        </div>
        <p className="mt-2 text-right text-xs text-zinc-500">
          {mySide.length} of {maxYourCards} · Subtotal · ${yourTotal}
          {hasPriceLoading(mySide) ? " · …" : ""}
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-1 text-lg font-semibold text-white">Their Cards</h2>
        <p className="mb-3 text-xs text-zinc-600">
          One card per photo · up to {maxTheirCards} cards on their side.
        </p>
        <div className="flex items-start gap-3">
          <div className="flex min-h-[4.5rem] min-w-0 flex-1 flex-col gap-3">
            {theirSide.length === 0 && !theirAddLoading && (
              <p className="text-xs text-zinc-600">
                Scan their cards one at a time (max {maxTheirCards}).
              </p>
            )}
            {theirSide.map((c, i) => (
              <ScanResultCard
                key={c.displayId}
                card={c}
                showRemove
                onRemoveClick={() =>
                  onRequestRemoveCard("theirs", i, c.name)
                }
                onConfirmIdentity={onConfirmTheir}
                onNotListed={() => onNotListedTheir(c.displayId)}
              />
            ))}
          </div>
          <AddCardTile
            onClick={onAddTheirCard}
            disabled={loading || theirSide.length >= maxTheirCards}
            loading={theirAddLoading}
          />
        </div>
        <p className="mt-2 text-right text-xs text-zinc-500">
          {theirSide.length} of {maxTheirCards} · Subtotal · ${theirTotal}
          {hasPriceLoading(theirSide) ? " · …" : ""}
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
