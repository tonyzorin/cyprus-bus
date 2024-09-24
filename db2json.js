const { query } = require('./database.js');
const fs = require('fs');

const exportTableToJson = async (tableName, outputFile) => {
    try {
        const res = await query(`SELECT * FROM ${tableName}`);
        fs.writeFileSync(outputFile, JSON.stringify(res.rows, null, 2));
        console.log(`Exported ${tableName} to ${outputFile}`);
    } catch (err) {
        console.error(`Error exporting ${tableName}:`, err.message);
    }
};

const main = async () => {
    await exportTableToJson('stops', 'stops.json');  // Change table name and output file as needed
    await exportTableToJson('routes', 'routes.json');  // Example for another table
    await exportTableToJson('shapes', 'shapes.json');
    await exportTableToJson('trips', 'trips.json');
    await exportTableToJson('stop_times', 'stop_times.json');
};

main().catch(err => console.error(err));
