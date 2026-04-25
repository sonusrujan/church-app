import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  goHome = () => {
    window.location.href = "/home";
  };

  render() {
    if (this.state.hasError) {
      return (
        <section className="error-boundary-shell" role="alert" aria-live="assertive">
          <article className="panel error-boundary-panel fade-up">
            <div className="icon-circle icon-circle-lg icon-circle-danger" aria-hidden="true" style={{ margin: "0 auto 1rem" }}>
              <AlertTriangle size={28} strokeWidth={2} />
            </div>
            <h2 style={{ textAlign: "center", margin: 0 }}>Something went wrong</h2>
            <p className="muted error-boundary-msg" style={{ textAlign: "center", marginTop: "0.5rem" }}>
              {this.state.error?.message || "An unexpected error occurred. Please try again."}
            </p>
            <div className="actions-row" style={{ justifyContent: "center", marginTop: "1.25rem" }}>
              <button className="btn" onClick={this.goHome}>
                <Home size={16} /> Home
              </button>
              <button className="btn btn-primary" onClick={this.reset}>
                <RotateCcw size={16} /> Reload
              </button>
            </div>
          </article>
        </section>
      );
    }
    return this.props.children;
  }
}
