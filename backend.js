const LOGGING_ENABLED = process.env.LOGGING_ENABLED === 'true';
const dotenv = require('dotenv');
require('dotenv').config();
const backend = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
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

        const routes = await query(queryText, [stopId]);
        res.json(routes.rows);
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

        const currentTime = new Date();
        const filteredStopTimes = stopTimes
            .map(stopTime => {
                const arrivalTime = new Date();
                const [hours, minutes, seconds] = stopTime.arrival_time.split(':');
                arrivalTime.setHours(hours, minutes, seconds, 0);
                const timeLeft = Math.round((arrivalTime - currentTime) / 60000);
                return { ...stopTime, time_left: timeLeft };
            })
            .filter(stopTime => stopTime.time_left > 0 && stopTime.time_left <= 90)
            .sort((a, b) => a.time_left - b.time_left || a.route_short_name.localeCompare(b.route_short_name) || a.trip_headsign.localeCompare(b.trip_headsign));

        res.json(filteredStopTimes);
    } catch (error) {
        console.error('Failed to fetch stop times:', error);
        res.status(500).send('Failed to fetch stop times');
    }
});

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
                return null;
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
                return {
                    ...position,
                    routeShortName: "?",
                    routeLongName: "Unknown Route",
                    routeId: "0",
                    routeColor: "000000",
                    routeTextColor: "FFFFFF",
                    bearing: bearing || 0,
                    speed: speed || 0
                };
            }
        }));

        res.json(augmentedPositions.filter(position => position !== null));
    } catch (error) {
        console.error('Failed to fetch vehicle positions:', error);
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

        const result = await query(
            'SELECT shapes.shape_pt_lat, shapes.shape_pt_lon, routes.route_color ' +
            'FROM shapes ' +
            'JOIN routes ON shapes.shape_id = routes."routeId" ' +
            'WHERE routes."routeId" = $1 ' +
            'ORDER BY shapes.shape_pt_sequence ASC',

            [routeId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Internal server error fetching route shapes' });
    }
});

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

async function getRouteDetails(routeShortName) {
    try {
        const result = await query(
            'SELECT route_short_name, trip_headsign, route_color, route_text_color FROM routes JOIN trips ON routes."routeId" = trips."routeId" WHERE routes.route_short_name = $1 LIMIT 1',
            [routeShortName]
        );
        if (result.rows.length > 0) {
            return result.rows[0];
        }
        return null;
    } catch (error) {
        console.error('Error fetching route details:', error);
        return null;
    }
}

app.get('/api/stop/:stopId', async (req, res) => {
    const { stopId } = req.params;
    try {
        // Fetch real-time data from Motion
        const motionUrl = `https://motionbuscard.org.cy/routes/stop/${stopId}`;
        const motionResponse = await axios.get(motionUrl);
        const html = motionResponse.data;
        const $ = cheerio.load(html);

        const realTimeBusTimes = [];
        const currentTime = new Date();

        $('.arrivalTimes__list__item').each((index, element) => {
            const routeShortName = $(element).find('.line__item__text').text().trim().split('Διαδρομή')[0];
            let arrivalTimeText = $(element).find('.arrivalTimes__list__item__link__text2').text().trim();

            if (routeShortName === '' || arrivalTimeText === 'Προβλεπόμενη ώρα σύμφωνα με το χρονοδιάγραμμα') {
                return;
            }

            let timeLeft;
            let arrivalTime;

            if (arrivalTimeText.includes('Λεπτά')) {
                timeLeft = parseInt(arrivalTimeText.replace('Λεπτά', '').trim());
                arrivalTime = new Date(currentTime.getTime() + timeLeft * 60000);
            } else {
                const [hours, minutes] = arrivalTimeText.split(':').map(Number);
                arrivalTime = new Date(currentTime);
                arrivalTime.setHours(hours, minutes, 0, 0);

                if (arrivalTime < currentTime) {
                    arrivalTime.setDate(arrivalTime.getDate() + 1);
                }

                timeLeft = Math.round((arrivalTime - currentTime) / 60000);
            }

            if (isNaN(timeLeft) || !isFinite(timeLeft)) {
                return;
            }

            realTimeBusTimes.push({
                route_short_name: routeShortName,
                arrival_time: arrivalTime.toTimeString().split(' ')[0],
                time_left: timeLeft
            });
        });

        // Fetch additional information from the database
        const routeInfoQuery = `
            SELECT DISTINCT
                routes.route_short_name,
                trips.trip_headsign,
                routes.route_color,
                routes.route_text_color
            FROM
                routes
                JOIN trips ON routes."routeId" = trips."routeId"
                JOIN stop_times ON trips."tripId" = stop_times.trip_id
            WHERE
                stop_times.stop_id = $1
                AND routes.route_short_name = ANY($2::text[])
        `;

        const routeShortNames = realTimeBusTimes.map(bus => bus.route_short_name);
        const routeInfoResult = await query(routeInfoQuery, [stopId, routeShortNames]);
        const routeInfo = routeInfoResult.rows;

        // Combine real-time data with database info
        const combinedTimetable = realTimeBusTimes.map(realTimeBus => {
            const dbInfo = routeInfo.find(info => info.route_short_name === realTimeBus.route_short_name);
            return {
                ...realTimeBus,
                trip_headsign: dbInfo ? dbInfo.trip_headsign : 'Unknown Destination',
                route_color: dbInfo ? dbInfo.route_color : 'FFFFFF',
                route_text_color: dbInfo ? dbInfo.route_text_color : '000000'
            };
        });

        // Sort by time_left
        combinedTimetable.sort((a, b) => a.time_left - b.time_left);

        // Fetch stop information
        const stopInfoQuery = 'SELECT * FROM stops WHERE stop_id = $1';
        const stopInfoResult = await query(stopInfoQuery, [stopId]);
        const stopInfo = stopInfoResult.rows[0];

        // Prepare the final response
        const response = {
            stop_info: stopInfo,
            timetable: combinedTimetable
        };

        res.json(response);
    } catch (error) {
        console.error('Failed to fetch stop info:', error);
        res.status(500).send('Failed to fetch stop info');
    }
});

// Helper function to parse inline styles
function parseStyle(styleString) {
    const styles = {};
    const stylePairs = styleString.split(';').map(s => s.trim()).filter(s => s);
    stylePairs.forEach(style => {
        const [key, value] = style.split(':').map(s => s.trim());
        styles[key] = value;
    });
    return styles;
}

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});