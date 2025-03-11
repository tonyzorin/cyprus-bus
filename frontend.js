async function debugGTFSData() {
    try {
        // Fetch and log vehicle positions
        const posResponse = await fetch('/api/vehicle-positions/raw');
        const posData = await posResponse.json();
        
        // Log full GTFS data
        console.log('Full GTFS Feed:', posData);
        
        // Extract and log all unique route IDs with their vehicles
        const routeMapping = posData.entity.reduce((acc, entity) => {
            const routeId = entity.vehicle?.trip?.routeId;
            const vehicleId = entity.vehicle?.vehicle?.id;
            if (routeId) {
                if (!acc[routeId]) {
                    acc[routeId] = [];
                }
                acc[routeId].push(vehicleId);
            }
            return acc;
        }, {});
        
        console.log('Route ID to Vehicle mapping:', routeMapping);
        
        // Log vehicle details
        console.log('Current Vehicle Details:', vehicleDetails);
        
        // Compare with database route IDs
        const dbResponse = await fetch('/api/routes-by-city');
        const dbRoutes = await dbResponse.json();
        console.log('Database Routes:', dbRoutes);
        
        const debugResponse = await fetch('/api/debug/gtfs');
        const debugData = await debugResponse.json();
        
        console.log('=== GTFS Debug Data ===');
        console.log('Timestamp:', new Date(debugData.timestamp * 1000).toLocaleString());
        console.log('Total Vehicles:', debugData.totalVehicles);
        console.log('\nVehicles:');
        debugData.vehicles.forEach(v => {
            console.log(`
Vehicle ID: ${v.vehicleId}
Route ID: ${v.routeId}
Trip ID: ${v.tripId}
Position: ${v.position.lat}, ${v.position.lon} (bearing: ${v.position.bearing})
-------------------`);
        });
        
    } catch (error) {
        console.error('Error fetching debug data:', error);
    }
}

// Call this after loading vehicle details
async function loadVehicleDetails() {
    try {
        const response = await fetch('/api/vehicle-details');
        if (!response.ok) throw new Error('Failed to fetch vehicle details');
        const details = await response.json();
        
        console.log('Loaded vehicle details:', details.length, 'vehicles');
        
        vehicleDetails = details.reduce((acc, detail) => {
            acc[detail.id] = detail;
            return acc;
        }, {});

        console.log('Vehicle details mapped:', Object.keys(vehicleDetails).length, 'entries');
        
        // Add debug call here
        await debugGTFSData();
        
    } catch (error) {
        console.error('Error loading vehicle details:', error);
    }
} 