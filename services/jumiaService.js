require('dotenv').config();
const axios = require('axios');

class JumiaService {
  constructor() {
    this.clientId = process.env.JUMIA_CLIENT_ID;
    this.clientSecret = process.env.JUMIA_CLIENT_SECRET;
    this.baseUrl = process.env.JUMIA_API_URL || 'https://api.jumia.com/ug/v1';
    this.accessToken = null;
  }

  // Get OAuth token
  async getAccessToken() {
    try {
      console.log('🔄 Getting Jumia access token...');
      
      const response = await axios.post(
        `${this.baseUrl}/oauth/token`,
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials'
        },
        {
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );

      this.accessToken = response.data.access_token;
      console.log('✅ Jumia access token obtained');
      return this.accessToken;
    } catch (error) {
      console.error('❌ Failed to get Jumia token:');
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Data:', error.response.data);
      } else {
        console.error('   Error:', error.message);
      }
      throw error;
    }
  }

  // Get products from your Jumia catalog
  async getProducts(params = {}) {
    try {
      const token = await this.getAccessToken();
      
      console.log('🔄 Fetching products from Jumia...');
      
      const response = await axios.get(`${this.baseUrl}/products`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        params: {
          limit: params.limit || 50,
          page: params.page || 1
        }
      });

      console.log(`✅ Retrieved ${response.data?.products?.length || 0} products`);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to fetch products:');
      if (error.response) {
        console.error('   Status:', error.response.status);
        console.error('   Data:', error.response.data);
      } else {
        console.error('   Error:', error.message);
      }
      throw error;
    }
  }
}

module.exports = new JumiaService();
