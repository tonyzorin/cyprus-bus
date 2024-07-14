//const LOGGING_ENABLED = 1; // Set to 0 to disable logging
const LOGGING_ENABLED = process.env.LOGGING_ENABLED === 'true';
const dotenv = require('dotenv')
require('dotenv').config();
const backend = require('express');
const axios = require('axios');
const {connect: connect, query} = require('./database.js');
const app = backend();
const port = process.env.PORT || 3000;
const {readPositionsJson} = require('./parseGTFS');
const fs = require("fs");
const env = process.env.NODE_ENV || 'dev'
app.use(backend.static('./public'));

let lastUpdateTime = null;
let gtfsStatus = 'Checking GTFS feed status...';

async function checkGTFSFeed() {
    try {
        const response = await axios.get(process.env.GTFS_KEY);
        if (response.status === 200) {
            lastUpdateTime = new Date().toLocaleString(); // Update the last update time
            gtfsStatus = `available`;
        } else {
            gtfsStatus = 'unavailable';
            lastUpdateTime = null;
        }
    } catch (error) {
        gtfsStatus = 'GTFS Feed: Unavailable';
        lastUpdateTime = null;
    }
}

app.get('/api/gtfs-status', async (req, res) => {
    await checkGTFSFeed();
    res.json({ gtfsStatus, lastUpdateTime });
});

/*function validateEnvVariables() {
    const requiredEnv = [
        'POSTGRES_USER',
        'POSTGRES_HOST',
        'POSTGRES_DB',
        'POSTGRES_PASSWORD',
    ];

    const missingEnv = requiredEnv.filter(envKey => !process.env[envKey]);

    if (missingEnv.length > 0) {
        throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}`);
    }

    // Additional validation to ensure environment variables have valid formats
    // For example, checking if the HOST is a valid URL or IP
    // This is optional and can be tailored based on specific requirements
    if (!/^[\w.-]+$/.test(process.env.POSTGRES_USER)) {
        throw new Error('Invalid format for POSTGRES_USER');
    }
    if (!/^[\w.-]+(\.[\w.-]+)+$/.test(process.env.POSTGRES_HOST)) {
        throw new Error('Invalid format for POSTGRES_HOST');
    }
    if (!process.env.POSTGRES_PASSWORD) { // Additional specific checks can be added
        throw new Error('POSTGRES_PASSWORD cannot be empty');
    }
}

 */

// Call the validation function at the start of your application
/*try {
    validateEnvVariables();
    console.log('Environment variables validation passed.');
} catch (error) {
    console.error(`Environment variables validation failed: ${error.message}`);
    process.exit(1); // Exit the application if the environment variables are not set correctly
}
*/
function sendTelegramAlert(message) {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const params = {
        chat_id: process.env.CHAT_ID,
        text: message,
    };

    axios.post(url, params)
        .then((response) => {
            console.log("Message sent to Telegram successfully:", response.data);
        })
        .catch((error) => {
            console.error("Failed to send message to Telegram:", error);
        });
}




app.get('/', async (req, res) => {
    await checkGTFSFeed(); // Ensure status is checked before rendering
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/stops', async (req, res) => {
    try {
        const result = await query('SELECT * FROM stops');
        if (!result.rows) throw new Error('No data found');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching stops:', err.message);
        res.status(500).json({ error: 'Internal server error fetching stops', details: err.message });
    }
});


app.get('/api/routes-for-stop/:stopId', async (req, res) => {
    const { stop_id } = req.params;
    try {
        const queryText = `
            SELECT DISTINCT
                routes."routeId",
                routes.agency_id,
                routes.route_short_name,
                routes.route_long_name,
                routes.route_desc,
                routes.route_type,
                routes.route_color,
                routes.route_text_color
            FROM
                routes
                    JOIN
                trips ON routes."routeId" = trips."routeId"
                    JOIN
                stop_times ON trips."tripId" = stop_times.trip_id
                    JOIN
                stops ON stop_times.stop_id = stops.stop_id
            WHERE
                stops.stop_id =  $1
        `;

        // Assuming `query` is a function that executes a SQL query against your database
        // and returns a Promise that resolves with the query result.
        const routes = await query(queryText, [stop_id]);
        res.json(routes.rows); // Send the resulting routes as a JSON response
    } catch (error) {
        console.error('Failed to fetch routes for stop:', error);
        res.status(500).send('Failed to fetch routes for stop');
    }
});


// Function to fetch data from provided url, used to reduce redundancy
const fetchData = async (url, errorMessage) => {
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error(errorMessage, error);
        throw new Error(errorMessage);
    }
};

app.get('/api/vehicle-positions', async (req, res) => {
    try {
        const positionsDataObject = await readPositionsJson();
        if (!positionsDataObject || !Array.isArray(positionsDataObject.entity)) {
            console.error('Expected positionsData.entity to be an array, received:', typeof positionsDataObject.entity);
            res.status(500).send('Internal server error');
            return;
        }

        const positionsData = positionsDataObject.entity;

        const augmentedPositions = await Promise.all(positionsData.map(async (position) => {
            if (!position.vehicle || !position.vehicle.trip) {
                if (LOGGING_ENABLED) {
                    console.warn('Skipping position due to missing vehicle or trip data:', position);
                }
                return null; // Correct placement for this line
            }

            const bearing = position.vehicle.position?.bearing || 0;
            const speed = Math.round(position.vehicle.position?.speed || 0);
            const routeId = position.vehicle.trip.routeId;
            const routeDetailsResult = await query(`SELECT route_short_name, route_long_name, route_color, route_text_color FROM routes WHERE "routeId" = $1`, [routeId]);

            if (routeDetailsResult.rows.length > 0) {
                const routeDetails = routeDetailsResult.rows[0];
                return {
                    ...position,
                    routeShortName: routeDetails.route_short_name,
                    routeLongName: routeDetails.route_long_name,
                    routeId: position.vehicle.trip.routeId,
                    routeColor: routeDetails.route_color,
                    routeTextColor: routeDetails.route_text_color,
                    bearing: bearing,
                    speed: speed
                };
            } else {
                // Assuming you want to return a default structure if route details are not found
                return {
                    ...position,
                    routeShortName: "?",
                    routeLongName: "Unknown Route",
                    routeId: "0",
                    routeColor: "000000", // Default to black
                    routeTextColor: "FFFFFF", // Default to white
                    bearing: bearing || 0,
                    speed: speed || 0
                };
            }
        }));

        res.json(augmentedPositions.filter(position => position !== null));
    } catch (error) {
        console.error('Failed to fetch vehicle positions:', error);
        // Check if the error message indicates GTFS data fetch failure
        if (error.message.includes('Failed to fetch GTFS data')) {
            res.status(503).send('The GTFS server is not available. Please try again later.');
        } else {
            res.status(500).send('Failed to fetch vehicle positions');
        }
    }
});



app.get('/api/route-shapes/:routeId', async (req, res) => {
    try {
        const { routeId } = req.params;
        //console.log('routeId:', routeId);

        const result = await query(
            'SELECT shapes.shape_pt_lat, shapes.shape_pt_lon, routes.route_color ' +
            'FROM shapes ' +
            'JOIN routes ON shapes.shape_id = routes."routeId" ' + // Notice the quotes
            'WHERE routes."routeId" = $1 ' +
            'ORDER BY shapes.shape_pt_sequence ASC',

            [routeId] // Pass routeId as a parameter for your SQL query
        );
        // Log the result after the query has been executed and result is assigned
        //console.log('result:', result);
        //console.log('Shape results:', result.rows);
        // Send the rows from the query result as a JSON response
        res.json(result.rows);
    } catch (err) {
        //console.error('Error fetching route shapes:', err);
        res.status(500).json({ error: 'Internal server error fetching route shapes' });
    }
});

// Endpoint for fetching estimated timetables
app.get('/api/timetables', createTimetablesHandler(fetchData, 'http://20.19.98.194:8313/SiriWS.asmx?op=GetEstimatedTimetable'));
function createTimetablesHandler(fetchData, url) {
    return async (req, res) => {
        try {
            const data = await fetchData(url, 'Error fetching estimated timetables:');
            res.json(data);
        } catch (error) {
            res.status(500).send('An error occurred while fetching timetables.');
        }
    };
}


app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});