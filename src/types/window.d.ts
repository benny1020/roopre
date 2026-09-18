import type { DesktopAPI } from "../shared/desktop";
export {};
declare global {
  interface Window {
    roopre?: Readonly<DesktopAPI>;
  }
}
