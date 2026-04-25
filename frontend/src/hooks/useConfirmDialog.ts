import { useCallback, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { Notice } from "../types";

export function useConfirmDialog(
  busyKey: string,
  setBusyKey: React.Dispatch<React.SetStateAction<string>>,
  setNotice: React.Dispatch<React.SetStateAction<Notice>>,
) {
  const { t } = useI18n();

  const [showOperationConfirmModal, setShowOperationConfirmModal] = useState(false);
  const [operationConfirmTitle, setOperationConfirmTitle] = useState("");
  const [operationConfirmDescription, setOperationConfirmDescription] = useState("");
  const [operationConfirmKeyword, setOperationConfirmKeyword] = useState("CONFIRM");
  const [operationConfirmChecked, setOperationConfirmChecked] = useState(false);
  const [, setOperationConfirmInput] = useState("");
  const operationConfirmActionRef = useRef<null | (() => void | Promise<void>)>(null);
  const operationConfirmDismissRef = useRef<null | (() => void)>(null);

  const openOperationConfirmDialog = useCallback(
    (title: string, description: string, keyword: string, action: () => void | Promise<void>, onDismiss?: () => void) => {
      operationConfirmActionRef.current = action;
      operationConfirmDismissRef.current = onDismiss || null;
      setOperationConfirmTitle(title);
      setOperationConfirmDescription(description);
      setOperationConfirmKeyword(keyword.trim().toUpperCase() || "CONFIRM");
      setOperationConfirmChecked(false);
      setOperationConfirmInput("");
      setShowOperationConfirmModal(true);
    },
    [],
  );

  function closeOperationConfirmDialog() {
    if (busyKey === "operation-confirm") return;
    const dismissCb = operationConfirmDismissRef.current;
    operationConfirmActionRef.current = null;
    operationConfirmDismissRef.current = null;
    if (dismissCb) dismissCb();
    setShowOperationConfirmModal(false);
    setOperationConfirmTitle("");
    setOperationConfirmDescription("");
    setOperationConfirmKeyword("CONFIRM");
    setOperationConfirmChecked(false);
    setOperationConfirmInput("");
  }

  async function executeOperationConfirmDialog() {
    if (!operationConfirmActionRef.current) return;
    const isDestructive = ["DELETE", "REMOVE", "REVOKE", "TRANSFER"].includes(operationConfirmKeyword);
    if (isDestructive && !operationConfirmChecked) {
      setNotice({ tone: "error", text: t("auth.confirmCheckboxRequired") });
      return;
    }
    setBusyKey("operation-confirm");
    const action = operationConfirmActionRef.current;
    operationConfirmActionRef.current = null;
    operationConfirmDismissRef.current = null;
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("common.operationFailed");
      setNotice({ tone: "error", text: message });
    } finally {
      setBusyKey("");
      setShowOperationConfirmModal(false);
      setOperationConfirmTitle("");
      setOperationConfirmDescription("");
      setOperationConfirmKeyword("CONFIRM");
      setOperationConfirmChecked(false);
      setOperationConfirmInput("");
    }
  }

  return {
    showOperationConfirmModal,
    operationConfirmTitle,
    operationConfirmDescription,
    operationConfirmKeyword,
    operationConfirmChecked,
    setOperationConfirmChecked,
    openOperationConfirmDialog,
    closeOperationConfirmDialog,
    executeOperationConfirmDialog,
  };
}
