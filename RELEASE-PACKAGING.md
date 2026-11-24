# Standard npm release workflow

Keep this document and `scripts/pack-release.mjs` in Git. The helper is now an automatic
`prepublishOnly` hook, not a separate manual archive-publishing workflow.

## One-time setup on the module-development workstation

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
including Windows binary presence, Undici versions, and exclusion of old release archives.
If applying or checking the generated files fails, the helper restores the affected dependency
paths and fails the publish. Do not run installations or edit dependencies concurrently.

The helper never invokes `npm publish`, and never changes the registry or its security policy.
Only the outer, ordinary `npm publish` command performs publication. A separate native installer
may still need your existing corporate proxy and certificate settings on consumer machines.
Nexus approval remains a registry policy decision, not a consequence of a successful build.

## Scope and validation

The dependency corrections retain their specific version guards. Unexpected versions fail
for review. The Windows binding is for Windows x64; other platforms require their own validation.

This revision was checked with the uploaded lockfile's 623 package entries reconstructed as
metadata fixtures: ordinary npm publish dry run, repeated preparation, unchanged source-manifest
checksums, corrected packed declarations, and removal of old release artifacts. A simulated
current npm bundled-override check found no applied override in the corrected bundle. Native
payloads in these fixtures were placeholders, not executed binaries. npm 10.9.2 was run locally;
a complete npm 12 installation and your corporate registry were not available here.
