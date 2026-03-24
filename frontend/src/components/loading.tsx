import type { ReactNode } from "react";

type ClassValue = string | false | null | undefined;

function cx(...values: ClassValue[]) {
  return values.filter(Boolean).join(" ");
}

type InlineSpinnerProps = {
  className?: string;
  label?: string;
};

export function InlineSpinner({ className, label = "Loading" }: InlineSpinnerProps) {
  return (
    <span className={cx("inline-flex items-center justify-center", className)} role="status" aria-live="polite">
      <span className="spinner-ring h-full w-full" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

type SkeletonBlockProps = {
  className?: string;
};

export function SkeletonBlock({ className }: SkeletonBlockProps) {
  return <div className={cx("skeleton-shimmer loading-glaze rounded-md", className)} aria-hidden="true" />;
}

type SkeletonTextProps = {
  className?: string;
  lines?: number;
};

export function SkeletonText({ className, lines = 2 }: SkeletonTextProps) {
  return (
    <div className={cx("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <SkeletonBlock
          key={`line-${index}`}
          className={cx(
            "h-3",
            index === lines - 1 && lines > 1 ? "w-4/5" : "w-full",
          )}
        />
      ))}
    </div>
  );
}

type SkeletonRowProps = {
  className?: string;
  columns?: number;
};

export function SkeletonRow({ className, columns = 4 }: SkeletonRowProps) {
  return (
    <div className={cx("grid items-center gap-3", className)} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} aria-hidden="true">
      {Array.from({ length: columns }).map((_, index) => (
        <SkeletonBlock key={`col-${index}`} className="h-4" />
      ))}
    </div>
  );
}

type PageLoaderProps = {
  title: string;
  subtitle?: string;
  className?: string;
  children?: ReactNode;
};

export function PageLoader({ title, subtitle, className, children }: PageLoaderProps) {
  return (
    <main className={cx("mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8", className)}>
      <section className="loading-glaze rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/30">
        <div className="flex items-center gap-3 text-slate-100">
          <InlineSpinner className="h-5 w-5 text-cyan-200" label={title} />
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        {subtitle ? <p className="mt-2 text-sm text-slate-300">{subtitle}</p> : null}
        <div className="mt-4 space-y-3">
          {children ?? (
            <>
              <SkeletonBlock className="h-20 w-full rounded-xl" />
              <SkeletonText lines={3} />
            </>
          )}
        </div>
      </section>
    </main>
  );
}
