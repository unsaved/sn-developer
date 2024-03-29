#Development Workstation Utility scripts for ServiceNow Developers

## Description
Major components
* **snUpload**  Uploads locally edited or managed scripts to target ServiceNow instance.
                Displays difference from previous version on the instance.
                Has option to fetch the current version from the instance (for example to revert).
                Can only be invoked for a single script.
* **snMultiUpload**  Invokes snUpload with same switches (or none) for multiple files.
                For sample switch -l you could run like:  snMultiUpload -l -- path/1.js sub/dir
* **snVersions**  Displays versions of records for the specified SN-version-tracked table;
                  or displays delta between two specified versions for specified field of the table.
* **suxList**  Displays sys_update_xml records with the crucial attributes for the specified local
               Update Set XML file(s).
* **snLint**  Executes ESLint against one specified ServiceNow JavaScript scriptlet file.
              (This is actually provided by module @admc.com/eslint-plugin-sn.
              Details about that below).
* **Update Set**  This contains the instance-side service to support script uploading, and settings
              to accommodate ES6 client scripting and TinyMCE linting, as much as possible.
              The implementation component scriptlets are available in the ``resources`` subdirectory.

## Installation
To install globally (accessible to all npm projects):
```
    npm i -g @admc.com/sn-developer
```
UNIX users will need root privileges, so run this as root or under sudo.

To use just with your own project, install locally:
```
    npm init -y  # If a ``./package.json`` or ``./node_modules/`` is not already present
    npm i @admc.com/sn-developer
```
(Without a ``./package.json`` or ``./node_modules/`` present, npm may install the package to
another cascade directory).

To defeat incompetent OOTB validation, update sys_script_validator records on your instance.
We provide samples that you can just copy in.  See file "doc/scriptValidators.txt".

### Transport Setup
snUpload* and snVersions require for transport either ServiceNow CLI installed on client side
and available in search path,
or server-side installation of the provided Scripted REST API to serve the upload requests.

#### ServiceNow CLI Transport
To use ServiceNow CLI as transport, ensure that the 'record' Command Group is working with your
desired profile.  A good test command would be:

```
    snc -p default record query -t sys_propreties -q name=instance_name --fields=value
```

You must set environmental variable 'SN_CLI_PROFILE' to enable SN CLI transport mode for
snUpdate and snVersions.

#### Custom Scripted REST API Transport
The 'resources/' directory for this package contains an Update Set export
``sn-developer_service-US.xml`` which contains a working sample scripted REST API, 'sndev'.
This provided service requires membership in role 'sndev' if you don't have admin,
so add non-admin developer accounts to this role.
This is implemented in global scope because a major purpose is to update records in multiple
other scopes.
In most cases you should not be facilitating script uploads to a Production environment, so
consider editing the script to reject requests if the instance name isn't what you want.
(There is a commented-out test for instance of name ``x``
``resources/upload-wsop.js`` contains the JavaScript code for the service.

You must set environmental variable 'SN_DEVELOPER_INST' to enable Scripted REST API transport mode
for snUpdate and snVersions.

## Setup and Usage

Run snUpload and snVersions with '-h' switch to learn about environmental variables that you
need to set.
You will probably want to set in a UNIX ~/.profile (don't forget to export) or via Windows
sysdm.cpl or a CMD script.

snLint and snUpload (unless you use -n switch to skip syntax/lint checking)
require setup of ESLint files.
```
    npm exec snLint -- -s
    npm exec snLint -- -g .
```

GOTCHA!  For unknown reason, on Windows with global installation of developer-sn, 'npm exec' can't
find snLint even though it is present.  If you hit this, install eslint-plugin-sn globally:
```
    npm i -g @admc.com/eslint-plugin-sn
```

To get invocation syntax help:
```
    npm exec snUpload -- -h
    npm exec snVersions -- -h
```
Read the syntax messages about required and optional environmental variables.
Of course make a script file, use sysdm.cpl, or similar so you only have to set up the variables
once.

To start managing a new source file with snUpload, it usually makes sense to
1. Make sure it's covered correctly by your sneslintrc.json file.
   Add to overrides/files lists or whatever is necessary.
1. Add an entry to ``updatemap.txt`` unless already covered by a regex entry
1. Assuming that you don't already have the starting script file locally, run
    ```
    snUpload -r path/to/script.js > path/to/script.js  # for global sn-developer installation
    node_modules/.bin/snUpload -r path/to/script.js > path/to/script.js  # local installs
    ```
    This will give you the code to start with.
1. Check the EOL style of the text file.  -r will give you whatever format the ServiceNow
   instance prefers.  Change the EOL style to what you want to work with (this will not change
   the EOL style on the SN instance).

I find it extremely convenient to put scriptlet files for the same scriptlet type or scope
into dedicated subdirectories, then use one uploadmap RegExp entry per directory, like
```
    /^myapp[/]client[.]d[/][\w-]+[.]js$/ sys_ui_page client_script name < x_admc_jetlib all
```

## Invocation methods for Local Module Installations
This section is true of bin scripts from any npm module non-global installation,
not just this module
If you installed globally and don't care to know, then ignore this section.
Run commands for either method from the directory into which you installed the module.
Two invocation methods are most convenient.:
1. npm exec binScript [-- -script switches] [scriptArgs]
1. node_modules/.bin/binScript [-script switches] [scriptArgs]

Conceptually, ``npm exec`` sets up a convenient node execution environment, with
``node_modules/.bin`` in the search path, and it adds some indicators to stdout.
If you installed to some other cascaded node_modules, it handles that too.
(You shouldn't be using other non-global node_modules directories unless you understand things
far better than I am covering here, because imperfect setups can lead to confusing resolution
failures).

Notice that when using npm you must add "--" before script switches if you supply any.
Then npm format adds to the actual script output, so don't use this method if you are redirecting
to a file or pipe, or for any other reason you need to output precisely the script output.

There is also 'npm run' which behaves exactly like the 'npm exec' method above, except that
in place of "binScript" you give the name for a "script" defined in your ``package.json`` file.

## Color Output Work-around
As a work-around for a mingw or git-for-windows glitch, if Node.js can't determine tty interactivity
correctly, then you can export env node variable FORCE_COLOR to true.
You can check your system with
```
    node -p process.stdout.isTTY
```

# ServiceNow ESLint Configuration
Due to obvious (typical) coding mistakes made by ServiceNow, and in other cases ignorance (again
typically), by default the platform prevents saving any client script form record when you have an
ES6 construct (such as a 'let' statement or an arrow function).
We have provided 4 override validation scripts that relax the ES5 constrains on client scripts.

Contrary to ServiceNow's Open Source disclosure, the San Diego TinyMCE ESLint editor uses a version
of ESLint between  5.15.0 inclusive and 6.2.0 exclusive (because it supports
``prefer-named-capture-group`` but not ``function-call-argument-newline``).
That is ancient.  When configuring TinyMCE ESLint rules with sys property
glide.ui.syntax_editor.linter.eslint_config, specifying rules before 5.6.0 will cause problems.
See version attribute of rules at https://eslint.org/docs/latest/rules/ .

The provided Update Set sets our suggested value for this system property.
It's non-ideal because ServiceNow uses the old ESLint version, doesn't support critical ESLint
features, allows only one configuration file for all script types, and provides no
hooks to improve the situation.
The settings will give false positive hits when you define a function for say a Script Include
or a client script event function; and it allows global, server-scoped, and client non-isolated
construct anywhere, since is there no way to narrow the rules to specific scriptlet types or
attributes.
For that reason, it's better to use snLint on your desktop or through a service.
I have a snLint service that runs on the MID server and ServiceNow instances use this service from
UI Actions and Remote Update Set preview BR.
