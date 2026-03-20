import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
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
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "2rem",
          textAlign: "center",
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          color: "#1d1d1f",
          background: "#f5f5f7",
        }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#86868b", maxWidth: 420, marginBottom: "1.5rem" }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.href = "/";
            }}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "980px",
              border: "none",
              background: "#0071e3",
              color: "#fff",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
