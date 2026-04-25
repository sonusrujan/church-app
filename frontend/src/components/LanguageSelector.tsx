import { useState } from "react";
import { LANGUAGES, useI18n, type SupportedLanguage } from "../i18n";

export default function LanguageSelector() {
  const { language, setLanguage, t, markLanguageChosen } = useI18n();
  const [selected, setSelected] = useState<SupportedLanguage>(language);

  const handleContinue = () => {
    setLanguage(selected);
    markLanguageChosen();
  };

  return (
    <section className="auth-shell">
      <section className="auth-card lang-selector-card">
        <h1 className="lang-selector-title">🌐 {t("language.selectLanguage")}</h1>
        <p className="lang-selector-subtitle">
          {t("language.chooseLanguage")}
        </p>

        <div className="lang-selector-list">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => setSelected(lang.code)}
              className={`btn lang-selector-btn ${selected === lang.code ? "btn-primary lang-selector-btn--active" : ""}`}
            >
              <span>{lang.nativeLabel}</span>
              <span className="lang-selector-btn-label">{lang.label}</span>
            </button>
          ))}
        </div>

        <button
          className="btn btn-primary lang-selector-continue"
          onClick={handleContinue}
        >
          {t("language.continue")}
        </button>
      </section>
    </section>
  );
}
