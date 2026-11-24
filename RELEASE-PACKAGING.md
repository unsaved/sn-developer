# Standard npm release workflow

Keep this document and `scripts/pack-release.mjs` in Git. The helper is now an automatic
`prepublishOnly` hook, not a separate manual archive-publishing workflow.

## Existing configured repositories: libxmljs2 correction

Replace `scripts/pack-release.mjs` and this document. Keep the current `snUpload.js`,
root dependency settings, lockfile, and workstation environment. The existing
`prepublishOnly` hook is unchanged; do not rerun `--configure` for this update.

The hook now removes the optional `libxmljs2` component responsible for the reported
CVE-2024-34393 and sonatype-2018-0585 findings. It removes the SDK build plugin's optional
installation requirement, CycloneDX's optional peer declaration/metadata, and the complete
installed `node_modules/libxmljs2` directory. Other optional dependencies, including the
Windows keyring, are retained. This removes the component, not the scanner's detection.

Before committing and incrementing the release version, run:

```sh
npm run prepublishOnly
```

Expected additional success message:

```text
libxmljs2 exclusion passed for staging and ordinary npm publish.
```

This does not publish, change the version, or rewrite tracked manifests. It updates
generated dependencies under `node_modules`. Failed application/checking of those updates
restores affected paths, including the removed XML package and npm's hidden lock cache.

Commit the two changed source files, then follow the normal release workflow below.
From 3.11.2, `npm version patch` selects 3.11.3. Do not increment twice if an unpublished
candidate version has already been selected.

## One-time setup for repositories not configured yet

Replace `scripts/pack-release.mjs` and this document with the matching new versions. From
that repository, run:

```sh
node scripts/pack-release.mjs --configure
```

Configuration makes only these source changes:

- Adds `scripts.prepublishOnly = "node scripts/pack-release.mjs"`.
- Removes the old `pack:release` entry if it still names that same helper.
- Narrows the existing SDK override to `@fastify/http-proxy@11.4.4`, retaining `11.6.10`
  as its replacement. It no longer applies after the installed declaration is corrected.
- Adds exclusions for `/release/`, root `.tgz` files, and the obsolete root patch report to
  `.npmignore`. When creating that file, it preserves existing `.gitignore` rules.

The application version, dependency versions, root lockfile, application code, shell,
registry, proxy, CA settings, and Git history are not changed by configuration.

Review and commit `package.json`, `.npmignore`, `scripts/pack-release.mjs`, and this document.
Preserve any other intentional source changes in your usual commit workflow.

## Release normally

After committing source changes and tests, use your normal version command, for example:

```sh
npm version patch
npm publish
```

Skip the version command when you already set the intended unpublished release version.
Use your normal Git push and tag-push process. No separate packing command, archive path,
manual archive transfer, or alternate distribution tag is required.

Do not use `--ignore-scripts` for publishing: it would suppress preparation. An existing
unmodified installed dependency tree needs the hook to become publishable.

## What publishing prepares automatically

npm invokes `prepublishOnly` before its packaging checks. The helper copies the installed
tree to temporary staging, applies and verifies the existing corrections, then installs
only the corrected generated dependency files under the project's `node_modules`:

- `isomorphic-rollup` requires the installed `http-proxy` 11.6.10.
- SDK CLI requires and contains Undici 7.30.2 rather than its old private 7.29.1 copy.
- The SDK build-plugin subtree receives the existing AJV 8 provider and private dependencies.
- The vulnerable optional XML validator and its known installation/peer declarations are
  removed. Staged and final packlists reject libxmljs2 payloads, package aliases, and any
  remaining runtime/optional/peer requirements that could restore the excluded package.
- The Windows x64 keyring package and its native binary are present; the existing checksum-
  verified registry-fetch behavior is retained when the development machine lacks the binary.

Preparation does not modify the root `package.json`, `package-lock.json`, or other tracked
source files. It invalidates npm's hidden `node_modules/.package-lock.json` cache after
editing installed dependencies. The explicit dependency patches remain tracked in this helper;
the root lockfile describes upstream installation inputs, not the generated patched output.
An `npm ci` can restore upstream inputs; the next publish reapplies preparation.

The patch report is embedded in the installed SDK's `package.json` under
`snDeveloperBundlePatch`, so it accompanies the published package without adding a generated
root file to Git. The helper checks the actual project packlist before allowing publication,
including Windows binary presence, Undici versions, XML-validator exclusion, and old-archive
exclusion.
If applying or checking the generated files fails, the helper restores the affected dependency
paths and fails the publish. Do not run installations or edit dependencies concurrently.

The helper never invokes `npm publish`, and never changes the registry or its security policy.
Only the outer, ordinary `npm publish` command performs publication. A separate native installer
may still need your existing corporate proxy and certificate settings on consumer machines.
Nexus approval remains a registry policy decision, not a consequence of a successful build.

## Functional scope and acceptance

The bundled copy intentionally no longer supplies CycloneDX's optional XML schema
validation backend. Commands needing that backend cannot be assumed to work. This is not
a replacement for the full SDK's XML-validation feature set. Authentication, record-transfer,
proxy, and login-message code in `snUpload.js` is unchanged by this update.

CycloneDX's maintainer identifies libxmljs2 as an optional XML-validation dependency and
documents operation without optional dependencies. This supports targeted removal but is
not proof that every SDK command works without it. No JavaScript adapter is replaced with
a dummy validator or made to report validation success.

After normal publication, on the Windows user workstation in Git Bash, run from the usual
script working directory with the working environment:

```sh
npm i -g @admc.com/sn-developer &&
npm view @admc.com/sn-developer dist-tags.latest &&
npm ls -g @admc.com/sn-developer --depth=0 &&
snUpload -rv si.x/getStaticHtmlPublicationPayload.js
```

This acceptance test deliberately uses default version selection and the normal global
installation and executable. Verify the intended new version, a matching latest tag, and
the SDK path inside the normal global installation. No manual dependency repair should
be needed. Apply the release's normal round-trip and multi-instance checks as well.
Nexus must evaluate the new release; removal of these findings is not a guarantee that no
other security policies will block it.

Sources:
- User-supplied Sonatype report: sonatype-2018-0585, libxmljs2/src/xml_element.cc.
- https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2024/34xxx/CVE-2024-34393.json
- https://github.com/CycloneDX/cyclonedx-javascript-library/issues/1079

## Scope and validation

The dependency corrections retain their specific version guards. Unexpected versions fail
for review. The Windows binding is for Windows x64; other platforms require their own validation.

Tested using Node 22.16.0 and npm 10.9.2 with synthetic package contents reconstructed from
all 623 dependency entries in the supplied lockfile. Ten checks passed: normal publish
dry-run; unchanged tracked-file hashes; XML declarations and payload removal; preserved
Windows/Undici corrections; repeat execution; actual compressed archive inspection; clean
offline global fixture installation; rejection of a now-required XML dependency; rejection
of a libxmljs2 alias; and rollback after an injected final-pack failure.

For the offline fixture install only, the test bundled normally unbundled application
dependencies. The delivered helper does not change the bundle list. Native files and
JavaScript bodies were placeholders, not executable Windows binaries or the actual SDK.
Live SDK authentication, Windows execution, and Nexus policy evaluation were not tested.
The previous npm-12 output handling and Windows binary fetching code are retained.
