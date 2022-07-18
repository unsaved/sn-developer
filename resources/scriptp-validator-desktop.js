function validate(value) {
    "use strict";
    switch (g_form.getTableName()) {
        case "sys_script_client":
        case "catalog_script_client":
        case "expert_script_client":
        case "sys_ui_action":
        case "sys_ui_policy":
        case "sys_ui_script":
        case "sys_script_validator":
            return true;
    }

    const ajax = new GlideAjax('JSValidator');
    ajax.addParam('sysparm_name', 'validate');
    ajax.addParam('sysparm_js_expression', value);
    ajax.getXMLWait();
    const answer = ajax.getAnswer();
    if (answer === null)
        return true;

    return getMessage(`Could not save record because of a compile error: ${answer}`);
}
