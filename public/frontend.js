document.addEventListener('DOMContentLoaded', function () {
    initMap();
});

let map; // Declare map variable at the top level for global access
let busMarkers = []; // Array to store references to bus markers
let currentRoutePolyline = null; // This will store the current route polyline


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
    setInterval(fetchBusPositions, 7000); // Refresh bus positions every 10 seconds
}

var busStopIcon = L.icon({
    iconUrl: './images/bus-stop.png',
    iconSize: [16, 16],
    iconAnchor: [16, 16],
    popupAnchor: [0, -32]
});

var busIcon = L.icon({
    iconUrl: './images/pin0.png',
    iconSize: [35, 47],
    iconAnchor: [17.5, 35],
    popupAnchor: [0, -47]
});

var userIcon = L.icon({
    iconUrl: './images/current-location.png',
    iconSize: [40, 40],
    iconAnchor: [24, 40],
    popupAnchor: [0, 0]
});

function getbusIcon() {
    return L.icon({
        iconUrl: './images/pin0.png',
        iconSize: [32, 47],
        iconAnchor: [16, 47],
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
                        .bindPopup(`Bus <b>${routeShortName}</b> (vehicle ${vehicleLabel})<br>${routeLongName}<br>Route ID: ${entity.routeId}`);
                    marker.on('click', () => {
                        if (entity.routeId) {
                            onBusMarkerClick(entity.routeId);
                        } else {
                            console.error('routeId is undefined for vehicleLabel:', vehicleLabel);
                        }
                    });
    // Assuming entity.routeId is available
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
                    bindPopup(`Bus <b>${routeShortName}</b> (vehicle ${vehicleLabel})<br>${routeLongName}<br>Route ID: ${entity.routeId}`);
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

function onBusMarkerClick(routeId) {
    fetch(`/api/route-shapes/${routeId}`)
        .then(response => response.json())
        .then(shapePoints => {
            if (!Array.isArray(shapePoints) || shapePoints.length === 0) {
                console.warn("No route shapes returned for routeId:", routeId);
                return; // Exit the function if no shapes were returned
            }

            // Remove the previous route from the map if it exists
            if (currentRoutePolyline) {
                map.removeLayer(currentRoutePolyline);
                currentRoutePolyline = null; // Reset the currentRoutePolyline
            }

            const latLngs = shapePoints.map(point => [point.shape_pt_lat, point.shape_pt_lon]);
            const routeColor = `#${shapePoints[0].route_color}`; // Extract color

            if (latLngs.length > 0) {
                // Create the polyline without altering the map's view
                currentRoutePolyline = L.polyline(latLngs, {color: routeColor, weight: 6}).addTo(map);
                // Do not call map.fitBounds() to avoid changing the zoom level and center
            } else {
                console.warn("Invalid or empty latLngs array for routeId:", routeId);
            }
        })
        .catch(error => console.error('Error fetching route shapes:', error));
}



function showUserPosition() {
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(function(position) {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;

            // Define custom HTML content that includes both the image and the beacon effect
            const customHtmlContent = `
                <div class="custom-marker-container">
                    <img src="./images/current-location.png" alt="current location" class="user-icon" />
                    <div class="beacon"></div> <!-- Beacon effect -->
                </div>
            `;

            // Use Leaflet's DivIcon for the custom HTML content
            const customIcon = L.divIcon({
                className: 'custom-user-location-icon', // Custom class to avoid default leaflet marker styles
                iconSize: [40, 40], // Adjust based on the size of your icon image + beacon size
                html: customHtmlContent
            });

            // Create a marker with the custom icon and add it to the map
            L.marker([lat, lon], {icon: customIcon}).addTo(map);

            // Optionally, center the map on the user's location without changing the zoom level
            map.panTo([lat, lon]);
        }, function(error) {
            console.error("Geolocation error:", error);
        }, {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        });
    }
}
