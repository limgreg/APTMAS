import { scoreStudent } from "../src/lib/aptams/engine";
import type { FitnessItemId, Grade, Sex } from "../src/lib/aptams/types";
import * as fs from "node:fs";

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

// Only g1 (first measured year) and require integer-like raw values across items.
let within05 = 0, within1 = 0, n = 0, maxAbs = 0;
const bad: Array<{sid:string; exp:number; got:number; diff:number; raws:Record<string, number>}> = [];

for (let li = 1; li < lines.length; li++) {
  const cols = lines[li].split(",");
  const gender = cols[idx("gender")];
  if (gender !== "男" && gender !== "女") continue;
  const sex: Sex = gender === "男" ? "male" : "female";
  const g: Grade = "g1";
  const h = Number(cols[idx(`height_${g}`)]);
  const w = Number(cols[idx(`weight_${g}`)]);
  if (!h || !w) continue;
  const bmi = Math.round((w / Math.pow(h / 100, 2)) * 10) / 10;
  const raws: Record<string, number> = { bmi };
  let allIntegerish = true;
  for (const it of items) {
    const v = Number(cols[idx(`${it.col}_${g}`)]);
    raws[it.id] = v;
    // strength and endurance and jump should be integer; allow .0 and .5
    if (it.id === "strength" && Math.abs(v - Math.round(v)) > 0.01) allIntegerish = false;
    if (it.id === "endurance_run" && Math.abs(v - Math.round(v)) > 0.01) allIntegerish = false;
    if (it.id === "standing_long_jump" && Math.abs(v - Math.round(v)) > 0.01) allIntegerish = false;
    if (it.id === "vital_capacity" && Math.abs(v - Math.round(v)) > 0.01) allIntegerish = false;
  }
  // use only integer strength & endurance (un-interpolated)
  if (!allIntegerish) continue;
  const measurements = [
    { item: "bmi" as FitnessItemId, value: bmi },
    ...items.map((it) => ({ item: it.id, value: raws[it.id] })),
  ];
  const expected = Number(cols[idx(`total_score_${g}`)]);
  const res = scoreStudent({ sex, grade: g, measurements });
  const diff = Math.abs(res.total - expected);
  n++;
  if (diff <= 0.5) within05++;
  if (diff <= 1.0) within1++;
  if (diff > maxAbs) {
    maxAbs = diff;
    if (bad.length < 6) bad.push({ sid: cols[0], exp: expected, got: res.total, diff: Math.round(diff*100)/100, raws });
  }
}
console.log(`g1 integer-raw records: n=${n}`);
console.log(`within 0.5: ${((within05/n)*100).toFixed(2)}%  within 1.0: ${((within1/n)*100).toFixed(2)}%  max=${maxAbs.toFixed(2)}`);
console.log("worst:", bad);
