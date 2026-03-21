"use client";

import { useMemo, useState } from "react";

type AvatarBadgeProps = {
  name: string;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg";
};

const SIZE_CLASS: Record<NonNullable<AvatarBadgeProps["size"]>, string> = {
  sm: "h-7 w-7 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-12 w-12 text-base",
};

export function AvatarBadge({ name, avatarUrl, size = "md" }: AvatarBadgeProps) {
  const [broken, setBroken] = useState(false);
  const initials = useMemo(() => {
    const parts = name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    if (!parts.length) return "?";
    return parts.map((part) => part.charAt(0).toUpperCase()).join("");
  }, [name]);

  const showImage = Boolean(avatarUrl && !broken);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-500/50 bg-slate-800 text-slate-100 ${SIZE_CLASS[size]}`}
      aria-label={`${name} avatar`}
      title={name}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl || ""}
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="font-semibold">{initials}</span>
      )}
    </span>
  );
}
