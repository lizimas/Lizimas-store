const pool = require("../config/database");
const { sendOrderStatusSms } = require("../utils/sms");
const { sendOrderStatusEmail, sendOrderConfirmationEmail } = require("../utils/mailer");
const { sign: signReceipt } = require("../routes/receipt");
const { priceOrder } = require("../utils/deliveryPricing");

// Base URL for links that leave the app (emails, receipts). Hardcoding the
// production domain makes locally generated links unusable, since they resolve
// against production where the local order does not exist.
const PUBLIC_BASE_URL =
    String(process.env.PUBLIC_BASE_URL || "https://lizimasstore.com").replace(/\/+$/, "");

exports.checkout = async (req, res) => {
    const { items, payment_method, delivery_address, customer_name, phone, alt_phone, delivery_fee, delivery_method } = req.body;

    // Structured address parts. delivery_division / delivery_area are also
    // sent by the client but are display strings only - the zone and the
    // ancestry are both resolved from location_id server-side below.
    const locationId = Number(req.body.location_id) > 0 ? Number(req.body.location_id) : null;
    const deliveryVillage = (req.body.delivery_area_text || "").trim() || null;
    const deliveryStreet = (req.body.delivery_street || "").trim() || null;
    const deliveryBuilding = (req.body.delivery_building || "").trim() || null;
    const deliveryLandmark = (req.body.delivery_landmark || "").trim() || null;
    const safeDeliveryFee = Number(delivery_fee) >= 0 ? Number(delivery_fee) : 0;
    const safeDeliveryMethod = delivery_method === "pickup" ? "pickup" : "delivery";
    const userId = req.user ? req.user.userId : null;

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
            const colorId = item.colorId ? Number(item.colorId) : null;
            const sizeId = item.sizeId ? Number(item.sizeId) : null;

            if (!productId || !quantity || quantity <= 0) {
                await client.query("ROLLBACK");
                return res.status(400).json({ error: "Invalid item in cart." });
            }

            if (variantId) {
                const variantResult = await client.query(
                    "SELECT v.id, v.product_id, v.variant_name, v.price, v.stock, p.name AS product_name, COALESCE(v.image_path, p.image) AS image_url, c.name AS color_name, s.name AS size_name FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN product_colors c ON c.id = v.color_id LEFT JOIN product_sizes s ON s.id = v.size_id WHERE v.id = $1 AND v.product_id = $2",
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
                    productName: variant.product_name, imageUrl: variant.image_url, variantColor: variant.color_name || variant.variant_name, variantSize: variant.size_name || null,
                    quantity,
                    price: itemPrice
                });

            } else {
                const productResult = await client.query(
                    "SELECT id, name, price, stock, COALESCE(image, (SELECT image_path FROM product_images WHERE product_id = products.id ORDER BY COALESCE(display_order, 999999), id LIMIT 1)) AS image FROM products WHERE id = $1",
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

                let colorName = null;
                if (colorId) {
                    const cr = await client.query(
                        "SELECT name FROM product_colors WHERE id = $1 AND product_id = $2",
                        [colorId, productId]
                    );
                    colorName = cr.rows.length ? cr.rows[0].name : null;
                }
                let sizeName = null;
                if (sizeId) {
                    const sr = await client.query(
                        "SELECT name FROM product_sizes WHERE id = $1 AND product_id = $2",
                        [sizeId, productId]
                    );
                    sizeName = sr.rows.length ? sr.rows[0].name : null;
                }
                const itemPrice = Number(product.price);
                total += itemPrice * quantity;

                validatedItems.push({
                    productId,
                    variantId: null,
                    productName: product.name, imageUrl: product.image, variantColor: colorName, variantSize: sizeName,
                    quantity,
                    price: itemPrice
                });
            }
        }

        let effectiveDeliveryFee = safeDeliveryFee;

        // -------------------------------------------------------------
        // Resolve the delivery location server-side.
        // An unknown or inactive location_id degrades to NULL rather than
        // failing the order: delivery_address still carries the full text,
        // so a bad id costs reporting granularity, not a sale.
        // -------------------------------------------------------------
        let resolvedLocationId = null;
        let locationPath = null;
        let zoneId = null;
        let zoneName = null;

        if (locationId) {
            const locCheck = await client.query(
                "SELECT id FROM locations WHERE id = $1 AND is_active",
                [locationId]
            );

            if (locCheck.rows.length) {
                resolvedLocationId = locationId;

                // resolve_delivery_zone() RETURNS delivery_zones, so the whole
                // row comes back - id and zone name included.
                const zoneRow = await client.query(
                    "SELECT id, zone FROM resolve_delivery_zone($1)",
                    [locationId]
                );
                if (zoneRow.rows.length && zoneRow.rows[0].id) {
                    zoneId = zoneRow.rows[0].id;
                    zoneName = zoneRow.rows[0].zone;
                }

                // locations.path stores ancestor ids as /1/62/263/1221/.
                // Expand it to names and append the location itself. Level 3
                // (county) is skipped so the snapshot reads the same way the
                // customer-facing cascade did: Region / District / Division / Area.
                const pathRow = await client.query(
                    `WITH target AS (
                         SELECT id, name, level, path FROM locations WHERE id = $1
                     )
                     SELECT string_agg(x.name, ' / ' ORDER BY x.level) AS label
                       FROM (
                            SELECT a.name, a.level
                              FROM target t
                              JOIN locations a
                                ON a.id = ANY (
                                     string_to_array(
                                         NULLIF(trim(both '/' from COALESCE(t.path, '')), ''),
                                         '/'
                                     )::int[]
                                   )
                             WHERE a.level <> 3
                            UNION ALL
                            SELECT t.name, t.level FROM target t
                       ) x`,
                    [locationId]
                );
                locationPath = pathRow.rows.length ? pathRow.rows[0].label : null;
            }
        }

        // -------------------------------------------------------------
        // Re-price delivery from the database. The posted delivery_fee is
        // advisory only: package size comes from products.package_size and
        // the zone from the resolved location, so the client decides
        // neither input to the price.
        // -------------------------------------------------------------
        if (safeDeliveryMethod === "pickup") {
            effectiveDeliveryFee = 0;
        } else if (resolvedLocationId) {
            const pricing = await priceOrder(client, {
                locationId: resolvedLocationId,
                productIds: validatedItems.map(item => item.productId)
            });

            if (pricing.error === "not_serviced") {
                await client.query("ROLLBACK");
                return res.status(404).json({
                    error: "Delivery is not yet available for that area."
                });
            }

            if (pricing.quoteRequired) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    error: "This order needs a custom delivery quote. Please contact us to arrange delivery.",
                    quoteRequired: true,
                    packageSize: pricing.packageSize
                });
            }

            if (Number.isFinite(pricing.fee)) {
                if (pricing.fee !== safeDeliveryFee) {
                    // Almost always a stale checkout page. Use the server
                    // figure and record the gap rather than failing the sale.
                    console.warn(
                        `Delivery fee mismatch: client sent ${safeDeliveryFee}, server priced ${pricing.fee} (location ${resolvedLocationId}, size ${pricing.packageSize})`
                    );
                }
                effectiveDeliveryFee = pricing.fee;
            }
        } else {
            // No usable location id - nothing to price against, so the
            // client figure stands. Worth watching if it appears often.
            console.warn(`Order priced without a location_id; trusting client fee ${safeDeliveryFee}`);
        }

        const rawEmail = (req.body.customer_email || "").trim().toLowerCase();
        let customerEmail = rawEmail || null;
        if (!customerEmail && userId) {
            const ur = await client.query("SELECT email FROM users WHERE id = $1", [userId]);
            customerEmail = ur.rows[0] ? ur.rows[0].email : null;
        }
        if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
            console.warn(`Rejected malformed customer_email on checkout: ${customerEmail}`);
            customerEmail = null;
        }

        const finalTotal = total + effectiveDeliveryFee;

        const orderResult = await client.query(
            `INSERT INTO orders
                (user_id, customer_name, phone, alt_phone, total, payment_method, delivery_address, status, delivery_fee, delivery_method,
                 delivery_location_id, delivery_location_path, delivery_zone_id, delivery_zone_name,
                 delivery_village, delivery_street, delivery_building, delivery_landmark,
                 delivery_recipient, delivery_phone, delivery_phone_alt, customer_email, subtotal)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9,
                     $10, $11, $12, $13,
                     $14, $15, $16, $17,
                     $18, $19, $20, $21, $22)
             RETURNING *`,
            [userId, customer_name, phone, alt_phone || null, finalTotal, payment_method, delivery_address, effectiveDeliveryFee, safeDeliveryMethod,
             resolvedLocationId, locationPath, zoneId, zoneName,
             deliveryVillage, deliveryStreet, deliveryBuilding, deliveryLandmark,
             customer_name, phone, alt_phone || null, customerEmail, total]
        );

        const order = orderResult.rows[0];

        for (const item of validatedItems) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, quantity, price, product_name, image_url, variant_color, variant_size)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [order.id, item.productId, item.quantity, item.price, item.productName, item.imageUrl, item.variantColor, item.variantSize]
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

        // Order confirmation notifications - best-effort, never block the response
        sendOrderStatusSms(phone, order, "pending").catch(err => console.error("SMS notify error:", err));

        // customer_email is captured at checkout for guests and members alike.
        if (order.customer_email) {
            pool.query(
                "SELECT product_name, quantity, price FROM order_items WHERE order_id = $1 ORDER BY id",
                [order.id]
            )
                .then(function (r) {
                    const receiptUrl = `${PUBLIC_BASE_URL}/receipt/${order.id}?t=${signReceipt(order.id)}`;
                    return sendOrderConfirmationEmail(order.customer_email, order, r.rows, receiptUrl);
                })
                .catch(err => console.error("Confirmation email error:", err));
        } else {
            console.warn(`Order ${order.id} placed with no email - no confirmation sent.`);
        }

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


// GET /api/checkout/track?order_id=123&phone=7XXXXXXXX
// Guest-friendly order lookup - phone should be the 9-digit local number (no +256 prefix)
exports.trackOrder = async (req, res) => {
    try {
        const { order_id, phone } = req.query;

        if (!order_id || !phone) {
            return res.status(400).json({ error: "Order ID and phone number are required." });
        }

        const orderResult = await pool.query(
            "SELECT * FROM orders WHERE id = $1 AND phone = $2",
            [order_id, `+256${phone}`]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: "No matching order found. Please check your Order ID and phone number." });
        }

        const order = orderResult.rows[0];

        const itemsResult = await pool.query(
            `SELECT oi.quantity, oi.price, p.name AS product_name
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = $1`,
            [order.id]
        );

        res.json({ order, items: itemsResult.rows });

    } catch (error) {
        console.error("Track order error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};
