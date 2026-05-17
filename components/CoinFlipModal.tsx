"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BattleTeam } from "@/lib/battle";

const BLUE = "#3B82F6";
const GOLD = "#F59E0B";

type Stage = "ready" | "flipping" | "result";

type CoinFlipModalProps = {
  onResult: (firstTeam: BattleTeam) => void;
};

export function CoinFlipModal({ onResult }: CoinFlipModalProps) {
  const [stage, setStage] = useState<Stage>("ready");
  const [ellipsis, setEllipsis] = useState(".");
  const [winner, setWinner] = useState<BattleTeam | null>(null);
  const winnerRef = useRef<BattleTeam | null>(null);

  const startFlip = useCallback(() => {
    const first: BattleTeam = Math.random() < 0.5 ? "blue" : "gold";
    winnerRef.current = first;
    setWinner(first);
    setStage("flipping");
  }, []);

  useEffect(() => {
    if (stage !== "flipping") return;

    let dot = 0;
    const ellipsisInterval = setInterval(() => {
      dot = (dot + 1) % 3;
      setEllipsis(".".repeat(dot + 1));
    }, 300);

    const flipDone = setTimeout(() => {
      clearInterval(ellipsisInterval);
      setStage("result");
    }, 900);

    return () => {
      clearInterval(ellipsisInterval);
      clearTimeout(flipDone);
    };
  }, [stage]);

  useEffect(() => {
    if (stage !== "result" || !winnerRef.current) return;

    const dismiss = setTimeout(() => {
      onResult(winnerRef.current!);
    }, 1800);

    return () => clearTimeout(dismiss);
  }, [stage, onResult]);

  const winnerColor = winner === "blue" ? BLUE : GOLD;
  const winnerLabel = winner === "blue" ? "BLUE" : "GOLD";

  return (
    <div className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-6 backdrop-blur-md pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <style>{`
        @keyframes coin-flip-y {
          0% { transform: rotateY(0deg); }
          100% { transform: rotateY(360deg); }
        }
        @keyframes pulse-ring {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.06); opacity: 0.85; }
        }
        .coin-flip-animate {
          animation: coin-flip-y 0.45s linear infinite;
          transform-style: preserve-3d;
        }
        .flip-btn-pulse {
          animation: pulse-ring 2s ease-in-out infinite;
        }
        .result-fade-in {
          animation: fade-in 0.5s ease-out forwards;
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {stage === "ready" && (
        <button
          type="button"
          onClick={startFlip}
          className="flip-btn-pulse ps-touch flex h-40 w-40 flex-col items-center justify-center rounded-full text-xl font-bold text-white shadow-lg ring-4 ring-white/20 sm:h-36 sm:w-36"
          style={{
            background: `linear-gradient(135deg, ${BLUE}, ${GOLD})`,
          }}
        >
          Flip Coin
        </button>
      )}

      {stage === "flipping" && (
        <div className="flex flex-col items-center gap-6">
          <div className="coin-flip-animate relative h-24 w-24">
                <div
              className="absolute inset-0 flex items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: BLUE, backfaceVisibility: "hidden" }}
            >
              BLUE
            </div>
            <div
              className="absolute inset-0 flex items-center justify-center rounded-full text-sm font-bold text-white"
              style={{
                backgroundColor: GOLD,
                backfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
            >
              GOLD
            </div>
          </div>
          <p className="text-lg font-medium text-white">
            Flipping{ellipsis}
          </p>
        </div>
      )}

      {stage === "result" && winner && (
        <div className="result-fade-in flex flex-col items-center text-center">
          <p
            className="text-4xl font-bold tracking-tight"
            style={{ color: winnerColor }}
          >
            {winnerLabel} Begins!
          </p>
          <p className="mt-3 text-sm text-zinc-400">Choose your first move</p>
        </div>
      )}
    </div>
  );
}
