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
        <h3>에이전트 판정</h3>
        <p className={report.passed ? "ok" : "failure-text"}>
          {report.passed ? "통과 의견" : "수정 필요"}
        </p>
        <p className="muted">
          에이전트 의견입니다. 시스템의 필수 검사와 승인 조건은 별도로
          확인합니다.
        </p>
      </section>
      <section>
        <h3>수용 기준별 근거</h3>
        {report.acceptance.map((ac, i) => (
          <div className="acceptance-result" key={`${ac.id}:${i}`}>
            {ac.passed ? (
              <Check size={15} className="ok" />
            ) : (
              <XCircle size={15} className="failure-text" />
            )}
            <div>
              <strong>
                {ac.id} · {ac.passed ? "충족 의견" : "미충족"}
              </strong>
              <p className="preserve">{ac.evidence || "근거 없음"}</p>
            </div>
          </div>
        ))}
      </section>
      <section>
        <h3>리뷰 지적 · {report.findings.length}개</h3>
        {report.findings.length ? (
          <ul>
            {report.findings.map((finding, i) => (
              <li key={i}>{finding}</li>
            ))}
          </ul>
        ) : (
          <p>기록된 차단 지적이 없습니다.</p>
        )}
      </section>
      <details>
        <summary>원본 보고서</summary>
        <pre className="output-text">{value}</pre>
      </details>
    </div>
  );
}
