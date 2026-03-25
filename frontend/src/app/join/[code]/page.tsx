"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { useAuth } from "@/components/auth-provider";
import { InlineSpinner, PageLoader, SkeletonBlock } from "@/components/loading";
import { ApiError, getRoomState, joinRoom } from "@/lib/api";
import { requiresOnboarding } from "@/lib/onboarding";
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

    if (requiresOnboarding(me)) {
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

        if (!state.room.has_passcode) {
          const joined = await joinRoom(roomCode, {}, accessToken);
          if (joined.room.status === "active") {
            router.replace(`/room/${roomCode}`);
            return;
          }
          if (joined.room.status === "ended") {
            router.replace(`/room/${roomCode}/history`);
            return;
          }
          router.replace(`/room/${roomCode}/lobby`);
          return;
        }

        savePendingJoinRoomCode(roomCode);
        router.replace("/");
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 404) {
            savePendingJoinError(`Room ${roomCode} was not found.`);
            savePendingJoinRoomCode(roomCode);
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
    me,
    profileLoading,
    roomCode,
    router,
    signInWithGoogle,
    user,
  ]);

  return (
    <PageLoader
      title="Opening room..."
      subtitle="Resolving your shared invite and checking the best destination."
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-cyan-300/25 bg-cyan-500/10 p-4">
          <div className="inline-flex items-center gap-2 text-sm text-cyan-100">
            <InlineSpinner className="h-4 w-4" label="Resolving room link" />
            Resolving shared room link...
          </div>
          <SkeletonBlock className="mt-3 h-3 w-2/3" />
        </div>
        <Link
          href="/"
          className="inline-flex rounded-lg border border-cyan-300/40 px-3 py-2 text-sm text-cyan-100 transition hover:bg-cyan-500/10"
        >
          Back to Home
        </Link>
      </div>
    </PageLoader>
  );
}
