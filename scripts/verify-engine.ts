import { scoreStudent } from "../src/lib/aptams/engine";
import type { FitnessItemId, Grade, Sex } from "../src/lib/aptams/types";
import * as fs from "node:fs";

// Register TypeScript loader via tsx
const csv = fs.readFileSync(
  "/app/work/scaffold/Fitness-Health/data/ML/policy_year_data/pft (all students in china data).csv",
  "utf8",
);
const lines = csv.trim().split(/\r?\n/);
const header = lines[0].replace(/^\uFEFF/, "").split(",");
const idx = (name: string) => header.indexOf(name);

const items: Array<{ id: FitnessItemId; col: string }> = [
  { id: "vital_capacity", col: "vital_capacity" },
  { id: "sprint_50m", col: "sprint_50m" },
  { id: "sit_and_reach", col: "sit_and_reach" },
  { id: "standing_long_jump", col: "standing_long_jump" },
  { id: "strength", col: "strength" },
  { id: "endurance_run", col: "endurance_run_sec" },
];

let maxAbs = 0;
let within1 = 0;
let within05 = 0;
let n = 0;
let checked = 0;
const examples: Array<{ sid: string; grade: string; expected: number; got: number; diff: number }> = [];

for (let li = 1; li < lines.length && n < 4000; li++) {
  const cols = lines[li].split(",");
  const gender = cols[idx("gender")];
  if (gender !== "男" && gender !== "女") continue;
  const sex: Sex = gender === "男" ? "male" : "female";
  const nyears = Number(cols[idx("n_years")]);
  if (nyears < 4) continue;
  n++;
  for (const g of ["g1", "g2", "g3", "g4"] as Grade[]) {
    // bmi is computed from height/weight
    const h = Number(cols[idx(`height_${g}`)]);
    const w = Number(cols[idx(`weight_${g}`)]);
    if (!h || !w) continue;
    const bmi = w / Math.pow(h / 100, 2);
    const measurements = [
      { item: "bmi" as FitnessItemId, value: Math.round(bmi * 10) / 10 },
      ...items.map((it) => ({
        item: it.id,
        value: Number(cols[idx(`${it.col}_${g}`)]),
      })),
    ];
    const expected = Number(cols[idx(`total_score_${g}`)]);
    const res = scoreStudent({ sex, grade: g, measurements });
    const diff = Math.abs(res.total - expected);
    checked++;
    if (diff <= 0.5) within05++;
    if (diff <= 1.0) within1++;
    if (diff > maxAbs) {
      maxAbs = diff;
      if (examples.length < 8)
        examples.push({ sid: cols[0], grade: g, expected, got: res.total, diff: Math.round(diff * 100) / 100 });
    }
  }
}

console.log(`students=${n} checked=${checked}`);
console.log(`within 0.5: ${((within05 / checked) * 100).toFixed(2)}%`);
console.log(`within 1.0: ${((within1 / checked) * 100).toFixed(2)}%`);
console.log(`max abs diff: ${maxAbs.toFixed(3)}`);
console.log("worst examples:", examples.slice(0, 5));
