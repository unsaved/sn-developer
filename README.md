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
* **lintSnScriptlet**  Executes ESLint against one specified ServiceNow JavaScript scriptlet file.



# Installation
Most users will want to install globally:
```
    npm i -g @admc.com/sn-developer
```
To bundle with your own project, install locally:
```
    npm i @admc.com/sn-developer
```

When you run snUpload and snVersions, they will tell you the environmental variables that you
need to set.

snUpload requires installation of a Scripted REST API to serve the upload requests.
The 'resources/' directory for this package contains an Update Set export "sndev-US.xml"
which contains a working sample scripted REST API 'sndev'.
This provided service requires membership in role 'sndev', so add non-admin developer accounts to
this role.
In most cases you should not be facilitating script uploads to a Production environment, so
consider editing the script to reject requests if the instance name isn't what you want.
(There is a commented out test for instance of name "x").
"resources/upload-wsop.js" contains the JavaScript code for the service.

lintSnScriptlet and snUpload (unless you use -n switch to skip syntax/lint checking)
require setup of ESLint RC files.
You can use "lintSnScriptlet -s" to create a sample ".eslintrc.json" file that you should
edit and adjust according to the comments in it.

To start managing a new soure file with snUpload, it usually makes sense to
1. Make sure it's covered correctly by your .eslintrc.json file(s).
   Add to overrides/files lists or whatever is necessary.
1. Add an entry to "upadatemap.txt"
1. Assuming that you don't already have the starting script file, run
    ```
    snUpload -r path/to/script.js
    ```
This will give you the code to start with.
1. Check the EOL style of the text file.  -r will give you whatever format the ServiceNow
   instance prefers.  Change the EOL style to what you want to work with (this will not change
   the EOL style on the SN instance).
