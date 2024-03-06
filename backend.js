const backend = require('express');
const axios = require('axios');
const {connect: connect, query} = require('./database.js');
const app = backend();
const port = process.env.PORT || 3000;
const {readPositionsJson} = require('./parseGTFS');
const fs = require("fs");

//const app = express();


const BUS_POSITIONS_URL = process.env.BUS_POSITIONS_URL;
const TIMETABLES_URL = process.env.TIMETABLES_URL;

// Middleware to serve static files
app.use(backend.static('public'));

app.get('/api/stops', async (req, res) => {
    try {
        const result = await query('SELECT * FROM stops');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching stops:', err);
        res.status(500).json({ error: 'Internal server error fetching stops' });
    }
});

// Define routes
app.get('/', (req, res) => res.send('Hello World!'));

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
            // Check if vehicle and trip objects exist before attempting to access properties
            if (!position.vehicle || !position.vehicle.trip) {
                //console.warn('Skipping position due to missing vehicle or trip data:', position);
                return null; // Skip this position or handle it as needed
            }

            const routeId = position.vehicle.trip.routeId;
            const routeDetailsQuery = `SELECT route_short_name, route_long_name FROM routes WHERE "routeId" = $1`;
            const routeDetailsResult = await query(routeDetailsQuery, [routeId]);
            if (routeDetailsResult.rows.length > 0) {
                const routeDetails = routeDetailsResult.rows[0];
                position.routeShortName = routeDetails.route_short_name;
                position.routeLongName = routeDetails.route_long_name;
            } else {
                position.routeShortName = "# Unknown";
                position.routeLongName = "Unknown Route";
            }
            return position;
        }));
        //console.error('back good');
        // Filter out nulls if you chose to return null for positions without vehicle or trip data
        res.json(augmentedPositions.filter(position => position !== null));
    } catch (error) {
        console.error('Failed to fetch vehicle positions:', error);
        res.status(500).send('Failed to fetch vehicle positions');
    }
});

app.get('/api/route-shapes/:routeId', async (req, res) => {
    try {
        const { routeId } = req.params;
        const result = await query(
            'SELECT shape_pt_lat, shape_pt_lon FROM shapes WHERE shape_id = $1 ORDER BY shape_pt_sequence ASC',
            [routeId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching route shapes:', err);
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
