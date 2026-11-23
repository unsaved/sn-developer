#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
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
let temporaryRoot;

try {
    const manifest = readJson(path.join(projectRoot, "package.json"));
    const lock = readJson(path.join(projectRoot, "package-lock.json"));
    const npmCli = process.env.npm_execpath;
    assert(npmCli && existsSync(npmCli), "Run this script using 'npm run pack:release'.");
    assert.equal(manifest.name, "@admc.com/sn-developer", "Unexpected project.");
    assert.equal(lock.lockfileVersion, 3, "Expected a version-3 package-lock.json.");
    assert.equal(lock.version, manifest.version, "Package and lockfile versions differ.");
    assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies,
      "Package and lockfile dependencies differ; finish the development installation first.");
    assert.equal(manifest.dependencies["@servicenow/sdk"], "4.14.2",
      "Review the release patch before changing SDK versions.");
    assert(manifest.bundleDependencies?.includes("@servicenow/sdk"), "SDK must be bundled.");
    assert.equal(manifest.overrides?.["@servicenow/sdk"]?.["@fastify/http-proxy"], "11.6.10",
      "Expected the development override for http-proxy 11.6.10.");
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
        assert.equal(readJson(packageFile).version, locked.version,
          `Installed version differs from package-lock.json: ${location}`);
    }

    const archiveName = `${manifest.name.slice(1).replace("/", "-")}-${manifest.version}.tgz`;
    temporaryRoot = mkdtempSync(path.join(tmpdir(), "sn-developer-pack-"));
    const stageRoot = path.join(temporaryRoot, "package");
    const outputRoot = path.join(projectRoot, "release");
    console.warn("Copying the release tree; development files will not be modified.");
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
    assert.equal(rollup.dependencies?.["@fastify/http-proxy"], "11.4.4",
      "Installed rollup manifest differs from the expected upstream declaration.");
    rollup.dependencies["@fastify/http-proxy"] = "11.6.10";
    writeJson(rollupFile, rollup);
    delete manifest.overrides["@servicenow/sdk"]["@fastify/http-proxy"];
    if (Object.keys(manifest.overrides["@servicenow/sdk"]).length === 0)
        delete manifest.overrides["@servicenow/sdk"];
    if (Object.keys(manifest.overrides).length === 0) delete manifest.overrides;
    writeJson(path.join(stageRoot, "package.json"), manifest);
    // The supplied tree exposes AJV 6 to CycloneDX's optional AJV 8 peer. Give that peer
    // its own already-installed AJV 8 and private dependencies, without changing ESLint's AJV.
    const peerCopies = [];
    const buildModules = "node_modules/@servicenow/sdk-build-plugins/node_modules";
    const libraryFile = path.join(stageRoot, buildModules,
      "@cyclonedx/cyclonedx-library/package.json");
    if (existsSync(libraryFile)) {
        const library = readJson(libraryFile);
        assert.equal(library.peerDependencies?.ajv, "^8.12.0", "Review the CycloneDX AJV peer.");
        const resolvedAjv = readJson(createRequire(libraryFile).resolve("ajv/package.json"));
        if (resolvedAjv.version === "6.15.0") {
            const sources = "node_modules/ajv-formats/node_modules";
            assert(!existsSync(path.join(stageRoot, buildModules, "ajv")),
              "Unexpected AJV at the release peer destination.");
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
            assert(!plugin.dependencies?.ajv && !plugin.optionalDependencies?.ajv,
              "The SDK build plugin already declares AJV; review the peer patch.");
            plugin.optionalDependencies = { ...plugin.optionalDependencies, ajv: "8.20.0" };
            writeJson(pluginFile, plugin);
        }
    }
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
        peerProviderPatch: peerCopies.length ? {
            package: "@servicenow/sdk-build-plugins",
            field: "optionalDependencies.ajv",
            original: null,
            replacement: "8.20.0",
        } : null,
        peerCopies,
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

    console.warn("Checking the staged dependency tree.");
    runNpm(["ls", "-a", "--omit=dev"]);
    console.warn("Packing the release archive without lifecycle scripts.");
    const packed = readPackResult(runNpm([
        "pack", "--json", "--ignore-scripts", "--pack-destination", temporaryRoot,
    ]), manifest.name);
    console.warn("Verifying the packed archive contents.");
    assert.equal(packed.version, manifest.version, "Unexpected package version from npm pack.");
    assert.equal(packed.filename, archiveName, "Unexpected archive filename from npm pack.");
    const packedFiles = new Set(packed.files.map(file => file.path));
    for (const required of [
        "snUpload.js", "SDK-BUNDLE-PATCH.json", `${sdkPath}/package.json`,
        `${rollupPath}/package.json`, `${proxyPath}/package.json`,
        `${windowsKeyringPath}/package.json`, `${windowsKeyringPath}/${windowsBinary}`,
        ...peerCopies.map(copy => `${copy.to}/package.json`),
    ]) assert(packedFiles.has(required), `Required file missing from archive: ${required}`);
    mkdirSync(outputRoot, { recursive: true });
    const archivePath = path.join(outputRoot, archiveName);
    copyFileSync(path.join(temporaryRoot, archiveName), archivePath);
    console.warn("Release archive created. Nothing was published or globally installed.");
    console.info(archivePath);
} catch (error) {
    console.error(`Release packaging failed: ${error.stack || error.message}`);
    process.exitCode = 1;
} finally {
    if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
}
