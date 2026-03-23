"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useAuth } from "@/components/auth-provider";
import { ApiError, getRoomState } from "@/lib/api";
import {
  savePendingJoinError,
  savePendingJoinRoomCode,
} from "@/lib/auth-intent";

export default function JoinResolverPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const roomCode = (params.code || "").trim().toUpperCase();
  const { accessToken, authLoading, me, profileLoading, signInWithGoogle, user } = useAuth();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!roomCode) {
      savePendingJoinError("Invalid room link.");
      router.replace("/");
      return;
    }
    if (authLoading || profileLoading) return;
    if (startedRef.current) return;

    if (!user || !accessToken) {
      startedRef.current = true;
      savePendingJoinRoomCode(roomCode);
      void signInWithGoogle().catch(() => {
        savePendingJoinError("Unable to start sign in. Please try again.");
        router.replace("/");
      });
      return;
    }

    if (me?.onboarding_required) {
      startedRef.current = true;
      savePendingJoinRoomCode(roomCode);
      router.replace("/getting-started");
      return;
    }

    startedRef.current = true;
    void (async () => {
      try {
        const state = await getRoomState(roomCode, accessToken);
        if (state.my_participant_id) {
          if (state.room.status === "active") {
            router.replace(`/room/${roomCode}`);
            return;
          }
          if (state.room.status === "ended") {
            router.replace(`/room/${roomCode}/history`);
            return;
          }
          router.replace(`/room/${roomCode}/lobby`);
          return;
        }

        if (state.room.status === "ended") {
          router.replace(`/room/${roomCode}/history`);
          return;
        }

        savePendingJoinRoomCode(roomCode);
        router.replace("/");
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 404) {
            savePendingJoinError(`Room ${roomCode} was not found.`);
          } else {
            savePendingJoinError(error.message);
            savePendingJoinRoomCode(roomCode);
          }
        } else {
          savePendingJoinError("Unable to open shared room link right now.");
          savePendingJoinRoomCode(roomCode);
        }
        router.replace("/");
      }
    })();
  }, [
    accessToken,
    authLoading,
    me?.onboarding_required,
    profileLoading,
    roomCode,
    router,
    signInWithGoogle,
    user,
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8">
      <div className="rounded-2xl border border-cyan-300/30 bg-cyan-500/10 p-6">
        <h1 className="text-xl font-semibold text-cyan-100">Opening Room</h1>
        <p className="mt-2 text-sm text-cyan-100/90">Resolving shared room link...</p>
        <Link
          href="/"
          className="mt-4 inline-flex rounded-lg border border-cyan-300/40 px-3 py-2 text-sm text-cyan-100 transition hover:bg-cyan-500/10"
        >
          Back to Home
        </Link>
      </div>
    </main>
  );
}
