const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('السيرفر شغال على ' + PORT));
const JWT_SECRET = 'print-club-secret-2026-change-me';

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

const db = new Database('printclub.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT DEFAULT 's',
    price INTEGER DEFAULT 5,
    image TEXT,
    stock INTEGER DEFAULT 100,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    city TEXT NOT NULL,
    address TEXT NOT NULL,
    notes TEXT,
    total_items INTEGER,
    total_price INTEGER,
    status TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    product_id INTEGER,
    product_name TEXT,
    qty INTEGER,
    price INTEGER,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );
`);

const adminExists = db.prepare('SELECT * FROM admins WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run('admin', hash);
  console.log('تم انشاء ادمن: admin / admin123');
}

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
const upload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
  })
});

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'لازم تسجل دخول' });
  try { req.admin = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'توكن غير صالح' }); }
}

app.get('/api/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY created_at DESC').all();
  res.json(products);
});

app.post('/api/orders', (req, res) => {
  const { customer_name, phone, city, address, notes, items } = req.body;
  if (!customer_name || !phone || !city || !address || !items?.length)
    return res.status(400).json({ error: 'ناقص بيانات' });
  let total_items = 0, total_price = 0;
  items.forEach(i => { total_items += i.qty; total_price += i.qty * i.price; });
  const order = db.prepare('INSERT INTO orders (customer_name, phone, city, address, notes, total_items, total_price) VALUES (?,?,?,?,?,?,?)')
    .run(customer_name, phone, city, address, notes || '', total_items, total_price);
  const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, qty, price) VALUES (?,?,?,?,?)');
  items.forEach(i => insertItem.run(order.lastInsertRowid, i.product_id, i.product_name, i.qty, i.price));
  res.json({ success: true, order_id: order.lastInsertRowid, total_price });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password))
    return res.status(401).json({ error: 'اسم أو باسورد غلط' });
  const token = jwt.sign({ id: admin.id, username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username });
});

app.post('/api/admin/products', auth, upload.single('image'), (req, res) => {
  const { name, category, price, stock } = req.body;
  const image = req.file ? '/uploads/' + req.file.filename : null;
  const r = db.prepare('INSERT INTO products (name, category, price, image, stock) VALUES (?,?,?,?,?)')
    .run(name, category || 's', price || 5, image, stock || 100);
  res.json({ success: true, id: r.lastInsertRowid });
});

app.delete('/api/admin/products/:id', auth, (req, res) => {
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/orders', auth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  orders.forEach(o => {
    o.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
  });
  res.json(orders);
});

app.put('/api/admin/orders/:id/status', auth, (req, res) => {
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/stats', auth, (req, res) => {
  const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const totalRevenue = db.prepare('SELECT SUM(total_price) as s FROM orders').get().s || 0;
  const todayOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now')").get().c;
  res.json({ totalOrders, totalRevenue, todayOrders });
});

app.listen(PORT, () => console.log(`السيرفر شغال على http://localhost:${PORT}`));
