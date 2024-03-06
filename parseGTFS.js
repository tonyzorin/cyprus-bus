// Existing code for readPositionsJson function
const protobuf = require("protobufjs");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const protoPath = "gtfs-realtime.proto";
const gtfsRealtimeUrl = "http://20.19.98.194:8328/Api/api/gtfs-realtime";

function readPositionsJson() {
    return new Promise((resolve, reject) => {
        protobuf.load(protoPath, function(err, root) {
            if (err) return reject(err);

            let FeedMessage = root.lookupType("transit_realtime.FeedMessage");

            fetch(gtfsRealtimeUrl)
                .then(response => response.arrayBuffer())
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
                    resolve(object); // Resolve the promise with the decoded JSON object
                })
                .catch(error => reject(error));
        });
    });
}

// Code to call readPositionsJson and log the result
readPositionsJson().then(decodedData => {
//    console.log(JSON.stringify(decodedData, null, 2)); // Log the decoded data as a formatted JSON string
}).catch(error => {
    console.error('Failed to decode GTFS-realtime data:', error);
});

module.exports = { readPositionsJson };
