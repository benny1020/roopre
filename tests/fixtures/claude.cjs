#!/usr/bin/env node
// Contract fixture only: never presented as a real model result.
const fs = require("node:fs");
(async () => {
  const prompt = fs.readFileSync(0, "utf8");
  const response = await fetch("http://model-gateway:8080/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY },
    body: JSON.stringify({ model: "unapproved-model" }),
    signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 403)
    throw Error("Broker network/auth contract failed: " + response.status);
  let gitReadonly = false;
  try {
    fs.appendFileSync("/workspace/.git/config", "\n# forbidden");
  } catch {
    gitReadonly = true;
  }
  if (!gitReadonly) throw Error("Git metadata is writable");
  let dependenciesReadonly = false;
  try {
    fs.writeFileSync(
      "/workspace/node_modules/forged-test.js",
      "process.exit(0)",
    );
  } catch {
    dependenciesReadonly = true;
  }
  if (!dependenciesReadonly) throw Error("Dependency tools are writable");
  const review =
    process.argv[process.argv.indexOf("--tools") + 1] === "Read,Glob,Grep";
  let result = "Fixture implementation";
  if (review) {
    let readonly = false;
    try {
      fs.writeFileSync("/workspace/forbidden.txt", "bad");
    } catch {
      readonly = true;
    }
    if (!readonly) throw Error("Reviewer workspace is writable");
    result = JSON.stringify({
      passed: true,
      acceptance: [
        {
          id: "AC01",
          passed: true,
          evidence:
            "hello.txt matches the fixed node assertion in this isolated fixture.",
        },
      ],
      findings: [],
    });
  } else {
    fs.writeFileSync("/workspace/hello.txt", "hello from fixture");
    if (
      prompt.includes("SLOW_SCENARIO") &&
      !fs.existsSync("/workspace/checkpoint.txt")
    ) {
      fs.writeFileSync("/workspace/checkpoint.txt", "preserved checkpoint");
      await new Promise((r) => setTimeout(r, 60000));
    }
  }
  console.log(
    JSON.stringify({
      type: "result",
      is_error: false,
      total_cost_usd: 0,
      result,
    }),
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
