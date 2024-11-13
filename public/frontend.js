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

// Add this function to initialize bus-related features
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