#!/usr/bin/env node

"use strict";

const { AppErr, conciseCatcher } = require("@admc.com/apputil");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process"); // eslint-disable-line camelcase

/**
 * Skips directories matching .* and 'node_modules'
 * @param an fs.Dir instance
 *
 * @returns Array of recursively matching filepaths, may have 0 elements
 */
function jsFilesInBranch(fsDir) {
    //validate(arguments, ["object"]);
    let dirent, entPath;
    const outputList = [];

    while ((dirent = fsDir.readSync()) !== null) {
        if (dirent.name.startsWith(".")) continue;
        if (dirent.name === "node_modules") continue;
        entPath = path.join(fsDir.path, dirent.name);
        if (dirent.isDirectory())
            Array.prototype.push.apply(outputList,
              jsFilesInBranch(fs.opendirSync(entPath)));
        else if (dirent.name.endsWith(".js") && dirent.isFile())
            outputList.push(entPath);
    }
    fsDir.closeSync();
    return outputList;
}

const args = process.argv.slice(2);
const passThruEnd = args.indexOf("--");
let passThruParams;
if (passThruEnd > -1) {
    passThruParams = args.splice(0, passThruEnd);
    args.shift();
    //console.debug(passThruParams.length + " passThruParams:\n" + passThruParams.join("\n"));
} else {
    passThruParams = [];
}
passThruParams.unshift("-L");
const files = [];
conciseCatcher(() => {
    let mergerPath = path.join(__dirname, "../eslint-plugin-sn/mergeEslintHtml.js");
    if (!fs.existsSync(mergerPath)) {
        mergerPath = path.join(__dirname,
          "node_modules/@admc.com/eslint-plugin-sn/mergeEslintHtml.js");
        if (!fs.existsSync(mergerPath))
            throw new Error("Installation consistency failure.  "
              + "'mergeEslintHtml.js' from eslint-plugin-sn module not found.");
    }

    args.forEach(inputNode => {
        if (!fs.existsSync(inputNode)) throw new AppErr(`'${inputNode}' does not exist`);
        if (fs.statSync(inputNode).isDirectory(inputNode)) {
            Array.prototype.push.apply(files, jsFilesInBranch(fs.opendirSync(inputNode)));
        } else {
            files.push(inputNode);
        }
    });
    // eslint-disable-next-line prefer-template
    //console.debug(files.length + " source file matches:\n" + files.join("\n"));
    const workDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "snLintHtmlReport."));
    let counter = 0;
    const mergeParams = [mergerPath];

    files.forEach(file => {
        const outFile = path.join(workDir, `${++counter}.html`);
        const uploadArgs = [path.join(__dirname, "snUpload.js")];
        Array.prototype.push.apply(uploadArgs, passThruParams);
        uploadArgs.push(file);
        //console.info(`Invocation with ${uploadArgs.length} params:\n` + uploadArgs.join("\n"));
        const returnObj =
          childProcess.spawnSync(process.execPath, uploadArgs,
              { stdio: ["inherit", "pipe", "inherit"] });
        if (returnObj.status !== 0) console.error(
          `snUpload invocation for '${file}' failed with exit value ${returnObj.status}`);
        fs.writeFileSync(outFile, returnObj.stdout);
        mergeParams.push(outFile);
    });
    console.error(`WORKDIR: ${workDir}`);
    try {
        childProcess.execFileSync(process.execPath, mergeParams, { stdio: "inherit" });
    } catch (_dummyNext) {
        throw new AppErr(`Failed to merge HTML files.  Temp directory retained: ${workDir}.`);
    }
     fs.rmSync(workDir, { recursive: true, force: true });
}, 11)();
