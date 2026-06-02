import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <main className="auth-layout" style={{ justifyContent: "center" }}>
          <article className="auth-card" style={{ textAlign: "center", maxWidth: "500px" }}>
            <h3 className="form-error" style={{ color: "#ef4444" }}>Something went wrong</h3>
            <p style={{ margin: "1rem 0" }}>An unexpected error occurred in the application.</p>
            <pre style={{
              textAlign: "left",
              background: "rgba(0,0,0,0.3)",
              padding: "0.75rem",
              borderRadius: "4px",
              fontSize: "0.85rem",
              overflowX: "auto",
              marginBottom: "1.5rem",
              color: "#f87171"
            }}>
              {this.state.error?.message}
            </pre>
            <button
              className="primary full"
              onClick={() => window.location.reload()}
            >
              Reload Application
            </button>
          </article>
        </main>
      );
    }

    return this.props.children;
  }
}
