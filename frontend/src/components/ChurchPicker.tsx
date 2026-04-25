import { Church } from "lucide-react";
import type { UserChurch } from "../hooks/useAuth";
import { useI18n } from "../i18n";

interface ChurchPickerProps {
  churches: UserChurch[];
  onSelect: (churchId: string) => void;
}

export default function ChurchPicker({ churches, onSelect }: ChurchPickerProps) {
  const { t } = useI18n();
  return (
    <div className="church-picker-overlay">
      <div className="church-picker-card">
        <Church size={36} strokeWidth={1.5} className="church-picker-icon" />
        <h2 className="church-picker-title">{t("churchPicker.title")}</h2>
        <p className="church-picker-subtitle">{t("churchPicker.subtitle")}</p>
        <div className="church-picker-list">
          {churches.map((c) => (
            <button
              key={c.church_id}
              className="church-picker-item"
              onClick={() => onSelect(c.church_id)}
            >
              <span className="church-picker-item-name">{c.church_name || t("churchPicker.unnamedChurch")}</span>
              <span className="church-picker-item-role">{c.role === "admin" ? t("churchPicker.admin") : t("churchPicker.member")}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
