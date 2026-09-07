"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /**
   * A node, or a function of the caught error.
   *
   * The function form exists because this replaced the router's
   * `errorComponent`, which was handed the error. Keeping the plain-node form
   * means HomeClient's existing usages did not have to change.
   */
  fallback?: ReactNode | ((error: Error) => ReactNode);
}

interface State {
  /** The error itself rather than a boolean, so the fallback can render it. */
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary caught:", error);
  }

  render() {
    const { error } = this.state;
    if (error) {
      const { fallback } = this.props;
      if (typeof fallback === "function") return fallback(error);
      return (
        fallback ?? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#8E8E93" }}>
            <p style={{ fontSize: "1.1rem", fontWeight: 600 }}>Something went wrong</p>
            <button
              onClick={() => this.setState({ error: null })}
              style={{
                marginTop: "0.75rem",
                padding: "0.5rem 1.25rem",
                borderRadius: "8px",
                border: "1px solid #d4c8b0",
                background: "#f5f0e8",
                cursor: "pointer",
                fontSize: "0.9rem",
              }}
            >
              Try again
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
