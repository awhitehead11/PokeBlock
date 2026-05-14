"use client";

type RemoveCardModalProps = {
  open: boolean;
  pokemonName: string;
  onKeep: () => void;
  onRemove: () => void;
};

export function RemoveCardModal({
  open,
  pokemonName,
  onKeep,
  onRemove,
}: RemoveCardModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        aria-label="Close dialog"
        onClick={onKeep}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-card-title"
        className="relative z-10 w-full max-w-sm rounded-2xl bg-[#18181f] p-5 shadow-2xl ring-1 ring-white/10"
      >
        <h2
          id="remove-card-title"
          className="text-base font-semibold text-white"
        >
          Remove from trade?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Are you sure you want to remove{" "}
          <span className="font-medium text-white">{pokemonName}</span> from
          this trade?
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
          <button
            type="button"
            onClick={onRemove}
            className="w-full rounded-full bg-red-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-600 sm:w-auto"
          >
            Yes, Remove
          </button>
          <button
            type="button"
            onClick={onKeep}
            className="w-full rounded-full bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/[0.14] sm:w-auto"
          >
            No, Keep
          </button>
        </div>
      </div>
    </div>
  );
}
