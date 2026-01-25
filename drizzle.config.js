import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  schema: './db/schema.js', // Path to your schema file
  out: './drizzle',         // Where migrations will be stored
  dialect: 'postgresql',    // The database type
  dbCredentials: {
    url: process.env.DATABASE_URL, // Your Neon connection string
  },
});