const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET all products
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, price, stock, image, brand, status FROM products WHERE deleted_at IS NULL ORDER BY id DESC'
    );
    res.json({ success: true, products: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET single product by ID
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }
    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET products by category
router.get('/category/:categoryId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, price, stock, image, brand FROM products WHERE category_id = $1 AND deleted_at IS NULL',
      [req.params.categoryId]
    );
    res.json({ success: true, products: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
