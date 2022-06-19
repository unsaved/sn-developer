#!/usr/bin/env node

"use srict";

const { AppErr, } = require("@admc.com/apputil");
const { SNInternalToSNLocalString } = require("./lib/snJs");

/*
 * In platform Local Update Set's Customer Updates related list,
 * Style type sys_update_xml's such as 'Form Layout' are hidden.
 * We can not display a good update timestamp for sys_ui_sections
 * (Form Layout) because SN doesn't track update times for these
 * collections but only for the elements inside them.
 */

const fs = require("fs");
const util = require("util");

let utcZone = false;
let argsArray = process.argv.slice(2);
if (argsArray.length > 0 && argsArray[0] === "-u") {
    argsArray = argsArray.slice(1);
    utcZone = true;
}
const badFileSpecs = argsArray.filter(usPath => !fs.existsSync(usPath));
const progName = process.argv[1].replace(/.*[/\\]/, "");

try {
    if (badFileSpecs.length > 0)
        throw new AppErr(badFileSpecs.length + " missing input files: " + badFileSpecs.join(", "));
    if (argsArray.length < 1)
        throw new AppErr(`SYNTAX:  ${progName} [-u] us1.xml [us2.xml...]`);
    argsArray.forEach(usPath => {
        let suxCount = 0;
        const payloads = [], entries = [];
        const xml = fs.readFileSync(usPath, "utf8");
        xml.replace(/^<sys_update_xml\b/gm, () => suxCount++);

        xml.replace(/^<payload>.+?<[/]payload>$/mgs, matchedSub => payloads.push(matchedSub));
        if (suxCount !== payloads.length) throw new AppErr(
          "Mismatch between $suxCount SUX records and " + payloads.length
          + " payload elements for " + usPath);
        payloads.forEach(pl => {
            let ex;
            if (/^<payload>[&]lt/.test(pl)) {
                // eslint-disable-next-line max-len
                ex = /table="([^"]+).+[&]lt;sys_id[&]gt;(.+?)[&]lt;[/]sys_id[&]gt;.+[&]lt;sys_updated_on[&]gt;(.+?)[&]lt;[/]sys_updated_on[&]gt;/s.exec(pl);
                if (ex) entries.push({
                    time: ex[3],
                    sysId: ex[2],
                    table: ex[1],
                });
            } else if (/^<payload><[!]\[CDATA\[/.test(pl)) {
                // eslint-disable-next-line max-len
                ex = /table="([^"]+).+<sys_id>(.+?)<[/]sys_id>.+<sys_updated_on>(.+?)<[/]sys_updated_on>/s.exec(pl);
                if (ex) entries.push({
                    time: ex[3],
                    sysId: ex[2],
                    table: ex[1],
                });
            }
        });
        const entrySummaries = entries.sort((x, y) => {
            if (x.time < y.time) return -1;
            if (x.time > y.time) return 1;
            if (x.table < y.table) return -1;
            if (x.table > y.table) return 1;
            if (x.sysId < y.sysId) return -1;
            if (x.sysId > y.sysId) return 1;
            return 0;
        }).map(entry =>
            util.format("    %s  %s %s", utcZone ?
              (entry.time.replace(" ", "T")+"Z") : SNInternalToSNLocalString(entry.time),
              entry.table.padEnd(29), entry.sysId)
        );
        console.info(
          "%s has %d sys_update_xml records w/ %d update %s timestamps%s",
          usPath, suxCount, entries.length, utcZone ? "UTC" : "local",
            (entrySummaries.length < 0 ? "" : "\n" + entrySummaries.join("\n")));
    });
} catch(e) {
    if (e === null)
        console.error("A null was thrown.  "
          + "Try using 'node --trace-uncaught' if you need the stack trace");
    else if (typeof(e) !== "object")
        console.error(`A ${typeof(e)} (non-object) was thrown.  `
          + "Try using 'node --trace-uncaught' if you need the stack trace");
    else if (!("stack" in e))
        console.error(`An object with no stack was thrown.  `
          + "Try using 'node --trace-uncaught' if you need the stack trace");
    else if (e.name === "AppErr")
        console.error("Aborting.  " + e.message);
    else
        // Weakness here is that you lose OOTB display of the actual source
        // line of code.  Since AppErr will be thrown far more often,
        // this is acceptable.
        console.error(e.stack);
    process.exit(10);
}
