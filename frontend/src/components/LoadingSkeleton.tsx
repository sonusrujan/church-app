interface SkeletonProps {
  lines?: number;
  className?: string;
}

export default function LoadingSkeleton({ lines = 3, className = "" }: SkeletonProps) {
  return (
    <div className={`skeleton-container ${className}`} role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="skeleton-line"
          style={{ width: `${75 + ((i * 37) % 25)}%` }}
        />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card" role="status" aria-live="polite" aria-label="Loading">
      <div className="skeleton-line" style={{ width: "60%", height: "1rem" }} />
      <div className="skeleton-line" style={{ width: "90%" }} />
      <div className="skeleton-line" style={{ width: "40%" }} />
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="skeleton-stat-grid" role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-stat-card">
          <div className="skeleton-line" style={{ width: "55%", height: "0.65rem" }} />
          <div className="skeleton-line" style={{ width: "45%", height: "1.5rem" }} />
          <div className="skeleton-line" style={{ width: "80%", height: "0.6rem" }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({ rows = 4, withAvatar = false }: { rows?: number; withAvatar?: boolean }) {
  return (
    <div className="skeleton-list" role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-list-row">
          {withAvatar ? <div className="skeleton-circle" style={{ width: 36, height: 36 }} /> : null}
          <div className="skeleton-text">
            <div className="skeleton-line" style={{ width: `${60 + ((i * 11) % 30)}%`, height: "0.8rem" }} />
            <div className="skeleton-line" style={{ width: `${40 + ((i * 17) % 25)}%`, height: "0.65rem" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="skeleton-list" role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="skeleton-list-row" style={{ gap: "1rem" }}>
          {Array.from({ length: cols }, (_, c) => (
            <div
              key={c}
              className="skeleton-rect"
              style={{ flex: c === 0 ? 2 : 1, height: "0.75rem" }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
