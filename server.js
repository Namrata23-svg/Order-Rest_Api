const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');

const app = express();
app.use(bodyParser.json());
app.use(express.json());

const CryptoJS = require('crypto-js');
const secretKey = 'namratasecretkey';

function encrypt(text) {
    return CryptoJS.AES.encrypt(text, secretKey).toString();
}

function decrypt(text) {
    const bytes = CryptoJS.AES.decrypt(text, secretKey);
    return bytes.toString(CryptoJS.enc.Utf8);
}


const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'test'
});

// 1) Create Person
app.post('/person', async (req, res) => {
    const { party } = req.body;

    if (!party || !party.person) {
        return res.status(400).json({ error: 'Both party and person data are required' });
    }

    const {
        partyId: party_id,
        partyTypeEnumId: party_enum_type_id,
        person: {
            party_id: person_party_id,
            first_name,
            middle_name,
            last_name,
            gender,
            birth_date,
            marital_status_enum_id,
            employment_status_enum_id,
            occupation
        }
    } = party;

    if (!party_id || !party_enum_type_id || !person_party_id || !first_name || !last_name) {
        return res.status(400).json({ error: 'Required fields are missing' });
    }

    try {
        await pool.query(
            'INSERT INTO party (party_id, party_enum_type_id) VALUES (?, ?)',
            [party_id, party_enum_type_id]
        );
        await pool.query(
            'INSERT INTO person (party_id, first_name, middle_name, last_name, gender, birth_date, marital_status_enum_id, employment_status_enum_id, occupation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [person_party_id, first_name, middle_name, last_name, gender, birth_date, marital_status_enum_id, employment_status_enum_id, occupation]
        );

        res.status(201).json({ message: 'Person data successfully created' });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 2) Create Order
app.post('/order_header', async (req, res) => {
    const order_data  = req.body;
    console.log(order_data)

    if (!order_data.order_name || !order_data.placed_date) {
        return res.status(400).json({ error: 'Order name and order date are required' });
    }
    if(!order_data.currency_uom_id || order_data.currency_uom_id === ""){
        order_data.currency_uom_id = "USD";
    }
    if(!order_data.status_id || order_data.status_id === ""){
        order_data.status_id = "OrderPlaced";
    }


    const {
        order_id,
        order_name,
        placed_date,
        approved_date,
        status_id,
        party_id,
        currency_uom_id,
        product_store_id,
        sales_channel_enum_id,
        grand_total,
        completed_date,
        credit_card
    } = order_data;


    try {

        const encryptedCreditCard = encrypt(credit_card);
        const [result] = await pool.query(
            `INSERT INTO order_header 
            (order_id, order_name, placed_date, approved_date, status_id, party_id, currency_uom_id, product_store_id, sales_channel_enum_id, grand_total, completed_date, credit_card) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [order_id, order_name, placed_date, approved_date, status_id, party_id, currency_uom_id, product_store_id, sales_channel_enum_id, grand_total, completed_date, encryptedCreditCard]
        );



        res.status(201).json({ message: 'Order successfully created' , orderId:order_data.orderId});
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 3) Add order_items
app.post('/order/items', async (req, res) => {
    const {
        order_id,
        order_name,
        placed_date,
        approved_date,
        status_id ,
        party_id,
        currency_uom_id ,
        product_store_id,
        sales_channel_enum_id,
        grand_total,
        completed_date,
        credit_card,
        order_items
    } = req.body;

    if (!order_id || !order_name || !placed_date || !party_id || !order_items || !Array.isArray(order_items)) {
        return res.status(400).json({ error: 'Mandatory fields missing: order_id, order_name, placed_date, party_id, and order_items are required.' });
    }

    for (const item of order_items) {
        if (!item.product_id || !item.quantity || !item.unit_amount) {
            return res.status(400).json({ error: 'Each order item must have product_id, quantity, and unit_amount.' });
        }
    }

    const connection = await pool.getConnection();

    try {
        const encryptedCreditCard = encrypt(credit_card);
        await connection.beginTransaction();

        await connection.query(
            `INSERT INTO order_header 
            (order_id, order_name, placed_date, approved_date, status_id, party_id, currency_uom_id, product_store_id, sales_channel_enum_id, grand_total, completed_date, credit_card) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [order_id, order_name, placed_date, approved_date, status_id, party_id, currency_uom_id, product_store_id, sales_channel_enum_id, grand_total, completed_date, encryptedCreditCard]
        );

        for (const item of order_items) {
            await connection.query(
                `INSERT INTO order_item 
                (order_id, order_item_seq_id, product_id, item_description, quantity, unit_amount, item_type_enum_id) 
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [order_id, item.order_item_seq_id, item.product_id, item.item_description, item.quantity, item.unit_amount, item.item_type_enum_id]
            );
        }

        await connection.commit();

        res.status(201).json({ message: 'Order successfully created', orderId: order_id });
    } catch (error) {
        await connection.rollback();
        console.error('Database error:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        connection.release();
    }
});

// 4) Get all orders
app.get('/orders', async (req, res) => {
    try {
        const [orders] = await pool.query(`
            SELECT 
                oh.order_id,
                oh.order_name,
                oh.placed_date,
                oh.approved_date,
                oh.status_id,
                oh.party_id,
                oh.currency_uom_id,
                oh.product_store_id,
                oh.sales_channel_enum_id,
                oh.grand_total,
                oh.completed_date,
                oh.credit_card,
                oi.order_item_seq_id,
                oi.product_id,
                oi.item_description,
                oi.quantity,
                oi.unit_amount,
                oi.item_type_enum_id
            FROM order_header oh
            LEFT JOIN order_item oi ON oh.order_id = oi.order_id
        `);

        const ordersMap = new Map();

        orders.forEach(order => {
            const decryptedCreditCard = decrypt(order.credit_card);
            if (!ordersMap.has(order.order_id)) {
                ordersMap.set(order.order_id, {
                    order_id: order.order_id,
                    order_name: order.order_name,
                    placed_date: order.placed_date,
                    approved_date: order.approved_date,
                    status_id: order.status_id,
                    party_id: order.party_id,
                    currency_uom_id: order.currency_uom_id,
                    product_store_id: order.product_store_id,
                    sales_channel_enum_id: order.sales_channel_enum_id,
                    grand_total: order.grand_total,
                    completed_date: order.completed_date,
                    credit_card: decryptedCreditCard,
                    order_items: []
                });
            }

            if (order.order_item_seq_id) {
                ordersMap.get(order.order_id).order_items.push({
                    order_item_seq_id: order.order_item_seq_id,
                    product_id: order.product_id,
                    item_description: order.item_description,
                    quantity: order.quantity,
                    unit_amount: order.unit_amount,
                    item_type_enum_id: order.item_type_enum_id
                });
            }
        });

        const ordersList = Array.from(ordersMap.values());

        res.json({ orders: ordersList });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 5) Get an order
app.get('/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const [orders] = await pool.query(`
            SELECT 
                oh.order_id,
                oh.order_name,
                oh.placed_date,
                oh.approved_date,
                oh.status_id,
                oh.party_id,
                oh.currency_uom_id,
                oh.product_store_id,
                oh.sales_channel_enum_id,
                oh.grand_total,
                oh.completed_date,
                oh.credit_card,
                oi.order_item_seq_id,
                oi.product_id,
                oi.item_description,
                oi.quantity,
                oi.unit_amount,
                oi.item_type_enum_id
            FROM order_header oh
            LEFT JOIN order_item oi ON oh.order_id = oi.order_id
            WHERE oh.order_id = ?
        `,[orderId]);

        const ordersMap = new Map();

        orders.forEach(order => {
            const decryptedCreditCard = decrypt(order.credit_card);
            
            if (!ordersMap.has(order.order_id)) {
                ordersMap.set(order.order_id, {
                    order_id: order.order_id,
                    order_name: order.order_name,
                    placed_date: order.placed_date,
                    approved_date: order.approved_date,
                    status_id: order.status_id,
                    party_id: order.party_id,
                    currency_uom_id: order.currency_uom_id,
                    product_store_id: order.product_store_id,
                    sales_channel_enum_id: order.sales_channel_enum_id,
                    grand_total: order.grand_total,
                    completed_date: order.completed_date,
                    credit_card: decryptedCreditCard,
                    order_items: []
                });
            }

            if (order.order_item_seq_id) {
                ordersMap.get(order.order_id).order_items.push({
                    order_item_seq_id: order.order_item_seq_id,
                    product_id: order.product_id,
                    item_description: order.item_description,
                    quantity: order.quantity,
                    unit_amount: order.unit_amount,
                    item_type_enum_id: order.item_type_enum_id
                });
            }
        });

        const ordersList = Array.from(ordersMap.values());
        
        

        res.json({ orders: ordersList });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// 6) Update order
app.put('/orders/:orderId', async (req, res) => {
    const orderId = req.params.orderId;
    const { order_name } = req.body;

    if (!order_name) {
        return res.status(400).json({ error: 'Order name is required' });
    }

    try {
        const [updateResult] = await pool.query(
            `UPDATE order_header SET order_name = ? WHERE order_id = ?`,
            [order_name, orderId]
        );

        if (updateResult.affectedRows === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const [orderResult] = await pool.query(
            `SELECT 
                order_id,
                order_name,
                currency_uom_id,
                sales_channel_enum_id,
                status_id,
                product_store_id,
                placed_date,
                approved_date,
                grand_total
            FROM order_header WHERE order_id = ?`,
            [orderId]
        );

        if (orderResult.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const updatedOrder = orderResult[0];

        res.json({
            order_id: updatedOrder.order_id,
            order_name: updatedOrder.order_name,
            currency_uom_id: updatedOrder.currency_uom_id,
            sales_channel_enum_id: updatedOrder.sales_channel_enum_id,
            status_id: updatedOrder.status_id,
            product_store_id: updatedOrder.product_store_id,
            placed_date: updatedOrder.placed_date,
            approved_date: updatedOrder.approved_date,
            grand_total: updatedOrder.grand_total
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create a party
app.post('/party', async (req, res) => {
    const party_data = req.body.party;
    const party_id = party_data.party_id;
    console.log(party_id);
    const party_enum_type_id = party_data.party_enum_type_id;
    console.log(party_enum_type_id);
    console.log(req.body);
    if (!party_id || !party_enum_type_id) {
        return res.status(400).json({ error: 'party_id and party_enum_type_id are required' });
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO party (party_id, party_enum_type_id) VALUES (?, ?)',
            [party_id, party_enum_type_id]
        );
        res.status(201).json({ id: result.insertId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get a party
app.get('/party/:partyId', async (req, res) => {
    const { partyId } = req.params;

    try {
       
        const [partyResult] = await pool.query(
            'SELECT * FROM party WHERE party_id = ?',
            [partyId]
        );

        if (partyResult.length === 0) {
            return res.status(404).json({ error: 'Party not found' });
        }

        const [personResult] = await pool.query(
            'SELECT * FROM person WHERE party_id = ?',
            [partyId]
        );
        const response = {
            party: partyResult[0]
        };

        if (personResult.length > 0) {
            response.person = personResult[0];
        }

        res.status(200).json(response);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

//Create a product
app.post('/product', async (req, res) => {
    console.log('Request Body:', req.body); 

    const { product } = req.body;

    if (!product) {
        return res.status(400).json({ error: 'Product data is required' });
    }

    const { product_id, party_id, product_name, description, charge_shipping, returnable } = product;

    if (!product_id || !party_id || !product_name || !description || !charge_shipping || !returnable) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    try {
        const [result] = await pool.query(
            'INSERT INTO product (product_id, party_id, product_name, description, charge_shipping, returnable) VALUES (?, ?, ?, ?, ?, ?)',
            [product_id, party_id, product_name, description, charge_shipping, returnable]
        );

        res.status(201).json({ id: result.insertId });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

//Get a product
app.get('/product/:productId', async (req, res) => {
    const { productId } = req.params;

    try {
        const [productResult] = await pool.query(
            'SELECT * FROM product WHERE product_id = ?',
            [productId]
        );

        if (productResult.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const [partyResult] = await pool.query(
            'SELECT * FROM party WHERE party_id = ?',
            [productResult[0].party_id]
        );
        const response = {
            product: productResult[0]
        };

        if (partyResult.length > 0) {
            response.party = partyResult[0];
        }

        res.status(200).json(response);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
