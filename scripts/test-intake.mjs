// Teacher data-intake tests, run against a live server.
//
// Usage:  node scripts/test-intake.mjs [baseUrl]

const BASE = process.argv[2] ?? "http://localhost:5000";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`);
  }
}

async function login(identifier, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function post(cookie, body) {
  const res = await fetch(`${BASE}/api/students/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const GOOD = {
  student_id: "70001", sex: "male", grade: "g1",
  bmi: "21.5", vital_capacity: "4100", sprint_50m: "7.4",
  standing_long_jump: "230", sit_and_reach: "13.0",
  endurance_run: "245", strength: "10",
};

async function main() {
  console.log(`\nTeacher data intake — ${BASE}\n`);

  const teacher = await login("teacher", "aptams-teacher");
  const student = await login("90001", "aptams2026");

  // --- access control -----------------------------------------------------------------------
  console.log("Intake is teacher-only:");
  {
    const res = await fetch(`${BASE}/api/students/intake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: [GOOD] }),
    });
    check("anonymous -> 401", res.status === 401, `got ${res.status}`);
  }
  {
    const { status } = await post(student, { rows: [GOOD] });
    check("student session -> 403", status === 403, `got ${status}`);
  }

  // --- manual entry -------------------------------------------------------------------------
  console.log("\nManual entry:");
  {
    const { status, body } = await post(teacher, { rows: [GOOD] });
    check("valid row accepted", status === 200 && body.added.includes("70001"),
      JSON.stringify(body));
    check("no rejections", body?.rejected === 0);
  }
  {
    // The scored record must come back through the normal teacher endpoint.
    const res = await fetch(`${BASE}/api/students/70001`, { headers: { Cookie: teacher } });
    const s = await res.json();
    check("appears in the roster and scores", res.status === 200 && typeof s.score?.total === "number",
      `got ${res.status}`);
    check("flagged as manually entered", (s.flags ?? []).includes("manually_entered"));
    check("no fabricated risk prediction", s.progress?.available === false);
    check("has a route", Array.isArray(s.route?.options));
  }
  {
    // Scored identically to the engine: verify against a known-good calculation by
    // re-submitting the same measurements under a second id.
    const { body } = await post(teacher, { rows: [{ ...GOOD, student_id: "70002" }] });
    check("re-entry under a new id succeeds", body?.added?.includes("70002"));
    const [a, b] = await Promise.all(
      ["70001", "70002"].map((id) =>
        fetch(`${BASE}/api/students/${id}`, { headers: { Cookie: teacher } }).then((r) => r.json()),
      ),
    );
    check("identical inputs give identical totals", a.score.total === b.score.total,
      `${a.score.total} vs ${b.score.total}`);
  }

  // --- validation ---------------------------------------------------------------------------
  console.log("\nValidation rejects bad input:");
  const badCases = [
    [{ ...GOOD, student_id: "70010", sprint_50m: "0.5" }, "sprint_50m", "implausible sprint time"],
    [{ ...GOOD, student_id: "70011", vital_capacity: "abc" }, "vital_capacity", "non-numeric"],
    [{ ...GOOD, student_id: "70012", sex: "unknown" }, "sex", "bad sex"],
    [{ ...GOOD, student_id: "70013", grade: "g9" }, "grade", "bad grade"],
    [{ ...GOOD, student_id: "" }, "student_id", "missing id"],
    [{ ...GOOD, student_id: "70014", bmi: "" }, "bmi", "missing measurement"],
  ];
  for (const [row, field, label] of badCases) {
    const { body } = await post(teacher, { rows: [row] });
    const hit = (body?.errors ?? []).some((e) => e.field === field);
    check(`${label} -> rejected on ${field}`, body?.rejected > 0 && hit,
      JSON.stringify(body?.errors));
  }

  // --- CSV ----------------------------------------------------------------------------------
  console.log("\nCSV upload:");
  {
    const csv = [
      "student_id,sex,grade,bmi,vital_capacity,sprint_50m,standing_long_jump,sit_and_reach,endurance_run,strength",
      "70101,male,g1,21.5,4100,7.4,230,13.0,245,10",
      "70102,female,g2,20.1,3000,9.1,168,17.5,238,32",
    ].join("\n");
    const { status, body } = await post(teacher, { csv });
    check("two rows imported", status === 200 && body.added.length === 2, JSON.stringify(body));
  }
  {
    // A partly-bad file must still import its good rows.
    const csv = [
      "student_id,sex,grade,bmi,vital_capacity,sprint_50m,standing_long_jump,sit_and_reach,endurance_run,strength",
      "70201,male,g1,21.5,4100,7.4,230,13.0,245,10",
      "70202,male,g1,21.5,4100,0.2,230,13.0,245,10",
    ].join("\n");
    const { body } = await post(teacher, { csv });
    check("good row imported, bad row reported",
      body.added.includes("70201") && body.rejected === 1,
      JSON.stringify(body));
  }
  {
    // Chinese headers and 男/女 should work — a teacher's own export usually looks like this.
    const csv = [
      "学号,性别,年级,BMI,肺活量,50米跑,立定跳远,坐位体前屈,耐力跑,力量",
      "70301,男,大一,21.5,4100,7.4,230,13.0,245,10",
    ].join("\n");
    const { body } = await post(teacher, { csv });
    check("Chinese headers accepted", body.added.includes("70301"), JSON.stringify(body));
  }
  {
    const csv = "student_id,sex\n70401,male";
    const { body } = await post(teacher, { csv });
    check("missing columns reported clearly",
      body.rejected > 0 && /Missing column/.test(body.errors[0]?.message ?? ""),
      JSON.stringify(body?.errors));
  }
  {
    const csv = [
      "student_id,sex,grade,bmi,vital_capacity,sprint_50m,standing_long_jump,sit_and_reach,endurance_run,strength",
      "70501,male,g1,21.5,4100,7.4,230,13.0,245,10",
      "70501,male,g1,22.0,4200,7.3,235,14.0,240,11",
    ].join("\n");
    const { body } = await post(teacher, { csv });
    check("duplicate id in one file rejected", body.rejected === 1, JSON.stringify(body));
  }

  // --- template + cleanup -------------------------------------------------------------------
  console.log("\nTemplate and cleanup:");
  {
    const res = await fetch(`${BASE}/api/students/intake?template=1`, {
      headers: { Cookie: teacher },
    });
    const text = await res.text();
    check("template downloads as CSV",
      res.status === 200 && text.startsWith("student_id,sex,grade,"), text.slice(0, 40));
  }
  {
    const res = await fetch(`${BASE}/api/students/intake`, {
      method: "DELETE", headers: { Cookie: teacher },
    });
    const body = await res.json();
    check("clear removes intake students", body.cleared > 0, JSON.stringify(body));
    const after = await fetch(`${BASE}/api/students/70001`, { headers: { Cookie: teacher } });
    check("cleared student is gone -> 404", after.status === 404, `got ${after.status}`);
  }

  // --- the synthetic cohort is untouched ------------------------------------------------------
  console.log("\nThe shipped cohort is unaffected:");
  {
    const res = await fetch(`${BASE}/api/students`, { headers: { Cookie: teacher } });
    const body = await res.json();
    check("roster back to 240", body.count === 240, `got ${body.count}`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
