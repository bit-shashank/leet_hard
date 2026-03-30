"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import { AvatarBadge } from "@/components/avatar-badge";
import { useAuth } from "@/components/auth-provider";
import { InlineSpinner } from "@/components/loading";
import { requiresOnboarding } from "@/lib/onboarding";

export function TopNav() {
  const pathname = usePathname();
  const { authLoading, me, signInWithGoogle, signOut, user } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"signin" | "signout" | null>(null);

  const displayName = useMemo(() => {
    if (me?.display_name) return me.display_name;
    const metadataName =
      typeof user?.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : typeof user?.user_metadata?.name === "string"
          ? user.user_metadata.name
          : null;
    return metadataName || user?.email || "User";
  }, [me?.display_name, user?.email, user?.user_metadata?.full_name, user?.user_metadata?.name]);

  async function handleSignIn() {
    setActionError(null);
    setPendingAction("signin");
    try {
      await signInWithGoogle();
    } catch {
      setActionError("Unable to start Google sign in. Please try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSignOut() {
    setActionError(null);
    setPendingAction("signout");
    try {
      await signOut();
    } catch {
      setActionError("Unable to sign out right now.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="sticky top-0 z-40 border-b border-cyan-300/20 bg-slate-950/75 backdrop-blur">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="rounded-lg px-2 py-1 text-sm font-semibold tracking-wide text-cyan-100 transition hover:bg-cyan-500/10"
          >
            LeetRace
          </Link>
          <Link
            href="/dashboard"
            className={`rounded-lg px-2 py-1 text-sm transition ${
              pathname === "/dashboard"
                ? "bg-cyan-500/15 text-cyan-100"
                : "text-slate-300 hover:bg-slate-800/70"
            }`}
          >
            Dashboard
          </Link>
          {user && me?.role === "admin" ? (
            <Link
              href="/admin"
              className={`rounded-lg px-2 py-1 text-sm transition ${
                pathname === "/admin"
                  ? "bg-fuchsia-500/15 text-fuchsia-100"
                  : "text-fuchsia-200 hover:bg-fuchsia-500/10"
              }`}
            >
              Admin
            </Link>
          ) : null}
          {user && requiresOnboarding(me) ? (
            <Link
              href="/getting-started"
              className={`rounded-lg px-2 py-1 text-sm transition ${
                pathname === "/getting-started"
                  ? "bg-amber-500/20 text-amber-100"
                  : "text-amber-200 hover:bg-amber-500/10"
              }`}
            >
              Getting Started
            </Link>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {authLoading ? (
            <span className="inline-flex items-center gap-2 text-xs text-slate-300">
              <InlineSpinner className="h-3.5 w-3.5" label="Checking session" />
              Checking session...
            </span>
          ) : user ? (
            <>
              <div className="hidden items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-900/70 px-2 py-1 sm:flex">
                <AvatarBadge name={displayName} avatarUrl={me?.avatar_url || null} size="sm" />
                <div className="max-w-[200px] text-xs">
                  <p className="truncate text-slate-100">{displayName}</p>
                  <p className="truncate text-slate-400">{user.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                disabled={pendingAction === "signout"}
                className="rounded-lg border border-slate-500/60 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendingAction === "signout" ? (
                  <span className="inline-flex items-center gap-2">
                    <InlineSpinner className="h-3.5 w-3.5" label="Signing out" />
                    Signing out...
                  </span>
                ) : (
                  "Sign out"
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void handleSignIn()}
              disabled={pendingAction === "signin"}
              className="rounded-lg bg-cyan-400 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pendingAction === "signin" ? (
                <span className="inline-flex items-center gap-2">
                  <InlineSpinner className="h-3.5 w-3.5" label="Redirecting to Google sign-in" />
                  Redirecting...
                </span>
              ) : (
                "Sign in with Google"
              )}
            </button>
          )}
        </div>
      </nav>
      {actionError ? (
        <div className="mx-auto w-full max-w-6xl px-4 pb-2 text-xs text-rose-200 md:px-8">
          {actionError}
        </div>
      ) : null}
    </div>
  );
}
