import type { ReactNode } from "react";

type Props = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
};

export default function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="empty-state-block">
      {icon ? <div className="empty-state-icon">{icon}</div> : null}
      <p className="empty-state-title">{title}</p>
      {description ? <p className="empty-state-desc">{description}</p> : null}
      {action ? (
        <button className="btn btn-primary" onClick={action.onClick} style={{ marginTop: "0.75rem" }}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
