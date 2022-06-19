#!/usr/bin/env node

/**
 * TODO:
 * Add yargs. Take input file as required command 1.
 * Eventually take an encoded query and use table API to pull the
 * entries directly from SN instance.
 */

const snJs = require("./lib/snJs");
const fs = require("fs");
const progName = process.argv[1].replace(/^.*[\\/]/, "");

if (process.argv.length !== 3 || !/^\d+$/.test(process.argv[2])) {
console.error("len " + process.argv.length);
    console.error("SYNTAX:  %s N\nwhere N is non-negative integer seconds threshold.", progName);
    process.exit(2);
}
const threshold = Number(process.argv.pop());
console.debug("Using threshold %i", threshold);
let prevS, lineNum;
fs.readFileSync(require("os").homedir() + "/tmp/timings.txt", "utf8").
  split("\n").filter((line, i) => {
      lineNum = i+1;
      return line !== "";
    }).forEach(line => {
    try {
        const s = snJs.toUnixSec(line);
        if (prevS !== undefined) {
            const duration = prevS - s;
            if (duration >= threshold) console.log("%i %s", duration, line);
        }
        prevS = s;
        //console.log(`First line: (${line})`); process.exit(0);
    } catch(e) {
        e.message = "Input line #" + (lineNum) + ": " + e.message;
        throw e;
    }
});
