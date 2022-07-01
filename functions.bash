# Useful shell functions

function rchead() {
    local TARGET_FILE=eslintrc.json
    local SYNTAX_MSG='SYNTAX: rchead n   # where n is a positive integer'
    [ -f "$TARGET_FILE" ] || {
        echo "rchead file '$TARGET_FILE' not present or not a file" 1>&2
        return 3
    }
    [ -r "$TARGET_FILE" ] || {
        echo "rchead file '$TARGET_FILE' not readable" 1>&2
        return 3
    }
    [ $# -ne 1 ] && {
        echo "$SYNTAX_MSG" 1>&2
        return 2
    }
    count="$1"; shift
    case "$count" in *[^0-9]*)
        echo -e "Invalid positive integer: $count\n$SYNTAXMSG"
        return 2;;
    esac
    case "$count" in *[1-9]*);; *)
        echo -e "Zero integer is not positive: $count\n$SYNTAXMSG"
        return 2;;
    esac
    head -c $count "$TARGET_FILE"
    local retVal=$?
    echo
    [ $? -eq 0 ] || return $retVal
}

function rcheaddot() {
    local TARGET_FILE=.eslintrc.json
    local SYNTAX_MSG='SYNTAX: rchead n   # where n is a positive integer'
    [ -f "$TARGET_FILE" ] || {
        echo "rchead file '$TARGET_FILE' not present or not a file" 1>&2
        return 3
    }
    [ -r "$TARGET_FILE" ] || {
        echo "rchead file '$TARGET_FILE' not readable" 1>&2
        return 3
    }
    [ $# -ne 1 ] && {
        echo "$SYNTAX_MSG" 1>&2
        return 2
    }
    count="$1"; shift
    case "$count" in *[^0-9]*)
        echo -e "Invalid positive integer: $count\n$SYNTAXMSG"
        return 2;;
    esac
    case "$count" in *[1-9]*);; *)
        echo -e "Zero integer is not positive: $count\n$SYNTAXMSG"
        return 2;;
    esac
    head -c $count "$TARGET_FILE"
    local retVal=$?
    echo
    [ $? -eq 0 ] || return $retVal
}
