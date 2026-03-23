import type { ProblemSource } from "@/lib/types";

const PROBLEM_SOURCE_LABELS: Record<ProblemSource, string> = {
  random: "Random",
  neetcode_150: "NeetCode 150",
  neetcode_250: "NeetCode 250",
  blind_75: "Blind 75",
  striver_a2z_sheet: "Striver A2Z Sheet",
  striver_sde_sheet: "Striver SDE Sheet",
};

export function formatProblemSource(source: ProblemSource) {
  return PROBLEM_SOURCE_LABELS[source];
}
