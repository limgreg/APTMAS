"use client";

import type { CohortResponse, Locale, Student, StudentMeta } from "@/lib/types";
import type { Dict } from "@/lib/i18n";
import { AssessmentView } from "@/components/assessment-view";
import { CohortView } from "@/components/cohort-view";

/**
 * Teacher surface: the cohort overview (band distribution, drivers, segments +
 * roster slide-over) plus the selected student's assessment. The agent's
 * privacy boundary is enforced server-side; self-report indicators are stripped
 * before this UI ever receives them.
 */
export function TeacherView({
  student,
  cohort,
  roster,
  tr,
  locale,
  onSelect,
  onOpenIntake,
}: {
  student: Student;
  cohort: CohortResponse;
  roster: StudentMeta[];
  tr: Dict;
  locale: Locale;
  onSelect: (id: string) => void;
  onOpenIntake: () => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <CohortView
        cohort={cohort}
        roster={roster}
        tr={tr}
        locale={locale}
        onSelect={onSelect}
        onOpenIntake={onOpenIntake}
      />
      <div className="border-t border-hairline pt-8">
        <AssessmentView student={student} tr={tr} />
      </div>
    </div>
  );
}
