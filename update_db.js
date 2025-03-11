require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const StreamZip = require('node-stream-zip');
const { query } = require('./database');

const cityUrls = {
    'limassol': "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C6_google_transit.zip&rel=True",
    'pafos': "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C2_google_transit.zip&rel=True", 
    'famagusta': "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C4_google_transit.zip&rel=True",
    'intercity': "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C5_google_transit.zip&rel=True",
    'nicosia': "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C9_google_transit.zip&rel=True",
    'larnaca': "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C10_google_transit.zip&rel=True",
    'pame_express': "https://motionbuscard.org.cy/opendata/downloadfile?file=GTFS%5C11_google_transit.zip&rel=True"
};

const createTablesSql = `
CREATE TABLE IF NOT EXISTS stops (
    stop_id INTEGER PRIMARY KEY,
    stop_code TEXT,
    stop_name TEXT,
    stop_desc TEXT,
    stop_lat DOUBLE PRECISION,
    stop_lon DOUBLE PRECISION,
    zone_id TEXT
);

CREATE TABLE IF NOT EXISTS routes (
    city VARCHAR(50),
    route_id INTEGER,
    agency_id INTEGER,
    route_short_name TEXT,
    route_long_name TEXT,
    route_desc TEXT,
    route_type INTEGER,
    route_color TEXT,
    route_text_color TEXT,
    PRIMARY KEY (city, route_id)
);

CREATE TABLE IF NOT EXISTS calendar_dates (
    service_id INTEGER,
    "date" INTEGER,
    exception_type INTEGER,
    PRIMARY KEY (service_id, "date")
);

CREATE TABLE IF NOT EXISTS shapes (
    shape_id INTEGER,
    shape_pt_lat DOUBLE PRECISION,
    shape_pt_lon DOUBLE PRECISION,
    shape_pt_sequence INTEGER,
    PRIMARY KEY (shape_id, shape_pt_sequence)
);

CREATE TABLE IF NOT EXISTS trips (
    trip_id INTEGER PRIMARY KEY,
    route_id INTEGER,
    service_id INTEGER,
    trip_headsign TEXT,
    direction_id INTEGER,
    shape_id INTEGER
);

CREATE TABLE IF NOT EXISTS stop_times (
    trip_id INTEGER,
    arrival_time TEXT,
    departure_time TEXT,
    stop_id INTEGER,
    stop_sequence INTEGER,
    stop_headsign TEXT,
    pickup_type INTEGER,
    drop_off_type INTEGER,
    PRIMARY KEY (trip_id, stop_sequence)
);
`;

async function createTables() {
    console.log('Creating database tables...');
    await query(createTablesSql);
    console.log('Tables created successfully');
}

async function truncateTables() {
    console.log('Dropping all GTFS tables...');
    const tables = [
        'stop_times',
        'trips',
        'calendar_dates',
        'shapes',
        'routes',
        'stops'
    ];
    
    for (const table of tables) {
        console.log(`Dropping table ${table}...`);
        await query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    console.log('All tables dropped successfully');

    // Create fresh tables with new schema
    console.log('Creating tables with new schema...');
    await query(createTablesSql);
    console.log('Tables created successfully');
}

async function downloadGTFSFile(city, url) {
    const zipPath = path.join(__dirname, 'gtfs_data', `${city}.zip`);
    
    // Ensure directory exists
    await fs.promises.mkdir(path.join(__dirname, 'gtfs_data'), { recursive: true });
    
    console.log(`Downloading GTFS for ${city} from ${url}...`);
    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'Accept': '*/*',
                'User-Agent': 'Cyprus-Bus-Tracker/1.0'
            },
            maxContentLength: 50 * 1024 * 1024
        });
        
        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        await fs.promises.writeFile(zipPath, response.data);
        
        // Verify file exists and log its size
        const stats = await fs.promises.stat(zipPath);
        console.log(`Downloaded ${city} GTFS to ${zipPath} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
        
        // Try to list zip contents
        const zip = new StreamZip.async({ file: zipPath });
        const entries = await zip.entries();
        console.log(`Zip contains ${Object.keys(entries).length} files:`, 
            Object.keys(entries).join(', '));
        await zip.close();
        
        return zipPath;
    } catch (error) {
        console.error(`Failed to download/process ${city} GTFS:`, {
            message: error.message,
            code: error.code,
            response: error.response?.status,
            url: url,
            path: zipPath
        });
        throw error;
    }
}

async function processGTFSFile(zipPath, tableName) {
    console.log(`Processing ${tableName}.txt from ${zipPath}...`);
    const zip = new StreamZip.async({ file: zipPath });
    
    try {
        const entries = await zip.entries();
        const fileName = `${tableName}.txt`;
        
        if (!entries[fileName]) {
            console.log(`No ${fileName} found in zip`);
            return null;
        }
        
        const data = await zip.entryData(fileName);
        const content = data.toString('utf8');
        
        // Validate content
        const lines = content.split('\n');
        if (lines.length < 2) {
            console.log(`Empty ${fileName} file`);
            return null;
        }
        
        const headers = lines[0].trim().split(',').map(h => h.trim());
        console.log(`Found ${lines.length - 1} records with columns: ${headers.join(', ')}`);
        
        return content;
    } catch (error) {
        console.error(`Error processing ${tableName}.txt:`, error.message);
        return null;
    } finally {
        await zip.close();
    }
}

async function importGTFSData() {
    const baseDir = path.join(__dirname, 'gtfs_data');
    
    // Define import order to satisfy foreign key constraints
    const importOrder = [
        // Independent tables (no foreign keys):
        'stops',       // Referenced by stop_times
        'shapes',      // Referenced by trips (optional)
        'routes',      // Independent (agency constraint removed)
        'calendar_dates', // Independent
        
        // First level dependencies:
        'trips',       // Needs routes
        
        // Second level dependencies:
        'stop_times'   // Needs trips and stops
    ];
    
    for (const table of importOrder) {
        console.log(`\nProcessing ${table} table...`);
        
        // Add debug for trips
        if (table === 'trips') {
            const routeCount = await query('SELECT COUNT(*) FROM routes');
            console.log(`Before importing trips, we have ${routeCount.rows[0].count} routes`);
            
            // Sample some routes
            const routeSample = await query('SELECT route_id FROM routes LIMIT 5');
            console.log('Sample routes:', routeSample.rows);
        }

        for (const [city, _] of Object.entries(cityUrls)) {
            const zipPath = path.join(baseDir, `${city}.zip`);
            console.log(`Importing ${table} from ${city}...`);
            
            try {
                const data = await processGTFSFile(zipPath, table);
                if (!data) {
                    console.log(`No ${table} data found for ${city}`);
                    continue;
                }

                // Process the data and insert into database
                const lines = data.split('\n');
                const headers = lines[0].trim().split(',').map(h => h.trim());
                
                // Prepare batch insert
                const batchSize = 1000;
                let batch = [];
                
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    
                    const values = line.split(',').map(val => val.trim());
                    if (values.length !== headers.length) continue;
                    
                    const rowData = {};
                    headers.forEach((header, index) => {
                        rowData[header] = values[index];
                    });
                    
                    batch.push(rowData);
                    
                    if (batch.length >= batchSize || i === lines.length - 1) {
                        const columns = headers;
                        const valuesSql = batch.map((_, idx) => 
                            `(${headers.map((_, colIdx) => `$${idx * headers.length + colIdx + 1}`).join(',')})`
                        ).join(',');
                        
                        const values = batch.flatMap(row => headers.map(h => row[h]));
                        
                        const sql = `
                            INSERT INTO ${table} (${columns.join(',')})
                            VALUES ${valuesSql}
                            ON CONFLICT DO NOTHING
                        `;
                        
                        await query(sql, values);
                        batch = [];
                    }
                }
                
                console.log(`Imported ${table} data from ${city}`);

                if (table === 'trips') {
                    // After importing trips for each city
                    const tripCount = await query('SELECT COUNT(*) FROM trips');
                    console.log(`After importing ${city} trips, total trips: ${tripCount.rows[0].count}`);
                }
            } catch (error) {
                console.error(`Error importing ${table} from ${city}:`, error.message);
            }
        }

        // After all cities
        if (table === 'trips') {
            const tripCount = await query('SELECT COUNT(*) FROM trips');
            console.log(`Final trip count: ${tripCount.rows[0].count}`);
            
            if (tripCount.rows[0].count === 0) {
                console.error('No trips were imported! Check routes and trip import process');
                // Maybe throw error here to stop the process
            }
        }
    }
}

async function generateRoutesByCity() {
    for (const [city, _] of Object.entries(cityUrls)) {
        const zipPath = path.join(__dirname, 'gtfs_data', `${city}.zip`);
        console.log(`Processing routes for ${city}...`);
        
        const routesContent = await processGTFSFile(zipPath, 'routes');
        if (!routesContent) {
            console.log(`No routes found for ${city}`);
            continue;
        }

        const lines = routesContent.split('\n');
        const headers = lines[0].trim().split(',');
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const values = line.split(',').map(val => val.trim());
            if (values.length !== headers.length) continue;
            
            const routeData = {};
            headers.forEach((header, index) => {
                routeData[header] = values[index];
            });
            
            await query(
                'INSERT INTO routes_by_city (city, route_id, route_short_name) VALUES ($1, $2, $3) ON CONFLICT (route_id) DO UPDATE SET city = $1, route_short_name = $3',
                [city, routeData.route_id, routeData.route_short_name || '']
            );
        }
        
        console.log(`Added routes from ${city}`);
    }
}

async function generateRoutesSQL() {
    try {
        // Write schema first
        const routeSchema = `
CREATE TABLE IF NOT EXISTS routes (
    city VARCHAR(50),
    route_id INTEGER,
    agency_id INTEGER,
    route_short_name TEXT,
    route_long_name TEXT,
    route_desc TEXT,
    route_type INTEGER,
    route_color TEXT,
    route_text_color TEXT,
    PRIMARY KEY (city, route_id)
);\n\n`;

        await fs.promises.writeFile('routes_import.sql', routeSchema);
        
        // Process each city
        for (const [city, url] of Object.entries(cityUrls)) {
            console.log(`\nProcessing routes for ${city}...`);
            
            // Download GTFS if needed
            const zipPath = path.join(__dirname, 'gtfs_data', `${city}.zip`);
            if (!fs.existsSync(zipPath)) {
                await downloadGTFSFile(city, url);
            }
            
            // Process routes file
            const data = await processGTFSFile(zipPath, 'routes');
            if (!data) continue;
            
            // Generate SQL inserts
            const lines = data.split('\n');
            const headers = lines[0].trim().split(',').map(h => h.trim());
            let sql = `\n-- Routes from ${city}\n`;
            
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const values = line.split(',').map(val => val.trim());
                if (values.length !== headers.length) continue;
                
                const processedValues = processValues('routes', headers, values);
                sql += `INSERT INTO routes (city, ${headers.join(', ')}) VALUES ('${city}', ${processedValues});\n`;
            }
            
            // Append to file
            await fs.promises.appendFile('routes_import.sql', sql);
        }
        
        console.log('\nRoutes SQL file generated: routes_import.sql');
    } catch (error) {
        console.error('Error generating routes SQL:', error);
        throw error;
    }
}

// Helper function to process values based on table and column
function processValues(table, headers, values) {
    return headers.map((header, index) => {
        const value = values[index];
        if (!value || value === '') return 'NULL';
        
        try {
            // Clean the value first
            const cleanValue = value
                .replace(/´/g, "'")  // Replace special quote with standard quote
                .replace(/'/g, "''"); // Escape single quotes for SQL
            
            switch(table) {
                case 'stops':
                    if (header === 'stop_id') return parseInt(value);
                    if (header === 'stop_lat' || header === 'stop_lon') return parseFloat(value);
                    if (['stop_code', 'stop_name', 'stop_desc', 'zone_id'].includes(header)) 
                        return `'${cleanValue}'`;
                    return 'NULL';
                case 'routes':
                    if (header === 'route_id') return parseInt(value);
                    if (header === 'route_type') return parseInt(value);
                    if (['agency_id', 'route_short_name', 'route_long_name', 'route_desc', 'route_color', 'route_text_color'].includes(header))
                        return `'${cleanValue}'`;
                    return 'NULL';
                case 'shapes':
                    if (header === 'shape_id') return parseInt(value);
                    if (header.includes('_lat') || header.includes('_lon')) return parseFloat(value);
                    if (header === 'shape_pt_sequence') return parseInt(value);
                    return `'${cleanValue}'`;
                case 'trips':
                    if (['trip_id', 'route_id', 'service_id', 'shape_id'].includes(header)) return parseInt(value);
                    return `'${cleanValue}'`;
                case 'stop_times':
                    if (['trip_id', 'stop_id', 'stop_sequence'].includes(header)) return parseInt(value);
                    return `'${cleanValue}'`;
                case 'calendar_dates':
                    if (['service_id', 'date', 'exception_type'].includes(header)) return parseInt(value);
                    return `'${cleanValue}'`;
                default:
                    return `'${cleanValue}'`;
            }
        } catch (error) {
            console.error(`Error processing ${table}.${header} value "${value}":`, error.message);
            return 'NULL';
        }
    }).join(', ');
}

async function updateDatabase() {
    try {
        console.log('Starting GTFS update process...');
        
        // Create gtfs_data directory if it doesn't exist
        const gtfsDir = path.join(__dirname, 'gtfs_data');
        await fs.promises.mkdir(gtfsDir, { recursive: true });
        
        const tables = [
            'stops',      // Independent
            'shapes',     // Independent
            'routes',     // Independent
            'calendar_dates', // Independent
            'trips',      // Needs routes
            'stop_times'  // Needs stops and trips
        ];
        
        // Write schema
        console.log('Writing schema...');
        await fs.promises.writeFile('gtfs_import.sql', createTablesSql + '\n\n');
        
        // Process each table
        for (const table of tables) {
            console.log(`\nProcessing ${table}...`);
            
            // Keep track of processed IDs for stops
            const processedStopIds = new Set();
            
            for (const [city, url] of Object.entries(cityUrls)) {
                console.log(`\nCity: ${city}`);
                
                // Download GTFS if not exists
                const zipPath = path.join(gtfsDir, `${city}.zip`);
                if (!fs.existsSync(zipPath)) {
                    await downloadGTFSFile(city, url);
                } else {
                    console.log(`Using existing GTFS file for ${city}`);
                }
                
                // Process file
                const data = await processGTFSFile(zipPath, table);
                if (!data) continue;
                
                // Generate SQL
                let sql = `\n-- ${table} data from ${city}\n`;
                const lines = data.split('\n');
                const headers = lines[0].trim().split(',').map(h => h.trim());
                
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    
                    const values = line.split(',').map(val => val.trim());
                    if (values.length !== headers.length) continue;
                    
                    if (table === 'stops') {
                        const stopId = values[headers.indexOf('stop_id')];
                        if (processedStopIds.has(stopId)) {
                            console.log(`Duplicate stop_id ${stopId} found in ${city}, previously seen`);
                            continue;
                        }
                        processedStopIds.add(stopId);
                    }
                    
                    const processedValues = processValues(table, headers, values);
                    
                    if (table === 'routes') {
                        sql += `INSERT INTO ${table} (city, ${headers.join(', ')}) VALUES ('${city}', ${processedValues});\n`;
                    } else {
                        sql += `INSERT INTO ${table} (${headers.join(', ')}) VALUES (${processedValues});\n`;
                    }
                }
                
                // Write to file
                await fs.promises.appendFile('gtfs_import.sql', sql);
            }
        }
        
        console.log('\nSQL file generation completed');
        console.log('GTFS files are stored in:', gtfsDir);
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    generateRoutesSQL().then(() => process.exit());
}

module.exports = { updateDatabase };
