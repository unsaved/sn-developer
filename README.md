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
* **lineSnScriptlet**  Executes ESLint against one specified ServiceNow JavaScript scriptlet file.

snUpload requires installation of a Scripted REST API to serve the upload requests.


# Installation
Most users will want to install globally:
```
    npm i -g @admc.com/sn-developer
```
To bundle with your own project, install locally:
```
    npm i @admc.com/sn-developer
```
