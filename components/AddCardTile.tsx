type AddCardTileProps = {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export function AddCardTile({ onClick, disabled, loading }: AddCardTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="flex w-[5.5rem] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#F5C518]/45 bg-white/[0.02] px-2 py-4 text-center transition hover:border-[#F5C518]/80 hover:bg-white/[0.05] disabled:pointer-events-none disabled:opacity-45"
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F5C518]/15 text-lg font-light text-[#F5C518]"
        aria-hidden
      >
        +
      </span>
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        {loading ? "Scanning…" : "Add card"}
      </span>
    </button>
  );
}
