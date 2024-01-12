#!/usr/bin/env node

"use strict";

const { AppErr, conciseCatcher, conciseErrorHandler } = require("@admc.com/apputil");
const { validate } = require("@admc.com/bycontract-plus");
const { snInternalToSNLocalString } = require("./lib/snJs");

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

conciseCatcher(async (...args) => {
    validate(args, []);
    if (badFileSpecs.length > 0)
        // eslint-disable-next-line prefer-template
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
          // eslint-disable-next-line prefer-template
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
              // eslint-disable-next-line prefer-template
              entry.time.replace(" ", "T")+"Z" : snInternalToSNLocalString(entry.time),
              entry.table.padEnd(29), entry.sysId)
        );
        console.info(
          "%s has %d sys_update_xml records w/ %d update %s timestamps%s",
          usPath, suxCount, entries.length, utcZone ? "UTC" : "local",
            // eslint-disable-next-line prefer-template
            entrySummaries.length < 0 ? "" : "\n" + entrySummaries.join("\n"));
    });
}, 10)().catch(e0=>conciseErrorHandler(e0, 1));
