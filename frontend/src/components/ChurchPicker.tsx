import { Church, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { UserChurch } from "../hooks/useAuth";
import { useI18n } from "../i18n";

interface ChurchPickerProps {
  churches: UserChurch[];
  onSelect: (churchId: string) => void;
}

const SEARCH_THRESHOLD = 6;

export default function ChurchPicker({ churches, onSelect }: ChurchPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return churches;
    return churches.filter((c) =>
      (c.church_name || "").toLowerCase().includes(q) ||
      (c.role || "").toLowerCase().includes(q),
    );
  }, [churches, query]);

  const showSearch = churches.length >= SEARCH_THRESHOLD;

  return (
    <div className="church-picker-overlay">
      <div className="church-picker-card">
        <Church size={36} strokeWidth={1.5} className="church-picker-icon" />
        <h2 className="church-picker-title">{t("churchPicker.title")}</h2>
        <p className="church-picker-subtitle">{t("churchPicker.subtitle")}</p>
        {showSearch ? (
          <label className="church-picker-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("churchPicker.searchPlaceholder")}
              aria-label={t("churchPicker.searchPlaceholder")}
              autoFocus
            />
          </label>
        ) : null}
        <div className="church-picker-list">
          {filtered.length === 0 ? (
            <p className="church-picker-empty">{t("churchPicker.noMatches")}</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.church_id}
                className="church-picker-item"
                onClick={() => onSelect(c.church_id)}
              >
                <span className="church-picker-item-name">{c.church_name || t("churchPicker.unnamedChurch")}</span>
                <span className="church-picker-item-role">{c.role === "admin" ? t("churchPicker.admin") : t("churchPicker.member")}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
