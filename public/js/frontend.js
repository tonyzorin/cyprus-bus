document.addEventListener('DOMContentLoaded', function () {
    initMap();
});

let map; // Declare map variable at the top level for global access
let busMarkers = []; // Array to store references to bus markers

function initMap() {
    // Initialize the map if it hasn't been already
    if (!map) {
        map = L.map('map').setView([34.679309, 33.037098], 17);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
    }
    fetchStops();
    fetchBusPositions();
    showUserPosition();
    setInterval(fetchBusPositions, 70000); // Refresh bus positions every 10 seconds
}

var busStopIcon = L.icon({
    iconUrl: './images/bus-stop.png',
    iconSize: [16, 16],
    iconAnchor: [16, 16],
    popupAnchor: [0, -32]
});

var busIcon = L.icon({
    iconUrl: './images/pin1.png',
    iconSize: [35, 47],
    iconAnchor: [17.5, 35],
    popupAnchor: [0, -47]
});

var userIcon = L.icon({
    iconUrl: './images/current-location.png',
    iconSize: [40, 40],
    iconAnchor: [24, 40],
    popupAnchor: [0, -40]
});

function getbusIcon() {
    return L.icon({
        iconUrl: './images/pin0.png',
        iconSize: [35, 47],
        iconAnchor: [17.5, 35],
        popupAnchor: [0, -47]
    });
}
function fetchStops() {
    fetch('/api/stops')
        .then(response => response.json())
        .then(stops => {
            console.log(stops); // Log the stops data for debugging
            stops.forEach(stop => {
                L.marker([stop.lat, stop.lon], {icon: busStopIcon}).addTo(map)
                    .bindPopup(`<b>${stop.name}</b>`);
            });
        })
        .catch(error => console.error('Error fetching stops:', error));
}


function fetchBusPositions() {
    fetch('/api/vehicle-positions')
        .then(response => response.json())
        .then(data => {
            const newMarkers = {}; // Temporary storage for markers processed in this fetch

            data.forEach(entity => {
                //const latitude = entity.vehicle.position?.latitude;
                //const longitude = entity.vehicle.position?.longitude;
                const {routeShortName, routeLongName} = entity;
                const {latitude, longitude} = entity.vehicle.position;
                const vehicleLabel = entity.vehicle.vehicle.label;
                if (busMarkers[vehicleLabel]) {
                    moveMarkerSmoothly(busMarkers[vehicleLabel], [latitude, longitude]);
                } else {
                    const marker = L.marker([latitude, longitude], {icon: getbusIcon(routeShortName)}).addTo(map)
                        .bindPopup(`Bus <b>${routeShortName}</b> (vehicle ${vehicleLabel})<br>${routeLongName}`);
                    marker.on('click', () => onBusMarkerClick(entity.routeId)); // Assuming entity.routeId is available
                    busMarkers[vehicleLabel] = marker;

                }
                newMarkers[vehicleLabel] = busMarkers[vehicleLabel];
                // Determine the correct pin image based on route number
                let pinImage = getbusIcon(routeShortName);

                if (busMarkers[vehicleLabel]) {
                    // Move existing marker smoothly to the new position
                    moveMarkerSmoothly(busMarkers[vehicleLabel], [latitude, longitude]);
                    // Update the icon if route has changed
                    busMarkers[vehicleLabel].setIcon(getbusIcon());
                } else {
                    // Create a new marker and add it to the map with the determined icon
                    const marker = L.marker([latitude, longitude], {icon: getBusIcon(routeShortName)}).addTo(map);
                    bindPopup(`Bus <b>${routeShortName}</b> (vehicle ${vehicleLabel})<br>${routeLongName}`);
                    busMarkers[vehicleLabel] = marker;
                }
                // Add to newMarkers to keep track of which markers are still active
                newMarkers[vehicleLabel] = busMarkers[vehicleLabel];
            });

            // Update busMarkers to reflect currently active markers
            busMarkers = newMarkers;
        })
        .catch(error => console.error('Error fetching vehicle positions:', error));
}




// Function to determine the correct pin image based on the route number
function getPinImage(routeShortName) {
    let match = routeShortName.match(/^(\d+)/);
    let routeNumber = match ? match[1] : '0'; // Default to '0' if no numeric part is found
    let pinImageFilename = `./images/pin${routeNumber}.png`;
    return pinImageFilename;
}

function moveMarkerSmoothly(marker, newPosition) {
    let latlngs = [marker.getLatLng(), L.latLng(newPosition)];
    let index = 0;
    let steps = 10;
    let interval = setInterval(() => {
        index++;
        let fraction = index / steps;
        let lat = latlngs[0].lat + (latlngs[1].lat - latlngs[0].lat) * fraction;
        let lng = latlngs[0].lng + (latlngs[1].lng - latlngs[0].lng) * fraction;
        marker.setLatLng([lat, lng]);
        if (index === steps) clearInterval(interval);
    }, 50); // Adjust timing for smoother animation
}

// This function is triggered when a bus marker is clicked

//fetch(`/api/route-shapes/30350012`)



function onBusMarkerClick(routeId) {
    fetch(`/api/route-shapes/30350012`)        .then(response => response.json())
        .then(shapePoints => {
            if (!Array.isArray(shapePoints) || shapePoints.length === 0) {
                console.warn("No route shapes returned for routeId:", routeId);
                return; // Exit the function if no shapes were returned
            }

            const latLngs = shapePoints.map(point => [point.shape_pt_lat, point.shape_pt_lon]);
            if (latLngs.length > 0) {
                const polyline = L.polyline(latLngs, {color: 'blue'}).addTo(map);
                map.fitBounds(polyline.getBounds());
            } else {
                console.warn("Invalid or empty latLngs array for routeId:", routeId);
            }
        })
        .catch(error => console.error('Error fetching route shapes:', error));
}


/*function onBusMarkerClick(routeId) {
    fetch(`/api/route-shapes/30350012`)
    //fetch(`/api/route-shapes/${routeId}`) // Ensure routeId is dynamically included in the request
        .then(response => response.json()) // Wait for JSON parsing
        .then(shapePoints => {
            if (!Array.isArray(shapePoints) || shapePoints.length === 0) {
                console.error("shapePoints is not an array or is empty", shapePoints);
                return; // Exit the function if shapePoints is not an array or is empty
            }

            // Create an array of latLng tuples from shapePoints
            const latLngs = shapePoints.map(point => {
                if (typeof point.shape_pt_lat === 'number' && typeof point.shape_pt_lon === 'number') {
                    return [point.shape_pt_lat, point.shape_pt_lon];
                }
                return null;
            }).filter(point => point !== null); // Filter out any null values that were added due to invalid data

            if (latLngs.length === 0) {
                console.error("No valid latitude and longitude values found in shapePoints", shapePoints);
                return; // Exit the function if no valid latLng tuples were created
            }

            console.log("Valid latLngs for polyline:", latLngs); // Log valid latLngs

            try {
                const polyline = L.polyline(latLngs, {color: 'blue'}).addTo(map); // Add polyline to the map
                map.fitBounds(polyline.getBounds()); // Fit map bounds to polyline
            } catch (error) {
                console.error("Error creating polyline or fitting map bounds:", error);
            }
        })
        .catch(error => console.error('Error fetching route shapes:', error));
}*/

function showUserPosition() {
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(function(position) {
            var lat = position.coords.latitude;
            var lon = position.coords.longitude;
            // Your code that uses lat and lon here
        });
    }
}