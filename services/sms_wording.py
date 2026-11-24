"""The text bot's wording, editable by the organiser (roadmap X7-6).

Each message the bot sends has a key, CupQ's default wording, and the
{placeholders} it fills in. The organiser can override any of them in
Runner > Messages > Text wording; an override is stored in the settings
table (key "sms_wording") and used from the next text on.

    from services.sms_wording import say
    return say("order_cancelled", order_number=order_number)

Rules that keep an edit from breaking a conversation:
  - an override may only use the placeholders its message offers; an
    unknown {placeholder} or a stray brace falls back to the default
  - a blank override means "use the default"
  - overrides are re-read at most every 30 seconds

The defaults are word for word what the bot said before this module
existed (tests/sms_scenarios/golden_transcript.py proves it).

Messages move here a batch at a time; the welcome, confirmation, started,
ready and delay texts already have their own settings (Messages > Text
blast panel) and stay where they are.
"""
import logging
import string
import time

logger = logging.getLogger("expresso.sms_wording")

KV_KEY = "sms_wording"
MAX_LEN = 480  # three segments; the editor warns long before that

# key: (default wording, {placeholder: what it is}, where it's sent)
CATALOG = {
    "ask_name_after_order": (
        "Got it! And what's your first name?",
        {},
        "They ordered before telling us their name.",
    ),
    "not_a_name": (
        "Sorry, I didn't catch your name - what's your first name?",
        {},
        "We asked for their name and got something like 'yes' or 'none'.",
    ),
    "no_name_yet": (
        "I don't have your name yet. What's your first name?",
        {},
        "We need a name before we can take the order.",
    ),
    "group_ask_name": (
        "Sounds like a few coffees! First - what's your name?",
        {},
        "Their first text orders several coffees and we don't know them yet.",
    ),
    "ask_drink": (
        "What can I get you? (e.g. flat white, latte, cappuccino - or MENU for the list)",
        {},
        "We have their name and need the drink.",
    ),
    "drink_unavailable": (
        "Sorry, we don't have {drink} today. What would you like? ({available})",
        {"drink": "what they asked for", "available": "the drinks on today's menu"},
        "They asked for a drink that isn't on the menu.",
    ),
    "unsure_coffee": (
        "I'm not sure what type of coffee you'd like, {name}. Please specify a coffee type like latte, cappuccino, flat white, etc.",
        {"name": "their first name"},
        "We couldn't tell which drink they meant.",
    ),
    "size_not_offered": (
        "Sorry, we don't offer size '{size}' for {drink}. Available sizes are: {sizes}. Please select one of these.",
        {
            "size": "the size they asked for",
            "drink": "their drink",
            "sizes": "the sizes on offer",
        },
        "They asked for a size this event doesn't pour.",
    ),
    "size_unrecognised": (
        "I didn't recognize that size. Please choose from: {sizes}.",
        {"sizes": "the sizes on offer"},
        "Their answer to 'what size?' wasn't a size.",
    ),
    "stations_closed": (
        "Sorry, coffee isn't being served right now, so I can't take an order. Text us again when the stations open.",
        {},
        "They ordered while every station is closed.",
    ),
    "no_active_orders": (
        "You don't have any active orders. Text us your coffee order to get started!",
        {},
        "They texted STATUS with nothing on order.",
    ),
    "nothing_to_cancel": (
        "You don't have any pending orders to cancel.",
        {},
        "They texted CANCEL with nothing waiting.",
    ),
    "order_cancelled": (
        "Your order #{order_number} has been cancelled. Text us when you'd like to place a new order.",
        {"order_number": "the order's number"},
        "They cancelled an order by text.",
    ),
    "ask_barista_question": (
        "Sure - type your question and I'll send it straight to your barista.",
        {},
        "They texted BARISTA to ask a question.",
    ),
    "delete_confirm": (
        "This will delete all your data including order history.\nReply YES to confirm deletion or NO to cancel.",
        {},
        "They texted DELETE.",
    ),
    # Batch 2 (24 Nov 2026): account, data and friend commands.
    "delete_yes_or_no": (
        "Please reply YES to confirm deletion or NO to cancel.",
        {},
        "We asked them to confirm DELETE and got something other than YES or NO.",
    ),
    "delete_cancelled": (
        "Deletion cancelled. Your data is safe. How can we help you today?",
        {},
        "They answered NO to DELETE.",
    ),
    "data_deleted": (
        "Your data has been deleted. Thanks for using {service}.",
        {"service": "the name the text service goes by"},
        "They confirmed DELETE and their details were removed.",
    ),
    "nothing_to_delete": (
        "No data found to delete.",
        {},
        "They confirmed DELETE but we held nothing about them.",
    ),
    "delete_failed": (
        "Sorry, couldn't delete your data. Please contact support.",
        {},
        "They confirmed DELETE and something went wrong.",
    ),
    "mydata_none": (
        "No data found for your phone number. Start your first order to get personalized service!",
        {},
        "They texted MYDATA and we hold nothing about them.",
    ),
    "mydata_failed": (
        "Sorry, couldn't retrieve your data. Please try again later.",
        {},
        "They texted MYDATA and something went wrong.",
    ),
    "changename_usage": (
        "Please provide a name. Example: CHANGENAME Stephen",
        {},
        "They texted CHANGENAME without a name.",
    ),
    "name_updated": (
        "Name updated to: {name}\nYour next order will use this name.",
        {"name": "their new name"},
        "They changed their name with CHANGENAME.",
    ),
    "name_update_failed": (
        "Sorry, couldn't update your name. Please try again.",
        {},
        "CHANGENAME went wrong.",
    ),
    "prefs_none": (
        "No preferences found to reset.",
        {},
        "They texted RESET with no saved usual order.",
    ),
    "prefs_cleared": (
        "Preferences cleared!\nWe'll ask for your order details next time.\nYour name ({name}) is still saved.",
        {"name": "their first name"},
        "They texted RESET and their usual order was forgotten.",
    ),
    "prefs_reset_failed": (
        "Sorry, couldn't reset your preferences. Please try again.",
        {},
        "RESET went wrong.",
    ),
    "friend_order_first": (
        "Please start with your own order first. Text us your coffee order to begin!",
        {},
        "They texted FRIEND before we know who they are.",
    ),
    "friend_own_order_first": (
        "Hi {name}! Please place your own order first, then you can add coffees for friends.",
        {"name": "their first name"},
        "They texted FRIEND without an order in the last hour.",
    ),
    "friend_ask_name": (
        "Great! Let's add a coffee for your friend. What's their name?",
        {},
        "They texted FRIEND after ordering; we start the friend's order.",
    ),
    "friend_failed": (
        "Sorry, couldn't process your request. Please try again.",
        {},
        "FRIEND went wrong.",
    ),
    "question_passed": (
        "Thanks - passed to your barista.",
        {},
        "They sent a question for the barista; it's on the barista's screen.",
    ),
    "cancel_failed": (
        "Sorry, we couldn't cancel your order. Please try again or contact the coffee station directly.",
        {},
        "They texted CANCEL and something went wrong.",
    ),
    "vip_failed": (
        "Sorry, we couldn't process your VIP code. Please try again or contact the help desk.",
        {},
        "They sent a VIP code and something went wrong.",
    ),
    "order_error": (
        "Sorry, we encountered an error processing your order. Please try again or visit the coffee station directly.",
        {},
        "Placing their order went wrong.",
    ),
    # Batch 3 (24 Nov 2026): the ordering questions and refusals.
    "ask_milk": (
        "What milk for your {drink}? ({milks}, or 'no milk')",
        {"drink": "their drink", "milks": "the milks on today"},
        "Their drink needs a milk and they named one we can't assume.",
    ),
    "ask_size": (
        "What size {drink}? ({sizes})",
        {"drink": "their drink", "sizes": "the sizes on offer"},
        "We need the size of their drink.",
    ),
    "milk_unrecognised": (
        "I didn't recognise that milk. Please choose from: {milks}, or 'no milk'.",
        {"milks": "the milks on today"},
        "Their answer to 'what milk?' wasn't a milk.",
    ),
    "milk_none_today": (
        "Sorry, we don't have {milk} at any station today. What milk would you like? ({options})",
        {"milk": "the milk they asked for", "options": "the milks on today, or 'no milk'"},
        "They asked for a milk no open station has.",
    ),
    "milk_not_offered": (
        "Sorry, we don't have {milk}. Available options are: {available}.{off_menu} Please text MENU for full options.",
        {
            "milk": "the milk they asked for",
            "available": "the milks on the menu",
            "off_menu": "a sentence about off-menu requests, when that's turned on",
        },
        "They asked for a milk that isn't on the menu.",
    ),
    "drink_not_offered": (
        "Sorry, we don't offer {drink}. Available options are: {available}. Please text MENU for full options.",
        {"drink": "what they asked for", "available": "the drinks on the menu"},
        "Their order named a drink that isn't on the menu.",
    ),
    "sweetener_not_offered": (
        "Sorry, we don't have {sweetener}. Available options are: {available}. Please text MENU for full options.",
        {"sweetener": "the sweetener they asked for", "available": "the sweeteners on offer"},
        "They asked for a sweetener we don't have.",
    ),
    "which_tea": (
        "Which tea would you like? ({teas})",
        {"teas": "the teas on the menu"},
        "They asked for 'tea' without saying which.",
    ),
    "name_invalid": (
        "Please enter a valid name (2-50 characters).",
        {},
        "The name they sent was too short or too long.",
    ),
    "no_usual_yet": (
        "You don't have a saved usual order yet. What type of coffee would you like, {name}?",
        {"name": "their first name"},
        "They asked for their usual before ordering anything.",
    ),
    "welcome_back_ask_drink": (
        "Welcome back, {name}! What type of coffee would you like today?",
        {"name": "their first name"},
        "A returning customer with no usual order texted.",
    ),
    "welcome_back_ask_milk": (
        "Welcome back, {name}! What type of milk would you like with your {drink}?",
        {"name": "their first name", "drink": "their drink"},
        "A returning customer named a drink and we need the milk.",
    ),
    "confirm_yes_no_edit": (
        "Please reply YES to confirm your order, NO to cancel, or EDIT to change it.",
        {},
        "We asked them to confirm an order and the answer wasn't YES, NO or EDIT.",
    ),
    "usual_confirmed": (
        "Thanks, {name}! Your order has been confirmed. It will be ready for pickup at {station}.",
        {"name": "their first name", "station": "where to collect it"},
        "They confirmed their usual order.",
    ),
    # Batch 4 (24 Nov 2026): ordering for a friend (FRIEND).
    "friend_name_invalid": (
        "Please enter a valid name for your friend (2-50 characters).",
        {},
        "The friend's name they sent was too short or too long.",
    ),
    "friend_ask_drink": (
        "Thanks! What type of coffee would {friend} like?",
        {"friend": "the friend's name"},
        "We have the friend's name and need their drink.",
    ),
    "friend_unsure_drink": (
        "I'm not sure what coffee {friend} would like. Please specify a coffee type like latte, cappuccino, flat white, etc.",
        {"friend": "the friend's name"},
        "We couldn't tell which drink the friend wants.",
    ),
    "friend_got_it_ask_size": (
        "Got it - {order} for {friend}. What size? ({sizes})",
        {"order": "the friend's drink and milk", "friend": "the friend's name", "sizes": "the sizes on offer"},
        "We have the friend's drink and milk and need the size.",
    ),
    "friend_ask_size": (
        "What size {drink} would {friend} like? ({sizes})",
        {"drink": "the friend's drink", "friend": "the friend's name", "sizes": "the sizes on offer"},
        "We have the friend's milk and need the size.",
    ),
    "friend_milk_unrecognised": (
        "I didn't recognize that milk type. Please choose from: {milks}, or no milk.",
        {"milks": "the milks on today"},
        "Their answer to the friend's milk question wasn't a milk.",
    ),
    "friend_size_unrecognised": (
        "I didn't recognize that size. Please choose {sizes} for {friend}'s coffee.",
        {"sizes": "the sizes on offer", "friend": "the friend's name"},
        "Their answer to the friend's size question wasn't a size.",
    ),
    "friend_sugar_unclear": (
        "Sorry, I didn't catch how much sugar for {friend}. Reply 'none', '1', '2', '3', or 'half'.",
        {"friend": "the friend's name"},
        "Their answer to the friend's sugar question wasn't a sugar.",
    ),
    "friend_flow_confirmed": (
        "Thanks, {name}! Your order has been confirmed.\nWe'll SMS you when it's ready with the pickup location.",
        {"name": "their first name"},
        "They finished ordering for friends with just one coffee.",
    ),
    "friend_ask_another": (
        "Great! Let's add another coffee. What's your friend's name?",
        {},
        "They want to add another friend's coffee.",
    ),
    "friend_another_or_no": (
        "Please reply FRIEND to order for another friend, or NO to finish.",
        {},
        "We asked if they want another friend's coffee and the answer wasn't clear.",
    ),
    "friend_cancelled_next": (
        "Order for {friend} cancelled. What's the name of another friend you'd like to order for? (or type DONE to finish)",
        {"friend": "the friend's name"},
        "They cancelled a friend's coffee.",
    ),
    "friend_change": (
        "Let's change {friend}'s order. What type of coffee would {friend} like?",
        {"friend": "the friend's name"},
        "They asked to change a friend's coffee.",
    ),
    "friend_not_added": (
        "{friend}'s coffee wasn't confirmed, so it isn't in the order.",
        {"friend": "the friend's name"},
        "They moved on before confirming a friend's coffee; another reply follows on the same line.",
    ),
    "friend_confirm_prompt": (
        "Please reply YES to confirm {friend}'s order, NO to cancel, EDIT to change it, or DONE to finish the group order.",
        {"friend": "the friend's name"},
        "We asked them to confirm a friend's coffee and the answer wasn't clear.",
    ),
    "order_placed": (
        "Order #{order_number} confirmed. {queue}",
        {"order_number": "the order number", "queue": "their place in the queue"},
        "The first line once an order is placed.",
    ),
    "order_placed_one_station": (
        "Order #{order_number} confirmed. {milk} is at {station} only. {queue}",
        {"order_number": "the order number", "milk": "their milk", "station": "the station", "queue": "their place in the queue"},
        "As above, when only one station has their milk.",
    ),
    "queue_vip": (
        "VIP order - we'll prioritise it and text you when it's ready.",
        {},
        "Their place in the queue, for a VIP.",
    ),
    "queue_first": (
        "You're #1 in line, starting shortly.",
        {},
        "Their place in the queue, when they're next.",
    ),
    "queue_position": (
        "You're #{position} in line (~{wait} min wait).",
        {"position": "their place in the queue", "wait": "minutes"},
        "Their place in the queue.",
    ),
    "queue_wait": (
        "Estimated wait time: {wait} minutes.",
        {"wait": "minutes"},
        "The wait, when we can't tell their place in the queue.",
    ),
    "moved_cant_make": (
        "Note: {asked_station} can't make this order, so it was routed to {station}.",
        {"asked_station": "the station they asked for", "station": "the station"},
        "Added when the station they asked for can't make it.",
    ),
    "moved_not_available": (
        "Note: {asked_station} isn't available right now, so your order was routed to {station}.",
        {"asked_station": "the station they asked for", "station": "the station"},
        "Added when the station they asked for isn't open.",
    ),
    "order_recap": (
        "{placed}\nThat's: {order}.{sugar_note}{price} Wrong? CHANGE or OOPS. Add another with FRIEND.",
        {"placed": "the order number and place in the queue", "order": "the order, e.g. large oat latte", "sugar_note": "'sugar is help-yourself', when that's on", "price": "the price line, on its own line; empty when prices are off"},
        "The whole reply to a text order. Keep {placed} and {order}.",
    ),
    "price_free": (
        "Your drink is complimentary today. Enjoy!",
        {},
        "The price line, when there's nothing to pay.",
    ),
    "price_total": (
        "Total: {total}, pay at the counter when you collect.",
        {"total": "the price"},
        "The price line, when prices are on.",
    ),
    "price_group_total": (
        "Group total: {total} for {count}, pay at the counter on collection.",
        {"total": "the price", "count": "e.g. 3 coffees"},
        "The price line for a group.",
    ),
    "group_placed": (
        "Got it {name}! {count} coffees ordered together:\n{orders}{sugar_note}{price}\nSame station, ready together. Wrong? CHANGE or OOPS.",
        {"name": "their first name", "count": "how many coffees", "orders": "the coffees, one per line", "sugar_note": "'sugar is help-yourself', when that's on", "price": "the price line, on its own line; empty when prices are off"},
        "They ordered several coffees in one text. Keep {orders}.",
    ),
    "group_not_ordered": (
        "Not ordered: {order}",
        {"order": "the order, e.g. large oat latte"},
        "A line in the group reply for a coffee that couldn't be ordered.",
    ),
    "group_failed": (
        "Sorry, I couldn't place that group order just now. Please try sending one coffee at a time.",
        {},
        "None of a group's coffees could be ordered.",
    ),
    "milk_none_can_make": (
        "Sorry {who}none of our stations can make {milk} right now. What milk would you like instead? ({milks}, or 'no milk')",
        {"who": "their name and ', ', or nothing", "milk": "the milk they asked for", "milks": "the milks on offer"},
        "Their milk just ran out everywhere.",
    ),
    "drink_none_can_make": (
        "Sorry {who}we can't make that one right now. What milk would you like? ({milks}, or 'no milk')",
        {"who": "their name and ', ', or nothing", "milks": "the milks on offer"},
        "No station can make the drink as asked.",
    ),
    "milk_none_ask_size": (
        "Sorry, we don't have {milk} at any station today. Milks: {milks}. What size? ({sizes})",
        {"milk": "the milk they asked for", "milks": "the milks on offer", "sizes": "the sizes on offer"},
        "We asked for a size and they named a milk we don't have.",
    ),
    "milk_changed_ask_size": (
        "Got it - {drink} with {milk} milk. What size? ({sizes})",
        {"drink": "their drink", "milk": "their milk", "sizes": "the sizes on offer"},
        "We asked for a size and they changed the milk.",
    ),
    "ask_sugar": (
        "Sorry, I didn't catch that. How much sugar? Reply a number (0-9), 'half', or 'quarter'.",
        {},
        "We asked about sugar and the answer wasn't clear.",
    ),
    "welcome_registered": (
        "Hi {name}! You're registered for {event} - what coffee would you like?",
        {"name": "their first name", "event": "the event's name"},
        "First text from someone on the registration list.",
    ),
    "welcome_back": (
        "Welcome back!",
        {},
        "Comes before the offer of their usual.",
    ),
    "usual_offer": (
        "What can I get you today, {name}? Your usual {order}?",
        {"name": "their first name", "order": "the order, e.g. large oat latte"},
        "A returning customer says hi.",
    ),
    "usual_milk_not_on": (
        "Hi {name}! What can I get you today? (Just letting you know - {milk} isn't on at any station right now.)",
        {"name": "their first name", "milk": "their usual milk"},
        "A returning customer whose usual milk isn't on.",
    ),
    "usual_one_drink": (
        "What type of coffee would you like today? Your usual {drink}?",
        {"drink": "their usual drink"},
        "A returning customer with one regular drink.",
    ),
    "usual_two_drinks": (
        "What type of coffee would you like today? Your usual {drink} or perhaps a {other}?",
        {"drink": "their usual drink", "other": "their second favourite"},
        "A returning customer with two regular drinks.",
    ),
    "usual_confirm": (
        "Great, {name}! Here's your usual order: {order}{price}\nWould you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)",
        {"name": "their first name", "order": "the order, e.g. large oat latte", "price": "the price line, on its own line; empty when prices are off"},
        "They asked for their usual.",
    ),
    "friend_tip": (
        "Tip: add a friend's coffee anytime by texting FRIEND.",
        {},
        "Added after they confirm their usual.",
    ),
    "cancelled_ask_again": (
        "Order cancelled. What type of coffee would you like instead, {name}?",
        {"name": "their first name"},
        "They said NO to confirming.",
    ),
    "edit_updated": (
        "Updated - {change}.\nHere's your order now: {order}{price}\nReply YES to confirm, NO to cancel, or EDIT to change something else.",
        {"change": "what changed", "order": "the order, e.g. large oat latte", "price": "the price line, on its own line; empty when prices are off"},
        "They changed one thing before confirming.",
    ),
    "edit_restart": (
        "Let's change that order, {name}. What type of coffee would you like?\nTip: you can also say e.g. \"edit milk to oat\" to change just one thing.",
        {"name": "their first name"},
        "They said EDIT before confirming.",
    ),
    "friend_start": (
        "Great! Let's add a coffee for your friend. What's your friend's name?",
        {},
        "They said FRIEND instead of confirming their own.",
    ),
    "friend_confirm": (
        "For {friend}: {order}.\nReply YES to confirm, EDIT to change, or NO to cancel.",
        {"friend": "the friend's name", "order": "the order, e.g. large oat latte"},
        "A friend's coffee is complete.",
    ),
    "friend_confirm_long": (
        "Great! Here's the order for {friend}: {order}\nWould you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)",
        {"friend": "the friend's name", "order": "the order, e.g. large oat latte"},
        "A friend's coffee is complete, after the sugar question.",
    ),
    "friend_count_so_far": (
        "That's {count} coffees in your group order.\nReply FRIEND to add another or NO to finish.",
        {"count": "how many coffees"},
        "Added after a friend's coffee is placed.",
    ),
    "friend_group_confirmed": (
        "Thanks, {name}! Your group order of {count} coffees has been confirmed.{price}\nThey'll be ready together - we'll SMS you the pickup location.",
        {"name": "their first name", "count": "how many coffees", "price": "the price line, on its own line; empty when prices are off"},
        "They finished adding friends.",
    ),
    "status_pending": (
        "Your order #{order_number} ({order}) is pending at {station}. You've been waiting {waited} minutes.",
        {"order_number": "the order number", "order": "the order, e.g. large oat latte", "station": "the station", "waited": "minutes since they ordered"},
        "STATUS, still in the queue.",
    ),
    "status_making": (
        "Your order #{order_number} ({order}) is being made at {station}. You've been waiting {waited} minutes.",
        {"order_number": "the order number", "order": "the order, e.g. large oat latte", "station": "the station", "waited": "minutes since they ordered"},
        "STATUS, being made.",
    ),
    "status_ready": (
        "Your order #{order_number} ({order}) is ready for pickup at {station}!",
        {"order_number": "the order number", "order": "the order, e.g. large oat latte", "station": "the station", "waited": "minutes since they ordered"},
        "STATUS, ready.",
    ),
    "status_time_left": (
        "Ready in about {minutes} min.",
        {"minutes": "minutes to go"},
        "Added to STATUS when we can estimate it.",
    ),
    "vip_bumped": (
        "VIP status activated{who}! Your order #{order_number} is now priority - we'll make it next. Text us anytime to order again.",
        {"who": "', ' and their name, or nothing", "order_number": "the order number"},
        "They sent the VIP code with a coffee already in the queue.",
    ),
    "vip_activated": (
        "VIP status activated{who}! Your orders will be prioritised. What's your name and order?",
        {"who": "', ' and their name, or nothing"},
        "They sent the VIP code before ordering.",
    ),
    "help": (
        "Coffee Ordering Instructions:\n- Text your coffee order (e.g., 'large latte with oat milk')\n- STATUS: Check your order status\n- FRIEND: Add a coffee for a friend\n- CHANGE: Swap your order for a different one\n- OOPS: Cancel your pending order\n- MENU: See available coffee options\n- USUAL: Order your usual coffee\n- OPTIONS: See all available commands\nNeed more help? Visit the help desk or any coffee station.",
        {},
        "HELP: they texted INFO or ?. (A text saying HELP is answered by the phone network, not CupQ.)",
    ),
    "menu_title": (
        "Menu:",
        {},
        "MENU, first line.",
    ),
    "menu_coffee": (
        "Coffee: {drinks}",
        {"drinks": "coffees on today"},
        "MENU, the coffee line.",
    ),
    "menu_more_drinks": (
        "(+{count} more - just text the name)",
        {"count": "how many more"},
        "MENU, after the coffees when the list is shortened.",
    ),
    "menu_no_coffee": (
        "Coffee: (none in stock - check back soon)",
        {},
        "MENU, when no coffee can be made.",
    ),
    "menu_tea": (
        "Tea: {teas}",
        {"teas": "teas on today"},
        "MENU, the tea line (only when there are teas).",
    ),
    "menu_other": (
        "Other: {drinks}",
        {"drinks": "other drinks on today"},
        "MENU, chai, hot chocolate and so on.",
    ),
    "menu_milk": (
        "Milk: {milks}",
        {"milks": "milks on today"},
        "MENU, the milk line.",
    ),
    "menu_no_milk": (
        "Milk: (none in stock)",
        {},
        "MENU, when there is no milk.",
    ),
    "menu_sugar": (
        "Sugar: {sugars} (just text the number)",
        {"sugars": "sugars on today"},
        "MENU, the sugar line.",
    ),
    "menu_no_sweetener": (
        "Sweetener: none",
        {},
        "MENU, when there is no sugar.",
    ),
    "menu_sizes": (
        "Size: {sizes}",
        {"sizes": "sizes on today"},
        "MENU, the size line.",
    ),
    "menu_some_stations": (
        "{milks} only at certain stations - we'll route automatically.",
        {"milks": "milks only one station has"},
        "MENU, when only one station has a milk.",
    ),
    "menu_how_to_order": (
        "Reply with your order, e.g. '{example}'",
        {"example": "an order that's on today"},
        "MENU, last line.",
    ),
    "menu_unavailable": (
        "Sorry, we can't show the menu right now. Just text what you'd like, e.g. 'flat white with skim'.",
        {},
        "MENU, if the menu can't be read.",
    ),
    "sugar_self_serve": (
        "Sugar is help-yourself at the counter.",
        {},
        "Added when sugar is self-serve at this event.",
    ),
    "welcome_tips": (
        "(Tips: reply MENU to see the menu / FRIEND to add a friend's coffee / OOPS to scrap an order)",
        {},
        "Under the welcome text.",
    ),
    "welcome_back_no_usual": (
        "Welcome back, {name}! What type of coffee would you like today?",
        {"name": "their name"},
        "A returning customer with no usual order says hello.",
    ),
    "named_usual_offer": (
        "Nice to meet you, {name}! Would you like your usual {usual}? Reply YES or tell me what you'd like.",
        {"name": "their name", "usual": "their usual order"},
        "They gave their name and we know their usual.",
    ),
    "named_ask_drink": (
        "Hi {name}! What can I get you?\nExamples: {examples}\nReply MENU to see what's on offer.",
        {"name": "their name", "examples": "orders that are on today"},
        "They gave their name; now the drink.",
    ),
    "got_it_ask_size": (
        "Got it - {drink}. What size? ({sizes})",
        {"drink": "drink and milk", "sizes": "sizes on today"},
        "We have the drink and need the size.",
    ),
    "ask_size_for": (
        "What size {drink} would you like? ({sizes})",
        {"drink": "drink", "sizes": "sizes on today"},
        "They chose a milk; now the size.",
    ),
    "one_size_note": (
        "All drinks are {size} today.",
        {"size": "the only size"},
        "Before the recap, when there is one size.",
    ),
    "size_changed_note": (
        "We only have {size} cups today, so I've made it {size}.",
        {"size": "the only size"},
        "They asked for a size that isn't on.",
    ),
    "coffee_only": (
        "We're coffee only - tea, juice and water are available in the catering area.\nFrom us: {available}.\nReply MENU for the full list.",
        {"available": "drinks on today"},
        "They asked for something the caterers serve.",
    ),
    "drink_not_today": (
        "Sorry, we don't have {drink} today. Available: {available}.\nReply MENU for the full list.",
        {"drink": "what they asked for", "available": "drinks on today"},
        "They asked for a drink that isn't on.",
    ),
    "milk_not_today": (
        "Sorry, we don't have {milk}. Available milks: {milks}.{elsewhere}\nReply MENU for the full list.",
        {"milk": "what they asked for", "milks": "milks on today", "elsewhere": "where else to get it, or nothing"},
        "They asked for a milk that isn't on.",
    ),
    "get_it_elsewhere": (
        "Or grab it yourself from the {venue}.",
        {"venue": "the venue cafe's name"},
        "Added to a refusal when a venue cafe is set.",
    ),
    "bean_not_today": (
        "Sorry, we don't have {bean} today. We can make it with: {beans}.\nReply MENU for the full list.",
        {"bean": "what they asked for, e.g. decaf", "beans": "coffees on today"},
        "They asked for decaf (or a bean) that isn't on.",
    ),
    "sweetener_not_today": (
        "Sorry, we don't have {sweetener}. Available sweeteners: {sweeteners}.\nReply MENU for the full list.",
        {"sweetener": "what they asked for", "sweeteners": "sweeteners on today"},
        "They asked for a sweetener that isn't on.",
    ),
    "cant_make_marked": (
        "Sorry, we can't make {drink} right now - the barista has marked {items} unavailable.",
        {"drink": "drink", "items": "what is unavailable"},
        "The barista has marked an ingredient off (phone and kiosk orders too).",
    ),
    "cant_make_run_out": (
        "Sorry, we can't make {drink} right now - we've run out of {items}.",
        {"drink": "drink", "items": "what has run out"},
        "An ingredient has run out (phone and kiosk orders too).",
    ),
    "see_menu": (
        "Reply MENU for what's available.",
        {},
        "After a refused drink.",
    ),
    "milk_nowhere_note": (
        "We don't have {milk} at any station -",
        {"milk": "what they asked for"},
        "Before asking for another milk.",
    ),
    "group_one_at_a_time": (
        "I can do a group order, but {reason}. Easiest is one coffee at a time - what's the first one? (Then reply FRIEND to add the next.)",
        {"reason": "why, e.g. which milk is missing"},
        "Several coffees in one text that we couldn't work out.",
    ),
    "preorder_failed": (
        "Sorry, we couldn't save your pre-order just now - please try again in a minute.",
        {},
        "Before the event: the pre-order didn't save.",
    ),
    "preorder_one_only": (
        "(Pre-orders save ONE coffee per phone - we kept the first; order the rest on the day.)",
        {},
        "Before the event: they pre-ordered several coffees.",
    ),
    "eta_ask_order": (
        "Got it - about {minutes} min away! Text us your order now (e.g. 'medium latte with full cream') and we'll get it underway so it's ready when you arrive.",
        {"minutes": "minutes"},
        "They said when they'll arrive and have no usual.",
    ),
    "eta_scheduled": (
        "Great {name}! Your {order} is scheduled - we'll start making it just before you arrive, ready about {time}. Order #{order_number}. Reply CHANGE to fix it or OOPS to cancel.",
        {"name": "their name", "order": "their usual", "time": "time, e.g. 10:40", "order_number": "order number"},
        "They said when they'll arrive; their usual is booked.",
    ),
    "eta_failed": (
        "Sorry, we couldn't schedule that just now - text your order when you arrive and we'll make it straight away.",
        {},
        "Booking for their arrival didn't work.",
    ),
    "status_related": (
        "Related orders:\n{orders}",
        {"orders": "their friends' orders"},
        "STATUS, when they ordered for friends.",
    ),
    "status_failed": (
        "Sorry, we couldn't retrieve your order status. Please try again later.",
        {},
        "STATUS didn't work.",
    ),
    "track_link": (
        "Track your order here: {link}",
        {"link": "web address"},
        "Added when order tracking links are on.",
    ),
    "change_cancelled": (
        "No problem - order #{order_number} is cancelled. What would you like instead?",
        {"order_number": "order number"},
        "CHANGE: the old order is cancelled.",
    ),
    "cancel_too_late": (
        "Your order #{order_number} is already being made at {station} - too late to cancel by text. Please see the barista if you need to change it.",
        {"order_number": "order number", "station": "station name"},
        "They cancel an order that's being made.",
    ),
    "cancel_already_ready": (
        "Good news - your order #{order_number} is already made and waiting for you at {station}! No need to cancel, just come and grab it.",
        {"order_number": "order number", "station": "station name"},
        "They cancel an order that's ready.",
    ),
    "question_empty": (
        "Didn't catch a question. Just text it again, e.g. 'BARISTA is the milk fresh today?'",
        {},
        "BARISTA with nothing to pass on.",
    ),
    "question_failed": (
        "Sorry, our system hiccuped sending your question - try again in a moment, or ask at the counter.",
        {},
        "Their question didn't reach the baristas.",
    ),
    "mydata_profile": (
        "Your {service} Profile:\nName: {name}\nFavorite: {usual}\nSugar: {sugar}\nOrders: {orders} total\nMember since: {since}\n\nText RESET to clear preferences or DELETE to remove all data.",
        {"service": "CupQ's name", "name": "their name", "usual": "their usual order", "sugar": "their sugar", "orders": "how many orders", "since": "month and year"},
        "MYDATA: what we hold about them.",
    ),
    "forgetme_done": (
        "Forgotten! Your saved name, preferences, and {count} past order(s) have been wiped. Text us again to start fresh as a new customer.",
        {"count": "how many orders"},
        "FORGETME: everything wiped.",
    ),
    "forgetme_failed": (
        "Sorry - couldn't fully reset your record right now. Try again in a moment.",
        {},
        "FORGETME didn't work.",
    ),
    "friend_usual_offer": (
        "I see {friend} usually orders: {order}\nWould you like to order this again? (Reply YES or tell me what {friend} would like instead)",
        {"friend": "friend's name", "order": "friend's last order"},
        "FRIEND: we know what this friend has.",
    ),
    "friend_usual_confirm": (
        "Great! Here's the order for {friend}: {order}\nWould you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)",
        {"friend": "friend's name", "order": "friend's order"},
        "FRIEND: check the friend's usual.",
    ),
    "friend_order_check": (
        "For {friend}: {order}.\nReply YES to confirm, EDIT to change, or NO to cancel.",
        {"friend": "friend's name", "order": "friend's order"},
        "FRIEND: check the friend's order.",
    ),
    "order_incomplete": (
        "Sorry, your order is missing some details ({missing}). Reply MENU to start over.",
        {"missing": "what's missing"},
        "An order reached us without a drink, milk or size.",
    ),
    "reminder": (
        "Hi {name}, just a reminder - your {order} (Order #{order_number}) is still waiting at {station}. Come grab it before it goes cold!",
        {"name": "their name", "order": "their order", "order_number": "order number", "station": "station name"},
        "Pickup reminder.",
    ),
    "reminder_group": (
        "Hi {name}, just a reminder - your {order} (Order #{order_number}) are still waiting at {station}. Come grab them before they go cold!",
        {"name": "their name", "order": "e.g. 3 coffees", "order_number": "order number", "station": "station name"},
        "Pickup reminder for a group.",
    ),
    "resubscribed": (
        "You have successfully been re-subscribed to coffee order messages. What's your first name?",
        {},
        "They texted START.",
    ),
    "retry_name": (
        "Sorry, we dropped that one. What's your first name?",
        {},
        "A text failed while we waited for their name.",
    ),
    "retry_drink": (
        "Sorry, we dropped that one. What coffee would you like?",
        {},
        "A text failed while we waited for their drink.",
    ),
    "retry_milk": (
        "Sorry, we dropped that one. Which milk would you like?",
        {},
        "A text failed while we waited for their milk.",
    ),
    "retry_size": (
        "Sorry, we dropped that one. What size would you like?",
        {},
        "A text failed while we waited for their size.",
    ),
    "retry_sugar": (
        "Sorry, we dropped that one. How many sugars?",
        {},
        "A text failed while we waited for their sugar.",
    ),
    "retry_confirm": (
        "Sorry, we dropped that one - your order is still waiting. Reply YES to confirm it.",
        {},
        "A text failed while we waited for a yes.",
    ),
    "retry_last": (
        "Sorry, we dropped that one. Please send your last message again and we'll pick up where you left off.",
        {},
        "A text failed at any other time.",
    ),
    "message_unreadable": (
        "Sorry, we couldn't process your message. Please try again.",
        {},
        "An empty or unreadable text.",
    ),
    "system_down": (
        "Sorry, our ordering system is currently unavailable. Please try again later.",
        {},
        "The ordering system is down.",
    ),
    "system_moment": (
        "Sorry, our system is having a moment. Please try again.",
        {},
        "A text failed (backup text provider).",
    ),
}

# An order's number and contents must reach the customer whatever the wording.
REQUIRED = {
    "order_placed": {"order_number"},
    "order_placed_one_station": {"order_number"},
    "order_recap": {"placed", "order"},
    "group_placed": {"orders"},
    "menu_coffee": {"drinks"},
    "menu_milk": {"milks"},
    "menu_sizes": {"sizes"},
    "eta_scheduled": {"order_number", "time"},
    "reminder": {"order_number", "station"},
    "reminder_group": {"order_number", "station"},
    "cant_make_marked": {"items"},
    "cant_make_run_out": {"items"},
    "milk_not_today": {"milks"},
    "mydata_profile": {"name", "usual", "sugar", "orders", "since"},
    "friend_usual_confirm": {"order"},
    "friend_order_check": {"order"},
    "track_link": {"link"},
    "change_cancelled": {"order_number"},
}

_cache = {"at": 0.0, "value": {}}
TTL_S = 30


def _overrides():
    if time.monotonic() - _cache["at"] < TTL_S:
        return _cache["value"]
    value = {}
    try:
        from utils.database import close_connection, get_db_connection

        conn = get_db_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT value FROM settings WHERE key = %s", (KV_KEY,))
            row = cur.fetchone()
            raw = (
                (row[0] if not isinstance(row, dict) else row.get("value"))
                if row
                else None
            )
            if raw:
                import json

                parsed = json.loads(raw) if isinstance(raw, str) else raw
                if isinstance(parsed, dict):
                    value = {
                        k: str(v)
                        for k, v in parsed.items()
                        if k in CATALOG and str(v or "").strip()
                    }
        finally:
            close_connection(conn)
    except Exception as e:
        logger.debug("sms wording overrides unavailable: %s", e)
    _cache.update(at=time.monotonic(), value=value)
    return value


def placeholders(text):
    """The {names} a piece of text uses; raises ValueError on stray braces."""
    return {f for _, f, _, _ in string.Formatter().parse(text) if f}


def problems(key, text):
    """Why an override can't be used, or None."""
    if key not in CATALOG:
        return "unknown message"
    if len(text) > MAX_LEN:
        return f"longer than {MAX_LEN} characters"
    try:
        used = placeholders(text)
        extra = used - set(CATALOG[key][1])
    except ValueError:
        return "a { or } that isn't part of a placeholder"
    if extra:
        return "unknown placeholder: " + ", ".join("{" + e + "}" for e in sorted(extra))
    missing = REQUIRED.get(key, set()) - used
    if missing:
        return "must include " + ", ".join("{" + m + "}" for m in sorted(missing))
    return None


def say(key, **values):
    """The message for `key`, the organiser's wording if they set one."""
    default = CATALOG[key][0]
    text = _overrides().get(key) or default
    if text is not default and problems(key, text):
        text = default
    try:
        return text.format(**{k: values.get(k, "") for k in CATALOG[key][1]})
    except (KeyError, IndexError, ValueError):
        return default.format(**{k: values.get(k, "") for k in CATALOG[key][1]})


def clear_cache():
    _cache.update(at=0.0, value={})
