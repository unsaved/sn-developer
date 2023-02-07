#!/usr/bin/env node

"use strict";

const fs = require("fs");
const { validate } = require("@admc.com/bycontract-plus");
const axios = require("axios");
const { NetRC, AppErr, conciseCatcher, getAppVersion, isPlainObject } =
  require("@admc.com/apputil");
const UploadMap = require("./lib/UploadMap");
const { format } = require("util");
const checksum = require("checksum");
const path = require("path");
const os = require("os");
const child_process = require("child_process"); // eslint-disable-line camelcase
const MULTI_SCRIPT_TABLES = ["catalog_ui_policy", "sp_widget", "sys_ui_policy", "sys_ui_page"];

// We keep a copy of the yargs instance so we can invoke methods on it like .help().
const yargs = require("yargs")(process.argv.slice(2)).
  strictOptions().
  usage(`SYNTAX: $0 [-dnqrv] [-p username] [-m POLL_MS] file.ext
OR
        $0 -e|h|u
Honored environmental variables.  * variables are required:
    SN_CF_COMMAND:      Comparison command template  (-e to display examples)
   *SN_DEVELOPER_INST:  Short (unqualified) ServiceNow instancename
    SN_HTTPS_PROXY:     HTTPS Proxy URL
    SN_LINT_STRICT:     If set (to anything) then snLint will be invoked with -r switch
   *SN_RESTAPI_SCOPE:   Scope of the WS Op upload resource path after '/api/'
    SN_RESTAPI_NAME:    Name of the WS upload definition name.  Defaults to 'sndev'.`.
        replace(/ /g, "\u2009")).
  option("e", {
      describe: "display Environment settings for different comparators",
      type: "boolean",
  }).
  option("v", {
      describe: "Verbose.  N.b. may display passwords!",
      type: "boolean",
  }).
  option("c", { describe: "Compare local to remote.  Don't upload or lint.", type: "boolean", }).
  option("d", { describe: "Debug logging", type: "boolean", }).
  option("f", {
      describe: "Fetch remote file like -r, but save file locally.  " +
        "If local already exists then we will just compare.  Remove local file to replace it.",
      type: "boolean", }).
  option("F", {
      describe:
        "Same as -f switch except if local file does not already exist then write file with UNIX "
        + "newlines.",
      type: "boolean",
  }).
  option("m", {
      describe: "Monitor poll period in milliseconds, positive integer",
      requiresArg: true,
      type: "number",
  }).
  option("l", { describe: "only run snLint on specified file, don't upload", type: "boolean", }).
  option("L", { describe: "only run snLint on specified file with HTML output", type: "boolean", }).
  option("n", { describe: "No syntax/lint check for *.js file", type: "boolean", }).
  option("p", {
      describe: "Prompt for basic auth password for the specified user.  "
        + "(By default uses name and passsword from netrc file).",
      type: "string",
  }).
  option("q", {
      describe: "Quiet logging by logging only at level WARN and ERROR",
      type: "boolean",
  }).
  option("r", {
      describe:
        "Retrieve to stdout the instance script field value targeted by specified local file path."
       + "  Beware that log messages may be intermixed with normal stdout, such as with -r switch.",
      type: "boolean",
  }).
  option("R", {
      describe:
      "Same as -r switch except output with UNIX newlines instead of preserving instance-side EOLs",
      type: "boolean",
  }).
  option("u", {
      describe: "writes a skeleton 'uploadmap.txt' file to current directory",
      type: "boolean",
  }).
  demandCommand(0, 1).
  alias("help", "h").
  version(getAppVersion(__dirname));
const yargsDict = yargs.argv;
const progName = yargsDict.$0.replace(/^.*[\\/]/, "");
const DEFAULT_CF_CMD_UNIX = "diff --color=always -U3 '%s' '%s'";
const DEFAULT_CF_CMD_WIN = 'fc "%s" "%s"';

if (!yargsDict.d) console.debug = () => {};
if (yargsDict.q) console.debug = console.log = console.info = () => {};

if (yargsDict.e) {
    process.stdout.write(fs.readFileSync(path.join(__dirname,
      "resources/SN_CF_COMMANDS-examples.txt"), "utf8"));
    process.exit(0);
}
let flmrCount = 0;
if (yargsDict.l) flmrCount++;
if (yargsDict.L) flmrCount++;
if (yargsDict.m) flmrCount++;
if (yargsDict.r) flmrCount++;
if (yargsDict.R) flmrCount++;
if (flmrCount > 1) {
    console.error("Switches f, -F, -l, -L, -m , -r, -R are all mutually exclusive");
    yargs.showHelp();
    process.exit(9);
}
// Derived switch vals:
if (yargsDict.L) yargsDict.l = true;
if (yargsDict.F) yargsDict.f = yargsDict.R = true;
if (yargsDict.R || yargsDict.f) yargsDict.r = true;
if (yargsDict.u) {
    if (fs.existsSync("uploadmap.txt")) {
        console.error("Refusing to write 'uploadmap.txt' because one already exists here.");
        process.exit(8);
    }
    fs.copyFileSync(path.join(__dirname, "resources/uploadmap.txt"), "uploadmap.txt");
    process.exit(0);
}
if (yargsDict._.length < 1) {
    console.error("file.ext argument is required");
    yargs.showHelp();
    process.exit(9);
}

let file, fileExt, fileHasCRs, comparatorCmd, lastChecksum;
if (yargsDict.m) { // yargsDict.m value validation
    if (isNaN(yargsDict.m) || !Number.isInteger(yargsDict.m)
      || yargsDict.m <= 0) {
        console.error(`Switch -m value not a positive integr: ${yargsDict.m}`);
        yargs.showHelp();
        process.exit(9);
    }
}
const isUnixShell = process.env.SHELL !== undefined;
const lintStrict = process.env.SN_LINT_STRICT !== undefined;

conciseCatcher(function(inFile) {
    validate(arguments, ["string"]);
    let rcFile;
    file = inFile;
    const instName = process.env.SN_DEVELOPER_INST;
    if (instName === undefined)
        throw new AppErr("Set required env var 'SN_DEVELOPER_INST' to "
          + "unqualified SN host name (like 'acmedev')");
    const apiScope = process.env.SN_RESTAPI_SCOPE;
    if (apiScope === undefined)
        throw new AppErr("Set required env var 'SN_RESTAPI_SCOPE' to "
          + "REST API scope in the resource path (like 'acme')");
    let apiName = process.env.SN_RESTAPI_NAME;
    if (apiName === undefined) apiName = "sndev";
    if (!yargsDict.p) rcFile = new NetRC();
    if (yargsDict.f || !yargsDict.r) {
        console.debug(`Checking local file '${file}'`);
        if (fs.existsSync(file)) {
            if (!fs.statSync(file).isFile()) throw new AppErr("Not a regular file:", file);
            try {
                fs.accessSync(file, fs.constants.R_OK);
            } catch (nestedE) {
                throw new AppErr(`Can't read file: [${file}]`);
            }
            fileExt = file.replace(/.*[.]/, "");
            if (fileExt === "") fileExt = null;
            if (process.env.SN_CF_COMMAND === undefined) {
                comparatorCmd = isUnixShell ? DEFAULT_CF_CMD_UNIX : DEFAULT_CF_CMD_WIN;
            } else {
                comparatorCmd = process.env.SN_CF_COMMAND;
            }
            console.debug("comparatorCmd", comparatorCmd);
        } else if (!yargsDict.f) {
            throw new AppErr("File is missing:", file);
        }
    }

    const uploadEntry = new UploadMap().validate().getEntry(file);
    if (uploadEntry === null)
        throw new AppErr(`You must add an entry for '${file}' in a 'uploadmap.txt' file.`);
    if (yargsDict.l && !uploadEntry.doLint) throw new AppErr(
      `Add sys_scope and lint_alt values for the '${file}' entry your 'uploadmap.txt' file.`);
    if (yargsDict.m) {
        lastChecksum = checksum(fs.readFileSync(file, "utf8"));
        if (!lastChecksum) throw new Error("Assertion failed.  First checksum empty.");
        setInterval(transfer, yargsDict.m);
    } else {
        transfer();
    }

    function transfer() {
        let localFileText;
        if (!yargsDict.r && !yargsDict.n && !yargsDict.c && uploadEntry.doLint) {
            let eslintPath = path.join(__dirname,
                  "node_modules/@admc.com/eslint-plugin-sn/snLint.js");
            if (!fs.existsSync(eslintPath)) {
                eslintPath = path.join(__dirname, "../eslint-plugin-sn/snLint.js");
                if (!fs.existsSync(eslintPath))
                    throw new Error("Installation consistency failure.  "
                      + "'snLint.js' from eslint-plugin-sn module not found.");
            }
            const lintSnArgs = [
                eslintPath,
                "-t",
                uploadEntry.table + (MULTI_SCRIPT_TABLES.includes(uploadEntry.table) ?
                  `.${uploadEntry.dataField}` : "")
            ];
            if (lintStrict) lintSnArgs.push("-r");
            if (yargsDict.L) lintSnArgs.push("-H");
            if (yargsDict.d) lintSnArgs.push("-d");
            if (uploadEntry.lintAlt) {
                lintSnArgs.push("-a");
                lintSnArgs.push(uploadEntry.lintAlt);
            }
            lintSnArgs.push(file);
            try {
                // eslint-disable-next-line camelcase
                child_process.execFileSync(process.execPath, lintSnArgs, { stdio: "inherit" });
            } catch (e9) {
                throw new AppErr("Lint check failed");
            }
            console.warn("ESLint success");  // Warn level so does not intermix with stdout
            if (yargsDict.l) return;
        }

        if (fs.existsSync(file)) {
            // localFileText will always have \r\n and no final line delimiter
            localFileText = fs.readFileSync(file, "utf8");
            if (lastChecksum) {
                // Only and always runs when in monitor mode
                const newChecksum = checksum(localFileText);
                if (newChecksum === lastChecksum) return;
                lastChecksum = newChecksum;
            }
            fileHasCRs = localFileText.includes("\r");
            if (!fileHasCRs) localFileText = localFileText.replace(/\n/g, "\r\n");
            if (localFileText.endsWith("\r\n")) localFileText = localFileText.slice(0, -2);
        } else {
            fileHasCRs = yargsDict.R ? false : os.EOL === "\r\n";
        }

        /* eslint-disable prefer-template */
        const url = `https://${instName}.service-now.com` + (yargsDict.r || yargsDict.c ?
            `/api/now/v2/table/${uploadEntry.table.replace(/[.].+/, "")}` :
            `/api/${apiScope}/${apiName}/${uploadEntry.table}/${uploadEntry.dataField}`);
        /* eslint-enable prefer-template */
        const authOpts = { auth: rcFile === undefined
          ? { username: yargsDict.p, password: require("readline-sync").
              question(`Password for '${yargsDict.p}': `, {hideEchoBack: true}) }
          : rcFile.getAuthSettings(url)
        };
        const opts = {
            method: yargsDict.r || yargsDict.c ? 'get' : 'patch',
            url,
            params: yargsDict.r || yargsDict.c ? {
              sysparm_query: `${uploadEntry.keyField}=${uploadEntry.keyValue}`,
              sysparm_fields: uploadEntry.dataField,
              sysparm_limit: 2,
            } : {
                query: `${uploadEntry.keyField}=${uploadEntry.keyValue}`
            },
        };
        if (uploadEntry.appScope) {
            if (yargsDict.r || yargsDict.c)
                opts.params.sysparm_query =
                  `${opts.params.sysparm_query}^sys_scope.scope=${uploadEntry.appScope}`;
            else
                opts.params.appscope = uploadEntry.appScope;
        }
        if ("SN_HTTPS_PROXY" in process.env) {
            const ex = /^([^:]+):[/]+([^:]+)(?::(\d+))?$/.exec(process.env.SN_HTTPS_PROXY);
            if (!ex)
                // eslint-disable-next-line prefer-template
                throw new AppErr("Env var val for 'SN_HTTPS_PROXY' not a "
                  + "valid hostname/port URL: " + process.env.SN_HTTPS_PROXY);
            const proxyClause = {
                protocol: ex[1],
                host: ex[2],
            };
            if (ex[3] !== undefined) proxyClause.port = parseInt(ex[3]);
            opts.proxy = proxyClause;
        }
        if (yargsDict.v)
            console.warn(`Will send request to: ${url}\nwith opts (- data):`,
              {...opts, ...authOpts});  // Warn level so does not intermix with stdout
        if (!yargsDict.r && !yargsDict.c) opts.data = { "content": localFileText };
        axios({...opts, ...authOpts}).
          then(conciseCatcher(responseHandler, 1),
          e=>console.error("Caught failure.  Consider running with -d switch (debug) "
            + "and checking %s's syslog for messages written by %s.\n%s%s",
            instName, authOpts.auth.username, e.message,
            e.response !== undefined && e.response.data !== undefined
            && e.response.data.error !== undefined
            && e.response.data.error.message !== undefined
              ? "\n" + e.response.data.error.message : "")  // eslint-disable-line prefer-template
          );
    }
}, 10)(yargsDict._.shift());
if (yargsDict.m) {
    const rl = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question(`Monitoring '${file}'.  Hit ENTER to exit.\n`,
      () => { rl.close(); process.exit(1); });
}

async function responseHandler(response) {
    let prevRevData, prevDataHasCRs;
    if (yargsDict.r || yargsDict.c) {
        validate(arguments, [{data: {result: "array"}}]);
        if (response.data.result.length < 1) throw new AppErr("Got no records from server");
        if (response.data.result.length > 1) throw new AppErr("Got multiple records from server");
        if (!isPlainObject(response.data.result[0]))
            throw new AppErr("Got something other than a plain object from server: %O",
              response.data.result[0]);
        if (Object.keys(response.data.result[0]).length !== 1)
            // eslint-disable-next-line prefer-template
            throw new AppErr("Object from server has "
              + Object.keys(response.data.result[0]).length + " fields instead of just 1");
        prevRevData = Object.values(response.data.result[0])[0];
        if (typeof prevRevData !== "string") throw new AppErr(
          `Object from server has ${typeof prevRevData} instead of string content`);
        prevDataHasCRs = prevRevData.includes("\r");
        if (yargsDict.r) {
            if (prevDataHasCRs && !fileHasCRs) prevRevData = prevRevData.replace(/\r/g, "");
            if (!yargsDict.f) {
                process.stdout.write(prevRevData + (fileHasCRs ? "\r\n" : "\n"));
                return;
            }
        }
    } else {
        //Can't use validate because retrieval of JSON sys property SOMETIMES gets as an object:
        //validate(arguments, [{data: "string"}]);
        if (typeof response.data !== "string") {
            // Server is sending a GlideRecord.getValue() with mime type text/plain.
            // I don't know how JSON strings are sometimes making it to use as objects???
            console.warn(`We received a ${typeof response.data} rather than a string.
Due to this, we can't determine or display the delta.`);
            return;
        }
        prevRevData = response.data;
        prevDataHasCRs = prevRevData.includes("\r");
    }
    if (typeof prevDataHasCRs !== "boolean")
        throw new Error("Assertion failed.  Variable 'prevDataHasCRs' is undefined");
    // fileHasCRs has obvious meaning if 'file' exists.  If not then it means we INTEND to have CRs.
    if (typeof fileHasCRs !== "boolean")
        throw new Error("Assertion failed.  Variable 'fileHasCRs' is undefined");
    console.debug("Received", prevRevData);
    const prevRevFile = yargsDict.f && !fs.existsSync(file) ? file : format("%s-%i.%s",
      path.join(os.tmpdir(), progName.replace(/[.][^.]*$/, "")),
      process.pid, fileExt === null ? "txt" : fileExt);
    if (fileHasCRs) {
        if (!prevDataHasCRs) prevRevData = prevRevData.replace(/\n/g, "\r\n");
    } else
        if (prevDataHasCRs) prevRevData = prevRevData.replace(/\r/g, "");
    console.debug("Writing prevRevFile file:", prevRevFile);
    fs.writeFileSync(prevRevFile, prevRevData + (fileHasCRs ? "\r\n" : "\n"));
    if (!comparatorCmd) return;  // get this if yargsDict.f and 'file' does not exist
    // If -f mode then check for no-change
    // It's just easier to compare the same files we would comparatorCmd rather than transform
    // yet again to compare in memory.
    if (yargsDict.f && fs.readFileSync(file, "utf8") === fs.readFileSync(prevRevFile, "utf8")) {
        fs.unlinkSync(prevRevFile);
        console.info("No change");
        return;
    }

    console.info(`Executing: ${comparatorCmd}`, prevRevFile, path.normalize(file));
    const pObj = child_process.spawnSync(  // eslint-disable-line camelcase
      format(comparatorCmd, prevRevFile, path.normalize(file)), {
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    if ("error" in pObj) throw new Error(pObj.message);
    // Many of the comparators will return non-0 if the files differ, as
    // we intend.  So use stderr Buffer rather than .exitCode to determine
    // success.
    if (pObj.stderr.length > 0)
        console.error(`Did the command fail?\n${pObj.stderr.toString("utf8")}`);
    console.info(pObj.stdout.toString("utf8"));
    if (yargsDict.f) console.error(
      `If you wish to overwrite local file '${file}' then remove it yourself and re-run.`);
        /* Don't want the dependency upon platform-specific syncprompt module.
        const response = prompt(`Overwrite local file '${file}' [yes]?  `);
        // silently overwrites:
        if (response === "" || ["Y", "y"].includes(response[0])) {
            //fs.renameSync(prevRevFile, file);  This only works if both files on same FS partition.
            fs.copyFileSync(prevRevFile, file);
        }
        */
    fs.unlinkSync(prevRevFile);
}
