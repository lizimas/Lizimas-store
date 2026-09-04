require('dotenv').config();
const { pool } = require('../config/database');

async function createTable() {
  try {
    console.log('🔄 Creating products table...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        sku VARCHAR(255) UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        compare_at_price DECIMAL(10,2),
        cost_price DECIMAL(10,2),
        image_url TEXT,
        image_urls TEXT[],
        brand VARCHAR(255),
        category VARCHAR(255),
        subcategory VARCHAR(255),
        stock_quantity INTEGER DEFAULT 0,
        weight DECIMAL(8,2),
        weight_unit VARCHAR(10) DEFAULT 'kg',
        supplier VARCHAR(100) DEFAULT 'manual',
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
      CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
    `);
    
    console.log('✅ Products table created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating table:', error.message);
    process.exit(1);
  }
}

createTable();
