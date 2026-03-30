import { useState } from "react";

import type { TopicInfo } from "@/lib/types";

type TopicSelectorProps = {
  topics: TopicInfo[];
  selected: string[];
  onToggle: (slug: string) => void;
  disabled?: boolean;
  initialVisibleCount?: number;
  showCounts?: boolean;
};

export function TopicSelector({
  topics,
  selected,
  onToggle,
  disabled = false,
  initialVisibleCount = 8,
  showCounts = true,
}: TopicSelectorProps) {
  const [expanded, setExpanded] = useState(false);

  if (!topics.length) {
    return (
      <p className="text-xs text-slate-400">No topics available yet.</p>
    );
  }

  const pinnedSlugs = [
    "binary-search",
    "dynamic-programming",
    "sliding-window",
    "array",
    "graph",
  ];
  const pinnedOrder = new Map(pinnedSlugs.map((slug, index) => [slug, index]));
  const quickExclusions = new Set(["biconnected-components", "binary-indexed-tree"]);
  const orderedTopics = [...topics]
    .filter((topic) => !quickExclusions.has(topic.slug))
    .sort((a, b) => {
    const aPinned = pinnedOrder.has(a.slug);
    const bPinned = pinnedOrder.has(b.slug);
    if (aPinned && bPinned) {
      return pinnedOrder.get(a.slug)! - pinnedOrder.get(b.slug)!;
    }
    if (aPinned) return -1;
    if (bPinned) return 1;
    return a.name.localeCompare(b.name);
  });

  const pinnedTopics = orderedTopics.filter((topic) => pinnedOrder.has(topic.slug));
  const fallbackCount = Math.max(1, initialVisibleCount - pinnedTopics.length);
  const visibleBase = [...pinnedTopics, ...orderedTopics.filter((topic) => !pinnedOrder.has(topic.slug)).slice(0, fallbackCount)];
  const selectedExtras = orderedTopics.filter(
    (topic) => selected.includes(topic.slug) && !visibleBase.some((base) => base.slug === topic.slug),
  );
  const visibleTopics = expanded ? orderedTopics : [...visibleBase, ...selectedExtras];
  const hiddenCount = Math.max(0, orderedTopics.length - visibleBase.length);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {visibleTopics.map((topic) => {
        const active = selected.includes(topic.slug);
        return (
          <button
            key={topic.slug}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(topic.slug)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              active
                ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-100"
                : "border-slate-600/70 bg-slate-900/40 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <span className="mr-1">{topic.name}</span>
            {showCounts ? (
              <span className={active ? "text-emerald-100/80" : "text-slate-400"}>
                {topic.count}
              </span>
            ) : null}
          </button>
        );
      })}
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="rounded-full border border-slate-600/70 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
        >
          {expanded ? "Show fewer topics" : `Show ${hiddenCount} more`}
        </button>
      ) : null}
    </div>
  );
}
