const pool = require("../config/database");


// Create order
exports.createOrder = async (req, res) => {

try {

const {
customer_name,
phone,
total,
payment_method,
delivery_address,
items
} = req.body;


// Create order

const order = await pool.query(
`
INSERT INTO orders
(customer_name, phone, total, payment_method, delivery_address)
VALUES ($1,$2,$3,$4,$5)
RETURNING *
`,
[
customer_name,
phone,
total,
payment_method,
delivery_address
]
);


const orderId = order.rows[0].id;


// Save order items

for (const item of items) {

await pool.query(
`
INSERT INTO order_items
(order_id, product_id, quantity, price)
VALUES ($1,$2,$3,$4)
`,
[
orderId,
item.id,
item.quantity,
item.price
]
);

}


res.json({
message:"Order created successfully",
order:order.rows[0]
});


}
catch(error){

res.status(500).json({
error:error.message
});

}

};




// Get orders

exports.getOrders = async (req,res)=>{

try{

const orders = await pool.query(
`
SELECT *
FROM orders
ORDER BY created_at DESC
`
);


res.json(orders.rows);


}
catch(error){

res.status(500).json({
error:error.message
});

}

};
