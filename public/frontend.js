document.addEventListener('DOMContentLoaded', () => {
    // Get all buttons with the class 'tab-button'
    const buttons = document.querySelectorAll('.tab-button');
    // Add event listener to each button
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            // Get the target URL from the data-target attribute
            const target = button.getAttribute('data-target');

            // Redirect to the target URL
            window.location.href = target;
        });
    });

    // Add event listener to the locate button if it exists
    const locateButton = document.getElementById('locate-button');
    if (locateButton) {
        locateButton.addEventListener('click', () => {
            showUserPosition();
        });
    }

    // Add event listener to the share button
    const shareButton = document.getElementById('share-button');
    const modal = document.getElementById('qrModal');
    const closeButton = document.getElementById('close-modal');
    const qrCodeImage = document.getElementById('qrCodeImage');

    if (shareButton && modal && closeButton && qrCodeImage) {
        shareButton.addEventListener('click', () => {
            console.log('Share button clicked'); // Debugging line
            // Set the QR code image source
            qrCodeImage.src = '/images/qr_code.png';
            // Display the modal
            modal.style.display = 'block';
            document.body.style.overflow = 'hidden'; // Prevent scrolling
            console.log('Modal should be visible now'); // Debugging line
        });

        // Close the modal when the close button is clicked
        closeButton.addEventListener('click', () => {
            console.log('Close button clicked'); // Debugging line
            modal.style.display = 'none';
            document.body.style.overflow = ''; // Re-enable scrolling
            console.log('Modal should be hidden now'); // Debugging line
        });

        // Close the modal when clicking outside of the modal content
        window.addEventListener('click', (event) => {
            if (event.target === modal) {
                console.log('Clicked outside modal'); // Debugging line
                modal.style.display = 'none';
                document.body.style.overflow = ''; // Re-enable scrolling
                console.log('Modal should be hidden now (clicked outside)'); // Debugging line
            }
        });
    } else {
        console.warn("Some elements for the share modal are missing", {
            shareButton: !!shareButton,
            modal: !!modal,
            closeButton: !!closeButton,
            qrCodeImage: !!qrCodeImage
        });
    }

    const showStopsButton = document.getElementById('show-stops-button');
    if (showStopsButton) {
        showStopsButton.addEventListener('click', () => {
            console.log('Show stops button clicked'); // Debugging line
            fetchStops(true);
        });
    } else {
        console.warn("Show stops button not found");
    }

    setupNativeShare();
    initMap(); // Make sure initMap is called here if it's not already
});

document.addEventListener('DOMContentLoaded', function () {
    initMap();
    fetchGTFSStatus();
    setInterval(fetchGTFSStatus, 5000);
});

let map; // Declare map variable at the top level for global access
let busMarkers = {}; // Array to store references to bus markers
let busStopMarkers = {}; // Object to store bus stop markers
let currentRoutePolyline = null; // This will store the current route polyline
let userPosition = null; // Store the user's position

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

        // Add zoom control with custom position if not already added
        if (!map.zoomControl) {
            L.control.zoom({
                position: 'bottomright'
            }).addTo(map);
        }
        // Add custom CSS for the locate button to match the zoom buttons
        const locateButtonStyle = document.createElement('style');
        locateButtonStyle.innerHTML = `
            .leaflet-control-locate {
                background-color: #fff; /* Same background color as zoom buttons */
                width: 36px; /* Set width to 36px */
                height: 36px; /* Set height to 36px */
                display: flex;
                justify-content: center;
                align-items: center;
                cursor: pointer;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3); /* Add shadow for better visibility */
                border-radius: 4px; /* Add border radius for rounded corners */
            }
            .leaflet-control-locate svg {
                width: 36px; /* Adjust SVG size */
                height: 36px; /* Adjust SVG size */
            }
        `;
        document.head.appendChild(locateButtonStyle);

        // Customize the zoom control buttons to be 36x36
        const zoomControlStyle = document.createElement('style');
        zoomControlStyle.innerHTML = `
            .leaflet-control-zoom-in,
            .leaflet-control-zoom-out {
                width: 40px;
                height: 40px;
                display: flex;
                justify-content: center;
                align-items: center;
                cursor: pointer;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3); /* Add shadow for better visibility */
                border-radius: 4px; /* Add border radius for rounded corners */
            }
            .leaflet-control-zoom-in svg,
            .leaflet-control-zoom-out svg {
                width: 40px; /* Adjust SVG size */
                height: 40px; /* Adjust SVG size */
            }
        `;
        document.head.appendChild(zoomControlStyle);

        // Add locate me button
        L.Control.Locate = L.Control.extend({
            onAdd: function(map) {
                var div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-locate');
                div.title = 'Locate Me';
                div.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <g fill="#007bff">
                        <path d="M12,2 C12.3796958,2 12.693491,2.28215388 12.7431534,2.64822944 L12.75,2.75 L12.7490685,4.53770881 L12.7490685,4.53770881 C16.292814,4.88757432 19.1124257,7.70718602 19.4632195,11.2525316 L19.5,11.25 L21.25,11.25 C21.6642136,11.25 22,11.5857864 22,12 C22,12.3796958 21.7178461,12.693491 21.3517706,12.7431534 L21.25,12.75 L19.4616558,12.7490368 L19.4616558,12.7490368 C19.1124257,16.292814 16.292814,19.1124257 12.7474684,19.4632195 L12.75,19.5 L12.75,21.25 C12.75,21.6642136 12.4142136,22 12,22 C11.6203042,22 11.306509,21.7178461 11.2568466,21.3517706 L11.25,21.25 L11.2509632,19.4616558 L11.2509632,19.4616558 C7.70718602,19.1124257 4.88757432,16.292814 4.53678051,12.7474684 L4.5,12.75 L2.75,12.75 C2.33578644,12.75 2,12.4142136 2,12 C2,11.6203042 2.28215388,11.306509 2.64822944,11.2568466 L2.75,11.25 L4.53770881,11.2509315 L4.53770881,11.2509315 C4.88757432,7.70718602 7.70718602,4.88757432 11.2525316,4.53678051 L11.25,4.5 L11.25,2.75 C11.25,2.33578644 11.5857864,2 12,2 Z M12,6 C8.6862915,6 6,8.6862915 6,12 C6,15.3137085 8.6862915,18 12,18 C15.3137085,18 18,15.3137085 18,12 C18,8.6862915 15.3137085,6 12,6 Z M12,8 C14.209139,8 16,9.790861 16,12 C16,14.209139 14.209139,16 12,16 C9.790861,16 8,14.209139 8,12 C8,9.790861 9.790861,8 12,8 Z"/>
                    </g>
                </svg>`;
                div.style.border = 'none'; // Remove border
                div.onclick = function() {
                    showUserPosition();
                };
                return div;
            }
        });

        L.control.locate = function(opts) {
            return new L.Control.Locate(opts);
        }

        L.control.locate({
            position: 'bottomright'
        }).addTo(map);
    }
    await showUserPosition(); // Ensure user position is obtained before fetching bus stops
    fetchBusPositions();
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
    const statusElement = document.getElementById('gtfs-status');
    if (!statusElement) {
        console.error('Element with ID "gtfs-status" not found');
        return;
    }

    let statusMessage;
    if (status.gtfsStatus.toLowerCase() === 'available') {
        const lastUpdateTime = new Date(status.lastUpdateTime);
        const currentTime = new Date();
        const secondsAgo = Math.floor((currentTime - lastUpdateTime) / 1000);
        
        let timeString;
        if (secondsAgo < 3) {
            timeString = "now";
        } else if (secondsAgo < 10) {
            timeString = "just now";
        } else {
            timeString = `${secondsAgo} seconds ago`;
        }
        
        statusMessage = `Motion Status: OK ✅ Updated ${timeString}`;
        statusElement.style.color = 'green';
    } else {
        statusMessage = 'Motion Status: ❌ Data from Motion is not available.';
        statusElement.style.color = 'red';
    }

    statusElement.textContent = statusMessage;
}

function fetchStops(useMapBounds = false) {
    if (!map) {
        console.warn('Map is not initialized yet.');
        return;
    }

    fetch('/api/stops')
        .then(response => response.json())
        .then(stops => {
            console.log('Fetched stops:', stops.length);
            
            // Remove existing bus stop markers
            Object.values(busStopMarkers).forEach(marker => map.removeLayer(marker));
            busStopMarkers = {};

            let filteredStops;
            if (useMapBounds) {
                const bounds = map.getBounds();
                const ne = bounds.getNorthEast();
                const sw = bounds.getSouthWest();
                filteredStops = stops.filter(stop => {
                    if (!stop.lat || !stop.lon) {
                        console.warn('Stop missing lat or lon:', stop);
                        return false;
                    }
                    return stop.lat >= sw.lat && stop.lat <= ne.lat &&
                           stop.lon >= sw.lng && stop.lon <= ne.lng;
                });
            } else {
                filteredStops = stops.filter(stop => {
                    if (!stop.lat || !stop.lon) {
                        console.warn('Stop missing lat or lon:', stop);
                        return false;
                    }
                    if (!userPosition) {
                        console.warn('User position not available');
                        return false;
                    }
                    const distance = getDistanceFromLatLonInKm(userPosition.lat, userPosition.lon, stop.lat, stop.lon);
                    return distance <= 2; // Filter stops within 2 km
                });
            }

            console.log('Filtered stops:', filteredStops.length);

            filteredStops.forEach(stop => {
                const marker = L.marker([stop.lat, stop.lon], {icon: busStopIcon}).addTo(map)
                    .bindPopup(`<div style="width: 300px;"><b>${stop.name}</b><br>ID: ${stop.stop_id}<br><div id="stop-${stop.stop_id}-buses">Loading...</div></div>`);
                
                marker.on('click', () => {
                    fetchStopTimes(stop.stop_id);
                });

                busStopMarkers[stop.stop_id] = marker;
            });
        })
        .catch(error => console.error('Error fetching stops:', error));
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in km
    return distance;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

const routeShortName = "?";
const routeColor = "000000";
const routeTextColor = "FFFFFF";

async function fetchOrCreatePin(entity, routeShortName, routeColor, routeTextColor) {
    const displayText = routeShortName || "?";
    routeColor = routeColor && routeColor.startsWith('#') ? routeColor : `#${routeColor || '000000'}`;
    routeTextColor = routeTextColor && routeTextColor.startsWith('#') ? routeTextColor : `#${routeTextColor || 'FFFFFF'}`;

    const svgContent = `
    <svg width="35" height="47" viewBox="0 0 35 47" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.5 0C7.83502 0 0 7.83502 0 17.5C0 30.625 17.5 47 17.5 47C17.5 47 35 30.625 35 17.5C35 7.83502 27.165 0 17.5 0Z" fill="${routeColor}"/>
    <text x="17.5" y="22" text-anchor="middle" fill="${routeTextColor}" font-size="14px" font-weight="bold">${displayText}</text>
    </svg>`;

    const encodedSvg = encodeURIComponent(svgContent);
    const iconUrl = `data:image/svg+xml;charset=UTF-8,${encodedSvg}`;

    return L.icon({
        iconUrl: iconUrl,
        iconSize: [35, 47],
        iconAnchor: [17.5, 47], // Point of the pin
        popupAnchor: [0, -47]
    });
}

// Assuming busStopMarkers is a global object storing markers keyed by stop_id


function clearRouteShapes() {
    if (currentRoutePolyline) {
        currentRoutePolyline.remove();
        currentRoutePolyline = null;
    }
}


function displayRouteShape(routeId) {
    fetch(`/api/route-shapes/${routeId}`)
        .then(response => response.json())
        .then(shapePoints => {
            const latLngs = shapePoints.map(point => [point.shape_pt_lat, point.shape_pt_lon]);
            const polyline = L.polyline(latLngs, {color: 'blue', weight: 3}).addTo(map);
            currentRoutePolyline = polyline; // Store reference to remove later
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

async function processVehiclePositions(data) {
    const activeVehicleLabels = new Set();

    for (const entity of data) {
        const {latitude, longitude, vehicleLabel} = await extractMarkerData(entity);
        activeVehicleLabels.add(vehicleLabel);

        if (busMarkers[vehicleLabel]) {
            moveMarkerSmoothly(busMarkers[vehicleLabel], [latitude, longitude]);
        } else {
            busMarkers[vehicleLabel] = await createNewMarker(latitude, longitude, null, entity);
        }
    }

    cleanupMarkers(activeVehicleLabels);
}

async function fetchBusPositions() {
    try {
        const response = await fetch('/api/vehicle-positions');
        if (!response.ok) {
            if (response.status === 503) {
                console.warn('The GTFS server is not available. Please try again later.');
                // Update the UI to show a generic error message
                document.getElementById("error-message").textContent = "🛑 The GTFS server is not available. Please try again later.";
            } else {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return;
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
    const latitude = entity.vehicle.position.latitude;
    const longitude = entity.vehicle.position.longitude;
    const vehicleLabel = entity.vehicle.vehicle.label || "N/A";
    const bearing = entity.vehicle.position.bearing || 0;

    return {latitude, longitude, vehicleLabel, bearing};
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
    const customIcon = await fetchOrCreatePin(entity, entity.routeShortName, entity.routeColor, entity.routeTextColor);

    // Create a custom DivIcon that combines the bus icon and the pin with the number
    const busIconUrl = './images/pins/bus.svg';
    const bearing = entity.vehicle.position.bearing || 0;
    const combinedIconHtml = `
        <div style="position: relative; display: inline-block; width: 52.5px; height: 47px;"> <!-- Increased width by 150% -->
            <img src="${busIconUrl}" style="position: absolute; bottom: 0; left: 50%; width: 30px; height: 30px; transform: translate(-50%, 50%) rotate(${bearing}deg); transform-origin: center;"> <!-- Increased width by 150% -->
            <img src="${customIcon.options.iconUrl}" style="position: absolute; bottom: 0; left: 50%; transform: translate(-50%, 0);">
        </div>
    `;

    const combinedIcon = L.divIcon({
        html: combinedIconHtml,
        iconSize: [52.5, 47], // Adjusted icon size to match the increased width
        iconAnchor: [26.25, 47], // Adjusted anchor point to match the increased width
        popupAnchor: [0, -47]
    });

    if (busMarkers[entity.vehicle.vehicle.label]) {
        busMarkers[entity.vehicle.vehicle.label].setLatLng([latitude, longitude]).setIcon(combinedIcon);
    } else {
        busMarkers[entity.vehicle.vehicle.label] = L.marker([latitude, longitude], {icon: combinedIcon}).addTo(map);
        busMarkers[entity.vehicle.vehicle.label].bindPopup(generatePopupContent(entity));
    }

    busMarkers[entity.vehicle.vehicle.label].on('click', () => onBusMarkerClick(entity.routeId));

    return busMarkers[entity.vehicle.vehicle.label];
}


function generatePopupContent(entity) {
    if (entity.routeId === "?" || !entity.routeId) {
        return `Unknown Route<br>Route ID: Unknown<br>Route Short Name: ${entity.routeShortName || "N/A"}<br>Route Long Name: ${entity.routeLongName || "N/A"}`;
    } else {
        return `Bus <b>${entity.routeShortName}</b> (vehicle ${entity.vehicle.vehicle.label})<br>
                ${entity.routeLongName}<br>Route ID: ${entity.routeId}<br>Bearing: ${entity.vehicle.position.bearing || "0"}<br>
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


async function showUserPosition() {
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(async function (position) {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            userPosition = { lat, lon }; // Store the user's position

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

            // Remove existing user location marker if it exists
            if (window.userLocationMarker) {
                map.removeLayer(window.userLocationMarker);
            }

            // Create a marker with the custom icon and add it to the map
            window.userLocationMarker = L.marker([lat, lon], {icon: customIcon}).addTo(map);

            // Clear the current route polyline
            clearRouteShapes();

            // Center the map on the user's location and adjust zoom level to 16
            map.setView([lat, lon], 16);

            // Call fetchStops to display bus stops within 2 km
            fetchStops();
        }, function (error) {
            console.error("Geolocation error:", error);
            // Optionally, show an error message to the user
        }, {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        });
    } else {
        console.error("Geolocation is not supported by this browser.");
        // Optionally, show an error message to the user
    }
}

function displayStopTimes(stopId, stopTimes) {
    const stopTimesContainer = document.getElementById(`stop-${stopId}-buses`);
    if (!stopTimesContainer) {
        console.error(`Element with ID "stop-${stopId}-buses" not found`);
        return;
    }

    if (stopTimes.length === 0) {
        stopTimesContainer.innerHTML = 'No upcoming buses in the next 6 hours.';
        return;
    }

    const formatTimeLeft = (minutes) => {
        if (minutes < 60) {
            return `${minutes}m`;
        } else {
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            return `${hours}h${remainingMinutes > 0 ? remainingMinutes + 'm' : ''}`;
        }
    };

    const tableHeader = `
        <table style="width: 100%; table-layout: fixed;">
            <colgroup>
                <col style="width: 70px;">
                <col style="width: 50px;">
                <col style="width: 180px; min-width: 200px; max-width: calc(100% - 100px);">
            </colgroup>
            <tr>
                <th style="font-size: larger; padding: 5px;">⏳</th>
                <th style="font-size: larger; padding: 5px;">Route</th>
                <th style="font-size: larger; padding: 5px;">Direction</th>
            </tr>
    `;
    const tableRows = stopTimes.map(stopTime => `
        <tr style="color: #${stopTime.route_text_color}; background-color: #${stopTime.route_color};">
            <td style="font-size: larger; padding: 5px;">${formatTimeLeft(stopTime.time_left)}</td>    
            <td style="font-size: larger; padding: 5px;">${stopTime.route_short_name}</td>
            <td style="padding: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${stopTime.trip_headsign}</td>
        </tr>
        <tr><td colspan="3"><hr></td></tr>
    `).join('');
    const tableFooter = '</table>';

    stopTimesContainer.innerHTML = tableHeader + tableRows + tableFooter;
}

async function fetchStopTimes(stopId) {
    try {
        const response = await fetch(`/api/stop-times/${stopId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const stopTimes = await response.json();
        displayStopTimes(stopId, stopTimes);
    } catch (error) {
        console.error('Error fetching stop times:', error);
    }
}

// Add this function to your existing code
function setupNativeShare() {
    const nativeShareButton = document.getElementById('native-share-button');
    
    if (!nativeShareButton) {
        console.warn('Native share button not found in the DOM');
        return;
    }

    if (navigator.share) {
        nativeShareButton.style.display = 'inline-block';
        nativeShareButton.addEventListener('click', async () => {
            try {
                await navigator.share({
                    title: 'Cyprus Buses on Map',
                    text: 'Check out this cool bus tracking app for Cyprus!',
                    url: window.location.href
                });
                console.log('Content shared successfully');
                // Close the modal after successful share
                document.getElementById('qrModal').style.display = 'none';
            } catch (err) {
                if (err.name === 'AbortError') {
                    console.log('Share canceled by the user');
                } else {
                    console.error('Error sharing:', err);
                }
            }
        });
    } else {
        // If Web Share API is not supported, hide the button
        nativeShareButton.style.display = 'none';
    }
}