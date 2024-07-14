const { Pool } = require('pg');
require('dotenv').config(); // If you are using dotenv to manage your environment variables

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    max: 20, // Example: set pool size to 20
    idleTimeoutMillis: 30000, // Example: close idle clients after 30 seconds
    connectionTimeoutMillis: 30000,
});

module.exports = {
    query: (text, params, callback) => pool.query(text, params, callback),
};