const pool = require("../config/database");

exports.checkout = async (req, res) => {
    const { items, payment_method, delivery_address, customer_name, phone, delivery_fee, delivery_method } = req.body;
    const safeDeliveryFee = Number(delivery_fee) >= 0 ? Number(delivery_fee) : 0;
    const safeDeliveryMethod = delivery_method === "pickup" ? "pickup" : "delivery";

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Cart items are required." });
    }

    if (!payment_method || !delivery_address) {
        return res.status(400).json({ error: "Payment method and delivery address are required." });
    }

    if (!customer_name || !phone) {
        return res.status(400).json({ error: "Customer name and phone are required." });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        let total = 0;
        const validatedItems = [];

        for (const item of items) {
            const productId = Number(item.productId);
            const variantId = item.variantId ? Number(item.variantId) : null;
            const quantity = Number(item.quantity);

            if (!productId || !quantity || quantity <= 0) {
                await client.query("ROLLBACK");
                return res.status(400).json({ error: "Invalid item in cart." });
            }

            if (variantId) {
                const variantResult = await client.query(
                    "SELECT id, product_id, variant_name, price, stock FROM product_variants WHERE id = $1 AND product_id = $2",
                    [variantId, productId]
                );

                if (variantResult.rows.length === 0) {
                    await client.query("ROLLBACK");
                    return res.status(404).json({ error: `Variant not found for product ${productId}.` });
                }

                const variant = variantResult.rows[0];

                if (variant.stock < quantity) {
                    await client.query("ROLLBACK");
                    return res.status(409).json({
                        error: `Not enough stock for ${variant.variant_name}. Only ${variant.stock} left.`
                    });
                }

                const itemPrice = Number(variant.price);
                total += itemPrice * quantity;

                validatedItems.push({
                    productId,
                    variantId,
                    quantity,
                    price: itemPrice
                });

            } else {
                const productResult = await client.query(
                    "SELECT id, name, price, stock FROM products WHERE id = $1",
                    [productId]
                );

                if (productResult.rows.length === 0) {
                    await client.query("ROLLBACK");
                    return res.status(404).json({ error: `Product with id ${productId} not found.` });
                }

                const product = productResult.rows[0];

                if (product.stock < quantity) {
                    await client.query("ROLLBACK");
                    return res.status(409).json({
                        error: `Not enough stock for ${product.name}. Only ${product.stock} left.`
                    });
                }

                const itemPrice = Number(product.price);
                total += itemPrice * quantity;

                validatedItems.push({
                    productId,
                    variantId: null,
                    quantity,
                    price: itemPrice
                });
            }
        }

        const finalTotal = total + safeDeliveryFee;

        const orderResult = await client.query(
            `INSERT INTO orders
                (user_id, customer_name, phone, total, payment_method, delivery_address, status, delivery_fee, delivery_method)
             VALUES (NULL, $1, $2, $3, $4, $5, 'pending', $6, $7)
             RETURNING *`,
            [customer_name, phone, finalTotal, payment_method, delivery_address, safeDeliveryFee, safeDeliveryMethod]
        );

        const order = orderResult.rows[0];

        for (const item of validatedItems) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, quantity, price)
                 VALUES ($1, $2, $3, $4)`,
                [order.id, item.productId, item.quantity, item.price]
            );

            if (item.variantId) {
                await client.query(
                    "UPDATE product_variants SET stock = stock - $1 WHERE id = $2",
                    [item.quantity, item.variantId]
                );
            } else {
                await client.query(
                    "UPDATE products SET stock = stock - $1 WHERE id = $2",
                    [item.quantity, item.productId]
                );
            }
        }

        await client.query("COMMIT");

        res.status(201).json({
            message: "Order placed successfully.",
            order
        });

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Checkout error:", error);
        res.status(500).json({ error: "Something went wrong while placing your order." });
    } finally {
        client.release();
    }
};

exports.getMyOrders = async (req, res) => {
    try {
        const userId = req.user.userId;

        const orders = await pool.query(
            `SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
            [userId]
        );

        res.json(orders.rows);

    } catch (error) {
        console.error("Get my orders error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};
