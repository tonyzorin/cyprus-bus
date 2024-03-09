const { Pool } = require('pg');
//require('dotenv').config(); // If you are using dotenv to manage your environment variables

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres',
    password: 'postgres',//process.env.POSTGRES_PASSWORD, // It's safer to use an environment variable for the password
    //Port: 5432,
    max: 20, // Example: set pool size to 20
    idleTimeoutMillis: 30000, // Example: close idle clients after 30 seconds
    connectionTimeoutMillis: 2000,
});

module.exports = {
    query: (text, params, callback) => pool.query(text, params, callback),
};