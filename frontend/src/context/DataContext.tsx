import { createContext, useContext } from "react";
import type {
  MemberDashboard,
  ChurchRow,
  AdminRow,
  PastorRow,
  EventRow,
  NotificationRow,
  IncomeSummary,
} from "../types";

export interface DataContextValue {
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
  loadChurches: () => Promise<void>;
  loadAdmins: () => Promise<void>;
  loadPastors: (overrideChurchId?: string) => Promise<void>;
  loadEventsAndNotifications: () => Promise<void>;
  loadIncomeSummary: (overrideChurchId?: string) => Promise<void>;
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
  paymentsEnabled: boolean;
  paymentConfigError: string;
  paymentInProgressRef: React.MutableRefObject<boolean>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function useDataCtx(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useDataCtx must be used within DataContext.Provider");
  return ctx;
}

export default DataContext;
