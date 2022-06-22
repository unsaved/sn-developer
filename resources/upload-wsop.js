(function() {

/* global response, HttpCodeError, request, sn_ws_err */

const fName = "admc/sndev/upload:rest";
var eMsg, dict, oldContent;
//const callerId = gs.getUserID();

try {

    if (!gs.hasRole("sndev"))
        throw new HttpCodeError(403, gs.getUserName() + " not a member of required role");
    /*
    if (gs.getProperty("instance_name") === "x")
        throw new HttpCodeError(403, "Service not authorized in Prod"); */
    const table = request.pathParams.table;
    const field = request.pathParams.field;
    if (!table)
        throw new HttpCodeError(400, "Table not set in request URL after /api/*/dev/");
    if (!field)
        throw new HttpCodeError(400, "Field not set in request URL after /api/*/dev/<TABLE>");
    if (!request.queryParams.query)
        throw new HttpCodeError(400, "Request does not set required http param 'query'");
    const query = String(request.queryParams.query);
    var appScope;
    if (request.queryParams.appscope) appScope = String(request.queryParams.appscope);
    /*  If you want to impersonate, perhaps to switch to a SSO account:
    const targetUid = GlideRecord.get1("sys_user", ["sys_id", callerId]).
      getValue("u_profile_owner");
    if (!targetUid)
        throw new HttpCodeError(403, gs.getUserName() + " not authorized (2)");
    const targetUserGR = GlideRecord.get1("sys_user", ["user_name", targetUid], true);
    if (!targetUserGR)
        throw new HttpCodeError(403, "Target user '" + targetUid + "' not available");
    new GlideImpersonate().impersonate(targetUserGR.getValue("sys_id"));
    if (gs.getUserName() === "guest") throw new HttpCodeError(403, "Impersonation failed");
    gs.log("I became " + gs.getUserName(), fName); */
    const r = new GlideRecord(table);
    if (!r.isValid()) throw new HttpCodeError(404, "Not a table: " + table);
    if (!r.isValidField(field))
        throw new HttpCodeError(404, "No such field: " + table + "." + field);
    if (appScope &&!r.isValidField("sys_scope"))
        throw new HttpCodeError(404, "No such field: " + table + ".sys_scope");

    r.setLimit(2);
    r.addEncodedQuery(query);
    if (appScope) r.addQuery("sys_scope.scope", appScope);
    r._query();
    if (r.getRowCount() > 1)
        throw new HttpCodeError(404, "Query matches multiple records: "
          + table + " with " + r.getEncodedQuery());
    if (r.getRowCount() !== 1)
        throw new HttpCodeError(404, "Query matches no records: "
          + table + " with " + r.getEncodedQuery());
    if (!r._next())
        throw new HttpCodeError(500, "Internal failure.  GR _next failed after rowCount 1");

    const ds = request.body.dataString;
    if (typeof ds !== "string")
        throw new HttpCodeError(400, "PATCH body not a JSON string but a " + typeof(ds));
    try {
        dict = JSON.parse(ds);
    } catch(e0) {
        throw new HttpCodeError(400, "Body contains invalid JSON: " + e0);
    }
    //if (!AdmcUtil.isPlainObject(dict))  would be a much better test
    if (typeof(dict) !== "object")
        throw new HttpCodeError(400, "Decoded body is not a plain object but " + typeof(dict));
    if (typeof dict.content !== "string")  // to upload null, client needs to send "".
        throw new HttpCodeError(
          400, "Provided content not a string but a " + typeof(dict.content));
    oldContent = r.getValue(field);
    if (oldContent === null) oldContent = "";
    // eslint-disable-next-line  servicenow/minimize-gs-log-print
    gs.log(table + "." + field + " content length: " + oldContent.length
      + " => " + dict.content.length, fName);
    r.setValue(field, dict.content);
    if (!r.changes()) throw new HttpCodeError(409, "Provided content is not a change");
    if (!r.update()) throw new HttpCodeError(500, "Update failed");

    response.setContentType("text/plain");
    response.setStatus(200);
    response.getStreamWriter().writeString(oldContent);
    return undefined;

} catch(e) {
    gs.sleep(1000);
    const snErr = new sn_ws_err.ServiceError();  // eslint-disable-line camelcase
    if (e instanceof HttpCodeError) {
        e.log(fName);
        snErr.setStatus(e.code);
        const firstNl = e.messageString.indexOf("\n");
        snErr.setMessage(firstNl < 0 ? e.messageString : e.messageString.substring(0, firstNl));
        if (firstNl > -1) snErr.setDetail(e.messageString.substring(firstNl+1));
    } else {
        if (typeof e === "object" && e !== null && "message" in e) try {
            if (e.message) eMsg = String(e.message);
        } catch (eNest) { } // Intentionally empty
        gs.logError("Caught: " + (eMsg === undefined ? String(e) : eMsg), fName);
        snErr.setStatus(500);
        snErr.setMessage(eMsg === undefined ? String(e) : eMsg);
    }
    return snErr;
}

})();
