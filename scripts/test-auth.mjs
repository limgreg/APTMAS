// Authentication and privacy-boundary tests, run against a live server.
//
// These exist because the previous implementation *looked* correct — the UI had a student
// view and a teacher view, the routes checked a role — while the role itself came from a
// header the caller set. Every assertion below is an attack that used to succeed.
//
// Usage:  node scripts/test-auth.mjs [baseUrl]

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

/** Fetch without following the browser's cookie jar — we manage cookies explicitly. */
async function req(path, { cookie, method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res;
}

function cookieFrom(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return null;
  return raw.split(";")[0];
}

async function main() {
  console.log(`\nAuth + privacy boundary — ${BASE}\n`);

  // --- anonymous access ---------------------------------------------------------------------
  console.log("Anonymous requests are rejected:");
  for (const path of [
    "/api/students",
    "/api/students/90001",
    "/api/students/me",
    "/api/cohort",
  ]) {
    const res = await req(path);
    check(`${path} -> 401`, res.status === 401, `got ${res.status}`);
  }
  {
    const res = await req("/api/agent/chat", {
      method: "POST",
      body: { message: "hi", locale: "en" },
    });
    check("/api/agent/chat -> 401", res.status === 401, `got ${res.status}`);
  }

  // --- the old attack: claim a role in a header ---------------------------------------------
  console.log("\nThe header attack no longer works:");
  for (const path of ["/api/students", "/api/cohort"]) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "x-aptams-role": "teacher" },
    });
    check(
      `x-aptams-role: teacher on ${path} -> 401`,
      res.status === 401,
      `got ${res.status} — the client can still assert a role!`,
    );
  }

  // --- bad credentials ----------------------------------------------------------------------
  console.log("\nCredentials are actually checked:");
  for (const [id, pw, label] of [
    ["90001", "wrong", "right id, wrong password"],
    ["00001", "aptams2026", "real-looking id outside the cohort"],
    ["teacher", "wrong", "teacher, wrong password"],
    ["nobody", "aptams2026", "unknown user"],
  ]) {
    const res = await req("/api/auth/login", {
      method: "POST",
      body: { identifier: id, password: pw },
    });
    check(`${label} -> 401`, res.status === 401, `got ${res.status}`);
  }

  // --- student session ----------------------------------------------------------------------
  console.log("\nStudent session:");
  const studentRes = await req("/api/auth/login", {
    method: "POST",
    body: { identifier: "90001", password: "aptams2026" },
  });
  check("valid student login -> 200", studentRes.status === 200, `got ${studentRes.status}`);
  const studentCookie = cookieFrom(studentRes);
  check("sets a session cookie", !!studentCookie);
  check(
    "cookie is HttpOnly",
    (studentRes.headers.get("set-cookie") ?? "").includes("HttpOnly"),
  );

  {
    const res = await req("/api/students/me", { cookie: studentCookie });
    const body = await res.json();
    check("can read own record", res.status === 200 && body.student_id === "90001",
      `got ${res.status} / ${body.student_id}`);
  }

  console.log("\n  A student cannot reach teacher surfaces:");
  for (const path of ["/api/students", "/api/cohort", "/api/students/90002"]) {
    const res = await req(path, { cookie: studentCookie });
    check(`${path} -> 403`, res.status === 403, `got ${res.status}`);
  }

  console.log("\n  A student cannot impersonate another student:");
  {
    // The old API took the id from a header; the new one takes it from the session.
    const res = await fetch(`${BASE}/api/students/me`, {
      headers: { Cookie: studentCookie, "x-aptams-student-id": "90002" },
    });
    const body = await res.json();
    check(
      "x-aptams-student-id is ignored",
      res.status === 200 && body.student_id === "90001",
      `got ${body.student_id} — header still honoured!`,
    );
  }

  // --- teacher session ----------------------------------------------------------------------
  console.log("\nTeacher session:");
  const teacherRes = await req("/api/auth/login", {
    method: "POST",
    body: { identifier: "teacher", password: "aptams-teacher" },
  });
  check("valid teacher login -> 200", teacherRes.status === 200, `got ${teacherRes.status}`);
  const teacherCookie = cookieFrom(teacherRes);

  {
    const res = await req("/api/students", { cookie: teacherCookie });
    const body = await res.json();
    check("can read the roster", res.status === 200 && body.count > 0, `got ${res.status}`);
  }
  {
    const res = await req("/api/students/me", { cookie: teacherCookie });
    check("cannot use the student endpoint -> 403", res.status === 403, `got ${res.status}`);
  }

  console.log("\n  The privacy boundary holds for a teacher:");
  {
    const res = await req("/api/students/90001", { cookie: teacherCookie });
    const body = await res.json();
    const inds = body.indicators ?? [];
    check("no reported-layer indicator returned",
      !inds.some((i) => i.layer === "reported"),
      `found ${inds.filter((i) => i.layer === "reported").length}`);
    check("no teacher_visible:false indicator returned",
      !inds.some((i) => i.teacher_visible === false));
  }

  // --- tampering ----------------------------------------------------------------------------
  console.log("\nForged and tampered cookies are rejected:");
  {
    const [name, value] = studentCookie.split("=");
    const [payload, sig] = value.split(".");

    // Flip the role inside the payload, keep the (now wrong) signature.
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.role = "teacher";
    const forgedPayload = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");

    for (const [label, cookie] of [
      ["payload edited to role=teacher", `${name}=${forgedPayload}.${sig}`],
      ["signature stripped", `${name}=${payload}`],
      ["signature replaced", `${name}=${payload}.YWFhYWFh`],
      ["garbage", `${name}=not-a-session`],
    ]) {
      const res = await req("/api/students", { cookie });
      check(`${label} -> 401`, res.status === 401, `got ${res.status}`);
    }
  }

  // --- logout -------------------------------------------------------------------------------
  console.log("\nLogout:");
  {
    const res = await req("/api/auth/logout", { method: "POST", cookie: studentCookie });
    check("clears the cookie", (res.headers.get("set-cookie") ?? "").includes("Max-Age=0"));
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
