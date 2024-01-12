"use strict";

/* eslint-disable prefer-rest-params */
const { AppErr } = require("@admc.com/apputil");
const { validate } = require("@admc.com/bycontract-plus");
module.exports.toUnixSec = ampmToUnixSec;
module.exports.ampmToJsDate = ampmToJsDate;
module.exports.dateToInternalSNString = dateToInternalSNString;
module.exports.localIsoToJsDate = localIsoToJsDate;
module.exports.snInternalToSNLocalString = snInternalToSNLocalString;


module.exports.patterns = {
    AMPM_TIME: /^(\d\d)-(\d\d)-(\d\d\d\d) (\d\d):(\d\d):(\d\d) (AM|PM)$/,
    SYS_ID: /^[\da-f]{32}$/,
    TABLE_OR_FIELD: /^[_a-z][_\da-z]*$/,
    TABLE_DOT_FIELD: /^([_a-z][_\da-z]*)[.]([_\d_a-z]*)$/,
    ISO_S_TIME: /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)$/,
};
const AMPM_TIME_RE = module.exports.patterns.AMPM_TIME;
const ISO_S_TIME_RE = module.exports.patterns.ISO_S_TIME;

/**
 * Internal SN times are in UTC zone
 */
function dateToInternalSNString(date) {
    validate(arguments, ["date"]);
    return date.toISOString().replace("T", " ").replace(/[.].*/, "");
}

function localIsoToJsDate(isoString) {
    validate(arguments, ["isotimestring_s"]);
    const ex = ISO_S_TIME_RE.exec(isoString);
    if (!ex) throw new AppErr(`Malformatted 'isoString': ${isoString}`);
    return _toJsDate(ex[1], ex[2], ex[3], ex[4], ex[5], ex[6]);
}

function ampmToUnixSec(amPmString) {
    validate(arguments, ["string"]);
    const ex = AMPM_TIME_RE.exec(amPmString);
    if (!ex) throw new AppErr(`Malformatted 'amPmString': ${amPmString}`);
    return _ampmToUnixSec(ex[3], ex[1], ex[2], ex[4], ex[5], ex[6], ex[7]);
}
function ampmToJsDate(amPmString) {
    validate(arguments, ["string"]);
    const ex = AMPM_TIME_RE.exec(amPmString);
    if (!ex) throw new AppErr(`Malformatted 'amPmString': ${amPmString}`);
    return _toJsDate(ex[3], ex[1], ex[2], ex[4], ex[5], ex[6], ex[7]);
}
function _ampmToUnixSec(sY, sMo, sD, sH, sMi, sS, amPm) {
    validate(arguments, ["string", "string", "string", "string", "string", "string", "string"]);
    return Math.round(_toJsDate(sY, sMo, sD, sH, sMi, sS, amPm).valueOf()/1000);
}
function _toJsDate(sY, sMo, sD, sH, sMi, sS, amPm) {
    validate(arguments, ["string", "string", "string", "string", "string", "string", "string="]);
    const newDate = new Date();
    const nY = Number(sY);
    const nMo = Number(sMo - 1);
    const nD = Number(sD);
    const nH = Number(sH);
    const nMi = Number(sMi);
    const nS = Number(sS);
    newDate.setMilliseconds(0);
    newDate.setFullYear(nY);
    newDate.setMonth(nMo);
    newDate.setDate(nD);
    newDate.setHours(nH);
    newDate.setMinutes(nMi);
    newDate.setSeconds(nS);
    switch (amPm) {
      case undefined:
        break;
      case "PM":
        if (nH < 12) newDate.setTime(newDate.valueOf() + 12 * 60 * 60 * 1000);
        break;
      case "AM":
        if (nH === 12) newDate.setTime(newDate.valueOf() - 12 * 60 * 60 * 1000);
        break;
      default: throw new Error(`Unexpected token #6: ${amPm}`);
    }
    return newDate;
}

/**
 * The input internal SN times are in UTC zone
 */
function snInternalToSNLocalString(snUtcString) {
    const ootb = new Date();
    ootb.setTime(Date.parse(`${snUtcString}Z`));
    /* eslint-disable prefer-template */
    return ootb.getFullYear() + "-" +
      String(1 + ootb.getMonth()).padStart(2, "0") + "-" +
      String(ootb.getDate()).padStart(2, "0") + "T" +
      String(ootb.getHours()).padStart(2, "0") + ":" +
      String(ootb.getMinutes()).padStart(2, "0") + ":" +
      String(ootb.getSeconds()).padStart(2, "0");
    /* eslint-enable prefer-template */
}
