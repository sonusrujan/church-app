import { createContext, useContext } from "react";
import type { AuthContextData } from "../types";

export interface AuthContextValue {
  token: string;
  userEmail: string;
  userPhone: string;
  authContext: AuthContextData | null;
  setAuthContext: React.Dispatch<React.SetStateAction<AuthContextData | null>>;
  isSuperAdmin: boolean;
  isAdminUser: boolean;
  isChurchAdmin: boolean;
  isMemberOnlyUser: boolean;
  loadContext: () => Promise<AuthContextData | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthCtx(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthCtx must be used within AuthContext.Provider");
  return ctx;
}

export default AuthContext;
