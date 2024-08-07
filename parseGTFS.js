const protobuf = require("protobufjs");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const protoPath = "gtfs-realtime.proto";
const dotenv = require('dotenv')
require('dotenv').config();
const gtfsRealtimeUrl = process.env.GTFS_KEY;
// Cache implementation
let cache = {
    timestamp: 0,
    duration: 3141 * 1, // Cache duration in milliseconds (e.g., 120000ms is 2 minutes)
    data: null
};

function readPositionsJson() {
    // Check if cache is still valid
    if (Date.now() - cache.timestamp < cache.duration && cache.data !== null) {
        // Return cached data if still valid
        return Promise.resolve(cache.data);
    } else {
        // Fetch new data if cache is invalid or empty
        return new Promise((resolve, reject) => {
            protobuf.load(protoPath, function(err, root) {
                if (err) return reject(err);

                let FeedMessage = root.lookupType("transit_realtime.FeedMessage");

                fetch(gtfsRealtimeUrl)
                    .then(response => {
                        // Check if the response status is 500
                        if (response.status === 500) {
                            throw new Error('GTFS data is currently not available. Please try again later.');
                        }
                        return response.arrayBuffer();
                    })
                    .then(arrayBuffer => {
                        const buffer = Buffer.from(arrayBuffer);
                        let message = FeedMessage.decode(buffer);
                        let object = FeedMessage.toObject(message, {
                            enums: String,
                            longs: String,
                            bytes: String,
                            defaults: true,
                            arrays: true,
                            objects: true,
                            oneofs: true
                        });
                        // Update cache with new data
                        cache.timestamp = Date.now();
                        cache.data = object;
                        resolve(object); // Resolve the promise with the decoded JSON object
                    })
                    .catch(error => {
                        console.error(error.message || 'Failed to fetch GTFS data.');
                        reject(error);
                    });
            });
        });
    }
}


module.exports = { readPositionsJson };

readPositionsJson();