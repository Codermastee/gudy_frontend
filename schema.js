const { pgTable, serial, text, integer, timestamp, boolean, jsonb, decimal } = require('drizzle-orm/pg-core');

// Users Table
const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique().notNull(),
  password: text('password').notNull(),
  isAdmin: boolean('is_admin').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

// Products Table
const products = pgTable('products', {
  id: text('id').primaryKey(), 
  name: text('name').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull(),
  image: text('image').notNull(),
  badge: text('badge').notNull(),
  discount: integer('discount').notNull(),
  variants: jsonb('variants').notNull(), 
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Orders Table
const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  items: jsonb('items').notNull(),
  shippingAddress: jsonb('shipping_address').notNull(),
  paymentMethod: text('payment_method').default('cod'),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  status: text('status').default('pending'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Cart Items Table
const cartItems = pgTable('cart_items', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id).notNull(),
  productId: text('product_id').notNull(),
  name: text('name').notNull(),
  weight: text('weight').notNull(),
  priceINR: integer('price_inr').notNull(),
  image: text('image'),
  quantity: integer('quantity').default(1),
  updatedAt: timestamp('updated_at').defaultNow(),
});

module.exports = { users, products, orders, cartItems };