const { execSync } = require("child_process");
const concat = require("concat-stream");
const conventionalCommitsFilter = require("conventional-commits-filter");
const conventionalRecommendedBump = require("conventional-recommended-bump");
const {
  whatBump: whatBumpAngular,
} = require("conventional-changelog-angular/conventional-recommended-bump");
const parser_opts_angular = require("conventional-changelog-angular/parser-opts");
const writer_opts_angular = require("conventional-changelog-angular/writer-opts");
const conventionalCommitsParser = require("conventional-commits-parser");
const conventionalChangelogConfig = require("conventional-changelog-conventionalcommits");
const conventionalGithubReleaser = require("./conventional-github-releaser");
const _ = require("fxjs");
const gitRawCommits = require("git-raw-commits");

const getLatestVersion = (app, tags) =>
  _.go(
    tags,
    _.sel("all"),
    _.filter((a) => a.startsWith(app)),
    _.last,
    _.split("@"),
    _.last
  );

const getCommits = (from, to) => {
  const options = { format: "%B%n-hash-%n%H", from };
  if (to !== undefined) {
    options.to = to;
  }
  return new Promise((resolve) => {
    gitRawCommits(options)
      .pipe(conventionalCommitsParser())
      .pipe(concat((data) => resolve(conventionalCommitsFilter(data))));
  });
};

const getRecommendation = (parser_options = {}, whatBump = whatBumpAngular) =>
  new Promise((resolve, reject) => {
    conventionalRecommendedBump(
      {
        preset: "angular",
        whatBump,
      },
      parser_options,
      (err, recommendation) => {
        if (err) return reject(err);
        else return resolve(recommendation);
      }
    );
  });

const applyRecommendation = (app, latest_tag, recommendation) => {
  const [major, minor, patch] = _.go(
    latest_tag,
    _.split("@"),
    _.last,
    _.split("."),
    _.map(Number)
  );
  const { releaseType } = recommendation;
  if (releaseType === "major") return `${major + 1}.0.0`;
  else if (releaseType === "minor") return `${major}.${minor + 1}.0`;
  else if (releaseType === "patch") return `${major}.${minor}.${patch + 1}`;
  else throw Error("releaseType 타입이 올바르지 않음");
};

const whatBumpFor = _.curry((app, commits) => {
  const scope_filtered_commits = commits.filter(
    ({ scope }) =>
      scope === null || scope.replace(/ /gi, "").split(",").includes(app)
  );
  return whatBumpAngular(scope_filtered_commits);
});

const getNextVersion = async (app, from, hash) => {
  const parser_options = _.pick(
    ["headerPattern", "breakingHeaderPattern"],
    (await conventionalChangelogConfig()).conventionalChangelog.parserOpts
  );
  const recommendation = await getRecommendation(parser_options, (commits) => {
    const from_index = commits.findIndex((c) => c.hash === hash);
    const filtered_commits = _.slice(0, from_index, commits);
    return whatBumpFor(app, filtered_commits);
  });
  return applyRecommendation(app, from, recommendation);
};

const npmVersion = async (app, version) => {
  execSync("npm config set git-tag-version false");
  execSync(`npm version ${version} -f`);
};

const generateReleaseNote = async (app, from, to) => {
  conventionalGithubReleaser(app)(
    {
      type: "oauth",
      url: "https://api.github.com",
      token: process.env.GITHUB_TOKEN,
    },
    {
      preset: "angular",
      tagPrefix: `${app}@`,
    },
    null,
    { from, to },
    parser_opts_angular,
    await writer_opts_angular,
    (err, responses) => {
      if (err) return console.log(err);
      console.log(responses);
      const { body, html_url } = (responses[0] && responses[0].body) || {};
      console.log(body);
      console.log(html_url);
    }
  );
};

const generateMergeCommitBody = (commits) =>
  _.go(
    commits,
    _.map(_.pick(["header", "hash"])),
    _.map(({ header, hash }) => `* ${header} (${hash})\n`),
    _.join("\n")
  );

module.exports = {
  getLatestVersion,
  getNextVersion,
  generateMergeCommitBody,
  getCommits,
  npmVersion,
  generateReleaseNote,
};
