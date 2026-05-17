"use client";

type ScanProgressBarProps = {
  label?: string;
  accentColor?: string;
  className?: string;
};

export function ScanProgressBar({
  label = "Scanning card…",
  accentColor = "#F5C518",
  className = "",
}: ScanProgressBarProps) {
  return (
    <div className={className} role="status" aria-live="polite">
      <p className="mb-2 text-center text-xs font-medium text-zinc-300">{label}</p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="pokescan-scan-progress-indeterminate h-full w-[38%] rounded-full"
          style={{ backgroundColor: accentColor }}
        />
      </div>
      <p className="mt-2 text-center text-[10px] leading-snug text-zinc-500">
        Please wait — don&apos;t scan again
      </p>
    </div>
  );
}

type ScanLoadingOverlayProps = {
  active: boolean;
  accentColor?: string;
  label?: string;
  className?: string;
  children: React.ReactNode;
};

export function ScanLoadingOverlay({
  active,
  accentColor,
  label,
  className = "",
  children,
}: ScanLoadingOverlayProps) {
  return (
    <div className={`relative ${className}`}>
      {children}
      {active ? (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-[#0f0f13]/92 px-4 backdrop-blur-[2px]"
          role="status"
          aria-live="polite"
        >
          <ScanProgressBar
            accentColor={accentColor}
            label={label}
            className="w-full max-w-[11rem]"
          />
        </div>
      ) : null}
    </div>
  );
}
