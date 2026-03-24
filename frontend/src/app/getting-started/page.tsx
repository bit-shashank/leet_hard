"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

import { useAuth } from "@/components/auth-provider";
import { InlineSpinner, PageLoader } from "@/components/loading";
import { ApiError, startOnboarding, verifyOnboarding } from "@/lib/api";
import { requiresOnboarding } from "@/lib/onboarding";
import type { OnboardingStartResponse } from "@/lib/types";

function parseApiError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Please try again.";
}

export default function GettingStartedPage() {
  const router = useRouter();
  const {
    accessToken,
    authLoading,
    me,
    profileLoading,
    refreshMe,
    signInWithGoogle,
    user,
  } = useAuth();

  const [step, setStep] = useState(1);
  const [leetcodeUsername, setLeetcodeUsername] = useState("");
  const [challenge, setChallenge] = useState<OnboardingStartResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [confirmOwnership, setConfirmOwnership] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me?.primary_leetcode_username) {
      setLeetcodeUsername(me.primary_leetcode_username);
    }
  }, [me?.primary_leetcode_username]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accessToken) return;

    if (!requiresOnboarding(me)) {
      router.replace("/");
    }
  }, [accessToken, authLoading, me, profileLoading, router, user]);

  const stepTitles = useMemo(() => {
    const verifyStepTitle =
      challenge?.verification_mode === "strict" ? "Submit Solution" : "Verify Profile";
    return ["Welcome", "LeetCode ID", verifyStepTitle, "Complete"] as const;
  }, [challenge?.verification_mode]);

  const stepProgress = useMemo(() => (step / stepTitles.length) * 100, [step, stepTitles.length]);

  async function handleStartOnboarding() {
    if (!accessToken) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await startOnboarding(
        {
          leetcode_username: leetcodeUsername.trim(),
        },
        accessToken,
      );
      setChallenge(response);
      setConfirmOwnership(false);
      setStep(3);
      await refreshMe();
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify() {
    if (!accessToken || !challenge) return;

    setVerifying(true);
    setError(null);
    try {
      await verifyOnboarding(
        accessToken,
        challenge.verification_mode === "soft"
          ? { confirm_ownership: confirmOwnership }
          : undefined,
      );
      await refreshMe();
      setStep(4);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setVerifying(false);
    }
  }

  async function handleSignIn() {
    setError(null);
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch {
      setError("Unable to start Google sign in. Please try again.");
      setSigningIn(false);
    }
  }

  if (authLoading || profileLoading) {
    return (
      <PageLoader
        title="Preparing getting started..."
        subtitle="Setting up your onboarding flow."
      />
    );
  }

  if (!user || !accessToken) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8">
        <div className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-6">
          <h1 className="text-2xl font-semibold text-amber-100">Getting Started</h1>
          <p className="mt-2 text-sm text-amber-100/90">
            Sign in with Google to continue your LeetRace setup.
          </p>
          {error ? (
            <div className="mt-4 rounded-lg border border-rose-300/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={signingIn}
            className="mt-4 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {signingIn ? (
              <span className="inline-flex items-center gap-2">
                <InlineSpinner className="h-4 w-4" label="Redirecting to Google sign-in" />
                Redirecting...
              </span>
            ) : (
              "Sign in with Google"
            )}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl space-y-6 px-4 py-10 md:px-8">
      <header className="rounded-2xl border border-cyan-300/20 bg-slate-900/65 p-6 backdrop-blur">
        <p className="text-xs uppercase tracking-wide text-cyan-200">LeetRace Getting Started</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-50">
          Let&apos;s get your account race-ready
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          Enter your correct LeetCode ID and verify it once. This ID cannot be changed from the app
          after verification.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-700/50 bg-slate-900/70 p-5">
        <div className="mb-3 flex items-center justify-between text-xs text-slate-300">
          <span>
            Step {step} / {stepTitles.length}
          </span>
          <span>{stepTitles[step - 1]}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-800">
          <div
            className="h-2 rounded-full bg-cyan-400 transition-all"
            style={{ width: `${stepProgress}%` }}
          />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
          {stepTitles.map((label, idx) => (
            <div
              key={label}
              className={`rounded-lg px-2 py-1 ${
                idx + 1 <= step
                  ? "border border-cyan-300/40 bg-cyan-500/10 text-cyan-100"
                  : "border border-slate-700/60 bg-slate-900/40 text-slate-400"
              }`}
            >
              {label}
            </div>
          ))}
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {step === 1 ? (
        <section className="rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6">
          <h2 className="text-xl font-semibold text-slate-100">Welcome to LeetRace</h2>
          <p className="mt-2 text-sm text-slate-300">
            Before joining rooms, complete a quick one-time LeetCode identity setup.
          </p>
          <button
            type="button"
            onClick={() => setStep(2)}
            className="mt-5 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300"
          >
            Continue
          </button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6">
          <h2 className="text-xl font-semibold text-slate-100">Enter your LeetCode ID</h2>
          <p className="mt-2 text-sm text-slate-300">
            Enter the correct username. It cannot be changed after verification.
          </p>

          <label className="mt-4 block text-sm text-slate-200">
            LeetCode Username
            <input
              required
              value={leetcodeUsername}
              onChange={(e) => setLeetcodeUsername(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
              placeholder="your-leetcode-username"
            />
          </label>

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg border border-slate-500/60 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
            >
              Back
            </button>
            <button
              type="button"
              disabled={submitting || !leetcodeUsername.trim()}
              onClick={() => void handleStartOnboarding()}
              className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <InlineSpinner className="h-4 w-4" label="Validating LeetCode profile" />
                  Validating...
                </span>
              ) : (
                "Continue"
              )}
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 && challenge ? (
        <section className="rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6">
          <h2 className="text-xl font-semibold text-slate-100">
            {challenge.verification_mode === "soft" ? "Preview and confirm" : "Submit and verify"}
          </h2>
          <p className="mt-2 text-sm text-slate-300">{challenge.instructions}</p>

          {challenge.verification_mode === "soft" ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-slate-700/60 bg-slate-950/70 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">LeetCode Profile Preview</p>
                <div className="mt-3 flex items-center gap-3">
                  {challenge.profile_preview_avatar_url ? (
                    <Image
                      src={challenge.profile_preview_avatar_url}
                      alt={challenge.profile_preview_username}
                      width={40}
                      height={40}
                      className="h-10 w-10 rounded-full border border-slate-600/60 object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-600/60 bg-slate-800 text-xs text-slate-300">
                      LC
                    </div>
                  )}
                  <div>
                    <p className="font-mono text-sm text-slate-100">
                      @{challenge.profile_preview_username}
                    </p>
                    {challenge.profile_preview_url ? (
                      <a
                        href={challenge.profile_preview_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-cyan-200 hover:underline"
                      >
                        Open profile
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>

              <label className="flex items-start gap-3 rounded-lg border border-slate-700/60 bg-slate-950/50 px-3 py-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={confirmOwnership}
                  onChange={(e) => setConfirmOwnership(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-500 bg-slate-950 text-cyan-300 focus:ring-cyan-400"
                />
                <span>I confirm this is my LeetCode profile and I want to lock it.</span>
              </label>
            </div>
          ) : (
            <>
              {challenge.issued_at && challenge.expires_at ? (
                <p className="mt-2 text-xs text-cyan-200">
                  Challenge window: {new Date(challenge.issued_at).toLocaleString()} to{" "}
                  {new Date(challenge.expires_at).toLocaleString()}
                </p>
              ) : null}

              {challenge.problem_slug && challenge.problem_title ? (
                <a
                  href={`https://leetcode.com/problems/${challenge.problem_slug}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex rounded-lg border border-cyan-300/40 px-3 py-2 text-sm text-cyan-200 transition hover:bg-cyan-500/10"
                >
                  Open {challenge.problem_title} on LeetCode
                </a>
              ) : null}

              {challenge.reference_code ? (
                <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-400">
                    Reference Solution (Python)
                  </p>
                  <pre className="mt-2 overflow-x-auto text-xs text-slate-200">
                    <code>{challenge.reference_code}</code>
                  </pre>
                </div>
              ) : null}
            </>
          )}

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-lg border border-slate-500/60 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
            >
              Back
            </button>
            <button
              type="button"
              disabled={verifying || (challenge.verification_mode === "soft" && !confirmOwnership)}
              onClick={() => void handleVerify()}
              className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {verifying ? (
                <span className="inline-flex items-center gap-2">
                  <InlineSpinner className="h-4 w-4" label="Verifying account" />
                  Verifying...
                </span>
              ) : (
                "Verify"
              )}
            </button>
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="rounded-2xl border border-emerald-300/30 bg-emerald-500/10 p-6">
          <h2 className="text-xl font-semibold text-emerald-100">You&apos;re all set</h2>
          <p className="mt-2 text-sm text-emerald-100/90">
            Your LeetCode identity is verified. You can now create and join race rooms.
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-5 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300"
          >
            Go to Home
          </button>
        </section>
      ) : null}
    </main>
  );
}
