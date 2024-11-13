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
            
            // Validate feed data
            const validEntities = feed.entity.filter(entity => {
                const isValid = entity.vehicle && 
                              entity.vehicle.position && 
                              entity.vehicle.trip &&
                              entity.vehicle.position.latitude &&
                              entity.vehicle.position.longitude;
                return isValid;
            });

            gtfsData = {
                ...feed,
                entity: validEntities
            };
            lastUpdateTime = new Date();
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
    setInterval(fetchAndParseGTFS, 3000); // Update every 3 seconds
}

async function readPositionsJson() {
    if (!gtfsData) {
        console.warn('GTFS data is not available');
        return { entity: [] };
    }
    return gtfsData;
}

function getGTFSStatus() {
    return {
        available: !!gtfsData,
        lastUpdateTime: lastUpdateTime ? lastUpdateTime.toISOString() : null,
        vehicleCount: gtfsData ? gtfsData.entity.length : 0
    };
}

module.exports = {
    initializeGTFS,
    readPositionsJson,
    getGTFSStatus
};