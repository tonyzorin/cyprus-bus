const { query } = require('../database.js');
const fs = require('fs/promises');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// Constants must be defined before they're used
const MAX_WORKERS = 1;
const CHUNK_SIZE = 10;
const CHUNK_DELAY = 2000;
const STOP_DELAY = 200;

// If this is a worker thread
if (!isMainThread) {
    processStopRange(workerData.startIdx, workerData.endIdx, workerData.stops, workerData.outputDir)
        .then(() => parentPort.postMessage('done'))
        .catch(error => {
            console.error('Worker error:', error);
            process.exit(1);
        });
}

async function processStopRange(startIdx, endIdx, stops, outputDir) {
    // Process one FROM stop at a time
    for (let i = startIdx; i < endIdx; i++) {
        const fromStop = stops[i];
        console.log(`Processing FROM stop ${fromStop.stop_id} (${i + 1} of ${endIdx})`);

        // Process TO stops in chunks of 100
        const CHUNK_SIZE = 100;
        for (let j = 0; j < stops.length; j += CHUNK_SIZE) {
            const toStopsChunk = stops.slice(j, j + CHUNK_SIZE);
            console.log(`  Processing TO stops ${j + 1}-${j + toStopsChunk.length}`);

            try {
                // Get direct routes for this chunk
                const directRoutes = await query(`
                    SELECT DISTINCT 
                        r.route_short_name,
                        st1.stop_id::text as from_stop_id,
                        s1.name as from_stop_name,
                        s1.lat as from_stop_lat,
                        s1.lon as from_stop_lon,
                        st2.stop_id::text as to_stop_id,
                        s2.name as to_stop_name,
                        s2.lat as to_stop_lat,
                        s2.lon as to_stop_lon,
                        st2.stop_sequence - st1.stop_sequence as stops_between
                    FROM routes r
                    JOIN trips t ON r."routeId" = t."routeId"
                    JOIN stop_times st1 ON t."tripId" = st1.trip_id
                    JOIN stops s1 ON st1.stop_id::text = $1
                    JOIN stop_times st2 ON t."tripId" = st2.trip_id
                    JOIN stops s2 ON st2.stop_id::text = ANY($2::text[])
                    WHERE st2.stop_sequence > st1.stop_sequence
                `, [fromStop.stop_id.toString(), toStopsChunk.map(s => s.stop_id.toString())]);

                // Process each TO stop in the chunk
                for (const toStop of toStopsChunk) {
                    if (fromStop.stop_id === toStop.stop_id) continue;

                    const routeKey = `${fromStop.stop_id}${toStop.stop_id}`;
                    const filename = `${routeKey}.json`;
                    const filePath = path.join(outputDir, filename);

                    // Skip if file exists
                    try {
                        await fs.access(filePath);
                        continue;
                    } catch {}

                    // Find direct routes for this pair
                    const directOptions = directRoutes.rows.filter(
                        row => row.to_stop_id === toStop.stop_id.toString()
                    );

                    let routeData;
                    if (directOptions.length > 0) {
                        console.log(`Found ${directOptions.length} direct routes from ${fromStop.stop_id} to ${toStop.stop_id}`);
                        routeData = {
                            from_stop: {
                                id: fromStop.stop_id,
                                name: fromStop.name,
                                lat: fromStop.lat,
                                lon: fromStop.lon
                            },
                            to_stop: {
                                id: toStop.stop_id,
                                name: toStop.name,
                                lat: toStop.lat,
                                lon: toStop.lon
                            },
                            options: directOptions.map(row => ({
                                type: 'direct',
                                hops: [{
                                    route: row.route_short_name,
                                    from_stop: {
                                        id: row.from_stop_id,
                                        name: row.from_stop_name,
                                        lat: row.from_stop_lat,
                                        lon: row.from_stop_lon
                                    },
                                    to_stop: {
                                        id: row.to_stop_id,
                                        name: row.to_stop_name,
                                        lat: row.to_stop_lat,
                                        lon: row.to_stop_lon
                                    },
                                    stops_between: row.stops_between,
                                    estimated_time: row.stops_between * 2 + 5
                                }],
                                total_stops: row.stops_between,
                                estimated_time: row.stops_between * 2 + 5
                            }))
                        };
                    } else {
                        // Look for transfer options with better error handling
                        try {
                            console.log(`Looking for transfer routes from ${fromStop.stop_id} to ${toStop.stop_id}`);
                            const transferOptions = await findTransferOptions(fromStop.stop_id, toStop.stop_id);
                            console.log(`Found ${transferOptions.length} transfer options`);
                            
                            if (transferOptions.length > 0) {
                                routeData = {
                                    from_stop: {
                                        id: fromStop.stop_id,
                                        name: fromStop.name,
                                        lat: fromStop.lat,
                                        lon: fromStop.lon
                                    },
                                    to_stop: {
                                        id: toStop.stop_id,
                                        name: toStop.name,
                                        lat: toStop.lat,
                                        lon: toStop.lon
                                    },
                                    options: transferOptions.map(option => ({
                                        type: 'transfer',
                                        hops: option.hops,
                                        total_stops: option.total_stops,
                                        estimated_time: option.total_stops * 2 + 10 // 2 min per stop + 10 min transfer
                                    }))
                                };
                            } else {
                                // No routes found at all
                                routeData = {
                                    from_stop: {
                                        id: fromStop.stop_id,
                                        name: fromStop.name,
                                        lat: fromStop.lat,
                                        lon: fromStop.lon
                                    },
                                    to_stop: {
                                        id: toStop.stop_id,
                                        name: toStop.name,
                                        lat: toStop.lat,
                                        lon: toStop.lon
                                    },
                                    options: [],
                                    reason: "No direct routes or transfer options found"
                                };
                            }
                        } catch (error) {
                            console.error(`Error finding transfer options from ${fromStop.stop_id} to ${toStop.stop_id}:`, error);
                            routeData = {
                                from_stop: {
                                    id: fromStop.stop_id,
                                    name: fromStop.name,
                                    lat: fromStop.lat,
                                    lon: fromStop.lon
                                },
                                to_stop: {
                                    id: toStop.stop_id,
                                    name: toStop.name,
                                    lat: toStop.lat,
                                    lon: toStop.lon
                                },
                                options: [],
                                reason: "Error finding transfer options",
                                error: error.message
                            };
                        }
                    }

                    // Write file
                    await fs.writeFile(filePath, JSON.stringify(routeData, null, 2));

                    // Small delay between stops
                    await new Promise(resolve => setTimeout(resolve, STOP_DELAY));
                }

                // Delay between chunks
                await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));

            } catch (error) {
                console.error(`Error processing chunk for stop ${fromStop.stop_id}:`, error);
                // Continue with next chunk
                continue;
            }
        }
    }
}

async function generateRouteFiles() {
    if (!isMainThread) return;

    try {
        console.log('Starting route generation...');
        
        const outputDir = path.join(__dirname, 'generated');
        await fs.mkdir(outputDir, { recursive: true });
        
        // Get all stops
        const stopsResult = await query(`
            SELECT stop_id, name, lat, lon
            FROM stops
            WHERE stop_id >= 1000 AND stop_id <= 9999
            ORDER BY stop_id
        `);
        
        const stops = stopsResult.rows;
        console.log(`Found ${stops.length} valid stops`);

        // Create fewer workers
        const numCPUs = Math.min(os.cpus().length, MAX_WORKERS);
        const stopsPerWorker = Math.ceil(stops.length / numCPUs);
        
        const workers = [];
        for (let i = 0; i < numCPUs; i++) {
            const startIdx = i * stopsPerWorker;
            const endIdx = Math.min(startIdx + stopsPerWorker, stops.length);
            
            // Add delay between starting workers
            await new Promise(resolve => setTimeout(resolve, 1000));

            const worker = new Worker(__filename, {
                workerData: {
                    startIdx,
                    endIdx,
                    stops,
                    outputDir
                }
            });

            workers.push(new Promise((resolve, reject) => {
                worker.on('message', resolve);
                worker.on('error', reject);
                worker.on('exit', code => {
                    if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
                });
            }));
        }

        // Wait for all workers to complete
        await Promise.all(workers);
        console.log('\nRoute generation completed successfully!');

    } catch (error) {
        console.error('Error generating routes:', error);
        throw error;
    }
}

async function findTransferOptions(fromStopId, toStopId, maxHops = 3) {
    console.log(`Searching transfers from ${fromStopId} to ${toStopId} with max ${maxHops} hops`);
    
    // Get all routes with their stop sequences
    const routesAndStops = await query(`
        WITH route_sequences AS (
            SELECT DISTINCT 
                r.route_short_name,
                t."tripId",
                st.stop_id,
                s.name as stop_name,
                s.lat as stop_lat,
                s.lon as stop_lon,
                st.stop_sequence,
                LEAD(st.stop_id) OVER (
                    PARTITION BY t."tripId" 
                    ORDER BY st.stop_sequence
                ) as next_stop_id,
                LEAD(s.name) OVER (
                    PARTITION BY t."tripId" 
                    ORDER BY st.stop_sequence
                ) as next_stop_name,
                LEAD(s.lat) OVER (
                    PARTITION BY t."tripId" 
                    ORDER BY st.stop_sequence
                ) as next_stop_lat,
                LEAD(s.lon) OVER (
                    PARTITION BY t."tripId" 
                    ORDER BY st.stop_sequence
                ) as next_stop_lon
            FROM routes r
            JOIN trips t ON r."routeId" = t."routeId"
            JOIN stop_times st ON t."tripId" = st.trip_id
            JOIN stops s ON st.stop_id = s.stop_id
        )
        SELECT DISTINCT
            route_short_name,
            stop_id,
            stop_name,
            stop_lat,
            stop_lon,
            next_stop_id,
            next_stop_name,
            next_stop_lat,
            next_stop_lon
        FROM route_sequences
        WHERE next_stop_id IS NOT NULL
    `);

    console.log('Building route graph...');

    // Build a graph of connections
    const routeGraph = new Map(); // stop_id -> { routes, connections }
    routesAndStops.rows.forEach(row => {
        // Add current stop to graph
        if (!routeGraph.has(row.stop_id)) {
            routeGraph.set(row.stop_id, {
                name: row.stop_name,
                routes: new Set(),
                connections: new Map() // route -> Set of {stopId, stopName}
            });
        }
        const stopNode = routeGraph.get(row.stop_id);
        stopNode.routes.add(row.route_short_name);
        
        if (!stopNode.connections.has(row.route_short_name)) {
            stopNode.connections.set(row.route_short_name, new Set());
        }
        stopNode.connections.get(row.route_short_name).add({
            stopId: row.next_stop_id,
            stopName: row.next_stop_name,
            lat: row.next_stop_lat,
            lon: row.next_stop_lon
        });
    });

    console.log(`Graph built with ${routeGraph.size} stops`);

    // Find paths with up to maxHops transfers
    function findPaths(currentStop, targetStop, visited = new Set(), path = [], depth = 0) {
        if (depth > maxHops) return [];
        if (currentStop === targetStop) return [path];
        
        visited.add(currentStop);
        const paths = [];
        const currentNode = routeGraph.get(currentStop);
        
        if (!currentNode) {
            console.log(`No node found for stop ${currentStop}`);
            return [];
        }

        // Try each route from current stop
        for (const [route, nextStops] of currentNode.connections) {
            for (const nextStop of nextStops) {
                if (visited.has(nextStop.stopId)) continue;
                
                const newPath = [...path, {
                    route,
                    from_stop: {
                        id: currentStop,
                        name: currentNode.name,
                        lat: currentNode.lat,
                        lon: currentNode.lon
                    },
                    to_stop: {
                        id: nextStop.stopId,
                        name: nextStop.stopName,
                        lat: nextStop.lat,
                        lon: nextStop.lon
                    }
                }];

                const foundPaths = findPaths(nextStop.stopId, targetStop, new Set(visited), newPath, depth + 1);
                paths.push(...foundPaths);
            }
        }

        return paths;
    }

    console.log('Finding paths...');
    const allPaths = findPaths(fromStopId.toString(), toStopId.toString());
    console.log(`Found ${allPaths.length} possible paths with up to ${maxHops} hops`);

    // Convert paths to transfer options
    const options = allPaths
        .map(path => ({
            type: path.length === 1 ? 'direct' : 'multi_hop',
            hops: path,
            total_stops: path.length,
            estimated_time: path.length * 15 + (path.length - 1) * 10 // 15 min per hop + 10 min per transfer
        }))
        .sort((a, b) => a.total_stops - b.total_stops)
        .slice(0, 5); // Return top 5 options

    if (options.length === 0) {
        console.log('No paths found. Checking route availability:');
        // Debug: Check if stops are served by any routes
        const fromStopNode = routeGraph.get(fromStopId.toString());
        const toStopNode = routeGraph.get(toStopId.toString());
        
        console.log(`From stop ${fromStopId}:`);
        console.log(`- Found in graph: ${!!fromStopNode}`);
        console.log(`- Routes: ${fromStopNode ? Array.from(fromStopNode.routes).join(', ') : 'none'}`);
        
        console.log(`To stop ${toStopId}:`);
        console.log(`- Found in graph: ${!!toStopNode}`);
        console.log(`- Routes: ${toStopNode ? Array.from(toStopNode.routes).join(', ') : 'none'}`);
    }

    return options;
}

module.exports = { generateRouteFiles };

if (require.main === module && isMainThread) {
    generateRouteFiles()
        .then(() => process.exit(0))
        .catch(error => {
            console.error(error);
            process.exit(1);
        });
}
