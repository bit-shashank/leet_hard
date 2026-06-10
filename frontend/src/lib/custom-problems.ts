import type { CustomProblemInput, CustomProblemPublic } from "@/lib/types";

export function parseCustomProblemText(value: string): CustomProblemInput[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((titleSlug) => ({
      title_slug: titleSlug,
      difficulty: "Medium",
    }));
}

export function formatCustomProblems(problems: CustomProblemPublic[]) {
  return problems.map((problem) => problem.title_slug).join("\n");
}
