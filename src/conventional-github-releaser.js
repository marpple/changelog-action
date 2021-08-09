const assign = require("object-assign");
const conventionalChangelog = require("conventional-changelog");
const dateFormat = require("dateformat");
const gitSemverTags = require("git-semver-tags");
const ghGot = require("gh-got");
const merge = require("lodash.merge");
const Q = require("q");
const semver = require("semver");
const through = require("through2");

function semverRegex() {
  return /(?<=^v?|\sv?)(?:(?:0|[1-9]\d*)\.){2}(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[\da-z-]*[a-z-][\da-z-]*)(?:\.(?:0|[1-9]\d*|[\da-z-]*[a-z-][\da-z-]*))*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?\b/gi;
}

function transform(chunk, cb) {
  console.log(chunk);
  if (typeof chunk.gitTags === "string") {
    chunk.version = (chunk.gitTags.match(semverRegex()) ||
      chunk.gitTags.match(/\d*\.\d*\.\d*/) ||
      [])[0];
  }

  if (chunk.committerDate) {
    chunk.committerDate = dateFormat(chunk.committerDate, "yyyy-mm-dd", true);
  }

  if (typeof chunk.hash === "string") {
    chunk.shortHash = chunk.hash.substring(0, 7);
  }

  if (typeof cb === "function") cb(null, chunk);
  else return chunk;
}

/* eslint max-params: ["error", 7] */
function conventionalGithubReleaser(
  auth,
  changelogOpts,
  context,
  gitRawCommitsOpts,
  parserOpts,
  writerOpts,
  userCb
) {
  if (!auth) {
    throw new Error("Expected an auth object");
  }

  const promises = [];

  const changelogArgs = [
    changelogOpts,
    context,
    gitRawCommitsOpts,
    parserOpts,
    writerOpts,
  ].map(function (arg) {
    if (typeof arg === "function") {
      userCb = arg;
      return {};
    }
    return arg || {};
  });

  if (!userCb) {
    throw new Error("Expected an callback");
  }

  changelogOpts = changelogArgs[0];
  context = changelogArgs[1];
  gitRawCommitsOpts = changelogArgs[2];
  parserOpts = changelogArgs[3];
  writerOpts = changelogArgs[4];

  changelogOpts = merge(
    {
      transform: transform,
      releaseCount: 1,
    },
    changelogOpts
  );

  writerOpts.includeDetails = true;

  writerOpts.transform = transform;

  // ignore the default header partial
  writerOpts.headerPartial = "";

  const resolve = function (tags) {
    if (!tags || !tags.length) {
      setImmediate(userCb, new Error("No semver tags found"));
      return;
    }

    const releaseCount = changelogOpts.releaseCount;
    if (releaseCount !== 0) {
      gitRawCommitsOpts = assign(
        {
          from: tags[releaseCount],
        },
        gitRawCommitsOpts
      );
    }

    gitRawCommitsOpts.to = gitRawCommitsOpts.to || tags[0];

    console.log("changelogOpts", changelogOpts);
    console.log("gitRawCommitsOpts", gitRawCommitsOpts);

    conventionalChangelog(
      changelogOpts,
      context,
      gitRawCommitsOpts,
      parserOpts,
      writerOpts
    )
      .on("error", function (err) {
        userCb(err);
      })
      .pipe(
        through.obj(
          function (chunk, enc, cb) {
            if (!chunk.keyCommit || !chunk.keyCommit.version) {
              cb();
              return;
            }

            const url = `repos/${context.owner}/${context.repository}/releases`;
            const tag_name = `${changelogOpts.tagPrefix || ""}${
              chunk.keyCommit.version
            }`;

            const options = {
              endpoint: auth.url,
              body: {
                body: chunk.log,
                draft: changelogOpts.draft || false,
                name: changelogOpts.name || tag_name,
                prerelease:
                  semver.parse(chunk.keyCommit.version).prerelease.length > 0,
                tag_name,
                target_commitish: changelogOpts.targetCommitish,
              },
            };

            // debug(`posting %o to the following URL - ${url}`, options);
            // Set auth after debug output so that we don't print auth token to console.
            options.token = auth.token;

            promises.push(ghGot.post(url, options));

            cb();
          },
          function () {
            Q.all(promises)
              .then(function (responses) {
                userCb(null, responses);
              })
              .catch(function (err) {
                userCb(err);
              });
          }
        )
      );
  };

  Q.nfcall(
    gitSemverTags,
    { tagPrefix: changelogOpts.tagPrefix || "" },
    function (err, tags) {
      console.log("gitSemverTags");
      console.log(tags);
      if (err) userCb(err);
      else resolve(tags);
    }
  );
}

module.exports = conventionalGithubReleaser;
