/**
 * Reusable notification badge — shows a red dot/count pill.
 * - Shows nothing when count = 0
 * - Shows red dot when dot=true and count > 0
 * - Shows numeric count, capped at "99+"
 * - Subtle pop-in animation on mount
 */
interface NotificationBadgeProps {
  count: number;
  /** Show dot-only instead of number */
  dot?: boolean;
  /** Max count before showing "N+" (default 99) */
  max?: number;
  /** Extra class name */
  className?: string;
}

export default function NotificationBadge({ count, dot, max = 99, className }: NotificationBadgeProps) {
  if (!count || count <= 0) return null;

  const label = dot ? "" : count > max ? `${max}+` : String(count);

  return (
    <span
      className={`notif-badge${dot ? " notif-badge-dot" : ""}${className ? ` ${className}` : ""}`}
      aria-label={`${count} pending`}
      role="status"
    >
      {label}
    </span>
  );
}
