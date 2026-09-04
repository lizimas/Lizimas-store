require('dotenv').config();
const { pool } = require('../config/database');
const jumiaService = require('../services/jumiaService');

async function importJumiaProducts() {
  try {
    console.log('🚀 Starting Jumia product import...');
    
    // Get products from Jumia
    const response = await jumiaService.getProducts({ limit: 50 });
    const products = response?.products || [];
    
    if (products.length === 0) {
      console.log('⚠️ No products found on Jumia');
      console.log('💡 Make sure you have products listed as a seller');
      process.exit(0);
    }
    
    console.log(`📦 Found ${products.length} products on Jumia`);
    
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const p of products) {
      try {
        // Check if product already exists
        const existing = await pool.query(
          'SELECT id FROM products WHERE public_code = $1 OR name = $2',
          [p.sku || p.id, p.name || p.title]
        );
        
        if (existing.rowCount > 0) {
          skipped++;
          console.log(`⏭️  Skipped (already exists): ${p.name || p.title}`);
          continue;
        }
        
        // Insert product
        await pool.query(`
          INSERT INTO products (
            name, description, price, stock, image, 
            brand, category_id, public_code, status,
            product_weight_kg, color, material
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', $9, $10, $11)
        `, [
          p.name || p.title || 'No name',
          p.description || '',
          parseFloat(p.price || p.selling_price || 0),
          parseInt(p.stock || p.quantity || 0),
          p.image || p.image_url || p.main_image || '',
          p.brand || p.manufacturer || '',
          parseInt(p.category_id) || 1,
          p.sku || p.id || `JUM-${Date.now()}`,
          parseFloat(p.weight || p.product_weight_kg || 0),
          p.color || '',
          p.material || ''
        ]);
        
        imported++;
        console.log(`✅ Imported: ${p.name || p.title}`);
      } catch (err) {
        errors++;
        console.error(`❌ Failed to import ${p.name || p.title}:`, err.message);
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Imported: ${imported} products`);
    console.log(`   ⏭️  Skipped: ${skipped} (already exist)`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   📦 Total: ${products.length} products processed`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error importing Jumia products:', error.message);
    if (error.response?.data) {
      console.error('   Details:', error.response.data);
    }
    process.exit(1);
  }
}

importJumiaProducts();
