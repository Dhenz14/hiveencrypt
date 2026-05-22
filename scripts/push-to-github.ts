// Safe GitHub push helper.
// Usage: npx tsx scripts/push-to-github.ts "Your commit message"

import { spawnSync } from "node:child_process";

function run(command: string, args: string[], options: { allowFailure?: boolean } = {}) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result.status ?? 1;
}

function hasStagedChanges(): boolean {
  return spawnSync("git", ["diff", "--cached", "--quiet"], { stdio: "ignore" }).status !== 0;
}

function main() {
  const commitMessage = process.argv[2] || "Update from workspace";

  console.log("[push] staging changes");
  run("git", ["add", "-A"]);

  if (hasStagedChanges()) {
    console.log(`[push] committing: ${commitMessage}`);
    run("git", ["commit", "-m", commitMessage]);
  } else {
    console.log("[push] nothing new to commit");
  }

  console.log("[push] pushing current HEAD to origin/main");
  run("git", ["push", "origin", "HEAD:main"]);
  console.log("[push] done");
}

try {
  main();
} catch (error) {
  console.error("[push] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
