import { test, expect } from "@playwright/test";

test("a queued draft autosave cannot overwrite a newer onboarding step", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const draft = {
      connectionName: "Claude Code",
      model: "claude-sonnet-4-6",
      auth: "api-key",
      projectId: "",
      name: "",
      path: "",
      branch: "main",
      runtime: "node",
      budget: "1",
      checks: "[]",
      projectInstructions: "",
      title: "",
      requirements: "",
    };
    const status = (progress: any) => ({
      connected: false,
      busy: false,
      stage: "connection",
      error: "",
      managed: false,
      progress,
    });
    let saved = {
      version: 1,
      step: "connection",
      dismissed: false,
      draft,
    };
    const w = globalThis as any;
    w.__onboardingCalls = [];
    w.roopre = {
      bootstrap: async () => status(saved),
      connections: async () => [],
      onboarding: async (progress: any) => {
        w.__onboardingCalls.push(progress);
        if (
          progress.step === "connection" &&
          progress.draft.connectionName === "Queued draft"
        )
          return new Promise((resolve) => {
            w.__resolveQueuedDraft = () => {
              saved = progress;
              resolve(status(saved));
            };
          });
        if (progress.step === "environment")
          return new Promise((resolve) => {
            w.__resolveNavigation = () => {
              saved = progress;
              resolve(status(saved));
            };
          });
        saved = progress;
        return status(saved);
      },
    };
  });
  await page.goto("/");
  await page
    .getByRole("heading", { name: "AI connections", exact: true })
    .waitFor();
  await page
    .getByLabel("Connection name", { exact: true })
    .fill("Queued draft");
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as any).__onboardingCalls.length),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as any).__onboardingCalls.length),
    )
    .toBe(1);
  await page.evaluate(() => (globalThis as any).__resolveQueuedDraft());
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as any).__onboardingCalls.length),
    )
    .toBe(2);
  await page.waitForTimeout(650);
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as any).__onboardingCalls.length),
    )
    .toBe(2);
  await page.evaluate(() => (globalThis as any).__resolveNavigation());
  await page
    .getByRole("heading", { name: "Environment setup", exact: true })
    .waitFor();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (globalThis as any).__onboardingCalls.map((call: any) => call.step),
      ),
    )
    .toEqual(["connection", "environment"]);
});
