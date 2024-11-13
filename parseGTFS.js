const axios = require('axios');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const fs = require('fs').promises;
const path = require('path');

let gtfsData = null;
let lastUpdateTime = null;

async function fetchAndParseGTFS() {
    try {
        const response = await axios.get(process.env.GTFS_KEY, { responseType: 'arraybuffer' });
        if (response.status === 200) {
            const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(response.data));
            gtfsData = feed;
            lastUpdateTime = new Date();
            console.log('GTFS data updated successfully');
            return true;
        } else {
            console.error('Failed to fetch GTFS data:', response.status, response.statusText);
            return false;
        }
    } catch (error) {
        console.error('Error fetching GTFS data:', error.message);
        return false;
    }
}

async function initializeGTFS() {
    const success = await fetchAndParseGTFS();
    if (!success) {
        console.warn('GTFS data is currently not available. The server will start, but some features may be limited.');
    }
    // Set up periodic updates
    setInterval(fetchAndParseGTFS, 30000); // Check every 30 seconds
}

async function readPositionsJson() {
    if (!gtfsData) {
        console.warn('GTFS data is not available. Returning empty array.');
        return { entity: [] };
    }
    return gtfsData;
}

function getGTFSStatus() {
    return {
        available: !!gtfsData,
        lastUpdateTime: lastUpdateTime ? lastUpdateTime.toISOString() : null
    };
}

module.exports = {
    initializeGTFS,
    readPositionsJson,
    getGTFSStatus
};