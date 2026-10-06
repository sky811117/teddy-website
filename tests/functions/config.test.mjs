// 設定檔層級的資安檢查：.gitignore、既有安全標頭、GitHub workflows。離線、唯讀。
// （A4 預備補丁原本還有「CSP Report-Only」與「dependabot」兩組檢查；那兩項會改動 public/_headers.txt、新增 Dependabot 每週 PR，
//   屬於需要景泰另行決定的部分，沒有併進這一版，所以這裡也沒有對應的測試。）
// 執行：node --test "tests/functions/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = rel => readFileSync(path.join(ROOT, rel), "utf-8").replace(/\r\n/g, "\n");

// ───────────── public/_headers.txt ─────────────
const headersTxt = read("public/_headers.txt");
// 把檔案切成 { 規則路徑: [標頭行...] }
function parseHeaders(txt) {
  const rules = {};
  let cur = null;
  for (const line of txt.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      cur = line.trim();
      rules[cur] = rules[cur] || [];
    } else if (cur) rules[cur].push(line.trim());
  }
  return rules;
}
const rules = parseHeaders(headersTxt);
const allRule = rules["/*"] || [];

test("既有的快取／安全標頭沒被動到", () => {
  for (const h of ["X-Content-Type-Options: nosniff", "X-Frame-Options: SAMEORIGIN", "Referrer-Policy: strict-origin-when-cross-origin"]) {
    assert.ok(allRule.includes(h), h);
  }
  assert.ok(allRule.some(l => /^Permissions-Policy:.*geolocation=\(self\)/.test(l)));
  assert.ok((rules["/_astro/*"] || []).some(l => /immutable/.test(l)));
});

// ───────────── .gitignore ─────────────
function ignored(p) {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test(".gitignore：機密檔樣式都會被忽略", () => {
  const mustIgnore = [
    ".dev.vars",
    ".dev.vars.production",
    ".env",
    ".env.production",
    ".env.local",
    ".env.staging",
    ".env.bak_20261003",
    "prod.env",
    "config/staging.env",
    ".envrc",
    ".aws/credentials",
    ".pgpass",
    "functions/.env.local",
    ".wrangler/state/v3/cache.json",
    "secrets.key",
    "deep/dir/server.pem",
    "AuthKey_ABC.p8",
    "cert.p12",
    "cert.pfx",
    "release.jks",
    "id_rsa",
    "id_ed25519.pub",
    ".netrc",
    "credentials.json",
    "service-account-prod.json",
    "secrets.json",
  ];
  for (const f of mustIgnore) assert.ok(ignored(f), `應被忽略：${f}`);
});

test(".gitignore：不能誤傷正常檔案（.env.example、IndexNow 驗證檔、一般 json／txt）", () => {
  const mustTrack = [
    ".env.example",
    "public/a4fd21ba1326b1a22ff2eef4b531c852adb38ca4634443158d406df3360e497f.txt",
    "package.json",
    "tsconfig.json",
    "src/data/withdrawn-properties.json",
    "public/_headers.txt",
    "functions/go/line.ts",
    ".github/dependabot.yml",
  ];
  for (const f of mustTrack) assert.ok(!ignored(f), `不該被忽略：${f}`);
});

test(".gitignore：目前 repo 追蹤中的檔案沒有任何一個命中新規則（不會有『已追蹤卻被忽略』的新增）", () => {
  const tracked = execFileSync("git", ["ls-files", "-ci", "--exclude-standard"], { cwd: ROOT, encoding: "utf-8" })
    .split("\n")
    .filter(Boolean)
    // audit/ 兩份舊報告是「先 commit 才加進 .gitignore」的既有例外（建議用 git rm --cached 移除，見 APPLY.md）
    .filter(f => !f.startsWith("audit/"));
  assert.deepEqual(tracked, [], `這些檔案已被追蹤、又符合 .gitignore：${tracked.join(", ")}`);
});

// ───────────── GitHub workflows ─────────────
const deploy = read(".github/workflows/deploy.yml");
const ci = read(".github/workflows/ci.yml");

test("workflows：沒有 pull_request_target、沒有 workflow_run 之類會把秘密交給外部程式碼的觸發器", () => {
  for (const [name, src] of [["deploy", deploy], ["ci", ci]]) {
    assert.ok(!/pull_request_target/.test(src), `${name} 不該用 pull_request_target`);
    assert.ok(!/workflow_run/.test(src), `${name} 不該用 workflow_run`);
  }
});

test("workflows：頂層有最小權限 permissions（deploy.yml 與 ci.yml 都是 contents: read）", () => {
  for (const [name, src] of [["deploy", deploy], ["ci", ci]]) {
    const top = src.split(/^jobs:/m)[0];
    assert.match(top, /^permissions:\n  contents: read$/m, `${name} 頂層 permissions`);
  }
  assert.match(deploy, /permissions:\n      contents: read\n      deployments: write/, "deploy job 只多一個 deployments: write");
  assert.ok(!/write-all|permissions:\s*\n\s*contents:\s*write/.test(deploy + ci), "不該有寬權限");
});

test("workflows：每個 actions/checkout 都有 persist-credentials: false", () => {
  for (const [name, src] of [["deploy", deploy], ["ci", ci]]) {
    const checkouts = [...src.matchAll(/uses: actions\/checkout@/g)].length;
    const persists = [...src.matchAll(/persist-credentials: false/g)].length;
    assert.ok(checkouts > 0);
    assert.equal(persists, checkouts, name);
  }
});

test("workflows：秘密（secrets.*）只出現在『寫禁字清單』與『部署』兩個步驟；ci.yml 只能用 LEAK_DENYLIST", () => {
  const uses = src => [...src.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(uses(ci))], ["LEAK_DENYLIST"], "ci.yml 只能用 LEAK_DENYLIST 這一個 secret");
  const steps = deploy.split(/\n      - name: /).slice(1);
  const withSecrets = steps.filter(s => /secrets\./.test(s));
  assert.equal(withSecrets.length, 2, "只能有兩個步驟用 secrets（禁字清單、部署）");
  assert.match(withSecrets[0], /^Prepare leak denylist/);
  assert.match(withSecrets[1], /^Deploy to Cloudflare Pages/);
  // 禁字清單 secret 只能經由環境變數進 shell（不能直接內插在 run 指令裡，避免被當成指令碼注入）
  const prep = withSecrets[0];
  assert.match(prep, /env:\n\s+LEAK_DENYLIST_TEXT: \$\{\{ secrets\.LEAK_DENYLIST \}\}/);
  assert.ok(!/run:[\s\S]*\$\{\{ secrets\./.test(prep.split("env:")[1].split("run:")[1] || ""), "run 內不能直接內插 secrets");
});

test("workflows：所有 uses 都不是浮動分支（@main／@master）；列出尚未釘 SHA 的清單供追蹤", t => {
  const noComments = src => src.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  const uses = [...noComments(deploy + "\n" + ci).matchAll(/uses:\s*([^\s#]+)/g)].map(m => m[1]);
  const unpinned = [];
  for (const u of uses) {
    const ref = u.split("@")[1] || "";
    assert.ok(!/^(main|master|latest)$/.test(ref), `${u} 用了浮動分支`);
    if (!/^[0-9a-f]{40}$/.test(ref)) unpinned.push(u);
  }
  t.diagnostic("尚未釘 SHA（需連網查證，見 APPLY.md）：" + [...new Set(unpinned)].sort().join("、"));
});
