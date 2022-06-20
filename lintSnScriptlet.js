#!/usr/bin/env node

"use srict";

const { AppErr, conciseCatcher, conciseErrorHandler, getAppVersion } = require("@admc.com/apputil");
const { validate } = require("@admc.com/bycontract-plus");
require("eslint-plugin-servicenow");

const fs = require("fs");
const path = require("path");

const yargs = require("yargs")(process.argv.slice(2)).
  strictOptions().
  usage(`SYNTAX: $0 [-cdHqv] [-- -eslint-switches] file/path.js     OR     $0 -h     OR
         $0 -s rc/directory
It is critically important to have ServiceNow-specific .eslintrc* file(s) set
up in the file/path.js directory and/or ancestor directories.
Set env variable SN_FORCE_COLOR to true to force ESLint to output colorized
text (some terminal or shell setups cause ESLint to default to no-color).`).
  option("v", {
      describe: "Verbose.  N.b. may display passwords!",
      type: "boolean",
  }).
  option("H", {
      describe: "output HTML instead of plain text report",
      type: "boolean",
  }).
  option("c", {
      describe: "unchecked Const statements (can't check consts for Rhino execution)",
      type: "boolean",
  }).
  option("d", { describe: "Debug logging", type: "boolean", }).
  option("s", {
      describe: "directory to write template '.eslintrc.json' Sample file into",
      type: "string",
  }).
  option("q", {
      describe: "Quiet logging by logging only at level WARN and ERROR",
      type: "boolean",
  }).
  alias("help", "h").
  version(getAppVersion(__dirname));
const yargsDict = yargs.argv;
const progName = yargsDict.$0.replace(/^.*[\\/]/, "");  // eslint-disable-line no-unused-vars
let targRcFile;

if (!yargsDict.d) console.debug = () => {};
if (yargsDict.q) console.debug = console.log = console.info = () => {};


conciseCatcher(async function() {
    validate(arguments, []);
    if (yargsDict.s) {
        targRcFile = path.join(yargsDict.s, ".eslintrc.json");
        if (fs.existsSync(targRcFile)) {
            console.error(`Refusing to overwrite existing '${targRcFile}'`);
            process.exit(8);
        }
        fs.copyFileSync(path.join(__dirname, "resources/eslintrc-example.json"), targRcFile);
        process.exit(0);
    }
    if (yargsDict._.length < 1) {
        console.error("You must specify a 'filepath.js' param unless using a -h, -r, or -s switch");
        yargs.showHelp();
        process.exit(9);
    }
    const srcFilePath = yargsDict._.pop();
    if (!fs.existsSync(srcFilePath)) throw new AppErr(`'${srcFilePath}' does not exists`);
    let content;
    const eslintArgs = yargsDict._.slice();
    if (process.env.SN_FORCE_COLOR) eslintArgs.splice(0, 0, "--color");
    if (yargsDict.c) {
        content = fs.readFileSync(srcFilePath, "utf8");
        eslintArgs.splice(0, 0,
            "--stdin",
            "--stdin-filename",
            path.join(process.cwd(), srcFilePath),
        );
    } else {
        eslintArgs.splice(0, 0, srcFilePath);
    }
    eslintArgs.splice(0, 0,
        path.join(__dirname, "/node_modules/eslint/bin/eslint.js"),
        "--resolve-plugins-relative-to",
        __dirname);
    if (yargsDict.H) eslintArgs.splice(1, 0, "-f", "html");
    console.debug('eslint invocation args', eslintArgs);
    const childProcess = require("child_process").spawn(process.execPath, eslintArgs, {
        stdio: ["pipe", "inherit", "inherit"],
    });
    if (content) {
        childProcess.stdin.write(content.replace(/(\s)const(\s)/g, "$1var$2"));
        childProcess.stdin.end();
    }
    childProcess.on("exit", ()=> {
        if (childProcess.exitCode !== 0) process.exit(childProcess.exitCode);
    });
}, 10)().catch(e0=>conciseErrorHandler(e0, 1));
