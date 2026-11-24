#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
    realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Temporary publisher-side patch, restricted to the tested SDK dependency versions.
const projectRoot = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const sdkPath = "node_modules/@servicenow/sdk";
const rollupPath = "node_modules/@servicenow/isomorphic-rollup";
const proxyPath = "node_modules/@fastify/http-proxy";
const sdkCliPath = "node_modules/@servicenow/sdk-cli";
const buildPluginPath = "node_modules/@servicenow/sdk-build-plugins";
const xmlPath = "node_modules/libxmljs2";
const undiciPath = "node_modules/undici";
const sdkUndiciPath = `${sdkCliPath}/node_modules/undici`;
const patchedUndiciVersion = "7.30.2";
const windowsKeyring = "@napi-rs/keyring-win32-x64-msvc";
const windowsKeyringPath = `node_modules/${windowsKeyring}`;
const windowsBinary = "keyring.win32-x64-msvc.node";
const readJson = filename => JSON.parse(readFileSync(filename, "utf8"));
const writeJson = (filename, value) => {
    writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
};
// npm 10/11 return an array; npm 12 returns an object keyed by package name.
const readPackResult = (text, name) => {
    const output = JSON.parse(text);
    assert(output && typeof output === "object", "Unexpected npm pack JSON result.");
    const packed = Array.isArray(output) ? output[0] : output[name];
    assert(packed && Array.isArray(packed.files),
      `npm pack returned no file manifest for '${name}'.`);
    assert.equal(packed.name, name, "Unexpected package name from npm pack.");
    return packed;
};
// Check both prepared and final packlists, including aliases and dependency declarations.
const assertXmlExcluded = (root, files) => {
    for (const file of files) {
        assert(!/(?:^|\/)node_modules\/libxmljs2(?:\/|$)/.test(file.path),
          `Excluded libxmljs2 payload would be published: ${file.path}`);
        if (file.path !== "package.json" &&
          !/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(file.path)) continue;
        const pkg = readJson(path.join(root, file.path));
        assert.notEqual(pkg.name, "libxmljs2", `Excluded package found: ${file.path}`);
        for (const field of ["dependencies", "optionalDependencies", "peerDependencies"])
            for (const [name, spec] of Object.entries(pkg[field] || {}))
                assert(name !== "libxmljs2" && !/^npm:libxmljs2(?:@|$)/.test(spec),
                  `libxmljs2 dependency remains in ${file.path}: ${field}.${name}`);
    }
};
// One-time tracked configuration; normal publishing never edits source manifests.
if (process.argv[2] === "--configure") {
    const packageFile = path.join(projectRoot, "package.json");
    const manifest = readJson(packageFile);
    assert.equal(manifest.name, "@admc.com/sn-developer", "Unexpected project.");
    const hook = "node scripts/pack-release.mjs";
    assert(!manifest.scripts?.prepublishOnly || manifest.scripts.prepublishOnly === hook,
      "Existing prepublishOnly hook needs reconciliation; configuration was not changed.");
    const overrides = manifest.overrides?.["@servicenow/sdk"];
    assert(overrides, "Expected the SDK development override.");
    assert.equal(overrides["@fastify/http-proxy"] ||
      overrides["@fastify/http-proxy@11.4.4"], "11.6.10", "Unexpected proxy override.");
    delete overrides["@fastify/http-proxy"];
    overrides["@fastify/http-proxy@11.4.4"] = "11.6.10";
    manifest.scripts = { ...manifest.scripts, prepublishOnly: hook };
    if (manifest.scripts["pack:release"] === hook) delete manifest.scripts["pack:release"];
    const ignoreFile = path.join(projectRoot, ".npmignore");
    const inheritedIgnore = path.join(projectRoot, ".gitignore");
    const ignored = existsSync(ignoreFile) ? readFileSync(ignoreFile, "utf8") :
      existsSync(inheritedIgnore) ? readFileSync(inheritedIgnore, "utf8") : "";
    const ignoreLines = ignored.split(/\r?\n/);
    for (const pattern of ["/release/", "/*.tgz", "/SDK-BUNDLE-PATCH.json"])
        if (!ignoreLines.includes(pattern)) ignoreLines.push(pattern);
    writeFileSync(ignoreFile, `${ignoreLines.join("\n").replace(/\n*$/, "")}\n`);
    writeJson(packageFile, manifest);
    console.warn("Configured package.json and .npmignore. Commit these with the helper.");
    console.warn("Use your normal version, Git, and npm publish workflow.");
    process.exit(0);
}
assert.equal(process.argv.length, 2, "Only --configure is accepted as an argument.");
let temporaryRoot;

try {
    const manifest = readJson(path.join(projectRoot, "package.json"));
    const lock = readJson(path.join(projectRoot, "package-lock.json"));
    const npmCli = process.env.npm_execpath;
    assert(npmCli && existsSync(npmCli), "Run through npm publish or npm run prepublishOnly.");
    assert.equal(manifest.name, "@admc.com/sn-developer", "Unexpected project.");
    assert.equal(lock.lockfileVersion, 3, "Expected a version-3 package-lock.json.");
    assert.equal(lock.version, manifest.version, "Package and lockfile versions differ.");
    assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies,
      "Package and lockfile dependencies differ; finish the development installation first.");
    assert.equal(manifest.dependencies["@servicenow/sdk"], "4.14.2",
      "Review the release patch before changing SDK versions.");
    assert(manifest.bundleDependencies?.includes("@servicenow/sdk"), "SDK must be bundled.");
    assert.equal(manifest.overrides?.["@servicenow/sdk"]?.["@fastify/http-proxy@11.4.4"], "11.6.10",
      "Run node scripts/pack-release.mjs --configure before publishing.");
    assert.equal(lock.packages[rollupPath]?.version, "1.3.14", "Unexpected rollup version.");
    assert.equal(lock.packages[rollupPath]?.dependencies?.["@fastify/http-proxy"], "11.4.4",
      "The upstream dependency changed; review this temporary patch.");
    assert.equal(lock.packages[proxyPath]?.version, "11.6.10", "Unexpected http-proxy version.");
    assert(!existsSync(path.join(projectRoot, "npm-shrinkwrap.json")),
      "Remove the obsolete shrinkwrap from the release workflow before continuing.");
    assert(!["prepare", "prepack", "postpack"].some(name => manifest.scripts?.[name]),
      "A packaging lifecycle hook was added; review its interaction with pack:release first.");

    // Validate installed bundle versions without reinstalling or changing the development tree.
    for (const [location, locked] of Object.entries(lock.packages)) {
        if (!locked.inBundle) continue;
        assert(!locked.link, `Linked bundle dependency is unsupported: ${location}`);
        const directory = path.join(projectRoot, location);
        const packageFile = path.join(directory, "package.json");
        if (!existsSync(packageFile) && locked.optional) continue;
        assert(existsSync(packageFile), `Missing installed bundle dependency: ${location}`);
        assert.equal(path.relative(directory, realpathSync(directory)), "",
          `Bundle dependency has a linked directory: ${location}`);
        assert(!lstatSync(packageFile).isSymbolicLink(), `Linked manifest: ${location}`);
        const installedVersion = readJson(packageFile).version;
        assert(installedVersion === locked.version ||
          location === sdkUndiciPath && installedVersion === patchedUndiciVersion,
          `Installed version differs from package-lock.json: ${location}`);
    }

    const archiveName = `${manifest.name.slice(1).replace("/", "-")}-${manifest.version}.tgz`;
    temporaryRoot = mkdtempSync(path.join(tmpdir(), "sn-developer-pack-"));
    const stageRoot = path.join(temporaryRoot, "package");
    console.warn("Preparing SDK dependencies for npm publish; tracked files stay unchanged.");
    cpSync(projectRoot, stageRoot, {
        recursive: true,
        verbatimSymlinks: true,
        filter: source => {
            const relative = path.relative(projectRoot, source);
            const first = relative.split(path.sep)[0];
            // Retain .npmignore/.gitignore so npm still controls which source files are packed.
            return ![".git", "release"].includes(first) &&
              ![".npmrc", ".package-lock.json"].includes(path.basename(source)) &&
              !(relative === first && relative.endsWith(".tgz")) &&
              !["package.json", "package-lock.json"].includes(relative);
        },
    });

    // Correct the copied dependency declaration, not just the root override.
    const rollupFile = path.join(stageRoot, rollupPath, "package.json");
    const rollup = readJson(rollupFile);
    assert(["11.4.4", "11.6.10"].includes(rollup.dependencies?.["@fastify/http-proxy"]),
      "Installed rollup manifest differs from the expected dependency declaration.");
    rollup.dependencies["@fastify/http-proxy"] = "11.6.10";
    writeJson(rollupFile, rollup);
    delete manifest.overrides["@servicenow/sdk"]["@fastify/http-proxy@11.4.4"];
    if (Object.keys(manifest.overrides["@servicenow/sdk"]).length === 0)
        delete manifest.overrides["@servicenow/sdk"];
    if (Object.keys(manifest.overrides).length === 0) delete manifest.overrides;
    writeJson(path.join(stageRoot, "package.json"), manifest);
    // CVE-2026-120415: replace the nested payload and its exact SDK dependency requirement.
    assert.equal(lock.packages[undiciPath]?.version, patchedUndiciVersion,
      "Expected the already-installed Undici 7.30.2 source; review the release patch.");
    assert.equal(lock.packages[sdkUndiciPath]?.version, "7.29.1",
      "The nested Undici version changed; review the release patch.");
    const sdkCliFile = path.join(stageRoot, sdkCliPath, "package.json");
    const sdkCliManifest = readJson(sdkCliFile);
    assert.equal(sdkCliManifest.version, "4.14.2", "Unexpected SDK CLI version.");
    assert(["7.29.1", patchedUndiciVersion].includes(sdkCliManifest.dependencies?.undici),
      "The SDK CLI's Undici dependency changed; review the release patch.");
    const undiciSource = path.join(stageRoot, undiciPath);
    const undiciManifest = readJson(path.join(undiciSource, "package.json"));
    assert.equal(undiciManifest.name, "undici", "Unexpected Undici source package.");
    assert.equal(undiciManifest.version, patchedUndiciVersion, "Unexpected Undici source version.");
    assert(existsSync(path.join(undiciSource, "index.js")), "Undici source payload is missing.");
    const undiciDestination = path.join(stageRoot, sdkUndiciPath);
    assert(["7.29.1", patchedUndiciVersion].includes(
      readJson(path.join(undiciDestination, "package.json")).version),
      "Installed nested Undici differs from the expected version.");
    rmSync(undiciDestination, { recursive: true });
    cpSync(undiciSource, undiciDestination, { recursive: true, verbatimSymlinks: true });
    sdkCliManifest.dependencies.undici = patchedUndiciVersion;
    writeJson(sdkCliFile, sdkCliManifest);
    console.warn("SDK CLI's staged Undici payload and requirement are now 7.30.2.");

    // The supplied tree exposes AJV 6 to CycloneDX's optional AJV 8 peer. Give that peer
    // its own already-installed AJV 8 and private dependencies, without changing ESLint's AJV.
    const peerCopies = [];
    const buildModules = `${buildPluginPath}/node_modules`;
    const libraryFile = path.join(stageRoot, buildModules,
      "@cyclonedx/cyclonedx-library/package.json");
    if (existsSync(libraryFile)) {
        const library = readJson(libraryFile);
        assert.equal(library.peerDependencies?.ajv, "^8.12.0", "Review the CycloneDX AJV peer.");
        const resolvedAjv = readJson(createRequire(libraryFile).resolve("ajv/package.json"));
        assert(["6.15.0", "8.20.0"].includes(resolvedAjv.version),
          "Review the installed CycloneDX AJV provider.");
        const sources = "node_modules/ajv-formats/node_modules";
        const peerDestination = path.join(stageRoot, buildModules, "ajv");
        if (existsSync(peerDestination)) {
            assert.equal(readJson(path.join(peerDestination, "package.json")).version,
              "8.20.0", "Unexpected existing AJV provider.");
            rmSync(peerDestination, { recursive: true });
        }
        for (const [name, version] of [
            ["ajv", "8.20.0"], ["fast-uri", "3.1.9"], ["json-schema-traverse", "1.0.0"],
        ]) {
            const from = `${sources}/${name}`;
            const to = name === "ajv" ? `${buildModules}/ajv` :
              `${buildModules}/ajv/node_modules/${name}`;
            assert.equal(readJson(path.join(stageRoot, from, "package.json")).version,
              version, `Review the staged peer dependency: ${from}`);
            cpSync(path.join(stageRoot, from), path.join(stageRoot, to), {
                recursive: true, verbatimSymlinks: true,
            });
            peerCopies.push({ from, to, version });
        }
        // npm does not bundle peer-only edges; declare the copied peer provider explicitly.
        const pluginFile = path.join(stageRoot,
          "node_modules/@servicenow/sdk-build-plugins/package.json");
        const plugin = readJson(pluginFile);
        assert(!plugin.dependencies?.ajv && (!plugin.optionalDependencies?.ajv ||
          plugin.optionalDependencies.ajv === "8.20.0"),
          "The SDK build plugin declares an unexpected AJV requirement.");
        plugin.optionalDependencies = { ...plugin.optionalDependencies, ajv: "8.20.0" };
        writeJson(pluginFile, plugin);
    }
    // Exclude the vulnerable optional XML validator, not all optional dependencies.
    assert.equal(lock.packages[xmlPath]?.version, "0.37.0", "Review the XML exclusion.");
    assert(lock.packages[xmlPath].optional, "libxmljs2 is no longer optional; review its removal.");
    assert.equal(lock.packages[buildPluginPath]?.optionalDependencies?.libxmljs2, "0.37.0",
      "The SDK's XML dependency changed; review its exclusion.");
    const xmlOwnerFile = path.join(stageRoot, buildPluginPath, "package.json");
    const xmlOwner = readJson(xmlOwnerFile);
    assert.equal(xmlOwner.version, "4.14.2", "Unexpected SDK build-plugin version.");
    assert(!xmlOwner.dependencies?.libxmljs2, "libxmljs2 became a required SDK dependency.");
    assert(xmlOwner.optionalDependencies?.libxmljs2 === undefined ||
      xmlOwner.optionalDependencies.libxmljs2 === "0.37.0", "Unexpected XML dependency version.");
    delete xmlOwner.optionalDependencies?.libxmljs2;
    writeJson(xmlOwnerFile, xmlOwner);

    const xmlPeer = readJson(libraryFile);
    assert.equal(xmlPeer.version, "9.5.0", "Unexpected CycloneDX version for XML exclusion.");
    assert(!xmlPeer.dependencies?.libxmljs2 && !xmlPeer.optionalDependencies?.libxmljs2,
      "CycloneDX changed how it obtains libxmljs2; review its exclusion.");
    if (xmlPeer.peerDependencies?.libxmljs2 !== undefined) {
        assert.equal(xmlPeer.peerDependencies.libxmljs2, "^0.35||^0.37",
          "Unexpected CycloneDX XML peer requirement.");
        assert.equal(xmlPeer.peerDependenciesMeta?.libxmljs2?.optional, true,
          "CycloneDX XML peer is no longer optional.");
    }
    delete xmlPeer.peerDependencies?.libxmljs2;
    delete xmlPeer.peerDependenciesMeta?.libxmljs2;
    writeJson(libraryFile, xmlPeer);
    rmSync(path.join(stageRoot, xmlPath), { recursive: true, force: true });
    console.warn("Excluded libxmljs2 and its optional dependency declarations.");

    const runNpm = (args, cwd = stageRoot) => {
        const result = spawnSync(process.execPath, [npmCli, ...args], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            maxBuffer: 32 * 1024 * 1024,
        });
        if (result.error) throw result.error;
        if (result.status !== 0)
            throw new Error(`npm ${args[0]} failed (${result.signal || result.status}).\n${
              result.stderr || result.stdout}`);
        return result.stdout;
    };
    // A Linux/macOS build can omit this optional package even though Windows needs it.
    const nativeLocked = lock.packages[windowsKeyringPath];
    assert.equal(nativeLocked?.version, "1.2.0", "Review the Windows keyring version.");
    assert(nativeLocked.inBundle && nativeLocked.optional, "Unexpected Windows keyring metadata.");
    assert.deepEqual(nativeLocked.os, ["win32"], "Unexpected Windows keyring platform.");
    assert.deepEqual(nativeLocked.cpu, ["x64"], "Unexpected Windows keyring architecture.");
    const keyringFile = path.join(stageRoot, "node_modules/@napi-rs/keyring/package.json");
    assert.equal(readJson(keyringFile).optionalDependencies?.[windowsKeyring], nativeLocked.version,
      "The keyring loader's Windows dependency changed; review the release patch.");
    const nativeDirectory = path.join(stageRoot, windowsKeyringPath);
    const nativeFile = path.join(nativeDirectory, windowsBinary);
    let nativeSource = "installed development copy";
    if (!existsSync(nativeFile)) {
        console.warn(`Fetching ${windowsKeyring}@${nativeLocked.version} for the release copy.`);
        // Run registry access from the project so its .npmrc/scope/auth settings are honored.
        const nativePack = readPackResult(runNpm([
            "pack", `${windowsKeyring}@${nativeLocked.version}`, "--json", "--ignore-scripts",
            "--pack-destination", temporaryRoot,
        ], projectRoot), windowsKeyring);
        assert.equal(nativePack.version, nativeLocked.version,
          "Unexpected native package version.");
        assert.equal(nativePack.filename,
          `napi-rs-keyring-win32-x64-msvc-${nativeLocked.version}.tgz`,
          "Unexpected native archive filename.");
        const nativeArchive = path.join(temporaryRoot, nativePack.filename);
        assert.equal(`sha512-${createHash("sha512").update(readFileSync(nativeArchive)).
          digest("base64")}`, nativeLocked.integrity,
          "Windows keyring archive integrity mismatch.");
        assert(nativePack.files.some(file => file.path === windowsBinary && file.size > 0),
          "The Windows keyring archive contains no native binary.");
        // Extract with npm into an empty temporary project, not the staged SDK or source tree.
        // Offline and ignore-scripts prevent dependency downloads, compilation, or install hooks.
        // Force permits this verified foreign-platform archive to be unpacked, never executed.
        const extractionRoot = path.join(temporaryRoot, "native-extract");
        mkdirSync(extractionRoot);
        writeJson(path.join(extractionRoot, "package.json"), { private: true });
        runNpm([
            "i", "-C", extractionRoot, "-f", "--ignore-scripts", "--offline",
            "--no-audit", "--no-fund", "--no-package-lock", "--no-save", nativeArchive,
        ], extractionRoot);
        cpSync(path.join(extractionRoot, windowsKeyringPath), nativeDirectory, {
            recursive: true, verbatimSymlinks: true,
        });
        nativeSource = "registry archive verified against package-lock.json";
    }
    const nativeManifest = readJson(path.join(nativeDirectory, "package.json"));
    assert.equal(nativeManifest.name, windowsKeyring, "Unexpected Windows keyring package.");
    assert.equal(nativeManifest.version, nativeLocked.version,
      "Unexpected Windows keyring version.");
    assert.equal(nativeManifest.main, windowsBinary, "Unexpected Windows keyring entry point.");
    assert.deepEqual(nativeManifest.os, ["win32"], "Unexpected native package platform.");
    assert.deepEqual(nativeManifest.cpu, ["x64"], "Unexpected native package architecture.");
    assert(lstatSync(nativeFile).isFile() && lstatSync(nativeFile).size > 0,
      "Windows keyring binary is missing, empty, or linked.");
    console.warn("Windows x64 keyring binary is present in the release copy.");

    writeJson(path.join(stageRoot, "SDK-BUNDLE-PATCH.json"), {
        publisher: manifest.name,
        sdkVersion: "4.14.2",
        patchedPackage: "@servicenow/isomorphic-rollup",
        patchedVersion: "1.3.14",
        dependency: "@fastify/http-proxy",
        originalRequirement: "11.4.4",
        bundledRequirement: "11.6.10",
        undiciPatch: {
            advisory: "CVE-2026-120415",
            package: "@servicenow/sdk-cli",
            packageVersion: "4.14.2",
            field: "dependencies.undici",
            original: "7.29.1",
            replacement: patchedUndiciVersion,
            source: undiciPath,
            destination: sdkUndiciPath,
        },
        peerProviderPatch: peerCopies.length ? {
            package: "@servicenow/sdk-build-plugins",
            field: "optionalDependencies.ajv",
            original: null,
            replacement: "8.20.0",
        } : null,
        peerCopies,
        excludedXmlValidator: {
            package: "libxmljs2",
            version: "0.37.0",
            advisories: ["CVE-2024-34393", "sonatype-2018-0585"],
            removedFrom: [
                {
                    package: "@servicenow/sdk-build-plugins",
                    field: "optionalDependencies.libxmljs2",
                },
                { package: "@cyclonedx/cyclonedx-library", field: "peerDependencies.libxmljs2" },
            ],
            removedPayload: xmlPath,
            limitation: "Optional CycloneDX XML schema validation is unavailable.",
        },
        windowsNativePackage: {
            name: windowsKeyring,
            version: nativeLocked.version,
            source: nativeSource,
            binary: `${windowsKeyringPath}/${windowsBinary}`,
            sha256: createHash("sha256").update(readFileSync(nativeFile)).digest("hex"),
        },
        buildPlatform: process.platform,
        buildArchitecture: process.arch,
        note: "Publisher-maintained dependency-manifest patch, not an upstream ServiceNow fix.",
    });

    const sdkManifestFile = path.join(stageRoot, sdkPath, "package.json");
    const sdkManifest = readJson(sdkManifestFile);
    sdkManifest.snDeveloperBundlePatch = readJson(path.join(stageRoot, "SDK-BUNDLE-PATCH.json"));
    writeJson(sdkManifestFile, sdkManifest);

    console.warn("Checking the staged dependency tree.");
    runNpm(["ls", "-a", "--omit=dev"]);
    console.warn("Packing the release archive without lifecycle scripts.");
    const packed = readPackResult(runNpm([
        "pack", "--json", "--ignore-scripts", "--pack-destination", temporaryRoot,
    ]), manifest.name);
    console.warn("Verifying the packed archive contents.");
    assert.equal(packed.version, manifest.version, "Unexpected package version from npm pack.");
    assert.equal(packed.filename, archiveName, "Unexpected archive filename from npm pack.");
    assertXmlExcluded(stageRoot, packed.files);
    const packedFiles = new Set(packed.files.map(file => file.path));
    for (const required of [
        "snUpload.js", `${sdkPath}/package.json`,
        `${buildPluginPath}/package.json`,
        `${buildModules}/@cyclonedx/cyclonedx-library/package.json`,
        `${rollupPath}/package.json`, `${proxyPath}/package.json`,
        `${sdkCliPath}/package.json`, `${undiciPath}/package.json`, `${undiciPath}/index.js`,
        `${sdkUndiciPath}/package.json`, `${sdkUndiciPath}/index.js`,
        `${windowsKeyringPath}/package.json`, `${windowsKeyringPath}/${windowsBinary}`,
        ...peerCopies.map(copy => `${copy.to}/package.json`),
    ]) assert(packedFiles.has(required), `Required file missing from archive: ${required}`);
    const packedUndici = packed.files.filter(file =>
      /(?:^|\/)node_modules\/undici\/package\.json$/.test(file.path));
    for (const file of packedUndici)
        assert.equal(readJson(path.join(stageRoot, file.path)).version, patchedUndiciVersion,
          `Unexpected Undici version included in archive: ${file.path}`);
    console.warn(`Undici release check passed: all ${packedUndici.length} copies are 7.30.2.`);
    // Install only verified, generated dependency corrections. Never rewrite root source files.
    const replacements = [
        `${rollupPath}/package.json`, `${sdkCliPath}/package.json`, sdkUndiciPath,
        `${sdkPath}/package.json`, windowsKeyringPath,
        `${buildPluginPath}/package.json`,
        `${buildModules}/@cyclonedx/cyclonedx-library/package.json`,
        ...(peerCopies.length ? [`${buildModules}/ajv`] : []),
    ];
    const backupRoot = path.join(temporaryRoot, "dependency-backup");
    const changed = [];
    const hiddenLock = path.join(projectRoot, "node_modules/.package-lock.json");
    const hiddenLockBytes = existsSync(hiddenLock) ? readFileSync(hiddenLock) : null;
    try {
        for (const location of [...replacements, xmlPath]) {
            const target = path.join(projectRoot, location);
            const backup = path.join(backupRoot, location);
            const hadOriginal = existsSync(target);
            if (hadOriginal) cpSync(target, backup, { recursive: true, verbatimSymlinks: true });
            changed.push({ target, backup, hadOriginal });
            rmSync(target, { recursive: true, force: true });
            if (location !== xmlPath) cpSync(path.join(stageRoot, location), target, {
                recursive: true, verbatimSymlinks: true,
            });
        }
        // npm documents deleting this cache after manual node_modules edits.
        rmSync(hiddenLock, { force: true });
        const finalPack = readPackResult(runNpm([
            "pack", "--json", "--dry-run", "--ignore-scripts",
        ], projectRoot), manifest.name);
        assertXmlExcluded(projectRoot, finalPack.files);
        const finalFiles = new Set(finalPack.files.map(file => file.path));
        for (const required of [
            "snUpload.js", `${sdkPath}/package.json`, `${rollupPath}/package.json`,
            `${buildPluginPath}/package.json`,
            `${buildModules}/@cyclonedx/cyclonedx-library/package.json`,
            `${sdkCliPath}/package.json`, `${sdkUndiciPath}/package.json`,
            `${sdkUndiciPath}/index.js`, `${proxyPath}/package.json`,
            `${windowsKeyringPath}/package.json`, `${windowsKeyringPath}/${windowsBinary}`,
            ...peerCopies.map(copy => `${copy.to}/package.json`),
        ]) assert(finalFiles.has(required), `Missing from ordinary publish: ${required}`);
        assert(!finalPack.files.some(file => /^(?:release\/|[^/]+\.tgz$)/.test(file.path)),
          "Old release files would be published; run --configure and check package file rules.");
        for (const file of finalPack.files.filter(file =>
          /(?:^|\/)node_modules\/undici\/package\.json$/.test(file.path)))
            assert.equal(readJson(path.join(projectRoot, file.path)).version, patchedUndiciVersion,
              `Unexpected Undici version in ordinary publish: ${file.path}`);
    } catch (error) {
        for (const { target, backup, hadOriginal } of changed.reverse()) {
            rmSync(target, { recursive: true, force: true });
            if (hadOriginal) cpSync(backup, target, { recursive: true, verbatimSymlinks: true });
        }
        if (hiddenLockBytes !== null) writeFileSync(hiddenLock, hiddenLockBytes);
        throw error;
    }
    console.warn("libxmljs2 exclusion passed for staging and ordinary npm publish.");
    console.warn("SDK preparation passed. npm can now publish the project normally.");
    console.warn("Tracked package.json and package-lock.json were not changed by preparation.");
} catch (error) {
    console.error(`Publish preparation failed: ${error.stack || error.message}`);
    process.exitCode = 1;
} finally {
    if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
}
