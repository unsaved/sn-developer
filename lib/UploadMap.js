"use strict";

const fs = require("fs");
const { format } = require("util");
const { AppErr } = require("@admc.com/apputil");
const bcValidate = require("@admc.com/bycontract-plus").validate;

// JavaScript doesn't allow for class static constants, so:
//                filepec table      datafld keyflds    keyvals    scope        altscope
const RECMAP_RE =  // eslint-disable-next-line max-len
  /^\S+\s+([\w.]+)\s+(\w+)\s+(\w+(?:[.]\w+)?(?:,\w+(?:[.]\w+)?)*)\s+(\S+)(?:\s+([\w-]+|-)(?:\s+([\w-]+|-))?)?$/;
const REGEXLINE_RE = /^[/](\S+)[/](i?)\s/;

module.exports = class UploadMap {
    constructor(...args) {
        bcValidate(args, []);
        let prevIno, stat;
        let d = ".";
        const dirs = [];
        while ((stat = fs.statSync(d)).isDirectory()) {
            if (stat.ino === prevIno) break;
            prevIno = stat.ino;
            dirs.push(d);
            if (dirs.length > 1000) throw new Error("Assertion failed.  Loop detected");
            d += "/..";
        }
        dirs.push(require("os").homedir());
        this.mapFiles = dirs.map(d => `${d}/uploadmap.txt`);
    }

    /**
     * @throws an AppErr if there is any malformatted line in any in-scope uploadmap.txt file
     * @returns the UploadMap instance, for chaining
     */
    validate() {
        this.mapFiles.filter(mf =>
            fs.existsSync(mf) && fs.statSync(mf).isFile()
        ).forEach(mf => {
            fs.readFileSync(mf, "utf8").split(/\r?\n/g).forEach(line => {
                if (line.trim() !== "" && !line.startsWith("#") && !RECMAP_RE.test(line))
                    throw new AppErr(`Malformatted line in '${mf}: %s`, line);
                if (line.trim().startsWith("/") && !REGEXLINE_RE.exec(line))
                    throw new AppErr("Absolute paths not supported.  "
                      + `Close pattern with / to make an RE. ${mf}: %s`, line);
            });
        });
        return this;
    }

    /**
     * Returns entry from first matching UploadMap entry
     *
     * @param filePath.  filePath here is just used as a key into the mapping files.
     *                   Must be relative, and the file doesn't need to exist.
     * @returns null if not found, or a plain JS object with keys:
     *                   filePath, table, dataField, keyField, keyValue, appScope
     * @throws if no 'uploadmap.txt' files found, or if the first
     *                   matching UploadMap line is malformatted
     */
    getEntry(filePath) {
        let matchLine, keyStr;
        let matchFile;
        this.mapFiles.filter(mf =>
            fs.existsSync(mf) && fs.statSync(mf).isFile()
        ).some(mf => {
            matchLine = fs.readFileSync(mf, "utf8").split(/\r?\n/g).find(line => {
                if (line.startsWith(`${filePath} `)) return true;
                const ex = REGEXLINE_RE.exec(line);
                if (!ex) return false;
                return new RegExp(ex[1], ex[2]).test(filePath);
            });
            if (matchLine !== undefined) matchFile = mf;  // matchFile just set for error reporting
            return matchLine !== undefined;
        });
        if (matchLine === undefined) return null;
        const ex = RECMAP_RE.exec(matchLine);
        if (!ex) throw new AppErr(`Malformatted entry in '${matchFile}: %s`, matchLine);
        // ex.length here is always 7
        switch (ex[4]) {
            case "<":  // filename minus .extension
                keyStr = filePath.replace(/^.*[/\\]/, "").replace(/[.][^.]*$/, "");
                break;
            case "*":  // filename
                keyStr = filePath.replace(/^.*[/\\]/, "");
                break;
            case "=":  // filepath
                keyStr = filePath;
                break;
            case "/":  // filepath minus extension
                keyStr = filePath.replace(/[.][^.]*$/, "");
                break;
            default:  // literal
                keyStr = ex[4];
        }
        keyStr = keyStr.replace(/#/g, " ").
          replace(/~[{]/g, "(").replace(/~[}]/g, ")").replace(/~/g, "/");
        const keyFields = ex[3].split(",");
        const keyValues = keyFields.length === 1 ? [keyStr] : keyStr.split("+");
        if (keyFields.length !== keyValues.length)
            throw new Error(`Count mismatch between path '${filePath}' and key fields '${keyStr}'`);
        return {
            filePath,
            table: ex[1],
            dataField: ex[2],
            keyFields,
            keyValues,
            appScope: ex[5] === "-" || ex[5] === undefined ? null : ex[5],  // null if not set
            lintAlt: ex[6] === "-" || ex[6] === undefined ? null : ex[6],  // null if not set
            doLint: ex[6] !== undefined,
        };
    }
    toString() {
        return format(
          "UploadMap that will check these %i mapping files\n%s",
          this.mapFiles.length, this.mapFiles.join("\n"));
    }
};
