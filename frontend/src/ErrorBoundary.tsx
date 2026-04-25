import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const fallbackStrings: Record<string, { title: string; fallback: string; reload: string }> = {
  en: { title: "Something went wrong", fallback: "An unexpected error occurred.", reload: "Reload App" },
  hi: { title: "कुछ गलत हो गया", fallback: "एक अप्रत्याशित त्रुटि हुई।", reload: "ऐप पुनः लोड करें" },
  ta: { title: "ஏதோ தவறு ஏற்பட்டது", fallback: "எதிர்பாராத பிழை ஏற்பட்டது.", reload: "செயலியை மீளேற்றவும்" },
  te: { title: "ఏదో తప్పు జరిగింది", fallback: "ఊహించని లోపం సంభవించింది.", reload: "యాప్ రీలోడ్ చేయండి" },
  ml: { title: "എന്തോ കുഴപ്പം സംഭവിച്ചു", fallback: "ഒരു അപ്രതീക്ഷിത പിശക് സംഭവിച്ചു.", reload: "ആപ്പ് റീലോഡ് ചെയ്യുക" },
  kn: { title: "ಏನೋ ತಪ್ಪಾಗಿದೆ", fallback: "ಅನಿರೀಕ್ಷಿತ ದೋಷ ಸಂಭವಿಸಿದೆ.", reload: "ಆಪ್ ಮರುಲೋಡ್ ಮಾಡಿ" },
};

function getStrings() {
  const lang = typeof localStorage !== "undefined" ? localStorage.getItem("shalom_language") : null;
  return fallbackStrings[lang || "en"] || fallbackStrings.en;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
    import("./sentry").then(({ Sentry }) => Sentry.captureException(error, { extra: { componentStack: info.componentStack } })).catch(() => { /* sentry not init */ });
  }

  render() {
    if (this.state.hasError) {
      const s = getStrings();
      return (
        <div className="error-boundary-root" role="alert">
          <h1>{s.title}</h1>
          <p>
            {this.state.error?.message || s.fallback}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.href = "/";
            }}
            className="error-boundary-root-btn"
          >
            {s.reload}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
