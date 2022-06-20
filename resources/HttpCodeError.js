function HttpCodeError(code, messageString, srcLocation) {
    this.name = "HttpCodeError";
    this.code = code;
    this.messageString = messageString;
    this.srcLocation = srcLocation;
    //if (!AdmcUtil.isInteger(this.code))
    if (typeof(this.code) !== "number" || parseInt(this.code) !== this.code)
        throw new Error("Bad HttpCodeError instantiation.  Code " + code + " not an integer");
    if (typeof messageString !== "string") throw new Error(
      "Bad HttpCodeError instantiation.  Message " + messageString + " not a string");
    if (srcLocation !== undefined && typeof srcLocation !== "string") throw new Error(
      "Bad HttpCodeError instantiation.  Optional srcLocation " + srcLocation + " not a string");
    this.message = "HTTP " + code + ".  " + this.messageString;
    this.toString = function() { return this.message; };
    this.log = function(srcLocation) {
        if (srcLocation === undefined) srcLocation = this.srcLocation;
        gs.logError(this.message, srcLocation === undefined ? "HttpCodeError" : srcLocation);
    };
}
HttpCodeError.prototype = new Error;
