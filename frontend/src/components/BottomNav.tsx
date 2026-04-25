import { Link, useLocation } from "react-router-dom";
import { Home, LayoutDashboard, HandHeart, CalendarDays, UserRound } from "lucide-react";
import { useI18n } from "../i18n";

export default function BottomNav({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const location = useLocation();
  const { t } = useI18n();

  const items = [
    { to: "/home", icon: Home, label: t("nav.home") },
    { to: "/dashboard", icon: LayoutDashboard, label: t("nav.dashboard") },
    { to: "/donate", icon: HandHeart, label: t("nav.donate") },
    { to: "/events", icon: CalendarDays, label: t("nav.events") },
    { to: "/profile", icon: UserRound, label: t("nav.profile") },
  ];

  // Super admins don't have a profile page, replace with settings
  if (isSuperAdmin) {
    items[4] = { to: "/settings", icon: UserRound, label: t("nav.settings") };
  }

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {items.map((item) => {
        const active = location.pathname === item.to;
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
