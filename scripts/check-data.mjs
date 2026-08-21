// Build-time guard on the two data files the app ships.
//
// These files are committed so the app is self-contained and deployable. That is only safe
// while two things stay true, so this script asserts both and fails the build otherwise.
//
//   1. cohort.json is SYNTHETIC. AGENTS.md forbids committing real data, and this file is
//      bundled into the deployed app where anyone can read it. A build carrying real student
//      records must never leave a laptop.
//   2. university_2014.json matches the extractor output it claims to be. The scoring tables
//      are the single auditable origin of every scored number; the rule engine must be exact
//      and a hand-edited threshold is the one failure mode that would silently corrupt every
//      score, route and explanation downstream. The recorded sha256 is the tripwire.
//
// Run: node scripts/check-data.mjs   (wired into prepare.sh and build.sh)

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "src", "lib", "aptams", "data");
const PROVENANCE = join(DATA, "university_2014.PROVENANCE.json");

const fail = (msg) => {
  console.error(`\n[check-data] FAIL\n${msg}\n`);
  process.exit(1);
};

// --- 1. the cohort must be synthetic -------------------------------------------------------

const cohortPath = join(DATA, "cohort.json");
if (!existsSync(cohortPath)) {
  fail(
    `Missing ${cohortPath}.\n` +
      `Generate it with:  python scripts/precompute/build_synthetic_cohort.py`,
  );
}

const cohort = JSON.parse(readFileSync(cohortPath, "utf8"));

if (cohort.synthetic !== true) {
  fail(
    `src/lib/aptams/data/cohort.json is NOT marked synthetic.\n\n` +
      `This file is bundled into the deployed app. Shipping real student records is\n` +
      `forbidden (AGENTS.md: "Never commit real data").\n\n` +
      `Regenerate it with:  python scripts/precompute/build_synthetic_cohort.py\n` +
      `Do NOT use build_reference_cohort.py — it emits real students.`,
  );
}

// Synthetic ids are 5 digits so the login screen behaves like the real thing, drawn from the
// 90000-99999 band. That band is disjoint from the real id space (which runs 1..36059), so an
// id in range provably cannot belong to a real student. This is the check that would catch
// someone re-running build_reference_cohort.py.
const SYNTHETIC_ID_MIN = 90000;
const ids = (cohort.students ?? []).map((s) => String(s.student_id ?? ""));
const badIds = ids.filter((id) => !/^\d{5}$/.test(id) || Number(id) < SYNTHETIC_ID_MIN);
if (badIds.length > 0) {
  fail(
    `${badIds.length} student id(s) fall outside the synthetic band ${SYNTHETIC_ID_MIN}-99999: ` +
      `${badIds.slice(0, 5).join(", ")}${badIds.length > 5 ? " ..." : ""}\n\n` +
      `Real ids run 1..36059, so an id below ${SYNTHETIC_ID_MIN} is a real student record.\n` +
      `Regenerate with:  python scripts/precompute/build_synthetic_cohort.py`,
  );
}
if (ids.length === 0) fail("cohort.json contains no students.");

// --- 2. the scoring tables must match their recorded provenance ----------------------------

const tablesPath = join(DATA, "university_2014.json");
if (!existsSync(tablesPath)) {
  fail(
    `Missing ${tablesPath}.\n` +
      `The rule engine must be exact; it cannot start without the scoring tables.`,
  );
}

const raw = readFileSync(tablesPath);
const sha = createHash("sha256").update(raw).digest("hex");

if (existsSync(PROVENANCE)) {
  const prov = JSON.parse(readFileSync(PROVENANCE, "utf8"));
  if (prov.sha256 && prov.sha256 !== sha) {
    fail(
      `src/lib/aptams/data/university_2014.json does not match its recorded provenance.\n\n` +
        `  expected sha256: ${prov.sha256}\n` +
        `  actual   sha256: ${sha}\n\n` +
        `The scoring tables are the extractor's output, never edited by hand. If you meant\n` +
        `to update them, re-run the extractor and update src/lib/aptams/data/university_2014.PROVENANCE.json:\n\n` +
        `    python -m analysis.extract_scoring_tables`,
    );
  }
} else {
  console.warn(
    `[check-data] WARNING: no PROVENANCE.json — scoring tables are unverified (sha256 ${sha.slice(0, 12)}...)`,
  );
}

console.log(
  `[check-data] OK — cohort is synthetic (${ids.length} students, 9xxxx band), ` +
    `scoring tables match provenance.`,
);
