/* global g_validation_script_field_count */
function validate(value, fieldName) {
    "use strict";
    if (!NOW.sp)
        return true;

    const validator = function(callback) {
        if (!value) {
            callback(fieldName, true);
            return;
        }

        // disable validation for certain tables
        switch (g_form.getTableName()) {
            case "sys_script_client":
            case "catalog_script_client":
            case "expert_script_client":
            case "sys_ui_action":
            case "sys_ui_policy":
            case "sys_ui_script":
            case "sys_script_validator":
                callback(fieldName, true);
                return;
        }

        const ajax = new GlideAjax('JSValidator');
        ajax.addParam('sysparm_name', 'validate');
        ajax.addParam('sysparm_js_expression', value);
        ajax.getXMLAnswer(answer => {
            if (answer === null) {
                callback(fieldName, true);
            } else {
                getMessage('Could not save record because of a compile error', trnsErrMsg =>
                    callback(fieldName, false, `${trnsErrMsg}: ${answer}`)
                );
            }
        });
    };

    return g_ui_scripts['sp.validation.executor']().
      execute(fieldName, validator, g_validation_script_field_count, g_form, NOW);
}
