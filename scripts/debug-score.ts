import { scoreStudent } from "../src/lib/aptams/engine";
import { scoreItem, bonusFor, itemWeight } from "../src/lib/aptams/tables";
import type { FitnessItemId, Grade, Sex } from "../src/lib/aptams/types";
import * as fs from "node:fs";

const csv = fs.readFileSync(
  "/app/work/scaffold/Fitness-Health/data/ML/policy_year_data/pft (all students in china data).csv",
  "utf8",
);
const lines = csv.trim().split(/\r?\n/);
const header = lines[0].replace(/^\uFEFF/, "").split(",");
const idx = (name: string) => header.indexOf(name);

function debug(sid: string, g: Grade) {
  const line = lines.find((l) => l.startsWith(sid + ","));
  if (!line) throw new Error("not found " + sid);
  const cols = line.split(",");
  const gender = cols[idx("gender")];
  const sex: Sex = gender === "男" ? "male" : "female";
  const h = Number(cols[idx(`height_${g}`)]);
  const w = Number(cols[idx(`weight_${g}`)]);
  const bmi = w / Math.pow(h / 100, 2);
  console.log(`\n=== ${sid} ${g} sex=${sex} bmi=${bmi.toFixed(2)} expected total=${cols[idx(`total_score_${g}`)]}`);
  const items: FitnessItemId[] = ["bmi","vital_capacity","sprint_50m","sit_and_reach","standing_long_jump","strength","endurance_run"];
  let weighted = 0, bonus = 0;
  for (const it of items) {
    const raw = it === "bmi" ? Math.round(bmi*10)/10 : Number(cols[idx(`${it=== "endurance_run"?"endurance_run_sec":it}_${g}`)]);
    const s = scoreItem(it, sex, g, raw);
    const bn = bonusFor(it, sex, g, raw);
    const wt = itemWeight(it);
    weighted += s*(wt/100); bonus += bn;
    console.log(`  ${it.padEnd(20)} raw=${String(raw).padStart(8)} score=${String(s).padStart(3)} bonus=${bn} weight=${wt}`);
  }
  console.log(`  weighted=${weighted.toFixed(2)} bonus=${bonus} total=${(weighted+Math.min(bonus,10)).toFixed(2)}`);
}

debug("00010","g1");
debug("00002","g2");
debug("00006","g4");
