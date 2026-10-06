/**
 * Netlify Function: Billplz API Proxy
 * Handles CORS and secure API calls to Billplz
 */
import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import axios from 'axios';

export const eventHandler: Handler = async (event) => {
  // CORS Headers
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const { action, apiKey, isSandbox, billId, payload } = JSON.parse(event.body || '{}');

    if (!apiKey) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing API Key' })
      };
    }

    const baseUrl = isSandbox 
      ? 'https://www.billplz-sandbox.com/api/v3/' 
      : 'https://www.billplz.com/api/v3/';
    
    const authHeader = `Basic ${Buffer.from(apiKey + ':').toString('base64')}`;

    if (action === 'create_bill') {
      const response = await axios.post(`${baseUrl}bills`, payload, {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      });
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(response.data)
      };
    } else if (action === 'get_bill') {
      if (!billId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Missing Bill ID' })
        };
      }
      const response = await axios.get(`${baseUrl}bills/${billId}`, {
        headers: {
          'Authorization': authHeader
        }
      });
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(response.data)
      };
    }

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid action' })
    };

  } catch (error: any) {
    console.error('[billplz-proxy] Error:', error.response?.data || error.message);
    return {
      statusCode: error.response?.status || 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: error.response?.data?.error?.message || error.message || 'Internal server error' 
      })
    };
  }
};

export default toWebFunction(eventHandler)
