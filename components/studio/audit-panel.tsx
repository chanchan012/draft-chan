import { AlertTriangle, Ruler, ScanLine } from "lucide-react";
import type { ClearanceIssue } from "@/lib/plans/clearance";
import { unitFactor } from "@/lib/plans/cad";
import type { DisplayUnit } from "@/lib/plans/model";

const reference =
  "https://www.ada.gov/law-and-regs/design-standards/2010-stds/#chapter-4-accessible-routes";
const format = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export function AuditPanel({
  issues,
  truncated,
  selected,
  unit,
  onIssue,
}: {
  issues: ClearanceIssue[];
  truncated: boolean;
  selected?: string;
  unit: DisplayUnit;
  onIssue(id: string): void;
}) {
  const measure = (mm: number) =>
    format.format(mm / unitFactor(unit)) + " " + unit;
  return (
    <div className="studio-inspector-content studio-audit">
      <p
        className="studio-audit-summary"
        role="status"
        aria-label="Clearance findings"
      >
        <ScanLine size={16} />
        {issues.length
          ? `${issues.length} finding${issues.length === 1 ? "" : "s"}`
          : "No findings in checked geometry"}
      </p>
      <p className="studio-audit-note">
        Screens the published 815 mm doorway and 915 mm route-width benchmarks,
        swing obstructions, and footprint overlaps. Verify actual clear widths and
        route exceptions separately.{" "}
        <a href={reference} target="_blank" rel="noreferrer">
          ADA §§ 403 and 404
        </a>
      </p>
      {truncated && (
        <p className="studio-audit-note">
          Showing the first 200 findings. Address these and check again.
        </p>
      )}
      {issues.length > 0 && (
        <ul className="studio-audit-list">
          {issues.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                aria-pressed={selected === issue.id}
                onClick={() => onIssue(issue.id)}
              >
                {issue.segment ? (
                  <Ruler size={15} />
                ) : (
                  <AlertTriangle size={15} />
                )}
                <span>
                  <strong>{issue.title}</strong>
                  <span>{issue.detail}</span>
                  {issue.measuredMm !== undefined &&
                    issue.requiredMm !== undefined && (
                      <span className="studio-audit-measure">
                        {measure(issue.measuredMm)} · target{" "}
                        {measure(issue.requiredMm)}
                      </span>
                    )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
