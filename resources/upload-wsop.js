(function() {

/* global response, HttpCodeError, request, sn_ws_err */

const fName = "sndev/upload:rest";
//const HttpCodeError = x_fenma_util.HttpCodeError;
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
    /*
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
    /* SO MUCH EASIER With AdmcUtil utilities:
    if (AdmcUtil.isTable(table))
    and GlideAggregate.matchCount("sys_dictionary", [["name", table], ["element", field]]) */
    if (!new GlideRecord("sys_db_object").get("name", table))
        throw new HttpCodeError(404, "Not a table: " + table);
    const checkGA = new GlideAggregate("sys_dictionary");
    checkGA.addQuery("name", table);
    checkGA.addQuery("element", field);
    checkGA.addAggregate("COUNT");
    checkGA._query();
    if (!checkGA._next()) throw new Error(fName + " internal assertion failed on _next");
    gs.logWarning("3: " + checkGA.getRowCount(), fName);
gs.logWarning("2: " + checkGA.getAggregate, fName);
gs.logWarning("A: " + checkGA.getAggregate("COUNT"), fName);
    if (parseInt(checkGA.getAggregate("COUNT")) < 1)
        throw new HttpCodeError(404, "No such field: " + table + "." + field);
gs.logWarning("B: " + parseInt(checkGA.getAggregate("COUNT")), fName);

    /* With GlideRecord extensions:
    if (GlideRecord.get1MultiCrit("sys_dictionary", [
        ["name", table],
        ["element", field],
    ], true) === null)
        throw new HttpCodeError(404, "Not a field: " + table + "." + field);
    const r = GlideRecord.get1(table, query, true);
    if (r === null)
        throw new HttpCodeError(404, "Query does not match 1 record: " + query); */

    //OOTB GlideRecord:
    const r = new GlideRecord(table);
    r.addEncodedQuery(query);
    r._query();
    if (r.getRowCount() !== 1)
        throw new HttpCodeError(404, "Query does not match 1 record: " + query);
    if (!r._next())
        throw new HttpCodeError(500, "Internal failure.  GR _next failed after rowCount 1");

    const ds = request.body.dataString;
    if (typeof ds !== "string")
        throw new HttpCodeError(400, "PATCH body not a JSON string but a "
          + typeof(ds));
    try {
        dict = JSON.parse(ds);
    } catch(e0) {
        throw new HttpCodeError(400, "Body contains invalid JSON: " + e0);
    }
    /* Better test if have AdmcUtility utilities:
    if (!AdmcUtil.isPlainObject(dict)) */
    if (typeof(dict) !== "object")
        throw new HttpCodeError(400, "Decoded body is not a plain object but " + typeof(dict));
    if (typeof dict.content !== "string")  // to upload null, client needs to send "".
        throw new HttpCodeError(
          400, "Provided content not a string but a " + typeof(dict.content));
    oldContent = r.getValue(field);
    if (oldContent === null) oldContent = "";
    // eslint-disable-next-line  servicenow/minimize-gs-log-print
    gs.log("OLD content length: " + oldContent.length
      + "\nNEW content length: " + dict.content.length, fName);
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
