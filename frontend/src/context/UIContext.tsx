import { createContext, useContext } from "react";
import type { Notice } from "../types";

export interface UIContextValue {
  notice: Notice;
  setNotice: React.Dispatch<React.SetStateAction<Notice>>;
  busyKey: string;
  setBusyKey: React.Dispatch<React.SetStateAction<string>>;
  withAuthRequest: <T>(
    key: string,
    action: () => Promise<T>,
    successText?: string,
  ) => Promise<T | null>;
  openOperationConfirmDialog: (
    title: string,
    description: string,
    keyword: string,
    action: () => void | Promise<void>,
    onDismiss?: () => void,
  ) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function useUICtx(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUICtx must be used within UIContext.Provider");
  return ctx;
}

export default UIContext;
