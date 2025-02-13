const LOGGING_ENABLED = process.env.LOGGING_ENABLED === 'true';
const dotenv = require('dotenv');
require('dotenv').config();
const backend = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { connect: connect, query } = require('./database.js');
const app = backend();
const port = process.env.PORT || 3000;
const { initializeGTFS, readPositionsJson, getGTFSStatus } = require('./parseGTFS');
const fs = require("fs");
const path = require("path");
const env = process.env.NODE_ENV || 'dev';
const winston = require('winston');
require('winston-daily-rotate-file');

// Add logging configuration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        // Daily rotate file for errors
        new winston.transports.DailyRotateFile({
            filename: 'logs/error-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxSize: '20m',
            maxFiles: '14d',
            zippedArchive: true
        }),
        // Daily rotate file for all logs
        new winston.transports.DailyRotateFile({
            filename: 'logs/combined-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '14d',
            zippedArchive: true
        })
    ]
});

// Add console transport only in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

app.use(backend.static('./public'));

// Add body-parser middleware
app.use(backend.json({ limit: '10mb' })); // Increase the limit if needed

app.listen(port, async () => {
    console.log(`Server listening on port ${port}`);
    await initializeRoutesByCity();
    await initializeGTFS();
});

// Add status tracking
let lastGTFSStatus = null;
let messageHistory = [];
const MAX_MESSAGES_PER_HOUR = 10;

function sendTelegramAlert(message, isTest = false) {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    // Clean up old messages from history
    messageHistory = messageHistory.filter(time => time > oneHourAgo);
    
    // Check rate limit (skip for test messages)
    if (!isTest && messageHistory.length >= MAX_MESSAGES_PER_HOUR) {
        console.log(`Rate limit reached (${MAX_MESSAGES_PER_HOUR} messages per hour). Message skipped:`, message);
        return;
    }
    
    // Skip if Telegram is not configured (optional integration)
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
        console.log("Telegram notifications not configured - skipping alert");
        return;
    }

    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const params = {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_notification: false
    };

    axios.post(url, params)
        .then((response) => {
            console.log("Telegram alert sent successfully");
            if (!isTest) {
                messageHistory.push(now);
            }
        })
        .catch((error) => {
            console.error("Failed to send Telegram alert:", error.response?.data || error.message);
        });
}

// Add a helper function for date formatting
function formatDateTime(date) {
    if (!date || date.getTime() < new Date('2000-01-01').getTime()) {
        return null;
    }
    
    return date.toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'medium',
        hour12: false
    });
}

// Update the GTFS status endpoint
app.get('/api/gtfs-status', (req, res) => {
    const status = getGTFSStatus();
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const lastUpdateTime = new Date(status.lastUpdateTime);
    
    const currentStatus = (!status.available || lastUpdateTime < fiveMinutesAgo) ? 'unavailable' : 'available';
    
    // Only send notification if status has changed
    if (currentStatus !== lastGTFSStatus) {
        if (currentStatus === 'unavailable') {
            const formattedTime = formatDateTime(lastUpdateTime);
            const alertMessage = `🚨 GTFS Feed Alert`
            sendTelegramAlert(alertMessage);
        } else {
            const formattedTime = formatDateTime(lastUpdateTime);
            sendTelegramAlert(`✅ GTFS Feed Recovery:
Status: Available${formattedTime ? `
Last Update: ${formattedTime}` : ''}`);
        }
        
        lastGTFSStatus = currentStatus;
    }

    res.json({
        gtfsStatus: currentStatus,
        lastUpdateTime: formatDateTime(lastUpdateTime),
        message: currentStatus === 'available' ? 'GTFS feed is available' : 'GTFS feed is not available or outdated'
    });
});

app.get('/', async (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/stops', async (req, res) => {
    // Set cache headers for 24 hours
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Expires', new Date(Date.now() + 86400000).toUTCString());

    try {
        // Get bounds or center point from query parameters
        const { bounds, stop_lat, stop_lon, limit = '50' } = req.query;
        const stopLimit = parseInt(limit);
        
        let whereClause = `
            WHERE 
                stop_lat IS NOT NULL 
                AND stop_lon IS NOT NULL
                AND CAST(stop_lat AS FLOAT) != 0 
                AND CAST(stop_lon AS FLOAT) != 0
        `;

        if (bounds) {
            const [south, west, north, east] = bounds.split(',').map(Number);
            whereClause += `
                AND CAST(lat AS FLOAT) >= ${south}
                AND CAST(lat AS FLOAT) <= ${north}
                AND CAST(lon AS FLOAT) >= ${west}
                AND CAST(lon AS FLOAT) <= ${east}
            `;
        } else if (stop_lat && stop_lon) {
            whereClause += `
                AND earth_box(ll_to_earth(${stop_lat}, ${stop_lon}), 3000) @> ll_to_earth(CAST(stop_lat AS FLOAT), CAST(stop_lon AS FLOAT))
            `;
        }

        const result = await query(`
            SELECT 
                CAST(stop_id AS TEXT) as stop_id,
                stop_name,
                CAST(stop_lat AS FLOAT) as stop_lat,
                CAST(stop_lon AS FLOAT) as stop_lon
            FROM stops
            ${whereClause}
            ORDER BY CAST(stop_id AS INTEGER)
            LIMIT ${stopLimit}
        `);

        console.log(`Fetched ${result.rows.length} stops`);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching stops:', err);
        res.status(500).json({ 
            error: 'Failed to fetch stops',
            details: err.message
        });
    }
});

app.get('/api/routes-for-stop/:stopId', async (req, res) => {
    const { stopId } = req.params;
    try {
        const queryText = `
            SELECT DISTINCT
                routes."route_id",
                routes.agency_id,
                routes.route_short_name,
                routes.route_long_name,
                routes.route_desc,
                routes.route_type,
                routes.route_color,
                routes.route_text_color,
                trips.trip_headsign AS destination
            FROM
                routes
                    JOIN
                trips ON routes."route_id" = trips."route_id"
                    JOIN
                stop_times ON trips."trip_id" = stop_times.trip_id
            WHERE
                stop_times.stop_id = $1
        `;

        const result = await query(queryText, [stopId]);
        console.log('Routes fetched:', result.rows); // Debug log
        res.json(result.rows);
    } catch (error) {
        console.error('Failed to fetch routes for stop:', error);
        res.status(500).json({ error: 'Failed to fetch routes for stop' });
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
                JOIN trips ON stop_times.trip_id = trips."trip_id"
                JOIN routes ON trips."route_id" = routes."route_id"
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

// Add cache control headers to prevent caching of vehicle positions
app.get('/api/vehicle-positions/minimal', async (req, res) => {
    // Set no-cache headers
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    
    try {
        const positionsDataObject = await readPositionsJson();
        
        if (!positionsDataObject || !Array.isArray(positionsDataObject.entity)) {
            res.status(503).json({ error: 'GTFS data is not available' });
            return;
        }

        // Return only essential data for each vehicle
        const minimalPositions = positionsDataObject.entity.map(position => ({
            id: position.vehicle?.vehicle?.id,
            lat: position.vehicle?.position?.latitude,
            lon: position.vehicle?.position?.longitude,
            bearing: position.vehicle?.position?.bearing || 0,
            routeId: position.vehicle?.trip?.routeId
        })).filter(pos => pos.id && pos.lat && pos.lon);

        res.json(minimalPositions);
    } catch (err) {
        console.error('Error fetching minimal positions:', err);
        res.status(500).json({ error: 'Failed to fetch positions' });
    }
});

// New endpoint for full vehicle details
app.get('/api/vehicle-details', async (req, res) => {
    try {
        const positionsDataObject = await readPositionsJson();
        
        if (!positionsDataObject || !Array.isArray(positionsDataObject.entity)) {
            res.status(503).json({ error: 'GTFS data is not available' });
            return;
        }

        // Get full details including route information
        const fullDetails = await Promise.all(positionsDataObject.entity.map(async (position) => {
            const routeId = position.vehicle?.trip?.routeId;
            if (!routeId) return null;

            const routeDetailsResult = await query(
                `SELECT route_short_name, route_long_name, route_color, route_text_color 
                 FROM routes 
                 WHERE route_id = $1`,
                [routeId]
            );

            if (routeDetailsResult.rows.length === 0) return null;

            const routeDetails = routeDetailsResult.rows[0];
            return {
                id: position.vehicle?.vehicle?.id,
                vehicleInfo: {
                    label: position.vehicle?.vehicle?.label,
                    licensePlate: position.vehicle?.vehicle?.licensePlate
                },
                tripInfo: {
                    tripId: position.vehicle?.trip?.tripId,
                    startTime: position.vehicle?.trip?.startTime,
                    startDate: position.vehicle?.trip?.startDate,
                    routeId: routeId
                },
                routeInfo: {
                    shortName: routeDetails.route_short_name,
                    longName: routeDetails.route_long_name,
                    color: routeDetails.route_color,
                    textColor: routeDetails.route_text_color
                }
            };
        }));

        res.json(fullDetails.filter(detail => detail !== null));
    } catch (err) {
        console.error('Error fetching vehicle details:', err);
        res.status(500).json({ error: 'Failed to fetch vehicle details' });
    }
});

app.get('/api/route-shapes/:routeId', async (req, res) => {
    try {
        const { routeId } = req.params;
        
        // First get the route color and a valid shape_id for this route
        const routeQuery = await query(`
            SELECT DISTINCT 
                routes.route_color,
                trips.shape_id
            FROM routes
            JOIN trips ON routes.route_id = trips.route_id
            WHERE routes.route_id = $1
            LIMIT 1
        `, [parseInt(routeId)]);

        if (routeQuery.rows.length === 0) {
            console.log('Route not found:', routeId);
            return res.status(404).json({ error: 'Route not found' });
        }

        const { route_color, shape_id } = routeQuery.rows[0];

        // Then get just the shape points for this shape
        const shapePoints = await query(`
            SELECT 
                shape_pt_lat, 
                shape_pt_lon,
                shape_pt_sequence
            FROM shapes 
            WHERE shape_id = $1
            ORDER BY shape_pt_sequence ASC
        `, [shape_id]);

        // Add the route color to each point
        const result = shapePoints.rows.map(point => ({
            ...point,
            route_color
        }));

        res.json(result);
    } catch (err) {
        console.error('Error fetching route shapes:', err);
        res.status(500).json({ 
            error: 'Internal server error fetching route shapes',
            details: err.message
        });
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
            'SELECT route_short_name, trip_headsign, route_color, route_text_color FROM routes JOIN trips ON routes."route_id" = trips."route_id" WHERE routes.route_short_name = $1 LIMIT 1',
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

// Add this helper function at the top of the file
function normalizeRouteShortName(name) {
    // Convert Greek 'Β' to Latin 'B', 'Α' to 'A', etc.
    return name.replace(/Β/g, 'B')
              .replace(/Α/g, 'A')
              .replace(/Ε/g, 'E')
              .normalize('NFKD')
              .replace(/[\u0300-\u036f]/g, '')
              .trim();
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

            if (routeShortName === '' || arrivalTimeText === 'Προβλεπόενη ώρα σύμφων με το χρονοδιάγραμμα') {
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

        // Modified query to get route information with stop sequence to determine direction
        const routesQuery = `
            WITH StopSequence AS (
                SELECT 
                    stop_times.stop_id,
                    trips."route_id",
                    trips.trip_headsign,
                    stop_times.stop_sequence,
                    MAX(stop_times.stop_sequence) OVER (PARTITION BY trips."trip_id") as max_sequence,
                    MIN(stop_times.stop_sequence) OVER (PARTITION BY trips."trip_id") as min_sequence
                FROM stop_times
                JOIN trips ON stop_times.trip_id = trips."trip_id"
                WHERE stop_times.stop_id = $1
            ),
            RouteDirections AS (
                SELECT DISTINCT
                    routes."route_id",
                    routes.route_short_name,
                    routes.route_long_name,
                    routes.route_color,
                    routes.route_text_color,
                    trips.trip_headsign,
                    CASE 
                        WHEN ss.stop_sequence = ss.min_sequence THEN 'origin'
                        WHEN ss.stop_sequence = ss.max_sequence THEN 'destination'
                        ELSE 'intermediate'
                    END as stop_position
                FROM routes
                JOIN trips ON routes."route_id" = trips."route_id"
                JOIN stop_times ON trips."trip_id" = stop_times.trip_id
                JOIN StopSequence ss ON ss."route_id" = routes."route_id"
                WHERE stop_times.stop_id = $1
            )
            SELECT DISTINCT ON (route_short_name)
                "route_id" as route_id,
                route_short_name,
                route_long_name,
                route_color,
                route_text_color,
                trip_headsign,
                stop_position
            FROM RouteDirections
            ORDER BY 
                route_short_name,
                CASE 
                    WHEN stop_position = 'origin' THEN 1
                    WHEN stop_position = 'destination' THEN 2
                    ELSE 3
                END;
        `;

        const routesResult = await query(routesQuery, [stopId]);
        const routes = routesResult.rows;

        // Get current stop details to help determine direction
        const stopResult = await query('SELECT stop_lat, stop_lon FROM stops WHERE stop_id = $1', [stopId]);
        const currentStop = stopResult.rows[0];

        // Combine real-time data with route information
        const combinedTimetable = realTimeBusTimes.map(realTimeBus => {
            const normalizedRouteShortName = normalizeRouteShortName(realTimeBus.route_short_name);
            const routeInfo = routes.find(r => 
                normalizeRouteShortName(r.route_short_name) === normalizedRouteShortName
            );
            
            return {
                ...realTimeBus,
                route_id: routeInfo ? routeInfo.route_id : null,
                trip_headsign: routeInfo ? routeInfo.trip_headsign : 'Unknown Destination',
                route_color: routeInfo ? routeInfo.route_color : 'FFFFFF',
                route_text_color: routeInfo ? routeInfo.route_text_color : '000000',
                is_live: true
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
            routes: routes.map(route => ({
                ...route,
                trip_headsign: route.trip_headsign,
                is_terminal: route.stop_position === 'origin' || route.stop_position === 'destination'
            })),
            timetable: combinedTimetable
        };

        res.json(response);
    } catch (error) {
        console.error('Failed to fetch stop info:', error);
        res.status(500).json({ 
            error: 'Failed to fetch stop info',
            details: error.message 
        });
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

app.get('/api/route-stops/:routeId', async (req, res) => {
    try {
        const { routeId } = req.params;
        
        // Validate routeId
        if (!routeId || isNaN(parseInt(routeId))) {
            return res.status(400).json({ error: 'Invalid route ID' });
        }

        const parsedRouteId = parseInt(routeId);
        
        const queryText = `
            SELECT DISTINCT ON (s.stop_id) 
                s.stop_id, 
                s.stop_name AS stop_name, 
                s.stop_lat AS stop_lat, 
                s.stop_lon AS stop_lon, 
                st.stop_sequence
            FROM stops s
            JOIN stop_times st ON s.stop_id = st.stop_id
            JOIN trips t ON st.trip_id = t.trip_id
            WHERE t.route_id = $1
            ORDER BY s.stop_id, st.stop_sequence
        `;
        
        const result = await query(queryText, [parsedRouteId]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching route stops:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// Add these routes to your existing backend.js file

app.get('/api/nearby-stops', async (req, res) => {
    const { lat, lon, radius } = req.query;
    try {
        const result = await query(`
            SELECT *,
                   (6371 * acos(cos(radians($1)) * cos(radians(stop_lat)) * cos(radians(stop_lon) - radians($2)) + sin(radians($1)) * sin(radians(stop_lat)))) AS distance
            FROM stops
            WHERE (6371 * acos(cos(radians($1)) * cos(radians(stop_lat)) * cos(radians(stop_lon) - radians($2)) + sin(radians($1)) * sin(radians(stop_lat)))) < $3
            ORDER BY distance
        `, [lat, lon, radius / 1000]); // Convert radius to km
        res.json(result.rows);
    } catch (error) {
        console.error('Error finding nearby stops:', error);
        res.status(500).json({ error: 'Failed to find nearby stops' });
    }
});

app.post('/api/calculate-route', async (req, res) => {
    const { startLat, startLon, endLat, endLon } = req.body;
    try {
        // This is still a placeholder. You'll need to implement the actual routing algorithm.
        const route = {
            totalDistance: 0,
            totalTime: 0,
            segments: [
                {
                    type: 'walk',
                    startLat,
                    startLon,
                    endStop: { name: 'Nearest Start Stop', lat: startLat, lon: startLon },
                    distance: 300,
                    time: 5, // minutes
                    coordinates: [[startLat, startLon], [startLat, startLon]]
                },
                {
                    type: 'bus',
                    busLine: '123',
                    startStop: { name: 'Nearest Start Stop', lat: startLat, lon: startLon },
                    endStop: { name: 'Transfer Stop', lat: (startLat + endLat) / 2, lon: (startLon + endLon) / 2 },
                    distance: 5000,
                    time: 15, // minutes
                    coordinates: [[startLat, startLon], [(startLat + endLat) / 2, (startLon + endLon) / 2]]
                },
                {
                    type: 'bus',
                    busLine: '456',
                    startStop: { name: 'Transfer Stop', lat: (startLat + endLat) / 2, lon: (startLon + endLon) / 2 },
                    endStop: { name: 'Nearest End Stop', lat: endLat, lon: endLon },
                    distance: 4000,
                    time: 12, // minutes
                    coordinates: [[(startLat + endLat) / 2, (startLon + endLon) / 2], [endLat, endLon]]
                },
                {
                    type: 'walk',
                    startStop: { name: 'Nearest End Stop', lat: endLat, lon: endLon },
                    endLat,
                    endLon,
                    distance: 200,
                    time: 3, // minutes
                    coordinates: [[endLat, endLon], [endLat, endLon]]
                }
            ]
        };

        // Calculate total distance and time
        route.totalDistance = route.segments.reduce((sum, segment) => sum + segment.distance, 0);
        route.totalTime = route.segments.reduce((sum, segment) => sum + segment.time, 0);

        res.json(route);
    } catch (error) {
        console.error('Error calculating route:', error);
        res.status(500).json({ error: 'Failed to calculate route' });
    }
});

app.get('/api/common-routes', async (req, res) => {
    const { destStopId, lat, lon } = req.query;
    try {
        // Step 1: Find nearby stops within 1km radius
        const nearbyStopsResult = await query(`
            SELECT stop_id, 
                   name AS stop_name, 
                   lat AS stop_lat, 
                   lon AS stop_lon,
                   ROUND(CAST((6371 * acos(cos(CAST($1 AS double precision) * PI() / 180) 
                                * cos(CAST(lat AS double precision) * PI() / 180) 
                                * cos((CAST(lon AS double precision) * PI() / 180) - (CAST($2 AS double precision) * PI() / 180)) 
                                + sin(CAST($1 AS double precision) * PI() / 180) 
                                * sin(CAST(lat AS double precision) * PI() / 180))) AS numeric), 2) AS distance
            FROM stops
            WHERE (6371 * acos(cos(CAST($1 AS double precision) * PI() / 180) 
                               * cos(CAST(lat AS double precision) * PI() / 180) 
                               * cos((CAST(lon AS double precision) * PI() / 180) - (CAST($2 AS double precision) * PI() / 180)) 
                               + sin(CAST($1 AS double precision) * PI() / 180) 
                               * sin(CAST(lat AS double precision) * PI() / 180))) < 1
            ORDER BY distance
        `, [lat, lon]);

        const nearbyStops = nearbyStopsResult.rows;

        // Step 2: Get routes for the destination stop
        const destRoutesResult = await query(`
            SELECT DISTINCT routes.route_short_name
            FROM routes
            JOIN trips ON routes."route_id" = trips."route_id"
            JOIN stop_times ON trips."trip_id" = stop_times.trip_id
            WHERE stop_times.stop_id = $1
        `, [destStopId]);

        const destRoutes = new Set(destRoutesResult.rows.map(row => row.route_short_name));

        // Step 3: Find common routes for nearby stops
        const commonRoutesPromises = nearbyStops.map(async (stop) => {
            const stopRoutesResult = await query(`
                SELECT DISTINCT routes.route_short_name
                FROM routes
                JOIN trips ON routes."route_id" = trips."route_id"
                JOIN stop_times ON trips."trip_id" = stop_times.trip_id
                WHERE stop_times.stop_id = $1
            `, [stop.stop_id]);

            const stopRoutes = stopRoutesResult.rows.map(row => row.route_short_name);
            const commonRoutes = stopRoutes.filter(route => destRoutes.has(route));

            return {
                stop_id: stop.stop_id,
                stop_name: stop.stop_name,
                stop_lat: stop.stop_lat,
                stop_lon: stop.stop_lon,
                distance: stop.distance,
                common_routes: commonRoutes
            };
        });

        const commonRoutesResults = await Promise.all(commonRoutesPromises);

        // Filter out stops with no common routes and sort by distance
        const filteredResults = commonRoutesResults
            .filter(stop => stop.common_routes.length > 0)
            .sort((a, b) => a.distance - b.distance);

        res.json(filteredResults);
    } catch (error) {
        console.error('Error finding common routes:', error);
        res.status(500).json({ error: 'Failed to find common routes' });
    }
});

app.get('/api/find-route', async (req, res) => {
    const { fromLat, fromLon, toLat, toLon } = req.query;
    try {
        // Step 1: Find the nearest stops to the 'from' and 'to' coordinates
        const findNearestStop = async (lat, lon) => {
            const result = await query(`
                SELECT stop_id, name, lat, lon,
                       (6371 * acos(cos(CAST($1 AS double precision) * PI() / 180) 
                                    * cos(CAST(lat AS double precision) * PI() / 180) 
                                    * cos((CAST(lon AS double precision) * PI() / 180) - (CAST($2 AS double precision) * PI() / 180)) 
                                    + sin(CAST($1 AS double precision) * PI() / 180) 
                                    * sin(CAST(lat AS double precision) * PI() / 180))) AS distance
                FROM stops
                ORDER BY distance
                LIMIT 1
            `, [lat, lon]);
            return result.rows[0];
        };

        const fromStop = await findNearestStop(fromLat, fromLon);
        const toStop = await findNearestStop(toLat, toLon);

        // Step 2: Get routes for both stops
        const getStopRoutes = async (stopId) => {
            const result = await query(`
                SELECT DISTINCT routes.route_short_name
                FROM routes
                JOIN trips ON routes."route_id" = trips."route_id"
                JOIN stop_times ON trips."trip_id" = stop_times.trip_id
                WHERE stop_times.stop_id = $1
            `, [stopId]);
            return result.rows.map(row => row.route_short_name);
        };

        const fromStopRoutes = await getStopRoutes(fromStop.stop_id);
        const toStopRoutes = await getStopRoutes(toStop.stop_id);

        // Step 3: Find common routes (direct routes)
        const directRoutes = fromStopRoutes.filter(route => toStopRoutes.includes(route));

        // Step 4: If no direct routes, find routes with one transfer
        let transferRoutes = [];
        if (directRoutes.length === 0) {
            // Get all stops on routes that stop at the 'from' stop
            const intermediateStopsResult = await query(`
                SELECT DISTINCT s.stop_id, s.name, s.lat, s.lon, r.route_short_name
                FROM stops s
                JOIN stop_times st ON s.stop_id = st.stop_id
                JOIN trips t ON st.trip_id = t."trip_id"
                JOIN routes r ON t."route_id" = r."route_id"
                WHERE r.route_short_name = ANY($1::text[])
            `, [fromStopRoutes]);

            const intermediateStops = intermediateStopsResult.rows;

            // Check which of these intermediate stops have routes to the 'to' stop
            for (const stop of intermediateStops) {
                const stopRoutes = await getStopRoutes(stop.stop_id);
                const commonRoutes = stopRoutes.filter(route => toStopRoutes.includes(route));
                if (commonRoutes.length > 0) {
                    transferRoutes.push({
                        hop_off_stop: stop,
                        hop_on_routes: commonRoutes
                    });
                }
            }
        }

        // Prepare the response
        const response = {
            from_stop_id: fromStop.stop_id,
            from_stop_name: fromStop.stop_name,
            from_stop_lat: fromStop.stop_lat,
            from_stop_lon: fromStop.stop_lon,
            from_stop_routes: fromStopRoutes,
            to_stop_id: toStop.stop_id,
            to_stop_name: toStop.stop_name,
            to_stop_lat: toStop.stop_lat,
            to_stop_lon: toStop.stop_lon,
            to_stop_routes: toStopRoutes,
            direct_routes: directRoutes,
            transfer_routes: transferRoutes
        };

        res.json(response);
    } catch (error) {
        console.error('Error finding route:', error);
        res.status(500).json({ error: 'Failed to find route' });
    }
});

// Add this function to get all routes serving a stop
async function getRoutesForStop(stopId) {
    const routesQuery = `
        SELECT DISTINCT 
            routes."route_id" as route_id,
            routes.route_short_name,
            routes.route_long_name,
            routes.route_color,
            routes.route_text_color
        FROM routes
        JOIN trips ON routes."route_id" = trips."route_id"
        JOIN stop_times ON trips."trip_id" = stop_times.trip_id
        WHERE stop_times.stop_id = $1
        ORDER BY routes.route_short_name;
    `;
    
    try {
        const result = await query(routesQuery, [stopId]);
        return result.rows;
    } catch (error) {
        console.error('Error fetching routes for stop:', error);
        return [];
    }
}

// Add error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error', {
        timestamp: new Date().toISOString(),
        type: 'unhandled_error',
        message: err.message,
        path: req.path,
        method: req.method,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
    res.status(500).json({ error: 'Internal server error' });
});

// Add cleanup function for old logs
function cleanupOldLogs() {
    const logsDir = path.join(__dirname, 'logs');
    const maxAge = 14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds

    fs.readdir(logsDir, (err, files) => {
        if (err) {
            logger.error('Error reading logs directory:', err);
            return;
        }

        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(logsDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    logger.error('Error getting file stats:', err);
                    return;
                }

                if (now - stats.mtime.getTime() > maxAge) {
                    fs.unlink(filePath, err => {
                        if (err) logger.error('Error deleting old log file:', err);
                    });
                }
            });
        });
    });
}

// Run cleanup daily
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

// Update test endpoint to use formatted time
app.get('/api/test-notification', async (req, res) => {
    try {
        if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
            const error = "Missing Telegram configuration";
            console.error(error, {
                TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
                TELEGRAM_CHAT_ID: !!process.env.TELEGRAM_CHAT_ID
            });
            return res.status(500).json({ error });
        }

        const message = `🧪 Test notification from Cyprus Buses
Time: ${formatDateTime(new Date())}`;
        
        // Pass isTest=true to bypass cooldown
        sendTelegramAlert(message, true);
        
        res.json({ 
            message: 'Test notification sent',
            success: true
        });
    } catch (error) {
        console.error('Failed to send test notification:', {
            error: error.message,
            response: error.response?.data
        });
        res.status(500).json({ 
            error: 'Failed to send test notification', 
            details: error.message,
            telegramError: error.response?.data
        });
    }
});

app.get('/api/routes-by-city', async (req, res) => {
    try {
        // First, let's log the query parameters
        console.log('Query params:', req.query);

        let queryStr = `
            SELECT DISTINCT
                routes.route_id::text,
                routes.route_short_name,
                routes.route_long_name,
                routes.route_color,
                routes.route_text_color,
                rbc.city as original_city,
                CASE 
                    WHEN rbc.city = 'limassol' THEN 'Limassol'
                    WHEN rbc.city = 'nicosia' THEN 'Nicosia'
                    WHEN rbc.city = 'pafos' THEN 'Pafos'
                    WHEN rbc.city = 'famagusta' THEN 'Famagusta'
                    WHEN rbc.city = 'intercity' THEN 'Intercity'
                    WHEN rbc.city = 'larnaca' THEN 'Larnaca'
                    WHEN rbc.city = 'pame_express' THEN 'Pame Express'
                    ELSE 'Other'
                END as city,
                CASE WHEN routes.route_short_name ~ '^[0-9]+$' 
                     THEN CAST(routes.route_short_name AS INTEGER) 
                     ELSE 999999 
                END as route_number_order
            FROM routes_by_city rbc
            JOIN routes ON routes.route_id::text = rbc.route_id
        `;

        let whereConditions = [];
        let queryParams = [];
        let paramCount = 1;

        // Handle city filter
        const city = Object.keys(req.query)[0];
        if (city && !city.includes(',')) {
            whereConditions.push(`rbc.city = $${paramCount}`);
            queryParams.push(city.toLowerCase());
            paramCount++;
        }

        // Handle route numbers filter
        const routes = req.query[Object.keys(req.query)[0]];
        if (routes && routes.includes(',')) {
            whereConditions.push(`routes.route_short_name = ANY($${paramCount}::text[])`);
            queryParams.push(routes.split(','));
            paramCount++;
        }

        // Add WHERE clause if we have conditions
        if (whereConditions.length > 0) {
            queryStr += ` WHERE ${whereConditions.join(' AND ')}`;
        }

        queryStr += ` ORDER BY city, route_number_order, route_short_name`;

        // Log the final query and parameters
        console.log('Query:', queryStr);
        console.log('Params:', queryParams);

        // Execute query with parameters
        const result = await query(queryStr, queryParams);
        
        // Log raw results
        console.log('Raw query results:', result.rows);

        // Group routes by city and then by short_name
        const routesByCity = result.rows.reduce((acc, route) => {
            if (!acc[route.city]) {
                acc[route.city] = {};
            }
            
            if (!acc[route.city][route.route_short_name]) {
                acc[route.city][route.route_short_name] = {
                    route_short_name: route.route_short_name,
                    routes: []
                };
            }
            
            acc[route.city][route.route_short_name].routes.push({
                route_id: route.route_id,
                route_long_name: route.route_long_name,
                route_color: route.route_color || 'FFFFFF',
                route_text_color: route.route_text_color || '000000'
            });
            
            return acc;
        }, {});

        // Log intermediate state
        console.log('Grouped by city:', routesByCity);

        // Convert to array format
        const formattedResponse = Object.entries(routesByCity).map(([city, routes]) => ({
            city,
            routes: Object.values(routes)
        }));

        // Log final response
        console.log('Final response:', formattedResponse);

        res.json(formattedResponse);
    } catch (error) {
        console.error('Error fetching routes by city:', error);
        res.status(500).json({ error: 'Failed to fetch routes' });
    }
});

// Add this function to initialize the routes_by_city table
async function initializeRoutesByCity() {
    try {
        // Drop the table if it exists to ensure clean data
        await query(`DROP TABLE IF EXISTS routes_by_city`);

        // Create the table
        await query(`
            CREATE TABLE routes_by_city (
                city VARCHAR(50),
                route_id VARCHAR(50),
                route_short_name VARCHAR(50),
                PRIMARY KEY (route_id)
            )
        `);

        // Read and parse the CSV file
        const csvContent = fs.readFileSync('routes_by_city.csv', 'utf-8');
        const lines = csvContent.split('\n');
        
        // Skip header
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            // Parse CSV line (handling quoted values)
            const values = line.split(',').map(val => val.trim().replace(/^"|"$/g, ''));
            if (values.length !== 3) continue;
            
            const [city, route_id, route_short_name] = values;
            
            // Insert the data
            await query(
                'INSERT INTO routes_by_city (city, route_id, route_short_name) VALUES ($1, $2, $3) ON CONFLICT (route_id) DO UPDATE SET city = $1, route_short_name = $3',
                [city, route_id, route_short_name]
            );
        }

        // Verify the data
        const count = await query('SELECT COUNT(*) FROM routes_by_city');
        console.log(`Successfully initialized routes_by_city table with ${count.rows[0].count} routes`);
        
        // Log sample data for verification
        const sample = await query('SELECT * FROM routes_by_city LIMIT 5');
        console.log('Sample data:', sample.rows);

    } catch (error) {
        console.error('Error initializing routes_by_city table:', error);
        throw error; // Rethrow to handle it in the server startup
    }
}