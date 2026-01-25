const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { neon } = require('@neondatabase/serverless');
const { drizzle } = require('drizzle-orm/neon-http');
const { eq, and, desc } = require('drizzle-orm');
const { users, products, orders, cartItems } = require('./db/schema');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const cors = require('cors'); // Must be all lowercase
// Neon Connection
const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql);

app.use(cors());
app.use(express.json());

// Auth Middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Token required' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const [user] = await db.select().from(users).where(eq(users.id, decoded.userId));
    if (!user) return res.status(401).json({ message: 'User not found' });
    req.user = user;
    next();
  } catch (error) {
    res.status(403).json({ message: 'Invalid token' });
  }
};

// ==================== AUTH ROUTES ====================

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) return res.status(400).json({ message: 'Email exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const [newUser] = await db.insert(users).values({ name, email, password: hashedPassword }).returning();
    
    const token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: newUser.id, name: newUser.name } });
  } catch (error) {
    res.status(500).json({ message: 'Signup error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name } });
  } catch (error) {
    res.status(500).json({ message: 'Login error' });
  }
});

// ==================== CART ROUTES ====================

app.get('/api/cart', authenticateToken, async (req, res) => {
  try {
    const items = await db.select().from(cartItems).where(eq(cartItems.userId, req.user.id));
    res.json({ items });
  } catch (error) {
    res.status(500).json({ message: 'Cart fetch error' });
  }
});

app.post('/api/cart', authenticateToken, async (req, res) => {
  try {
    const { items } = req.body;
    await db.delete(cartItems).where(eq(cartItems.userId, req.user.id));
    if (items?.length > 0) {
      await db.insert(cartItems).values(items.map(i => ({ ...i, userId: req.user.id, productId: i.id })));
    }
    res.json({ message: 'Cart synced' });
  } catch (error) {
    res.status(500).json({ message: 'Cart update error' });
  }
});

// ==================== ORDER ROUTES ====================

app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const { items, shippingAddress, paymentMethod, totalAmount } = req.body;
    const [order] = await db.insert(orders).values({
      userId: req.user.id,
      items,
      shippingAddress,
      paymentMethod: paymentMethod || 'cod',
      totalAmount: totalAmount.toString()
    }).returning();
    
    await db.delete(cartItems).where(eq(cartItems.userId, req.user.id));
    res.status(201).json({ message: 'Order placed', order });
  } catch (error) {
    res.status(500).json({ message: 'Order error' });
  }
});

// ==================== HEALTH & START ====================

app.get('/api/health', async (req, res) => {
  const result = await sql`SELECT now()`;
  res.json({ status: 'OK', time: result[0].now });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));

module.exports = app; // Essential for Vercel