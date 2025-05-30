const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { analyzeFoodImageImpl, parseResult } = require('./simple');
const fetch = require('node-fetch');

admin.initializeApp();

// Analyze food image function
exports.analyzeFoodImage = functions.https.onCall(async (data, context) => {
  try {
    // Validate input
    if (!data.image) {
      throw new functions.https.HttpsError("invalid-argument", "Image is required");
    }
    
    // Get API key
    const apiKey = functions.config().openai?.api_key;
    if (!apiKey) {
      throw new functions.https.HttpsError("failed-precondition", "API key not configured");
    }
    
    // Process image
    try {
      const content = await analyzeFoodImageImpl(data.image, apiKey);
      return parseResult(content);
    } catch (error) {
      throw new functions.https.HttpsError("internal", `Analysis failed: ${error.message}`);
    }
  } catch (error) {
    console.error("Function error:", error);
    throw error instanceof functions.https.HttpsError ? 
      error : 
      new functions.https.HttpsError("internal", error.message);
  }
}); 

// AI chat streaming response - used by the Coach feature
exports.streamAIResponse = functions.https.onCall(async (data, context) => {
  try {
    // Validate input
    if (!data.messages || !Array.isArray(data.messages)) {
      throw new functions.https.HttpsError("invalid-argument", "Messages array is required");
    }
    
    // Get API key
    const apiKey = functions.config().openai?.api_key;
    if (!apiKey) {
      throw new functions.https.HttpsError("failed-precondition", "API key not configured");
    }
    
    // Call OpenAI Chat API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        'model': 'gpt-4o',
        'messages': data.messages,
        'max_tokens': 2000
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenAI API error: ${response.status}`, errorText);
      throw new functions.https.HttpsError(
        "internal",
        `Failed to get AI response: API returned ${response.status}`
      );
    }
    
    const responseData = await response.json();
    
    if (!responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
      throw new functions.https.HttpsError("internal", "Invalid response from OpenAI");
    }
    
    const content = responseData.choices[0].message.content;
    
    // Create chunks for streaming simulation
    const chunks = [];
    const words = content.split(' ');
    
    // Break content into small chunks (3-5 words each)
    for (let i = 0; i < words.length; i += 4) {
      const end = Math.min(i + 3 + Math.floor(Math.random() * 3), words.length);
      chunks.push(words.slice(i, end).join(' ') + (end < words.length ? ' ' : ''));
    }
    
    return {
      success: true,
      chunks: chunks,
      fullContent: content
    };
  } catch (error) {
    console.error("Function error:", error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Non-streaming fallback
exports.getAIResponse = functions.https.onCall(async (data, context) => {
  try {
    // Validate input
    if (!data.messages || !Array.isArray(data.messages)) {
      throw new functions.https.HttpsError("invalid-argument", "Messages array is required");
    }
    
    // Get API key
    const apiKey = functions.config().openai?.api_key;
    if (!apiKey) {
      throw new functions.https.HttpsError("failed-precondition", "API key not configured");
    }
    
    // Call OpenAI Chat API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        'model': 'gpt-4o',
        'messages': data.messages,
        'max_tokens': 2000
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenAI API error: ${response.status}`, errorText);
      throw new functions.https.HttpsError(
        "internal",
        `Failed to get AI response: API returned ${response.status}`
      );
    }
    
    const responseData = await response.json();
    
    if (!responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
      throw new functions.https.HttpsError("internal", "Invalid response from OpenAI");
    }
    
    return {
      success: true,
      content: responseData.choices[0].message.content
    };
  } catch (error) {
    console.error("Function error:", error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Food nutrition analysis with DeepSeek AI
// This function accepts the DeepSeek API key directly from the client
// This allows different screens (Coach and FoodCardOpen) to use different API keys
exports.getNutritionData = functions.https.onCall(async (data, context) => {
  try {
    // Validate input
    if (!data.messages || !Array.isArray(data.messages)) {
      throw new functions.https.HttpsError("invalid-argument", "Messages array is required");
    }
    
    // Get DeepSeek API key from request data
    const apiKey = data.apiKey;
    if (!apiKey) {
      throw new functions.https.HttpsError("invalid-argument", "DeepSeek API key is required");
    }
    
    // Call DeepSeek AI API 
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        'model': 'deepseek-chat',
        'messages': data.messages,
        'max_tokens': 500,
        'temperature': 0.5,
        'response_format': { 'type': 'json_object' } // Force JSON response
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`DeepSeek API error: ${response.status}`, errorText);
      throw new functions.https.HttpsError(
        "internal",
        `Failed to get nutrition data: API returned ${response.status}`
      );
    }
    
    const responseData = await response.json();
    
    if (!responseData.choices || !responseData.choices[0] || !responseData.choices[0].message) {
      throw new functions.https.HttpsError("internal", "Invalid response from DeepSeek");
    }
    
    const content = responseData.choices[0].message.content;
    
    // Try to parse JSON content
    try {
      const nutritionData = JSON.parse(content);
      
      return {
        success: true,
        nutritionData: nutritionData
      };
    } catch (error) {
      console.error("Error parsing nutrition JSON:", error);
      
      // Return the raw content if JSON parsing fails
      return {
        success: true,
        content: content
      };
    }
  } catch (error) {
    console.error("Function error:", error);
    return {
      success: false,
      error: error.message
    };
  }
}); 