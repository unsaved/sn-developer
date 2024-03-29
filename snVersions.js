#!/usr/bin/env node

"use strict";

/* I would prefer to use field sys_update_version.sys_recorded_at,
 * but this is unfortunately a magic "counter" type which you can't
 * filter on.  Values of all 3 (created, updated, recorded) differ
 * for thousands of records, but created seems to most closely
 * match recorded, so that's what we'll use. */

const fs = require("fs");
const { validate } = require("@admc.com/bycontract-plus");
const axios = require("axios");
const { AppErr, conciseCatcher, conciseErrorHandler, getAppVersion, NetRC, isPlainObject } =
    require("@admc.com/apputil");
const { format } = require("util");
const { patterns } = require("./lib/snJs");
const entities = require("entities");
const path = require("path");

// We keep a copy of the yargs instance so we can invoke methods on it like .help().
const yargs = require("yargs")(process.argv.slice(2)).
  strictOptions().
  usage(`SYNTAX: $0 [-dqv] [-p username] [-t filetype] table.field  \\
            [-s appscope] REC_ID EARLIER_VER [LATER_VER]
    OR: $0 [-dqv] [-p username] [-t filetype] table REC_ID
    OR: $0 -h|e
REC_ID      identifies which table.field record, by either display-value
            or sys_id.  N.b. this is the display field value at the time
            of version-record creation.  For tables with no display-value
            field designated, you must specify sys_id.
EARLIER_VER is a version 'Created' time or a version index specifier.
            Created times quoted in AM/PM format exactly as 'Created' is
            displayed in the Versions related lists.
            Version index specifiers are 0 or a negative integer meaning
            how many revisions back from the latest version.
            If no EARLIER_VERSION specified then we display a version list;
            If EARLIER_VERSION is specified then .table.field is required;
            If EARLIER_VERSION is not specified then .table is required.
LATER_VER   is just like EARLIER_ID, except that it defaults to 0 if you
            specify EARLIER_VER but no LATER_VER
            (meaning compare the specified EARLIER to the current version).
To see Created times in Versions related lists, you will have to add to
the list layout.
Honored environmental variables:
    SN_CF_COMMAND:      Comparison command template  (-e to display examples)
    SN_HTTPS_PROXY:     HTTPS Proxy URL
    SN_DEVELOPER_INST:  Short (unqualified) target ServiceNow instance name
    SN_CLI_PROFILE:     ServiceNow CLI profile name for  target instance
    VERSION_LIST_LIMIT: Version lists displays only last X versions (dflt 50)
You must set either SN_DEVELOPER_INST or SN_CLI_PROFILE`.
  replace(/ /g, "\u2009")).
  option("v", {
      describe: "Verbose.  N.b. may display passwords!",
      type: "boolean",
  }).
  option("d", { describe: "Debug logging", type: "boolean", }).
  option("e", {
      describe: "display Environment settings for different comparators",
      type: "boolean",
  }).
  option("p", {
      describe: "Prompt for basic auth password for the specified user.  "
        + "(By default uses name and passsword from netrc file).",
      type: "string",
  }).
  option("q", {
      describe: "Quiet logging by logging only at level WARN and ERROR",
      type: "boolean",
  }).
  option("s", {
      describe: "application Scope to narrow REC_ID matching, in sys_scope.scope format",
      type: "string",
  }).
  option("t", {
      describe: `Text type, for smarter comparisons.  Supported are:
      javascript (the default), text, xml, java, html.`,
      requiresArg: true,
      type: "number",
  }).
  demandCommand(0, 4).
  alias("help", "h").
  version(getAppVersion(__dirname));
const yargsDict = yargs.argv;
const progName = yargsDict.$0.replace(/^.*[\\/]/, "");  // eslint-disable-line no-unused-vars
const DEFAULT_CF_CMD_UNIX = "diff --color=always -U3 '%s' '%s'";
const DEFAULT_CF_CMD_WIN = 'fc "%s" "%s"';
const FILE_TYPES = {  // map from -t specification to filename suffix.
    javascript: "js",
    text: "txt",
    xml: "xml",
    java: "java",
    html: "html",
};
const ACTION_TO_CHARS = {
    "": " ?",
    DELETED: " -",
    INSERT: " +",
    INSERT_OR_UPDATE: "+~",
    UPDATE: " ~",
};
const tmpDir = require("os").tmpdir();


if (!yargsDict.d) console.debug = () => {};
if (yargsDict.q) console.debug = console.log = console.info = () => {};

if (yargsDict.e) {
    process.stdout.write(fs.readFileSync(path.join(__dirname,
      "resources/SN_CF_COMMANDS-examples.txt"), "utf8"));
    process.exit(0);
}
if (yargsDict._.length < 2) {
    console.error("table[.field] and REC_ID arguments are required");
    yargs.showHelp();
    process.exit(9);
}

let listLimit = 50;  // default
let ex, currentData, comparatorCmd;
const fileExt = "js";
if (yargsDict.t) { // yargsDict.t value validation
    if (!(yargsDict.t in FILE_TYPES)) {
        console.error(`Unsupported file type '${yargsDict.t}'. Ask Blaine for it.`);
        yargs.showHelp();
        process.exit(9);
    }
}
const tableField = yargsDict._.shift();
let table, field;
const isUnixShell = process.env.SHELL !== undefined;
const recId = yargsDict._.shift();
const keyBySysId = patterns.SYS_ID.test(recId);
let verA, verB;
if (yargsDict._.length > 0) {
    ex = patterns.AMPM_TIME.exec(yargsDict._[0]);
    if (ex)
        verA = yargsDict._.shift();
    else if (typeof yargsDict._[0] === "number") {
        verA = yargsDict._.shift();
        if (!Number.isInteger(verA) || verA > 0) {
            console.error(`Earlier version spec not a non-negative integer: ${verA}`);
            yargs.showHelp();
            process.exit(9);
        }
    } else {
        console.error(`Malformatted earlier version spec: ${yargsDict._[0]}`);
        yargs.showHelp();
        process.exit(9);
    }
}
if (verA === undefined) {
    if (!patterns.TABLE_OR_FIELD.test(tableField)) {
        console.error(`Malformatted table specification ${tableField}`);
        yargs.showHelp();
        process.exit(9);
    }
    table = tableField;
} else {
    ex = patterns.TABLE_DOT_FIELD.exec(tableField);
    if (!ex) {
        console.error(`Malformatted table.field specification ${tableField}`);
        yargs.showHelp();
        process.exit(9);
    }
    table = ex[1];
    field = ex[2];
}
if (verA === undefined) {
    // purposeful no-op.  If verA undefined then we want verB undefined too
} if (yargsDict._.length < 1) {
    verB = 0;
} else {
    ex = patterns.AMPM_TIME.exec(yargsDict._[0]);
    if (ex)
        verB = yargsDict._.shift();
    else if (typeof yargsDict._[0] === "number") {
        verB = yargsDict._.shift();
        if (!Number.isInteger(verB) || verB > 0) {
            console.error(`Later version spec not a non-negative integer: ${verB}`);
            yargs.showHelp();
            process.exit(9);
        }
    } else {
        console.error(`Malformatted later version spec: ${yargsDict._[0]}`);
        yargs.showHelp();
        process.exit(9);
    }
}

conciseCatcher(async (...args) => {
    validate(args, []);
    let rcFile, opts, proxyClause;
    let instName = process.env.SN_DEVELOPER_INST;
    let profile = process.env.SN_CLI_PROFILE;
    let url, authOpts;  // These only used for SN_DEVELOPER_INST mode
    if (instName === "") instName = undefined;
    if (profile === "") profile = undefined;
    if (instName && profile)
        throw new AppErr(
          "You must set an environmental variable to specify the target ServiceNow instance.\n"
          + "Either 'SN_DEVELOPER_INST' to host name (like 'acmedev'), "
          + "or 'SN_CLI_PROFILE' to a ServiceNow CLI profile name");
    if (!instName && !profile)
        throw new AppErr(
          "You must just one of env. vars 'SN_DEVELOPER_INST' and 'SN_CLI_PROFILE'.\n"
          + "Unset one of them.");
    if (!yargsDict.p) rcFile = new NetRC();
    if (process.env.CF_COMMAND === undefined) {
        comparatorCmd = isUnixShell ? DEFAULT_CF_CMD_UNIX : DEFAULT_CF_CMD_WIN;
    } else {
        comparatorCmd = process.env.CF_COMMAND;
    }
    console.debug("comparatorCmd", comparatorCmd);

    if ("VERSION_LIST_LIMIT" in process.env) {
        if (!/^\d+$/.test(process.env.VERSION_LIST_LIMIT))
            // eslint-disable-next-line prefer-template
            throw new AppErr("Env var 'VERSION_LIST_LIMIT' value is not a positive integer: "
              + process.env.VERSION_LIST_LIMIT);
        listLimit = Number(process.env.VERSION_LIST_LIMIT);
    }
    if ("SN_HTTPS_PROXY" in process.env) {
        if (profile !== undefined)
            throw new AppErr("Env. var 'SN_HTTPS_PROXY' not supported with 'SN_CLI_PROFILE'.\n"
              + "You must use a hack to use a proxy with ServiceNow CLI.\n"
              + "See https://www.johnskender.com/articles/now-cli-proxy");
        const ex = /^([^:]+):[/]+([^:]+)(?::(\d+))?$/.exec(process.env.SN_HTTPS_PROXY);
        if (!ex)
            // eslint-disable-next-line prefer-template
            throw new AppErr("Env var val for 'SN_HTTPS_PROXY' not a valid hosname/port URL: " +
              process.env.SN_HTTPS_PROXY);
        proxyClause = {
            protocol: ex[1],
            host: ex[2],
        };
        if (ex[3] !== undefined) proxyClause.port = parseInt(ex[3]);
    }

    const queryClauses = [
      `nameSTARTSWITH${table}_`,
      (keyBySysId ? "nameENDSWITH" : "record_name=") + recId,
      "ORDERBYDESCsys_created_on",
    ];
    if (yargsDict.s) queryClauses.push(`application.scope=${yargsDict.s}`);

    // First get version list
    if (profile) {
        if (yargsDict.v) console.info(`Will send version list request with profile ${profile}`);
        const pObj = require("child_process").spawnSync("snc", [
          "-p",
          profile,
          "--no-verbose",
          "--no-interactive",
          "--output", "json",  // This is global default but may be overridden in profiles
          "record",
          "query",
          "--displayvalue",
          "--limit", listLimit,
          "-t", "sys_update_version",
          "-q", queryClauses.join("^"),
          "--fields=sys_id,sys_created_on,action,source,application,sys_created_by",
        ], { stdio: ["ignore", "pipe", "pipe"], });
        if ("error" in pObj) throw new AppErr(`snc list invocation failure.\n${pObj.message}`);
        // Crappy 'snc' returns 0 even if it fails catastrophically, and (incredibly) writes fatal
        // error messages to stdout rather than stderr.  So we can't depend on .status or .stderr.
        if (pObj.status !== 0)  // Will probably never work with 'snc'
            throw new AppErr(`'snc' list invocation failed with value ${pObj.status}.  Stderr:\n`
              + `${pObj.stderr.toString("utf8")}\n\nStdout:\n${pObj.stdout.toString("utf8")}`);
        let response;
        //console.debug(pObj.stdout.toString("utf8"));
        try {
            response = JSON.parse(pObj.stdout.toString("utf8"));
        } catch (eCli) {
            throw new AppErr(
              `Got non-JSON list response from 'snc'.  ${eCli}:\n${pObj.stdout.toString("Utf8")}`);
        }
        console.debug(response);
        if (typeof response === "object" && "error" in response) throw new AppErr(
          `snc failure for list request\n${JSON.stringify(response.error, undefined, 2)}`);
        validate(response, { result: "object[]" });
        response.result = deRefLinks(response.result);
        console.debug(response.result);
        currentData = response.result;
    } else {
        url = `https://${instName}.service-now.com/api/now/table/sys_update_version`;
        authOpts = { auth: rcFile === undefined
          ? { username: yargsDict.p, password: require("readline-sync").
              question(`Password for '${yargsDict.p}': `, {hideEchoBack: true}) }
          : rcFile.getAuthSettings(url)
        };
        opts = { params: {
            sysparm_query: queryClauses.join("^"),
            sysparm_fields: "sys_id,sys_created_on,action,source,application,sys_created_by",
            sysparm_display_value: true,
            sysparm_exclude_reference_link: true,
            sysparm_limit: listLimit,
        } };
        if (proxyClause !== undefined) opts.proxy = proxyClause;

        if (yargsDict.v)
            console.info(`Will send version list request to: ${url}\n`
              + `with opts:`, {...opts, ...authOpts});
        conciseCatcher(versionListHandler, 1)(await axios.get(url, {...opts, ...authOpts}).
          catch(e => {
            console.error("Caught failure.  Consider checking %s's syslog "
              + "for messages written by %s.\n%s%s",
              instName, authOpts.auth.username, e.message,
              e.response !== undefined && e.response.data !== undefined
              && e.response.data.error !== undefined
              && e.response.data.error.message !== undefined
                // eslint-disable-next-line prefer-template
                ? "\n" + e.response.data.error.message : "");
            process.exit(1);
        }));
    }
    console.debug("Received list of %i versions", currentData.length);
    if (verA === undefined) {
        /* eslint-disable prefer-template */
        process.stdout.write(format("%s %s %s  %s  %s %s",
          "Index", "Op", "Created".padEnd(19), "Created by".padEnd(10),
          "Source".padEnd(16), "Scope")
          + "\n" + format("%s %s %s  %s  %s  %s",
              "-----", "--", "-------------------", "----------",
              "----------------", "----------------")
          + "\n" + currentData.map((r, i) =>
            format("%s %s %s  %s  %s  %s", String(-i).padStart(5),
              ACTION_TO_CHARS[r.action], r.sys_created_on,
              r.sys_created_by.substring(0, 10).padEnd(10),
              r.source.replace(/^Store Application: /, "StoreAp:").
                replace(/^Update Set: /, "US:").substring(0, 16).padEnd(16),
              r.application.substring(0, 16))
          ).reverse().join("\n") + "\n");
        /* eslint-enable prefer-template */
        return;
    }
    if (currentData.length < 2)
        throw new AppErr("No comparison possible with only %i versions", currentData.length);

    let sysidA, sysidB, hit;
    if (typeof verA === "number") {
        if (-verA >= currentData.length)
            throw new AppErr("Found %i versions but you requested #%i", currentData.length, verA);
        sysidA = currentData[-verA].sys_id;
    } else {
        hit = currentData.find(r => r.sys_created_on === verA);
        if (hit === undefined) throw new AppErr("Found no version created '%s'", verA);
        sysidA = hit.sys_id;
    }
    if (typeof verB === "number") {
        if (-verB >= currentData.length)
            throw new AppErr("Found %i versions but you requested #%i", currentData.length, verB);
        sysidB = currentData[-verB].sys_id;
    } else {
        hit = currentData.find(r => r.sys_created_on === verB);
        if (hit === undefined) throw new AppErr("Found no version created '%s'", verB);
        sysidB = hit.sys_id;
    }

    if (sysidA === sysidB)
        throw new AppErr(
          "Makes no sense to compare one record to itself: '%s' vs. '%s'", verA, verB);
    console.info("Fetching %s and %s", sysidA, sysidB);

    // Fetch payloads to compare
    if (profile) {
        if (yargsDict.v) console.info(`Will send payload request with profile ${profile}`);
        const pObj = require("child_process").spawnSync("snc", [
          "-p",
          profile,
          "--no-verbose",
          "--no-interactive",
          "--output", "json",  // This is global default but may be overridden in profiles
          "record",
          "query",
          "--displayvalue",
          "--limit", 3,
          "-t", "sys_update_version",
          "-q", `sys_idIN${sysidA},${sysidB}`,
          "--fields=sys_created_on,payload",
        ], { stdio: ["ignore", "pipe", "pipe"], });
        if ("error" in pObj) throw new AppErr(`snc payload invocation failure.\n${pObj.message}`);
        // Crappy 'snc' returns 0 even if it fails catastrophically, and (incredibly) writes fatal
        // error messages to stdout rather than stderr.  So we can't depend on .status or .stderr.
        if (pObj.status !== 0)  // Will probably never work with 'snc'
            throw new AppErr(`'snc' payload invocation failed with value ${pObj.status}.  Stderr:\n`
              + `${pObj.stderr.toString("utf8")}\n\nStdout:\n${pObj.stdout.toString("utf8")}`);
        let response;
        //console.debug(pObj.stdout.toString("utf8"));
        try {
            response = JSON.parse(pObj.stdout.toString("utf8"));
        } catch (eCli) {
            throw new AppErr( `Got non-JSON payload response from 'snc'.  `
              + `${eCli}:\n${pObj.stdout.toString("Utf8")}`);
        }
        console.debug(response);
        if (typeof response === "object" && "error" in response) throw new AppErr(
          `snc failure for payload request\n${JSON.stringify(response.error, undefined, 2)}`);
        validate(response, { result: "object[]" });
        response.result = deRefLinks(response.result);
        console.debug(response.result);
        currentData = response.result;
    } else {
        opts = { params: {
            sysparm_query: `sys_idIN${sysidA},${sysidB}`,
            sysparm_fields: "sys_created_on,payload",
            sysparm_display_value: true,
            sysparm_exclude_reference_link: true,
            sysparm_limit: 3,
        } };
        if (proxyClause !== undefined) opts.proxy = proxyClause;

        if (yargsDict.v)
            console.info(`Will send payload request to: ${url}\n`
              + `with opts:`, {...opts, ...authOpts});
        conciseCatcher(versionListHandler, 1)(await axios.get(url, {...opts, ...authOpts}).catch(
          e=>console.error(
            "Caught failure.  Consider checking %s's syslog "
            + "for messages written by %s.\n%s%s",
            instName, authOpts.auth.username, e.message,
            e.response !== undefined && e.response.data !== undefined
            && e.response.data.error !== undefined
            && e.response.data.error.message !== undefined
              ? `\n${e.response.data.error.message}` : "")
        ));
    }
    if (currentData.length !== 2)
        throw new AppErr("Somehow got %i records when querying for %s and %s",
          currentData.length, sysidA, sysidB);
    // eslint-disable-next-line prefer-template
    const payloadRe = new RegExp("<" + field + ">([\\s\\S]*)</" + field + ">");
    const fileA = genCfFile(currentData[0].sys_created_on, currentData[0].payload, payloadRe);
    const fileB = genCfFile(currentData[1].sys_created_on, currentData[1].payload, payloadRe);
    console.info(`Executing: ${comparatorCmd}`, fileA, fileB);
    const pObj = require("child_process").spawnSync(
      format(comparatorCmd, fileA, fileB), {
        cwd: tmpDir,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    if ("error" in pObj) throw new AppErr(`Comparator invocation failure: ${pObj.message}`);
    // Many of the comparators will return non-0 if the files differ, as
    // we intend.  So use stderr Buffer rather than .status to determine success.
    if (pObj.stderr.length > 0)  // eslint-disable-next-line prefer-template
        console.error("Did the comparator fail?\n" + pObj.stderr.toString("utf8"));
    fs.unlinkSync(path.join(tmpDir, fileA));
    fs.unlinkSync(path.join(tmpDir, fileB));
    console.info(pObj.stdout.toString("utf8"));
}, 10)().catch(e0=>conciseErrorHandler(e0, 1));

/* eslint-disable prefer-rest-params */
function versionListHandler(response) {
    if (response === undefined) return;  // handled by await's catch
    console.debug(response.data.result);
    validate(arguments, [{data: { result: "array" } }]);
    currentData = response.data.result;
}

function genCfFile(timestamp, payload, re) {
    validate(arguments, ["string", "string", "regexp"]);
    const ex = re.exec(payload);
    if (!ex) throw new AppErr(`Didn't find field '${field}' in version record ${timestamp}`);
    const fileName = format("%s.%s",
      timestamp.replace(" ", "T").replace(/ /g, "_").replace(/:/g, ""), fileExt);
    const content = entities.decodeXML(ex[1]);
    console.debug(`Payload for '${fileName}'\n[${content}]`);
    const fileHasCRs = content.includes("\r");
    fs.writeFileSync(path.join(tmpDir, fileName),
      content + (content.endsWith(fileHasCRs ? "\r\n" : "\n") ? "" : fileHasCRs ? "\r\n" : "\n"));
    return fileName;
}

/**
 * SNC CLI has no sysparm_exclude_reference_link option like table API does, so we do it here.
 */
function deRefLinks(reponsePart) {
    validate(arguments, ["object[]"]);
    return reponsePart.map(r => {
        let keys;
        const overrideMap = {};
        for (const k in r) {
            if (!isPlainObject(r[k])) continue;
            keys = Object.keys(r[k]);
            if (keys.length === 2 && keys[0] === "display_value" && keys[1] === "link")
                overrideMap[k] = r[k].display_value;
        }
        if (Object.keys(overrideMap).length < 1) return r;
        return {...r, ...overrideMap};
    });
}
