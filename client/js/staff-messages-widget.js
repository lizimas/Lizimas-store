// Messenger-style docked "Message Admin" chat window, shared by all staff
// dashboards (product.html, manager.html, chat.html). Wrapped in an IIFE so
// it never collides with each page's own API_URL/getToken-style globals.
//
// This file builds the window itself (hidden by default) and exposes
// window.LZTeamMessages = { open, close, toggle } plus a
// "lz-team-messages:update" document event carrying { enabled, unreadCount }
// so each page's own sidebar/topbar button can show/hide itself and render
// an unread badge without polling on its own.
(function () {
    const TOKEN_KEY = "staffToken";
    const STATUS_POLL_MS = 20000;
    const THREAD_POLL_MS = 6000;
    const HEARTBEAT_MS = 30000;
    const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

    // Full emoji picker, grouped into tabbed categories like Messenger/WhatsApp.
    const EMOJI_CATEGORIES = [
        { icon: "\u{1F600}", emojis: "\u{1F600} \u{1F603} \u{1F604} \u{1F601} \u{1F606} \u{1F605} \u{1F923} \u{1F602} \u{1F642} \u{1F643} \u{1F609} \u{1F60A} \u{1F607} \u{1F970} \u{1F60D} \u{1F929} \u{1F618} \u{1F617} ☺️ \u{1F61A} \u{1F619} \u{1F60B} \u{1F61B} \u{1F61C} \u{1F92A} \u{1F61D} \u{1F911} \u{1F917} \u{1F92D} \u{1F92B} \u{1F914} \u{1F910} \u{1F610} \u{1F611} \u{1F636} \u{1F60F} \u{1F612} \u{1F644} \u{1F62C} \u{1F925} \u{1F60C} \u{1F614} \u{1F62A} \u{1F924} \u{1F634} \u{1F637} \u{1F912} \u{1F915} \u{1F922} \u{1F92E} \u{1F927} \u{1F975} \u{1F976} \u{1F974} \u{1F635} \u{1F92F} \u{1F920} \u{1F973} \u{1F60E} \u{1F913} \u{1F9D0} \u{1F615} \u{1F61F} \u{1F641} ☹️ \u{1F62E} \u{1F62F} \u{1F632} \u{1F633} \u{1F97A} \u{1F626} \u{1F627} \u{1F628} \u{1F630} \u{1F625} \u{1F622} \u{1F62D} \u{1F631} \u{1F616} \u{1F623} \u{1F61E} \u{1F613} \u{1F629} \u{1F62B} \u{1F971} \u{1F624} \u{1F621} \u{1F620} \u{1F92C} \u{1F608} \u{1F47F} \u{1F480} ☠️ \u{1F4A9} \u{1F921} \u{1F479} \u{1F47A} \u{1F47B} \u{1F47D} \u{1F47E} \u{1F916} \u{1F63A} \u{1F638} \u{1F639} \u{1F63B} \u{1F63C} \u{1F63D} \u{1F640} \u{1F63F} \u{1F63E}".split(" ") },
        { icon: "\u{1F64C}", emojis: "\u{1F44B} \u{1F91A} \u{1F590}️ ✋ \u{1F596} \u{1F44C} \u{1F90C} \u{1F90F} ✌️ \u{1F91E} \u{1F91F} \u{1F918} \u{1F919} \u{1F448} \u{1F449} \u{1F446} \u{1F595} \u{1F447} ☝️ \u{1F44D} \u{1F44E} ✊ \u{1F44A} \u{1F91B} \u{1F91C} \u{1F44F} \u{1F64C} \u{1F450} \u{1F932} \u{1F91D} \u{1F64F} ✍️ \u{1F485} \u{1F933} \u{1F4AA} \u{1F9BE} \u{1F9B5} \u{1F9BF} \u{1F9B6} \u{1F442} \u{1F9BB} \u{1F443} \u{1F9E0} \u{1FAC0} \u{1FAC1} \u{1F9B7} \u{1F9B4} \u{1F440} \u{1F441}️ \u{1F445} \u{1F444} \u{1F476} \u{1F9D2} \u{1F466} \u{1F467} \u{1F9D1} \u{1F471} \u{1F468} \u{1F469} \u{1F9D4} \u{1F474} \u{1F475} \u{1F64D} \u{1F64E} \u{1F645} \u{1F646} \u{1F481} \u{1F64B} \u{1F9CF} \u{1F647} \u{1F926} \u{1F937} \u{1F46E} \u{1F575}️ \u{1F482} \u{1F977} \u{1F477} \u{1F934} \u{1F478} \u{1F473} \u{1F472} \u{1F9D5} \u{1F935} \u{1F470} \u{1F930} \u{1F931} \u{1F47C} \u{1F385} \u{1F936} \u{1F9B8} \u{1F9B9} \u{1F9D9} \u{1F9DA} \u{1F9DB} \u{1F9DC} \u{1F9DD} \u{1F9DE} \u{1F9DF} \u{1F486} \u{1F487} \u{1F6B6} \u{1F9CD} \u{1F9CE} \u{1F3C3} \u{1F483} \u{1F57A} \u{1F46F} \u{1F9D6} \u{1F9D7} \u{1F93A} \u{1F3C7} ⛷️ \u{1F3C2} \u{1F3CC}️ \u{1F3C4} \u{1F6A3} \u{1F3CA} ⛹️ \u{1F3CB}️ \u{1F6B4} \u{1F6B5} \u{1F938} \u{1F93C} \u{1F93D} \u{1F93E} \u{1F939} \u{1F9D8}".split(" ") },
        { icon: "\u{1F436}", emojis: "\u{1F436} \u{1F431} \u{1F42D} \u{1F439} \u{1F430} \u{1F98A} \u{1F43B} \u{1F43C} \u{1F428} \u{1F42F} \u{1F981} \u{1F42E} \u{1F437} \u{1F43D} \u{1F438} \u{1F435} \u{1F648} \u{1F649} \u{1F64A} \u{1F412} \u{1F414} \u{1F427} \u{1F426} \u{1F424} \u{1F423} \u{1F425} \u{1F986} \u{1F985} \u{1F989} \u{1F987} \u{1F43A} \u{1F417} \u{1F434} \u{1F984} \u{1F41D} \u{1F41B} \u{1F98B} \u{1F40C} \u{1F41E} \u{1F41C} \u{1FAB0} \u{1FAB1} \u{1F99F} \u{1F997} \u{1F577}️ \u{1F578}️ \u{1F982} \u{1F422} \u{1F40D} \u{1F98E} \u{1F996} \u{1F995} \u{1F419} \u{1F991} \u{1F990} \u{1F99E} \u{1F980} \u{1F421} \u{1F420} \u{1F41F} \u{1F42C} \u{1F433} \u{1F40B} \u{1F988} \u{1F40A} \u{1F405} \u{1F406} \u{1F993} \u{1F98D} \u{1F9A7} \u{1F418} \u{1F98F} \u{1F99B} \u{1F42A} \u{1F42B} \u{1F999} \u{1F992} \u{1F418} \u{1F403} \u{1F402} \u{1F404} \u{1F40E} \u{1F416} \u{1F411} \u{1F411} \u{1F999} \u{1F410} \u{1F98C} \u{1F415} \u{1F429} \u{1F9AE} \u{1F408} \u{1F413} \u{1F983} \u{1F9A4} \u{1F99A} \u{1F99C} \u{1F9A2} \u{1F54A}️ \u{1F407} \u{1F9A1} \u{1F9A8} \u{1F9A1} \u{1F9A6} \u{1F9A5} \u{1F401} \u{1F400} \u{1F43F}️ \u{1F994} \u{1F43E} \u{1F409} \u{1F432} \u{1F335} \u{1F384} \u{1F332} \u{1F333} \u{1F334} \u{1F331} \u{1F33F} ☘️ \u{1F340} \u{1F38D} \u{1FAB4} \u{1F38B} \u{1F343} \u{1F342} \u{1F341} \u{1F344} \u{1F41A} \u{1FAA8} \u{1F33E} \u{1F490} \u{1F337} \u{1F339} \u{1F940} \u{1F33A} \u{1F338} \u{1F33C} \u{1F33B} \u{1F31E} \u{1F31D} \u{1F31B} \u{1F31C} \u{1F311} \u{1F315} \u{1F316} \u{1F317} \u{1F318} \u{1F311} \u{1F312} \u{1F313} \u{1F314} \u{1F319} \u{1F30E} \u{1F30D} \u{1F30F} \u{1FA90} \u{1F4AB} ⭐️ \u{1F31F} ✨ ⚡️ ☄️ \u{1F525} \u{1F32A}️ \u{1F308} ☀️ \u{1F324}️ ⛅️ \u{1F325}️ ☁️ \u{1F326}️ \u{1F327}️ ⛈️ \u{1F329}️ \u{1F328}️ ❄️ ☃️ ⛄️ \u{1F32C}️ \u{1F4A8} \u{1F4A7} \u{1F4A6} ☔️ ☂️ \u{1F30A} \u{1F32B}️".split(" ") },
        { icon: "\u{1F354}", emojis: "\u{1F34F} \u{1F34E} \u{1F350} \u{1F34A} \u{1F34B} \u{1F34C} \u{1F349} \u{1F347} \u{1FAD0} \u{1F348} \u{1F352} \u{1F351} \u{1F96D} \u{1F34D} \u{1F965} \u{1F95D} \u{1F345} \u{1F346} \u{1F951} \u{1F966} \u{1F96C} \u{1F952} \u{1F336}️ \u{1FAD1} \u{1F33D} \u{1F955} \u{1FAD2} \u{1F9C4} \u{1F9C5} \u{1F954} \u{1F360} \u{1F950} \u{1F96F} \u{1F35E} \u{1F96A} \u{1F968} \u{1F9C0} \u{1F95A} \u{1F373} \u{1F9C8} \u{1F95E} \u{1F9C7} \u{1F953} \u{1F969} \u{1F357} \u{1F356} \u{1F9B4} \u{1F32D} \u{1F354} \u{1F35F} \u{1F355} \u{1FAD3} \u{1F32E} \u{1F32F} \u{1FAD4} \u{1F959} \u{1F9C6} \u{1F32E} \u{1F35C} \u{1F35D} \u{1F35B} \u{1F358} \u{1F9AA} \u{1F364} \u{1F35A} \u{1F359} \u{1F358} \u{1F365} \u{1F960} \u{1F363} \u{1F371} \u{1F358} \u{1F367} \u{1F368} \u{1F366} \u{1F967} \u{1F9C1} \u{1F370} \u{1F382} \u{1F36E} \u{1F361} \u{1F36D} \u{1F36C} \u{1F36B} \u{1F37F} \u{1F369} \u{1F36A} \u{1F330} \u{1F95C} \u{1F36F} \u{1F95B} \u{1F37C} ☕️ \u{1F375} \u{1F9C3} \u{1F964} \u{1F9CB} \u{1F376} \u{1F37A} \u{1F37B} \u{1F942} \u{1F377} \u{1F943} \u{1F378} \u{1F379} \u{1F9C9} \u{1F37E} \u{1F9CA} \u{1F944} \u{1F374} \u{1F37D}️ \u{1F963} \u{1F961} \u{1F962} \u{1F9C2}".split(" ") },
        { icon: "⚽️", emojis: "⚽️ \u{1F3C0} \u{1F3C8} ⚾️ \u{1F94E} \u{1F3BE} \u{1F3D0} \u{1F3C9} \u{1F94F} \u{1F3B1} \u{1FA80} \u{1F3D3} \u{1F3F8} \u{1F3D2} \u{1F3D1} \u{1F94D} \u{1F3CF} \u{1FA83} \u{1F945} ⛳️ \u{1FA81} \u{1F3A3} \u{1F93F} \u{1F94A} \u{1F94B} \u{1F3BD} \u{1F6F9} \u{1F6FC} \u{1F6F7} ⛸️ \u{1F3BF} \u{1F94C} \u{1FA82} \u{1F3C6} \u{1F947} \u{1F948} \u{1F949} \u{1F3C5} \u{1F396}️ \u{1F3F5}️ \u{1F397}️ \u{1F3AB} \u{1F3AA} \u{1F3AD} \u{1FA70} \u{1F3A8} \u{1F3AC} \u{1F3A4} \u{1F3A7} \u{1F3BC} \u{1F3B9} \u{1F941} \u{1FA98} \u{1F3B7} \u{1F3BA} \u{1FA97} \u{1F3B8} \u{1FA95} \u{1F3BB} \u{1F3B2} ♟️ \u{1F3AF} \u{1F3B3} \u{1F3AE} \u{1F3B0} \u{1F9E9}".split(" ") },
        { icon: "✈️", emojis: "\u{1F697} \u{1F695} \u{1F699} \u{1F68C} \u{1F68E} \u{1F3CE}️ \u{1F693} \u{1F691} \u{1F692} \u{1F690} \u{1F6FB} \u{1F69A} \u{1F69B} \u{1F69C} \u{1F6FA} \u{1F6B2} \u{1F6F5} \u{1F3CD}️ \u{1F6FA} \u{1F6A8} \u{1F694} \u{1F68D} \u{1F698} \u{1F696} \u{1F6A1} \u{1F6A0} \u{1F69F} \u{1F683} \u{1F68B} \u{1F69E} \u{1F69D} \u{1F684} \u{1F685} \u{1F688} \u{1F682} \u{1F686} \u{1F687} \u{1F68A} \u{1F689} ✈️ \u{1F6EB} \u{1F6EC} \u{1F6E9}️ \u{1F4BA} \u{1F6F0}️ \u{1F680} \u{1F6F8} \u{1F681} \u{1F6F6} ⛵️ \u{1F6A4} \u{1F6E5}️ \u{1F6F3}️ ⛴️ \u{1F6A2} ⚓️ ⛽️ \u{1F6A7} \u{1F6A6} \u{1F6A5} \u{1F6CF}️ \u{1F5FA}️ \u{1F5FF} \u{1F5FD} \u{1F3FC} \u{1F3F0} \u{1F3EF} \u{1F3DF}️ \u{1F3A1} \u{1F3A2} \u{1F3A0} ⛲️ ⛱️ \u{1F3D6}️ \u{1F3DD}️ \u{1F3DC}️ \u{1F30B} ⛰️ \u{1F3D4}️ \u{1F5FB} \u{1F3D5}️ ⛺️ \u{1F3E0} \u{1F3E1} \u{1F3D8}️ \u{1F3DA}️ \u{1F3D7}️ \u{1F3ED} \u{1F3E2} \u{1F3EC} \u{1F3E3} \u{1F3E4} \u{1F3E5} \u{1F3E6} \u{1F3E8} \u{1F3EA} \u{1F3EB} \u{1F3E9} \u{1F492} \u{1F3DB}️ ⛪️ \u{1F54C} \u{1F54D} \u{1F6D5} \u{1F54B} ⛩️".split(" ") },
        { icon: "\u{1F4A1}", emojis: "⌚️ \u{1F4F1} \u{1F4BB} ⌨️ \u{1F5A5}️ \u{1F5A8}️ \u{1F5B1}️ \u{1F5B2}️ \u{1F579}️ \u{1F4BD} \u{1F4BE} \u{1F4BF} \u{1F4C0} \u{1F4F7} \u{1F4F8} \u{1F4F9} \u{1F3A5} \u{1F4FD}️ \u{1F39E}️ ☎️ \u{1F4DE} \u{1F4DF} \u{1F4E0} \u{1F4FA} \u{1F4FB} \u{1F399}️ \u{1F39A}️ \u{1F39B}️ \u{1F9ED} ⏱️ ⏲️ ⏰ \u{1F570}️ ⌛️ ⏳ \u{1F4E1} \u{1F50B} \u{1FAAB} \u{1F50C} \u{1F4A1} \u{1F526} \u{1F56F}️ \u{1FA94} \u{1F9EF} \u{1F6E2}️ \u{1F4B8} \u{1F4B5} \u{1F4B4} \u{1F4B6} \u{1F4B7} \u{1FA99} \u{1F4B0} \u{1F4B3} \u{1F48E} ⚖️ \u{1F9F0} \u{1F527} \u{1F528} ⚒️ \u{1F6E0}️ ⛏️ \u{1FA93} \u{1F529} ⚙️ \u{1F9F1} ⛓️ \u{1F9F2} \u{1F52B} \u{1F4A3} \u{1FA93} ⚔️ \u{1F6E1}️ \u{1F6AA} \u{1FA9E} \u{1FA9F} \u{1F6CF}️ \u{1F6CB}️ \u{1FA91} \u{1F6BD} \u{1F6BF} \u{1F6C1} \u{1F9F4} \u{1F9F7} \u{1F9F9} \u{1F9FA} \u{1F9FB} \u{1FAA3} \u{1F9FC} \u{1F9FD} \u{1F9EF} \u{1F6D2} \u{1F6AC} ⚰️ ⚱️ \u{1F4E6} \u{1F4EB} \u{1F5F3}️ ✏️ \u{1F58B}️ \u{1F58A}️ \u{1F58C}️ \u{1F58D}️ \u{1F4DD} \u{1F4BC} \u{1F4C1} \u{1F4C2} \u{1F5C2}️ \u{1F4C5} \u{1F4C6} \u{1F4C8} \u{1F4C9} \u{1F4CA} \u{1F4CB} \u{1F4CC} \u{1F4CD} \u{1F4CE} \u{1F4CF} \u{1F4D0} ✂️ \u{1F512} \u{1F513} \u{1F511} \u{1F5DD}️ \u{1F48A} \u{1F489}".split(" ") },
        { icon: "❤️", emojis: "❤️ \u{1F9E1} \u{1F49B} \u{1F49A} \u{1F499} \u{1F49C} \u{1F5A4} \u{1F90D} \u{1F90E} \u{1F494} \u{1F495} \u{1F49E} \u{1F493} \u{1F497} \u{1F496} \u{1F498} \u{1F49D} \u{1F49F} ☮️ ✝️ ☪️ \u{1F549}️ ☸️ ✡️ \u{1F52F} \u{1F54E} ☯️ ☦️ \u{1F6D0} ⛎ ♈️ ♉️ ♊️ ♋️ ♌️ ♍️ ♎️ ♏️ ♐️ ♑️ ♒️ ♓️ \u{1F194} ⚛️ ☢️ ☣️ \u{1F4B4} \u{1F4B3} \u{1F202}️ \u{1F237}️ \u{1F236} \u{1F22F} \u{1F250} \u{1F4AE} ㊙️ ㊗️ \u{1F250} \u{1F239} \u{1F23A} \u{1F226} \u{1F1B0} \u{1F1B1} \u{1F196} \u{1F197} \u{1F198} \u{1F191} ❌ ⭕️ \u{1F6D1} ⛔️ \u{1F4DB} \u{1F6AB} \u{1F4AF} ♨️ \u{1F6B7} \u{1F6AF} \u{1F6B3} \u{1F6B1} \u{1F51E} \u{1F4F5} \u{1F6AD} ❗️ ❕ ❓ ❔ ‼️ ⁉️ ⚠️ \u{1F6B8} \u{1F531} ⚜️ \u{1F530} ♻️ ✅ \u{1F4B9} ❇️ ✳️ ❎ \u{1F310} \u{1F4A0} Ⓜ️ \u{1F300} \u{1F4A4} \u{1F3E7} \u{1F6BE} ♿️ \u{1F17F}️ \u{1F202}️ \u{1F3A6} \u{1F4F6} \u{1F201} \u{1F523} ℹ️ \u{1F524} \u{1F521} \u{1F520} \u{1F196} \u{1F197} \u{1F199} \u{1F192} \u{1F195} \u{1F193} 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ \u{1F51F} \u{1F522} #️⃣ *️⃣ ▶️ ⏸️ ⏯️ ⏹️ ⏺️ ⏭️ ⏮️ ⏩ ⏪ ⏫ ⏬ ◀️ \u{1F53C} \u{1F53D} ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ↪️ ↩️ ⤴️ ⤵️ \u{1F500} \u{1F501} \u{1F502} ➕ ➖ ➗ ✖️ ♾️ \u{1F4B2} ™️ \xA9️ \xAE️ 〰️ ➕ \u{1F51A} \u{1F519} \u{1F51B} \u{1F51D} \u{1F51C} ✔️ ☑️ \u{1F518} \u{1F534} \u{1F7E0} \u{1F7E1} \u{1F7E2} \u{1F535} \u{1F7E3} ⚫️ ⚪️ \u{1F7E4} \u{1F53A} \u{1F53B} \u{1F538} \u{1F539} \u{1F536} \u{1F537} \u{1F533} \u{1F532} ▪️ ▫️ ◾ ◽ ◼️ ◻️ \u{1F7E5} \u{1F7E7} \u{1F7E8} \u{1F7E9} \u{1F7E6} \u{1F7EA} ⬛️ ⬜️ \u{1F7EB} \u{1F508} \u{1F507} \u{1F509} \u{1F50A} \u{1F514} \u{1F515} \u{1F4E3} \u{1F4E2} \u{1F4AC} \u{1F4AD} \u{1F5EF}️ ♠️ ♣️ ♥️ ♦️ \u{1F0CF} \u{1F3B4} \u{1F004} \u{1F550} \u{1F551} \u{1F552} \u{1F553} \u{1F554} \u{1F555} \u{1F556} \u{1F557} \u{1F558} \u{1F559} \u{1F55A} \u{1F55B}".split(" ") },
        { icon: "\u{1F3F3}️", emojis: "\u{1F1FA}\u{1F1EC} \u{1F1F0}\u{1F1EA} \u{1F1F9}\u{1F1FF} \u{1F1F7}\u{1F1FC} \u{1F1F3}\u{1F1EC} \u{1F1EC}\u{1F1ED} \u{1F1FF}\u{1F1E6} \u{1F1EA}\u{1F1EC} \u{1F1FA}\u{1F1F8} \u{1F1EC}\u{1F1E7} \u{1F1E8}\u{1F1E6} \u{1F1EB}\u{1F1F7} \u{1F1E9}\u{1F1EA} \u{1F1EE}\u{1F1F9} \u{1F1EA}\u{1F1F8} \u{1F1F5}\u{1F1F9} \u{1F1F3}\u{1F1F1} \u{1F1E8}\u{1F1F3} \u{1F1EF}\u{1F1F5} \u{1F1F0}\u{1F1F7} \u{1F1EE}\u{1F1F3} \u{1F1E7}\u{1F1F7} \u{1F1E6}\u{1F1FA} \u{1F1F7}\u{1F1FA} \u{1F1F8}\u{1F1E6} \u{1F1E6}\u{1F1EA} \u{1F3F3}️ \u{1F3F4} \u{1F3C1} \u{1F38C}".split(" ") }
    ];
    let activeEmojiCategory = 0;

    const STICKERS = [
        "👍","❤️","😂","😮","😢","🙏","🎉","🔥",
        "👏","😍","🤝","💪","✅","🙌","😅","🥳"
    ];

    let token = () => localStorage.getItem(TOKEN_KEY);

    let messagingEnabled = false;
    let unreadCount = 0;
    let adminPresence = null;
    let windowState = "closed"; // closed | open | minimized | full
    let statusPollTimer = null;
    let threadPollTimer = null;
    let heartbeatTimer = null;
    let sending = false;

    function escapeHtml(str) {
        return String(str || "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    function fmtTime(iso) {
        if (!iso) return "";
        const d = new Date(iso);
        return d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    }

    function presenceLabel(iso) {
        if (!iso) return { text: "Offline", active: false };
        const diffMs = Date.now() - new Date(iso).getTime();
        if (diffMs < ACTIVE_WINDOW_MS) return { text: "Active now", active: true };
        const mins = Math.floor(diffMs / 60000);
        if (mins < 60) return { text: `Active ${mins}m ago`, active: false };
        const hours = Math.floor(mins / 60);
        if (hours < 24) return { text: `Active ${hours}h ago`, active: false };
        const days = Math.floor(hours / 24);
        return { text: `Active ${days}d ago`, active: false };
    }

    function formatBytes(n) {
        if (!n && n !== 0) return "";
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    }

    function emitUpdate() {
        document.dispatchEvent(new CustomEvent("lz-team-messages:update", {
            detail: { enabled: messagingEnabled, unreadCount }
        }));
    }

    function buildWindow() {
        const wrap = document.createElement("div");
        wrap.id = "lz-team-chat";
        wrap.className = "lz-tc-hidden";
        wrap.innerHTML = `
            <div class="lz-tc-window" id="lz-tc-window">
                <div class="lz-tc-header" id="lz-tc-header">
                    <div class="lz-tc-header-info">
                        <span class="lz-tc-avatar">🛎️</span>
                        <div class="lz-tc-header-text">
                            <div class="lz-tc-title-row">
                                <span class="lz-tc-title">Admin Support</span>
                                <span class="lz-tc-presence" id="lz-tc-presence">
                                    <span class="lz-tc-dot" id="lz-tc-dot"></span>
                                    <span id="lz-tc-presence-text">Offline</span>
                                </span>
                            </div>
                        </div>
                    </div>
                    <div class="lz-tc-header-actions">
                        <button type="button" id="lz-tc-min" title="Minimize" aria-label="Minimize">&#8211;</button>
                        <button type="button" id="lz-tc-full" title="Full view" aria-label="Full view">&#10021;</button>
                        <button type="button" id="lz-tc-close" title="Close" aria-label="Close">&times;</button>
                    </div>
                </div>
                <div class="lz-tc-body">
                    <div class="lz-tc-thread" id="lz-tc-thread"><p class="lz-tc-empty">Loading...</p></div>
                </div>
                <div class="lz-tc-composer-wrap">
                    <div class="lz-tc-popover lz-tc-emoji-popover-wrap" id="lz-tc-emoji-popover" hidden></div>
                    <div class="lz-tc-popover" id="lz-tc-sticker-popover" hidden></div>
                    <div class="lz-tc-composer">
                        <button type="button" class="lz-tc-icon-btn" id="lz-tc-emoji-btn" title="Emoji" aria-label="Emoji">&#128512;</button>
                        <button type="button" class="lz-tc-icon-btn" id="lz-tc-sticker-btn" title="Stickers" aria-label="Stickers">&#11088;</button>
                        <button type="button" class="lz-tc-icon-btn" id="lz-tc-attach-btn" title="Attach a file" aria-label="Attach a file">&#128206;</button>
                        <input type="file" id="lz-tc-file-input" hidden>
                        <textarea id="lz-tc-input" rows="1" placeholder="Aa"></textarea>
                        <button type="button" id="lz-tc-send">Send</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(wrap);

        document.getElementById("lz-tc-header").addEventListener("click", (e) => {
            if (windowState === "minimized" && !e.target.closest(".lz-tc-header-actions")) restoreWindow();
        });
        document.getElementById("lz-tc-min").addEventListener("click", (e) => { e.stopPropagation(); minimizeWindow(); });
        document.getElementById("lz-tc-full").addEventListener("click", (e) => { e.stopPropagation(); toggleFullView(); });
        document.getElementById("lz-tc-close").addEventListener("click", (e) => { e.stopPropagation(); closeWindow(); });
        document.getElementById("lz-tc-send").addEventListener("click", () => sendText());
        document.getElementById("lz-tc-input").addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendText();
            }
        });
        document.getElementById("lz-tc-emoji-btn").addEventListener("click", (e) => { e.stopPropagation(); togglePopover("emoji"); });
        document.getElementById("lz-tc-sticker-btn").addEventListener("click", (e) => { e.stopPropagation(); togglePopover("sticker"); });
        document.getElementById("lz-tc-attach-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            document.getElementById("lz-tc-file-input").click();
        });
        document.getElementById("lz-tc-file-input").addEventListener("change", onFileChosen);
        document.addEventListener("click", (e) => {
            if (!e.target.closest(".lz-tc-popover") && !e.target.closest("#lz-tc-emoji-btn") && !e.target.closest("#lz-tc-sticker-btn")) {
                hidePopovers();
            }
        });

        buildEmojiPopover();
        buildStickerPopover();
    }

    function buildEmojiPopover() {
        const box = document.getElementById("lz-tc-emoji-popover");
        box.innerHTML = `
            <div class="lz-tc-emoji-tabs" id="lz-tc-emoji-tabs">
                ${EMOJI_CATEGORIES.map((c, i) => `<button type="button" class="lz-tc-emoji-tab${i === 0 ? " active" : ""}" data-cat="${i}">${c.icon}</button>`).join("")}
            </div>
            <div class="lz-tc-emoji-grid" id="lz-tc-emoji-grid"></div>`;
        box.querySelectorAll(".lz-tc-emoji-tab").forEach((tab) => {
            tab.addEventListener("click", () => {
                activeEmojiCategory = Number(tab.dataset.cat);
                box.querySelectorAll(".lz-tc-emoji-tab").forEach((t) => t.classList.toggle("active", t === tab));
                renderEmojiGrid();
            });
        });
        renderEmojiGrid();
    }

    function renderEmojiGrid() {
        const grid = document.getElementById("lz-tc-emoji-grid");
        if (!grid) return;
        const emojis = EMOJI_CATEGORIES[activeEmojiCategory].emojis;
        grid.innerHTML = emojis.map(e => `<button type="button" class="lz-tc-emoji-item">${e}</button>`).join("");
        grid.querySelectorAll(".lz-tc-emoji-item").forEach((btn) => {
            btn.addEventListener("click", () => {
                const input = document.getElementById("lz-tc-input");
                input.value += btn.textContent;
                input.focus();
            });
        });
    }

    function buildStickerPopover() {
        const box = document.getElementById("lz-tc-sticker-popover");
        box.innerHTML = `<div class="lz-tc-sticker-grid">${STICKERS.map(e => `<button type="button" class="lz-tc-sticker-item">${e}</button>`).join("")}</div>`;
        box.querySelectorAll(".lz-tc-sticker-item").forEach((btn) => {
            btn.addEventListener("click", () => {
                hidePopovers();
                sendMessage(btn.textContent, "sticker");
            });
        });
    }

    function togglePopover(which) {
        const emoji = document.getElementById("lz-tc-emoji-popover");
        const sticker = document.getElementById("lz-tc-sticker-popover");
        if (which === "emoji") {
            const willShow = emoji.hidden;
            hidePopovers();
            emoji.hidden = !willShow;
        } else {
            const willShow = sticker.hidden;
            hidePopovers();
            sticker.hidden = !willShow;
        }
    }

    function hidePopovers() {
        document.getElementById("lz-tc-emoji-popover").hidden = true;
        document.getElementById("lz-tc-sticker-popover").hidden = true;
    }

    function setWindowClasses() {
        const outer = document.getElementById("lz-team-chat");
        const win = document.getElementById("lz-tc-window");
        outer.className = windowState === "closed" ? "lz-tc-hidden" : "";
        win.classList.toggle("lz-tc-minimized", windowState === "minimized");
        win.classList.toggle("lz-tc-full", windowState === "full");
    }

    function openWindow() {
        const wasClosed = windowState === "closed";
        windowState = windowState === "full" ? "full" : "open";
        setWindowClasses();
        unreadCount = 0;
        emitUpdate();
        if (wasClosed) {
            hidePopovers();
            loadThread();
        }
        startThreadPolling();
    }

    function restoreWindow() {
        windowState = "open";
        setWindowClasses();
        loadThread();
        startThreadPolling();
    }

    function minimizeWindow() {
        windowState = "minimized";
        setWindowClasses();
        stopThreadPolling();
        hidePopovers();
    }

    function toggleFullView() {
        windowState = windowState === "full" ? "open" : "full";
        setWindowClasses();
    }

    function closeWindow() {
        windowState = "closed";
        setWindowClasses();
        stopThreadPolling();
        hidePopovers();
    }

    function toggleWindow() {
        if (windowState === "closed") openWindow();
        else closeWindow();
    }

    function stopThreadPolling() {
        if (threadPollTimer) {
            clearInterval(threadPollTimer);
            threadPollTimer = null;
        }
    }

    function startThreadPolling() {
        stopThreadPolling();
        threadPollTimer = setInterval(loadThread, THREAD_POLL_MS);
    }

    function updatePresenceUi() {
        const { text, active } = presenceLabel(adminPresence);
        const label = document.getElementById("lz-tc-presence-text");
        const dot = document.getElementById("lz-tc-dot");
        if (label) label.textContent = text;
        if (dot) dot.classList.toggle("lz-tc-dot-active", active);
    }

    function renderMessage(m) {
        const mine = !m.is_from_admin;
        const rowCls = mine ? "lz-tc-mine" : "lz-tc-admin";
        let inner;
        if (m.message_type === "sticker") {
            inner = `<div class="lz-tc-sticker-msg">${escapeHtml(m.body || "")}</div>`;
        } else if (m.message_type === "file") {
            const size = formatBytes(m.attachment_bytes);
            inner = `<a class="lz-tc-file" href="${escapeHtml(m.attachment_url || "#")}" target="_blank" rel="noopener noreferrer">
                <span class="lz-tc-file-icon">&#128196;</span>
                <span class="lz-tc-file-meta">
                    <span class="lz-tc-file-name">${escapeHtml(m.attachment_name || "Attachment")}</span>
                    <span class="lz-tc-file-size">${size}</span>
                </span>
            </a>`;
        } else {
            inner = `<div class="lz-tc-bubble">${escapeHtml(m.body || "")}</div>`;
        }
        return `<div class="lz-tc-row ${rowCls}">
                ${inner}
                <div class="lz-tc-msg-time">${fmtTime(m.created_at)}</div>
            </div>`;
    }

    async function loadThread() {
        const box = document.getElementById("lz-tc-thread");
        if (!box) return;
        try {
            const res = await fetch(`/api/staff-messages/mine`, {
                headers: { "Authorization": `Bearer ${token()}` }
            });
            const data = await res.json();
            if (!res.ok) {
                box.innerHTML = `<p class="lz-tc-empty">${escapeHtml(data.error || "Could not load messages.")}</p>`;
                return;
            }
            adminPresence = data.adminPresence || null;
            updatePresenceUi();
            const msgs = data.messages || [];
            const wasNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
            box.innerHTML = msgs.length
                ? msgs.map(renderMessage).join("")
                : `<p class="lz-tc-empty">No messages yet - say hello!</p>`;
            if (wasNearBottom) box.scrollTop = box.scrollHeight;
        } catch (error) {
            console.error("Team messages thread error:", error);
        }
    }

    async function sendMessage(body, messageType) {
        if (sending) return;
        sending = true;
        try {
            const res = await fetch(`/api/staff-messages/mine`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token()}`
                },
                body: JSON.stringify({ body, messageType })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || "Could not send message.");
                return;
            }
            loadThread();
        } catch (error) {
            console.error("Send team message error:", error);
            alert("Something went wrong sending that message.");
        } finally {
            sending = false;
        }
    }

    function sendText() {
        const input = document.getElementById("lz-tc-input");
        const body = input.value.trim();
        if (!body) return;
        input.value = "";
        sendMessage(body, "text");
    }

    async function onFileChosen(e) {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) {
            alert("That file is larger than the 15 MB limit.");
            return;
        }
        const box = document.getElementById("lz-tc-thread");
        const uploading = document.createElement("p");
        uploading.className = "lz-tc-empty";
        uploading.textContent = `Uploading ${file.name}...`;
        if (box) box.appendChild(uploading);
        try {
            const form = new FormData();
            form.append("file", file);
            const res = await fetch(`/api/staff-messages/mine/attachment`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token()}` },
                body: form
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || "Could not upload that file.");
            }
            loadThread();
        } catch (error) {
            console.error("Attachment upload error:", error);
            alert("Something went wrong uploading that file.");
        }
    }

    async function pollStatus() {
        if (!token()) return;
        try {
            const res = await fetch(`/api/staff-messages/status`, {
                headers: { "Authorization": `Bearer ${token()}` }
            });
            if (!res.ok) return;
            const data = await res.json();
            messagingEnabled = !!data.enabled;
            adminPresence = data.adminPresence || null;
            updatePresenceUi();
            if (!messagingEnabled && windowState !== "closed") closeWindow();
            if (messagingEnabled && windowState === "open") {
                // window is open and visible: don't grow the badge, just clear it
                unreadCount = 0;
            } else {
                unreadCount = data.unreadCount || 0;
            }
            emitUpdate();
        } catch (error) {
            console.error("Team messages status error:", error);
        }
    }

    async function sendHeartbeat() {
        if (!token() || !messagingEnabled) return;
        try {
            await fetch(`/api/staff-messages/heartbeat`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token()}` }
            });
        } catch (error) {
            // Non-critical - presence just won't be perfectly fresh.
        }
    }

    function init() {
        if (!token()) return;
        buildWindow();
        pollStatus();
        statusPollTimer = setInterval(pollStatus, STATUS_POLL_MS);
        sendHeartbeat();
        heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);

        window.LZTeamMessages = {
            open: openWindow,
            close: closeWindow,
            toggle: toggleWindow,
            isEnabled: () => messagingEnabled,
            getUnreadCount: () => unreadCount
        };
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
