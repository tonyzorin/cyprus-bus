let map;
let userMarker;
let isFetchingPaused = false;
let fetchPositionsInterval;
let busMarkers = {};
let busStopMarkers = {};
let currentRoutePolyline = null;
let userPosition = null;

document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing map...');
    
    // Initialize map
    map = L.map('map', {
        center: [34.679309, 33.037098],
        zoom: 9,
        attributionControl: false,
        zoomControl: false
    });

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Add zoom control
    L.control.zoom({
        position: 'bottomright'
    }).addTo(map);

    // Add locate control
    L.Control.Locate = L.Control.extend({
        onAdd: function(map) {
            var div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-locate');
            div.innerHTML = `
                <a class="leaflet-control-locate-button" href="#" title="Show my location" role="button" aria-label="Show my location" style="width: 40px; height: 40px; line-height: 40px; display: flex; align-items: center; justify-content: center;">
                    <img src="images/location.png" alt="My Location" style="width: 24px; height: 24px;">
                </a>
            `;
            div.querySelector('a').addEventListener('click', function(e) {
                e.preventDefault();
                showUserPosition();
            });
            return div;
        }
    });

    new L.Control.Locate({ position: 'bottomright' }).addTo(map);

    // Initialize bus features
    initializeBusFeatures();

    // Initialize sharing
    setupNativeShare();

    // Add event listeners for buttons
    const buttons = document.querySelectorAll('.tab-button');
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const target = button.getAttribute('data-target');
            window.location.href = target;
        });
    });

    const locateButton = document.getElementById('locate-button');
    if (locateButton) {
        locateButton.addEventListener('click', () => {
            showUserPosition();
        });
    }
});

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

async function initializeBusFeatures() {
    try {
        // Start GTFS status checks
        await fetchGTFSStatus();
        setInterval(fetchGTFSStatus, 10000);

        // Start bus position updates
        await fetchBusPositions();
        fetchPositionsInterval = setInterval(fetchBusPositions, 3000);

        // Add event listener for the show stops button
        const showStopsButton = document.getElementById('show-stops-button');
        if (showStopsButton) {
            showStopsButton.addEventListener('click', () => {
                console.log('Show stops button clicked');
                fetchStops(true);
            });
        }
    } catch (error) {
        console.error('Error initializing bus features:', error);
    }
}

async function fetchGTFSStatus() {
    try {
        const response = await fetch('/api/gtfs-status');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const status = await response.json();
        updateGTFSStatusUI(status);
        
        if (status.gtfsStatus.toLowerCase() === 'available') {
            if (isFetchingPaused) {
                resumeFetchingPositions();
            }
        } else {
            pauseFetchingPositions();
        }
    } catch (error) {
        console.error('Error fetching GTFS status:', error);
        updateGTFSStatusUI({gtfsStatus: 'unavailable', lastUpdateTime: null});
        pauseFetchingPositions();
    }
}

function updateGTFSStatusUI(status) {
    const statusElement = document.getElementById('gtfs-status');
    if (!statusElement) return;

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
        statusMessage = '❌ Motion feed is not available.';
        statusElement.style.color = 'red';
    }

    statusElement.textContent = statusMessage;
}

function fetchStops(useMapBounds = false) {
    if (!map) {
        console.warn('Map is not initialized yet.');
        return;
    }

    console.log('Fetching stops...');
    fetch('/api/stops')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(stops => {
            console.log(`Received ${stops.length} stops`);
            Object.values(busStopMarkers).forEach(marker => map.removeLayer(marker));
            busStopMarkers = {};

            let filteredStops;
            if (useMapBounds) {
                const bounds = map.getBounds();
                filteredStops = stops.filter(stop => {
                    const lat = parseFloat(stop.lat);
                    const lon = parseFloat(stop.lon);
                    return lat >= bounds.getSouth() && 
                           lat <= bounds.getNorth() &&
                           lon >= bounds.getWest() && 
                           lon <= bounds.getEast();
                });
            } else {
                filteredStops = stops.filter(stop => {
                    if (!userPosition) return false;
                    const distance = getDistanceFromLatLonInKm(
                        userPosition.lat, userPosition.lon, 
                        parseFloat(stop.lat), parseFloat(stop.lon)
                    );
                    return distance <= 2;
                });
            }

            console.log(`Filtered to ${filteredStops.length} stops`);
            filteredStops.forEach(stop => {
                const marker = L.marker([stop.lat, stop.lon], {
                    icon: L.icon({
                        iconUrl: './images/bus-stop.png',
                        iconSize: [14, 14],
                        iconAnchor: [7, 7],
                        popupAnchor: [0, -7]
                    })
                }).addTo(map);

                marker.bindPopup(`<div style="min-width: 300px;"><b>${stop.name}</b><br>Stop ID: ${stop.stop_id}<br><div id="stop-${stop.stop_id}-buses">Loading...</div></div>`);
                marker.on('click', () => fetchStopInfo(stop.stop_id));
                busStopMarkers[stop.stop_id] = marker;
            });
        })
        .catch(error => console.error('Error fetching stops:', error));
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function deg2rad(deg) {
    return deg * (Math.PI/180);
}

async function fetchStopInfo(stopId) {
    try {
        const response = await fetch(`/api/stop/${stopId}`);
        const data = await response.json();
        displayStopInfo(stopId, data);
    } catch (error) {
        console.error('Error fetching stop info:', error);
    }
}

// Add this function to display stop information
function displayStopInfo(stopId, data) {
    const stopInfoContainer = document.getElementById(`stop-${stopId}-buses`);
    if (!stopInfoContainer) {
        console.error(`Element with ID "stop-${stopId}-buses" not found`);
        return;
    }

    const { stop_info, routes, timetable } = data;

    // Create routes summary section
    let routesSummary = '';
    if (routes && routes.length > 0) {
        routesSummary = `
            <div style="margin-bottom: 10px; padding: 5px 0;">
                <strong>Routes stopping here:</strong>
                <div style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px;">
                    ${routes.map(route => `
                        <span 
                            class="route-badge"
                            data-route-id="${route.route_id}"
                            style="
                                background-color: #${route.route_color || '6C757D'}; 
                                color: #${route.route_text_color || 'FFFFFF'}; 
                                padding: 2px 8px; 
                                border-radius: 12px; 
                                font-weight: bold;
                                font-size: 12px;
                                cursor: pointer;
                                title="${route.route_long_name}"
                            ">
                            ${route.route_short_name}
                        </span>
                    `).join('')}
                </div>
            </div>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 10px 0;">
        `;
    }

    // Add timetable section
    let content = routesSummary;
    if (!timetable || timetable.length === 0) {
        content += '<div>No upcoming buses in the next 90 minutes.</div>';
    } else {
        content += `
            <table style="width: 100%; table-layout: fixed; font-size: 12px;">
                <colgroup>
                    <col style="width: 15%;">
                    <col style="width: 10%;">
                    <col style="width: 50%;">
                    <col style="width: 25%;">
                </colgroup>
                <tr>
                    <th style="text-align: left; padding: 5px;">⏳</th>
                    <th style="text-align: left; padding: 5px;">🚌</th>
                    <th style="text-align: left; padding: 5px;">📍</th>
                    <th style="text-align: left; padding: 5px;">🚦</th>
                </tr>
                ${timetable.map(info => `
                    <tr style="color: #${info.route_text_color}; background-color: #${info.route_color};">
                        <td style="padding: 3px; vertical-align: middle;">${info.time_left}m</td>    
                        <td style="padding: 3px; vertical-align: middle;">${info.route_short_name}</td>
                        <td style="padding: 3px; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${info.trip_headsign}</td>
                        <td style="padding: 3px; vertical-align: middle;">${info.is_live ? '● Live' : 'Scheduled'}</td>
                    </tr>
                `).join('')}
            </table>
        `;
    }

    stopInfoContainer.innerHTML = content;

    // Add click handlers for route badges
    const routeBadges = stopInfoContainer.querySelectorAll('.route-badge');
    routeBadges.forEach(badge => {
        badge.addEventListener('click', async (e) => {
            e.stopPropagation();
            const routeId = badge.dataset.routeId;
            if (!routeId) {
                console.error('No route ID found for this badge');
                return;
            }
            
            // Clear existing route display
            if (currentRoutePolyline) {
                map.removeLayer(currentRoutePolyline);
                currentRoutePolyline = null;
            }
            
            // Display the new route
            displayRouteShape(routeId);
            
            // Close the popup
            map.closePopup();
        });
    });
}

// Add this function to display route shapes
async function displayRouteShape(routeId) {
    try {
        console.log('Fetching shape for route:', routeId);
        const response = await fetch(`/api/route-shapes/${routeId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const shapePoints = await response.json();
        console.log(`Received ${shapePoints.length} shape points`);

        if (shapePoints.length === 0) {
            console.warn('No shape points found for route:', routeId);
            return;
        }

        // Clear existing route if any
        if (currentRoutePolyline) {
            map.removeLayer(currentRoutePolyline);
        }

        // Create the polyline
        const latLngs = shapePoints.map(point => [point.shape_pt_lat, point.shape_pt_lon]);
        const routeColor = `#${shapePoints[0].route_color || '0000FF'}`;

        currentRoutePolyline = L.polyline(latLngs, {
            color: routeColor,
            weight: 4,
            opacity: 0.8
        }).addTo(map);

        // Fetch and display stops for this route
        fetchRouteStops(routeId);

    } catch (error) {
        console.error('Error displaying route shape:', error);
    }
}

// Add this function to fetch and display route stops
async function fetchRouteStops(routeId) {
    try {
        const response = await fetch(`/api/route-stops/${routeId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const stops = await response.json();
        console.log(`Received ${stops.length} stops for route ${routeId}`);

        // Clear existing bus stop markers
        Object.values(busStopMarkers).forEach(marker => map.removeLayer(marker));
        busStopMarkers = {};

        // Add new markers for each stop
        stops.forEach(stop => {
            const marker = L.marker([stop.stop_lat, stop.stop_lon], {
                icon: L.icon({
                    iconUrl: './images/bus-stop.png',
                    iconSize: [14, 14],
                    iconAnchor: [7, 7],
                    popupAnchor: [0, -7]
                })
            }).addTo(map);

            marker.bindPopup(`<div style="min-width: 300px;"><b>${stop.stop_name}</b><br>Stop ID: ${stop.stop_id}<br><div id="stop-${stop.stop_id}-buses">Loading...</div></div>`);
            marker.on('click', () => fetchStopInfo(stop.stop_id));
            busStopMarkers[stop.stop_id] = marker;
        });

    } catch (error) {
        console.error('Error fetching route stops:', error);
    }
}

function showUserPosition() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(function(position) {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            // Store user position globally
            userPosition = {
                lat: lat,
                lon: lon
            };
            
            // If map and userMarker are defined globally
            if (typeof map !== 'undefined') {
                // Remove existing marker if it exists
                if (userMarker) {
                    map.removeLayer(userMarker);
                }
                
                // Create a new marker for user position
                userMarker = L.marker([lat, lon], {
                    icon: L.icon({
                        iconUrl: 'images/current-location.png',
                        iconSize: [32, 32],
                        iconAnchor: [16, 16]
                    })
                }).addTo(map);
                
                // Center map on user location
                map.setView([lat, lon], 15);

                // Load bus stops within 2km radius
                fetchStops(false); // false means use radius-based fetching
            }
        }, function(error) {
            console.error("Error getting location:", error);
            alert("Unable to get your location. Please check your location settings.");
        });
    } else {
        alert("Geolocation is not supported by your browser");
    }
}

// Make sure this function is available globally
window.showUserPosition = showUserPosition;

function pauseFetchingPositions() {
    if (!isFetchingPaused) {
        isFetchingPaused = true;
        if (fetchPositionsInterval) {
            clearInterval(fetchPositionsInterval);
            fetchPositionsInterval = null;
        }
        // Clear existing bus markers
        Object.values(busMarkers).forEach(marker => {
            if (map && marker) {
                map.removeLayer(marker);
            }
        });
        busMarkers = {};
    }
}

function resumeFetchingPositions() {
    if (isFetchingPaused) {
        isFetchingPaused = false;
        fetchBusPositions();
        fetchPositionsInterval = setInterval(fetchBusPositions, 3000);
    }
}

// Add this function for fetching bus positions
async function fetchBusPositions() {
    if (isFetchingPaused) return;

    try {
        const response = await fetch('/api/vehicle-positions');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const positions = await response.json();
        
        // Transform positions with correct data mapping
        const transformedPositions = positions.map(pos => ({
            vehicle_id: pos.vehicle?.vehicle?.id,
            latitude: pos.vehicle?.position?.latitude,
            longitude: pos.vehicle?.position?.longitude,
            bearing: pos.bearing || 0,
            speed: pos.speed || 0,
            route_short_name: pos.routeShortName,
            trip_headsign: pos.routeLongName,
            license_plate: pos.vehicle?.vehicle?.licensePlate,
            timestamp: pos.vehicle?.timestamp?.low || pos.vehicle?.timestamp,
            route_color: pos.routeColor,
            route_text_color: pos.routeTextColor,
            routeId: pos.routeId
        }));

        updateBusMarkers(transformedPositions);
    } catch (error) {
        console.error('Error fetching bus positions:', error);
    }
}

// Add this function to update bus markers
function updateBusMarkers(positions) {
    // Remove old markers that are no longer present in the new data
    Object.keys(busMarkers).forEach(vehicleId => {
        if (!positions.find(pos => pos.vehicle_id === vehicleId)) {
            if (map && busMarkers[vehicleId]) {
                map.removeLayer(busMarkers[vehicleId]);
                delete busMarkers[vehicleId];
            }
        }
    });

    // Update or add new markers
    positions.forEach(pos => {
        const marker = busMarkers[pos.vehicle_id];
        const newLatLng = [pos.latitude, pos.longitude];

        if (marker) {
            // Update existing marker
            marker.setLatLng(newLatLng);
            marker.setRotationAngle(pos.bearing || 0);
            // Update popup content
            marker.getPopup().setContent(createBusPopupContent(pos));
        } else {
            // Create new marker
            const newMarker = L.marker(newLatLng, {
                icon: L.icon({
                    iconUrl: 'images/pins/bus.svg',
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                }),
                rotationAngle: pos.bearing || 0
            }).addTo(map);

            newMarker.bindPopup(createBusPopupContent(pos));
            newMarker.on('click', () => {
                if (pos.routeId) {
                    onBusMarkerClick(pos.routeId);
                }
            });
            busMarkers[pos.vehicle_id] = newMarker;
        }
    });
}

// Update the popup content function
function createBusPopupContent(busData) {
    const timestamp = typeof busData.timestamp === 'number' ? busData.timestamp : Date.now() / 1000;
    return `
        <div style="min-width: 200px;">
            <strong>Route ${busData.route_short_name || 'Unknown'}</strong><br>
            ${busData.trip_headsign ? `To: ${busData.trip_headsign}<br>` : ''}
            ${busData.license_plate ? `Vehicle: ${busData.license_plate}<br>` : ''}
            Speed: ${Math.round(busData.speed || 0)} km/h<br>
        </div>
    `;
}

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
        iconAnchor: [17.5, 47],
        popupAnchor: [0, -47]
    });
}

async function createNewMarker(latitude, longitude, markerIcon, entity) {
    const customIcon = await fetchOrCreatePin(entity, entity.route_short_name, entity.route_color, entity.route_text_color);

    // Create a custom DivIcon that combines the bus icon and the pin with the number
    const busIconUrl = 'images/pins/bus.svg';
    const bearing = entity.bearing || 0;
    const combinedIconHtml = `
        <div style="position: relative; display: inline-block; width: 52.5px; height: 47px;">
            <img src="${busIconUrl}" style="position: absolute; bottom: 0; left: 50%; width: 30px; height: 30px; transform: translate(-50%, 50%) rotate(${bearing}deg); transform-origin: center;">
            <img src="${customIcon.options.iconUrl}" style="position: absolute; bottom: 0; left: 50%; transform: translate(-50%, 0);">
        </div>
    `;

    const combinedIcon = L.divIcon({
        html: combinedIconHtml,
        iconSize: [52.5, 47],
        iconAnchor: [26.25, 47],
        popupAnchor: [0, -47],
        className: 'custom-bus-marker' // Add this to avoid default leaflet styles
    });

    if (busMarkers[entity.vehicle?.vehicle?.id]) {
        busMarkers[entity.vehicle?.vehicle?.id].setLatLng([latitude, longitude]).setIcon(combinedIcon);
        busMarkers[entity.vehicle?.vehicle?.id].getPopup().setContent(createBusPopupContent(entity));
    } else {
        const marker = L.marker([latitude, longitude], {icon: combinedIcon}).addTo(map);
        marker.bindPopup(createBusPopupContent(entity));
        marker.on('click', () => {
            if (entity.routeId) {
                onBusMarkerClick(entity.routeId);
            }
        });
        busMarkers[entity.vehicle?.vehicle?.id] = marker;
    }

    return busMarkers[entity.vehicle?.vehicle?.id];
}