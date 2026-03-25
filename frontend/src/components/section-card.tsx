import type { ReactNode } from "react";

type SectionCardProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  rightSlot?: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function SectionCard({
  title,
  subtitle,
  children,
  rightSlot,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <section
      className={`rounded-2xl border border-slate-700/50 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30 backdrop-blur ${
        className ?? ""
      }`}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-slate-300/80">{subtitle}</p>
          ) : null}
        </div>
        {rightSlot}
      </header>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
