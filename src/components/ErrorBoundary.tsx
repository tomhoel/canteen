"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary caught:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#8E8E93" }}>
            <p style={{ fontSize: "1.1rem", fontWeight: 600 }}>Something went wrong</p>
            <button
              onClick={() => this.setState({ hasError: false })}
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
