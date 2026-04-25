import { SkeletonStats, SkeletonList } from "./LoadingSkeleton";

export default function PageLoader() {
  return (
    <div className="route-enter" style={{ padding: "1rem 0" }}>
      <div className="skeleton-line" style={{ width: "40%", height: "1.5rem", marginBottom: "1.25rem" }} />
      <SkeletonStats count={4} />
      <div style={{ height: "1.25rem" }} />
      <SkeletonList rows={5} />
    </div>
  );
}

export function AuthPageLoader() {
  return (
    <section className="auth-shell" aria-busy="true" aria-live="polite">
      <section className="auth-card">
        <div className="skeleton-line" style={{ width: "60%", height: "1.75rem", marginBottom: "1rem" }} />
        <div className="skeleton-line" style={{ width: "80%", height: "0.9rem" }} />
        <div className="skeleton-line" style={{ width: "70%", height: "0.9rem", marginTop: "0.4rem" }} />
        <div style={{ height: "1.5rem" }} />
        <div className="skeleton-rect" style={{ width: "100%", height: "2.75rem", borderRadius: 999 }} />
      </section>
    </section>
  );
}
