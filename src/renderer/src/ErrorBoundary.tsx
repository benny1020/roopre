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
        <h1>화면을 다시 불러와 주세요</h1>
        <p>
          화면 표시 중 문제가 발생했습니다. 저장된 설계와 실행 기록은
          유지됩니다. 저장하지 않은 입력은 복구되지 않을 수 있습니다.
        </p>
        <button className="primary" onClick={() => window.location.reload()}>
          화면 다시 불러오기
        </button>
      </main>
    );
  }
}
