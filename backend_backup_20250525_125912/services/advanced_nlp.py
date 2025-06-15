"""
Advanced NLP service for parsing coffee orders using external APIs
"""
import logging
import json
import os
import requests
from datetime import datetime

logger = logging.getLogger("expresso.services.advanced_nlp")

# Ensure directory exists
os.makedirs(os.path.dirname(__file__), exist_ok=True)

class DialogflowNLPService:
    """Service for processing coffee orders using Google Dialogflow"""
    
    def __init__(self, project_id, api_key=None, region="global"):
        """Initialize the Dialogflow NLP service"""
        self.project_id = project_id
        self.api_key = api_key
        self.region = region
        self.base_url = f"https://{region}-dialogflow.googleapis.com/v2"
        self.session_id_prefix = "coffee-ordering-"
        
        # Fallback to local NLP if Dialogflow is not configured
        self.local_nlp = None
        try:
            from services.nlp import NLPService
            self.local_nlp = NLPService()
            logger.info("Local NLP service initialized as fallback")
        except ImportError:
            logger.warning("Could not import local NLP service for fallback")
    
    def detect_intent(self, text, session_id=None, language_code="en"):
        """
        Detect intent from text using Dialogflow
        
        Args:
            text: Input text from user
            session_id: Session ID for conversation context
            language_code: Language code (default: en)
            
        Returns:
            Dictionary with detected intent and parameters
        """
        if not self.api_key or not self.project_id:
            logger.warning("Dialogflow not configured, falling back to local NLP")
            return self._fallback_to_local_nlp(text)
        
        # Generate session ID if not provided
        if not session_id:
            session_id = f"{self.session_id_prefix}{datetime.now().timestamp()}"
        
        try:
            # Call Dialogflow API
            url = f"{self.base_url}/projects/{self.project_id}/agent/sessions/{session_id}:detectIntent"
            
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            data = {
                "query_input": {
                    "text": {
                        "text": text,
                        "language_code": language_code
                    }
                }
            }
            
            response = requests.post(url, headers=headers, json=data)
            response.raise_for_status()
            
            result = response.json()
            
            # Process the result
            query_result = result.get("queryResult", {})
            intent = query_result.get("intent", {}).get("displayName", "")
            parameters = query_result.get("parameters", {})
            fulfillment_text = query_result.get("fulfillmentText", "")
            
            # Convert Dialogflow parameters to our format
            order_details = self._convert_parameters_to_order_details(parameters, intent)
            
            return {
                "intent": intent,
                "confidence": query_result.get("intentDetectionConfidence", 0),
                "parameters": parameters,
                "fulfillment_text": fulfillment_text,
                "order_details": order_details
            }
            
        except Exception as e:
            logger.error(f"Error calling Dialogflow API: {str(e)}")
            return self._fallback_to_local_nlp(text)
    
    def _convert_parameters_to_order_details(self, parameters, intent):
        """
        Convert Dialogflow parameters to our order details format
        
        Args:
            parameters: Dialogflow parameters
            intent: Detected intent
            
        Returns:
            Order details dictionary
        """
        order_details = {}
        
        # Map Dialogflow parameters to our format
        if "coffee-type" in parameters:
            order_details["type"] = parameters["coffee-type"]
        
        if "size" in parameters:
            order_details["size"] = parameters["size"]
        
        if "milk-type" in parameters:
            order_details["milk"] = parameters["milk-type"]
        
        if "sugar" in parameters:
            # Handle different sugar formats
            sugar = parameters["sugar"]
            if isinstance(sugar, (int, float)):
                order_details["sugar"] = f"{sugar} sugar"
            else:
                order_details["sugar"] = sugar
        
        if "strength" in parameters:
            order_details["strength"] = parameters["strength"]
        
        if "temperature" in parameters:
            order_details["temp"] = parameters["temperature"]
        
        # Handle special intents
        if intent == "order.vip":
            order_details["vip"] = True
        
        if intent == "order.for_friend" and "friend-name" in parameters:
            order_details["for_friend"] = parameters["friend-name"]
        
        if intent == "order.group":
            order_details["group"] = True
        
        if intent == "redeem.loyalty":
            order_details["use_loyalty"] = True
        
        return order_details
    
    def _fallback_to_local_nlp(self, text):
        """
        Fallback to local NLP service
        
        Args:
            text: Input text from user
            
        Returns:
            Intent detection result using local NLP
        """
        if not self.local_nlp:
            return {
                "intent": "unknown",
                "confidence": 0,
                "parameters": {},
                "fulfillment_text": "I'm not sure what you want to order. Can you try again?",
                "order_details": {}
            }
        
        # Use local NLP
        order_details = self.local_nlp.parse_order(text)
        
        # Determine intent based on order details
        intent = "order.coffee"
        if "vip" in order_details and order_details["vip"]:
            intent = "order.vip"
        elif "for_friend" in order_details:
            intent = "order.for_friend"
        elif "group" in order_details and order_details["group"]:
            intent = "order.group"
        elif "use_loyalty" in order_details and order_details["use_loyalty"]:
            intent = "redeem.loyalty"
        
        return {
            "intent": intent,
            "confidence": 0.7,  # Default confidence for local NLP
            "parameters": {},  # We don't have raw parameters in local NLP
            "fulfillment_text": "",  # We don't use fulfillment text in local NLP
            "order_details": order_details
        }