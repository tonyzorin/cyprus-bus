const LOGGING_ENABLED = process.env.LOGGING_ENABLED === 'true';
const dotenv = require('dotenv');
require('dotenv').config();
const backend = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { connect: connect, query } = require('./database.js');
const app = backend();
const port = process.env.PORT || 3000;
const { readPositionsJson } = require('./parseGTFS');
const fs = require("fs");
const path = require("path");
const env = process.env.NODE_ENV || 'dev';
app.use(backend.static('./public'));

// Add body-parser middleware
app.use(backend.json({ limit: '10mb' })); // Increase the limit if needed

let lastUpdateTime = null;
let gtfsStatus = 'Checking GTFS feed status...';

async function checkGTFSFeed() {
    try {
        const response = await axios.get(process.env.GTFS_KEY);
        if (response.status === 200) {
            // Update the last update time in Cyprus time zone
            lastUpdateTime = new Date().toLocaleString('en-US', { timeZone: 'Europe/Nicosia' });
            gtfsStatus = 'available';
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
    const { stopId } = req.params;
    try {
        const queryText = `
            SELECT DISTINCT
                routes."routeId",
                routes.agency_id,
                trips.trip_headsign,
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
                stops ON stop_times.stop_id::text = $1
        `;

        // Assuming `query` is a function that executes a SQL query against your database
        // and returns a Promise that resolves with the query result.
        const routes = await query(queryText, [stopId]);
        res.json(routes.rows); // Send the resulting routes as a JSON response
    } catch (error) {
        console.error('Failed to fetch routes for stop:', error);
        res.status(500).send('Failed to fetch routes for stop');
    }
});

app.get('/api/stop-times/:stopId', async (req, res) => {
    const { stopId } = req.params;
    try {
        const queryText = `
            SELECT DISTINCT
                routes.route_short_name,
                trips.trip_headsign,
                routes.route_color,
                routes.route_text_color,
                stop_times.arrival_time
            FROM
                stop_times
                JOIN trips ON stop_times.trip_id = trips."tripId"
                JOIN routes ON trips."routeId" = routes."routeId"
            WHERE
                stop_times.stop_id = $1
            ORDER BY
                stop_times.arrival_time;
        `;

        const result = await query(queryText, [stopId]);
        const stopTimes = result.rows;

        // Calculate time left for arrival in minutes and filter for next 90 minutes
        const currentTime = new Date();
        const filteredStopTimes = stopTimes
            .map(stopTime => {
                const arrivalTime = new Date();
                const [hours, minutes, seconds] = stopTime.arrival_time.split(':');
                arrivalTime.setHours(hours, minutes, seconds, 0);
                const timeLeft = Math.round((arrivalTime - currentTime) / 60000); // Convert milliseconds to minutes
                return { ...stopTime, time_left: timeLeft };
            })
            .filter(stopTime => stopTime.time_left > 0 && stopTime.time_left <= 360) // Filter for next 90 minutes
            .sort((a, b) => a.time_left - b.time_left || a.route_short_name.localeCompare(b.route_short_name) || a.trip_headsign.localeCompare(b.trip_headsign)); // Sort by time_left, route_short_name, trip_headsign

        res.json(filteredStopTimes);
    } catch (error) {
        console.error('Failed to fetch stop times:', error);
        res.status(500).send('Failed to fetch stop times');
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
            res.status(503).json({ error: 'The GTFS server is not available. Please try again later.' });
        } else {
            res.status(500).json({ error: 'Failed to fetch vehicle positions' });
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

// JCCSmart API configuration
const jccsmartConfig = {
    id: process.env.JCCSMART_ID,
    tokens: {
        accessToken: process.env.JCCSMART_ACCESS_TOKEN,
        refreshToken: process.env.JCCSMART_REFRESH_TOKEN
    }
};

// Function to check if the access token is expired
function isTokenExpired(token) {
    const decodedToken = jwt.decode(token);
    if (!decodedToken || !decodedToken.exp) {
        return true;
    }
    const currentTime = Math.floor(Date.now() / 1000);
    return decodedToken.exp < currentTime;
}

// Function to refresh the access token
async function refreshAccessToken() {
    try {
        const response = await axios.post('https://apihub.jcc.com.cy/smartauthms/connect/token', {
            grant_type: 'refresh_token',
            refresh_token: jccsmartConfig.tokens.refreshToken
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        jccsmartConfig.tokens.accessToken = response.data.access_token;
        jccsmartConfig.tokens.refreshToken = response.data.refresh_token;
        
        // You might want to save the new tokens to a secure storage
        // saveTokensToSecureStorage(jccsmartConfig.tokens);
    } catch (error) {
        console.error('Error refreshing access token:', error);
        throw error;
    }
}

// Middleware to check and refresh the access token if needed
async function ensureValidToken(req, res, next) {
    if (isTokenExpired(jccsmartConfig.tokens.accessToken)) {
        try {
            await refreshAccessToken();
        } catch (error) {
            return res.status(401).json({ error: 'Unable to refresh access token' });
        }
    }
    next();
}

// Proxy endpoint for checking card status
/* app.get('/api/card-status', ensureValidToken, async (req, res) => {
    const { cardId } = req.query;
    try {
        const response = await axios.get(`https://www.jccsmart.com/api/bus-fare-collection/smart-cards/get-status?cardId=${cardId}`, {
            headers: {
                'Authorization': `Bearer ${jccsmartConfig.tokens.accessToken}`
            }
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching card status:', error);
        res.status(500).json({ error: 'Error fetching card status' });
    }
});

// Proxy endpoint for checking transactions
app.get('/api/card-transactions', ensureValidToken, async (req, res) => {
    const { cardId, fromDate, toDate } = req.query;
    try {
        const response = await axios.get(`https://www.jccsmart.com/api/bus-fare-collection/smart-cards/${cardId}/transactions`, {
            params: { fromDate, toDate },
            headers: {
                'Authorization': `Bearer ${jccsmartConfig.tokens.accessToken}`
            }
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ error: 'Error fetching transactions' });
    }
});*/

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});