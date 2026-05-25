// Guarded GitHub push helper.
// Usage: npx tsx scripts/push-to-github.ts "Your commit message"
// Add --include-untracked only after manually reviewing untracked files.

import { spawnSync } from "node:child_process";

const EXPECTED_REMOTE = "Dhenz14/hiveencrypt";

type Options = {
  commitMessage: string;
  includeUntracked: boolean;
};

function run(command: string, args: string[], options: { allowFailure?: boolean } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result.status ?? 1;
}

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result.stdout.trim();
}

function parseArgs(argv: string[]): Options {
  const messageParts: string[] = [];
  let includeUntracked = false;

  for (const arg of argv) {
    if (arg === "--include-untracked") {
      includeUntracked = true;
    } else {
      messageParts.push(arg);
    }
  }

  const commitMessage = messageParts.join(" ").trim();
  if (!commitMessage) {
    throw new Error("Explicit commit message required");
  }

  return { commitMessage, includeUntracked };
}

function assertMainBranch() {
  const branch = capture("git", ["branch", "--show-current"]);
  if (branch !== "main") {
    throw new Error(`Refusing to push from branch ${branch}; expected main`);
  }
}

function assertExpectedRemote() {
  const remoteUrl = capture("git", ["remote", "get-url", "origin"]);
  if (!remoteUrl.includes(EXPECTED_REMOTE)) {
    throw new Error(`Refusing to push to unexpected origin remote: ${remoteUrl}`);
  }
}

function assertNoUntrackedFilesUnlessExplicit(includeUntracked: boolean) {
  const untracked = capture("git", ["ls-files", "--others", "--exclude-standard"]);
  if (untracked && !includeUntracked) {
    throw new Error(
      [
        "Refusing to stage untracked files without --include-untracked.",
        "Review these files first:",
        untracked,
      ].join("\n"),
    );
  }
}

function assertHeadIncludesOriginMain() {
  const status = spawnSync("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"], {
    stdio: "ignore",
  }).status;
  if (status !== 0) {
    throw new Error("Refusing to push: local HEAD does not include origin/main");
  }
}

function hasStagedChanges(): boolean {
  return spawnSync("git", ["diff", "--cached", "--quiet"], { stdio: "ignore" }).status !== 0;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  assertMainBranch();
  assertExpectedRemote();

  console.log("[push] fetching origin/main");
  run("git", ["fetch", "origin", "main"]);
  assertHeadIncludesOriginMain();
  assertNoUntrackedFilesUnlessExplicit(options.includeUntracked);

  console.log(
    options.includeUntracked
      ? "[push] staging tracked and reviewed untracked files"
      : "[push] staging tracked file updates only",
  );
  run("git", options.includeUntracked ? ["add", "-A"] : ["add", "-u"]);

  if (hasStagedChanges()) {
    console.log(`[push] committing: ${options.commitMessage}`);
    run("git", ["commit", "-m", options.commitMessage]);
  } else {
    console.log("[push] nothing new to commit");
  }

  console.log("[push] running TypeScript check");
  run("npm", ["run", "check"]);

  console.log("[push] verifying origin/main still ancestors local HEAD");
  run("git", ["fetch", "origin", "main"]);
  assertHeadIncludesOriginMain();

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
