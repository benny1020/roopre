import { randomUUID, createHash } from "node:crypto";
import {
  harnessPackageSchema,
  canonical,
  type HarnessPackage,
  type PackageCandidate,
  type PackageSource,
} from "../../shared/harness-package.ts";
import { packageDigest } from "../../domain/harness-package.ts";
export class HarnessLibrary {
  private candidates = new Map<
    string,
    { value: PackageCandidate; created: number }
  >();
  add(input: unknown, source: PackageSource): PackageCandidate {
    if (JSON.stringify(input).length > 4_000_000)
      throw Error("Harness is too large.");
    const pack = harnessPackageSchema.parse(input);
    for (const [id, c] of this.candidates)
      if (Date.now() - c.created > 30 * 60000) this.candidates.delete(id);
    if (this.candidates.size >= 10)
      this.candidates.delete(this.candidates.keys().next().value!);
    const value = {
      token: randomUUID(),
      package: pack,
      digest: packageDigest(pack),
      source,
    };
    this.candidates.set(value.token, {
      value: structuredClone(value),
      created: Date.now(),
    });
    return value;
  }
  get(token: string) {
    const entry = this.candidates.get(token);
    if (!entry || Date.now() - entry.created > 30 * 60000)
      throw Error("Preview expired. Validate again.");
    return structuredClone(entry.value);
  }
}

export const harnessApplyRequestId = (token: string, input: unknown) =>
  "harness-" +
  createHash("sha256").update(canonical({ token, input })).digest("hex");
