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
set llmbot_store_gateway "http://127.0.0.1:3042/store"
set llmbot_timeout 100000 ;# 100 seconds for slow free tier models
set llmbot_rate_limit 10 ;# seconds between requests per user
set llmbot_max_response_size 50000 ;# max bytes in LLM response (50KB)

# Rate limiting storage: array of user -> timestamp
array set llmbot_last_request {}

# Bind to public channel messages
bind pubm - * llmbot_pub_handler

proc llmbot_pub_handler {nick uhost hand chan text} {
    global llmbot_last_request llmbot_rate_limit botnick

    # Store ALL channel messages in memory (except from the bot itself)
    if {$nick ne $botnick} {
        llmbot_store_message $nick $chan $text
    }

    # Parse trigger and extract query (avoid regex for security)
    set text_lower [string tolower $text]
    set bot_lower [string tolower $botnick]
    set query ""

    # Check if bot's name appears anywhere in the message
    if {[string match "*${bot_lower}*" $text_lower]} {
        # Send the entire message as context
        set query [string trim $text]
    } else {
        return 0
    }

    if {$query eq ""} {
        putserv "PRIVMSG $chan :$nick: yes?"
        return 0
    }

    # Rate limiting
    set now [clock seconds]
    set user_key "${nick}!${chan}"

    if {[info exists llmbot_last_request($user_key)]} {
        set elapsed [expr {$now - $llmbot_last_request($user_key)}]
        if {$elapsed < $llmbot_rate_limit} {
            putserv "PRIVMSG $chan :$nick: please wait [expr {$llmbot_rate_limit - $elapsed}]s"
            return 0
        }
    }

    set llmbot_last_request($user_key) $now
    llmbot_query $nick $chan $query
    return 0
}

proc llmbot_store_message {nick chan message} {
    global llmbot_store_gateway

    set payload [format {{"message":"%s","user":"%s","channel":"%s"}} \
        [llmbot_json_escape $message] \
        [llmbot_json_escape $nick] \
        [llmbot_json_escape $chan]]

    # Fire and forget - store message without waiting for response
    if {[catch {
        set token [::http::geturl $llmbot_store_gateway \
            -query $payload \
            -timeout 5000 \
            -type "application/json" \
            -headers [list "Content-Type" "application/json"] \
            -command llmbot_store_callback]
    } error]} {
        # Silently fail - don't interrupt channel flow
    }
}

proc llmbot_store_callback {token} {
    # Cleanup after async store request
    catch {::http::cleanup $token}
}

proc llmbot_query {nick chan message} {
    global llmbot_gateway llmbot_timeout llmbot_max_response_size

    set payload [format {{"message":"%s","user":"%s","channel":"%s"}} \
        [llmbot_json_escape $message] \
        [llmbot_json_escape $nick] \
        [llmbot_json_escape $chan]]

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
            # Limit response size to prevent DoS
            if {[string length $data] > $llmbot_max_response_size} {
                putserv "PRIVMSG $chan :$nick: response too large, truncated"
                set data [string range $data 0 $llmbot_max_response_size]
            }

            # Sanitize and send each line
            foreach line [split [llmbot_sanitize_irc $data] "\n"] {
                set line [string trim $line]
                if {$line ne ""} { putserv "PRIVMSG $chan :$line" }
            }
        } else {
            # Show actual error details for debugging
            set safe_data [string range [llmbot_sanitize_irc $data] 0 200]
            if {$safe_data eq ""} { set safe_data "(no response)" }
            putserv "PRIVMSG $chan :$nick: gateway error ($ncode): $safe_data"
        }
    } error]} {
        # Show actual error for debugging
        set safe_error [string range [llmbot_sanitize_irc $error] 0 100]
        putserv "PRIVMSG $chan :$nick: gateway failed: $safe_error"
    }
}

proc llmbot_json_escape {text} {
    set text [string map {"\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\r" "\\r" "\t" "\\t" "\f" "\\f" "\b" "\\b"} $text]
    regsub -all {[\x00-\x1F]} $text "" text
    return $text
}

proc llmbot_sanitize_irc {text} {
    # Prevent IRC command injection by removing control characters
    set text [string map {"\r" " " "\n" " " "\x00" ""} $text]
    regsub -all {[\x00-\x1F]} $text "" text
    return $text
}

bind time - "*/5 * * * *" llmbot_cleanup

proc llmbot_cleanup {min hour day month year} {
    global llmbot_last_request llmbot_rate_limit
    set cutoff [expr {[clock seconds] - ($llmbot_rate_limit * 10)}]
    foreach key [array names llmbot_last_request] {
        if {$llmbot_last_request($key) < $cutoff} { unset llmbot_last_request($key) }
    }
}

putlog "eggdrop-ai.tcl loaded - LLM gateway ready"
