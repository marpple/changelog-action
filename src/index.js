const core = require("@actions/core");
const simpleGit = require("simple-git");
const _ = require("fxjs");
const {
  getLatestVersion,
  getNextVersion,
  generateMergeCommitBody,
  getCommits,
  npmVersion,
  generateReleaseNote,
} = require("./conventional-release.js");
const git = simpleGit();

async function main(app, ref) {
  const latest_version = await getLatestVersion(app);
  const latest_tag = `${app}@${latest_version}`;
  const next_version = await getNextVersion(app, latest_tag);
  const next_tag = `${app}@${next_version}`;
  const merge_commit_message_body = generateMergeCommitBody(
    await getCommits(latest_tag)
  );
  const release_branch = `release-${app}-${next_version}`;

  await git
    .addTag(next_tag)
    .checkoutBranch(release_branch, latest_tag)
    .merge([next_tag, "--squash"])
    .commit(next_version);

  const squash_commit_hash = _.sel(
    "hash",
    _.last(await getCommits(latest_tag))
  );

  await git.checkout(app).raw("cherry-pick", squash_commit_hash);
  await npmVersion(app, next_version);
  await git
    .add("./package*.json")
    .commit([next_tag, merge_commit_message_body], ["--amend"])
    .push("origin", next_tag)
    .push("origin", app);

  await git.checkout(ref);
  await generateReleaseNote(app, latest_tag, next_tag);
}

main(core.getInput("app"), core.getInput("ref"));
