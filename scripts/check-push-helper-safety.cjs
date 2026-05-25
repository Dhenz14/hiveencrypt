const fs = require("node:fs");

const source = fs.readFileSync("scripts/push-to-github.ts", "utf8");

const required = [
  "Explicit commit message required",
  "Refusing to push from branch",
  "Refusing to push to unexpected origin remote",
  "Refusing to stage untracked files without --include-untracked",
  "npm\", [\"run\", \"check\"]",
  "\"fetch\", \"origin\", \"main\"",
  "merge-base\", \"--is-ancestor\", \"origin/main\", \"HEAD\"",
];

const forbidden = [
  'process.argv[2] || "Update from workspace"',
  'run("git", ["add", "-A"]);',
];

const failures = [];

for (const needle of required) {
  if (!source.includes(needle)) {
    failures.push(`missing required guard: ${needle}`);
  }
}

for (const needle of forbidden) {
  if (source.includes(needle)) {
    failures.push(`stale unsafe helper pattern: ${needle}`);
  }
}

if (failures.length) {
  console.error("push helper safety check failed:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log("push helper safety check passed");
