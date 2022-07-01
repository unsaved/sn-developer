#!/usr/bin/env node

"use strict";

if (process.argv.length !== 3)
    throw new Error('SYNTAX:  node test.js file/spec');
if (process.cwd() !== __dirname)
    throw new Error(`${__filename} can only be run from it's directory, '${__dirname}'`);
const uploadMap = new (require("../lib/UploadMap"))();
console.info(uploadMap);
const entry = uploadMap.getEntry(process.argv[2]);
if (entry === null) throw new Error(`No uploadmap entry for '${process.argv[2]}'`);
console.info(entry);
