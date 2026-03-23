"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { ApiError, startOnboarding, verifyOnboarding } from "@/lib/api";
import type { OnboardingStartResponse } from "@/lib/types";

function parseApiError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Please try again.";
}

const STEP_TITLES = [
  "Welcome",
  "LeetCode ID",
  "Submit Solution",
  "Complete",
] as const;

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me?.primary_leetcode_username) {
      setLeetcodeUsername(me.primary_leetcode_username);
    }
  }, [me?.primary_leetcode_username]);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accessToken) return;

    if (!me?.onboarding_required) {
      router.replace("/");
    }
  }, [accessToken, authLoading, me?.onboarding_required, profileLoading, router, user]);

  const stepProgress = useMemo(() => (step / STEP_TITLES.length) * 100, [step]);

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
      await verifyOnboarding(accessToken);
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
    try {
      await signInWithGoogle();
    } catch {
      setError("Unable to start Google sign in. Please try again.");
    }
  }

  if (authLoading || profileLoading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8">
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 text-slate-200">
          Preparing getting started...
        </div>
      </main>
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
            className="mt-4 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300"
          >
            Sign in with Google
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
          You&apos;ll verify your LeetCode identity once. After verification, this ID cannot be changed
          from the app.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-700/50 bg-slate-900/70 p-5">
        <div className="mb-3 flex items-center justify-between text-xs text-slate-300">
          <span>
            Step {step} / {STEP_TITLES.length}
          </span>
          <span>{STEP_TITLES[step - 1]}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-800">
          <div
            className="h-2 rounded-full bg-cyan-400 transition-all"
            style={{ width: `${stepProgress}%` }}
          />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
          {STEP_TITLES.map((label, idx) => (
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
            Before joining rooms, verify your LeetCode identity through a quick one-time challenge.
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
            This username must be valid and cannot be changed after verification.
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
              {submitting ? "Validating..." : "Continue"}
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 && challenge ? (
        <section className="rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6">
          <h2 className="text-xl font-semibold text-slate-100">Submit and verify</h2>
          <p className="mt-2 text-sm text-slate-300">{challenge.instructions}</p>
          <p className="mt-2 text-xs text-cyan-200">
            Challenge window: {new Date(challenge.issued_at).toLocaleString()} to{" "}
            {new Date(challenge.expires_at).toLocaleString()}
          </p>

          <a
            href={`https://leetcode.com/problems/${challenge.problem_slug}/`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex rounded-lg border border-cyan-300/40 px-3 py-2 text-sm text-cyan-200 transition hover:bg-cyan-500/10"
          >
            Open {challenge.problem_title} on LeetCode
          </a>

          <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Reference Solution (Python)</p>
            <pre className="mt-2 overflow-x-auto text-xs text-slate-200">
              <code>{challenge.reference_code}</code>
            </pre>
          </div>

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
              disabled={verifying}
              onClick={() => void handleVerify()}
              className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {verifying ? "Verifying..." : "Verify"}
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
