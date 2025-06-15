    def _check_event_schedule(self):
        """Check if stations are open based on event schedule"""
        try:
            cursor = self.db.cursor()
            
            # Get current day and time
            now = datetime.now()
            current_day = now.weekday()  # 0=Monday, 6=Sunday
            current_time = now.time()
            
            # Check if we're in an active break period
            cursor.execute("""
                SELECT title, start_time, end_time, stations
                FROM event_breaks
                WHERE day_of_week = %s
                  AND %s BETWEEN start_time AND end_time
                ORDER BY start_time
                LIMIT 1
            """, (current_day, current_time))
            
            current_break = cursor.fetchone()
            
            if current_break:
                # We're in an active break period - stations are open
                title, start, end, stations_json = current_break
                return True, f"Stations are open during {title}."
            
            # Check for upcoming breaks
            cursor.execute("""
                SELECT title, start_time, end_time
                FROM event_breaks
                WHERE day_of_week = %s
                  AND start_time > %s
                ORDER BY start_time
                LIMIT 1
            """, (current_day, current_time))
            
            next_break = cursor.fetchone()
            
            if next_break:
                # There's an upcoming break today
                title, start_time, end_time = next_break
                
                # Format time for display
                start_formatted = start_time.strftime("%I:%M %p")
                
                # Check custom session status
                cursor.execute("""
                    SELECT value FROM settings WHERE key = 'session_status'
                """)
                session_status = cursor.fetchone()
                
                if session_status and session_status[0]:
                    status = session_status[0].lower()
                    
                    if status == 'running_over':
                        return False, (
                            f"Coffee stations are currently closed as the session is running over. "
                            f"We expect to open for {title} shortly. "
                            f"Text VIP if you have a VIP code, or reply to this message when we're open."
                        )
                    elif status == 'finished_early':
                        return True, (
                            f"The session finished early! Coffee stations are now open. "
                            f"What would you like to order?"
                        )
                
                # Default message - stations closed until next break
                return False, (
                    f"Coffee stations are currently closed. We will open again at {start_formatted} for {title}. "
                    f"Text VIP if you have a VIP code, or reply to this message during the break."
                )
            else:
                # No more breaks today - possibly closed for the day
                cursor.execute("""
                    SELECT value FROM settings WHERE key = 'custom_closed_message'
                """)
                custom_message = cursor.fetchone()
                
                if custom_message and custom_message[0]:
                    return False, custom_message[0]
                else:
                    return False, (
                        f"Sorry, coffee stations are closed for the day. "
                        f"Please come back tomorrow for the next session."
                    )
                
        except Exception as e:
            logger.error(f"Error checking event schedule: {str(e)}")
            # Default to open if we can't check the schedule
            return True, "Coffee stations are open."
    
    def _assign_station(self, is_vip=False, milk_type=None):
        """
        Assign order to a station based on current load, capabilities, and scheduling
        
        Returns:
            (station_id, is_delayed): ID of the assigned station and whether order is delayed
        """
        try:
            cursor = self.db.cursor()
            
            # First check if we're in a break period or not
            current_time = datetime.now()
            current_hour = current_time.hour
            current_minute = current_time.minute
            current_day = current_time.weekday()  # 0=Monday, 6=Sunday
            
            # Check for any scheduled breaks that include the current time
            cursor.execute("""
                SELECT id, start_time, end_time, stations 
                FROM event_breaks 
                WHERE day_of_week = %s
                ORDER BY start_time
            """, (current_day,))
            
            current_break = None
            next_break = None
            
            for break_info in cursor.fetchall():
                break_id, start_str, end_str, stations_json = break_info
                
                # Parse the time strings (format: HH:MM)
                start_hour, start_minute = map(int, start_str.split(':'))
                end_hour, end_minute = map(int, end_str.split(':'))
                
                # Check if current time is within the break
                if ((current_hour > start_hour) or 
                    (current_hour == start_hour and current_minute >= start_minute)) and \
                   ((current_hour < end_hour) or 
                    (current_hour == end_hour and current_minute <= end_minute)):
                    # We're in a break period now
                    current_break = {
                        'id': break_id,
                        'start': (start_hour, start_minute),
                        'end': (end_hour, end_minute),
                        'stations': json.loads(stations_json) if stations_json else []
                    }
                    break
                
                # Check if this is the next upcoming break
                if (current_hour < start_hour) or \
                   (current_hour == start_hour and current_minute < start_minute):
                    next_break = {
                        'id': break_id,
                        'start': (start_hour, start_minute),
                        'end': (end_hour, end_minute),
                        'stations': json.loads(stations_json) if stations_json else []
                    }
                    break
            
            # Get all stations with their current load and capabilities
            cursor.execute("""
                SELECT s.station_id, s.current_load, s.capacity, s.status, s.capabilities
                FROM station_stats s
                WHERE s.status = 'active'
                ORDER BY s.current_load
            """)
            
            stations = []
            for station_data in cursor.fetchall():
                station_id, load, capacity, status, capabilities_json = station_data
                capabilities = json.loads(capabilities_json) if capabilities_json else {}
                
                stations.append({
                    'id': station_id,
                    'load': load or 0,
                    'capacity': capacity or 10,  # Default capacity if none set
                    'status': status,
                    'capabilities': capabilities,
                    'alt_milk_available': capabilities.get('alt_milk', True),
                    'high_volume': capabilities.get('high_volume', False),
                    'vip_service': capabilities.get('vip_service', False)
                })
            
            if not stations:
                # Default to station 1 if no stations found
                logger.warning("No active stations found, defaulting to station 1")
                return 1, False
            
            # First handle VIP logic
            if is_vip:
                # For VIPs, prefer stations with VIP service capability
                vip_stations = [s for s in stations if s['vip_service']]
                
                if vip_stations:
                    # Use the least busy VIP-capable station
                    vip_stations.sort(key=lambda s: s['load'])
                    logger.info(f"Assigned VIP order to dedicated VIP station {vip_stations[0]['id']}")
                    return vip_stations[0]['id'], False
                
                # If no VIP stations, use the least busy regular station
                stations.sort(key=lambda s: s['load'])
                logger.info(f"Assigned VIP order to regular station {stations[0]['id']} (no VIP stations available)")
                return stations[0]['id'], False
            
            # Check if the requested milk type is a special case (alternative milk)
            is_alt_milk = milk_type and milk_type.lower() in ['soy milk', 'almond milk', 'oat milk', 'soy', 'almond', 'oat']
            
            # During a break period, use stations that are open
            if current_break:
                # Get the stations that are open during this break
                open_station_ids = current_break['stations']
                open_stations = [s for s in stations if s['id'] in open_station_ids]
                
                if not open_stations:
                    logger.warning(f"No stations open during current break, using all active stations")
                    open_stations = stations
                
                # Find the best station based on milk type and load
                if is_alt_milk:
                    alt_milk_stations = [s for s in open_stations if s['alt_milk_available']]
                    if alt_milk_stations:
                        alt_milk_stations.sort(key=lambda s: s['load'])
                        logger.info(f"Assigned alt milk order to station {alt_milk_stations[0]['id']} during break")
                        return alt_milk_stations[0]['id'], False
                
                # If no alt milk or not an alt milk order, use standard load balancing
                open_stations.sort(key=lambda s: s['load'])
                logger.info(f"Assigned order to least busy station {open_stations[0]['id']} during break")
                return open_stations[0]['id'], False
            
            # If not in a break period but there's a next break coming up
            if not current_break and next_break:
                # Check if all stations are nearly at capacity
                stations_busy = all(s['load'] >= 0.8 * s['capacity'] for s in stations)
                
                if stations_busy:
                    # Stations are busy, suggest delay until next break
                    next_break_station_ids = next_break['stations']
                    next_break_stations = [s for s in stations if s['id'] in next_break_station_ids]
                    
                    if next_break_stations:
                        # Choose high capacity station if possible
                        high_volume_stations = [s for s in next_break_stations if s['high_volume']]
                        if high_volume_stations:
                            station_choice = high_volume_stations[0]['id']
                        else:
                            station_choice = next_break_stations[0]['id']
                        
                        logger.info(f"Stations busy, delaying order until next break using station {station_choice}")
                        return station_choice, True
            
            # Standard station assignment for normal operations
            # Check for special milk requirements
            if is_alt_milk:
                alt_milk_stations = [s for s in stations if s['alt_milk_available']]
                if alt_milk_stations:
                    alt_milk_stations.sort(key=lambda s: s['load'])
                    logger.info(f"Assigned alt milk order to station {alt_milk_stations[0]['id']}")
                    return alt_milk_stations[0]['id'], False
            
            # Otherwise just assign to least busy station
            stations.sort(key=lambda s: s['load'])
            return stations[0]['id'], False
            
        except Exception as e:
            logger.error(f"Error in station assignment: {str(e)}")
            # Default to station 1 on error
            return 1, False
    
    def _get_station_wait_time(self, station_id):
        """Get estimated wait time for a station"""
        try:
            cursor = self.db.cursor()
            
            # Get station wait time from settings
            cursor.execute("""
                SELECT current_load, avg_completion_time, wait_time
                FROM station_stats
                WHERE station_id = %s
            """, (station_id,))
            
            result = cursor.fetchone()
            
            if result:
                current_load, avg_completion_time, wait_time = result
                
                # If station has set a specific wait time, use that
                if wait_time:
                    return wait_time
                
                # Otherwise calculate based on load and avg completion time
                if avg_completion_time:
                    # Calculate wait time in minutes
                    calculated_wait = max(1, (current_load * avg_completion_time) // 60)
                    return min(calculated_wait, 30)  # Cap at 30 minutes
                
                # Default fallback based on load
                return max(5, min(current_load * 2, 20))
            else:
                # No station stats - use default
                return 10
                
        except Exception as e:
            logger.error(f"Error getting station wait time: {str(e)}")
            return 10  # Default wait time
    
    def _save_customer_preferences(self, phone, name, order_details):
        """Save customer preferences for future use"""
        try:
            cursor = self.db.cursor()
            
            # Check if customer exists
            cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
            customer = cursor.fetchone()
            
            now = datetime.now()
            
            if customer:
                # Update existing customer
                cursor.execute("""
                    UPDATE customer_preferences
                    SET name = %s,
                        preferred_drink = %s,
                        preferred_milk = %s,
                        preferred_size = %s,
                        preferred_sugar = %s,
                        last_order_date = %s,
                        total_orders = COALESCE(total_orders, 0) + 1
                    WHERE phone = %s
                """, (
                    name,
                    order_details.get('type'),
                    order_details.get('milk'),
                    order_details.get('size'),
                    order_details.get('sugar'),
                    now,
                    phone
                ))
            else:
                # Create new customer
                cursor.execute("""
                    INSERT INTO customer_preferences
                    (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, 
                     first_order_date, last_order_date, total_orders, is_vip)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    phone,
                    name,
                    order_details.get('type'),
                    order_details.get('milk'),
                    order_details.get('size'),
                    order_details.get('sugar'),
                    now,
                    now,
                    1,
                    order_details.get('vip', False)
                ))
            
            self.db.commit()
            logger.info(f"Saved preferences for customer {name} ({phone})")
            
        except Exception as e:
            logger.error(f"Error saving customer preferences: {str(e)}")
            # Continue even if this fails (non-critical)
    
    def _handle_awaiting_friend_name(self, phone, message, state):
        """Handle friend name input for a group order"""
        # Extract name from message
        friend_name = message.strip()
        
        # Basic validation
        if len(friend_name) < 2 or len(friend_name) > 50:
            return "Please enter a valid name for your friend (2-50 characters)."
        
        # Get data from state
        temp_data = state.get('temp_data', {})
        primary_name = temp_data.get('primary_name', '')
        primary_order = temp_data.get('primary_order', {})
        station_id = temp_data.get('station_id')
        
        # Check if we have a previous order for this friend
        cursor = self.db.cursor()
        cursor.execute("""
            SELECT preferred_drink, preferred_milk, preferred_size, preferred_sugar
            FROM customer_preferences
            WHERE phone = %s AND name = %s
        """, (f"{phone}_{friend_name}", friend_name))
        
        previous_order = cursor.fetchone()
        
        if previous_order and previous_order[0]:
            # We have a previous order for this friend
            drink, milk, size, sugar = previous_order
            
            # Format order summary
            if self.nlp:
                friend_order = {
                    'name': friend_name,
                    'type': drink,
                    'milk': milk,
                    'size': size,
                    'sugar': sugar,
                    'station_id': station_id
                }
                order_summary = self.nlp.format_order_summary(friend_order)
            else:
                order_summary = f"{size} {drink} with {milk}" + (f", {sugar}" if sugar else "")
            
            # Update state to handle the response
            self._set_conversation_state(phone, 'awaiting_friend_confirmation', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'friend_name': friend_name,
                'friend_order': {
                    'name': friend_name,
                    'type': drink,
                    'milk': milk,
                    'size': size,
                    'sugar': sugar,
                    'station_id': station_id
                },
                'station_id': station_id
            })
            
            return (
                f"I see {friend_name} usually orders: {order_summary}\n"
                f"Would you like to order this again? (Reply YES to confirm, or tell me what {friend_name} would like)"
            )
        else:
            # No previous order for this friend
            self._set_conversation_state(phone, 'awaiting_friend_coffee_type', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'friend_name': friend_name,
                'station_id': station_id
            })
            
            return f"Thanks! What type of coffee would {friend_name} like?"
    
    def _handle_awaiting_friend_coffee_type(self, phone, message, state):
        """Handle friend's coffee type selection"""
        # Get data from state
        temp_data = state.get('temp_data', {})
        primary_name = temp_data.get('primary_name', '')
        friend_name = temp_data.get('friend_name', '')
        station_id = temp_data.get('station_id')
        
        # Use NLP to parse coffee type if available
        coffee_type = None
        complete_order = None
        if self.nlp:
            try:
                order_details = self.nlp.parse_order(message)
                if 'type' in order_details:
                    coffee_type = order_details['type']
                    
                    # Check if we got a complete order
                    if self.nlp.is_complete_order(order_details):
                        # Add friend's name
                        order_details['name'] = friend_name
                        if station_id:
                            order_details['station_id'] = station_id
                        complete_order = order_details
            except Exception as e:
                logger.error(f"Error parsing coffee type with NLP: {str(e)}")
        
        # If NLP didn't find a coffee type, use simple parsing
        if not coffee_type:
            coffee_type = self._parse_coffee_type(message)
        
        if not coffee_type:
            # No valid coffee type found
            coffee_options = ", ".join(self.available_coffee_types[:5])
            return (
                f"I'm not sure what type of coffee {friend_name} would like. Please specify from our menu: "
                f"{coffee_options}, etc."
            )
        
        # Validate if this coffee type is available
        if coffee_type.lower() not in [c.lower() for c in self.available_coffee_types]:
            # Coffee type not available - suggest alternatives
            coffee_options = ", ".join(self.available_coffee_types[:5])
            return (
                f"Sorry, we don't offer {coffee_type} at this event. Available options include: "
                f"{coffee_options}. Please select another coffee type for {friend_name}."
            )
        
        # If we have a complete order from NLP
        if complete_order:
            self._set_conversation_state(phone, 'awaiting_friend_confirmation', {
                'primary_name': primary_name,
                'friend_name': friend_name,
                'friend_order': complete_order,
                'station_id': station_id
            })
            
            # Format order summary
            order_summary = self.nlp.format_order_summary(complete_order)
            
            return (
                f"Great! I understood {friend_name}'s order: {order_summary}\n"
                f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
            )
        
        # Coffee type is valid - check if it's a black coffee
        is_black_coffee = False
        if self.nlp:
            is_black_coffee = self.nlp.is_black_coffee(coffee_type)
        else:
            is_black_coffee = coffee_type.lower() in ['long black', 'espresso', 'americano', 'black coffee']
        
        # Create friend's order
        friend_order = {
            'name': friend_name,
            'type': coffee_type,
            'station_id': station_id
        }
        
        # If it's a black coffee, we can skip milk selection
        if is_black_coffee:
            friend_order['milk'] = 'no milk'
            
            # Update state and move to size
            self._set_conversation_state(phone, 'awaiting_friend_size', {
                'primary_name': primary_name,
                'friend_name': friend_name,
                'friend_order': friend_order,
                'station_id': station_id
            })
            
            return f"What size {coffee_type} would {friend_name} like? ({', '.join(self.available_sizes)})"
        else:
            # Update state and move to milk selection
            self._set_conversation_state(phone, 'awaiting_friend_milk', {
                'primary_name': primary_name,
                'friend_name': friend_name,
                'friend_order': friend_order,
                'station_id': station_id
            })
            
            return f"What type of milk would {friend_name} like with their {coffee_type}? ({', '.join(self.available_milk_types)})"
    
    # Utility methods for simple parsing when NLP is not available
    
    def _format_order_summary(self, order_details):
        """Format order details into a readable summary string"""
        size = order_details.get('size', 'regular')
        coffee_type = order_details.get('type', 'coffee')
        milk = order_details.get('milk', 'regular milk')
        sugar = order_details.get('sugar', 'no sugar')
        strength = order_details.get('strength', '')
        temp = order_details.get('temp', '')
        
        # Start with size and coffee type
        order_text = f"{size} {coffee_type}"
        
        # Add milk unless it's an espresso/black coffee or 'no milk' is specified
        is_black_coffee = coffee_type.lower() in ['long black', 'espresso', 'americano', 'black coffee']
        if milk != 'no milk' and not is_black_coffee:
            order_text += f" with {milk} milk"
        
        # Add strength if specified
        if strength:
            order_text += f", {strength}"
        
        # Add temperature if specified
        if temp:
            order_text += f", {temp}"
        
        # Add sugar preference
        if sugar and sugar != 'no sugar' and sugar.lower() != 'no sugar':
            order_text += f", {sugar}"
        
        return order_text
    
    def _parse_coffee_type(self, message):
        """Simple parsing for coffee type without NLP"""
        message_lower = message.lower()
        
        # Direct matches
        for coffee_type in self.available_coffee_types:
            if coffee_type.lower() in message_lower:
                return coffee_type
        
        # Check for common types with variations
        if 'capp' in message_lower:
            return 'Cappuccino'
        elif 'latt' in message_lower:
            return 'Latte'
        elif 'flat' in message_lower or 'white' in message_lower:
            return 'Flat White'
        elif 'espresso' in message_lower or 'shot' in message_lower:
            return 'Espresso'
        elif 'long black' in message_lower or 'americano' in message_lower:
            return 'Long Black'
        elif 'mocha' in message_lower:
            return 'Mocha'
        elif 'chai' in message_lower:
            return 'Chai Latte'
        elif 'hot choc' in message_lower or 'chocolate' in message_lower:
            return 'Hot Chocolate'
        
        return None
    
    def _parse_milk_type(self, message):
        """Simple parsing for milk type without NLP"""
        message_lower = message.lower()
        
        # Direct matches
        for milk_type in self.available_milk_types:
            if milk_type.lower() in message_lower:
                return milk_type
        
        # Common variations
        if 'full' in message_lower or 'regular' in message_lower or 'normal' in message_lower:
            return 'Full Cream'
        elif 'skim' in message_lower or 'skinny' in message_lower or 'light' in message_lower:
            return 'Skim'
        elif 'soy' in message_lower:
            return 'Soy'
        elif 'almond' in message_lower:
            return 'Almond'
        elif 'oat' in message_lower:
            return 'Oat'
        elif 'lactose' in message_lower or 'free' in message_lower:
            return 'Lactose Free'
        
        return None
    
    def _parse_size(self, message):
        """Simple parsing for size without NLP"""
        message_lower = message.lower()
        
        # Direct matches
        for size in self.available_sizes:
            if size.lower() in message_lower:
                return size
        
        # Common variations
        if message_lower in ['s', 'sm', 'small']:
            return 'Small'
        elif message_lower in ['m', 'med', 'medium', 'regular']:
            return 'Medium'
        elif message_lower in ['l', 'lg', 'large']:
            return 'Large'
        
        # Default to medium if unclear
        return 'Medium'
    
    def _parse_sweetener(self, message):
        """Simple parsing for sweetener without NLP"""
        message_lower = message.lower()
        
        # Direct matches
        for sweetener in self.available_sweeteners:
            if sweetener.lower() in message_lower:
                return sweetener
        
        # Common variations
        if 'no' in message_lower or 'none' in message_lower or '0' in message:
            return 'No Sugar'
        elif '1' in message or 'one' in message_lower:
            return '1 Sugar'
        elif '2' in message or 'two' in message_lower:
            return '2 Sugar'
        elif '3' in message or 'three' in message_lower:
            return '3 Sugar'
        
        # Default to no sugar if unclear
        return 'No Sugar'
    
    def _get_conversation_state(self, phone):
        """Get the conversation state for a phone number"""
        # Check in-memory cache first
        if phone in self.conversation_states:
            return self.conversation_states[phone]
        
        # Otherwise, check database
        try:
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT state, temp_data, last_interaction, message_count
                FROM conversation_states
                WHERE phone = %s
            """, (phone,))
            
            result = cursor.fetchone()
            
            if result:
                state, temp_data_str, last_interaction, message_count = result
                
                # Parse JSON temp data
                try:
                    temp_data = json.loads(temp_data_str) if temp_data_str else {}
                except Exception as json_err:
                    logger.error(f"Error parsing JSON in conversation state: {str(json_err)}")
                    temp_data = {}
                
                # Create state object
                state_obj = {
                    'state': state,
                    'temp_data': temp_data,
                    'last_interaction': last_interaction,
                    'message_count': int(message_count) if message_count else 0
                }
                
                # Cache in memory
                self.conversation_states[phone] = state_obj
                
                return state_obj
            
            # No state found - return empty state
            return {'state': None, 'temp_data': {}, 'message_count': 0}
            
        except Exception as e:
            logger.error(f"Error getting conversation state: {str(e)}")
            return {'state': None, 'temp_data': {}, 'message_count': 0}
    
    def _set_conversation_state(self, phone, state, temp_data=None):
        """Update the conversation state for a phone number"""
        # Update in-memory cache
        now = datetime.now()
        
        # Get existing state to update message count
        existing = self._get_conversation_state(phone)
        message_count = existing.get('message_count', 0) + 1
        
        # Create state object
        state_obj = {
            'state': state,
            'temp_data': temp_data or {},
            'last_interaction': now,
            'message_count': message_count
        }
        
        # Update in-memory cache
        self.conversation_states[phone] = state_obj
        
        # Update database
        try:
            cursor = self.db.cursor()
            
            # Convert temp_data to JSON
            temp_data_json = json.dumps(temp_data) if temp_data else None
            
            # Check if state exists
            cursor.execute("SELECT phone FROM conversation_states WHERE phone = %s", (phone,))
            result = cursor.fetchone()
            
            if result:
                # Update existing state
                cursor.execute("""
                    UPDATE conversation_states
                    SET state = %s, temp_data = %s, last_interaction = %s, message_count = %s
                    WHERE phone = %s
                """, (state, temp_data_json, now, message_count, phone))
            else:
                # Insert new state
                cursor.execute("""
                    INSERT INTO conversation_states
                    (phone, state, temp_data, last_interaction, message_count)
                    VALUES (%s, %s, %s, %s, %s)
                """, (phone, state, temp_data_json, now, message_count))
            
            self.db.commit()
            logger.debug(f"Updated conversation state for {phone} to '{state}'")
            
        except Exception as e:
            logger.error(f"Error setting conversation state: {str(e)}")
    
    def _get_setting(self, key, default_value=None):
        """Get a setting from the database with caching"""
        try:
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = %s", (key,))
            result = cursor.fetchone()
            
            if result and result[0]:
                return result[0]
            
            return default_value
        except Exception as e:
            logger.error(f"Error getting setting {key}: {str(e)}")
            return default_value I'll need your name first. What's your first name?"
            
            # Mark this customer as VIP in their preferences
            cursor = self.db.cursor()
            
            if customer:
                # Update existing customer
                cursor.execute("""
                    UPDATE customer_preferences 
                    SET is_vip = TRUE 
                    WHERE phone = %s
                """, (phone,))
            else:
                # Create new customer record
                cursor.execute("""
                    INSERT INTO customer_preferences 
                    (phone, name, is_vip, first_order_date, last_order_date) 
                    VALUES (%s, %s, TRUE, %s, %s)
                """, (phone, name, datetime.now(), datetime.now()))
            
            self.db.commit()
            
            # Update conversation state
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name, 'vip': True})
            
            return f"VIP status activated, {name}! Your orders will now be prioritized. What would you like to order?"
            
        except Exception as e:
            logger.error(f"Error processing VIP code: {str(e)}")
            return "Sorry, we couldn't process your VIP code. Please try again or contact the help desk."
    
    def _start_friend_order(self, phone, state):
        """Start an order for a friend"""
        # Check if we have current customer name
        customer = self._get_customer(phone)
        name = customer.get('name', '') if customer else ''
        
        if not name:
            # We need the customer's name first
            self._set_conversation_state(phone, 'awaiting_name')
            return "Before ordering for a friend, I need your name. What's your first name?"
        
        # Check for existing orders
        cursor = self.db.cursor()
        cursor.execute("""
            SELECT id, order_number, station_id, order_details, status
            FROM orders 
            WHERE phone = %s AND status IN ('pending', 'in-progress', 'completed') 
            ORDER BY created_at DESC 
            LIMIT 1
        """, (phone,))
        
        result = cursor.fetchone()
        
        if result:
            # They have an existing order
            order_id, order_number, station_id, order_details_json, status = result
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json or {}
                
            # Set up friend order state
            self._set_conversation_state(phone, 'awaiting_friend_name', {
                'primary_name': name,
                'primary_order': order_details,
                'group_orders': [],
                'station_id': station_id  # Keep same station for group orders
            })
            
            return f"Great, {name}! Let's add a coffee for your friend. What's your friend's name?"
        else:
            # No existing order to associate with
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return f"You'll need to place your own order first before ordering for a friend. What coffee would you like, {name}?"
    
    def _handle_awaiting_name(self, phone, message, state):
        """Handle name input during conversation"""
        # Extract name from message
        name = message.strip()
        
        # Basic validation
        if len(name) < 2 or len(name) > 50:
            return "Please enter a valid name (2-50 characters)."
        
        # Check if this is a VIP registration
        vip = state.get('temp_data', {}).get('vip', False)
        
        if vip:
            # Process VIP code if present
            vip_code = state.get('temp_data', {}).get('vip_code')
            
            # Save name and VIP flag for next step
            self._set_conversation_state(phone, 'awaiting_coffee_type', {
                'name': name,
                'vip': True
            })
            
            return f"VIP status activated, {name}! Your orders will now be prioritized. What would you like to order?"
        
        # Check if we have a pending order from NLP parsing
        pending_order = state.get('temp_data', {}).get('pending_order')
        if pending_order:
            # We have a complete order from NLP but needed a name
            # Add name to order and move to confirmation
            pending_order['name'] = name
            
            self._set_conversation_state(phone, 'awaiting_confirmation', {
                'name': name,
                'order_details': pending_order
            })
            
            # Format order summary using NLP if available
            if self.nlp:
                order_summary = self.nlp.format_order_summary(pending_order)
            else:
                order_summary = self._format_order_summary(pending_order)
            
            return (
                f"Thanks, {name}! Here's your order: {order_summary}\n"
                f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
            )
        
        # Regular order flow
        # Check if this might be a returning customer (by phone) that we just don't have a name for
        customer = self._get_customer(phone)
        
        if customer and not customer.get('name'):
            # Update customer record with name
            cursor = self.db.cursor()
            cursor.execute("""
                UPDATE customer_preferences
                SET name = %s
                WHERE phone = %s
            """, (name, phone))
            self.db.commit()
        
        # Try parsing the message for coffee order using NLP if available
        if self.nlp:
            try:
                # Check if they included coffee details in their name message
                message_without_name = self._remove_name_from_message(message, name)
                if message_without_name and len(message_without_name) > 3:  # Minimum meaningful length
                    order_details = self.nlp.parse_order(message_without_name)
                    if order_details and len(order_details) > 1:  # Found meaningful order details
                        order_details['name'] = name
                        
                        # Check if this is a complete order
                        if self.nlp.is_complete_order(order_details):
                            # Move directly to confirmation
                            self._set_conversation_state(phone, 'awaiting_confirmation', {
                                'name': name,
                                'order_details': order_details
                            })
                            
                            # Format order summary
                            order_summary = self.nlp.format_order_summary(order_details)
                            
                            return (
                                f"Thanks, {name}! I also understood your coffee order: {order_summary}\n"
                                f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
                            )
                        elif 'type' in order_details:
                            # We have coffee type but not complete order - continue to milk
                            self._set_conversation_state(phone, 'awaiting_milk', {
                                'name': name,
                                'order_details': order_details
                            })
                            
                            # If it's a black coffee type, skip milk
                            if self.nlp.is_black_coffee(order_details['type']):
                                order_details['milk'] = 'no milk'
                                return self._handle_awaiting_milk(phone, "no milk", {'state': 'awaiting_milk', 'temp_data': {'name': name, 'order_details': order_details}})
                            
                            return f"What type of milk would you like with your {order_details['type']}? ({', '.join(self.available_milk_types[:3])} etc.)"
            except Exception as e:
                logger.error(f"Error parsing message with NLP during name input: {str(e)}")
        
        # Save name for next step and ask for coffee type
        self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
        
        return f"Nice to meet you, {name}! What type of coffee would you like today? Text MENU to see options."
    
    def _remove_name_from_message(self, message, name):
        """Remove the name part from a message to help with order parsing"""
        # Try common patterns
        patterns = [
            f"^{re.escape(name)}$",
            f"^{re.escape(name)}\\s+",
            f"^my name is {re.escape(name)}\\b",
            f"^i'm {re.escape(name)}\\b",
            f"^i am {re.escape(name)}\\b",
            f"^this is {re.escape(name)}\\b",
            f"^{re.escape(name)} here\\b",
        ]
        
        for pattern in patterns:
            message = re.sub(pattern, '', message, flags=re.IGNORECASE)
        
        return message.strip()
    
    def _handle_awaiting_coffee_type(self, phone, message, state, station_id=None):
        """Handle coffee type selection"""
        # Get data from state
        temp_data = state.get('temp_data', {})
        name = temp_data.get('name', '')
        vip = temp_data.get('vip', False)
        
        # Check if this is an affirmative response to a previous usual order suggestion
        if temp_data.get('suggestion_context') == 'usual_order' and (
            (self.nlp and self.nlp.is_affirmative_response(message)) or 
            message.upper().strip() in ['YES', 'Y', 'YEP', 'YEAH', 'CONFIRM', 'OK']
        ):
            return self._process_usual_order(phone, name)
        
        # Use NLP to parse the message if available
        coffee_type = None
        complete_order = None
        
        if self.nlp:
            try:
                order_details = self.nlp.parse_order(message)
                
                # Check if we got a complete order
                if order_details and self.nlp.is_complete_order(order_details):
                    # Add name and VIP status
                    order_details['name'] = name
                    if vip:
                        order_details['vip'] = True
                        
                    # Add station ID if specified
                    if station_id:
                        order_details['station_id'] = station_id
                    
                    # Move to confirmation
                    self._set_conversation_state(phone, 'awaiting_confirmation', {
                        'name': name,
                        'order_details': order_details
                    })
                    
                    # Format order summary
                    order_summary = self.nlp.format_order_summary(order_details)
                    
                    return (
                        f"Great! I understood your order: {order_summary}\n"
                        f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
                    )
                elif 'type' in order_details:
                    # Found at least the coffee type
                    coffee_type = order_details['type']
                    
                    # Add other details for later steps
                    if 'milk' in order_details and order_details['milk']:
                        milk_type = order_details['milk']
                    if 'size' in order_details and order_details['size']:
                        size = order_details['size']
                    if 'sugar' in order_details and order_details['sugar']:
                        sugar = order_details['sugar']
            except Exception as e:
                logger.error(f"Error parsing coffee order with NLP: {str(e)}")
        
        # If we don't have a coffee type yet, parse the message with simpler methods
        if not coffee_type:
            coffee_type = self._parse_coffee_type(message)
        
        if not coffee_type:
            # No valid coffee type found
            coffee_options = ", ".join(self.available_coffee_types[:5])
            return (
                f"I'm not sure what type of coffee you'd like. Please specify from our menu: "
                f"{coffee_options}, etc. Text MENU to see all options."
            )
        
        # Validate if this coffee type is available
        if coffee_type.lower() not in [c.lower() for c in self.available_coffee_types]:
            # Coffee type not available - suggest alternatives
            coffee_options = ", ".join(self.available_coffee_types[:5])
            return (
                f"Sorry, we don't offer {coffee_type} at this event. Available options include: "
                f"{coffee_options}. Please select another coffee type."
            )
        
        # Coffee type is valid - check if it's a black coffee
        is_black_coffee = False
        if self.nlp:
            is_black_coffee = self.nlp.is_black_coffee(coffee_type)
        else:
            is_black_coffee = coffee_type.lower() in ['long black', 'espresso', 'americano', 'black coffee']
        
        # Save order details
        order_details = {
            'name': name,
            'type': coffee_type,
            'vip': vip
        }
        
        # Add station ID if provided
        if station_id:
            order_details['station_id'] = station_id
        
        # If it's a black coffee, we can skip milk selection
        if is_black_coffee:
            order_details['milk'] = 'no milk'
            
            # Update state and move to size
            self._set_conversation_state(phone, 'awaiting_size', {
                'name': name,
                'order_details': order_details
            })
            
            return f"What size {coffee_type} would you like? ({', '.join(self.available_sizes)})"
        else:
            # Update state and move to milk selection
            self._set_conversation_state(phone, 'awaiting_milk', {
                'name': name,
                'order_details': order_details
            })
            
            return f"What type of milk would you like with your {coffee_type}? ({', '.join(self.available_milk_types)})"
    
    def _handle_awaiting_milk(self, phone, message, state):
        """Handle milk type selection"""
        # Get data from state
        temp_data = state.get('temp_data', {})
        name = temp_data.get('name', '')
        order_details = temp_data.get('order_details', {})
        coffee_type = order_details.get('type', 'coffee')
        
        # Use NLP to parse milk preference if available
        milk_type = None
        if self.nlp:
            try:
                # Parse the message to extract milk type
                parse_result = self.nlp.parse_order(message)
                if 'milk' in parse_result:
                    milk_type = parse_result['milk']
            except Exception as e:
                logger.error(f"Error parsing milk type with NLP: {str(e)}")
        
        # Handle "no milk" response
        if message.lower() in ['no milk', 'none', 'black', 'no', 'without milk']:
            milk_type = 'no milk'
        
        # If NLP didn't find a valid milk type, use simple parsing
        if not milk_type:
            milk_type = self._parse_milk_type(message)
        
        if not milk_type:
            # No valid milk type found
            milk_options = ", ".join(self.available_milk_types)
            return (
                f"I'm not sure what type of milk you'd like. Please specify from: "
                f"{milk_options}, or say 'no milk' for black coffee."
            )
        
        # Validate if this milk type is available
        if milk_type.lower() != 'no milk' and milk_type.lower() not in [m.lower() for m in self.available_milk_types]:
            # Milk type not available - suggest alternatives
            milk_options = ", ".join(self.available_milk_types)
            return (
                f"Sorry, we don't offer {milk_type} milk at this event. Available options include: "
                f"{milk_options}. Please select another milk type."
            )
        
        # Milk type is valid - update order details
        order_details['milk'] = milk_type
        
        # Check for more details in the message
        additional_details = None
        if self.nlp:
            try:
                parse_result = self.nlp.parse_order(message)
                if 'size' in parse_result:
                    order_details['size'] = parse_result['size']
                if 'sugar' in parse_result:
                    order_details['sugar'] = parse_result['sugar']
                if 'strength' in parse_result:
                    order_details['strength'] = parse_result['strength']
                if 'temp' in parse_result:
                    order_details['temp'] = parse_result['temp']
                
                # Check if we now have a complete order
                if self.nlp.is_complete_order(order_details):
                    additional_details = True
            except Exception as e:
                logger.error(f"Error parsing additional details with NLP: {str(e)}")
        
        # If we found additional details that complete the order, move to confirmation
        if additional_details:
            self._set_conversation_state(phone, 'awaiting_confirmation', {
                'name': name,
                'order_details': order_details
            })
            
            # Format order summary
            order_summary = self.nlp.format_order_summary(order_details)
            
            return (
                f"Great! I understand your complete order: {order_summary}\n"
                f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
            )
        
        # Otherwise, continue to size selection
        self._set_conversation_state(phone, 'awaiting_size', {
            'name': name,
            'order_details': order_details
        })
        
        size_options = ", ".join(self.available_sizes)
        return f"What size {coffee_type} would you like? ({size_options})"
    
    def _handle_awaiting_size(self, phone, message, state):
        """Handle size selection"""
        # Get data from state
        temp_data = state.get('temp_data', {})
        name = temp_data.get('name', '')
        order_details = temp_data.get('order_details', {})
        coffee_type = order_details.get('type', 'coffee')
        
        # Use NLP to parse size if available
        size = None
        if self.nlp:
            try:
                # Parse the message to extract size
                parse_result = self.nlp.parse_order(message)
                if 'size' in parse_result:
                    size = parse_result['size']
            except Exception as e:
                logger.error(f"Error parsing size with NLP: {str(e)}")
        
        # If NLP didn't find a valid size, use simple parsing
        if not size:
            size = self._parse_size(message)
        
        if not size:
            # No valid size found
            size_options = ", ".join(self.available_sizes)
            return f"Please select a valid size: {size_options}."
        
        # Validate if this size is available
        if size.lower() not in [s.lower() for s in self.available_sizes]:
            # Size not available - suggest alternatives
            size_options = ", ".join(self.available_sizes)
            return (
                f"Sorry, we don't offer {size} size at this event. Available options include: "
                f"{size_options}. Please select another size."
            )
        
        # Size is valid - update order details
        order_details['size'] = size
        
        # Check for more details in the message
        additional_details = None
        if self.nlp:
            try:
                parse_result = self.nlp.parse_order(message)
                if 'sugar' in parse_result:
                    order_details['sugar'] = parse_result['sugar']
                if 'strength' in parse_result:
                    order_details['strength'] = parse_result['strength']
                if 'temp' in parse_result:
                    order_details['temp'] = parse_result['temp']
                
                # Check if we now have a complete order
                if self.nlp.is_complete_order(order_details):
                    additional_details = True
            except Exception as e:
                logger.error(f"Error parsing additional details with NLP: {str(e)}")
        
        # If we found additional details that complete the order, move to confirmation
        if additional_details:
            self._set_conversation_state(phone, 'awaiting_confirmation', {
                'name': name,
                'order_details': order_details
            })
            
            # Format order summary
            order_summary = self.nlp.format_order_summary(order_details)
            
            return (
                f"Great! I understand your complete order: {order_summary}\n"
                f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
            )
        
        # Otherwise, continue to sweetener selection
        self._set_conversation_state(phone, 'awaiting_sweetener', {
            'name': name,
            'order_details': order_details
        })
        
        sweetener_options = ", ".join(self.available_sweeteners)
        return f"How would you like your {coffee_type} sweetened? ({sweetener_options})"
    
    def _handle_awaiting_sweetener(self, phone, message, state):
        """Handle sweetener selection"""
        # Get data from state
        temp_data = state.get('temp_data', {})
        name = temp_data.get('name', '')
        order_details = temp_data.get('order_details', {})
        
        # Use NLP to parse sweetener preference if available
        sweetener = None
        if self.nlp:
            try:
                # Parse the message to extract sweetener
                parse_result = self.nlp.parse_order(message)
                if 'sugar' in parse_result:
                    sweetener = parse_result['sugar']
            except Exception as e:
                logger.error(f"Error parsing sweetener with NLP: {str(e)}")
        
        # Handle common "no sugar" responses
        if message.lower() in ['no', 'none', 'zero', '0', 'n', 'no sugar', 'without sugar']:
            sweetener = 'No Sugar'
        
        # If NLP didn't find a valid sweetener, use simple parsing
        if not sweetener:
            sweetener = self._parse_sweetener(message)
        
        # If still nothing, default to no sugar
        if not sweetener:
            sweetener = 'No Sugar'
        
        # Update order details
        order_details['sugar'] = sweetener
        
        # Format order summary using NLP if available
        if self.nlp:
            order_summary = self.nlp.format_order_summary(order_details)
        else:
            # Simple formatting
            size = order_details.get('size', '')
            coffee_type = order_details.get('type', 'coffee')
            milk = order_details.get('milk', '')
            
            order_summary = f"{size} {coffee_type}"
            if milk and milk != 'no milk':
                order_summary += f" with {milk} milk"
            if sweetener and sweetener.lower() != 'no sugar':
                order_summary += f", {sweetener}"
        
        # Update state and move to confirmation
        self._set_conversation_state(phone, 'awaiting_confirmation', {
            'name': name,
            'order_details': order_details
        })
        
        return (
            f"Great! Here's your order: {order_summary}\n"
            f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
        )
    
    def _handle_awaiting_confirmation(self, phone, message, state):
        """Handle order confirmation"""
        message_upper = message.upper().strip()
        
        # Get data from state
        temp_data = state.get('temp_data', {})
        name = temp_data.get('name', '')
        order_details = temp_data.get('order_details', {})
        
        # Use NLP to check if this is an affirmative response
        is_affirmative = False
        if self.nlp:
            try:
                is_affirmative = self.nlp.is_affirmative_response(message)
            except Exception as e:
                logger.error(f"Error checking affirmative response with NLP: {str(e)}")
        
        # If NLP didn't determine, check common responses
        if not is_affirmative:
            is_affirmative = message_upper in ['YES', 'Y', 'YEP', 'YEAH', 'CONFIRM', 'OK']
        
        if is_affirmative:
            # Check event schedule first
            is_open, schedule_message = self._check_event_schedule()
            
            if not is_open and not order_details.get('vip', False):
                # Stations closed for regular customers
                return schedule_message
            
            # Confirm the order
            result = self._process_order_confirmation(phone, order_details)
            
            if result.get('success'):
                # Offer option to order for a friend
                self._set_conversation_state(phone, 'completed', {
                    'last_order_number': result.get('order_number'),
                    'last_station_id': result.get('station_id')
                })
                
                base_message = result.get('message', '')
                return (
                    f"{base_message}\n\n"
                    f"Reply FRIEND to order for a friend, STATUS to check your order, "
                    f"or CANCEL if you need to cancel."
                )
            else:
                # Something went wrong
                return (
                    f"Sorry, we couldn't process your order: {result.get('error', 'Unknown error')}\n"
                    f"Please try again or visit the nearest coffee station."
                )
            
        elif message_upper in ['NO', 'N', 'CANCEL', 'NEVERMIND']:
            # Cancel the order
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return f"Order cancelled. What type of coffee would you like instead, {name}?"
            
        elif message_upper in ['EDIT', 'CHANGE', 'MODIFY']:
            # Allow editing the order - go back to coffee type
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return f"Let's change that order. What type of coffee would you like, {name}?"
            
        elif message_upper in ['FRIEND', 'ANOTHER']:
            # They want to order for a friend - but first confirm current order
            return (
                f"Please confirm your current order first (YES/NO), "
                f"then I can help you order for a friend."
            )
            
        else:
            # Unrecognized response - prompt again
            return "Please reply YES to confirm your order, NO to cancel, or EDIT to change it."
    
    def _process_order_confirmation(self, phone, order_details):
        """Process confirmed order"""
        try:
            # Generate order number
            now = datetime.now()
            prefix = "A" if now.hour < 12 else "P"
            order_number = f"{prefix}{now.strftime('%H%M%S')}{now.microsecond // 10000}"
            
            # Add customer name if missing
            if 'name' not in order_details:
                customer = self._get_customer(phone)
                if customer and customer.get('name'):
                    order_details['name'] = customer.get('name')
                else:
                    order_details['name'] = "Customer"
            
            name = order_details.get('name')
            
            # Check for existing station ID or assign a station
            station_id = order_details.get('station_id')
            is_vip = order_details.get('vip', False)
            milk_type = order_details.get('milk')
            
            if not station_id:
                # Assign a station based on preferences and load
                station_id, is_delayed = self._assign_station(is_vip, milk_type)
                order_details['station_id'] = station_id
                
                # Handle delayed orders
                if is_delayed:
                    order_details['delayed'] = True
                    order_details['scheduled_for_next_break'] = True
            
            # Priority for VIP orders
            queue_priority = 1 if is_vip else 5
            
            # Insert order into database
            cursor = self.db.cursor()
            cursor.execute("""
                INSERT INTO orders 
                (order_number, phone, order_details, status, station_id, created_at, updated_at, queue_priority)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                order_number,
                phone,
                json.dumps(order_details),
                'pending',
                station_id,
                now,
                now,
                queue_priority
            ))
            
            order_id = cursor.fetchone()[0]
            
            # Update station load
            cursor.execute("""
                INSERT INTO station_stats (station_id, current_load, last_updated)
                VALUES (%s, 1, %s)
                ON CONFLICT (station_id) DO UPDATE SET
                    current_load = station_stats.current_load + 1,
                    last_updated = %s
            """, (station_id, now, now))
            
            # Update or create customer preferences
            self._save_customer_preferences(phone, name, order_details)
            
            # Get estimated wait time
            wait_time = self._get_station_wait_time(station_id)
            
            # Format confirmation message
            confirmation_message = (
                f"Thank you, {name}! Your order #{order_number} has been confirmed and sent to Station {station_id}. "
                f"Approximate wait time: {wait_time} minutes. "
                f"We'll send you another message when it's ready."
            )
            
            # Check if order is delayed due to schedule
            if order_details.get('delayed'):
                confirmation_message += (
                    f" Note: Your order will be prepared during the next scheduled break."
                )
            
            # If this is a VIP order, acknowledge it
            if is_vip:
                confirmation_message += " Your order has been given VIP priority."
            
            # Add tracking URL if enabled
            enable_web_tracking = self._get_setting('enable_web_tracking', 'false').lower() in ('true', 'yes', '1')
            if enable_web_tracking:
                base_url = self._get_setting('web_tracking_url', 'https://coffee.example.com/track/')
                tracking_url = f"{base_url}?id={order_number}"
                confirmation_message += f"\n\nTrack your order here: {tracking_url}"
            
            # Commit transaction
            self.db.commit()
            
            return {
                "success": True,
                "order_id": order_id,
                "order_number": order_number,
                "station_id": station_id,
                "wait_time": wait_time,
                "message": confirmation_message
            }
        except Exception as e:
            logger.error(f"Error confirming order: {str(e)}")
            self.db.rollback()
            
            return {
                "success": False,
                "error": str(e)
            }
    
    def"""
Enhanced SMS Conversation Handler for Coffee Cue System with NLP Integration
"""
import logging
import json
import re
from datetime import datetime, timedelta

logger = logging.getLogger("expresso.services.sms_handler")

class SMSConversationHandler:
    def __init__(self, coffee_system, db, config):
        """
        Initialize the SMS conversation handler
        
        Args:
            coffee_system: Reference to the main coffee system
            db: Database connection
            config: Configuration dictionary
        """
        self.coffee_system = coffee_system
        self.db = db
        self.config = config
        self.event_name = config.get('EVENT_NAME', 'Coffee Event')
        
        # Initialize conversation states cache
        self.conversation_states = {}
        
        # Initialize NLP services
        try:
            from services.nlp import NLPService
            self.nlp = NLPService()
            logger.info("NLP service initialized")
        except ImportError:
            logger.warning("Could not import NLP service, using basic text parsing")
            self.nlp = None
            
        # Try to initialize advanced NLP service if available
        try:
            from services.advanced_nlp import DialogflowNLPService
            project_id = config.get('DIALOGFLOW_PROJECT_ID')
            api_key = config.get('DIALOGFLOW_API_KEY')
            if project_id and api_key:
                self.advanced_nlp = DialogflowNLPService(project_id, api_key)
                logger.info("Advanced NLP service initialized")
            else:
                self.advanced_nlp = None
        except ImportError:
            logger.info("Advanced NLP service not available")
            self.advanced_nlp = None
            
        # Load available coffee types, milk options, etc. from settings
        self._load_menu_options()
        
        logger.info("SMS Conversation Handler initialized")
    
    def _load_menu_options(self):
        """Load menu options from settings and inventory"""
        self.available_coffee_types = []
        self.available_milk_types = []
        self.available_sizes = []
        self.available_sweeteners = []
        
        try:
            cursor = self.db.cursor()
            
            # Check if stock_items table exists
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'stock_items'
                )
            """)
            
            has_stock_table = cursor.fetchone()[0]
            
            if has_stock_table:
                # Get active coffee types from stock
                cursor.execute("""
                    SELECT name FROM stock_items 
                    WHERE category = 'coffee_type' AND is_active = TRUE
                    ORDER BY name
                """)
                self.available_coffee_types = [row[0] for row in cursor.fetchall()]
                
                # Get active milk types
                cursor.execute("""
                    SELECT name FROM stock_items 
                    WHERE category = 'milk' AND is_active = TRUE
                    ORDER BY name
                """)
                self.available_milk_types = [row[0] for row in cursor.fetchall()]
                
                # Get sizes
                cursor.execute("""
                    SELECT name FROM stock_items 
                    WHERE category = 'size' AND is_active = TRUE
                    ORDER BY name
                """)
                self.available_sizes = [row[0] for row in cursor.fetchall()]
                
                # Get sweeteners
                cursor.execute("""
                    SELECT name FROM stock_items 
                    WHERE category = 'sweetener' AND is_active = TRUE
                    ORDER BY name
                """)
                self.available_sweeteners = [row[0] for row in cursor.fetchall()]
            
            # If no data in stock_items, use default values from settings
            if not self.available_coffee_types:
                # Try to get from settings
                cursor.execute("SELECT value FROM settings WHERE key = 'available_coffee_types'")
                result = cursor.fetchone()
                if result and result[0]:
                    self.available_coffee_types = json.loads(result[0])
                else:
                    # Default fallback
                    self.available_coffee_types = [
                        "Latte", "Cappuccino", "Flat White", "Long Black", 
                        "Espresso", "Mocha", "Hot Chocolate", "Chai Latte"
                    ]
            
            if not self.available_milk_types:
                cursor.execute("SELECT value FROM settings WHERE key = 'available_milk_types'")
                result = cursor.fetchone()
                if result and result[0]:
                    self.available_milk_types = json.loads(result[0])
                else:
                    self.available_milk_types = [
                        "Full Cream", "Skim", "Soy", "Almond", "Oat", "Lactose Free"
                    ]
            
            if not self.available_sizes:
                cursor.execute("SELECT value FROM settings WHERE key = 'available_sizes'")
                result = cursor.fetchone()
                if result and result[0]:
                    self.available_sizes = json.loads(result[0])
                else:
                    self.available_sizes = ["Small", "Medium", "Large"]
            
            if not self.available_sweeteners:
                cursor.execute("SELECT value FROM settings WHERE key = 'available_sweeteners'")
                result = cursor.fetchone()
                if result and result[0]:
                    self.available_sweeteners = json.loads(result[0])
                else:
                    self.available_sweeteners = ["Sugar", "No Sugar", "Honey", "Stevia", "Equal"]
            
            logger.info(f"Loaded menu options - {len(self.available_coffee_types)} coffee types, {len(self.available_milk_types)} milk types")
            
        except Exception as e:
            logger.error(f"Error loading menu options: {str(e)}")
            # Use defaults if loading fails
            self.available_coffee_types = ["Latte", "Cappuccino", "Flat White", "Long Black", "Espresso"]
            self.available_milk_types = ["Full Cream", "Skim", "Soy", "Almond", "Oat"]
            self.available_sizes = ["Small", "Medium", "Large"]
            self.available_sweeteners = ["Sugar", "No Sugar", "Honey", "Stevia", "Equal"]
    
    def handle_sms(self, phone_number, message_text, messaging_service=None):
        """
        Process incoming SMS and generate appropriate response
        
        Args:
            phone_number: Sender's phone number
            message_text: SMS message content
            messaging_service: Optional messaging service for sending responses
            
        Returns:
            Response message to send back
        """
        # Normalize phone number
        phone = self._normalize_phone(phone_number)
        
        # Log incoming message
        logger.info(f"Processing SMS from {phone}: {message_text}")
        
        # Try advanced NLP processing first if available
        complete_order = None
        if self.advanced_nlp:
            try:
                nlp_result = self.advanced_nlp.detect_intent(message_text, session_id=phone)
                if nlp_result and nlp_result.get('intent') and nlp_result.get('intent').startswith('order.'):
                    order_details = nlp_result.get('order_details', {})
                    if self.advanced_nlp.local_nlp.is_complete_order(order_details):
                        complete_order = order_details
                        logger.info(f"Advanced NLP detected complete order: {json.dumps(complete_order)}")
            except Exception as e:
                logger.error(f"Error in advanced NLP processing: {str(e)}")
        
        # If no advanced result, try regular NLP
        if not complete_order and self.nlp:
            try:
                order_details = self.nlp.parse_order(message_text)
                if self.nlp.is_complete_order(order_details):
                    complete_order = order_details
                    logger.info(f"Regular NLP detected complete order: {json.dumps(complete_order)}")
            except Exception as e:
                logger.error(f"Error in regular NLP processing: {str(e)}")
        
        # Extract station ID if present in the message
        station_id = self._extract_station_id(message_text)
        if station_id and complete_order:
            complete_order['station_id'] = station_id
        
        # Get current conversation state
        state = self._get_conversation_state(phone)
        
        # Check for special commands (STATUS, CANCEL, MENU, etc.)
        if command_response := self._handle_commands(phone, message_text, state):
            return command_response
            
        # If we have a complete order from NLP and the user is in a waiting state or has no state,
        # we can fast-track to confirmation
        if complete_order and (not state.get('state') or state.get('state') in [
            'awaiting_name', 'awaiting_coffee_type', 'awaiting_milk', 'awaiting_size', 'awaiting_sweetener'
        ]):
            # Get customer info to add name
            customer = self._get_customer(phone)
            if customer and customer.get('name'):
                complete_order['name'] = customer.get('name')
                
                # Update state to confirmation with the complete order
                self._set_conversation_state(phone, 'awaiting_confirmation', {
                    'name': customer.get('name'),
                    'order_details': complete_order
                })
                
                # Format order summary
                order_summary = self.nlp.format_order_summary(complete_order) if self.nlp else self._format_order_summary(complete_order)
                
                return (
                    f"Thanks {customer.get('name')}! I understood your order: {order_summary}\n"
                    f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
                )
            elif complete_order.get('name'):
                # NLP extracted a name - use it
                name = complete_order.get('name')
                
                # Update state to confirmation
                self._set_conversation_state(phone, 'awaiting_confirmation', {
                    'name': name,
                    'order_details': complete_order
                })
                
                # Format order summary
                order_summary = self.nlp.format_order_summary(complete_order) if self.nlp else self._format_order_summary(complete_order)
                
                return (
                    f"Thanks! I understood your order: {order_summary}\n"
                    f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
                )
            else:
                # We need a name first
                self._set_conversation_state(phone, 'awaiting_name', {
                    'pending_order': complete_order
                })
                
                # Get welcome message from settings or use default
                welcome_message = self._get_setting('sms_welcome_message', 
                    f"Welcome to {self.event_name}! I understood your coffee order, but I need your name first. What's your first name?")
                
                # Replace event_name placeholder if present
                return welcome_message.replace('{event_name}', self.event_name)
        
        # Process based on current conversation state
        current_state = state.get('state')
        
        if current_state == 'awaiting_name':
            return self._handle_awaiting_name(phone, message_text, state)
        elif current_state == 'awaiting_coffee_type':
            return self._handle_awaiting_coffee_type(phone, message_text, state, station_id)
        elif current_state == 'awaiting_milk':
            return self._handle_awaiting_milk(phone, message_text, state)
        elif current_state == 'awaiting_size':
            return self._handle_awaiting_size(phone, message_text, state)
        elif current_state == 'awaiting_sweetener':
            return self._handle_awaiting_sweetener(phone, message_text, state)
        elif current_state == 'awaiting_confirmation':
            return self._handle_awaiting_confirmation(phone, message_text, state)
        elif current_state == 'awaiting_friend_name':
            return self._handle_awaiting_friend_name(phone, message_text, state)
        elif current_state == 'awaiting_friend_coffee_type':
            return self._handle_awaiting_friend_coffee_type(phone, message_text, state)
        elif current_state == 'awaiting_friend_milk':
            return self._handle_awaiting_friend_milk(phone, message_text, state)
        elif current_state == 'awaiting_friend_size':
            return self._handle_awaiting_friend_size(phone, message_text, state)
        elif current_state == 'awaiting_friend_sweetener':
            return self._handle_awaiting_friend_sweetener(phone, message_text, state)
        elif current_state == 'awaiting_friend_confirmation':
            return self._handle_awaiting_friend_confirmation(phone, message_text, state)
        
        # New conversation or unknown state, start from beginning
        # First check if this is a returning customer
        customer = self._get_customer(phone)
        
        if customer and customer.get('name'):
            # Welcome back returning customer
            return self._welcome_returning_customer(phone, customer, message_text)
        else:
            # New customer - welcome and ask for name
            return self._welcome_new_customer(phone)
    
    def _normalize_phone(self, phone):
        """Normalize phone number format"""
        # Remove any non-digit characters
        digits = re.sub(r'\D', '', phone)
        
        # For Australian numbers, ensure they start with +61
        if digits.startswith('0'):
            return '+61' + digits[1:]
        elif not digits.startswith('+'):
            return '+' + digits
        
        return phone
    
    def _extract_station_id(self, message):
        """Extract station ID from message if present"""
        station_pattern = r'(?:(?:for|to|at)\s+)?(?:station|st|station\s*id|station\s*\#)[^0-9]*([0-9]+)'
        match = re.search(station_pattern, message.lower())
        
        if match:
            try:
                return int(match.group(1))
            except (ValueError, TypeError):
                logger.warning(f"Invalid station number format detected in message: '{message}'")
        
        # Additional common patterns
        if "station 1" in message.lower() or "station one" in message.lower():
            return 1
        elif "station 2" in message.lower() or "station two" in message.lower():
            return 2
        elif "station 3" in message.lower() or "station three" in message.lower():
            return 3
            
        return None
    
    def _get_customer(self, phone):
        """Get customer information from database"""
        try:
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT phone, name, preferred_drink, preferred_milk, 
                       preferred_size, preferred_sugar, is_vip,
                       first_order_date, last_order_date, total_orders
                FROM customer_preferences
                WHERE phone = %s
            """, (phone,))
            
            result = cursor.fetchone()
            
            if not result:
                return None
                
            # Format as dictionary
            customer = {
                'phone': result[0],
                'name': result[1],
                'preferred_drink': result[2],
                'preferred_milk': result[3],
                'preferred_size': result[4],
                'preferred_sugar': result[5],
                'is_vip': bool(result[6]),
                'first_order_date': result[7],
                'last_order_date': result[8],
                'total_orders': result[9] or 0
            }
            
            return customer
            
        except Exception as e:
            logger.error(f"Error getting customer: {str(e)}")
            return None
    
    def _welcome_returning_customer(self, phone, customer, message):
        """Welcome returning customer with personalized message"""
        name = customer.get('name')
        
        # Use NLP to check if message is asking for the usual order
        if self.nlp and self.nlp.is_asking_for_usual(message):
            return self._process_usual_order(phone, name)
            
        # Try to parse the message using NLP
        order_details = None
        if self.nlp:
            try:
                order_details = self.nlp.parse_order(message)
                # Check if this is a complete order
                if order_details and self.nlp.is_complete_order(order_details):
                    # Add the name to order details
                    order_details['name'] = name
                    
                    # Update the state to confirmation
                    self._set_conversation_state(phone, 'awaiting_confirmation', {
                        'name': name,
                        'order_details': order_details
                    })
                    
                    # Format order summary
                    order_summary = self.nlp.format_order_summary(order_details)
                    
                    return (
                        f"Welcome back, {name}! I understood your order: {order_summary}\n"
                        f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
                    )
            except Exception as e:
                logger.error(f"Error parsing message with NLP: {str(e)}")
        
        # If we don't have a complete order, check if we have preference data to make suggestions
        if customer.get('preferred_drink') and customer.get('preferred_milk'):
            # They have a preferred order - suggest it
            drink = customer.get('preferred_drink')
            milk = customer.get('preferred_milk')
            size = customer.get('preferred_size', 'Medium')
            
            # Save conversation state with suggestion context
            self._set_conversation_state(phone, 'awaiting_coffee_type', {
                'name': name,
                'suggestion_context': 'usual_order'
            })
            
            # Format suggestion message
            return (
                f"Welcome back, {name}! Would you like your usual {size} {drink} with {milk}? "
                f"Reply YES or tell me what you'd like to order instead."
            )
        else:
            # We know their name but no preference data
            total_orders = customer.get('total_orders', 0)
            
            if total_orders > 0:
                # They've ordered before but we don't have specific preferences
                self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
                return f"Welcome back, {name}! What coffee would you like today?"
            else:
                # First time ordering despite having a record
                self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
                return f"Welcome back, {name}! What coffee would you like to order from {self.event_name}?"
    
    def _welcome_new_customer(self, phone):
        """Welcome new customer and start conversation"""
        self._set_conversation_state(phone, 'awaiting_name')
        
        # Get welcome message from settings or use default
        welcome_message = self._get_setting('sms_welcome_message', 
            f"Welcome to {self.event_name}! I'll take your coffee order. What's your first name?")
        
        # Replace event_name placeholder if present
        return welcome_message.replace('{event_name}', self.event_name)
    
    def _handle_commands(self, phone, message, state):
        """Handle special commands like STATUS, CANCEL, INFO, etc."""
        message_upper = message.upper().strip()
        
        # Check for common commands
        if message_upper == 'STATUS':
            return self._handle_status_command(phone)
        elif message_upper in ['CANCEL', 'CANCELORDER']:
            return self._handle_cancel_command(phone)
        elif message_upper in ['INFO', '?']:
            return self._handle_info_command()
        elif message_upper in ['MENU', 'OPTIONS']:
            return self._handle_menu_command()
        elif message_upper == 'USUAL':
            return self._process_usual_order(phone)
        elif message_upper == 'FRIEND':
            return self._start_friend_order(phone, state)
        elif self._is_vip_code(message_upper):
            return self._handle_vip_code(phone, message_upper)
            
        # No command recognized
        return None
    
    def _handle_status_command(self, phone):
        """Handle STATUS command - check order status"""
        try:
            # Get most recent active order
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT id, order_number, status, created_at, station_id, order_details
                FROM orders 
                WHERE phone = %s AND status IN ('pending', 'in-progress', 'completed') 
                ORDER BY created_at DESC 
                LIMIT 1
            """, (phone,))
            
            result = cursor.fetchone()
            
            if not result:
                return "You don't have any active orders. Text your coffee selection to get started!"
            
            order_id, order_number, status, created_at, station_id, order_details_json = result
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json or {}
                
            # Get customer name
            name = order_details.get('name', 'Customer')
            
            # Format coffee order summary using NLP service if available
            if self.nlp:
                order_summary = self.nlp.format_order_summary(order_details)
            else:
                # Fallback formatting if NLP not available
                coffee_type = order_details.get('type', 'coffee')
                milk = order_details.get('milk', '')
                size = order_details.get('size', '')
                
                order_summary = f"{size} {coffee_type}"
                if milk and milk != "no milk":
                    order_summary += f" with {milk}"
            
            # Calculate wait time
            current_time = datetime.now()
            wait_time_minutes = int((current_time - created_at).total_seconds() / 60)
            
            # Build the status response based on order status
            if status == 'pending':
                # Get station estimated wait time
                cursor.execute("SELECT wait_time FROM station_stats WHERE station_id = %s", (station_id,))
                station_result = cursor.fetchone()
                
                estimated_wait = station_result[0] if station_result else 15
                time_left = max(0, estimated_wait - wait_time_minutes)
                
                return (
                    f"Your order #{order_number} ({order_summary}) is pending at Station {station_id}. "
                    f"You've been waiting {wait_time_minutes} minutes. "
                    f"Estimated completion in {time_left} more minutes."
                )
            elif status == 'in-progress':
                return (
                    f"Your order #{order_number} ({order_summary}) is being made at Station {station_id}. "
                    f"You've been waiting {wait_time_minutes} minutes."
                )
            elif status == 'completed':
                return (
                    f"Your order #{order_number} ({order_summary}) is ready for pickup at Station {station_id}!"
                )
            else:
                return f"Your order #{order_number} ({order_summary}) is {status} at Station {station_id}."
            
        except Exception as e:
            logger.error(f"Error processing STATUS command: {str(e)}")
            return "Sorry, we couldn't retrieve your order status. Please try again later."
    
    def _handle_cancel_command(self, phone):
        """Handle CANCEL command - cancel the most recent order"""
        try:
            # Get most recent pending order
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT id, order_number, station_id
                FROM orders 
                WHERE phone = %s AND status = 'pending' 
                ORDER BY created_at DESC 
                LIMIT 1
            """, (phone,))
            
            result = cursor.fetchone()
            
            if not result:
                return "You don't have any pending orders to cancel."
            
            order_id, order_number, station_id = result
            
            # Update order status to cancelled
            cursor.execute("""
                UPDATE orders 
                SET status = 'cancelled', updated_at = %s 
                WHERE id = %s
            """, (datetime.now(), order_id))
            
            # Update station load
            cursor.execute("""
                UPDATE station_stats
                SET current_load = GREATEST(0, current_load - 1), last_updated = %s
                WHERE station_id = %s
            """, (datetime.now(), station_id))
            
            self.db.commit()
            
            # Reset conversation state
            self._set_conversation_state(phone, 'completed')
            
            return f"Your order #{order_number} has been cancelled. Text us when you'd like to place a new order."
            
        except Exception as e:
            logger.error(f"Error cancelling order: {str(e)}")
            return "Sorry, we couldn't cancel your order. Please try again or contact the coffee station directly."
    
    def _handle_info_command(self):
        """Handle INFO command - provide instructions"""
        return (
            "Coffee Ordering Help:\n"
            "- Text your coffee order (e.g., 'large latte with oat milk')\n"
            "- STATUS: Check your order status\n"
            "- CANCEL: Cancel your pending order\n"
            "- MENU: See available coffee options\n"
            "- USUAL: Order your usual coffee\n"
            "- FRIEND: Order coffee for a friend\n"
            "Need more help? Visit any coffee station."
        )
    
    def _handle_menu_command(self):
        """Handle MENU command - show coffee options"""
        # Format menu categories for display
        coffee_types = ", ".join(self.available_coffee_types[:5]) + (
            f" and {len(self.available_coffee_types) - 5} more..." if len(self.available_coffee_types) > 5 else ""
        )
        
        milk_types = ", ".join(self.available_milk_types)
        sizes = ", ".join(self.available_sizes)
        sweeteners = ", ".join(self.available_sweeteners)
        
        return (
            "Coffee Menu:\n"
            f"Types: {coffee_types}\n"
            f"Milk: {milk_types}\n"
            f"Size: {sizes}\n"
            f"Sweeteners: {sweeteners}\n"
            "Simply text your order, e.g. 'Large cappuccino with soy milk'"
        )
    
    def _process_usual_order(self, phone, name=None):
        """Process a request for the usual order"""
        # Get customer information if name not provided
        if not name:
            customer = self._get_customer(phone)
            if customer:
                name = customer.get('name')
            
            # If still no name, we need to ask for it
            if not name:
                self._set_conversation_state(phone, 'awaiting_name')
                return "I don't have your name yet. What's your first name?"
        
        # Get usual order from customer preferences
        try:
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT preferred_drink, preferred_milk, preferred_size, preferred_sugar
                FROM customer_preferences
                WHERE phone = %s
            """, (phone,))
            
            result = cursor.fetchone()
            
            if result and result[0]:
                # We have preference data
                drink, milk, size, sugar = result
                
                # Create order details
                order_details = {
                    'name': name,
                    'type': drink,
                    'milk': milk,
                    'size': size,
                    'sugar': sugar
                }
                
                # Set conversation state to confirmation
                self._set_conversation_state(phone, 'awaiting_confirmation', {
                    'name': name,
                    'order_details': order_details,
                    'order_type': 'usual'
                })
                
                # Format summary using NLP if available or fallback to simple formatting
                if self.nlp:
                    order_summary = self.nlp.format_order_summary(order_details)
                else:
                    order_summary = f"{size} {drink} with {milk}, {sugar or 'no sugar'}"
                
                return (
                    f"Great, {name}! Here's your usual order: {order_summary}\n"
                    f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
                )
            else:
                # No usual order found
                self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
                return f"I don't have a saved usual order for you yet. What type of coffee would you like, {name}?"
                
        except Exception as e:
            logger.error(f"Error fetching usual order: {str(e)}")
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return f"What type of coffee would you like, {name}?"
    
    def _is_vip_code(self, code):
        """Check if this is a valid VIP code"""
        try:
            # Check for default VIP code from settings
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = 'vip_code'")
            result = cursor.fetchone()
            
            if result and (code == result[0] or code == 'VIP'):
                return True
                
            # Also check for custom VIP codes from multiple code settings
            cursor.execute("SELECT value FROM settings WHERE key = 'vip_codes'")
            result = cursor.fetchone()
            
            if result:
                try:
                    vip_codes = json.loads(result[0])
                    
                    if isinstance(vip_codes, list):
                        # Check if the provided code matches any enabled VIP code
                        for vip_code_entry in vip_codes:
                            if (vip_code_entry.get('enabled', True) and 
                                vip_code_entry.get('code') and 
                                code.upper() == vip_code_entry['code'].upper()):
                                logger.info(f"Matched custom VIP code: {code}")
                                return True
                except (json.JSONDecodeError, TypeError, KeyError) as e:
                    logger.error(f"Error parsing VIP codes: {str(e)}")
            
            return False
            
        except Exception as e:
            logger.error(f"Error checking VIP code: {str(e)}")
            return False
    
    def _handle_vip_code(self, phone, code):
        """Handle VIP code entry"""
        try:
            # Get customer info
            customer = self._get_customer(phone)
            name = customer.get('name', '') if customer else ''
            
            # If we don't have a name, we'll need to ask for it
            if not name:
                self._set_conversation_state(phone, 'awaiting_name', {'vip': True, 'vip_code': code})
                return "To activate VIP status,"""
Enhanced SMS Conversation Handler for Coffee Cue System
"""
import logging
import json
import re
from datetime import datetime, timedelta

logger = logging.getLogger("expresso.services.sms_handler")

class SMSConversationHandler:
    def __init__(self, coffee_system, db, config):
        """
        Initialize the SMS conversation handler
        
        Args:
            coffee_system: Reference to the main coffee system
            db: Database connection
            config: Configuration dictionary
        """
        self.coffee_system = coffee_system
        self.db = db
        self.config = config
        self.event_name = config.get('EVENT_NAME', 'Coffee Event')
        
        # Initialize conversation states cache
        self.conversation_states = {}
        
        # Load available coffee types, milk options, etc. from settings
        self._load_menu_options()
        
        logger.info("SMS Conversation Handler initialized")
    
    def _load_menu_options(self):
        """Load menu options from settings and inventory"""
        self.available_coffee_types = []
        self.available_milk_types = []
        self.available_sizes = []
        self.available_sweeteners = []
        
        try:
            cursor = self.db.cursor()
            
            # Check if stock_items table exists
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'stock_items'
                )
            """)
            
            has_stock_table = cursor.fetchone()[0]
            
            if has_stock_table:
                # Get active coffee types from stock
                cursor.execute("""
                    SELECT name FROM stock_items 
                    WHERE category = 'coffee_type' AND is_active = TRUE
                    ORDER BY name
                """)
                self.available_coffee_types = [row[0] for row in cursor.fetchall()]
                
                # Get active milk types
                cursor.execute("""
                    SELECT name FROM stock_items 
                    WHERE category = 'milk' AND is_active = TRUE
                    ORDER BY name
                """)
                self.available_milk_types = [row[0] for row in cursor.fetchall()]
                
                # Get sizes
                cursor.execute("""
                    SELECT name FROM stock_items 
                    WHERE category = 'size' AND is_active = TRUE
                    ORDER BY name
                """)
                self.available_sizes = [row[0] for row in cursor.fetchall()]
                
                # Get sweeteners
                cursor.execute("""
                    SELECT name FROM stock_items 
                    WHERE category = 'sweetener' AND is_active = TRUE
                    ORDER BY name
                """)
                self.available_sweeteners = [row[0] for row in cursor.fetchall()]
            
            # If no data in stock_items, use default values from settings
            if not self.available_coffee_types:
                # Try to get from settings
                cursor.execute("SELECT value FROM settings WHERE key = 'available_coffee_types'")
                result = cursor.fetchone()
                if result and result[0]:
                    self.available_coffee_types = json.loads(result[0])
                else:
                    # Default fallback
                    self.available_coffee_types = [
                        "Latte", "Cappuccino", "Flat White", "Long Black", 
                        "Espresso", "Mocha", "Hot Chocolate", "Chai Latte"
                    ]
            
            if not self.available_milk_types:
                cursor.execute("SELECT value FROM settings WHERE key = 'available_milk_types'")
                result = cursor.fetchone()
                if result and result[0]:
                    self.available_milk_types = json.loads(result[0])
                else:
                    self.available_milk_types = [
                        "Full Cream", "Skim", "Soy", "Almond", "Oat", "Lactose Free"
                    ]
            
            if not self.available_sizes:
                cursor.execute("SELECT value FROM settings WHERE key = 'available_sizes'")
                result = cursor.fetchone()
                if result and result[0]:
                    self.available_sizes = json.loads(result[0])
                else:
                    self.available_sizes = ["Small", "Medium", "Large"]
            
            if not self.available_sweeteners:
                cursor.execute("SELECT value FROM settings WHERE key = 'available_sweeteners'")
                result = cursor.fetchone()
                if result and result[0]:
                    self.available_sweeteners = json.loads(result[0])
                else:
                    self.available_sweeteners = ["Sugar", "No Sugar", "Honey", "Stevia", "Equal"]
            
            logger.info(f"Loaded menu options - {len(self.available_coffee_types)} coffee types, {len(self.available_milk_types)} milk types")
            
        except Exception as e:
            logger.error(f"Error loading menu options: {str(e)}")
            # Use defaults if loading fails
            self.available_coffee_types = ["Latte", "Cappuccino", "Flat White", "Long Black", "Espresso"]
            self.available_milk_types = ["Full Cream", "Skim", "Soy", "Almond", "Oat"]
            self.available_sizes = ["Small", "Medium", "Large"]
            self.available_sweeteners = ["Sugar", "No Sugar", "Honey", "Stevia", "Equal"]
    
    def handle_sms(self, phone_number, message_text, messaging_service=None):
        """
        Process incoming SMS and generate appropriate response
        
        Args:
            phone_number: Sender's phone number
            message_text: SMS message content
            messaging_service: Optional messaging service for sending responses
            
        Returns:
            Response message to send back
        """
        # Normalize phone number
        phone = self._normalize_phone(phone_number)
        
        # Log incoming message
        logger.info(f"Processing SMS from {phone}: {message_text}")
        
        # Extract station ID if present in the message
        station_id = self._extract_station_id(message_text)
        
        # Get current conversation state
        state = self._get_conversation_state(phone)
        
        # Check for special commands (STATUS, CANCEL, MENU, etc.)
        if command_response := self._handle_commands(phone, message_text, state):
            return command_response
            
        # Process based on current conversation state
        current_state = state.get('state')
        
        if current_state == 'awaiting_name':
            return self._handle_awaiting_name(phone, message_text, state)
        elif current_state == 'awaiting_coffee_type':
            return self._handle_awaiting_coffee_type(phone, message_text, state, station_id)
        elif current_state == 'awaiting_milk':
            return self._handle_awaiting_milk(phone, message_text, state)
        elif current_state == 'awaiting_size':
            return self._handle_awaiting_size(phone, message_text, state)
        elif current_state == 'awaiting_sweetener':
            return self._handle_awaiting_sweetener(phone, message_text, state)
        elif current_state == 'awaiting_confirmation':
            return self._handle_awaiting_confirmation(phone, message_text, state)
        elif current_state == 'awaiting_friend_name':
            return self._handle_awaiting_friend_name(phone, message_text, state)
        elif current_state == 'awaiting_friend_coffee_type':
            return self._handle_awaiting_friend_coffee_type(phone, message_text, state)
        # Additional states for friend ordering flow...
        
        # New conversation or unknown state, start from beginning
        # First check if this is a returning customer
        customer = self._get_customer(phone)
        
        if customer and customer.get('name'):
            # Welcome back returning customer
            return self._welcome_returning_customer(phone, customer, message_text)
        else:
            # New customer - welcome and ask for name
            return self._welcome_new_customer(phone)
    
    def _normalize_phone(self, phone):
        """Normalize phone number format"""
        # Remove any non-digit characters
        digits = re.sub(r'\D', '', phone)
        
        # For Australian numbers, ensure they start with +61
        if digits.startswith('0'):
            return '+61' + digits[1:]
        elif not digits.startswith('+'):
            return '+' + digits
        
        return phone
    
    def _extract_station_id(self, message):
        """Extract station ID from message if present"""
        station_pattern = r'(?:(?:for|to|at)\s+)?(?:station|st|station\s*id|station\s*\#)[^0-9]*([0-9]+)'
        match = re.search(station_pattern, message.lower())
        
        if match:
            try:
                return int(match.group(1))
            except (ValueError, TypeError):
                logger.warning(f"Invalid station number format detected in message: '{message}'")
        
        # Additional common patterns
        if "station 1" in message.lower() or "station one" in message.lower():
            return 1
        elif "station 2" in message.lower() or "station two" in message.lower():
            return 2
        elif "station 3" in message.lower() or "station three" in message.lower():
            return 3
            
        return None
    
    def _get_customer(self, phone):
        """Get customer information from database"""
        try:
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT phone, name, preferred_drink, preferred_milk, 
                       preferred_size, preferred_sugar, is_vip,
                       first_order_date, last_order_date, total_orders
                FROM customer_preferences
                WHERE phone = %s
            """, (phone,))
            
            result = cursor.fetchone()
            
            if not result:
                return None
                
            # Format as dictionary
            customer = {
                'phone': result[0],
                'name': result[1],
                'preferred_drink': result[2],
                'preferred_milk': result[3],
                'preferred_size': result[4],
                'preferred_sugar': result[5],
                'is_vip': bool(result[6]),
                'first_order_date': result[7],
                'last_order_date': result[8],
                'total_orders': result[9] or 0
            }
            
            return customer
            
        except Exception as e:
            logger.error(f"Error getting customer: {str(e)}")
            return None
    
    def _welcome_returning_customer(self, phone, customer, message):
        """Welcome returning customer with personalized message"""
        name = customer.get('name')
        
        # Check if customer message hints at ordering their usual
        usual_keywords = ['usual', 'same', 'regular', 'normal', 'standard', 'always']
        if any(keyword in message.lower() for keyword in usual_keywords):
            return self._process_usual_order(phone, name)
        
        # Check if we have preference data to make suggestions
        if customer.get('preferred_drink') and customer.get('preferred_milk'):
            # They have a preferred order - suggest it
            drink = customer.get('preferred_drink')
            milk = customer.get('preferred_milk')
            size = customer.get('preferred_size', 'Medium')
            
            # Save conversation state with suggestion context
            self._set_conversation_state(phone, 'awaiting_coffee_type', {
                'name': name,
                'suggestion_context': 'usual_order'
            })
            
            # Format suggestion message
            return (
                f"Welcome back, {name}! Would you like your usual {size} {drink} with {milk}? "
                f"Reply YES or tell me what you'd like to order instead."
            )
        else:
            # We know their name but no preference data
            total_orders = customer.get('total_orders', 0)
            
            if total_orders > 0:
                # They've ordered before but we don't have specific preferences
                self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
                return f"Welcome back, {name}! What coffee would you like today?"
            else:
                # First time ordering despite having a record
                self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
                return f"Welcome back, {name}! What coffee would you like to order from {self.event_name}?"
    
    def _welcome_new_customer(self, phone):
        """Welcome new customer and start conversation"""
        self._set_conversation_state(phone, 'awaiting_name')
        
        # Get welcome message from settings or use default
        welcome_message = self._get_setting('sms_welcome_message', 
            f"Welcome to {self.event_name}! I'll take your coffee order. What's your first name?")
        
        # Replace event_name placeholder if present
        return welcome_message.replace('{event_name}', self.event_name)
    
    def _handle_commands(self, phone, message, state):
        """Handle special commands like STATUS, CANCEL, INFO, etc."""
        message_upper = message.upper().strip()
        
        # Check for common commands
        if message_upper == 'STATUS':
            return self._handle_status_command(phone)
        elif message_upper in ['CANCEL', 'CANCELORDER']:
            return self._handle_cancel_command(phone)
        elif message_upper in ['INFO', '?']:
            return self._handle_info_command()
        elif message_upper in ['MENU', 'OPTIONS']:
            return self._handle_menu_command()
        elif message_upper == 'USUAL':
            return self._process_usual_order(phone)
        elif message_upper == 'FRIEND':
            return self._start_friend_order(phone, state)
        elif self._is_vip_code(message_upper):
            return self._handle_vip_code(phone, message_upper)
            
        # No command recognized
        return None
    
    def _handle_status_command(self, phone):
        """Handle STATUS command - check order status"""
        try:
            # Get most recent active order
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT id, order_number, status, created_at, station_id, order_details
                FROM orders 
                WHERE phone = %s AND status IN ('pending', 'in-progress', 'completed') 
                ORDER BY created_at DESC 
                LIMIT 1
            """, (phone,))
            
            result = cursor.fetchone()
            
            if not result:
                return "You don't have any active orders. Text your coffee selection to get started!"
            
            order_id, order_number, status, created_at, station_id, order_details_json = result
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json or {}
                
            # Get customer name
            name = order_details.get('name', 'Customer')
            
            # Format coffee order summary
            coffee_type = order_details.get('type', 'coffee')
            milk = order_details.get('milk', '')
            size = order_details.get('size', '')
            
            order_summary = f"{size} {coffee_type}"
            if milk and milk != "no milk":
                order_summary += f" with {milk}"
            
            # Calculate wait time
            current_time = datetime.now()
            wait_time_minutes = int((current_time - created_at).total_seconds() / 60)
            
            # Build the status response based on order status
            if status == 'pending':
                # Get station estimated wait time
                cursor.execute("SELECT wait_time FROM station_stats WHERE station_id = %s", (station_id,))
                station_result = cursor.fetchone()
                
                estimated_wait = station_result[0] if station_result else 15
                time_left = max(0, estimated_wait - wait_time_minutes)
                
                return (
                    f"Your order #{order_number} ({order_summary}) is pending at Station {station_id}. "
                    f"You've been waiting {wait_time_minutes} minutes. "
                    f"Estimated completion in {time_left} more minutes."
                )
            elif status == 'in-progress':
                return (
                    f"Your order #{order_number} ({order_summary}) is being made at Station {station_id}. "
                    f"You've been waiting {wait_time_minutes} minutes."
                )
            elif status == 'completed':
                return (
                    f"Your order #{order_number} ({order_summary}) is ready for pickup at Station {station_id}!"
                )
            else:
                return f"Your order #{order_number} ({order_summary}) is {status} at Station {station_id}."
            
        except Exception as e:
            logger.error(f"Error processing STATUS command: {str(e)}")
            return "Sorry, we couldn't retrieve your order status. Please try again later."
    
    def _handle_cancel_command(self, phone):
        """Handle CANCEL command - cancel the most recent order"""
        try:
            # Get most recent pending order
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT id, order_number, station_id
                FROM orders 
                WHERE phone = %s AND status = 'pending' 
                ORDER BY created_at DESC 
                LIMIT 1
            """, (phone,))
            
            result = cursor.fetchone()
            
            if not result:
                return "You don't have any pending orders to cancel."
            
            order_id, order_number, station_id = result
            
            # Update order status to cancelled
            cursor.execute("""
                UPDATE orders 
                SET status = 'cancelled', updated_at = %s 
                WHERE id = %s
            """, (datetime.now(), order_id))
            
            # Update station load
            cursor.execute("""
                UPDATE station_stats
                SET current_load = GREATEST(0, current_load - 1), last_updated = %s
                WHERE station_id = %s
            """, (datetime.now(), station_id))
            
            self.db.commit()
            
            # Reset conversation state
            self._set_conversation_state(phone, 'completed')
            
            return f"Your order #{order_number} has been cancelled. Text us when you'd like to place a new order."
            
        except Exception as e:
            logger.error(f"Error cancelling order: {str(e)}")
            return "Sorry, we couldn't cancel your order. Please try again or contact the coffee station directly."
    
    def _handle_info_command(self):
        """Handle INFO command - provide instructions"""
        return (
            "Coffee Ordering Help:\n"
            "- Text your coffee order (e.g., 'large latte with oat milk')\n"
            "- STATUS: Check your order status\n"
            "- CANCEL: Cancel your pending order\n"
            "- MENU: See available coffee options\n"
            "- USUAL: Order your usual coffee\n"
            "- FRIEND: Order coffee for a friend\n"
            "Need more help? Visit any coffee station."
        )
    
    def _handle_menu_command(self):
        """Handle MENU command - show coffee options"""
        # Format menu categories for display
        coffee_types = ", ".join(self.available_coffee_types[:5]) + (
            f" and {len(self.available_coffee_types) - 5} more..." if len(self.available_coffee_types) > 5 else ""
        )
        
        milk_types = ", ".join(self.available_milk_types)
        sizes = ", ".join(self.available_sizes)
        sweeteners = ", ".join(self.available_sweeteners)
        
        return (
            "Coffee Menu:\n"
            f"Types: {coffee_types}\n"
            f"Milk: {milk_types}\n"
            f"Size: {sizes}\n"
            f"Sweeteners: {sweeteners}\n"
            "Simply text your order, e.g. 'Large cappuccino with soy milk'"
        )
    
    def _process_usual_order(self, phone, name=None):
        """Process a request for the usual order"""
        # Get customer information if name not provided
        if not name:
            customer = self._get_customer(phone)
            if customer:
                name = customer.get('name')
            
            # If still no name, we need to ask for it
            if not name:
                self._set_conversation_state(phone, 'awaiting_name')
                return "I don't have your name yet. What's your first name?"
        
        # Get usual order from customer preferences
        try:
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT preferred_drink, preferred_milk, preferred_size, preferred_sugar
                FROM customer_preferences
                WHERE phone = %s
            """, (phone,))
            
            result = cursor.fetchone()
            
            if result and result[0]:
                # We have preference data
                drink, milk, size, sugar = result
                
                # Create order details
                order_details = {
                    'name': name,
                    'type': drink,
                    'milk': milk,
                    'size': size,
                    'sugar': sugar
                }
                
                # Set conversation state to confirmation
                self._set_conversation_state(phone, 'awaiting_confirmation', {
                    'name': name,
                    'order_details': order_details,
                    'order_type': 'usual'
                })
                
                # Format summary for confirmation
                return (
                    f"Great, {name}! Here's your usual order: {size} {drink} with {milk}, {sugar or 'no sugar'}\n"
                    f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
                )
            else:
                # No usual order found
                self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
                return f"I don't have a saved usual order for you yet. What type of coffee would you like, {name}?"
                
        except Exception as e:
            logger.error(f"Error fetching usual order: {str(e)}")
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return f"What type of coffee would you like, {name}?"
    
    def _is_vip_code(self, code):
        """Check if this is a valid VIP code"""
        try:
            # Check for default VIP code from settings
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = 'vip_code'")
            result = cursor.fetchone()
            
            if result and (code == result[0] or code == 'VIP'):
                return True
                
            # Also check for custom VIP codes from multiple code settings
            cursor.execute("SELECT value FROM settings WHERE key = 'vip_codes'")
            result = cursor.fetchone()
            
            if result:
                try:
                    vip_codes = json.loads(result[0])
                    
                    if isinstance(vip_codes, list):
                        # Check if the provided code matches any enabled VIP code
                        for vip_code_entry in vip_codes:
                            if (vip_code_entry.get('enabled', True) and 
                                vip_code_entry.get('code') and 
                                code.upper() == vip_code_entry['code'].upper()):
                                logger.info(f"Matched custom VIP code: {code}")
                                return True
                except (json.JSONDecodeError, TypeError, KeyError) as e:
                    logger.error(f"Error parsing VIP codes: {str(e)}")
            
            return False
            
        except Exception as e:
            logger.error(f"Error checking VIP code: {str(e)}")
            return False
    
    def _handle_vip_code(self, phone, code):
        """Handle VIP code entry"""
        try:
            # Get customer info
            customer = self._get_customer(phone)
            name = customer.get('name', '') if customer else ''
            
            # If we don't have a name, we'll need to ask for it
            if not name:
                self._set_conversation_state(phone, 'awaiting_name', {'vip': True, 'vip_code': code})
                return "To activate VIP status, I'll need your name first. What's your first name?"
            
            # Mark this customer as VIP in their preferences
            cursor = self.db.cursor()
            
            if customer:
                # Update existing customer
                cursor.execute("""
                    UPDATE customer_preferences 
                    SET is_vip = TRUE 
                    WHERE phone = %s
                """, (phone,))
            else:
                # Create new customer record
                cursor.execute("""
                    INSERT INTO customer_preferences 
                    (phone, name, is_vip, first_order_date, last_order_date) 
                    VALUES (%s, %s, TRUE, %s, %s)
                """, (phone, name, datetime.now(), datetime.now()))
            
            self.db.commit()
            
            # Update conversation state
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name, 'vip': True})
            
            return f"VIP status activated, {name}! Your orders will now be prioritized. What would you like to order?"
            
        except Exception as e:
            logger.error(f"Error processing VIP code: {str(e)}")
            return "Sorry, we couldn't process your VIP code. Please try again or contact the help desk."
    
    def _start_friend_order(self, phone, state):
        """Start an order for a friend"""
        # Check if we have current customer name
        customer = self._get_customer(phone)
        name = customer.get('name', '') if customer else ''
        
        if not name:
            # We need the customer's name first
            self._set_conversation_state(phone, 'awaiting_name')
            return "Before ordering for a friend, I need your name. What's your first name?"
        
        # Check for existing orders
        cursor = self.db.cursor()
        cursor.execute("""
            SELECT id, order_number, station_id, order_details, status
            FROM orders 
            WHERE phone = %s AND status IN ('pending', 'in-progress', 'completed') 
            ORDER BY created_at DESC 
            LIMIT 1
        """, (phone,))
        
        result = cursor.fetchone()
        
        if result:
            # They have an existing order
            order_id, order_number, station_id, order_details_json, status = result
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json or {}
                
            # Set up friend order state
            self._set_conversation_state(phone, 'awaiting_friend_name', {
                'primary_name': name,
                'primary_order': order_details,
                'group_orders': [],
                'station_id': station_id
            })
            
            return f"Thanks! What type of coffee would {friend_name} like?"
    
    def _handle_awaiting_friend_coffee_type(self, phone, message, state):
        """Handle friend's coffee type selection"""
        # Get data from state
        temp_data = state.get('temp_data', {})
        primary_name = temp_data.get('primary_name', '')
        friend_name = temp_data.get('friend_name', '')
        station_id = temp_data.get('station_id')
        
        # Parse message to extract coffee type
        coffee_type = self._parse_coffee_type(message)
        
        if not coffee_type:
            # No valid coffee type found
            coffee_options = ", ".join(self.available_coffee_types[:5])
            return (
                f"I'm not sure what type of coffee {friend_name} would like. Please specify from our menu: "
                f"{coffee_options}, etc."
            )
        
        # Validate if this coffee type is available
        if coffee_type.lower() not in [c.lower() for c in self.available_coffee_types]:
            # Coffee type not available - suggest alternatives
            coffee_options = ", ".join(self.available_coffee_types[:5])
            return (
                f"Sorry, we don't offer {coffee_type} at this event. Available options include: "
                f"{coffee_options}. Please select another coffee type for {friend_name}."
            )
        
        # Coffee type is valid - check if it's a black coffee
        is_black_coffee = coffee_type.lower() in ['long black', 'espresso', 'americano', 'black coffee']
        
        # Create friend's order
        friend_order = {
            'name': friend_name,
            'type': coffee_type,
            'station_id': station_id
        }
        
        # If it's a black coffee, we can skip milk selection
        if is_black_coffee:
            friend_order['milk'] = 'no milk'
            
            # Update state and move to size
            self._set_conversation_state(phone, 'awaiting_friend_size', {
                'primary_name': primary_name,
                'friend_name': friend_name,
                'friend_order': friend_order,
                'station_id': station_id
            })
            
            return f"What size {coffee_type} would {friend_name} like? ({', '.join(self.available_sizes)})"
        else:
            # Update state and move to milk selection
            self._set_conversation_state(phone, 'awaiting_friend_milk', {
                'primary_name': primary_name,
                'friend_name': friend_name,
                'friend_order': friend_order,
                'station_id': station_id
            })
            
            return f"What type of milk would {friend_name} like with their {coffee_type}? ({', '.join(self.available_milk_types)})"
    
    def _handle_awaiting_friend_milk(self, phone, message, state):
        """Handle milk type selection for friend's order"""
        # Get data from state
        temp_data = state.get('temp_data', {})
        primary_name = temp_data.get('primary_name', '')
        friend_name = temp_data.get('friend_name', '')
        friend_order = temp_data.get('friend_order', {})
        coffee_type = friend_order.get('type', 'coffee')
        station_id = temp_data.get('station_id')
        
        # Handle "no milk" response
        if message.lower() in ['no milk', 'none', 'black', 'no', 'without milk']:
            milk_type = 'no milk'
        else:
            # Parse message to extract milk type
            milk_type = self._parse_milk_type(message)
        
        if not milk_type:
            # No valid milk type found
            milk_options = ", ".join(self.available_milk_types)
            return (
                f"I'm not sure what type of milk {friend_name} would like. Please specify from: "
                f"{milk_options}, or say 'no milk' for black coffee."
            )
        
        # Validate if this milk type is available
        if milk_type.lower() != 'no milk' and milk_type.lower() not in [m.lower() for m in self.available_milk_types]:
            # Milk type not available - suggest alternatives
            milk_options = ", ".join(self.available_milk_types)
            return (
                f"Sorry, we don't offer {milk_type} milk at this event. Available options include: "
                f"{milk_options}. Please select another milk type."
            )
        
        # Milk type is valid - update order details
        friend_order['milk'] = milk_type
        
        # Update state and move to size selection
        self._set_conversation_state(phone, 'awaiting_friend_size', {
            'primary_name': primary_name,
            'friend_name': friend_name,
            'friend_order': friend_order,
            'station_id': station_id
        })
        
        size_options = ", ".join(self.available_sizes)
        return f"What size {coffee_type} would {friend_name} like? ({size_options})"
    
    def _get_conversation_state(self, phone):
        """Get the conversation state for a phone number"""
        # Check in-memory cache first
        if phone in self.conversation_states:
            return self.conversation_states[phone]
        
        # Otherwise, check database
        try:
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT state, temp_data, last_interaction, message_count
                FROM conversation_states
                WHERE phone = %s
            """, (phone,))
            
            result = cursor.fetchone()
            
            if result:
                state, temp_data_str, last_interaction, message_count = result
                
                # Parse JSON temp data
                try:
                    temp_data = json.loads(temp_data_str) if temp_data_str else {}
                except Exception as json_err:
                    logger.error(f"Error parsing JSON in conversation state: {str(json_err)}")
                    temp_data = {}
                
                # Create state object
                state_obj = {
                    'state': state,
                    'temp_data': temp_data,
                    'last_interaction': last_interaction,
                    'message_count': int(message_count) if message_count else 0
                }
                
                # Cache in memory
                self.conversation_states[phone] = state_obj
                
                return state_obj
            
            # No state found - return empty state
            return {'state': None, 'temp_data': {}, 'message_count': 0}
            
        except Exception as e:
            logger.error(f"Error getting conversation state: {str(e)}")
            return {'state': None, 'temp_data': {}, 'message_count': 0}
    
    def _set_conversation_state(self, phone, state, temp_data=None):
        """Update the conversation state for a phone number"""
        # Update in-memory cache
        now = datetime.now()
        
        # Get existing state to update message count
        existing = self._get_conversation_state(phone)
        message_count = existing.get('message_count', 0) + 1
        
        # Create state object
        state_obj = {
            'state': state,
            'temp_data': temp_data or {},
            'last_interaction': now,
            'message_count': message_count
        }
        
        # Update in-memory cache
        self.conversation_states[phone] = state_obj
        
        # Update database
        try:
            cursor = self.db.cursor()
            
            # Convert temp_data to JSON
            temp_data_json = json.dumps(temp_data) if temp_data else None
            
            # Check if state exists
            cursor.execute("SELECT phone FROM conversation_states WHERE phone = %s", (phone,))
            result = cursor.fetchone()
            
            if result:
                # Update existing state
                cursor.execute("""
                    UPDATE conversation_states
                    SET state = %s, temp_data = %s, last_interaction = %s, message_count = %s
                    WHERE phone = %s
                """, (state, temp_data_json, now, message_count, phone))
            else:
                # Insert new state
                cursor.execute("""
                    INSERT INTO conversation_states
                    (phone, state, temp_data, last_interaction, message_count)
                    VALUES (%s, %s, %s, %s, %s)
                """, (phone, state, temp_data_json, now, message_count))
            
            self.db.commit()
            logger.debug(f"Updated conversation state for {phone} to '{state}'")
            
        except Exception as e:
            logger.error(f"Error setting conversation state: {str(e)}")
    
    def _get_setting(self, key, default_value=None):
        """Get a setting from the database with caching"""
        try:
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = %s", (key,))
            result = cursor.fetchone()
            
            if result and result[0]:
                return result[0]
            
            return default_value
        except Exception as e:
            logger.error(f"Error getting setting {key}: {str(e)}")
            return default_value
    
    def _parse_coffee_type(self, message):
        """Parse coffee type from message"""
        message_lower = message.lower()
        
        # Check for exact matches first
        for coffee_type in self.available_coffee_types:
            if coffee_type.lower() in message_lower:
                return coffee_type
        
        # Check for common abbreviations and variations
        if 'capp' in message_lower:
            return next((c for c in self.available_coffee_types if 'cappuccino' in c.lower()), 'Cappuccino')
        elif 'latt' in message_lower:
            return next((c for c in self.available_coffee_types if 'latte' in c.lower()), 'Latte')
        elif 'flat' in message_lower or ('flat' in message_lower and 'white' in message_lower):
            return next((c for c in self.available_coffee_types if 'flat white' in c.lower()), 'Flat White')
        elif 'espresso' in message_lower or 'shot' in message_lower:
            return next((c for c in self.available_coffee_types if 'espresso' in c.lower()), 'Espresso')
        elif 'long' in message_lower or 'black' in message_lower:
            return next((c for c in self.available_coffee_types if 'long black' in c.lower()), 'Long Black')
        elif 'mocha' in message_lower:
            return next((c for c in self.available_coffee_types if 'mocha' in c.lower()), 'Mocha')
        
        # If no match, return None
        return None
    
    def _parse_milk_type(self, message):
        """Parse milk type from message"""
        message_lower = message.lower()
        
        # Check for "no milk" variations
        if 'no milk' in message_lower or 'black' in message_lower:
            return 'no milk'
        
        # Check for exact matches
        for milk_type in self.available_milk_types:
            if milk_type.lower() in message_lower:
                return milk_type
        
        # Check common variations
        if 'full' in message_lower or 'normal' in message_lower or 'regular' in message_lower or 'standard' in message_lower:
            return next((m for m in self.available_milk_types if 'full' in m.lower() or 'regular' in m.lower()), 'Full Cream')
        elif 'skim' in message_lower or 'trim' in message_lower or 'light' in message_lower:
            return next((m for m in self.available_milk_types if 'skim' in m.lower()), 'Skim')
        elif 'soy' in message_lower:
            return next((m for m in self.available_milk_types if 'soy' in m.lower()), 'Soy')
        elif 'almond' in message_lower:
            return next((m for m in self.available_milk_types if 'almond' in m.lower()), 'Almond')
        elif 'oat' in message_lower:
            return next((m for m in self.available_milk_types if 'oat' in m.lower()), 'Oat')
        elif 'lactose' in message_lower or 'free' in message_lower:
            return next((m for m in self.available_milk_types if 'lactose' in m.lower()), 'Lactose Free')
        
        # If no match, return None
        return None
    
    def _parse_size(self, message):
        """Parse size from message"""
        message_lower = message.lower()
        
        # Check for exact matches
        for size in self.available_sizes:
            if size.lower() in message_lower:
                return size
        
        # Check common variations
        if 's' == message_lower or 'sm' == message_lower or 'small' in message_lower:
            return next((s for s in self.available_sizes if 'small' in s.lower()), 'Small')
        elif 'm' == message_lower or 'med' == message_lower or 'medium' in message_lower or 'regular' in message_lower:
            return next((s for s in self.available_sizes if 'medium' in s.lower()), 'Medium')
        elif 'l' == message_lower or 'lg' == message_lower or 'large' in message_lower or 'big' in message_lower:
            return next((s for s in self.available_sizes if 'large' in s.lower()), 'Large')
        
        # If no match, default to Medium
        return 'Medium'
    
    def _parse_sweetener(self, message):
        """Parse sweetener from message"""
        message_lower = message.lower()
        
        # Check for exact matches
        for sweetener in self.available_sweeteners:
            if sweetener.lower() in message_lower:
                return sweetener
        
        # Check common variations
        if 'no' in message_lower or 'without' in message_lower or 'none' in message_lower:
            return 'No Sugar'
        elif '1' in message or 'one' in message_lower:
            return '1 Sugar'
        elif '2' in message or 'two' in message_lower:
            return '2 Sugar'
        elif '3' in message or 'three' in message_lower:
            return '3 Sugar'
        elif 'honey' in message_lower:
            return 'Honey'
        elif 'stevia' in message_lower:
            return 'Stevia'
        elif 'equal' in message_lower or 'artificial' in message_lower:
            return 'Equal'
        
        # If no match, default to No Sugar
        return 'No Sugar'
    
    def _is_affirmative(self, message):
        """Check if message is an affirmative response"""
        message_lower = message.lower().strip()
        affirmative_responses = ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'y', 'confirm', 'please', 'yup']
        
        return message_lower in affirmative_responses or message_lower.startswith('yes')
    
    # Friend order methods
    
    def _handle_awaiting_friend_size(self, phone, message, state):
        """Handle size selection for friend's order"""
        # Get data from state
        temp_data = state.get('temp_data', {})
        primary_name = temp_data.get('primary_name', '')
        friend_name = temp_data.get('friend_name', '')
        friend_order = temp_data.get('friend_order', {})
        coffee_type = friend_order.get('type', 'coffee')
        station_id = temp_data.get('station_id')
        
        # Parse message to extract size
        size = self._parse_size(message)
        
        # Size is valid - update order details
        friend_order['size'] = size
        
        # Update state and move to sweetener selection
        self._set_conversation_state(phone, 'awaiting_friend_sweetener', {
            'primary_name': primary_name,
            'friend_name': friend_name,
            'friend_order': friend_order,
            'station_id': station_id
        })
        
        sweetener_options = ", ".join(self.available_sweeteners)
        return f"How would {friend_name} like their {coffee_type} sweetened? ({sweetener_options})"
    
    def _handle_awaiting_friend_sweetener(self, phone, message, state):
        """Handle sweetener selection for friend's order"""
        # Get data from state
        temp_data = state.get('temp_data', {})
        primary_name = temp_data.get('primary_name', '')
        friend_name = temp_data.get('friend_name', '')
        friend_order = temp_data.get('friend_order', {})
        coffee_type = friend_order.get('type', 'coffee')
        station_id = temp_data.get('station_id')
        
        # Parse sweetener
        sweetener = self._parse_sweetener(message)
        
        # Update order details
        friend_order['sugar'] = sweetener
        
        # Format order summary for confirmation
        size = friend_order.get('size', '')
        milk = friend_order.get('milk', '')
        
        summary = f"{size} {coffee_type}"
        if milk and milk != 'no milk':
            summary += f" with {milk} milk"
        if sweetener and sweetener.lower() != 'no sugar':
            summary += f", {sweetener}"
        
        # Update state and move to confirmation
        self._set_conversation_state(phone, 'awaiting_friend_confirmation', {
            'primary_name': primary_name,
            'friend_name': friend_name,
            'friend_order': friend_order,
            'station_id': station_id
        })
        
        return (
            f"Great! Here's {friend_name}'s order: {summary}\n"
            f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
        )
    
    def _handle_awaiting_friend_confirmation(self, phone, message, state):
        """Handle confirmation for friend's order"""
        message_upper = message.upper().strip()
        
        # Get data from state
        temp_data = state.get('temp_data', {})
        primary_name = temp_data.get('primary_name', '')
        friend_name = temp_data.get('friend_name', '')
        friend_order = temp_data.get('friend_order', {})
        station_id = temp_data.get('station_id')
        
        if message_upper in ['YES', 'Y', 'YEP', 'YEAH', 'CONFIRM', 'OK']:
            # Confirm the friend's order
            result = self._process_order_confirmation(phone, friend_order)
            
            if result.get('success'):
                # Ask if they want to order for another friend
                self._set_conversation_state(phone, 'completed', {
                    'last_order_number': result.get('order_number'),
                    'last_station_id': result.get('station_id')
                })
                
                base_message = result.get('message', '')
                return (
                    f"{base_message}\n\n"
                    f"Would you like to order for another friend? Reply FRIEND to add another order, "
                    f"or DONE to finish."
                )
            else:
                # Something went wrong
                return (
                    f"Sorry, we couldn't process {friend_name}'s order: {result.get('error', 'Unknown error')}\n"
                    f"Please try again or visit the nearest coffee station."
                )
            
        elif message_upper in ['NO', 'N', 'CANCEL', 'NEVERMIND']:
            # Cancel the friend's order
            self._set_conversation_state(phone, 'completed')
            return f"Order for {friend_name} cancelled. Text FRIEND if you'd like to order for someone else."
            
        elif message_upper in ['EDIT', 'CHANGE', 'MODIFY']:
            # Allow editing the order - go back to coffee type
            self._set_conversation_state(phone, 'awaiting_friend_coffee_type', {
                'primary_name': primary_name,
                'friend_name': friend_name,
                'station_id': station_id
            })
            return f"Let's change that order. What type of coffee would {friend_name} like?"
            
        elif message_upper in ['FRIEND', 'ANOTHER']:
            # They want to order for another friend - but first confirm current order
            return (
                f"Please confirm {friend_name}'s current order first (YES/NO), "
                f"then I can help you order for another friend."
            )
            
        else:
            # Unrecognized response - prompt again
            return f"Please reply YES to confirm {friend_name}'s order, NO to cancel, or EDIT to change it."d  # Keep same station for group orders
            })
            
            return f"Great, {name}! Let's add a coffee for your friend. What's your friend's name?"
        else:
            # No existing order to associate with
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return f"You'll need to place your own order first before ordering for a friend. What coffee would you like, {name}?"
    
    def _handle_awaiting_name(self, phone, message, state):
        """Handle name input during conversation"""
        # Extract name from message
        name = message.strip()
        
        # Basic validation
        if len(name) < 2 or len(name) > 50:
            return "Please enter a valid name (2-50 characters)."
        
        # Check if this is a VIP registration
        vip = state.get('temp_data', {}).get('vip', False)
        
        if vip:
            # Process VIP code if present
            vip_code = state.get('temp_data', {}).get('vip_code')
            
            # Save name and VIP flag for next step
            self._set_conversation_state(phone, 'awaiting_coffee_type', {
                'name': name,
                'vip': True
            })
            
            return f"VIP status activated, {name}! Your orders will now be prioritized. What would you like to order?"
        else:
            # Regular order flow
            # Check if this might be a returning customer (by phone) that we just don't have a name for
            customer = self._get_customer(phone)
            
            if customer and not customer.get('name'):
                # Update customer record with name
                cursor = self.db.cursor()
                cursor.execute("""
                    UPDATE customer_preferences
                    SET name = %s
                    WHERE phone = %s
                """, (name, phone))
                self.db.commit()
            
            # Save name for next step
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            
            return f"Nice to meet you, {name}! What type of coffee would you like today? Text MENU to see options."
    
    def _handle_awaiting_coffee_type(self, phone, message, state, station_id=None):
        """Handle coffee type selection"""
        # Get data from state
        temp_data = state.get('temp_data', {})
        name = temp_data.get('name', '')
        vip = temp_data.get('vip', False)
        
        # Check if this is a yes to a previous usual order suggestion
        if temp_data.get('suggestion_context') == 'usual_order' and self._is_affirmative(message):
            return self._process_usual_order(phone, name)
        
        # Parse message to extract coffee type
        coffee_type = self._parse_coffee_type(message)
        
        if not coffee_type:
            # No valid coffee type found
            coffee_options = ", ".join(self.available_coffee_types[:5])
            return (
                f"I'm not sure what type of coffee you'd like. Please specify from our menu: "
                f"{coffee_options}, etc. Text MENU to see all options."
            )
        
        # Validate if this coffee type is available
        if coffee_type.lower() not in [c.lower() for c in self.available_coffee_types]:
            # Coffee type not available - suggest alternatives
            coffee_options = ", ".join(self.available_coffee_types[:5])
            return (
                f"Sorry, we don't offer {coffee_type} at this event. Available options include: "
                f"{coffee_options}. Please select another coffee type."
            )
        
        # Coffee type is valid - check if it's a black coffee
        is_black_coffee = coffee_type.lower() in ['long black', 'espresso', 'americano', 'black coffee']
        
        # Save order details
        order_details = {
            'name': name,
            'type': coffee_type,
            'vip': vip
        }
        
        # Add station ID if provided
        if station_id:
            order_details['station_id'] = station_id
        
        # If it's a black coffee, we can skip milk selection
        if is_black_coffee:
            order_details['milk'] = 'no milk'
            
            # Update state and move to size
            self._set_conversation_state(phone, 'awaiting_size', {
                'name': name,
                'order_details': order_details
            })
            
            return f"What size {coffee_type} would you like? ({', '.join(self.available_sizes)})"
        else:
            # Update state and move to milk selection
            self._set_conversation_state(phone, 'awaiting_milk', {
                'name': name,
                'order_details': order_details
            })
            
            return f"What type of milk would you like with your {coffee_type}? ({', '.join(self.available_milk_types)})"
    
    def _handle_awaiting_milk(self, phone, message, state):
        """Handle milk type selection"""
        # Get data from state
        temp_data = state.get('temp_data', {})
        name = temp_data.get('name', '')
        order_details = temp_data.get('order_details', {})
        coffee_type = order_details.get('type', 'coffee')
        
        # Handle "no milk" response
        if message.lower() in ['no milk', 'none', 'black', 'no', 'without milk']:
            milk_type = 'no milk'
        else:
            # Parse message to extract milk type
            milk_type = self._parse_milk_type(message)
        
        if not milk_type:
            # No valid milk type found
            milk_options = ", ".join(self.available_milk_types)
            return (
                f"I'm not sure what type of milk you'd like. Please specify from: "
                f"{milk_options}, or say 'no milk' for black coffee."
            )
        
        # Validate if this milk type is available
        if milk_type.lower() != 'no milk' and milk_type.lower() not in [m.lower() for m in self.available_milk_types]:
            # Milk type not available - suggest alternatives
            milk_options = ", ".join(self.available_milk_types)
            return (
                f"Sorry, we don't offer {milk_type} milk at this event. Available options include: "
                f"{milk_options}. Please select another milk type."
            )
        
        # Milk type is valid - update order details
        order_details['milk'] = milk_type
        
        # Update state and move to size selection
        self._set_conversation_state(phone, 'awaiting_size', {
            'name': name,
            'order_details': order_details
        })
        
        size_options = ", ".join(self.available_sizes)
        return f"What size {coffee_type} would you like? ({size_options})"
    
    def _handle_awaiting_size(self, phone, message, state):
        """Handle size selection"""
        # Get data from state
        temp_data = state.get('temp_data', {})
        name = temp_data.get('name', '')
        order_details = temp_data.get('order_details', {})
        coffee_type = order_details.get('type', 'coffee')
        
        # Parse message to extract size
        size = self._parse_size(message)
        
        if not size:
            # No valid size found
            size_options = ", ".join(self.available_sizes)
            return f"Please select a valid size: {size_options}."
        
        # Validate if this size is available
        if size.lower() not in [s.lower() for s in self.available_sizes]:
            # Size not available - suggest alternatives
            size_options = ", ".join(self.available_sizes)
            return (
                f"Sorry, we don't offer {size} size at this event. Available options include: "
                f"{size_options}. Please select another size."
            )
        
        # Size is valid - update order details
        order_details['size'] = size
        
        # Update state and move to sweetener selection
        self._set_conversation_state(phone, 'awaiting_sweetener', {
            'name': name,
            'order_details': order_details
        })
        
        sweetener_options = ", ".join(self.available_sweeteners)
        return f"How would you like your {coffee_type} sweetened? ({sweetener_options})"
    
    def _handle_awaiting_sweetener(self, phone, message, state):
        """Handle sweetener selection"""
        # Get data from state
        temp_data = state.get('temp_data', {})
        name = temp_data.get('name', '')
        order_details = temp_data.get('order_details', {})
        
        # Handle common "no sugar" responses
        if message.lower() in ['no', 'none', 'zero', '0', 'n', 'no sugar', 'without sugar']:
            sweetener = 'No Sugar'
        else:
            # Parse message to extract sweetener
            sweetener = self._parse_sweetener(message)
        
        if not sweetener:
            # Default to no sugar if unclear
            sweetener = 'No Sugar'
        
        # Update order details
        order_details['sugar'] = sweetener
        
        # Format order summary for confirmation
        size = order_details.get('size', '')
        coffee_type = order_details.get('type', 'coffee')
        milk = order_details.get('milk', '')
        
        summary = f"{size} {coffee_type}"
        if milk and milk != 'no milk':
            summary += f" with {milk} milk"
        if sweetener and sweetener.lower() != 'no sugar':
            summary += f", {sweetener}"
        
        # Update state and move to confirmation
        self._set_conversation_state(phone, 'awaiting_confirmation', {
            'name': name,
            'order_details': order_details
        })
        
        return (
            f"Great! Here's your order: {summary}\n"
            f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
        )
    
    def _handle_awaiting_confirmation(self, phone, message, state):
        """Handle order confirmation"""
        message_upper = message.upper().strip()
        
        # Get data from state
        temp_data = state.get('temp_data', {})
        name = temp_data.get('name', '')
        order_details = temp_data.get('order_details', {})
        
        if message_upper in ['YES', 'Y', 'YEP', 'YEAH', 'CONFIRM', 'OK']:
            # Check event schedule first
            is_open, schedule_message = self._check_event_schedule()
            
            if not is_open and not order_details.get('vip', False):
                # Stations closed for regular customers
                return schedule_message
            
            # Confirm the order
            result = self._process_order_confirmation(phone, order_details)
            
            if result.get('success'):
                # Offer option to order for a friend
                self._set_conversation_state(phone, 'completed', {
                    'last_order_number': result.get('order_number'),
                    'last_station_id': result.get('station_id')
                })
                
                base_message = result.get('message', '')
                return (
                    f"{base_message}\n\n"
                    f"Reply FRIEND to order for a friend, STATUS to check your order, "
                    f"or CANCEL if you need to cancel."
                )
            else:
                # Something went wrong
                return (
                    f"Sorry, we couldn't process your order: {result.get('error', 'Unknown error')}\n"
                    f"Please try again or visit the nearest coffee station."
                )
            
        elif message_upper in ['NO', 'N', 'CANCEL', 'NEVERMIND']:
            # Cancel the order
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return f"Order cancelled. What type of coffee would you like instead, {name}?"
            
        elif message_upper in ['EDIT', 'CHANGE', 'MODIFY']:
            # Allow editing the order - go back to coffee type
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return f"Let's change that order. What type of coffee would you like, {name}?"
            
        elif message_upper in ['FRIEND', 'ANOTHER']:
            # They want to order for a friend - but first confirm current order
            return (
                f"Please confirm your current order first (YES/NO), "
                f"then I can help you order for a friend."
            )
            
        else:
            # Unrecognized response - prompt again
            return "Please reply YES to confirm your order, NO to cancel, or EDIT to change it."
    
    def _process_order_confirmation(self, phone, order_details):
        """Process confirmed order"""
        try:
            # Generate order number
            now = datetime.now()
            prefix = "A" if now.hour < 12 else "P"
            order_number = f"{prefix}{now.strftime('%H%M%S')}{now.microsecond // 10000}"
            
            # Add customer name if missing
            if 'name' not in order_details:
                customer = self._get_customer(phone)
                if customer and customer.get('name'):
                    order_details['name'] = customer.get('name')
                else:
                    order_details['name'] = "Customer"
            
            name = order_details.get('name')
            
            # Check for existing station ID or assign a station
            station_id = order_details.get('station_id')
            is_vip = order_details.get('vip', False)
            milk_type = order_details.get('milk')
            
            if not station_id:
                # Assign a station based on preferences and load
                station_id, is_delayed = self._assign_station(is_vip, milk_type)
                order_details['station_id'] = station_id
                
                # Handle delayed orders
                if is_delayed:
                    order_details['delayed'] = True
                    order_details['scheduled_for_next_break'] = True
            
            # Priority for VIP orders
            queue_priority = 1 if is_vip else 5
            
            # Insert order into database
            cursor = self.db.cursor()
            cursor.execute("""
                INSERT INTO orders 
                (order_number, phone, order_details, status, station_id, created_at, updated_at, queue_priority)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                order_number,
                phone,
                json.dumps(order_details),
                'pending',
                station_id,
                now,
                now,
                queue_priority
            ))
            
            order_id = cursor.fetchone()[0]
            
            # Update station load
            cursor.execute("""
                INSERT INTO station_stats (station_id, current_load, last_updated)
                VALUES (%s, 1, %s)
                ON CONFLICT (station_id) DO UPDATE SET
                    current_load = station_stats.current_load + 1,
                    last_updated = %s
            """, (station_id, now, now))
            
            # Update or create customer preferences
            self._save_customer_preferences(phone, name, order_details)
            
            # Get estimated wait time
            wait_time = self._get_station_wait_time(station_id)
            
            # Format confirmation message
            confirmation_message = (
                f"Thank you, {name}! Your order #{order_number} has been confirmed and sent to Station {station_id}. "
                f"Approximate wait time: {wait_time} minutes. "
                f"We'll send you another message when it's ready."
            )
            
            # Check if order is delayed due to schedule
            if order_details.get('delayed'):
                confirmation_message += (
                    f" Note: Your order will be prepared during the next scheduled break."
                )
            
            # If this is a VIP order, acknowledge it
            if is_vip:
                confirmation_message += " Your order has been given VIP priority."
            
            # Add tracking URL if enabled
            enable_web_tracking = self._get_setting('enable_web_tracking', 'false').lower() in ('true', 'yes', '1')
            if enable_web_tracking:
                base_url = self._get_setting('web_tracking_url', 'https://coffee.example.com/track/')
                tracking_url = f"{base_url}?id={order_number}"
                confirmation_message += f"\n\nTrack your order here: {tracking_url}"
            
            # Commit transaction
            self.db.commit()
            
            return {
                "success": True,
                "order_id": order_id,
                "order_number": order_number,
                "station_id": station_id,
                "wait_time": wait_time,
                "message": confirmation_message
            }
        except Exception as e:
            logger.error(f"Error confirming order: {str(e)}")
            self.db.rollback()
            
            return {
                "success": False,
                "error": str(e)
            }
    
    def _check_event_schedule(self):
        """Check if stations are open based on event schedule"""
        try:
            cursor = self.db.cursor()
            
            # Get current day and time
            now = datetime.now()
            current_day = now.weekday()  # 0=Monday, 6=Sunday
            current_time = now.time()
            
            # Check if we're in an active break period
            cursor.execute("""
                SELECT title, start_time, end_time, stations
                FROM event_breaks
                WHERE day_of_week = %s
                  AND %s BETWEEN start_time AND end_time
                ORDER BY start_time
                LIMIT 1
            """, (current_day, current_time))
            
            current_break = cursor.fetchone()
            
            if current_break:
                # We're in an active break period - stations are open
                title, start, end, stations_json = current_break
                return True, f"Stations are open during {title}."
            
            # Check for upcoming breaks
            cursor.execute("""
                SELECT title, start_time, end_time
                FROM event_breaks
                WHERE day_of_week = %s
                  AND start_time > %s
                ORDER BY start_time
                LIMIT 1
            """, (current_day, current_time))
            
            next_break = cursor.fetchone()
            
            if next_break:
                # There's an upcoming break today
                title, start_time, end_time = next_break
                
                # Format time for display
                start_formatted = start_time.strftime("%I:%M %p")
                
                # Check custom session status
                cursor.execute("""
                    SELECT value FROM settings WHERE key = 'session_status'
                """)
                session_status = cursor.fetchone()
                
                if session_status and session_status[0]:
                    status = session_status[0].lower()
                    
                    if status == 'running_over':
                        return False, (
                            f"Coffee stations are currently closed as the session is running over. "
                            f"We expect to open for {title} shortly. "
                            f"Text VIP if you have a VIP code, or reply to this message when we're open."
                        )
                    elif status == 'finished_early':
                        return True, (
                            f"The session finished early! Coffee stations are now open. "
                            f"What would you like to order?"
                        )
                
                # Default message - stations closed until next break
                return False, (
                    f"Coffee stations are currently closed. We will open again at {start_formatted} for {title}. "
                    f"Text VIP if you have a VIP code, or reply to this message during the break."
                )
            else:
                # No more breaks today - possibly closed for the day
                cursor.execute("""
                    SELECT value FROM settings WHERE key = 'custom_closed_message'
                """)
                custom_message = cursor.fetchone()
                
                if custom_message and custom_message[0]:
                    return False, custom_message[0]
                else:
                    return False, (
                        f"Sorry, coffee stations are closed for the day. "
                        f"Please come back tomorrow for the next session."
                    )
                
        except Exception as e:
            logger.error(f"Error checking event schedule: {str(e)}")
            # Default to open if we can't check the schedule
            return True, "Coffee stations are open."
    
    def _assign_station(self, is_vip=False, milk_type=None):
        """
        Assign order to a station based on current load, capabilities, and scheduling
        
        Returns:
            (station_id, is_delayed): ID of the assigned station and whether order is delayed
        """
        try:
            cursor = self.db.cursor()
            
            # First check if we're in a break period or not
            current_time = datetime.now()
            current_hour = current_time.hour
            current_minute = current_time.minute
            current_day = current_time.weekday()  # 0=Monday, 6=Sunday
            
            # Check for any scheduled breaks that include the current time
            cursor.execute("""
                SELECT id, start_time, end_time, stations 
                FROM event_breaks 
                WHERE day_of_week = %s
                ORDER BY start_time
            """, (current_day,))
            
            current_break = None
            next_break = None
            
            for break_info in cursor.fetchall():
                break_id, start_str, end_str, stations_json = break_info
                
                # Parse the time strings (format: HH:MM)
                start_hour, start_minute = map(int, start_str.split(':'))
                end_hour, end_minute = map(int, end_str.split(':'))
                
                # Check if current time is within the break
                if ((current_hour > start_hour) or 
                    (current_hour == start_hour and current_minute >= start_minute)) and \
                   ((current_hour < end_hour) or 
                    (current_hour == end_hour and current_minute <= end_minute)):
                    # We're in a break period now
                    current_break = {
                        'id': break_id,
                        'start': (start_hour, start_minute),
                        'end': (end_hour, end_minute),
                        'stations': json.loads(stations_json) if stations_json else []
                    }
                    break
                
                # Check if this is the next upcoming break
                if (current_hour < start_hour) or \
                   (current_hour == start_hour and current_minute < start_minute):
                    next_break = {
                        'id': break_id,
                        'start': (start_hour, start_minute),
                        'end': (end_hour, end_minute),
                        'stations': json.loads(stations_json) if stations_json else []
                    }
                    break
            
            # Get all stations with their current load and capabilities
            cursor.execute("""
                SELECT s.station_id, s.current_load, s.capacity, s.status, s.capabilities
                FROM station_stats s
                WHERE s.status = 'active'
                ORDER BY s.current_load
            """)
            
            stations = []
            for station_data in cursor.fetchall():
                station_id, load, capacity, status, capabilities_json = station_data
                capabilities = json.loads(capabilities_json) if capabilities_json else {}
                
                stations.append({
                    'id': station_id,
                    'load': load or 0,
                    'capacity': capacity or 10,  # Default capacity if none set
                    'status': status,
                    'capabilities': capabilities,
                    'alt_milk_available': capabilities.get('alt_milk', True),
                    'high_volume': capabilities.get('high_volume', False),
                    'vip_service': capabilities.get('vip_service', False)
                })
            
            if not stations:
                # Default to station 1 if no stations found
                logger.warning("No active stations found, defaulting to station 1")
                return 1, False
            
            # First handle VIP logic
            if is_vip:
                # For VIPs, prefer stations with VIP service capability
                vip_stations = [s for s in stations if s['vip_service']]
                
                if vip_stations:
                    # Use the least busy VIP-capable station
                    vip_stations.sort(key=lambda s: s['load'])
                    logger.info(f"Assigned VIP order to dedicated VIP station {vip_stations[0]['id']}")
                    return vip_stations[0]['id'], False
                
                # If no VIP stations, use the least busy regular station
                stations.sort(key=lambda s: s['load'])
                logger.info(f"Assigned VIP order to regular station {stations[0]['id']} (no VIP stations available)")
                return stations[0]['id'], False
            
            # Check if the requested milk type is a special case (alternative milk)
            is_alt_milk = milk_type and milk_type.lower() in ['soy milk', 'almond milk', 'oat milk', 'soy', 'almond', 'oat']
            
            # During a break period, use stations that are open
            if current_break:
                # Get the stations that are open during this break
                open_station_ids = current_break['stations']
                open_stations = [s for s in stations if s['id'] in open_station_ids]
                
                if not open_stations:
                    logger.warning(f"No stations open during current break, using all active stations")
                    open_stations = stations
                
                # Find the best station based on milk type and load
                if is_alt_milk:
                    alt_milk_stations = [s for s in open_stations if s['alt_milk_available']]
                    if alt_milk_stations:
                        alt_milk_stations.sort(key=lambda s: s['load'])
                        logger.info(f"Assigned alt milk order to station {alt_milk_stations[0]['id']} during break")
                        return alt_milk_stations[0]['id'], False
                
                # If no alt milk or not an alt milk order, use standard load balancing
                open_stations.sort(key=lambda s: s['load'])
                logger.info(f"Assigned order to least busy station {open_stations[0]['id']} during break")
                return open_stations[0]['id'], False
            
            # If not in a break period but there's a next break coming up
            if not current_break and next_break:
                # Check if all stations are nearly at capacity
                stations_busy = all(s['load'] >= 0.8 * s['capacity'] for s in stations)
                
                if stations_busy:
                    # Stations are busy, suggest delay until next break
                    next_break_station_ids = next_break['stations']
                    next_break_stations = [s for s in stations if s['id'] in next_break_station_ids]
                    
                    if next_break_stations:
                        # Choose high capacity station if possible
                        high_volume_stations = [s for s in next_break_stations if s['high_volume']]
                        if high_volume_stations:
                            station_choice = high_volume_stations[0]['id']
                        else:
                            station_choice = next_break_stations[0]['id']
                        
                        logger.info(f"Stations busy, delaying order until next break using station {station_choice}")
                        return station_choice, True
            
            # Standard station assignment for normal operations
            # Check for special milk requirements
            if is_alt_milk:
                alt_milk_stations = [s for s in stations if s['alt_milk_available']]
                if alt_milk_stations:
                    alt_milk_stations.sort(key=lambda s: s['load'])
                    logger.info(f"Assigned alt milk order to station {alt_milk_stations[0]['id']}")
                    return alt_milk_stations[0]['id'], False
            
            # Otherwise just assign to least busy station
            stations.sort(key=lambda s: s['load'])
            return stations[0]['id'], False
            
        except Exception as e:
            logger.error(f"Error in station assignment: {str(e)}")
            # Default to station 1 on error
            return 1, False
    
    def _get_station_wait_time(self, station_id):
        """Get estimated wait time for a station"""
        try:
            cursor = self.db.cursor()
            
            # Get station wait time from settings
            cursor.execute("""
                SELECT current_load, avg_completion_time, wait_time
                FROM station_stats
                WHERE station_id = %s
            """, (station_id,))
            
            result = cursor.fetchone()
            
            if result:
                current_load, avg_completion_time, wait_time = result
                
                # If station has set a specific wait time, use that
                if wait_time:
                    return wait_time
                
                # Otherwise calculate based on load and avg completion time
                if avg_completion_time:
                    # Calculate wait time in minutes
                    calculated_wait = max(1, (current_load * avg_completion_time) // 60)
                    return min(calculated_wait, 30)  # Cap at 30 minutes
                
                # Default fallback based on load
                return max(5, min(current_load * 2, 20))
            else:
                # No station stats - use default
                return 10
                
        except Exception as e:
            logger.error(f"Error getting station wait time: {str(e)}")
            return 10  # Default wait time
    
    def _save_customer_preferences(self, phone, name, order_details):
        """Save customer preferences for future use"""
        try:
            cursor = self.db.cursor()
            
            # Check if customer exists
            cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
            customer = cursor.fetchone()
            
            now = datetime.now()
            
            if customer:
                # Update existing customer
                cursor.execute("""
                    UPDATE customer_preferences
                    SET name = %s,
                        preferred_drink = %s,
                        preferred_milk = %s,
                        preferred_size = %s,
                        preferred_sugar = %s,
                        last_order_date = %s,
                        total_orders = COALESCE(total_orders, 0) + 1
                    WHERE phone = %s
                """, (
                    name,
                    order_details.get('type'),
                    order_details.get('milk'),
                    order_details.get('size'),
                    order_details.get('sugar'),
                    now,
                    phone
                ))
            else:
                # Create new customer
                cursor.execute("""
                    INSERT INTO customer_preferences
                    (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, 
                     first_order_date, last_order_date, total_orders, is_vip)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    phone,
                    name,
                    order_details.get('type'),
                    order_details.get('milk'),
                    order_details.get('size'),
                    order_details.get('sugar'),
                    now,
                    now,
                    1,
                    order_details.get('vip', False)
                ))
            
            self.db.commit()
            logger.info(f"Saved preferences for customer {name} ({phone})")
            
        except Exception as e:
            logger.error(f"Error saving customer preferences: {str(e)}")
            # Continue even if this fails (non-critical)
    
    def _handle_awaiting_friend_name(self, phone, message, state):
        """Handle friend name input for a group order"""
        # Extract name from message
        friend_name = message.strip()
        
        # Basic validation
        if len(friend_name) < 2 or len(friend_name) > 50:
            return "Please enter a valid name for your friend (2-50 characters)."
        
        # Get data from state
        temp_data = state.get('temp_data', {})
        primary_name = temp_data.get('primary_name', '')
        primary_order = temp_data.get('primary_order', {})
        station_id = temp_data.get('station_id')
        
        # Check if we have a previous order for this friend
        cursor = self.db.cursor()
        cursor.execute("""
            SELECT preferred_drink, preferred_milk, preferred_size, preferred_sugar
            FROM customer_preferences
            WHERE phone = %s AND name = %s
        """, (f"{phone}_{friend_name}", friend_name))
        
        previous_order = cursor.fetchone()
        
        if previous_order and previous_order[0]:
            # We have a previous order for this friend
            drink, milk, size, sugar = previous_order
            
            # Format order summary
            order_summary = f"{size} {drink} with {milk}" + (f", {sugar}" if sugar else "")
            
            # Update state to handle the response
            self._set_conversation_state(phone, 'awaiting_friend_confirmation', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'friend_name': friend_name,
                'friend_order': {
                    'name': friend_name,
                    'type': drink,
                    'milk': milk,
                    'size': size,
                    'sugar': sugar,
                    'station_id': station_id
                },
                'station_id': station_id
            })
            
            return (
                f"I see {friend_name} usually orders: {order_summary}\n"
                f"Would you like to order this again? (Reply YES to confirm, or tell me what {friend_name} would like)"
            )
        else:
            # No previous order for this friend
            self._set_conversation_state(phone, 'awaiting_friend_coffee_type', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'friend_name': friend_name,
                'station_id': station_i