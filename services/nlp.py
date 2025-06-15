"""
Enhanced Natural Language Processing service for parsing coffee orders
"""
import logging
import re
from collections import Counter
import os
import json

logger = logging.getLogger("expresso.services.nlp")

# Ensure directory exists
os.makedirs(os.path.dirname(__file__), exist_ok=True)

class NLPService:
    """Service for processing coffee orders using robust pattern matching"""
    
    def __init__(self):
        """Initialize the NLP service with patterns and knowledge base"""
        # Initialize comprehensive databases of terms
        self.load_coffee_database()
        logger.info("NLP service initialized")
        
        # Add affirmative response words
        self.affirmative_responses = [
            "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "y", 
            "correct", "right", "absolutely", "definitely", "indeed", 
            "affirmative", "sounds good", "that's right", "that's correct",
            "sounds great", "perfect", "👍", "👌"
        ]
    
    def load_coffee_database(self):
        """Load comprehensive databases of coffee terminology"""
        # Coffee types with common misspellings, shorthand, and slang
        self.coffee_types = {
            # Standard coffees
            "cappuccino": ["cap", "capp", "caps", "capaccino", "capacino", "capochino", "capuccino", "cappacino", "cappacino", "cappcino", "cappuccino"],
            "latte": ["lat", "late", "lattee", "lattay", "lattae", "café latte", "cafe latte", "coffee latte", "latte"],
            "flat white": ["fw", "flatwhite", "flat-white", "flatty", "flattie", "flat-w", "flatw", "flt white", "flat"],
            "espresso": ["esp", "expresso", "shot", "short black", "sb", "espresso shot", "exspresso", "spro", "espresso"],
            "long black": ["lb", "americano", "longblack", "long-black", "americano coffee", "long coffee", "long"],
            "mocha": ["moch", "mocha coffee", "cafe mocha", "moca", "mocca", "chocolate coffee", "mocha"],
            "hot chocolate": ["hc", "choc", "chocolate", "hotchoc", "hot choc", "cacao", "cocoa"],
            "chai latte": ["chai", "chai tea", "chai tea latte", "cha", "chailatte", "chai-latte"],
            "matcha latte": ["matcha", "green tea latte", "matcha tea", "match", "matcha tea latte"],
            "tea": ["t", "cuppa", "brew", "regular tea", "normal tea", "english tea", "black tea", "green tea"],
            
            # Specialty coffees
            "piccolo": ["pic", "picolo", "picolo latte", "small latte", "baby latte"],
            "macchiato": ["mac", "mach", "macc", "machiato", "machiatto", "espresso macchiato", "caramel macchiato"],
            "affogato": ["affagato", "affigato", "ice cream coffee", "coffee ice cream", "icecream coffee"],
            "ristretto": ["ris", "ristreto", "short espresso", "restricted shot", "short shot"],
            "cortado": ["cort", "cotardo", "spanish coffee", "cort", "cut coffee"],
            "cold brew": ["coldbrew", "cold-brew", "cb", "cold coffee", "cold press"],
            "pour over": ["pourover", "pour-over", "filter", "drip", "hand pour", "manual brew", "v60", "chemex", "hario"],
            "filter coffee": ["filter", "drip coffee", "brewed coffee", "filtered", "drip", "batch brew", "regular coffee"]
        }
        
        # Size terms with variations
        self.sizes = {
            "small": ["s", "sm", "sml", "smol", "tiny", "little", "piccolo", "short", "8oz", "8 oz", "8ounce", "8 ounce", "8 ounces"],
            "medium": ["m", "med", "regular", "reg", "standard", "normal", "mid", "middle", "avg", "average", "12oz", "12 oz", "12ounce", "12 ounce", "12 ounces"],
            "large": ["l", "lg", "lrg", "big", "grande", "tall", "extra large", "xl", "jumbo", "massive", "16oz", "16 oz", "16ounce", "16 ounce", "16 ounces"]
        }
        
        # Milk types with variations - ENHANCED with more abbreviations
        self.milks = {
            "full cream": ["full", "regular milk", "regular", "normal", "standard", "whole", "dairy", "cow", "white", 
                          "full cream milk", "cream", "creamy", "full fat", "whole milk", "full milk", 
                          "fc", "f/c", "full c", "f cream", "fullcream", "full-cream", "ordinary"],
            "skim": ["skinny", "light", "trim", "non-fat", "non fat", "nonfat", "no fat", "diet", "low fat", 
                    "reduced fat", "skimmed", "skim milk", "skinny milk", "trim milk", "sk", "nf", "light milk"],
            "soy": ["soya", "soy milk", "soymilk", "soy bean", "soya milk", "soy-milk", "s milk", "s/m"],
            "almond": ["alm", "almond milk", "almondmilk", "alm milk", "nut milk", "alm nut", "almond nut", "a milk", "a/m"],
            "oat": ["oat milk", "oatly", "oatmilk", "oat-milk", "otm", "oaty", "o milk", "o/m"],
            "lactose free": ["lf", "lactose-free", "lactosefree", "no lactose", "lact free", "dairy free", "non-dairy", 
                           "lactose/free", "l free", "l-free", "l/f", "lact-free", "df", "nondairy"],
            "coconut": ["coconut milk", "coco milk", "coco", "coconutmilk", "c-milk", "coco-milk", "c/m"],
            "macadamia": ["mac milk", "macadamia milk", "mac nut milk", "macadamia nut milk", "mac", "maca", "m/m"],
            "no milk": ["black", "none", "no dairy", "straight", "neat", "without milk", "w/o milk", "plain", "no m", "n/m"]
        }
        
        # Sugar terms with variations
        self.sugars = {
            "no sugar": ["without sugar", "w/o sugar", "no sweet", "unsweet", "unsweetened", "zero sugar", "sugar free", 
                        "sugarless", "not sweet", "bitter", "no sweetener", "plain", "none", "no", "ns", "n/s", "0 sugar", "0s", "0"],
            "half sugar": ["less sweet", "less sugar", "little sugar", "bit of sugar", "not too sweet", "light sugar", 
                          "light sweet", "lightly sweet", "touch of sugar", "hint of sugar", "1/2 sugar", "0.5 sugar", "half s"],
            "1 sugar": ["1", "one", "white", "single", "normal", "regular", "standard", "sweet", "1 white", "1s", "a sugar", 
                       "with sugar", "sugar", "sweetened", "1x sugar", "one sugar", "1 s", "1sugar"],
            "2 sugar": ["2", "two", "double", "extra sweet", "very sweet", "2s", "2x sugar", "two sugar", "2 white", "two white", "2 s", "2sugar"],
            "3 sugar": ["3", "three", "triple", "super sweet", "3s", "3x sugar", "three sugar", "3 white", "three white", "extra extra sweet", "3 s", "3sugar"],
            "4 sugar": ["4", "four", "quadruple", "extremely sweet", "4s", "4x sugar", "four sugar", "4 s", "4sugar"]
        }
        
        # Strength terms
        self.strengths = {
            "strong": ["extra shot", "double shot", "double", "2 shot", "2shots", "2 shots", "two shots", "2shot", "strong coffee", 
                      "extra strong", "stronger", "powerful", "bold", "intense", "robust", "dark"],
            "weak": ["mild", "light", "gentle", "soft", "not strong", "less strong", "not too strong", "weak coffee", "light coffee"],
            "decaf": ["decaffeinated", "no caffeine", "without caffeine", "decaff", "decaffinated", "no caff", "no caf", "nocaf"],
            "half strength": ["half shot", "half-strength", "half caff", "half caf", "halfcaf", "half and half", "half-half", "light strength"]
        }
        
        # Temperature terms
        self.temperatures = {
            "hot": ["hot", "heated", "normal hot", "regular hot", "standard", "warm", "normal"],
            "extra hot": ["very hot", "really hot", "super hot", "xhot", "x-hot", "hot hot", "piping hot", "steaming", "burn", "burning", "scalding", "extra hot"],
            "warm": ["not too hot", "just warm", "less hot", "luke warm", "lukewarm", "mild temp", "mild temperature", "cooler"],
            "iced": ["cold", "on ice", "over ice", "with ice", "icey", "icy", "ice", "chilled", "cool"],
            "room temperature": ["ambient", "room temp", "no heat", "natural"]
        }
        
        # Common greetings for name detection
        self.greetings = [
            "hi", "hello", "hey", "hiya", "howdy", "morning", "afternoon", "evening", 
            "g'day", "good morning", "good afternoon", "good evening", "greetings", 
            "yo", "sup", "hi there", "hello there", "heya", "cheers"
        ]
        
        # Usual or regular order keywords
        self.usual_order_keywords = [
            "usual", "regular", "same as usual", "same as always", "same as last time", 
            "my usual", "the usual", "my regular", "my normal", "my standard", 
            "what i always have", "what i always get", "what i usually have", 
            "regular order", "normal order", "standard order", "coffee time"
        ]

        # Compile regex patterns for better matching
        self._compile_patterns()
    
    def _compile_patterns(self):
        """Compile regex patterns for each category"""
        # Special flags for orders
        self.vip_pattern = re.compile(r'\b(vip|priority|urgent|asap|rush|express|immediate|quick|hurry|emergency|important|first|skip[- ](?:the[- ])?(?:line|queue))\b', re.IGNORECASE)
        self.friend_pattern = re.compile(r'\b(?:for|to) (?:my |a )?(friend|mate|buddy|pal|colleague|coworker|co-worker|boss|wife|husband|partner|girlfriend|boyfriend|spouse|significant other|so)\b', re.IGNORECASE)
        self.friend_name_pattern = re.compile(r'\bfor\s+(\w+)\b(?!\s+(?:milk|sugar|coffee|with|please|thanks))', re.IGNORECASE)
        self.group_pattern = re.compile(r'\b(group|multiple|many|several|team|office|bulk|everyone)\b', re.IGNORECASE)
        self.loyalty_pattern = re.compile(r'\b(loyalty|points|rewards|free coffee|redeem|use points|loyalty card)\b', re.IGNORECASE)
        self.usual_pattern = re.compile(r'\b(' + '|'.join(self.usual_order_keywords) + r')\b', re.IGNORECASE)
    
    def is_greeting(self, text):
        """Check if text is just a greeting without meaningful content"""
        text_lower = text.lower().strip()
        # Check if it's a short message that is just a greeting
        if len(text) < 10:
            return text_lower in self.greetings or text_lower.startswith(tuple(self.greetings))
        
        # For longer messages, check if it starts with a greeting followed by punctuation
        for greeting in self.greetings:
            if text_lower.startswith(greeting + ",") or text_lower.startswith(greeting + ".") or text_lower.startswith(greeting + "!"):
                # If it's just a greeting with punctuation, it's a greeting
                remainder = text_lower[len(greeting)+1:].strip()
                return len(remainder) < 3  # If there's barely anything after the greeting
        
        return False
    
    def is_asking_for_usual(self, message):
        """
        Check if the customer is asking for their usual order
        
        Args:
            message: Text message from customer
            
        Returns:
            Boolean indicating if customer wants their usual
        """
        message_lower = message.lower().strip()
        
        # Check using regex pattern
        if self.usual_pattern.search(message_lower):
            return True
            
        # Additional check for simpler terms
        simple_indicators = ["same", "usual", "regular", "always", "coffee time"]
        if any(term in message_lower for term in simple_indicators):
            return True
            
        return False
        
    def is_affirmative_response(self, message):
        """
        Check if the message is an affirmative response (like "Yes")
        
        Args:
            message: Text message from customer
            
        Returns:
            Boolean indicating if message is affirmative
        """
        message_lower = message.lower().strip()
        
        # Check for exact matches
        if message_lower in self.affirmative_responses:
            return True
            
        # Check for messages that start with affirmative responses
        for response in self.affirmative_responses:
            if message_lower.startswith(response + " ") or message_lower.startswith(response + ","):
                return True
                
        return False
    
    def parse_order(self, message):
        """
        Parse a customer message to extract order details
        
        Args:
            message: Text message from customer
            
        Returns:
            Dictionary with extracted order details
        """
        # Initialize order details
        order_details = {}
        
        # Normalize message: lowercase, fix typos, etc.
        normalized_message = self._normalize_message(message)
        
        # Check if message is asking for the usual order
        if self.is_asking_for_usual(normalized_message):
            order_details["request_usual"] = True
            return order_details
        
        # Extract coffee type
        coffee_type = self._extract_coffee_type(normalized_message)
        if coffee_type:
            order_details["type"] = coffee_type
        
        # Extract size
        size = self._extract_size(normalized_message)
        if size:
            order_details["size"] = size
        
        # Extract milk type
        milk = self._extract_milk_type(normalized_message)
        if milk:
            order_details["milk"] = milk
        
        # Extract sugar preference
        sugar = self._extract_sugar(normalized_message)
        if sugar:
            order_details["sugar"] = sugar
        
        # Extract strength
        strength = self._extract_strength(normalized_message)
        if strength:
            order_details["strength"] = strength
        
        # Extract temperature
        temp = self._extract_temperature(normalized_message)
        if temp:
            order_details["temp"] = temp
        
        # Extract special flags
        if self.vip_pattern.search(normalized_message):
            order_details["vip"] = True
        
        # Check for friend order
        friend_match = self.friend_pattern.search(normalized_message)
        if friend_match:
            order_details["for_friend"] = True
        
        # Try to extract friend's name if mentioned
        friend_name_match = self.friend_name_pattern.search(normalized_message)
        if friend_name_match:
            friend_name = friend_name_match.group(1)
            if friend_name and len(friend_name) > 1 and friend_name.lower() not in [
                "me", "myself", "mine", "now", "you", "us", "them", "here"
            ]:
                order_details["for_friend"] = friend_name
        
        # Check for group order
        if self.group_pattern.search(normalized_message):
            order_details["group"] = True
        
        # Check for loyalty redemption
        if self.loyalty_pattern.search(normalized_message) and ("free" in normalized_message.lower() or "redeem" in normalized_message.lower()):
            order_details["use_loyalty"] = True
        
        # Extract notes
        notes = self._extract_notes(normalized_message)
        if notes:
            order_details["notes"] = notes
        
        # Set default size if not specified
        if "size" not in order_details:
            order_details["size"] = "medium"
        
        # Set default milk for coffee types that typically need it
        if "milk" not in order_details and "type" in order_details:
            if not self.is_black_coffee(order_details["type"]):
                order_details["milk"] = "full cream"
        
        return order_details
    
    def _normalize_message(self, message):
        """
        Normalize message by converting to lowercase and fixing common typos
        
        Args:
            message: Original message
            
        Returns:
            Normalized message
        """
        # Convert to lowercase
        normalized = message.lower()
        
        # Replace common typos and abbreviations
        typo_corrections = {
            "expresso": "espresso",
            "expressos": "espressos",
            "cappacino": "cappuccino",
            "capacino": "cappuccino",
            "capuccino": "cappuccino",
            "caffeien": "caffeine",
            "machiato": "macchiato",
            "mocha latte": "mocha",
            "decaff": "decaf",
            "venti": "large",
            "grande": "medium",
            "chai tea latte": "chai latte",
            "the usual": "usual",
            "my usual": "usual",
            "as usual": "usual",
            "coffee time": "usual"
        }
        
        for typo, correction in typo_corrections.items():
            normalized = re.sub(r'\b' + typo + r'\b', correction, normalized)
        
        return normalized
    
    def _extract_coffee_type(self, message):
        """Extract coffee type from message using pattern matching"""
        # Handle "usual" separately to avoid setting it as a coffee type
        if self.is_asking_for_usual(message):
            return None
        
        # Try to get database-defined coffee types
        db_coffee_types = self._get_db_coffee_types()
        
        # If we have database-defined coffee types, check against those first
        if db_coffee_types:
            # First check for exact matches
            for coffee_type in db_coffee_types:
                if coffee_type.lower() in message.lower():
                    return coffee_type
            
            # Then check for variations and partial matches
            extracted_type = None
            for canonical, variations in self.coffee_types.items():
                if canonical.lower() in message.lower():
                    extracted_type = canonical
                    break
                
                for variation in variations:
                    # Use word boundaries to avoid partial matches
                    if re.search(r'\b' + re.escape(variation) + r'\b', message.lower()):
                        extracted_type = canonical
                        break
                        
                if extracted_type:
                    break
            
            # Check if the extracted type is in our database coffee types
            if extracted_type and any(db_type.lower() == extracted_type.lower() for db_type in db_coffee_types):
                return extracted_type
            
            # If we didn't find a match in database types, fall back to standard pattern matching
        
        # Try exact matches first
        for canonical, variations in self.coffee_types.items():
            if canonical in message:
                return canonical
            
            for variation in variations:
                # Use word boundaries to avoid partial matches
                if re.search(r'\b' + re.escape(variation) + r'\b', message.lower()):
                    return canonical
        
        # Try matching multi-word coffee types that might not have exact boundaries
        multi_word_types = ["flat white", "long black", "hot chocolate", "chai latte", "matcha latte", "cold brew", "pour over", "filter coffee"]
        for coffee_type in multi_word_types:
            words = coffee_type.split()
            # Match if all words are present in the message
            if all(word in message for word in words):
                return coffee_type
        
        return None
        
    def _get_db_coffee_types(self):
        """Get coffee types from the database"""
        try:
            # Try to access the database via Flask app
            from flask import current_app
            if hasattr(current_app, 'config'):
                coffee_system = current_app.config.get('coffee_system')
                if coffee_system and hasattr(coffee_system, 'db'):
                    cursor = coffee_system.db.cursor()
                    cursor.execute("""
                        SELECT name FROM stock_items 
                        WHERE category = 'coffee_type' AND is_active = TRUE
                        ORDER BY name
                    """)
                    return [row[0] for row in cursor.fetchall()]
        except Exception as e:
            pass  # Silently fail, will use hardcoded types
        
        return None
    
    def _extract_size(self, message):
        """Extract size from message"""
        for canonical, variations in self.sizes.items():
            if canonical in message:
                return canonical
            
            for variation in variations:
                if re.search(r'\b' + re.escape(variation) + r'\b', message):
                    return canonical
        
        return None
    
    def _extract_milk_type(self, message):
        """Extract milk type from message"""
        # Handle explicit 'no milk' or 'black' first
        for variation in self.milks["no milk"]:
            if re.search(r'\b' + re.escape(variation) + r'\b', message):
                return "no milk"
        
        # Match other milk types
        for canonical, variations in self.milks.items():
            if canonical == "no milk":  # Already handled
                continue
                
            if canonical in message:
                return canonical
            
            for variation in variations:
                if re.search(r'\b' + re.escape(variation) + r'\b', message):
                    return canonical
        
        return None
    
    def _extract_sugar(self, message):
        """Extract sugar preference from message"""
        # Check for numeric sugar patterns (e.g., "2 sugars", "3 sugar")
        num_sugar_match = re.search(r'(\d+)\s*(?:sugar|sugars|sweetener)', message)
        if num_sugar_match:
            num = int(num_sugar_match.group(1))
            if num <= 0:
                return "no sugar"
            else:
                return f"{num} sugar"
        
        # Check categorical sugar preferences
        for canonical, variations in self.sugars.items():
            if canonical in message:
                return canonical
            
            for variation in variations:
                # Check for variations with boundaries
                if re.search(r'\b' + re.escape(variation) + r'\b', message):
                    return canonical
        
        return None
    
    def _extract_strength(self, message):
        """Extract coffee strength preference from message"""
        # Check for shot counts
        shot_match = re.search(r'(\d+)\s*shots?', message)
        if shot_match:
            num_shots = int(shot_match.group(1))
            if num_shots == 1:
                return "single shot"
            elif num_shots == 2:
                return "double shot"
            elif num_shots == 3:
                return "triple shot"
            else:
                return f"{num_shots} shots"
        
        # Check categorical strength preferences
        for canonical, variations in self.strengths.items():
            if canonical in message:
                return canonical
            
            for variation in variations:
                if re.search(r'\b' + re.escape(variation) + r'\b', message):
                    return canonical
        
        return None
    
    def _extract_temperature(self, message):
        """Extract temperature preference from message"""
        for canonical, variations in self.temperatures.items():
            if canonical in message:
                return canonical
            
            for variation in variations:
                if re.search(r'\b' + re.escape(variation) + r'\b', message):
                    return canonical
        
        return None
    
    def _extract_notes(self, message):
        """Extract additional notes not captured by other extractors"""
        # Look for allergy information
        allergy_match = re.search(r'allerg(?:y|ic|ies) (?:to)?\s*([^,.!?]+)', message, re.IGNORECASE)
        if allergy_match:
            return f"Allergy note: {allergy_match.group(1).strip()}"
        
        # Look for special instructions
        special_instructions = re.search(r'(?:special|specific) (?:instructions?|requests?|notes?)[\s:]*([^,.!?]+)', message, re.IGNORECASE)
        if special_instructions:
            return special_instructions.group(1).strip()
        
        return None
    
    def is_black_coffee(self, coffee_type):
        """
        Check if the coffee type typically doesn't need milk
        
        Args:
            coffee_type: Coffee type string
            
        Returns:
            True if black coffee, False otherwise
        """
        if not coffee_type:
            return False
        
        no_milk_types = ['espresso', 'short black', 'long black', 'americano']
        return any(type_name.lower() in coffee_type.lower() for type_name in no_milk_types)
    
    def format_order_summary(self, order_details, customer_name=None):
        """
        Format order details into a readable summary
        
        Args:
            order_details: Dictionary with order details
            customer_name: Optional customer name to include
            
        Returns:
            Formatted order summary string
        """
        size = order_details.get('size', 'regular')
        coffee_type = order_details.get('type', 'coffee')
        milk = order_details.get('milk', 'regular milk')
        sugar = order_details.get('sugar', 'no sugar')
        strength = order_details.get('strength', '')
        temp = order_details.get('temp', '')
        notes = order_details.get('notes', '')
        
        # Start with size and coffee type
        order_text = f"{size} {coffee_type}"
        
        # Add milk unless it's an espresso/black coffee or 'no milk' is specified
        if milk != 'no milk' and not self.is_black_coffee(coffee_type):
            order_text += f" with {milk} milk"
        
        # Add strength if specified
        if strength:
            order_text += f", {strength}"
        
        # Add temperature if specified
        if temp:
            order_text += f", {temp}"
        
        # Add sugar preference
        if sugar and sugar != 'no sugar':
            order_text += f", {sugar}"
        elif sugar == 'no sugar':
            order_text += ", no sugar"
        
        # Add any additional notes
        if notes:
            order_text += f" (Notes: {notes})"
        
        # Add customer name if provided
        if customer_name:
            order_text = f"{customer_name}'s order: {order_text}"
        
        return order_text
    
    def validate_order(self, order_details):
        """
        Validate an order by checking for required fields and valid coffee types
        
        Args:
            order_details: Dictionary with order details
            
        Returns:
            List of missing or invalid fields, empty if order is complete and valid
        """
        missing = []
        invalid = []
        
        # If this is a usual order request, no validation needed
        if order_details.get("request_usual", False):
            return missing
        
        # Check for required fields
        if 'type' not in order_details:
            missing.append('type')
        else:
            # Validate the coffee type against available options
            coffee_type = order_details['type']
            if not self._is_valid_coffee_type(coffee_type):
                invalid.append(f"Coffee type '{coffee_type}' is not available")
        
        # Milk is not required for espresso or black coffee
        if 'milk' not in order_details:
            if 'type' in order_details:
                coffee_type = order_details['type'].lower()
                if not self.is_black_coffee(coffee_type):
                    missing.append('milk')
            else:
                missing.append('milk')
        
        # Check size against available sizes
        if 'size' in order_details:
            size = order_details['size']
            if not self._is_valid_size(size):
                invalid.append(f"Size '{size}' is not available")
        
        # Combine missing and invalid lists
        return missing + invalid
        
    def _is_valid_coffee_type(self, coffee_type):
        """
        Check if a coffee type is valid (in database or hardcoded list)
        
        Args:
            coffee_type: Coffee type to validate
            
        Returns:
            Boolean indicating if type is valid
        """
        # Get coffee types from database
        db_coffee_types = self._get_db_coffee_types()
        
        # If we have database types, check against those
        if db_coffee_types:
            return any(db_type.lower() == coffee_type.lower() for db_type in db_coffee_types)
        
        # Fallback to hardcoded types if no database connection
        return coffee_type.lower() in [t.lower() for t in self.coffee_types.keys()]
        
    def _is_valid_size(self, size):
        """
        Check if a size is valid
        
        Args:
            size: Size to validate
            
        Returns:
            Boolean indicating if size is valid
        """
        # Get sizes from database if available
        try:
            from flask import current_app
            if hasattr(current_app, 'config'):
                coffee_system = current_app.config.get('coffee_system')
                if coffee_system and hasattr(coffee_system, 'db'):
                    cursor = coffee_system.db.cursor()
                    cursor.execute("""
                        SELECT DISTINCT size FROM stock_items 
                        WHERE category = 'cup' AND is_active = TRUE
                        ORDER BY size
                    """)
                    db_sizes = [row[0] for row in cursor.fetchall()]
                    if db_sizes:
                        return any(db_size.lower() == size.lower() for db_size in db_sizes)
        except Exception as e:
            pass  # Silently fail, will use hardcoded sizes
        
        # Fallback to hardcoded sizes
        return size.lower() in [s.lower() for s in self.sizes.keys()]
    
    def is_complete_order(self, order_details):
        """
        Check if the order has all the required fields
        
        Args:
            order_details: Dictionary with order details
            
        Returns:
            True if complete, False otherwise
        """
        # If this is a usual order request, it's complete
        if order_details.get("request_usual", False):
            return True
            
        missing = self.validate_order(order_details)
        return len(missing) == 0