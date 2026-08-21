"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  submitIntake,
  INTAKE_TEMPLATE_URL,
  type IntakeResult,
} from "@/lib/api";
import type { Dict } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Teacher data intake: enter one student's results by hand or paste/upload a class CSV.
 *
 * Both paths run through the same rule engine the precomputed cohort uses, so an entered
 * student and a cohort student are scored identically — no second scoring path to drift.
 * Entered data is held in server memory only and never written to disk.
 */
export function IntakeCard({
  tr,
  onImported,
  embedded = false,
}: {
  tr: Dict;
  onImported: () => void;
  embedded?: boolean;
}) {
  const [mode, setMode] = useState<"manual" | "csv">("manual");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");

  const [form, setForm] = useState<Record<string, string>>({
    student_id: "",
    sex: "male",
    grade: "g1",
    bmi: "",
    vital_capacity: "",
    sprint_50m: "",
    standing_long_jump: "",
    sit_and_reach: "",
    endurance_run: "",
    strength: "",
  });

  const FIELDS: Array<{ key: string; label: string; unit: string; placeholder: string }> = [
    { key: "bmi", label: tr.itemBmi, unit: "kg/m2", placeholder: "21.5" },
    { key: "vital_capacity", label: tr.itemVital, unit: "ml", placeholder: "4100" },
    { key: "sprint_50m", label: tr.itemSprint, unit: "s", placeholder: "7.4" },
    { key: "standing_long_jump", label: tr.itemJump, unit: "cm", placeholder: "230" },
    { key: "sit_and_reach", label: tr.itemReach, unit: "cm", placeholder: "13.0" },
    { key: "endurance_run", label: tr.itemEndurance, unit: "s", placeholder: "245" },
    { key: "strength", label: tr.itemStrength, unit: tr.reps, placeholder: "10" },
  ];

  async function send(payload: { csv: string } | { rows: Array<Record<string, string>> }) {
    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      const r = await submitIntake(payload);
      setResult(r);
      if (r.added.length > 0 || r.replaced.length > 0) onImported();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    await send({ csv: text });
    e.target.value = "";
  }

  const inner = (
    <>
      <div className="flex rounded-lg border border-border-strong bg-muted p-0.5 text-xs">
        {(["manual", "csv"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setResult(null);
              setFailure(null);
            }}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 font-medium transition",
              mode === m
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "manual" ? tr.intakeManual : tr.intakeCsv}
          </button>
        ))}
      </div>

      {mode === "manual" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            send({ rows: [form] });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{tr.studentIdLabel}</label>
              <Input
                value={form.student_id}
                onChange={(e) => setForm({ ...form, student_id: e.target.value })}
                placeholder="10001"
                className="border-border-strong bg-surface-2"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{tr.sexLabel}</label>
              <Select value={form.sex} onValueChange={(v) => setForm({ ...form, sex: v })}>
                <SelectTrigger className="border-border-strong bg-surface-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">{tr.male}</SelectItem>
                  <SelectItem value="female">{tr.female}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{tr.gradeLabel}</label>
              <Select value={form.grade} onValueChange={(v) => setForm({ ...form, grade: v })}>
                <SelectTrigger className="border-border-strong bg-surface-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["g1", "g2", "g3", "g4"] as const).map((g) => (
                    <SelectItem key={g} value={g}>
                      {tr[g]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <label className="text-xs font-medium">
                  {f.label} <span className="font-normal text-muted-foreground">({f.unit})</span>
                </label>
                <Input
                  inputMode="decimal"
                  value={form[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="border-border-strong bg-surface-2"
                />
              </div>
            ))}
          </div>

          <Button type="submit" disabled={busy} className="rounded-full bg-primary font-condensed uppercase tracking-wide text-primary-foreground">
            {busy ? "..." : tr.intakeSubmit}
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="max-w-xs border-border-strong bg-surface-2"
            />
            <a
              href={INTAKE_TEMPLATE_URL}
              className="text-xs text-primary underline underline-offset-2"
            >
              {tr.intakeTemplate}
            </a>
          </div>
          <p className="text-xs text-muted-foreground">{tr.intakeCsvHint}</p>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder="student_id,sex,grade,bmi,vital_capacity,sprint_50m,..."
            className="w-full rounded-lg border border-border-strong bg-surface-2 p-2 font-mono text-[11px]"
          />
          <Button
            onClick={() => send({ csv: csvText })}
            disabled={busy || csvText.trim() === ""}
            className="rounded-full bg-primary font-condensed uppercase tracking-wide text-primary-foreground"
          >
            {busy ? "..." : tr.intakeSubmit}
          </Button>
        </div>
      )}

      {failure && <p className="text-xs text-destructive">{failure}</p>}

      {result && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs">
            <span className="font-medium text-primary">
              {result.added.length + result.replaced.length} {tr.intakeImported}
            </span>
            {result.rejected > 0 && (
              <>
                {" · "}
                <span className="font-medium text-warn">
                  {result.rejected} {tr.intakeRejected}
                </span>
              </>
            )}
          </p>
          {result.errors.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px] text-muted-foreground">
              {result.errors.slice(0, 25).map((err, i) => (
                <li key={i}>
                  <span className="font-mono">
                    {tr.row} {err.row}
                    {err.student_id ? ` · ${err.student_id}` : ""}
                  </span>{" "}
                  &mdash; {err.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">{tr.intakeNotice}</p>
    </>
  );

  if (embedded) {
    return <div className="space-y-4">{inner}</div>;
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{tr.intakeTitle}</CardTitle>
        <CardDescription>{tr.intakeSubtitle}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{inner}</CardContent>
    </Card>
  );
}
