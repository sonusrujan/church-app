import { Link, useLocation } from "react-router-dom";
import { Home, LayoutDashboard, CalendarDays, Clock, HandHeart, Shield } from "lucide-react";
import { useI18n } from "../i18n";
import NotificationBadge from "./NotificationBadge";

interface BottomNavProps {
  isSuperAdmin: boolean;
  isAdminUser: boolean;
  paymentsEnabled: boolean;
  duesCount: number;
  adminPendingCount: number;
}

export default function BottomNav({
  isSuperAdmin,
  isAdminUser,
  paymentsEnabled,
  duesCount,
  adminPendingCount,
}: BottomNavProps) {
  const location = useLocation();
  const { t } = useI18n();

  type Item = { to: string; icon: typeof Home; label: string; badge?: number };
  const items: Item[] = [
    { to: "/home", icon: Home, label: t("nav.home") },
    { to: "/dashboard", icon: LayoutDashboard, label: t("nav.dashboard"), badge: duesCount },
  ];
  if (!isSuperAdmin) {
    items.push({ to: "/history", icon: Clock, label: t("nav.history") });
  }
  items.push({ to: "/events", icon: CalendarDays, label: t("nav.events") });
  if (paymentsEnabled) {
    items.push({ to: "/donate", icon: HandHeart, label: t("nav.donate") });
  }
  if (isAdminUser) {
    items.push({
      to: "/admin-tools",
      icon: Shield,
      label: isSuperAdmin ? t("nav.superAdminConsole") : t("nav.adminTools"),
      badge: adminPendingCount,
    });
  }

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {items.map((item) => {
        const active =
          location.pathname === item.to || location.pathname.startsWith(item.to + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`bottom-nav-item${active ? " bottom-nav-active" : ""}`}
            aria-label={item.badge ? `${item.label} (${item.badge})` : item.label}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={22} strokeWidth={active ? 2.25 : 1.6} aria-hidden="true" />
            <span>{item.label}</span>
            {item.badge ? <NotificationBadge count={item.badge} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
