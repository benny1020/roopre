import React from "react";
import { createRoot } from "react-dom/client";
import DesktopRoot from "./Onboarding";
import ErrorBoundary from "./ErrorBoundary";

try {
  const theme = JSON.parse(localStorage.getItem("theme") || '"system"');
  document.documentElement.dataset.theme =
    theme === "dark" ||
    ((theme === "system" || !theme) &&
      matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";
} catch {}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <DesktopRoot />
  </ErrorBoundary>,
);
