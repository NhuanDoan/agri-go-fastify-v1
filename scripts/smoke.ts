// usage: pnpm smoke [baseUrl]    (default http://localhost:3000)
const base = process.argv[2] ?? "http://localhost:3000";
let failures = 0;

async function http(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    json: text ? (JSON.parse(text) as any) : null,
  };
}

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}: ${(err as Error).message}`);
  }
}
const must = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

// wait for the server (containers take a few seconds)
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${base}/health/ready`)).status === 200) break;
  } catch {
    /* not up yet */
  }
  if (i >= 30) {
    console.error(`FAIL  ${base}/health/ready never became ready`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

await check("liveness and readiness", async () => {
  must((await http("GET", "/health")).json.status === "ok", "liveness");
  must(
    (await http("GET", "/health/ready")).json.status === "ready",
    "readiness",
  );
});

await check("every response carries a request id", async () => {
  must(
    (await http("GET", "/health")).headers.get("x-request-id"),
    "missing x-request-id",
  );
});

await check("unknown routes answer with the error envelope", async () => {
  const r = await http("GET", "/definitely-not-here");
  must(
    r.status === 404 && r.json.success === false && r.json.requestId,
    `got ${r.status}`,
  );
});

await check("API docs are served and non-trivial", async () => {
  const r = await http("GET", "/docs/json");
  must(
    r.status === 200 && Object.keys(r.json.paths).length > 40,
    "spec too small or missing",
  );
});

await check("public catalog answers with the envelope", async () => {
  const r = await http("GET", "/api/products?perPage=1");
  must(
    r.status === 200 && r.json.success === true && r.json.meta,
    `got ${r.status}`,
  );
});

await check("protected routes need a token", async () => {
  must((await http("GET", "/api/me")).status === 401, "expected 401");
  must((await http("GET", "/api/users")).status === 401, "expected 401");
});

await check("validation errors list the bad fields (422)", async () => {
  const r = await http("POST", "/api/auth/login", {});
  must(r.status === 422 && r.json.errors.length >= 2, `got ${r.status}`);
});

await check(
  "register, read profile, rotate the refresh token, reject its reuse",
  async () => {
    const email = `smoke+${Date.now()}@example.com`;
    const reg = await http("POST", "/api/auth/register", {
      fullName: "Smoke Test",
      email,
      password: "Smoke-test-123",
    });
    must(reg.status === 201, `register ${reg.status}`);
    const { accessToken, refreshToken } = reg.json.data.tokens;

    const me = await http("GET", "/api/me", undefined, accessToken);
    must(me.status === 200 && me.json.data.email === email, "me");

    const rotated = await http("POST", "/api/auth/refresh", { refreshToken });
    must(
      rotated.status === 200 &&
        rotated.json.data.tokens.refreshToken !== refreshToken,
      "rotation",
    );

    must(
      (await http("POST", "/api/auth/refresh", { refreshToken })).status ===
        401,
      "old refresh token must be rejected",
    );
  },
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall smoke checks passed");
