import type { MeResponse } from "@/lib/types";

export function requiresOnboarding(me: MeResponse | null | undefined) {
  if (!me) return false;
  return Boolean(
    me.onboarding_required ||
      !me.primary_leetcode_username ||
      !me.leetcode_verified ||
      !me.leetcode_locked,
  );
}
