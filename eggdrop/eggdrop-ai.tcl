######################################################################
# eggdrop-ai.tcl - LLM-powered IRC bot via local gateway
#
# Installation:
#   1. Copy this file to your eggdrop/scripts/ directory
#   2. Add "source scripts/eggdrop-ai.tcl" to your eggdrop.conf
#   3. .rehash or restart the bot
#
# Requirements:
#   - Eggdrop with http package (standard in modern Eggdrop)
#   - Local gateway running on http://127.0.0.1:3042
######################################################################

package require http

# Configuration
set llmbot_gateway "http://127.0.0.1:3042/chat"
set llmbot_timeout 15000
set llmbot_rate_limit 10 ;# seconds between requests per user

# Rate limiting storage: array of user -> timestamp
array set llmbot_last_request {}

# Bind to public channel messages
bind pub - * llmbot_pub_handler

proc llmbot_pub_handler {nick uhost hand chan text} {
    global llmbot_last_request llmbot_rate_limit botnick

    # Check if message mentions the bot (using actual bot nickname)
    # Use string match instead of regex to avoid injection
    set trigger ""
    set text_lower [string tolower $text]
    set bot_lower [string tolower $botnick]

    # Check for @botname pattern
    if {[string match "@${bot_lower}:*" $text_lower] || [string match "@${bot_lower} *" $text_lower]} {
        set trigger "@${botnick}"
        # Extract query after @botname: or @botname<space>
        if {[string match "@${bot_lower}:*" $text_lower]} {
            set query [string trim [string range $text [expr {[string length $botnick] + 2}] end]]
        } else {
            set query [string trim [string range $text [expr {[string length $botnick] + 2}] end]]
        }
    } elseif {[string match "${bot_lower}:*" $text_lower]} {
        set trigger "${botnick}:"
        # Extract query after botname:
        set query [string trim [string range $text [expr {[string length $botnick] + 1}] end]]
    } else {
        return 0
    }

    # Rate limiting check
    set now [clock seconds]
    set user_key "${nick}!${chan}"

    if {[info exists llmbot_last_request($user_key)]} {
        set elapsed [expr {$now - llmbot_last_request($user_key)}]
        if {$elapsed < $llmbot_rate_limit} {
            set wait [expr {$llmbot_rate_limit - $elapsed}]
            putserv "PRIVMSG $chan :$nick: please wait ${wait}s"
            return 0
        }
    }

    # Update rate limit timestamp
    set llmbot_last_request($user_key) $now

    # Clean up the query
    set query [string trim $query]

    if {$query eq ""} {
        putserv "PRIVMSG $chan :$nick: yes?"
        return 0
    }

    # Send request to gateway
    llmbot_query $nick $chan $query

    return 0
}

proc llmbot_query {nick chan message} {
    global llmbot_gateway llmbot_timeout

    # Build JSON payload
    set json_message [llmbot_json_escape $message]
    set json_user [llmbot_json_escape $nick]
    set json_channel [llmbot_json_escape $chan]

    set payload "\{\"message\":\"$json_message\",\"user\":\"$json_user\",\"channel\":\"$json_channel\"\}"

    # Make HTTP POST request
    if {[catch {
        set token [::http::geturl $llmbot_gateway \
            -query $payload \
            -timeout $llmbot_timeout \
            -type "application/json" \
            -headers [list "Content-Type" "application/json"]]

        set status [::http::status $token]
        set ncode [::http::ncode $token]
        set data [::http::data $token]

        ::http::cleanup $token

        if {$status eq "ok" && $ncode == 200} {
            # Sanitize response before sending to IRC to prevent command injection
            set sanitized_data [llmbot_sanitize_irc $data]

            # Split response into lines if needed (for long responses)
            set lines [split $sanitized_data "\n"]
            foreach line $lines {
                set line [string trim $line]
                if {$line ne ""} {
                    putserv "PRIVMSG $chan :$line"
                }
            }
        } else {
            putserv "PRIVMSG $chan :$nick: gateway error (status: $status, code: $ncode)"
        }
    } error]} {
        putserv "PRIVMSG $chan :$nick: failed to reach gateway - $error"
    }
}

proc llmbot_json_escape {text} {
    # Escape special JSON characters (comprehensive escaping)
    set text [string map {
        "\\" "\\\\"
        "\"" "\\\""
        "\n" "\\n"
        "\r" "\\r"
        "\t" "\\t"
        "\f" "\\f"
        "\b" "\\b"
    } $text]
    # Remove any remaining control characters
    regsub -all {[\x00-\x1F]} $text "" text
    return $text
}

proc llmbot_sanitize_irc {text} {
    # Remove IRC control characters to prevent command injection
    # Strip CR, LF, and NULL bytes that could be used for IRC protocol injection
    set text [string map {
        "\r" " "
        "\n" " "
        "\x00" ""
    } $text]
    # Remove any other control characters that could be dangerous
    regsub -all {[\x00-\x1F]} $text "" text
    return $text
}

# Cleanup old rate limit entries (every 5 minutes)
bind time - "*/5 * * * *" llmbot_cleanup

proc llmbot_cleanup {min hour day month year} {
    global llmbot_last_request llmbot_rate_limit

    set now [clock seconds]
    set cutoff [expr {$now - ($llmbot_rate_limit * 10)}]

    foreach key [array names llmbot_last_request] {
        if {$llmbot_last_request($key) < $cutoff} {
            unset llmbot_last_request($key)
        }
    }
}

putlog "eggdrop-ai.tcl loaded - LLM gateway ready"
