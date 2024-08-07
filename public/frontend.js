document.addEventListener('DOMContentLoaded', function () {
    initMap();
    fetchGTFSStatus();
    setInterval(fetchGTFSStatus, 5000);
});

let map; // Declare map variable at the top level for global access
let busMarkers = {}; // Array to store references to bus markers
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
    }
    fetchBusPositions();
    showUserPosition();
    setInterval(fetchBusPositions, 3000); // Refresh bus positions every 10 seconds
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

async function fetchGTFSStatus() {
    try {
        const response = await fetch('/api/gtfs-status');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const status = await response.json();
        updateGTFSStatusUI(status);
    } catch (error) {
        console.error('Error fetching GTFS status:', error);
        updateGTFSStatusUI({gtfsStatus: 'unavailable', lastUpdateTime: null});
    }
}

function updateGTFSStatusUI(status) {
    const statusElement = document.getElementById('gtfs-status'); // Get the DOM element that displays the GTFS status.
    if (!statusElement) {
        console.error('Element with ID "gtfs-status" not found');
        return;
    }

    let customMessage;
    if (status.gtfsStatus.toLowerCase() === 'available') {
        customMessage = `Status ✅, Updated: ${status.lastUpdateTime})`;
        statusElement.style.color = 'green'; // Set the color to green if the status is "available"
    } else {
        customMessage = 'Status ❌ Data from Motion is not available.';
        statusElement.style.color = 'red'; // Set the color to red otherwise
    }

    statusElement.innerHTML = customMessage; // Set the inner HTML of the status element to the custom message
}

function fetchStops() {
    fetch('/api/stops')
        .then(response => response.json())
        .then(stops => {
            console.log(stops); // Log the stops data for debugging
            stops.forEach(stop => {
                L.marker([stop.lat, stop.lon], {icon: busStopIcon, zIndexOffset: 2}).addTo(map)
                    .bindPopup(`<b>${stop.name}</b>`);
            });
        })
        .catch(error => console.error('Error fetching stops:', error));
}

async function fetchOrCreatePin(routeShortName, routeColor, routeTextColor) {
    const displayText = routeShortName === "?" ? "?" : routeShortName;
    routeColor = routeColor.startsWith('#') ? routeColor : `#${routeColor}`;
    routeTextColor = routeTextColor.startsWith('#') ? routeTextColor : `#${routeTextColor}`;


    const svgContent = `
   <svg width="70" height="95" viewBox="0 0 70 95" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M34.9556 94.6442C34.0638 94.651 33.1921 94.3771 32.462 93.8607C31.7319 93.3443 31.1797 92.6112 30.8825 91.7634C26.3231 79.0907 9.31643 60.1199 9.13405 59.9207L9.02766 59.7828C4.49113 54.7241 1.50766 48.4471 0.43903 41.7129C-0.629603 34.9786 0.262503 28.0764 3.00718 21.8431C5.75186 15.6099 10.2312 10.3135 15.902 6.59609C21.5729 2.87869 28.1916 0.900024 34.9556 0.900024C41.7195 0.900024 48.3383 2.87869 54.0091 6.59609C59.6799 10.3135 64.1593 15.6099 66.9039 21.8431C69.6486 28.0764 70.5407 34.9786 69.4721 41.7129C68.4035 48.4471 65.42 54.7241 60.8834 59.7828L60.7771 59.9207C60.5947 60.1199 43.588 79.0907 39.0286 91.7634C38.7333 92.6124 38.1817 93.3469 37.4511 93.8636C36.7206 94.3803 35.8479 94.6533 34.9556 94.6442Z" fill="${routeColor}"/>
    <text x="35" y="47.5" text-anchor="middle" fill="${routeColor}" dy=".3em" style="font-size: 14px;">${routeShortName}</text
    ></svg>`;
    /*   const svgContent = `
      <svg width="70" height="95" viewBox="0 0 70 95" fill="none" xmlns="http://www.w3.org/2000/svg">
       <path d="M34.9556 94.6442C34.0638 94.651 33.1921 94.3771 32.462 93.8607C31.7319 93.3443 31.1797 92.6112 30.8825 91.7634C26.3231 79.0907 9.31643 60.1199 9.13405 59.9207L9.02766 59.7828C4.49113 54.7241 1.50766 48.4471 0.43903 41.7129C-0.629603 34.9786 0.262503 28.0764 3.00718 21.8431C5.75186 15.6099 10.2312 10.3135 15.902 6.59609C21.5729 2.87869 28.1916 0.900024 34.9556 0.900024C41.7195 0.900024 48.3383 2.87869 54.0091 6.59609C59.6799 10.3135 64.1593 15.6099 66.9039 21.8431C69.6486 28.0764 70.5407 34.9786 69.4721 41.7129C68.4035 48.4471 65.42 54.7241 60.8834 59.7828L60.7771 59.9207C60.5947 60.1199 43.588 79.0907 39.0286 91.7634C38.7333 92.6124 38.1817 93.3469 37.4511 93.8636C36.7206 94.3803 35.8479 94.6533 34.9556 94.6442Z" fill="${routeColor}"/>
       <g transform="rotate(${entity.vehicle.position.bearing}, 25, 25)">
       <text x="35" y="47.5" text-anchor="middle" fill="${routeColor}" dy=".3em" style="font-size: 14px;" transform="rotate(${entity.vehicle.position.bearing}, 25, 25)">>${routeShortName}</text
       ></svg>`;*/

    const encodedSvg = encodeURIComponent(svgContent);
    const iconUrl = `data:image/svg+xml;charset=UTF-8,${encodedSvg}`;

    return L.icon({
        iconUrl: iconUrl,
        // iconSize: [32, 47],
        // iconAnchor: [16, 47],
        // popupAnchor: [0, -47]
    });
}

// Assuming busStopMarkers is a global object storing markers keyed by stop_id


function clearRouteShapes() {
    routePolylines.forEach(polyline => polyline.remove());
    routePolylines = [];
}


function displayRouteShape(routeId) {
    fetch(`/api/route-shapes/${routeId}`)
        .then(response => response.json())
        .then(shapePoints => {
            const latLngs = shapePoints.map(point => [point.shape_pt_lat, point.shape_pt_lon]);
            const polyline = L.polyline(latLngs, {color: 'blue', weight: 3}).addTo(map);
            routePolylines.push(polyline); // Store reference to remove later
        })
        .catch(error => console.error(`Error fetching shape for route ${routeId}:`, error));
}


function fetchAndDisplayRoutesAndShapesForStop(stop_id) {
    clearRouteShapes(); // Clear existing route shapes

    fetch(`/api/routes-for-stop/${stop_id}`)
        .then(response => response.json())
        .then(routes => {
            // Update popup with routes list
            const routesListHtml = routes.map(route => `${route.route_short_name} - ${route.route_long_name}`).join("<br>");
            const popupContent = `<b>Routes:</b><br>${routesListHtml}`;

            const stopMarker = busStopMarkers[stop_id];
            if (stopMarker) {
                stopMarker.bindPopup(popupContent).openPopup();
            }

            // Display each route's shape
            routes.forEach(route => {
                displayRouteShape(route.routeId);
            });
        })
        .catch(error => console.error('Error fetching routes for stop:', error));
}

// Make sure to call fetchStops() to initialize the process.
//fetchStops();

/*
    let busStopsLayer;

    // Function to load bus stops around the current position
    async function fetchStops() {
    if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async (position) => {
    const {latitude, longitude} = position.coords;

    // Fetch bus stops
    const busStops = await fetchBusStops(latitude, longitude);

    // Remove existing bus stops layer if it exists
    if (busStopsLayer) {
    map.removeLayer(busStopsLayer);
}

    // Create a new layer for bus stops
    busStopsLayer = L.layerGroup();

    busStops.forEach(stop => {
    const marker = L.marker([stop.lat, stop.lon])
    .bindPopup(`<b>${stop.name}</b>`);
    busStopsLayer.addLayer(marker);
});

    // Add bus stops layer to the map
    busStopsLayer.addTo(map);

    // Center map on the current position
    map.setView([latitude, longitude], 14);
});
} else {
    alert('Geolocation is not supported by this browser.');
}
}

    // Event listener for the toggle button
    document.querySelector('.toggle-button').addEventListener('click', loadBusStops);
    */


async function processVehiclePositions(data) {
    const activeVehicleLabels = new Set();

    for (const entity of data) {
        const {latitude, longitude, markerIcon, vehicleLabel} = await extractMarkerData(entity);
        activeVehicleLabels.add(vehicleLabel);

        if (busMarkers[vehicleLabel]) {
            moveMarkerSmoothly(busMarkers[vehicleLabel], [latitude, longitude]);
        } else {
            busMarkers[vehicleLabel] = await createNewMarker(latitude, longitude, markerIcon, entity);
        }
    }

    cleanupMarkers(activeVehicleLabels);
}

async function fetchBusPositions() {
    try {
        const response = await fetch('/api/vehicle-positions');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        await processVehiclePositions(data);
    } catch (error) {
        console.error('Error fetching vehicle positions:', error);
        // Update the UI to show a generic error message
        document.getElementById("error-message").textContent = "🛑 Error on getting buses positions from Motion. 🤷️";
    }
}


async function extractMarkerData(entity) {
    const routeShortName = entity.routeShortName || "?";
    const latitude = entity.vehicle.position.latitude;
    const longitude = entity.vehicle.position.longitude;
    const bearing = entity.vehicle.position.bearing || 0;
    const vehicleLabel = entity.vehicle.vehicle.label || "N/A";
    const routeColor = entity.routeColor.startsWith('#') ? entity.routeColor : `#${entity.routeColor}`;
    const routeTextColor = entity.routeTextColor.startsWith('#') ? entity.routeTextColor : `#${entity.routeTextColor}`;// Wait for the icon to be fetched/created
    const markerIcon = await fetchOrCreatePin(routeShortName, entity.routeColor, entity.routeTextColor);

    return {latitude, longitude, markerIcon, vehicleLabel: entity.vehicle.vehicle.label};
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


async function createNewMarker(latitude, longitude, markerIcon, entity) {
    const bearing = entity.vehicle.position.bearing || 0; // Use 0 as default if undefined
    const routeShortName = entity.routeShortName || "?";
    const routeTextColor = entity.routeTextColor || "#000000"; // Default to black if undefined

    // Ensure routeTextColor starts with "#" for a valid hex color
    const validRouteTextColor = routeTextColor.startsWith('#') ? routeTextColor : `#${routeTextColor}`;

    // Constructing marker HTML content
    const customHtmlContent = `
        <div style="position: absolute; font-size: 12px; text-align: center; width: 70px; ">
            <div style="position: relative; top: 78%; left: 78%; transform: translateX(-50%) rotate(${bearing}deg);">
                <img src="${markerIcon.options.iconUrl}" style="width: 32px; height: 47px;">
                <div style="position: absolute; top: 22%; left: 22%; transform: translateX(-50%) rotate((180-${bearing})deg); color: #${entity.routeTextColor};">
                ${routeShortName}
            </div>
            </div>
        </div>
    `;

    const customIcon = L.divIcon({
        html: customHtmlContent,
        iconSize: [70, 95], // Adjusted to contain both the pin and text
        iconAnchor: [35, 47.5], // Centered anchor point
        popupAnchor: [0, -47.5] // Adjust if necessary
    });

    // Update or create a new marker
    if (busMarkers[entity.vehicle.vehicle.label]) {
        busMarkers[entity.vehicle.vehicle.label].setLatLng([latitude, longitude]).setIcon(customIcon);
    } else {
        busMarkers[entity.vehicle.vehicle.label] = L.marker([latitude, longitude], {icon: customIcon}).addTo(map);
        busMarkers[entity.vehicle.vehicle.label].bindPopup(generatePopupContent(entity));
    }

    // Attach a click event if needed
    busMarkers[entity.vehicle.vehicle.label].on('click', () => onBusMarkerClick(entity.routeId));

    return busMarkers[entity.vehicle.vehicle.label]; // Return the Leaflet marker instance
}


function generatePopupContent(entity) {
    if (entity.routeId === "?" || !entity.routeId) {
        return `Unknown Route<br>Route ID: Unknown<br>Route Short Name: ${entity.routeShortName || "N/A"}<br>Route Long Name: ${entity.routeLongName || "N/A"}`;
    } else {
        return `Bus <b>${entity.routeShortName}</b> (vehicle ${entity.vehicle.vehicle.label})<br>
                ${entity.routeLongName}<br>Route ID: ${entity.routeId}<br>Bearing: ${entity.vehicle.position.bearing || "N/A"}<br>
                Speed: ${Math.round(entity.vehicle.position.speed) || 0}`;
    }
}


// This function smoothly moves the marker and ensures the SVG icon is used
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
        navigator.geolocation.getCurrentPosition(function (position) {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;

            // Define custom HTML content that includes both the image and the beacon effect
            const customHtmlContent = `
                <div class="custom-marker-container">
                    <img src="images/current-location.png" alt="current location" class="user-icon on-top" style="z-index=1200"/>
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
        }, function (error) {
            console.error("Geolocation error:", error);
        }, {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        });
    }
}
