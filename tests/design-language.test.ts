import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { apply, draftTemplate } from "../src/domain/index.ts";
import { seed } from "./fixtures/workspace.ts";
import {
  sections,
  sectionLabels,
  designSectionKey,
  hasDesignSections,
  hasDesignPlaceholders,
  commandSchema,
} from "../src/shared/contracts.ts";

const body = (english: boolean) =>
  sections
    .map(
      (key) =>
        `## ${english ? sectionLabels[key] : key}\nConcrete design for ${sectionLabels[key]}.`,
    )
    .join("\n\n");

test("English designs and legacy designs use the same review wire keys", () => {
  for (const english of [false, true]) {
    const w = seed();
    const f = w.features[1];
    f.draft.body = body(english);
    apply(w, f.authorId, {
      type: "publish_design",
      featureId: f.id,
      expectedRevision: f.draft.revision,
    });
    const design = f.designs.at(-1)!;
    const command = commandSchema.parse({
      type: "review",
      featureId: f.id,
      designId: design.id,
      decision: "approve",
      checked: [...sections],
    });
    apply(w, "mina", command);
    assert.deepEqual(design.decisions[0].checked, sections);
    assert.equal(design.body, body(english));
  }
  assert(hasDesignSections(body(true).replaceAll("\n", "\r\n")));
  assert(!hasDesignSections(body(true).replace("## Architecture", "## Other")));
  assert.equal(designSectionKey("Failure cases"), sections[3]);
  assert.equal(designSectionKey(sections[3]), sections[3]);
});

test("templates are English, retain user intent and cannot be published as completed designs", () => {
  const intent = "한글로 작성한 사용자 요구사항";
  const template = draftTemplate(intent);
  assert(template.includes(intent));
  assert(hasDesignSections(template));
  assert(hasDesignPlaceholders(template));
  assert(hasDesignPlaceholders("기존 안내를 작성하세요."));
  assert(
    !hasDesignPlaceholders(
      body(true) + "\nDescribe the change in the release notes.",
    ),
  );
  for (const english of [false, true]) {
    const w = seed();
    const f = w.features[1];
    f.draft.body = english ? template : body(false) + "\n작성하세요.";
    assert.throws(
      () =>
        apply(w, f.authorId, {
          type: "publish_design",
          featureId: f.id,
          expectedRevision: f.draft.revision,
        }),
      (e: any) => e.code === "incomplete_design",
    );
  }
});

test("renderer product copy is English without translating dynamic user content", () => {
  const offenders: string[] = [];
  function visitDirectory(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visitDirectory(file);
      else if (/\.tsx?$/.test(file)) {
        const source = ts.createSourceFile(
          file,
          readFileSync(file, "utf8"),
          ts.ScriptTarget.Latest,
          true,
          file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        function visit(node: ts.Node) {
          if (
            (ts.isStringLiteralLike(node) ||
              ts.isTemplateLiteralToken(node) ||
              ts.isJsxText(node)) &&
            /[가-힣]/.test(node.text)
          )
            offenders.push(`${file}: ${node.text}`);
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }
  visitDirectory("src/renderer/src");
  assert.deepEqual(offenders, []);
});
