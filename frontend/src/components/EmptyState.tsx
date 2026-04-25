import type { ReactNode } from "react";

type Props = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  compact?: boolean;
};

export default function EmptyState({ icon, title, description, action, secondaryAction, compact }: Props) {
  return (
    <div className={`empty-state-block${compact ? " empty-state-compact" : ""}`} role="status">
      {icon ? <div className="empty-state-icon" aria-hidden="true">{icon}</div> : null}
      <p className="empty-state-title">{title}</p>
      {description ? <p className="empty-state-desc">{description}</p> : null}
      {(action || secondaryAction) ? (
        <div className="actions-row" style={{ justifyContent: "center", marginTop: "1rem" }}>
          {action ? (
            <button type="button" className="btn btn-primary" onClick={action.onClick}>
              {action.label}
            </button>
          ) : null}
          {secondaryAction ? (
            <button type="button" className="btn" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
