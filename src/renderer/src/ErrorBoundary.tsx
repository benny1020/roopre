import { Component, type ReactNode } from "react";
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="content-page" role="alert">
        <h1>Reload the workspace</h1>
        <p>
          The workspace could not render. Saved designs and run history are
          preserved; unsaved input may not be recoverable.
        </p>
        <button className="primary" onClick={() => window.location.reload()}>
          Reload workspace
        </button>
      </main>
    );
  }
}
