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
const child_process = require("child_process"); // eslint-disable-line camelcase

// We keep a copy of the yargs instance so we can invoke methods on it like
// .help().
const yargs = require("yargs")(process.argv.slice(2)).
  strictOptions().
  usage(`SYNTAX: $0 [-dnqrv] [-p username] [-m POLL_MS] file.ext    OR   $0 -e|h|u
Honored environmental variables.  * variables are required:
    SN_CF_COMMAND:      Comparison command template  (-e to display examples)
   *SN_DEVELOPER_INST:  Short (unqualified) ServiceNow instancename
    SN_FORCE_COLOR:     Set to true to force color output from ESLint
    SN_HTTPS_PROXY:     HTTPS Proxy URL
   *SN_RESTAPI_SCOPE:   Scope of the WS Op upload resource path after '/api/'
    SN_RESTAPI_NAME:    Name of the WS upload definition name.  Defaults to 'sndev'.`).
  option("e", {
      describe: "display Environment settings for different comparators",
      type: "boolean",
  }).
  option("v", {
      describe: "Verbose.  N.b. may display passwords!",
      type: "boolean",
  }).
  option("d", { describe: "Debug logging", type: "boolean", }).
  option("m", {
      describe: "Monitor poll period in milliseconds, positive integer",
      requiresArg: true,
      type: "number",
  }).
  option("n", { describe: "No syntax/lint check for *.js file", type: "boolean", }).
  option("p", {
      describe: ("Prompt for basic auth password for the specified user.  "
        + "(By default uses name and passsword from netrc file)."),
      type: "string",
  }).
  option("q", {
      describe: "Quiet logging by logging only at level WARN and ERROR",
      type: "boolean",
  }).
  option("r", {
      describe: "Refresh local file. Replace (or create) local file from instance",
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
if (yargsDict.m && yargsDict.r) {
    console.error("Switches -m  and -r are mutually exclusive");
    yargs.showHelp();
    process.exit(9);
}
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
        console.error("Switch -m value not a positive integr: " + yargsDict.m);
        yargs.showHelp();
        process.exit(9);
    }
}
const isUnixShell = process.env.SHELL !== undefined;

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
    if (!yargsDict.r) {
        console.debug(`Checking local file '${file}'`);
        if (!fs.existsSync(file)) throw new AppErr("File is missing:", file);
        if (!fs.statSync(file).isFile()) throw new AppErr("Not a regular file:", file);
        try {
            fs.accessSync(file, fs.constants.R_OK);
        } catch(nestedE) {
            throw new AppErr(`Can't read file: [${file}]`);
        }
        fileExt = file.replace(/.*[.]/, "");
        if (fileExt === "") fileExt = null;
        if (process.env.SN_CF_COMMAND !== undefined) {
            comparatorCmd = process.env.SN_CF_COMMAND;
        } else {
            comparatorCmd = isUnixShell ? DEFAULT_CF_CMD_UNIX : DEFAULT_CF_CMD_WIN;
        }
        console.debug("comparatorCmd", comparatorCmd);
    }

    const uploadEntry = new UploadMap().getEntry(file);
    if (uploadEntry === null)
        throw new AppErr(`You must add an entry for '${file}' in a 'uploadmap.txt' file.`);
    if (yargsDict.m) {
        lastChecksum = checksum(fs.readFileSync(file, "utf8"));
        if (!lastChecksum) throw new Error("Assertion failed.  First checksum empty.");
        setInterval(transfer, yargsDict.m);  // eslint-disable-line no-use-before-define
    } else {
        transfer();  // eslint-disable-line no-use-before-define
    }

    function transfer() {
        let localFileText;
        if (!yargsDict.r) {
            if (file.endsWith(".js") && !yargsDict.n) {
                const lintSnArgs = [ path.join(__dirname, "lintSnScriptlet.js") ];
                // TODO:  Developers may add their own fields, like my own u_text_file.content,
                // which also allow fully support 'const'.  Think of some way to either auto-detect
                // or allow end-user configuration.
                switch (uploadEntry.table) {
                    case "sys_script_client":
                    case "catalog_script_client":
                        break;
                    default:
                        lintSnArgs.push('-c');
                }
                lintSnArgs.push(file);
                try {
                    // eslint-disable-next-line camelcase
                    child_process.execFileSync(process.execPath, lintSnArgs, { stdio: "inherit" });
                } catch (e9) {
                    throw new AppErr("Lint check failed");
                }
            }

            localFileText = fs.readFileSync(file, "utf8");
            if (lastChecksum) {
                // Only and always runs when in monitor mode
                const newChecksum = checksum(localFileText);
                if (newChecksum === lastChecksum) return;
                lastChecksum = newChecksum;
            }
            fileHasCRs = localFileText.includes("\r");
            if (!localFileText.includes("\r")) localFileText = localFileText.replace(/\n/g, "\r\n");
            if (localFileText.endsWith("\r\n")) localFileText = localFileText.slice(0, -2);


        }

        const url = `https://${instName}.service-now.com` + (yargsDict.r ?
            `/api/now/v2/table/${uploadEntry.table}` :
            `/api/${apiScope}/${apiName}/${uploadEntry.table}/${uploadEntry.dataField}`);
        const authOpts = { auth: (rcFile === undefined
          ? { username: yargsDict.p, password: require("readline-sync").
              question(`Password for '${yargsDict.p}': `, {hideEchoBack: true}) }
          : rcFile.getAuthSettings(url)
        )};
        const opts = {
            method: yargsDict.r ? 'get' : 'patch',
            url: url,
            params: yargsDict.r ? {
              /* eslint-disable camelcase */
              sysparm_query: `${uploadEntry.keyField}=${uploadEntry.keyValue}`,
              sysparm_fields: uploadEntry.dataField,
              sysparm_limit: 2,
              /* eslint-enable camelcase */
            } : {
                query: `${uploadEntry.keyField}=${uploadEntry.keyValue}`
            },
        };
        if ("SN_HTTPS_PROXY" in process.env) {
            const ex = /^([^:]+):[/]+([^:]+)(?::(\d+))?$/.exec(process.env.SN_HTTPS_PROXY);
            if (!ex)
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
            console.info(`Will send request to: ${url}\nwith opts (- data):`,
              {...opts, ...authOpts});
        if (!yargsDict.r) opts.data = { "content": localFileText };
        axios({...opts, ...authOpts}).
          then(conciseCatcher(responseHandler, 1),  // eslint-disable-line no-use-before-define
          e=>console.error(
            "Caught failure.  Consider checking %s's syslog for messages written by %s.\n%s%s",
            instName, authOpts.auth.username, e.message,
            (e.response !== undefined && e.response.data !== undefined
            && e.response.data.error !== undefined
            && e.response.data.error.message !== undefined
              ? ("\n" + e.response.data.error.message) : ""))
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
    let prevRevData;
    if (yargsDict.r) {
        validate(arguments, [{data: {result: "array"}}]);
        if (response.data.result.length < 1) throw new AppErr("Got no records from server");
        if (response.data.result.length > 1) throw new AppErr("Got multiple records from server");
        if (!isPlainObject(response.data.result[0]))
            throw new AppErr("Got something other than a plain object from server: %O",
              response.data.result[0]);
        if (Object.keys(response.data.result[0]).length !== 1)
            throw new AppErr("Object from server has "
              + Object.keys(response.data.result[0]).length + " fields instead of just 1");
        prevRevData = Object.values(response.data.result[0])[0];
        if (typeof(prevRevData) !== "string") throw new AppErr("Object from server has "
          + typeof(prevRevData) + " instead of string content");
        fileHasCRs = prevRevData.includes("\r");
        fs.writeFileSync(path.normalize(file), prevRevData + (fileHasCRs ? "\r\n" : "\n"));
        console.debug("Wrote %s", path.normalize(file));
        return;
    }
    validate(arguments, [{data: "string"}]);
    prevRevData = response.data;
    console.debug("Received", prevRevData);
    const prevRevFile = format("%s-%i.%s",
      path.join(require("os").tmpdir(), progName.replace(/[.][^.]*$/, "")),
      process.pid, fileExt === null ? "txt" : fileExt);
    console.debug("Writing prevRevFile file:", prevRevFile);
    if (fileHasCRs) {
        if (!prevRevData.includes("\r")) prevRevData = prevRevData.replace(/\n/g, "\r\n");
    } else {
        if (prevRevData.includes("\r")) prevRevData = prevRevData.replace(/\r/g, "");
    }
    fs.writeFileSync(prevRevFile, prevRevData + (fileHasCRs ? "\r\n" : "\n"));
    console.info("Executing: " + comparatorCmd, prevRevFile, path.normalize(file));
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
        console.error("Did the command fail?\n" + pObj.stderr.toString("utf8"));
    fs.unlinkSync(prevRevFile);
    console.info(pObj.stdout.toString("utf8"));
}
