import { z } from "zod";
import { Check, XCircle } from "lucide-react";
const reportSchema = z.object({
  passed: z.boolean(),
  findings: z.array(z.string()),
  acceptance: z.array(
    z.object({ id: z.string(), passed: z.boolean(), evidence: z.string() }),
  ),
});
export default function ReviewEvidence({ value }: { value: string }) {
  let report: z.infer<typeof reportSchema> | undefined;
  try {
    const result = reportSchema.safeParse(
      JSON.parse(value.replace(/^```(?:json)?\s*|\s*```$/g, "")),
    );
    if (result.success) report = result.data;
  } catch {
    /* Preserve unrecognized provider reports verbatim. */
  }
  if (!report) return <pre className="output-text review-report">{value}</pre>;
  return (
    <div className="structured-review">
      <section>
        <h3>Agent verdict</h3>
        <p className={report.passed ? "ok" : "failure-text"}>
          {report.passed ? "Pass recommendation" : "Changes needed"}
        </p>
        <p className="muted">
          This is an agent recommendation. System checks and approval gates are
          evaluated separately.
        </p>
      </section>
      <section>
        <h3>Evidence by acceptance criterion</h3>
        {report.acceptance.map((ac, i) => (
          <div className="acceptance-result" key={`${ac.id}:${i}`}>
            {ac.passed ? (
              <Check size={15} className="ok" />
            ) : (
              <XCircle size={15} className="failure-text" />
            )}
            <div>
              <strong>
                {ac.id} · {ac.passed ? "Met" : "Not met"}
              </strong>
              <p className="preserve">{ac.evidence || "No evidence"}</p>
            </div>
          </div>
        ))}
      </section>
      <section>
        <h3>Review findings · {report.findings.length}</h3>
        {report.findings.length ? (
          <ul>
            {report.findings.map((finding, i) => (
              <li key={i}>{finding}</li>
            ))}
          </ul>
        ) : (
          <p>No blocking findings recorded.</p>
        )}
      </section>
      <details>
        <summary>Original report</summary>
        <pre className="output-text">{value}</pre>
      </details>
    </div>
  );
}
