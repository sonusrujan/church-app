import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

/**
 * Wraps route content and replays a fade-up entrance on each pathname change.
 * Respects prefers-reduced-motion via the global CSS rule.
 */
export default function RouteTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("route-enter");
    void el.offsetWidth;
    el.classList.add("route-enter");
  }, [location.pathname]);

  return (
    <div ref={ref} className="route-enter" key={location.pathname}>
      {children}
    </div>
  );
}
