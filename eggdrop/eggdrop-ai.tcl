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
set llmbot_summary_gateway "http://127.0.0.1:3042/summary"
set llmbot_timeout 100000 ;# 100 seconds for slow free tier models
set llmbot_rate_limit 10 ;# seconds between requests per user
set llmbot_max_response_size 50000 ;# max bytes in LLM response (50KB)

# Rate limiting storage: array of user -> timestamp
array set llmbot_last_request {}

# Bind to public channel messages
bind pubm - * llmbot_pub_handler
bind pub - "!deepthought" llmbot_deepthought
bind pub - "!summary" llmbot_summary

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

proc llmbot_summary {nick uhost hand chan text} {
    global llmbot_summary_gateway llmbot_timeout llmbot_last_request llmbot_rate_limit

    # Rate limiting (reuse existing mechanism)
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

    # Parse optional hours parameter (default 24, cap at 96)
    set hours 24
    set arg [string trim $text]
    if {$arg ne ""} {
        if {[string is integer -strict $arg] && $arg > 0} {
            set hours [expr {min($arg, 96)}]
        } else {
            putserv "PRIVMSG $chan :$nick: usage: !summary \[hours\] (1-96)"
            return 0
        }
    }

    set payload [format {{"channel":"%s","hours":%d}} [llmbot_json_escape $chan] $hours]

    if {[catch {
        set token [::http::geturl $llmbot_summary_gateway \
            -query $payload \
            -timeout $llmbot_timeout \
            -type "application/json" \
            -headers [list "Content-Type" "application/json"]]

        set status [::http::status $token]
        set ncode [::http::ncode $token]
        set data [::http::data $token]
        ::http::cleanup $token

        if {$status eq "ok" && $ncode == 200} {
            foreach line [split [llmbot_sanitize_irc $data] "\n"] {
                set line [string trim $line]
                if {$line ne ""} { putserv "PRIVMSG $chan :$line" }
            }
        } else {
            set safe_data [string range [llmbot_sanitize_irc $data] 0 200]
            if {$safe_data eq ""} { set safe_data "(no response)" }
            putserv "PRIVMSG $chan :$nick: summary error ($ncode): $safe_data"
        }
    } error]} {
        putserv "PRIVMSG $chan :$nick: summary failed: [string range [llmbot_sanitize_irc $error] 0 100]"
    }
    return 0
}

proc llmbot_deepthought {nick uhost hand chan text} {
    set quotes [list \
        {Before you criticize someone, you should walk a mile in their shoes. That way, when you criticize them, you're a mile away and you have their shoes.} \
        {If you ever fall off the Sears Tower, just go real limp, because maybe you'll look like a dummy and people will try to catch you because, hey, free dummy.} \
        {I hope life isn't a big joke, because I don't get it.} \
        {The face of a child can say it all, especially the mouth part of the face.} \
        {I can picture in my mind a world without war, a world without hate. And I can picture us attacking that world, because they'd never expect it.} \
        {If a kid asks where rain comes from, I think a cute thing to tell him is "God is crying." And if he asks why God is crying, another cute thing to tell him is "Probably because of something you did."} \
        {To me, it's a good idea to always carry two sacks of something when you walk around. That way, if anybody says, "Hey, can you give me a hand?" you can say, "Sorry, got these sacks."} \
        {It's easy to sit there and say you'd like to have more money. And I guess that's what I like about it. It's easy. Just sitting there, rocking back and forth, wanting that money.} \
        {If you go flying back through time and you see somebody else flying forward into the future, it's probably best to avoid eye contact.} \
        {When you go in for a job interview, I think a good thing to ask is if they ever press charges.} \
        {Consider the daffodil. And while you're doing that, I'll be over here, looking through your stuff.} \
        {Dad always thought laughter was the best medicine, which I guess is why several of us died of tuberculosis.} \
        {If you're in a war, instead of throwing a hand grenade at some guys, throw one of those super-bouncy balls. I bet it would make the war a lot more fun.} \
        {Better not take a dog on the space shuttle, because if he sticks his head out when you're coming home his face might burn up.} \
        {Whenever I see an old lady slip and fall on a wet sidewalk, my first instinct is to laugh. But then I think, what if I were an ant, and she fell on me. Then it wouldn't seem quite so funny.} \
        {If trees could scream, would we be so cavalier about cutting them down? We might, if they screamed all the time, for no good reason.} \
        {One thing kids like is to be tricked. For instance, I was going to take my little nephew to Disneyland, but instead I drove him to an old burned-out warehouse. "Oh, no," I said. "Disneyland burned down." He cried and cried, but I think that deep down, he thought it was a pretty good joke.} \
        {I think the mistake a lot of us make is thinking the state-appointed shrink is our friend.} \
        {If you're a cowboy and you're dragging a guy behind your horse, I bet it would really make you feel good to hear the guy say "Whoa, take it easy." I just don't know why.} \
        {As the light changed from red to green to yellow and back to red again, I sat there thinking about life. Was it nothing more than a bunch of honking and yelling? Sometimes it seemed that way.} \
        {I think someone should have had the decency to tell me the luncheon was free. To make someone run out with potato salad in his hands, pretending he's throwing up, is not what I call hospitality.} \
        {Whether they find a life there or not, I think Jupiter should be called an enemy planet.} \
        {I hope that after I die, people will say of me: "That guy sure owed me a lot of money."} \
        {Whenever you read a good book, it's like the author is right there in the room talking to you, which is why I don't like to read good books.} \
        {The next time I have meat and mashed potatoes, I think I'll put a very large blob of potatoes on my plate with just a little piece of meat. And if someone asks me why I didn't get more meat, I'll just say, "Oh, I'm a potato man."} \
        {I guess the hard thing for a lot of people to accept is why God would allow me to go running through their yards, yelling and spinning around.} \
        {If you were a poor Indian with no weapons, and a bunch of conquistadors came up to you and asked where the gold was, I don't think it would be a good idea to say "I swallowed it. So sue me."} \
        {When I found the skull in the woods, the first thing I did was call the police. But then I got curious about it. I picked it up, and started wondering who this person was, and why he had deer horns.} \
        {To me, clowns aren't funny. In fact, they're kind of scary. I've wondered where this started and I think it goes back to the time I went to the circus, and a clown killed my dad.} \
        {If you ever reach total enlightenment while drinking beer, I bet it makes beer shoot out your nose.} \
        {It takes a big man to cry, but it takes a bigger man to laugh at that man.} \
        {I wish I had a dollar for every time I spent a dollar, because then, Yahoo!, I'd have all my money back.} \
        {When you die, if you get a choice between going to regular heaven or pie heaven, choose pie heaven. It might be a trick, but if not, mmmmmmm, boy.} \
        {Probably the earliest fly swatters were nothing more than some sort of striking surface attached to the end of a long stick.} \
        {I believe in making the world safe for our children, but not our children's children, because I don't think children should be having sex.} \
        {If you ever catch on fire, try to avoid seeing yourself in the mirror, because I bet that's what really throws you into a panic.} \
        {Someday we'll look back on this moment and plow into a parked car.} \
        {If you're ever stuck in some thick undergrowth, in your underwear, don't stop and think of what other words have "under" in them, because that's what makes you start to lose your mind.} \
        {The crows seemed to be calling his name, thought Caw.} \
        {I think a good product would be "Baby Duck Hat." It's a fake baby duck, which is a hat. I don't think I'd ever wear it, but I bet some people would.} \
        {Instead of a trap door, what about a trap window? The guy looks out it, and if he leans too far, he falls out. Wait, I guess that's just a window.} \
        {I can't stand cheap people. It makes me real mad when someone says something like, "Hey, when are you going to pay me that hundred dollars you owe me?" or "Do you have that fifty dollars you borrowed?" Man, quit being so cheap!} \
        {If a frog had wings, it probably wouldn't bump its butt when it hopped, but that's an assumption.} \
        {I think there should be something in science called the "reindeer effect." I don't know what it would be, but I think it'd be good to hear someone say, "Gentlemen, we have the reindeer effect."} \
        {Sometimes when I feel like killing someone, I do a little trick to calm myself down. I'll go over to the person's house and ring the doorbell. When the person comes to the door, I'm gone, but you know what I've left on the porch? A jack-o-lantern with a knife in the side of its head with a note that says "You." After that I usually feel a lot better, and no harm done.} \
        {If you're a horse, and someone gets on you, and falls off, and then gets right back on you, I think you should buck him off right away. It shows you're sassy.} \
        {Too bad you can't buy a voodoo globe so that you could make the earth spin real fast and freak everybody out.} \
        {I think the world would be a better place if everyone had a dog. Except for really mean dogs, like pit bulls. And wolves.} \
        {Here's a good joke to do during a job interview. Take out a book and start reading it out loud. If they say something, just say, "Shhh! I'm almost to the good part!" Then keep reading until they ask you to leave.} \
        {Laurie got offended that I used the word "puke." But to me, that's what her dinner tasted like.} \
        {If you ever drop your keys into a river of molten lava, let 'em go, because, man, they're gone.} \
        {If you define cowardice as running away at the first sign of danger, screaming and tripping and begging for mercy, then yes, Mr. Brave Man, I guess I'm a coward.} \
        {As the evening sun faded from a salmon color to a sort of flint gray, I thought back to the salmon I caught that morning, and how gray he was, and how I named him Flint.} \
        {We used to laugh at Grandpa when he'd head off and go fishing. But we wouldn't be laughing that evening when he'd come back with some whore he picked up in town.} \
        {I bet one legend that keeps recurring throughout history, in every culture, is the story of Popeye.} \
        {When I was a kid my favorite relative was Uncle Caveman. After school we'd all go play in his cave, and every once in a while he would eat one of us. It wasn't until later that I found out that Uncle Caveman was a bear.} \
        {I think a new, different kind of cooking oil would be great. Maybe something that smells like gasoline and has a rainbow sheen to it. Just to get people thinking.} \
        {My young son asked me what happens after we die. I told him we get buried under a bunch of dirt and worms eat our bodies. I guess I should have told him the truth -- that most of us go to Hell and burn eternally -- but I didn't want to upset him.} \
        {Contrary to what most people say, the most dangerous animal in the world is not the lion or the tiger or even the elephant. It's a shark riding on an elephant's back, just trampling and eating everything they see.} \
        {If you're ever shipwrecked on a tropical island and you don't know how to speak the natives' language, just say "Poppy-oomy." I bet it means something.} \
        {I think there are probably more horses' asses in the world than there are horses, if you stop to think about it.} \
        {I hope if dogs ever take over the world and they choose a king, they don't just go by size, because I bet there are some Chihuahuas with a lot of good ideas.} \
        {If you lived in the Dark Ages and you were a catapult operator, I bet the most common question people would ask is, "Can you throw a ball real far?" Yeah, thanks. That's why they hired me.} \
        {Broken promises don't upset me. I just think, why did they believe me?} \
        {I think it would be great if there was a place you could go to complain about stuff, and then they'd give you a free sandwich. I'd go there all the time.} \
        {If you work on a lobster boat, sneaking up behind people and pinching them is probably a joke that gets real old, real fast.} \
        {What is it about a beautiful sunny afternoon, with the birds singing and the wind rustling through the leaves, that makes you want to get drunk?} \
        {If you ever crawl inside an old hollow log and go to sleep, and while you're in there some guys come and seal up both ends and then put it on a truck and take it to another city, boy, I don't know what to tell you.} \
        {I think my new thing will be to try to be a real strict vegetarian, but eat a lot of meat on the side.} \
        {People think it would be fun to be a bird because you could fly. But they forget the negative side, which is the preening.} \
        {I guess we were all guilty, in a way. We all shot him, we all skinned him, and we all got a complimentary bumper sticker that said, "I helped skin Bob."} \
        {The other day I got out my can opener and was opening a can of worms when I thought, "What am I doing?!"} \
        {If you ever fall off a tall building, try waving your arms real fast. It won't help, but it'll make people laugh.} \
        {I think one of the greatest things about being human is that we can look at an old picture and say "Hey, that's me!" Dogs can't do that. Or maybe they can and just don't care.} \
        {If you're in a courtroom and the judge asks you to approach the bench, I think it would be funny to walk up and sit on the bench next to him. Like you're on the same team. Then if he asks you to step down, you ask how high.} \
        {Here's a tip for shy people: if you go to a big party and you don't know anyone, just pretend to be on the phone. Then if someone tries to talk to you, put your finger up as if to say "hold on." Eventually they'll give up.} \
        {I think a good way to get into a house is to say you're delivering a pizza to the guy who lives there, even if he didn't order one. He'll come to the door, and if he's rude, just say "Wrong house, pal."} \
        {Sometimes when I reflect on all the beer I drink, I feel ashamed. Then I look into the glass and think about the workers in the brewery and all of their hopes and dreams. If I didn't drink this beer, they might be out of work and their dreams would be shattered. I think, "It is better to drink this beer and let their dreams come true than be selfish and worry about my liver."} \
        {Whenever I need to "get away," I just get away in my mind. I go to my imaginary spot, where the beach is perfect and the water is perfect and the weather is perfect. The only bad thing there are the flies. They're terrible!} \
        {The wise man can pick up a grain of sand and envision a whole universe. But the stupid man will just lie down on some seaweed and roll around until he's completely draped in it. Then he'll stand up and go, "Hey, I'm Vine Man."} \
        {I think in one of my previous lives I was a mighty king, because I like people to do what I say.} \
        {If I ever got really rich, I think I'd wear an invisible hat just to see people's reactions. I bet it would be priceless.} \
        {You know what would make a good story? Something about a clown who makes people happy, but inside he's real sad. Also, he has severe diarrhea.} \
        {I think one of the most fun things you could do would be to go way out in the country, dig a big hole, and then act like you're looking for something. People would come from miles around.} \
        {If a horse has four legs, and I'm only human, does that make me better than a horse? No, I don't think so. Unless I happened to be riding the horse.} \
        {Why do people in ship mutinies always ask for "better treatment"? I'd ask for a pinball machine, because with all that rocking back and forth you'd probably be able to get a high score.} \
        {I think it would be fun to send someone a candy bar with a note saying "I poisoned one of these." Then watch and see which one they don't eat.} \
        {If you're ever in a situation where there's a monster attacking the town, the important thing is not to panic. Because usually monsters are attracted to panic. They're also attracted to people who are not panicking, so really there's not a lot you can do.} \
        {To me, boxing is like a ballet, except there's no music, no choreography, and the dancers hit each other.} \
        {It's sad that a family can be torn apart by something as simple as wild dogs.} \
        {I think there's something wrong with our educational system when a kid can't name all of the explorers who discovered America, but he can name all of the explorers who were killed by Indians. Where are our priorities?} \
        {I hope some animal never bores a hole in my head and lays its eggs in my brain, because later, when the eggs hatch, I would say "Ouch, my head hurts," and then little animals would eat my brain.} \
        {If you're a young Mafia gangster out on your first date, I bet it's real embarrassing if someone tries to kill you.} \
        {I think a good thriller would be about a bunch of guys on a bus who don't know each other until they find out they all have the same rare blood type, and then one of them gets shot, and they all have to run from the assassin. I'd call it "Type O Negative."} \
        {If a kid says he wants to be a garbage man when he grows up, I think it's important to support that dream. But also maybe mention that there are other options. Like astronaut. Or garbage astronaut.} \
        {Sometimes I think I'd be better off dead. No wait, not me, you.} \
        {I think the most frightening thing about being a skeleton would be when you finally see yourself in a mirror and you're like, "Oh no. This is worse than I thought."} \
        {If you ever have to walk across a lagoon of bubbling hot lava, I think the most important thing is to stay calm. Also, wear good shoes.} \
    ]
    set idx [expr {int(rand() * [llength $quotes])}]
    putserv "PRIVMSG $chan :[lindex $quotes $idx]"
}

putlog "eggdrop-ai.tcl loaded - LLM gateway ready"
