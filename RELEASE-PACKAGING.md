# Temporary SDK bundle packaging

Keep this file in the repository root as maintainer documentation. It is not executable.

## Source files

- `scripts/pack-release.mjs`: release-only staging and packaging helper.
- `snUpload.js`: use the corrected application file based on `snUpload-beyla.js`.
- `RELEASE-PACKAGING.md`: this checklist.

Keep the existing SDK runtime dependency, `bundleDependencies`, development override, and
`package-lock.json`. Do not create `npm-shrinkwrap.json` for this workflow. Keep the existing
`pack:release` npm script; its command remains `node scripts/pack-release.mjs`.

The corrected application preserves the uploaded function arrangement, removes `opts.proxy = false`,
and restores the verbose Node/Axios version diagnostic. No environment-file changes are part of
this packaging correction.

## Build on the module-development workstation

From the module-development project:

```sh
npm run pack:release
```

For version 3.11.0, the result is:

```text
release/admc.com-sn-developer-3.11.0.tgz
```

The filename follows `package.json`. Use the normal version-update process before publishing;
`package-lock.json` must agree. Do not edit or install dependencies while packaging is running.

The helper does not publish, alter the development dependency tree, replace global modules, or
change shell settings. It stages a temporary copy and replaces an existing output archive only
after the new archive passes its checks. Normal success and failure remove temporary directories.
Forced process termination can leave a `sn-developer-pack-*` directory in the system temp directory.

## Changes confined to the release copy

1. Correct `@servicenow/isomorphic-rollup@1.3.14` to require `@fastify/http-proxy@11.6.10`.
   Remove the corresponding override from the staged root manifest only.
2. Preserve the existing AJV peer correction: when CycloneDX sees AJV 6.15.0, supply the existing
   AJV 8.20.0 with its required private dependencies beneath the SDK build plugin. Declare that
   provider in the staged plugin manifest so it is included in the bundle. ESLint is unchanged.
3. Ensure `@napi-rs/keyring-win32-x64-msvc@1.2.0` and `keyring.win32-x64-msvc.node` are physically
   present in the staged bundle. This corrects the confirmed Windows x64 omission.

### Windows keyring handling

An existing installed Windows binary is reused after version, platform, and entry-point checks.
If the binary is absent, the helper obtains the exact package using `npm pack` from the development
project directory. This honors that project's configured registry, scope settings, credentials,
proxy, and certificate settings; it does not hard-code or switch to another registry.

The downloaded archive's SHA-512 must match the entry in the development lockfile. The helper then
uses a separate empty temporary npm project to unpack that verified archive offline, with lifecycle
scripts disabled. The extraction command uses `-f` solely to allow a Windows package to be unpacked
on a non-Windows build machine. It does not run or compile the binary, install into the development
project, or use that flag for the consumer installation. npm's normal cache can be used or updated.

The native package is copied unchanged into the staged SDK dependency tree. The release check
requires both its manifest and its actual `.node` file in npm's archive file list; an optional
manifest entry alone is no longer accepted as evidence that the Windows binding is included.

`SDK-BUNDLE-PATCH.json` in the archive records the existing manifest corrections and the added
Windows package, including its native-binary SHA-256. These are publisher-maintained packaging
corrections, not upstream ServiceNow fixes. Only the confirmed Windows x64 keyring omission is
covered by this new addition; other platform/architecture combinations still require testing.

The staged dependency tree is checked with `npm ls -a --omit=dev`. Existing array-style and
package-keyed `npm pack --json` output are supported. Development lockfiles, npm registry config
files, Git metadata, old archives, and the output directory are excluded from staging. Source
package ignore/file-selection rules are retained. Packaging lifecycle scripts stay disabled;
adding `prepare`, `prepack`, or `postpack` to the project requires review.

## Transfer and test on the Windows user workstation

Transfer the newly built archive to the user workstation. Do not use `./release/` there unless
that directory actually exists there. Do not reuse the repaired `/o/sn-dev-test3` installation:
its separately installed keyring could mask a packaging failure.

From the directory containing the transferred archive, in Git for Windows Bash, use a new prefix:

```sh
NODE_USE_SYSTEM_CA=1 \
  HTTPS_PROXY="${SN_NODE_HTTPS_PROXY:?SN_NODE_HTTPS_PROXY is not set}" \
  https_proxy="$SN_NODE_HTTPS_PROXY" \
  npm i -g -C /o/sn-dev-test4 ./admc.com-sn-developer-3.11.0.tgz
```

These are the command-scoped network settings that succeeded in the previous Windows installation.
Other bundled native installers, including `libxmljs2`, can still require network access. This
keyring packaging fix does not make the entire installation offline or replace CA/proxy setup.

After installation, run from the regular script working directory with its normal configuration:

```sh
SN_DEVELOPER_INST=fanniemaedev \
  node /o/sn-dev-test4/node_modules/@admc.com/sn-developer/snUpload.js \
  -rv si.x/getStaticHtmlPublicationPayload.js
```

The SDK diagnostic must point inside `/o/sn-dev-test4`, not the existing shared SDK. The download
must succeed without a separate keyring installation or manual edits under the test prefix.
Do not reauthenticate merely because a packaging or transport test fails.

## Publish the tested archive

After the fresh Windows installation and download pass, publish that same archive from the
module-development workstation, using the normal approved registry/authentication settings:

```sh
npm publish ./release/admc.com-sn-developer-3.11.0.tgz
```

Do not substitute bare `npm pack` or bare `npm publish` from the source tree, which still contains
the development override. Commit the helper, corrected application, documentation, and existing
npm-script entry. Do not commit generated archives or the staged Windows package separately.

## Validation of this revision

- Syntax and 100-character line/whitespace checks passed for both changed scripts.
- Ten packaging fixture checks passed with npm 10.9.2: binary staging and archive inclusion,
  offline global installation, nested module resolution, existing-binary reuse, both pack-output
  shapes, checksum failure, entry-point/version guards, and missing/empty-binary rejection.
- The new source file passed three proxy-configuration checks without changing the caller's
  environment; the uploaded function arrangement was preserved.
- A metadata-only reconstruction of all 623 dependency entries in the supplied lockfile passed
  staging and packing, retained the AJV correction, and included the Windows binary fixture.

Registry fetching and the native payload were simulated in those tests. Package-keyed JSON was
simulated rather than tested with a complete npm 12 runtime. Windows execution and your corporate
registry were not available here. The fresh Windows archive test above remains necessary.
