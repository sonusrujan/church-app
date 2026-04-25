import { Link, useLocation } from "react-router-dom";
import { Home, LayoutDashboard, CalendarDays, Clock } from "lucide-react";
import { useI18n } from "../i18n";

export default function BottomNav() {
  const location = useLocation();
  const { t } = useI18n();

  const items: Array<{ to: string; icon: typeof Home; label: string }> = [
    { to: "/home", icon: Home, label: t("nav.home") },
    { to: "/dashboard", icon: LayoutDashboard, label: t("nav.dashboard") },
    { to: "/events", icon: CalendarDays, label: t("nav.events") },
    { to: "/history", icon: Clock, label: t("nav.history") },
  ];

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {items.map((item) => {
        const active = location.pathname === item.to || location.pathname.startsWith(item.to + "/");
        const Icon = item.icon;
        return (
          <Link key={item.to} to={item.to} className={`bottom-nav-item${active ? " bottom-nav-active" : ""}`}>
            <Icon size={22} strokeWidth={active ? 2 : 1.5} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
