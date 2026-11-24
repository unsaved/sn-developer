# Standard npm release workflow

Keep this document and `scripts/pack-release.mjs` in Git. Normal `npm publish` invokes the
existing `prepublishOnly` hook. No manual archive publishing is required.

## Dependency-tree correction: apply this revision

Replace `scripts/pack-release.mjs` and this repository-root document. Do not change
`snUpload.js`, the existing npm hook, application version, shell configuration, or credentials.
The previously instructed AJV and URI-replacement installation steps need not be repeated if
both completed successfully. No `--configure`, reinstall, root `npm prune`, or forced install
is needed for this correction.

From the module-development repository, run:

```sh
npm run prepublishOnly
```

The helper identifies this revision in its output:

```text
Publish preparation revision: dependency-tree-cleanup-1.
```

This revision corrects two preparation defects:

- After removing libxmljs2 and URI.js, inspect the actual staged graph with offline
  `npm query :extraneous`. Remove only the directories npm identifies as extraneous, and
  only from the temporary staging copy. Retain source-tree leftovers; assert that none of
  the excluded orphaned paths appear in the actual project's final publication file list.
  No dependency installation or network resolution is used for this cleanup.
- npm can deduplicate ESLint's AJV 6 copies to the application root. Supplying AJV 8 nearer
  those consumers then shadows AJV 6. Give each affected declared AJV 6 consumer a private
  copy of the existing 6.15.0 package. Retain AJV 8.20.0 for CycloneDX. Discover the actual
  reachable AJV 6 copies rather than requiring exactly three lockfile locations, and apply
  the existing URI backend correction to every one of them.

The full `npm ls -a --omit=dev` check remains blocking. No `ELSPROBLEMS`, missing dependency,
invalid version, or failed runtime check is ignored. The real-library checks additionally
verify that both ESLint entry points resolve AJV 6 and CycloneDX resolves AJV 8. They run
before and after application of generated changes. Failed final verification restores the
changed generated dependencies and hidden lock cache.

All existing security corrections, the Windows keyring, and ordinary `npm publish` remain.
After preparation and normal project tests pass, commit the helper/documentation and any
pending intentional package.json/package-lock.json edits. Continue the normal version,
commit/tag, and `npm publish` process below; do not increment a candidate version twice.

## URI.js correction for the next release

The reported CVE-2026-93690 affects `uri-js@4.4.1`. The original supplied dependency tree had three
AJV 6.15.0 copies requiring that package; npm can change their installed layout. Removing URI.js without replacing its callers would
break schema-reference handling used by linting.

This revision replaces AJV 6's URI backend with `uri-js-replace@1.0.3`. That is a different
implementation, not a renamed copy of URI.js and not an upstream AJV release. It keeps its
real package name and version. Its maintainer describes AJV/ESLint compatibility and includes
a regression test for the reported Unicode-separator infinite loop. That statement does not
prove complete semantic equivalence; the preparation checks and application tests still apply.

### Apply on the module-development workstation

Replace `scripts/pack-release.mjs` and this document. Leave the current `snUpload.js`, existing
publish hook, proxy settings, and OAuth credentials unchanged. Do not rerun `--configure`.

For a checkout that has not installed these build inputs, run from the repository root:

```sh
npm i -P -E -B ajv@6.15.0 &&
npm i -D -E uri-js-replace@1.0.3 &&
npm run prepublishOnly
```

AJV 6.15.0 already exists transitively in the supplied project. The first command explicitly
bundles that same version as an application dependency. This is necessary because the
application's unbundled ESLint 8 must resolve the corrected AJV too, rather than install an
unmodified AJV/URI.js combination later. This is not an AJV 8 migration.

The second command records the replacement as an exact development/build input, with its
registry integrity recorded by npm in package-lock.json. The patched AJV manifests give it a
runtime dependency edge, so it is included in the published bundle even though its root entry
is a development dependency. Do not omit development dependencies when preparing a release.
These commands use the configured registry; no alternate registry or policy bypass is set.

Preparation must print both:

```text
URI regression, AJV reference validation, and ESLint smoke checks passed.
URI.js replacement passed for staging and ordinary npm publish.
```

It checks the actual installed libraries in a separate Node process with a timeout and heap
limit. An incompatible or hanging resolver stops preparation before publication. Failure in
these checks is not a reason to suppress them or publish with --ignore-scripts.

### What the hook changes

Only generated dependency files under node_modules are changed during preparation:

- All reachable AJV 6.15.0 manifests require uri-js-replace 1.0.3 instead of uri-js. Their Node
  resolver imports are changed to that dependency's real name. Other AJV validation code stays
  unchanged.
- The original node_modules/uri-js package is removed. The original library is not installed
  under an alias, and no fictitious fixed version is assigned to it.
- The prebuilt AJV 6 browser bundles under each dist directory are removed rather than shipping
  an unreconstructed browser payload. Node entry points under lib remain. Direct consumers of
  these browser bundles are outside this CLI package's supported workflow.
- Both the staged and actual-project packlists reject original URI.js packages, runtime
  dependency declarations, npm aliases, and the omitted AJV 6 browser bundles. They require
  the new runtime package and every corrected resolver file.
- Actual-library checks cover Unicode U+2028/U+2029 and CR/LF paths, relative reference
  resolution, valid and invalid AJV schemas/data, escaped JSON Pointer references, recursive
  references, and both the application's ESLint 8 and the SDK's ESLint 9 Linter entry points.

The checks run before and after applying prepared files. On an application/check failure,
changed generated paths are restored, including deleted URI.js and the hidden npm lock cache.
Tracked source manifests are not rewritten by the hook. Dependency installation above does
update package.json and package-lock.json; commit those intentional input changes.

This is a targeted compatibility/security correction, not proof that all possible schema,
SDK, lint-plugin, or browser uses remain identical. The replacement maintainer's compatibility
claim is not a blanket security certification. Nexus must evaluate the resulting release.

## Existing corrections retained

The helper retains the previously tested corrections:

- isomorphic-rollup 1.3.14 requires http-proxy 11.6.10.
- SDK CLI 4.14.2 requires and includes Undici 7.30.2, including its private copy.
- CycloneDX has its own AJV 8.20.0 provider and required private dependencies.
- libxmljs2 and its optional installation/peer declarations remain excluded; CycloneDX's
  optional XML-schema-validation backend remains unavailable.
- The Windows x64 keyring 1.2.0 package and actual native binary remain included. If absent on
  the development machine, the existing configured-registry fetch and lockfile-checksum
  verification are used. Other optional dependencies are not blanket-omitted.

The SDK manifest's snDeveloperBundlePatch records these corrections and the URI replacement,
its input integrity, its affected AJV paths, and the omitted browser payloads. The source
lockfile describes upstream inputs plus the new build input, not the entire generated patched
output. An npm ci restores upstream inputs; the next hook invocation reapplies corrections.

## Commit, version, and publish normally

After preparation and the project's normal tests pass:

```sh
git add package.json package-lock.json scripts/pack-release.mjs RELEASE-PACKAGING.md &&
git commit -m "Replace vulnerable URI.js in bundled AJV dependencies" &&
npm version patch &&
npm publish
```

Starting from 3.11.3, this selects 3.11.4. Skip a version increment already performed for an
unpublished candidate. Keep your normal Git commit/tag push procedure. Do not use a manual
archive path or special distribution tag. Do not use --ignore-scripts to publish.

## User-workstation acceptance

On the Windows user workstation in Git Bash, from the ordinary working directory, use the
normal environment and normal latest-version installation. Do not pin an installation version
or repair dependencies manually:

```sh
npm i -g @admc.com/sn-developer &&
npm view @admc.com/sn-developer dist-tags.latest &&
npm ls -g @admc.com/sn-developer --depth=0 &&
snUpload -l si.x/getStaticHtmlPublicationPayload.js &&
snUpload -rv si.x/getStaticHtmlPublicationPayload.js
```

The installed version must match the intended new release and latest tag. The ordinary
executable must find its SDK inside the normal global installation. Both configured linting
and the download must work. Retain normal multi-instance and upload/download regression tests.
A read-only download alone does not exercise this change's linting dependency path.

## Initial configuration of a different checkout

For a repository that does not yet have the normal publishing hook, use the existing
`node scripts/pack-release.mjs --configure` setup once, then install the two inputs above.
Configuration adds prepublishOnly, preserves the SDK override limited to the original
http-proxy@11.4.4 requirement, and excludes old release files through .npmignore. It is not
needed again for a checkout already using the normal hook.

## Validation of the dependency-tree correction

Node 22.16.0 and npm 10.9.2 were used with metadata fixtures derived from the supplied
623-package lockfile, the two previously instructed build inputs, and a deliberately
hoisted/deduplicated AJV layout. Nine checks passed:

1. Complete supplied graph: staged npm ls and real npm pack pass with tracked inputs unchanged.
2. Repeated preparation passes with tracked input hashes unchanged.
3. Deduplicated graph: two private AJV 6 providers are restored; AJV 8 is retained; ls/pack pass.
4. The deduplicated layout remains repeatable.
5. An unrelated missing dependency still blocks preparation.
6. Injected final-pack failure restores generated paths, deleted XML/URI, and the hidden lock.
7. The delivered helper parses, has no trailing whitespace, and uses at most 100-character lines.
8. The older XML-removal helper reproduces both the extraneous packages and invalid AJV 8 failure.
9. An unrelated incompatible dependency version remains a blocking npm ls error.

npm query, npm ls, and npm pack were actually executed. Library bodies and the Windows native
payload were fixtures, and library runtime execution was substituted in this test harness.
The delivered helper retains its real URI/AJV/ESLint runtime checks; it has no test bypass.
Actual URI/AJV/ESLint runtime compatibility, npm 12, Windows, and FM Nexus were not tested here.
These tests do not claim security-policy clearance or replace application acceptance testing.

## Sources

- User-supplied FM Nexus report for CVE-2026-93690, version 3.11.3.
- https://github.com/advisories/GHSA-ffpj-9hx9-929p
- https://raw.githubusercontent.com/ajv-validator/ajv/v6.15.0/package.json
- https://raw.githubusercontent.com/ajv-validator/ajv/v6.15.0/lib/compile/resolve.js
- https://github.com/andreinwald/uri-js-replace
- https://raw.githubusercontent.com/andreinwald/uri-js-replace/master/test/cve/CVE-2026-93690.test.ts
