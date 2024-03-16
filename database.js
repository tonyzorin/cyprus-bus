const { Pool } = require('pg');
require('dotenv').config(); // If you are using dotenv to manage your environment variables

const pool = new Pool({
//    user: "process.env.POSTGRES_USER",
//    host: "process.env.POSTGRES_HOST",
//    database: "process.env.POSTGRES_DB",
    user: "tonyzorin",
    host: "ec2-3-73-155-99.eu-central-1.compute.amazonaws.com",
    database: "cy-transit",
    password: "[>&As9$6eRTn!ee!.9a!bDDq@d>Q5)(W3TfxvTnf", // It's safer to use an environment variable for the password
    max: 20, // Example: set pool size to 20
    idleTimeoutMillis: 30000, // Example: close idle clients after 30 seconds
    connectionTimeoutMillis: 10000,
});

module.exports = {
    query: (text, params, callback) => pool.query(text, params, callback),
};