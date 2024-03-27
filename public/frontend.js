const LOGGING_ENABLED = 1; // Set to 0 to disable logging
document.addEventListener('DOMContentLoaded', function () {
    initMap();
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

        // Add a new attribution control at the top right ("topright")
        L.control.attribution({position: 'topright'}).addTo(map);
    }
    await fetchStops();
    fetchBusPositions();
    showUserPosition();
    setInterval(fetchBusPositions, 5000); // Refresh bus positions every 10 seconds
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
    // Defaulting to pin0.png and "?" for unknown routes
    const isUnknownRoute = routeShortName === "Unknown" || !routeShortName || routeColor === "Unknown" || !routeColor;
    const pinImagePath = routeColor === "Unknown" ? './images/pins/pin0.png' : `./images/pins/${routeColor}.png`;
    const displayText = routeShortName === "Unknown" ? "?" : routeShortName;

    let pinImage = new Image();
    pinImage.src = pinImagePath;

    try {
        await pinImage.decode();

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 32;
        canvas.height = 47;

        ctx.drawImage(pinImage, 0, 0, 32, 47);
        ctx.fillStyle = `#${routeTextColor}`;
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        const textX = canvas.width / 2;
        const textY = canvas.height / 2.5;
        ctx.fillText(displayText, textX, textY);

        const iconUrl = canvas.toDataURL('image/png');
        return L.icon({
            iconUrl: iconUrl,
            iconSize: [canvas.width, canvas.height],
            iconAnchor: [canvas.width / 2, canvas.height],
            popupAnchor: [0, -canvas.height / 2]
        });
    } catch (error) {
        console.error('Error creating custom pin:', error);
        return L.icon({
            iconUrl: './images/pins/pin0.png', // Fallback for any error
            iconSize: [32, 47],
            iconAnchor: [16, 47],
            popupAnchor: [0, -47]
        });
    }
}


async function fetchBusPositions() {
    try {
        const response = await fetch('/api/vehicle-positions');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        await processVehiclePositions(data);
        //cleanupMarkers(activeVehicleLabels); // Ensure this is correctly passed
    } catch (error) {
        console.error('Error fetching vehicle positions:', error);
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
    marker.on('click', () => onBusMarkerClick(entity.routeId));

    return marker; // Return the Leaflet marker instance
}


function generatePopupContent(entity) {
    if (entity.routeId === "Unknown" || !entity.routeId) {
        return `Unknown Route<br>Route ID: Unknown<br>Route Short Name: ${entity.routeShortName || "N/A"}<br>Route Long Name: ${entity.routeLongName || "N/A"}`;
    } else {
        return `Bus <b>${entity.routeShortName}</b> (vehicle ${entity.vehicle.vehicle.label})<br>
                ${entity.routeLongName}<br>Route ID: ${entity.routeId}<br>Bearing: ${entity.vehicle.position.bearing || "N/A"}<br>
                Route color: ${entity.routeColor || "N/A"}<br>Text color: ${entity.routeTextColor || "N/A"}<br>
                Speed: ${Math.round(entity.vehicle.position.speed) || 0}`;
    }
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
