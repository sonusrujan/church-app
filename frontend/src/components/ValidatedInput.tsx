import { useState, useCallback } from "react";
import { isValidEmail, isValidIndianPhone, stripIndianPrefix, normalizeIndianPhone } from "../types";
import { useI18n } from "../i18n";

type ValidationType = "phone" | "email";

interface ValidatedInputProps {
  type: ValidationType;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  label?: string;
}

function validate(type: ValidationType, value: string, t: (key: string) => string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (type === "phone") {
    const normalized = normalizeIndianPhone(trimmed);
    if (!isValidIndianPhone(normalized)) return t("validation.errorInvalidIndianPhone");
  }
  if (type === "email" && !isValidEmail(trimmed)) {
    return t("validation.errorInvalidEmail");
  }
  return "";
}

export default function ValidatedInput({ type, value, onChange, placeholder, label }: ValidatedInputProps) {
  const [warning, setWarning] = useState("");
  const [touched, setTouched] = useState(false);
  const { t } = useI18n();

  // For phone type, strip +91 prefix so only bare digits are shown in input
  const displayValue = type === "phone" ? stripIndianPrefix(value) : value;

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value;
    if (type === "phone") {
      // Only allow digits
      v = v.replace(/\D/g, "").slice(0, 10);
    }
    onChange(v);
    if (touched) setWarning(validate(type, v, t));
  }, [onChange, type, touched, t]);

  const handleBlur = useCallback(() => {
    setTouched(true);
    setWarning(validate(type, type === "phone" ? stripIndianPrefix(value) : value, t));
  }, [type, value, t]);

  const inputType = type === "phone" ? "tel" : "email";

  if (type === "phone") {
    return (
      <label>
        {label}
        <div style={{ display: "flex", alignItems: "stretch" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", padding: "0 0.75rem",
            background: "var(--surface-container)", borderRadius: "var(--radius-md) 0 0 var(--radius-md)",
            border: "1px solid rgba(220,208,255,0.30)", borderRight: "none",
            fontWeight: 600, fontSize: "0.9375rem", color: "var(--on-surface)", whiteSpace: "nowrap",
            userSelect: "none",
          }}>+91</span>
          <input
            type="tel"
            inputMode="numeric"
            value={displayValue}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder={placeholder || "9876543210"}
            maxLength={10}
            style={{ borderRadius: "0 var(--radius-md) var(--radius-md) 0" }}
          />
        </div>
        {warning && <span className="field-error">{warning}</span>}
      </label>
    );
  }

  return (
    <label>
      {label}
      <input
        type={inputType}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
      />
      {warning && <span className="field-error">{warning}</span>}
    </label>
  );
}

/** Standalone validation check — returns error message or empty string */
export function validatePhone(value: string, t?: (key: string) => string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = normalizeIndianPhone(trimmed);
  const msg = t ? t("validation.errorInvalidIndianPhone") : "Enter a valid 10-digit Indian mobile number";
  return isValidIndianPhone(normalized) ? "" : msg;
}

export function validateEmail(value: string, t?: (key: string) => string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const msg = t ? t("validation.errorInvalidEmail") : "Invalid email address";
  return isValidEmail(trimmed) ? "" : msg;
}
