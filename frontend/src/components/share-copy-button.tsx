type ShareCopyButtonProps = {
  copied: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
};

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.7 6.8-3.4" />
      <path d="m8.6 13.3 6.8 3.4" />
    </svg>
  );
}

function CopiedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

export function ShareCopyButton({
  copied,
  onClick,
  disabled = false,
  className = "",
}: ShareCopyButtonProps) {
  const title = copied ? "Copied" : "Share room";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
        copied
          ? "border-emerald-300/50 bg-emerald-500/15 text-emerald-100"
          : "border-cyan-300/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
      } ${className}`}
    >
      {copied ? <CopiedIcon /> : <ShareIcon />}
    </button>
  );
}
