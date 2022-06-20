"use strict";

const fs = require("fs");
const { format } = require("util");
const { AppErr } = require("@admc.com/apputil");
const { validate } = require("@admc.com/bycontract-plus");

// JavaScript doesn't allow for class static constants, so:
const RECMAP_RE = /^\S+\s+(\w+)\s+(\w+)\s+(\w+)\s+(\S+)$/;

module.exports = class UploadMap {
    constructor() {
        validate(arguments, []);
        let prevIno, stat;
        let d = ".";
        const dirs = [];
        while ((stat = fs.statSync(d)).isDirectory()) {
            if (stat.ino === prevIno) break;
            prevIno = stat.ino;
            dirs.push(d);
            if (dirs.length > 1000)
                throw new Error("Assertion failed.  Loop detected");
            d += "/..";
        }
        dirs.push(require("os").homedir());
        this.mapFiles = dirs.map(d => d + "/uploadmap.txt");
    }

    /**
     * Returns entry from first matching UploadMap entry
     *
     * @param filePath.  filePath here is just used as a key into
     *                   the mapping files.  May be absolute or
     *                   relative, and the file doesn't need to exist.
     * @returns null if not found, or a simple JS object with keys:
     *     filePath, table, dataField, keyField, keyValue
     * @throws if no 'uploadmap.txt' files found, or if the first
     *                matching UploadMap line is malformatted
     */
    getEntry(filePath) {
        let matchLine, keyVal;
        let matchFile;
        this.mapFiles.filter(mf =>
            fs.existsSync(mf) && fs.statSync(mf).isFile()
        ).some(mf => {
            matchLine = fs.readFileSync(mf, "utf8").split(/\r?\n/g).
              // TODO:  Allow for entries to start with /reg exp/,
              // in which case we will need to extract each one and
              // then 'new RegExp(extraction).test(filePath)'.
              find(line => line.startsWith(filePath + " "));
            if (matchLine !== undefined) matchFile = mf;
            return matchLine !== undefined;
        });
        if (matchLine === undefined) return null;
        const ex = RECMAP_RE.exec(matchLine);
        if (!ex) throw new AppErr(`Malformatted line in '${matchFile}: %s`,
          matchLine);
        switch (ex[4]) {
          case "<":
            keyVal = filePath.replace(/^.*[/\\]/, "").replace(/[.][^.]*$/, "");
            break;
          case "*":
            keyVal = filePath.replace(/^.*[/\\]/, "");
            break;
          case "=":
            keyVal = filePath;
            break;
          case "/":
            keyVal = filePath.replace(/[.][^.]*$/, "");
            break;
          default:
            keyVal = ex[4];
        }
        return {
            filePath: filePath,
            table: ex[1],
            dataField: ex[2],
            keyField: ex[3],
            keyValue: keyVal,
        };
    }
    toString() {
        return format(
          "UploadMap that will check these %i mapping files\n%s",
          this.mapFiles.length, this.mapFiles.join("\n"));
    }
};
