import { createContext, useContext } from "react";
import type {
  AuthContextData,
  MemberDashboard,
  Notice,
  ChurchRow,
  AdminRow,
  PastorRow,
  EventRow,
  NotificationRow,
  IncomeSummary,
} from "../types";

// M-3: Re-export sub-context hooks for targeted subscriptions (fewer re-renders)
export { useAuthCtx } from "./AuthContext";
export { useUICtx } from "./UIContext";
export { useDataCtx } from "./DataContext";

export interface AppContextValue {
  // Auth
  token: string;
  userEmail: string;
  userPhone: string;
  authContext: AuthContextData | null;
  setAuthContext: React.Dispatch<React.SetStateAction<AuthContextData | null>>;
  isSuperAdmin: boolean;
  isAdminUser: boolean;
  isChurchAdmin: boolean;
  isMemberOnlyUser: boolean;

  // UI
  notice: Notice;
  setNotice: React.Dispatch<React.SetStateAction<Notice>>;
  busyKey: string;
  setBusyKey: React.Dispatch<React.SetStateAction<string>>;
  withAuthRequest: <T>(
    key: string,
    action: () => Promise<T>,
    successText?: string,
  ) => Promise<T | null>;

  // Shared data
  memberDashboard: MemberDashboard | null;
  setMemberDashboard: React.Dispatch<React.SetStateAction<MemberDashboard | null>>;
  refreshMemberDashboard: (silent?: boolean) => Promise<MemberDashboard | null>;
  churches: ChurchRow[];
  admins: AdminRow[];
  pastors: PastorRow[];
  setPastors: React.Dispatch<React.SetStateAction<PastorRow[]>>;
  events: EventRow[];
  notifications: NotificationRow[];
  incomeSummary: IncomeSummary | null;

  // Loaders
  loadChurches: () => Promise<void>;
  loadAdmins: () => Promise<void>;
  loadPastors: (overrideChurchId?: string) => Promise<void>;
  loadEventsAndNotifications: () => Promise<void>;
  loadIncomeSummary: (overrideChurchId?: string) => Promise<void>;
  loadContext: () => Promise<AuthContextData | null>;

  // Admin badge counts
  adminCounts: {
    membership_requests: number;
    family_requests: number;
    cancellation_requests: number;
    account_deletion_requests: number;
    refund_requests: number;
    prayer_requests: number;
    events: number;
    notifications: number;
  } | null;
  refreshAdminCounts: () => Promise<void>;

  // Payments
  paymentsEnabled: boolean;
  paymentConfigError: string;
  paymentInProgressRef: React.MutableRefObject<boolean>;

  // Confirm dialog
  openOperationConfirmDialog: (
    title: string,
    description: string,
    keyword: string,
    action: () => void | Promise<void>,
    onDismiss?: () => void,
  ) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Backward-compatible hook that combines Auth + UI + Data contexts.
 *  Prefer useAuthCtx / useUICtx / useDataCtx for fewer re-renders. */
export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppContext.Provider");
  return ctx;
}

export default AppContext;
