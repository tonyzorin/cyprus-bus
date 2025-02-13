let map;
let userMarker;
let isFetchingPaused = false;
let fetchPositionsInterval;
let busMarkers = {};
let busStopMarkers = {};
let currentRoutePolyline = null;
let userPosition = null;
let isCompassAvailable = false;
let vehicleDetails = {};
let lastKnownDirection = 0;
let compassInterval = null;

document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOM loaded, initializing map...');
    
    // Initialize map
    map = L.map('map', {
        center: [34.679309, 33.037098],
        zoom: 9,
        attributionControl: false,
        zoomControl: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Add zoom control
    L.control.zoom({
        position: 'bottomright'
    }).addTo(map);

    // Request compass permission immediately for iOS
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission === 'granted') {
                isCompassAvailable = true;
                window.addEventListener('deviceorientationabsolute', handleOrientation, true);
                window.addEventListener('deviceorientation', handleOrientation, true);
            }
        } catch (error) {
            console.error('Error requesting compass permission:', error);
        }
    }
    
    // Request location permission
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                showUserPosition();
            },
            function(error) {
                console.error('Error getting initial position:', error);
            },
            { enableHighAccuracy: true }
        );
    }

    // Add locate control
    L.Control.Locate = L.Control.extend({
        onAdd: function(map) {
            var div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-locate');
            div.innerHTML = `
                <a class="leaflet-control-locate-button" href="#" title="Show my location" role="button" aria-label="Show my location" style="width: 40px; height: 40px; line-height: 40px; display: flex; align-items: center; justify-content: center;">
                    <img src="images/location.png" alt="My Location" style="width: 24px; height: 24px;">
                </a>
            `;
            
            div.querySelector('a').addEventListener('click', async (e) => {
                e.preventDefault();
                
                // Handle iOS compass permission
                if (typeof DeviceOrientationEvent.requestPermission === 'function' && isCompassAvailable) {
                    try {
                        const permission = await DeviceOrientationEvent.requestPermission();
                        if (permission === 'granted') {
                            // Add orientation listeners after permission is granted
                            window.addEventListener('deviceorientationabsolute', handleOrientation, true);
                            window.addEventListener('deviceorientation', handleOrientation, true);
                        }
                    } catch (error) {
                        console.error('Error requesting compass permission:', error);
                    }
                }
                
                // Always try to show position
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

    // Setup all buttons with consistent style
    setupButtons();

    // Request user's position immediately
    showUserPosition();

    // Check compass for non-iOS devices
    // Request compass permission immediately for iOS
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission === 'granted') {
                isCompassAvailable = true;
                window.addEventListener('deviceorientationabsolute', handleOrientation, true);
                window.addEventListener('deviceorientation', handleOrientation, true);
            }
        } catch (error) {
            console.error('Error requesting compass permission:', error);
        }
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
        setInterval(fetchGTFSStatus, 5000);

        // Load full vehicle details
        await loadVehicleDetails();
        setInterval(loadVehicleDetails, 5 * 60 * 1000); // Refresh details every 5 minutes

        // Start bus position updates
        await fetchBusPositions();
        fetchPositionsInterval = setInterval(fetchBusPositions, 4000);

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
        if (!response.ok) throw new Error('Failed to fetch GTFS status');
        const status = await response.json();
        updateGTFSStatusUI(status);
        
        if (status.gtfsStatus === 'available') {
            if (isFetchingPaused) {
                resumeFetchingPositions();
            }
        } else {
            pauseFetchingPositions();
        }
    } catch (error) {
        console.error('Error fetching GTFS status:', error);
        updateGTFSStatusUI({ gtfsStatus: 'unavailable' });
        pauseFetchingPositions();
    }
}

function updateGTFSStatusUI(status) {
    const statusElement = document.getElementById('gtfs-status');
    if (!statusElement) return;

    if (status.gtfsStatus === 'available') {
        statusElement.textContent = 'Motion Status: OK ✅';
        statusElement.style.color = 'green';
    } else {
        statusElement.textContent = '❌ Motion feed is not available';
        statusElement.style.color = 'red';
    }
}

async function loadVehicleDetails() {
    try {
        const response = await fetch('/api/vehicle-details');
        if (!response.ok) throw new Error('Failed to fetch vehicle details');
        const details = await response.json();
        
        console.log('Loaded vehicle details:', details.length, 'vehicles');
        
        // Create a map of vehicle details by ID
        vehicleDetails = details.reduce((acc, detail) => {
            acc[detail.id] = detail;
            return acc;
        }, {});

        console.log('Vehicle details mapped:', Object.keys(vehicleDetails).length, 'entries');
    } catch (error) {
        console.error('Error loading vehicle details:', error);
    }
}

async function fetchBusPositions() {
    if (isFetchingPaused) return;

    try {
        // Add timestamp to URL to prevent caching
        const timestamp = new Date().getTime();
        const response = await fetch(`/api/vehicle-positions/minimal?_=${timestamp}`);
        if (!response.ok) throw new Error('Failed to fetch positions');
        const positions = await response.json();

        // Transform minimal positions into the format expected by updateBusMarkers
        const transformedPositions = positions.map(pos => {
            const details = vehicleDetails[pos.id] || {};
            return {
                vehicle_id: pos.id,
                latitude: pos.lat,
                longitude: pos.lon,
                bearing: pos.bearing || 0,
                route_short_name: details.routeInfo?.shortName || '?',
                trip_headsign: details.routeInfo?.longName || 'Unknown Route',
                license_plate: details.vehicleInfo?.licensePlate || '',
                route_color: details.routeInfo?.color || '000000',
                route_text_color: details.routeInfo?.textColor || 'FFFFFF',
                routeId: pos.routeId
            };
        }).filter(pos => pos.latitude && pos.longitude && pos.vehicle_id);

        updateBusMarkers(transformedPositions);
    } catch (error) {
        console.error('Error fetching bus positions:', error);
    }
}

function pauseFetchingPositions() {
    if (!isFetchingPaused) {
        isFetchingPaused = true;
        
        // Clear the interval
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
        
        // Clear any existing interval first
        if (fetchPositionsInterval) {
            clearInterval(fetchPositionsInterval);
            fetchPositionsInterval = null;
        }
        
        // Fetch immediately
        fetchBusPositions();
        
        // Set new interval
        fetchPositionsInterval = setInterval(fetchBusPositions, 4000);
    }
}

function showUserPosition() {
    if ("geolocation" in navigator) {
        navigator.permissions.query({ name: 'geolocation' }).then(function(permissionStatus) {
            if (permissionStatus.state === 'denied') {
                // Show instructions based on browser/device
                let instructions = '';
                if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
                    instructions = 'To enable location services:\n1. Go to Settings\n2. Privacy & Security\n3. Location Services\n4. Enable for your browser';
                } else if (/Android/.test(navigator.userAgent)) {
                    instructions = 'To enable location services:\n1. Go to Settings\n2. Privacy/Location\n3. Enable location access for your browser';
                } else {
                    instructions = 'Please enable location services in your browser settings and reload the page.';
                }
                alert(instructions);
                return;
            }

            navigator.geolocation.getCurrentPosition(function(position) {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                
                userPosition = { lat, lon };
                
                if (typeof map !== 'undefined') {
                    if (userMarker) {
                        map.removeLayer(userMarker);
                    }

                    // Check compass availability
                    checkCompassAvailability();
                    
                    const gazeIndicatorHtml = isCompassAvailable ? `
                        <div class="gaze-indicator" style="position: absolute; left: 0; top: 0; width: 200px; height: 200px; pointer-events: none;">
                            <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style="pointer-events: none;">
                                <defs>
                                    <radialGradient id="coneGradient" cx="50%" cy="50%" r="75%" fx="50%" fy="50%">
                                        <stop offset="0%" style="stop-color:rgba(0, 0, 255, 0.4); stop-opacity:0.95;" />
                                        <stop offset="100%" style="stop-color:rgba(0, 0, 255, 0); stop-opacity:0;" />
                                    </radialGradient>
                                </defs>
                                <path d="M 100 100 L 70 20 L 130 20 Z" fill="url(#coneGradient)" class="direction-cone"/>
                            </svg>
                        </div>
                    ` : '';
                    
                    const markerHtml = `
                        <div class="user-marker-container" style="position: relative; width: 200px; height: 200px; pointer-events: none !important;">
                            <div class="beacon" style="position: absolute; left: 107px; top: 107px; transform: translate(-50%, -50%); pointer-events: none !important;"></div>
                            ${gazeIndicatorHtml}
                            <img src="images/current-location.png" class="user-icon" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); pointer-events: none !important; width: 48px; height: 48px; z-index: 1000;" alt="Your location">
                        </div>
                    `;

                    const userIcon = L.divIcon({
                        html: markerHtml,
                        className: 'user-marker',
                        iconSize: [200, 200],
                        iconAnchor: [100, 100]
                    });

                    userMarker = L.marker([lat, lon], {
                        icon: userIcon,
                        zIndexOffset: 1000,
                        interactive: false
                    }).addTo(map);
                    
                    // Center map on user location
                    map.setView([lat, lon], 15);

                    // Load bus stops within 2km radius
                    fetchStops(false);

                    // Setup device orientation handling
                    if (window.DeviceOrientationEvent) {
                        window.addEventListener('deviceorientationabsolute', function(event) {
                            const cone = document.querySelector('.direction-cone');
                            if (cone) {
                                let direction = 0;
                                if (event.webkitCompassHeading) {
                                    // iOS devices
                                    direction = event.webkitCompassHeading; // + 135
                                } else if (event.alpha !== null) {
                                    // Android devices
                                    direction = (360 - event.alpha); // + 135
                                }
                                
                                // Adjust for screen orientation
                                if (window.orientation) {
                                    direction += window.orientation;
                                }
                                
                                // Normalize direction to stay within 0-360 range
                                direction = direction % 360; // + 135
                                
                                cone.style.transform = `rotate(${direction}deg)`;
                                cone.style.transformOrigin = 'center center';
                            }
                        }, true);
                        
                        // Fallback to regular deviceorientation event
                        window.addEventListener('deviceorientation', function(event) {
                            const cone = document.querySelector('.direction-cone');
                            if (cone && event.alpha !== null) {
                                let direction = (360 - event.alpha)
                                if (window.orientation) {
                                    direction += window.orientation;
                                }
                                // Normalize direction to stay within 0-360 range
                                direction = direction % 360;
                                cone.style.transform = `rotate(${direction}deg)`;
                                cone.style.transformOrigin = 'center center';
                            }
                        }, true);
                    }
                }
            }, function(error) {
                let errorMessage = 'Unable to get your location. ';
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage += 'Please enable location services in your settings.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage += 'Location information is unavailable.';
                        break;
                    case error.TIMEOUT:
                        errorMessage += 'Location request timed out.';
                        break;
                    default:
                        errorMessage += 'An unknown error occurred.';
                }
                console.error("Error getting location:", error);
                alert(errorMessage);
            }, {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 5000
            });
        });
    } else {
        alert("Geolocation is not supported by your browser. Please try using a modern browser with location services.");
    }
}

// Make sure this function is available globally
window.showUserPosition = showUserPosition;

// Add the improved bus marker functions
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
    // Create route number pin
    const routePin = await fetchOrCreatePin(entity, entity.route_short_name, entity.route_color, entity.route_text_color);
    
    // Use bus.svg instead of emoji
    const bearing = entity.bearing || 0;
    const combinedIconHtml = `
        <div style="position: relative; display: inline-block; width: 52.5px; height: 47px;">
            <img src="/images/pins/bus.svg" style="position: absolute; bottom: 0; left: 50%; width: 24px; height: 24px; transform: translate(-50%, 50%) rotate(${bearing}deg); transform-origin: center; z-index: 1000;">
            <img src="${routePin.options.iconUrl}" style="position: absolute; bottom: 0; left: 50%; transform: translate(-50%, 0);">
        </div>
    `;

    const combinedIcon = L.divIcon({
        html: combinedIconHtml,
        iconSize: [52.5, 47],
        iconAnchor: [26.25, 47],
        popupAnchor: [0, -47],
        className: 'custom-bus-marker'
    });

    if (busMarkers[entity.vehicle_id]) {
        busMarkers[entity.vehicle_id].setLatLng([latitude, longitude]).setIcon(combinedIcon);
        busMarkers[entity.vehicle_id].getPopup().setContent(createBusPopupContent(entity));
    } else {
        const marker = L.marker([latitude, longitude], {icon: combinedIcon}).addTo(map);
        marker.bindPopup(createBusPopupContent(entity));
        marker.on('click', () => {
            if (entity.routeId) {
                onBusMarkerClick(entity.routeId);
            }
        });
        busMarkers[entity.vehicle_id] = marker;
    }

    return busMarkers[entity.vehicle_id];
}

function updateBusMarkers(positions) {
    const activeMarkers = new Set(positions.map(pos => pos.vehicle_id));

    // First update existing markers
    positions.forEach(position => {
        const { vehicle_id, latitude, longitude, bearing } = position;
        
        if (busMarkers[vehicle_id]) {
            // Update existing marker
            const marker = busMarkers[vehicle_id];
            const newLatLng = L.latLng(latitude, longitude);
            
            // Only move if position has changed significantly
            if (marker.getLatLng().distanceTo(newLatLng) > 1) {
                moveMarkerSmoothly(marker, newLatLng);
                
                // Update the bus icon rotation
                const busIcon = marker.getElement()?.querySelector('img[src="/images/pins/bus.svg"]');
                if (busIcon) {
                    busIcon.style.transform = `translate(-50%, 50%) rotate(${bearing}deg)`;
                }
            }

            // Update popup content if popup exists
            const popup = marker.getPopup();
            if (popup) {
                popup.setContent(createBusPopupContent(position));
            }
        } else {
            // Create new marker
            createNewMarker(latitude, longitude, null, position);
        }
    });

    // Remove inactive markers
    Object.keys(busMarkers).forEach(markerId => {
        if (!activeMarkers.has(markerId)) {
            if (map && busMarkers[markerId]) {
                map.removeLayer(busMarkers[markerId]);
                delete busMarkers[markerId];
            }
        }
    });
}

function moveMarkerSmoothly(marker, newLatLng) {
    const startLatLng = marker.getLatLng();
    const startTime = Date.now();
    const duration = 4000; // Match the update interval

    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Interpolate position
        const lat = startLatLng.lat + (newLatLng.lat - startLatLng.lat) * progress;
        const lng = startLatLng.lng + (newLatLng.lng - startLatLng.lng) * progress;
        
        marker.setLatLng([lat, lng]);

        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }

    animate();
}

function createBusPopupContent(busData) {
    const timestamp = typeof busData.timestamp === 'number' ? busData.timestamp : Date.now() / 1000;
    const date = new Date(timestamp * 1000);
    const timeString = date.toLocaleTimeString();
    
    // Process trip headsign to make first and last destinations bold
    let formattedHeadsign = '';
    if (busData.trip_headsign) {
        const destinations = busData.trip_headsign.split(' - ').map(d => d.trim());
        if (destinations.length > 1) {
            destinations[0] = `<b>${destinations[0]}</b>`;
            destinations[destinations.length - 1] = `<b>${destinations[destinations.length - 1]}</b>`;
            formattedHeadsign = destinations.join(' - ');
        } else {
            formattedHeadsign = busData.trip_headsign;
        }
    }
    
    // Get the final destination (headsign)
    const destinations = busData.trip_headsign ? busData.trip_headsign.split(' - ') : [];
    const finalDestination = destinations.length > 0 ? destinations[destinations.length - 1] : '';
    
    return `
        <div style="min-width: 200px; padding: 10px;">
            <div style="margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                <div style="
                    background-color: #${busData.route_color || '6C757D'}; 
                    color: #${busData.route_text_color || 'FFFFFF'}; 
                    padding: 2px 8px; 
                    border-radius: 12px; 
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                ">
                    <span style="font-weight: bold;">${busData.route_short_name || 'Unknown'}</span>
                    <span style="border-left: 1px solid #${busData.route_text_color || 'FFFFFF'}; padding-left: 8px;">
                        ${finalDestination}
                    </span>
                </div>
            </div>
            ${formattedHeadsign ? `<div style="margin-bottom: 5px;">${formattedHeadsign}</div>` : ''}
            ${busData.license_plate ? `<div style="margin-bottom: 5px;">Vehicle: ${busData.license_plate}</div>` : ''}
            <div style="margin-bottom: 5px;">Speed: ${Math.round(busData.speed || 0)} km/h</div>
        </div>
    `;
}

// Include all the route and stop related functions from the original file
// ... (rest of the original functions)

async function fetchStops(useMapBounds = false) {
    if (!map) {
        console.warn('Map is not initialized yet.');
        return;
    }

    try {
        // Try to get from localStorage first
        const cachedStops = localStorage.getItem('busStops');
        const cacheTimestamp = localStorage.getItem('busStopsTimestamp');
        const CACHE_DURATION = 365 * 24 * 60 * 60 * 1000; // 365 days in milliseconds

        let stops;
        if (cachedStops && cacheTimestamp) {
            const isExpired = Date.now() - parseInt(cacheTimestamp) > CACHE_DURATION;
            if (!isExpired) {
                console.log('Using cached stops data');
                stops = JSON.parse(cachedStops);
            }
        }

        if (!stops) {
            // Fetch from server if no cache
            const response = await fetch('/api/stops');
            if (!response.ok) throw new Error('Failed to fetch stops');
            stops = await response.json();

            // Update localStorage
            localStorage.setItem('busStops', JSON.stringify(stops));
            localStorage.setItem('busStopsTimestamp', Date.now().toString());
        }

        let filteredStops;
        if (useMapBounds) {
            // Filter stops within current map bounds
            const bounds = map.getBounds();
            filteredStops = stops.filter(stop => {
                const lat = parseFloat(stop.lat);
                const lon = parseFloat(stop.lon);
                return lat >= bounds.getSouth() && 
                       lat <= bounds.getNorth() &&
                       lon >= bounds.getWest() && 
                       lon <= bounds.getEast();
            });
            console.log(`Showing ${filteredStops.length} stops in visible area`);
        } else if (userPosition) {
            // Filter stops within 3km of user position
            filteredStops = stops.filter(stop => {
                const distance = getDistanceFromLatLonInKm(
                    userPosition.lat, 
                    userPosition.lon, 
                    parseFloat(stop.lat), 
                    parseFloat(stop.lon)
                );
                return distance <= 3;
            });
            console.log(`Showing ${filteredStops.length} stops within 3km`);
        } else {
            console.warn('No user position available for nearby stops');
            return;
        }

        displayStops(filteredStops);
    } catch (error) {
        console.error('Error fetching stops:', error);
    }
}

function displayStops(stops) {
    // Clear existing stop markers
    Object.values(busStopMarkers).forEach(marker => {
        if (map) map.removeLayer(marker);
    });
    busStopMarkers = {};

    // Add markers for each stop
    stops.forEach(stop => {
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
            weight: 6,
            opacity: 0.9
        }).addTo(map);

        // Fetch and display stops for this route
        fetchRouteStops(routeId);

    } catch (error) {
        console.error('Error displaying route shape:', error);
    }
}

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

// Add this function to handle bus marker clicks
function onBusMarkerClick(routeId) {
    if (routeId) {
        displayRouteShape(routeId);
    }
}

// Add this function to initialize buttons with consistent style
function setupButtons() {
    const buttons = document.querySelectorAll('.tab-button');
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const target = button.getAttribute('data-target');
            if (/^\/[a-zA-Z0-9\-\/]*$/.test(target)) {
                window.location.href = target;
            } else {
                console.error('Invalid target URL:', target);
            }
        });
    });

    // Style the show stops button to match other buttons but with blue color
    const showStopsButton = document.getElementById('show-stops-button');
    if (showStopsButton) {
        showStopsButton.className = 'tab-button';
        showStopsButton.style.backgroundColor = '#007bff'; // Blue background
        showStopsButton.style.color = '#fff'; // White text
        showStopsButton.style.border = 'none'; // Remove border
        showStopsButton.style.padding = '8px 16px';
        showStopsButton.style.borderRadius = '4px';
        showStopsButton.style.cursor = 'pointer';
        showStopsButton.innerHTML = 'Show Stops';
        // Add hover effect
        showStopsButton.onmouseover = function() {
            this.style.backgroundColor = '#0056b3'; // Darker blue on hover
        };
        showStopsButton.onmouseout = function() {
            this.style.backgroundColor = '#007bff'; // Back to original blue
        };
        showStopsButton.addEventListener('click', () => {
            fetchStops(true);
        });
    }

    const locateButton = document.getElementById('locate-button');
    if (locateButton) {
        locateButton.addEventListener('click', () => {
            showUserPosition();
        });
    }
}

function checkCompassAvailability() {
    if (window.DeviceOrientationEvent) {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS 13+ devices
            isCompassAvailable = true;  // Device supports compass
            // Request permission when location button is clicked
            return true;
        } else {
            // Non iOS devices
            window.addEventListener('deviceorientation', function(event) {
                isCompassAvailable = (event.alpha != null);
            }, { once: true });
        }
    }
    return isCompassAvailable;
}

function handleOrientation(event) {
    if (!event) return;
    
    const cone = document.querySelector('.direction-cone');
    if (!cone) return;

    let direction;
    
    if (event.webkitCompassHeading !== undefined) {
        // iOS devices
        direction = event.webkitCompassHeading;
    } else if (event.alpha !== null) {
        // Android devices
        direction = 360 - event.alpha;
    } else {
        return;
    }

    // Add 90 degrees to point in the right direction
    direction = (direction + 90) % 360;
    
    // Apply the rotation directly
    cone.style.transform = `rotate(${direction}deg)`;
    cone.style.transformOrigin = 'center center';
}

function handleLocationError(error) {
    let errorMessage = 'Unable to retrieve your location. ';
    switch (error.code) {
        case error.PERMISSION_DENIED:
            errorMessage += 'User denied the request for location access.';
            break;
        case error.POSITION_UNAVAILABLE:
            errorMessage += 'Location information is unavailable.';
            break;
        case error.TIMEOUT:
            errorMessage += 'The request to get user location timed out.';
            break;
        default:
            errorMessage += 'An unknown error occurred.';
    }
    console.error(errorMessage, error);
    alert(errorMessage);
}

// Add this new function
async function requestCompassPermissions() {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission === 'granted') {
                isCompassAvailable = true;
                window.addEventListener('deviceorientationabsolute', handleOrientation, true);
                window.addEventListener('deviceorientation', handleOrientation, true);
            }
        } catch (error) {
            console.error('Error requesting compass permission:', error);
        }
    }
}

// Add this function to handle compass initialization
function initializeCompass() {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS 13+ devices
        DeviceOrientationEvent.requestPermission()
            .then(permission => {
                if (permission === 'granted') {
                    isCompassAvailable = true;
                    setupCompassListeners();
                }
            })
            .catch(console.error);
    } else {
        // Other devices
        setupCompassListeners();
    }
}

function setupCompassListeners() {
    // Remove existing listeners
    window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
    window.removeEventListener('deviceorientation', handleOrientation, true);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('focus', handleAppFocus);
    
    // Add orientation listeners
    if (window.DeviceOrientationEvent) {
        if ('ondeviceorientationabsolute' in window) {
            window.addEventListener('deviceorientationabsolute', handleOrientation, true);
        } else {
            window.addEventListener('deviceorientation', handleOrientation, true);
        }
    }

    // Add visibility and focus handlers
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleAppFocus);
}

function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
        // Force compass recalibration
        setupCompassListeners();
        
        // Request a new reading immediately
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(permission => {
                    if (permission === 'granted') {
                        window.dispatchEvent(new Event('deviceorientation'));
                    }
                });
        } else {
            window.dispatchEvent(new Event('deviceorientation'));
        }
    }
}

function handleAppFocus() {
    // Force compass recalibration
    setupCompassListeners();
    
    // Request a new reading immediately
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permission => {
                if (permission === 'granted') {
                    window.dispatchEvent(new Event('deviceorientation'));
                }
            });
    } else {
        window.dispatchEvent(new Event('deviceorientation'));
    }
}

function handleAppBlur() {
    // Clean up listeners when app loses focus
    window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
    window.removeEventListener('deviceorientation', handleOrientation, true);
}

function updateCompassDirection() {
    const cone = document.querySelector('.direction-cone');
    if (!cone || !isCompassAvailable) return;

    // Get the current rotation
    const currentRotation = getCurrentRotation(cone);
    
    // Calculate the shortest rotation path to the target direction
    let diff = ((lastKnownDirection - currentRotation + 540) % 360) - 180;
    
    // Animate the rotation
    animateRotation(cone, currentRotation, currentRotation + diff);
}

function getCurrentRotation(element) {
    const style = window.getComputedStyle(element);
    const matrix = new WebKitCSSMatrix(style.transform);
    return Math.round(Math.atan2(matrix.b, matrix.a) * (180 / Math.PI)) || 0;
}

function animateRotation(element, start, end) {
    const duration = 3000; // Match the update interval
    const startTime = performance.now();
    
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease the rotation
        const easeProgress = progress < .5 ? 
            2 * progress * progress : 
            -1 + (4 - 2 * progress) * progress;
        
        const currentRotation = start + (end - start) * easeProgress;
        element.style.transform = `rotate(${currentRotation}deg)`;
        element.style.transformOrigin = 'center center';
        
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    
    requestAnimationFrame(update);
}

async function updateBusMarker(position, details) {
    const { id, lat, lon, bearing, routeId } = position;
    const routeInfo = details?.routeInfo || {};
    
    if (!id || !lat || !lon) {
        console.log('Invalid position data:', position);
        return;
    }

    console.log('Updating bus marker:', id, 'at', lat, lon);

    const markerData = {
        vehicle_id: id,
        latitude: lat,
        longitude: lon,
        bearing: bearing || 0,
        route_short_name: routeInfo.shortName || '?',
        route_color: routeInfo.color || '000000',
        route_text_color: routeInfo.textColor || 'FFFFFF',
        license_plate: details?.vehicleInfo?.licensePlate || '',
        trip_headsign: routeInfo.longName || 'Unknown Route',
        routeId: routeId
    };

    // Update or create marker
    if (busMarkers[id]) {
        console.log('Updating existing marker:', id);
        // Update existing marker
        const marker = busMarkers[id];
        const newLatLng = L.latLng(lat, lon);
        
        if (marker.getLatLng().distanceTo(newLatLng) > 1) {
            moveMarkerSmoothly(marker, newLatLng);
        }
        
        // Update popup content
        const popupContent = createBusPopupContent(markerData);
        marker.getPopup()?.setContent(popupContent);
        
        // Update icon rotation
        const icon = marker.getIcon();
        icon.options.rotationAngle = bearing;
        marker.setIcon(icon);
    } else {
        console.log('Creating new marker:', id);
        // Create new marker
        createBusMarker(markerData);
    }
}

function createBusMarker(data) {
    if (!map) {
        console.error('Map not initialized');
        return;
    }

    console.log('Creating bus marker with data:', data);

    const marker = L.marker([data.latitude, data.longitude], {
        icon: L.divIcon({
            className: 'bus-marker',
            html: `
                <div class="bus-icon" style="background-color: #${data.route_color}; color: #${data.route_text_color};">
                    ${data.route_short_name}
                </div>
            `,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            popupAnchor: [0, -15]
        }),
        rotationAngle: data.bearing || 0
    }).addTo(map);

    // Create popup content
    const popupContent = createBusPopupContent(data);
    marker.bindPopup(popupContent);

    // Add click handler for route display
    marker.on('click', () => {
        if (data.routeId) {
            onBusMarkerClick(data.routeId);
        }
    });

    // Store marker reference
    busMarkers[data.vehicle_id] = marker;

    console.log('Marker created and added to map');
    return marker;
}
