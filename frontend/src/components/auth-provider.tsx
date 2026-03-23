"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import { ApiError, getMe } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { MeResponse } from "@/lib/types";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  accessToken: string | null;
  me: MeResponse | null;
  authLoading: boolean;
  profileLoading: boolean;
  refreshMe: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type AuthProviderProps = {
  children: ReactNode;
};

function isInvalidRefreshTokenMessage(message: string | undefined) {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("invalid refresh token") ||
    normalized.includes("refresh token not found")
  );
}

function resolveOAuthRedirectUrl() {
  if (typeof window === "undefined") return undefined;
  const { hostname, origin } = window.location;
  const isLocalLikeHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost");
  if (isLocalLikeHost) {
    return "http://localhost:3000/getting-started";
  }
  return `${origin}/getting-started`;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);

  const accessToken = session?.access_token ?? null;

  const refreshMe = useCallback(async () => {
    if (!accessToken) {
      setMe(null);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    try {
      const profile = await getMe(accessToken);
      setMe(profile);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setMe(null);
      }
      setMe(null);
    } finally {
      setProfileLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    let mounted = true;

    async function bootstrapAuth() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mounted) return;

        if (error) {
          if (isInvalidRefreshTokenMessage(error.message)) {
            await supabase.auth.signOut({ scope: "local" });
          }
          setSession(null);
          setAuthLoading(false);
          setProfileLoading(false);
          return;
        }

        setSession(data.session ?? null);
      } catch {
        if (!mounted) return;
        setSession(null);
      } finally {
        if (!mounted) return;
        setAuthLoading(false);
      }
    }

    void bootstrapAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        setMe(null);
        setProfileLoading(false);
      }
      setSession(nextSession ?? null);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = resolveOAuthRedirectUrl();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      accessToken,
      me,
      authLoading,
      profileLoading,
      refreshMe,
      signInWithGoogle,
      signOut,
    }),
    [accessToken, authLoading, me, profileLoading, refreshMe, session, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
