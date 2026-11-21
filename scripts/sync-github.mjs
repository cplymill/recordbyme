import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const read = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const run = (...args) => execFileSync("git", args, { cwd, stdio: "inherit" });

try {
	const branch = read("branch", "--show-current");
	if (!branch) throw new Error("Check out a local branch before syncing.");
	if (read("status", "--porcelain")) throw new Error("Commit or stash your local edits, then sync again.");
	const remote = read("for-each-ref", "--format=%(upstream:remotename)", "refs/heads/" + branch);
	const ref = read("for-each-ref", "--format=%(upstream:remoteref)", "refs/heads/" + branch);
	if (remote !== "origin" || !ref.startsWith("refs/heads/")) {
		throw new Error("Set this branch to track its matching branch on origin before syncing.");
	}
	run("fetch", "origin", ref);
	run("merge", "--ff-only", "FETCH_HEAD");
	run("push", "origin", "HEAD:" + ref);
	console.log("Synced " + branch + " with origin/" + ref.slice(11) + ".");
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
