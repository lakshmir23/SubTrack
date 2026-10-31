import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SessionResponse } from "../shared/contracts";
import { errorMessage, request, setCsrfToken } from "./api";

interface SessionContextValue extends SessionResponse {
  loading: boolean;
  error: string;
  expired: boolean;
  connectionWarning: string;
  accept: (session: SessionResponse) => void;
  refresh: () => Promise<void>;
}
const SessionContext = createContext<SessionContextValue | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionResponse>({
    user: null,
    csrfToken: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [connectionWarning, setConnectionWarning] = useState("");
  const initialized = useRef(false);
  const currentSession = useRef(session);
  const accept = useCallback((value: SessionResponse) => {
    setCsrfToken(value.csrfToken);
    setSession(value);
    currentSession.current = value;
    setExpired(false);
    setError("");
    setConnectionWarning("");
  }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await request<SessionResponse>("/api/session");
      if (initialized.current && currentSession.current.user && !next.user)
        setExpired(true);
      else accept(next);
      setConnectionWarning("");
    } catch (reason) {
      if (initialized.current) setConnectionWarning(errorMessage(reason));
      else setError(errorMessage(reason));
    } finally {
      initialized.current = true;
      setLoading(false);
    }
  }, [accept]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const handleExpiry = () => setExpired(true);
    const focus = () => {
      void refresh();
    };
    window.addEventListener("subtrack:session-expired", handleExpiry);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("subtrack:session-expired", handleExpiry);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  return (
    <SessionContext.Provider
      value={{
        ...session,
        loading,
        error,
        expired,
        connectionWarning,
        accept,
        refresh,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider is required.");
  return value;
}
