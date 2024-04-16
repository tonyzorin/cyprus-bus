//1. Click on bus stop icon doesn't show routes and shapes
//2. Click on the bus icon doesn't show a pop-up with relevant info
//3. Bus pin shows bad font
//4. Bus pin rotated but shifted off the road
//5. Bus pin after updated rotates the text
//6. User location to be updated every 3 seconds

//7. If user's coordinate are not from Cyprus, show Cyprus coordinates with some zoom out
//7. Bus stops not ot be on top of everything

//7. Add airports
//8. Add bus stops for Intercity with specific pins
//9. Add pins fo RideNow
//10. Add bus stops for all regions
//11. Select a region for bus stops
//12


const LOGGING_ENABLED = 1; // Set to 0 to disable logging
//const refreshInterval = process.env.NODE_ENV === 'dev' ? 20000 : 5000;

document.addEventListener('DOMContentLoaded', function () {
    initMap();
    fetchStops();
});

let map; // Declare map variable at the top level for global access
let busMarkers = {}; // Array to store references to bus markers
let busStopMarkers = {};  // Define this at a global level
let currentRoutePolyline = null; // This will store the current route polyline

async function initMap() {
    // Initialize the map if it hasn't been already
    if (!map) {
        map = L.map('map', {
            center: [34.679309, 33.037098],
            zoom: 9,
            attributionControl: false // Disable the default attribution control
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Add a new attribution control at the top right ("topright")
        L.control.attribution({position: 'topright'}).addTo(map);
    }
    await fetchStops();
    fetchBusPositions();
    showUserPosition();
    //setInterval(fetchBusPositions, refreshInterval);
    setInterval(fetchBusPositions, 20000);

}

var userIcon = L.icon({
    iconUrl: './images/current-location.png',
    iconSize: [40, 40],
    iconAnchor: [24, 40],
    popupAnchor: [0, 0]
});

var busStopIcon = L.icon({
    iconUrl: './images/bus-stop.png',
    iconSize: [14, 14],
    iconAnchor: [14, 14],
    popupAnchor: [0, -28]
});

async function fetchStops() {
    try {
        const response = await fetch('/api/stops');
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const stops = await response.json();
        stops.forEach(stop => {
            const marker = L.marker([stop.lat, stop.lon], {icon: busStopIcon}).addTo(map);
            marker.stopId = stop.id;  // Ensure stop.id is the correct property
            // Ensure stop.id or the correct property that contains the stop ID is used here
            marker.on('click', () => displayRoutesForStop(marker.stopId));
        });
    } catch (error) {
        console.error('Error fetching stops:', error);
    }
}

async function displayRoutesForStop(stopId) {
    try {
        const response = await fetch(`/api/routes-for-stop/${stopId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const routes = await response.json();
        const routesInfo = routes.map(route => `Route ${route.route_short_name}`).join(", ");

        const popupContent = `<b>Routes at this stop:</b><br>${routesInfo}`;
        const stopMarker = busStopMarkers[stopId];
        if (stopMarker) {
            stopMarker.bindPopup(popupContent).openPopup();
        }

        routes.forEach(route => {
            displayRouteShape(route.routeId, route.route_color);
        });
    } catch (error) {
        console.error('Error fetching routes for stop:', error);
        // Handle cases where the error is due to non-JSON response
        if (!(error instanceof SyntaxError)) {
            alert(`Error fetching routes for stop: ${error.message}`);
        }
    }
}


function displayRouteShape(routeId, color) {
    fetch(`/api/route-shapes/${routeId}`)
        .then(response => response.json())
        .then(shapePoints => {
            const latLngs = shapePoints.map(point => [point.shape_pt_lat, point.shape_pt_lon]);
            const polyline = L.polyline(latLngs, { color: `#${color}`, weight: 5 }).addTo(map);
            currentRoutePolyline.push(polyline); // Store polyline to manage later
        });
}




function generatePopupContent(entity) {
    if (!entity || !entity.routeId) {
        return 'Information unavailable';
    }
    // Construct and return the HTML content string based on `entity`
    return `
        <div>Route Short Name: ${entity.routeShortName}</div>
        <div>Route ID: ${entity.routeId}</div>
        <div>Vehicle: ${entity.vehicle.vehicle.label}</div>
        <div>${entity.routeLongName}</div>
        <div>Bearing: ${entity.vehicle.position.bearing || "N/A"}</div>
        <div>Route color: ${entity.routeColor || "N/A"}</div>
        <div>Text color: ${entity.routeTextColor || "N/A"}</div>
        <div>Speed: ${Math.round(entity.vehicle.position.speed) || 0}</div>
    `;
}

async function fetchBusPositions() {
    try {
        const response = await fetch('/api/vehicle-positions');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        // Clear previous error messages
        document.getElementById("error-message").textContent = "";

        // Check for specific error message from backend
        if (data.error && data.error === "GTFS data is currently not available. Please try again later.") {
            document.getElementById("error-message").textContent = "🛑 Error on getting buses positions from Motion. 🤷‍♂️";
            return; // Stop further processing
        }

        await processVehiclePositions(data);
    } catch (error) {
        console.error('Error fetching vehicle positions:', error);
        // Update the UI to show a generic error message
        document.getElementById("error-message").textContent = "🛑 Error on getting buses positions from Motion. 🤷‍♂️";
    }
}




async function processVehiclePositions(data) {
    const activeVehicleLabels = new Set(); // Track active vehicles

    for (const entity of data) {
        const {latitude, longitude, markerIcon, vehicleLabel} = await extractMarkerData(entity);
        activeVehicleLabels.add(vehicleLabel);

        if (busMarkers[vehicleLabel]) {
            moveMarkerSmoothly(busMarkers[vehicleLabel], [latitude, longitude]);

            // Update the icon with new bearing
            const bearing = entity.vehicle.position.bearing+180 || 0; // Default to 0 if undefined
            const customHtmlContent = `<div style="transform: rotate(${bearing}deg);"><img src="${markerIcon.options.iconUrl}" style="width: 32px; height: 47px;"/></div>`;
            const customIcon = L.divIcon({
                html: customHtmlContent,
                iconSize: [32, 47],
                iconAnchor: [16, 23.5], // Adjust as necessary
                popupAnchor: [0, -23.5] // Adjust as necessary
            });

            busMarkers[vehicleLabel].setIcon(customIcon);
        }
        else {
            // If marker doesn't exist, create a new one
            busMarkers[vehicleLabel] = await createNewMarker(latitude, longitude, markerIcon, entity);
        }

    }

    // Now cleanup markers for vehicles no longer present
    cleanupMarkers(activeVehicleLabels);
}




async function extractMarkerData(entity) {
    const routeShortName = entity.routeShortName || "Unknown";
    const latitude = entity.vehicle.position.latitude;
    const longitude = entity.vehicle.position.longitude;
    const bearing = entity.vehicle.position.bearing || 0;
    const vehicleLabel = entity.vehicle.vehicle.label || "N/A";
    const routeColor = entity.routeColor || "#000000";
    const textColor = entity.routeTextColor || "#ffffff";
    // Wait for the icon to be fetched/created
    const markerIcon = await fetchOrCreatePin(routeShortName, entity.routeColor, entity.routeTextColor);

    return { latitude, longitude, markerIcon, vehicleLabel: entity.vehicle.vehicle.label };
}

function cleanupMarkers(activeVehicleLabels) {
    Object.keys(busMarkers).forEach(vehicleLabel => {
        if (!activeVehicleLabels.has(vehicleLabel)) {
            // Remove marker if vehicleLabel is not in activeVehicleLabels
            if (busMarkers[vehicleLabel].remove) {
                busMarkers[vehicleLabel].remove(); // Remove from map
            }
            delete busMarkers[vehicleLabel]; // Delete from busMarkers
        }
    });
}

/**
 * Creates or fetches a pin icon for a bus marker.
 * @param {string} routeShortName - Short name of the route.
 * @param {string} routeColor - Background color of the pin.
 * @param {string} textColor - Color of the text on the pin.
 * @returns {L.Icon} - Leaflet icon object.
 */
async function fetchOrCreatePin(routeShortName, routeColor, textColor, bearing = 0) {
    routeColor = routeColor.startsWith('#') ? routeColor : `#${routeColor}`;
    textColor = textColor.startsWith('#') ? textColor : `#${textColor}`;

    // SVG content with separated rotation for the icon and counter-rotation for the text
    const svgContent = `
        <svg width="30" height="48" viewBox="0 0 30 48" xmlns="http://www.w3.org/2000/svg">
            <g transform="rotate(${bearing}, 15, 24)">
                <path d="M15 0C6.716 0 0 6.716 0 15C0 30 15 48 15 48C15 48 30 30 30 15C30 6.716 23.284 0 15 0Z" fill="${routeColor}"/>
            </g>
            <g transform="rotate(${-bearing}, 15, 34)">
                <text x="15" y="34" text-anchor="middle" style="fill: ${textColor}; font-size: 12px; font-family: Arial, sans-serif;">
                    ${routeShortName}
                </text>
            </g>
        </svg>
    `;

    const encodedSvg = encodeURIComponent(svgContent);
    const iconUrl = `data:image/svg+xml;charset=UTF-8,${encodedSvg}`;

    return L.icon({
        iconUrl: iconUrl,
        iconSize: [30, 48],
        iconAnchor: [15, 48],
        popupAnchor: [0, -48]
    });
}
async function extractMarkerData(entity) {
    const routeShortName = entity.routeShortName || "Unknown";
    const latitude = entity.vehicle.position.latitude;
    const longitude = entity.vehicle.position.longitude;
    const bearing = entity.vehicle.position.bearing || 0; // Get the bearing from vehicle data
    const vehicleLabel = entity.vehicle.vehicle.label || "N/A";
    const routeColor = entity.routeColor || "#000000";
    const textColor = entity.routeTextColor || "#ffffff";

    const markerIcon = await fetchOrCreatePin(routeShortName, routeColor, textColor, bearing);

    return { latitude, longitude, markerIcon, vehicleLabel: entity.vehicle.vehicle.label };
}



async function createNewMarker(latitude, longitude, markerIcon, entity) {
    const bearing = entity.vehicle.position.bearing || 0; // Use 0 as default if undefined

    // Prepare the pin image with rotation
    const pinHtmlContent = `<img src="${markerIcon.options.iconUrl}" style="transform: rotate(${bearing}deg); width: 32px; height: 47px;"/>`;

    // Prepare the text without rotation, ensuring it stays horizontal
    const textHtmlContent = `<div style="transform rotate(-${bearing}deg) position: absolute; top: -20px; left: -16px; width: 64px; text-align: center; font-size: 12px; color: #000;">${entity.routeShortName || "?"}</div>`;

    // Combine both pin and text into custom HTML content
    const customHtmlContent = `
        <div style="position: absolute; display: inline-block;">
            ${pinHtmlContent}<div style="transform: rotate(${bearing}deg);"></div>
            
        </div>
    `;

    const customIcon = L.divIcon({
        html: customHtmlContent,
        iconSize: [32, 47], // Size of the icon
        iconAnchor: [16, 47], // Ensures the pin points to the exact location
        popupAnchor: [0, -47] // Adjust if necessary
    });

    const marker = L.marker([latitude, longitude], { icon: customIcon }).addTo(map);
    marker.bindPopup(generatePopupContent(entity));

    // Attach click event if needed
    marker.on('click', () => displayRouteShape(entity.routeId));

    return marker; // Return the Leaflet marker instance
}


function moveMarkerSmoothly(marker, newPosition) {
    if (!marker || typeof marker.getLatLng !== 'function') {
        console.error('Invalid marker passed to moveMarkerSmoothly.');
        return;
    }
    let currentLatLng = marker.getLatLng();
    let newLatLng = L.latLng(newPosition);
    let distance = currentLatLng.distanceTo(newLatLng);
    let steps = distance / 10; // Determine the number of steps based on distance
    let stepLat = (newLatLng.lat - currentLatLng.lat) / steps;
    let stepLng = (newLatLng.lng - currentLatLng.lng) / steps;

    let i = 0;
    let interval = setInterval(() => {
        if (i < steps) {
            i++;
            marker.setLatLng([currentLatLng.lat + (stepLat * i), currentLatLng.lng + (stepLng * i)]);
        } else {
            clearInterval(interval);
            marker.setLatLng(newLatLng); // Ensure marker ends exactly at the new position
        }
    }, 20); // Adjust the interval time (in milliseconds) as needed for smoothness
}


function displayRouteShape(routeId) {
    // Check if the routeId is "Unknown" and exit early if so
    if (routeId === "") {
        console.warn("Route details are unknown. Cannot fetch route shapes.");
        // Optionally, display a message to the user here.
        return; // Exit the function early
    }

    // Proceed to fetch route shapes if the routeId is known
    fetch(`/api/route-shapes/${routeId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
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
                    <img src="images/current-location.png" alt="current location" class="user-icon on-top"/>
                    <div class="beacon"></div> <!-- Beacon effect -->
                </div>
            `;

            // Use Leaflet's DivIcon for the custom HTML content
            const customIcon = L.divIcon({
                className: 'custom-user-location-icon z-index=1200', // Custom class to avoid default leaflet marker styles
                iconSize: [40, 40], // Adjust based on the size of your icon image + beacon size
                html: customHtmlContent
            });

            // Create a marker with the custom icon and add it to the map
            L.marker([lat, lon], {icon: customIcon}).addTo(map);

            // Center the map on the user's location and adjust zoom level to 7
            map.setView([lat, lon], 16);
        }, function(error) {
            console.error("Geolocation error:", error);
        }, {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        });
    }
}