const { Pool } = require('pg');
require('dotenv').config();

// Log connection attempt (without sensitive data)
console.log('Attempting to connect to database with:', {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT
});

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: false
});

// Test the connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Error connecting to the database:', err.message);
    } else {
        console.log('Successfully connected to database');
    }
});

// Add error handler for the pool
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err.message);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};