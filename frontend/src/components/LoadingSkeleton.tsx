interface SkeletonProps {
  lines?: number;
  className?: string;
}

/** Pulsing placeholder rows for content that is loading */
export default function LoadingSkeleton({ lines = 3, className = "" }: SkeletonProps) {
  return (
    <div className={`skeleton-container ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="skeleton-line"
          style={{ width: `${75 + Math.round(((i * 37) % 25))}%` }}
        />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card" role="status" aria-label="Loading">
      <div className="skeleton-line" style={{ width: "60%", height: "1rem" }} />
      <div className="skeleton-line" style={{ width: "90%" }} />
      <div className="skeleton-line" style={{ width: "40%" }} />
    </div>
  );
}
