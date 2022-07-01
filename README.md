# Description
Development Workstation Utility scripts for ServiceNow Developers

Major components
* **snUpload**  Uploads locally edited or managed scripts to target ServiceNow instance.
                Displays difference from previous version on the instance.
                Has option to fetch the current version from the instance (for example to revert).
* **snVersions**  Displays versions of records for the specified SN-version-tracked table;
                  or displays delta between two specified versions for specified field of the table.
* **suxList**  Displays sys_update_xml records with the crucial attributes for the specified local
               Update Set XML file(s).
* **snLint**  Executes ESLint against one specified ServiceNow JavaScript scriptlet file.
              (This is actually provided by module @admc.com/eslint-plugin-sn, which sn-developer
              depends on and bundles).

# Installation
To install globally (accessible to all npm projects):
```
    npm i -g @admc.com/sn-developer
```
UNIX users will need root privileges, so run this as root or under sudo.

To use just with your own project, install locally:
```
    npm i @admc.com/sn-developer
```

##  REST Service
snUpload requires installation of a Scripted REST API to serve the upload requests.
The 'resources/' directory for this package contains an Update Set export
"sn-developer_service-US.xml" which contains a working sample scripted REST API, 'sndev'.
This provided service requires membership in role 'sndev' if you don't have admin,
so add non-admin developer accounts to this role.
This is implemented in global scope because a major purpose is to update records in multiple
other scopes.
In most cases you should not be facilitating script uploads to a Production environment, so
consider editing the script to reject requests if the instance name isn't what you want.
(There is a commented-out test for instance of name "x").
"resources/upload-wsop.js" contains the JavaScript code for the service.

# Setup and Usage

Run snUpload and snVersions with '-h' switch to learn about environmental variables that you
need to set.
You will probably want to set in a UNIX ~/.profile (don't forget to export) or via Windows
sysdm.cpl or a CMD script.

snLint and snUpload (unless you use -n switch to skip syntax/lint checking)
require setup of ESLint RC files.
You can use "snLint -s" to create a sample ".eslintrc.json" file that you should
edit and adjust according to the comments in it.
Also run "snLint -g ." to populate the global variable lists.

With global installaton
```
    snLint -s
    snLint -g .
```
With local installaton
```
    npm exec snLint -- -s
    npm exec snLint -- -g .
```

To start managing a new source file with snUpload, it usually makes sense to
1. Make sure it's covered correctly by your .eslintrc.json file(s).
   Add to overrides/files lists or whatever is necessary.
1. Add an entry to "updatemap.txt", unless already covered by a regex entry
1. Assuming that you don't already have the starting script file locally, run
    ```
    snUpload -r path/to/script.js              # for global sn-developer installation
    npm exec snUpload -- -r path/to/script.js  # for local sn-developer installation
    ```
    This will give you the code to start with.
1. Check the EOL style of the text file.  -r will give you whatever format the ServiceNow
   instance prefers.  Change the EOL style to what you want to work with (this will not change
   the EOL style on the SN instance).
