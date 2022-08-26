#!/usr/bin/env node

"use strict";

// SYNTAX:  snMultiUpload.js [-switches... --] inputFiles...
// The reason for '--' is because we don't want this script to have very tight dependencies
// on  which snUpload switches take paired non-hyphen tokens.

const { AppErr, conciseCatcher } = require("@admc.com/apputil");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

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
}
const files = [];
conciseCatcher(() => {
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

    files.forEach(file => {
        const uploadArgs = [path.join(__dirname, "snUpload.js")];
        if (passThruParams) Array.prototype.push.apply(uploadArgs, passThruParams);
        uploadArgs.push(file);
        //console.info(`Invocation with ${uploadArgs.length} params:\n` + uploadArgs.join("\n"));
        const returnObj =
          childProcess.spawnSync(process.execPath, uploadArgs, { stdio: "inherit" });
        if (returnObj.status !== 0) console.error(
          `snUpload invocation for '${file}' failed with exit value ${returnObj.status}`);
    });
}, 11)();
