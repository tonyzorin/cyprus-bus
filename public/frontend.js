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
let selectedRoutes = new Set();
let carSharingMarkers = {};
let carSharingUpdateInterval = null;
let lastRideNowFetchTime = 0;
let selectedCities = new Set();
let cityFilters = {};
let appliedFilters = {
    cities: [],
    routes: {}
};
const carSharingIcon = L.icon({
    iconUrl: 'images/carsharing.png',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11]
});

document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOM loaded, initializing map...');
    
    // Add debug for show-stops-button
    const showStopsButtonCheck = document.getElementById('show-stops-button');
    if (showStopsButtonCheck) {
        console.log('Show stops button found in DOM:', showStopsButtonCheck);
    } else {
        console.error('Show stops button NOT found in DOM');
    }
    
    // Add event listener for filter-routes-button
    const filterRoutesButton = document.getElementById('filter-routes-button');
    if (filterRoutesButton) {
        filterRoutesButton.addEventListener('click', () => {
            showRouteFilterModal();
        });
    }
    
    // Load saved filters from localStorage
    loadSavedFilters();
    
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
        console.log('Initializing bus features...');
        
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
        console.log('Looking for show stops button in initializeBusFeatures:', showStopsButton);
        
        if (showStopsButton) {
            console.log('Adding click event listener to show stops button');
            
            // Remove any existing listeners to prevent duplicates
            const newButton = showStopsButton.cloneNode(true);
            showStopsButton.parentNode.replaceChild(newButton, showStopsButton);
            
            newButton.addEventListener('click', () => {
                console.log('Show stops button clicked!');
                fetchStops(true);
            });
            
            // Add a direct onclick attribute as a backup
            newButton.onclick = function() {
                console.log('Show stops button onclick triggered!');
                fetchStops(true);
                return false;
            };
        } else {
            console.error('Show stops button not found in initializeBusFeatures');
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
        statusElement.textContent = '❌ Motion 💀 Check bus stops for timetables.';
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
        
        // Apply route filters after updating markers
        applyRouteFilters();
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
    console.log('showUserPosition function called');
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

            navigator.geolocation.getCurrentPosition(async function(position) {
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

                    // Load bus stops within 2km radius of user position
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

                    // Start carsharing updates only if they haven't been started
                    if (!carSharingUpdateInterval) {
                        await updateCarSharingPositions();
                    }
                }
            }, handleLocationError, {
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
    console.log('fetchStops called with useMapBounds:', useMapBounds);
    if (!map) {
        console.warn('Map is not initialized yet.');
        return;
    }

    try {
        // Try to get from localStorage first
        const cachedStops = localStorage.getItem('busStopsV2');
        const cacheTimestamp = localStorage.getItem('busStopsTimestampV2');
        const CACHE_DURATION = 14 * 24 * 60 * 60 * 1000; // 14 days in milliseconds

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
            console.log('Fetching stops from server...');
            const response = await fetch('/api/stops');
            if (!response.ok) {
                console.error('Failed to fetch stops:', response.status, response.statusText);
                throw new Error('Failed to fetch stops');
            }
            stops = await response.json();

            // Update localStorage
            localStorage.setItem('busStopsV2', JSON.stringify(stops));
            localStorage.setItem('busStopsTimestampV2', Date.now().toString());
        }

        let filteredStops;
        
        if (useMapBounds) {
            // Get the current bounds of the map
            const bounds = map.getBounds();
            console.log('Current map bounds:', bounds);
            
            // Filter stops within the current map bounds
            filteredStops = stops.filter(stop => {
                // Support both field naming formats (lat/lon and stop_lat/stop_lon)
                const stopLat = parseFloat(stop.lat || stop.stop_lat);
                const stopLon = parseFloat(stop.lon || stop.stop_lon);
                
                if (isNaN(stopLat) || isNaN(stopLon)) {
                    return false;
                }
                
                // Check if the stop is within the bounds
                return bounds.contains([stopLat, stopLon]);
            });
            
            console.log(`Showing ${filteredStops.length} stops within map bounds`);
        } else if (userPosition) {
            // Filter stops within 2km of user position (original behavior)
            filteredStops = stops.filter(stop => {
                // Support both field naming formats (lat/lon and stop_lat/stop_lon)
                const stopLat = parseFloat(stop.lat || stop.stop_lat);
                const stopLon = parseFloat(stop.lon || stop.stop_lon);
                
                if (isNaN(stopLat) || isNaN(stopLon)) {
                    return false;
                }
                
                const distance = getDistanceFromLatLonInKm(
                    userPosition.lat, 
                    userPosition.lon, 
                    stopLat, 
                    stopLon
                );
                return distance <= 2;
            });
            console.log(`Showing ${filteredStops.length} stops within 2km radius of user position`);
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
        // Support both field naming formats (lat/lon and stop_lat/stop_lon)
        const stopLat = parseFloat(stop.lat || stop.stop_lat);
        const stopLon = parseFloat(stop.lon || stop.stop_lon);
        
        if (isNaN(stopLat) || isNaN(stopLon)) {
            return;
        }
        
        const marker = L.marker([stopLat, stopLon], {
            icon: L.icon({
                iconUrl: './images/bus-stop.png',
                iconSize: [14, 14],
                iconAnchor: [7, 7],
                popupAnchor: [0, -7]
            })
        }).addTo(map);

        // Only include a loading message in the popup, not the stop name/ID (which will be added by displayStopInfo)
        marker.bindPopup(`
            <div style="min-width: 300px;">
                <div id="stop-${stop.stop_id}-buses">Loading...</div>
            </div>
        `);
        
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

async function fetchStopInfo(stop_id) {
    try {
        const response = await fetch(`/api/stop/${stop_id}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        displayStopInfo(stop_id, data);
    } catch (error) {
        console.error('Error fetching stop info:', error);
        const stopInfoContainer = document.getElementById(`stop-${stop_id}-buses`);
        if (stopInfoContainer) {
            stopInfoContainer.innerHTML = 'Error loading stop information';
        }
    }
}

function displayStopInfo(stop_id, data) {
    const stopInfoContainer = document.getElementById(`stop-${stop_id}-buses`);
    if (!stopInfoContainer) {
        console.error(`Element with ID "stop-${stop_id}-buses" not found`);
        return;
    }

    const { stop_info, routes, timetable } = data;
    let content = '';

    // Add stop header
    content += `
        <div style="margin-bottom: 10px;">
            <strong>${stop_info.stop_name}</strong><br>
            <small>Stop ID: ${stop_info.stop_id}</small>
        </div>
    `;

    // Add routes section if available
    if (routes && routes.length > 0) {
        content += `
            <div style="margin-bottom: 10px;">
                <strong>Routes stopping here:</strong>
                <div style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px;">
                    ${routes.map(route => 
                        `<span 
                            class="route-badge"
                            data-route-id="${route.route_id}"
                            style="
                                background-color: #${route.route_color || '6C757D'}; 
                                color: #${route.route_text_color || 'FFFFFF'}; 
                                padding: 4px 8px; 
                                border-radius: 12px; 
                                font-weight: bold;
                                font-size: 12px;
                                cursor: pointer;
                                display: inline-flex;
                                align-items: center;
                                margin: 2px;
                                white-space: nowrap;
                            "
                            title="${route.route_long_name || ''}"
                        >
                            <span style="margin-right: 4px;">${route.route_short_name}</span>
                            ${route.trip_headsign ? 
                                `<span style="font-weight: normal;"> ${route.trip_headsign}</span>` 
                                : ''}
                        </span>`
                    ).join('')}
                </div>
            </div>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 10px 0;">
        `;
    }

    // Add timetable section
    if (!timetable || timetable.length === 0) {
        content += '<div style="color: #666;">No upcoming buses in the next 90 minutes.</div>';
    } else {
        content += `
            <table style="width: 100%; table-layout: fixed; font-size: 12px; border-collapse: collapse;">
                <colgroup>
                    <col style="width: 15%;">
                    <col style="width: 10%;">
                    <col style="width: 50%;">
                    <col style="width: 25%;">
                </colgroup>
                <tr style="background-color: #f8f9fa;">
                    <th style="text-align: left; padding: 5px;">⏳ Time</th>
                    <th style="text-align: left; padding: 5px;">🚌 Route</th>
                    <th style="text-align: left; padding: 5px;">📍 Destination</th>
                    <th style="text-align: left; padding: 5px;">🚦 Status</th>
                </tr>
                ${timetable.map(info => 
                    `<tr style="
                        color: #${info.route_text_color || 'FFFFFF'}; 
                        background-color: #${info.route_color || '6C757D'};
                        border-bottom: 1px solid rgba(255,255,255,0.1);
                    ">
                        <td style="padding: 6px; vertical-align: middle;">${Math.round(info.time_left)}m</td>    
                        <td style="padding: 6px; vertical-align: middle;">${info.route_short_name}</td>
                        <td style="padding: 6px; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${info.trip_headsign || ''}</td>
                        <td style="padding: 6px; vertical-align: middle;">${info.is_live ? '● Live' : 'Scheduled'}</td>
                    </tr>`
                ).join('')}
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

            // Only include a loading message in the popup, not the stop name/ID (which will be added by displayStopInfo)
            marker.bindPopup(`<div style="min-width: 300px;"><div id="stop-${stop.stop_id}-buses">Loading...</div></div>`);
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
    console.log('Setting up buttons...');
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
    console.log('Looking for show stops button in setupButtons:', showStopsButton);
    
    if (showStopsButton) {
        console.log('Styling show stops button');
        showStopsButton.className = 'tab-button';
        showStopsButton.style.backgroundColor = '#007bff'; // Blue background
        showStopsButton.style.color = '#fff'; // White text
        showStopsButton.style.border = 'none'; // Remove border
        showStopsButton.style.padding = '8px 16px';
        showStopsButton.style.borderRadius = '4px';
        showStopsButton.style.cursor = 'pointer';
        showStopsButton.innerHTML = '🚏 Show Stops';
        // Add hover effect
        showStopsButton.onmouseover = function() {
            this.style.backgroundColor = '#0056b3'; // Darker blue on hover
        };
        showStopsButton.onmouseout = function() {
            this.style.backgroundColor = '#007bff'; // Back to original blue
        };
        // NOTE: Not adding a new event listener here, as it's already set up during initialization
    } else {
        console.error('Show stops button not found in setupButtons');
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

// Add this CSS to keep footer fixed
function addFixedFooterStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .footer {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: white;
            box-shadow: 0 -2px 5px rgba(0,0,0,0.1);
            z-index: 1000;
        }
        
        .content {
            padding-bottom: 60px; /* Height of footer */
        }
    `;
    document.head.appendChild(style);
}

// Update the stats page to show correct active section
function updateActiveSection(section) {
    const sections = ['map', 'stats', 'routes', 'telegram'];
    sections.forEach(s => {
        const element = document.querySelector(`.footer-icon[data-section="${s}"]`);
        if (element) {
            element.classList.toggle('active', s === section);
        }
    });
}

function createRoutesSelector() {
    const modal = document.createElement('div');
    modal.className = 'routes-modal';
    modal.innerHTML = `
        <div class="routes-modal-content">
            <div class="routes-header">
                <h2>Select Routes</h2>
                <div class="global-actions">
                    <button onclick="selectAllRoutes()">Select All</button>
                    <button onclick="deselectAllRoutes()">Select None</button>
                </div>
            </div>
            <div class="routes-list" id="routesList">
                Loading routes...
            </div>
        </div>
    `;

    loadRoutes();
    return modal;
}

async function loadRoutes() {
    try {
        const response = await fetch('/api/routes-by-city');
        const cities = await response.json();
        
        const routesList = document.getElementById('routesList');
        routesList.innerHTML = cities.map(city => `
            <div class="city-section">
                <div class="city-header">
                    <h3>${city.city}</h3>
                    <div>
                        <button onclick="selectAllCityRoutes('${city.city}')">Select All</button>
                        <button onclick="deselectAllCityRoutes('${city.city}')">Select None</button>
                    </div>
                </div>
                <div class="routes">
                    ${city.routes.map(route => `
                        <div class="route-item" data-route="${route.route_short_name}">
                            <label>
                                <input type="checkbox" 
                                       onchange="toggleRoute('${route.routes.map(r => r.route_id).join(',')}')"
                                       ${selectedRoutes.has(route.route_short_name) ? 'checked' : ''}>
                                Route ${route.route_short_name}
                            </label>
                            <button onclick="showRouteDetails('${route.route_short_name}')">Details</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading routes:', error);
        document.getElementById('routesList').innerHTML = 'Error loading routes';
    }
}

function showRouteDetails(routeShortName) {
    // Show a modal with all routes that have this short name
    // This will be implemented in the next step
}

function initializeRouteSelection() {
    // Load selection from URL
    const params = new URLSearchParams(window.location.search);
    const routes = params.get('routes');
    if (routes) {
        selectedRoutes = new Set(routes.split(','));
    }
}

function updateRouteSelection() {
    // Update URL with current selection
    const params = new URLSearchParams(window.location.search);
    if (selectedRoutes.size > 0) {
        params.set('routes', Array.from(selectedRoutes).join(','));
    } else {
        params.delete('routes');
    }
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);

    // Update visible buses
    Object.entries(busMarkers).forEach(([vehicleId, marker]) => {
        const routeId = vehicleDetails[vehicleId]?.tripInfo?.routeId;
        if (selectedRoutes.size === 0 || selectedRoutes.has(routeId)) {
            marker.addTo(map);
        } else {
            marker.remove();
        }
    });
}

function showRoutesSelector() {
    const existingModal = document.querySelector('.routes-modal');
    if (existingModal) {
        existingModal.remove();
        return;
    }

    const modal = createRoutesSelector();
    document.body.appendChild(modal);
    
    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

function selectAllRoutes() {
    const checkboxes = document.querySelectorAll('.route-item input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
        const routeIds = checkbox.getAttribute('data-route-ids').split(',');
        routeIds.forEach(id => selectedRoutes.add(id));
    });
    updateRouteSelection();
}

function deselectAllRoutes() {
    const checkboxes = document.querySelectorAll('.route-item input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    selectedRoutes.clear();
    updateRouteSelection();
}

function selectAllCityRoutes(city) {
    const citySection = document.querySelector(`.city-section[data-city="${city}"]`);
    const checkboxes = citySection.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
        const routeIds = checkbox.getAttribute('data-route-ids').split(',');
        routeIds.forEach(id => selectedRoutes.add(id));
    });
    updateRouteSelection();
}

function deselectAllCityRoutes(city) {
    const citySection = document.querySelector(`.city-section[data-city="${city}"]`);
    const checkboxes = citySection.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
        const routeIds = checkbox.getAttribute('data-route-ids').split(',');
        routeIds.forEach(id => selectedRoutes.delete(id));
    });
    updateRouteSelection();
}

function toggleRoute(routeIds) {
    const ids = routeIds.split(',');
    const checkbox = event.target;
    
    if (checkbox.checked) {
        ids.forEach(id => selectedRoutes.add(id));
    } else {
        ids.forEach(id => selectedRoutes.delete(id));
    }
    
    updateRouteSelection();
}

async function updateCarSharingPositions() {
    if (!userPosition) {
        console.log('Waiting for user position...');
        return;
    }

    // Add debounce mechanism - prevent calling this function more than once every 5 seconds
    const now = Date.now();
    if (now - lastRideNowFetchTime < 5000) {
        console.log('Skipping RideNow update - too soon since last fetch');
        return;
    }
    
    lastRideNowFetchTime = now;

    try {
        console.log('Fetching RideNow car positions...');
        const response = await fetch(
            `/api/ridenow?lat=${userPosition.lat}&lon=${userPosition.lon}`,
            {
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            }
        );
        
        if (!response.ok) throw new Error('Failed to fetch carsharing data');
        
        const data = await response.json();
        const cacheDuration = parseInt(response.headers.get('Cache-Duration') || '30000');
        const lastUpdate = parseInt(response.headers.get('Last-Update') || Date.now());
        
        console.log(`Loaded ${data.cars.length} carsharing vehicles`);

        // Track active cars to remove stale markers
        const activeCars = new Set();

        // Update or create markers for each car
        data.cars.forEach(car => {
            const id = car.reg_number;
            activeCars.add(id);

            if (carSharingMarkers[id]) {
                // Update existing marker position
                carSharingMarkers[id].setLatLng([car.lat, car.lon]);
            } else {
                // Create new marker
                const marker = L.marker([car.lat, car.lon], {
                    icon: carSharingIcon,
                    // Add unique identifier for analytics
                    carId: id,
                    carBrand: car.car_brand,
                    carModel: car.car_model
                });

                // Add popup with car details and analytics tracking
                marker.bindPopup(`
                    <div style="min-width: 270px; padding: 5px;" id="carsharing-${id.replace(/\s+/g, '-')}">
                    <div style="text-align: left; font-size: 18px; font-weight: bold;">${car.car_brand} ${car.car_model}</div>
                        <div style="display: flex; gap: 10px; align-items: start;">
                            <div style="flex: 2;">
                                <img src="${car.image}" 
                                     alt="${car.car_brand} ${car.car_model}" 
                                     style="height: 120px; object-fit: contain; border-radius: 4px;"
                                     onerror="this.style.display='none'">
                            </div>
                            <div style="flex: 1; display: flex; flex-direction: column;">
                                <div style="
                                    background-color: #f8f9fa; 
                                    padding: 8px 12px; 
                                    border-radius: 8px; 
                                    margin-bottom: 8px;
                                ">
                                    <span style="font-weight: bold;">${car.reg_number}</span>
                                </div>
                                <div style="
                                    display: flex;
                                    align-items: center;
                                    gap: 5px;
                                    color: ${car.fuel_level < 20 ? '#dc3545' : '#28a745'};
                                ">
                                    <img src="images/fuel.png" alt="Fuel Icon" style="margin-right: 4px; width: 24px; height: 24px;">
                                    ${car.fuel_level}%
                                </div>
                            </div>
                        </div>
                    </div>
                `);

                // Add click handler for analytics
                marker.on('click', async () => {
                    try {
                        // Log to console
                        console.log(`Carsharing vehicle clicked: ${id}`);

                        // Track the event through our backend
                        const response = await fetch('/api/analytics/track', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                event_name: 'clicked-carsharing-button',
                                distinct_id: posthog.get_distinct_id(),
                                properties: {
                                    car_id: id,
                                    car_brand: car.car_brand,
                                    car_model: car.car_model,
                                    position: [car.lat, car.lon],
                                    timestamp: Date.now()
                                }
                            })
                        });

                        if (!response.ok) {
                            throw new Error('Failed to track analytics event');
                        }

                    } catch (error) {
                        console.error('Error tracking carsharing click:', error);
                    }
                });

                marker.addTo(map);
                carSharingMarkers[id] = marker;
            }
        });

        // Remove markers for cars that are no longer active
        Object.keys(carSharingMarkers).forEach(id => {
            if (!activeCars.has(id)) {
                map.removeLayer(carSharingMarkers[id]);
                delete carSharingMarkers[id];
            }
        });

        // Schedule next update
        if (carSharingUpdateInterval) {
            clearTimeout(carSharingUpdateInterval);
        }

        const timeSinceLastUpdate = Date.now() - lastUpdate;
        const timeUntilNextUpdate = Math.max(30000, cacheDuration - timeSinceLastUpdate); // Minimum 30 seconds between updates
        carSharingUpdateInterval = setTimeout(updateCarSharingPositions, timeUntilNextUpdate);

    } catch (error) {
        console.error('Error updating carsharing positions:', error);
        // Retry after 30 seconds on error
        if (carSharingUpdateInterval) {
            clearTimeout(carSharingUpdateInterval);
        }
        carSharingUpdateInterval = setTimeout(updateCarSharingPositions, 30000); // Retry after 30 seconds on error
    }
}

// Add this at the bottom of the file
// Fallback direct event listener for show-stops-button
window.addEventListener('load', function() {
    console.log('Window fully loaded, adding direct event listener to show-stops-button');
    
    setTimeout(() => {
        const showStopsButton = document.getElementById('show-stops-button');
        if (showStopsButton) {
            console.log('Adding direct click event listener to show-stops-button after timeout');
            showStopsButton.addEventListener('click', function(e) {
                console.log('Show stops button clicked via direct event listener!');
                e.preventDefault();
                e.stopPropagation();
                if (typeof fetchStops === 'function') {
                    fetchStops(true);
                } else {
                    console.error('fetchStops function not found!');
                }
                return false;
            });
        } else {
            console.error('Show stops button not found after window load and timeout');
        }
    }, 1000); // Add a delay to ensure DOM is fully processed
});

// Load filters from localStorage
function loadSavedFilters() {
    try {
        const savedFilters = localStorage.getItem('routeFilters');
        if (savedFilters) {
            appliedFilters = JSON.parse(savedFilters);
            selectedCities = new Set(appliedFilters.cities || []);
            console.log('Loaded filters from localStorage:', appliedFilters);
            
            // Apply filters to the map
            applyRouteFilters();
        }
    } catch (error) {
        console.error('Error loading saved filters:', error);
    }
}

// Save filters to localStorage
function saveFilters() {
    try {
        localStorage.setItem('routeFilters', JSON.stringify(appliedFilters));
        console.log('Saved filters to localStorage:', appliedFilters);
    } catch (error) {
        console.error('Error saving filters:', error);
    }
}

// Create and show the route filter modal
async function showRouteFilterModal() {
    // Remove existing modal if any
    const existingModal = document.querySelector('.route-filter-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Create modal container
    const modal = document.createElement('div');
    modal.className = 'route-filter-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.7);
        z-index: 2000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    
    // Create modal content
    modal.innerHTML = `
        <div class="route-filter-content" style="
            background: white;
            border-radius: 8px;
            padding: 20px;
            width: 90%;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
        ">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2 style="margin: 0;">Filter Routes by City</h2>
                <button id="close-filter-modal" style="
                    background: none;
                    border: none;
                    font-size: 24px;
                    cursor: pointer;
                ">×</button>
            </div>
            
            <div id="city-selector" style="margin-bottom: 20px;">
                <h3>Select Cities</h3>
                <div id="city-checkboxes" style="
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                ">
                    Loading cities...
                </div>
            </div>
            
            <div id="route-selector" style="margin-bottom: 20px;">
                <h3>Select Routes</h3>
                <div id="route-filters" style="
                    margin-top: 10px;
                ">
                    Please select at least one city first...
                </div>
            </div>
            
            <div style="display: flex; justify-content: flex-end; gap: 10px;">
                <button id="reset-filters" style="
                    padding: 8px 16px;
                    background: #f1f1f1;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    cursor: pointer;
                ">Reset All</button>
                <button id="apply-filters" style="
                    padding: 8px 16px;
                    background: #4CAF50;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                ">Apply Filters</button>
            </div>
        </div>
    `;
    
    // Add modal to body
    document.body.appendChild(modal);
    
    // Add event listeners
    document.getElementById('close-filter-modal').addEventListener('click', () => {
        modal.remove();
    });
    
    document.getElementById('reset-filters').addEventListener('click', () => {
        resetAllFilters();
        loadCityFilters();
    });
    
    document.getElementById('apply-filters').addEventListener('click', () => {
        saveAndApplyFilters();
        modal.remove();
    });
    
    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    // Load cities and routes
    await loadCityFilters();
}

// Reset all filters to default state
function resetAllFilters() {
    selectedCities.clear();
    cityFilters = {};
    appliedFilters = {
        cities: [],
        routes: {}
    };
    
    // Clear localStorage
    localStorage.removeItem('routeFilters');
    
    // Update UI
    applyRouteFilters();
}

// Load city filters from API
async function loadCityFilters() {
    try {
        const response = await fetch('/api/routes-by-city');
        const cities = await response.json();
        
        // Populate the city checkboxes
        const cityCheckboxes = document.getElementById('city-checkboxes');
        if (cityCheckboxes) {
            cityCheckboxes.innerHTML = cities.map(city => `
                <label style="
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    padding: 5px 10px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    cursor: pointer;
                ">
                    <input type="checkbox" name="city" value="${city.city}" 
                        ${selectedCities.has(city.city) ? 'checked' : ''}>
                    ${city.city}
                </label>
            `).join('');
            
            // Add event listeners to city checkboxes
            const checkboxes = cityCheckboxes.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) {
                        selectedCities.add(checkbox.value);
                    } else {
                        selectedCities.delete(checkbox.value);
                    }
                    
                    // Update route filters when city selection changes
                    updateRouteFilters(cities);
                });
            });
            
            // Initial update of route filters
            updateRouteFilters(cities);
        }
    } catch (error) {
        console.error('Error loading cities:', error);
        const cityCheckboxes = document.getElementById('city-checkboxes');
        if (cityCheckboxes) {
            cityCheckboxes.innerHTML = 'Error loading cities. Please try again.';
        }
    }
}

// Update route filters based on selected cities
function updateRouteFilters(cities) {
    const routeFilters = document.getElementById('route-filters');
    if (!routeFilters) return;
    
    if (selectedCities.size === 0) {
        routeFilters.innerHTML = 'Please select at least one city first...';
        return;
    }
    
    // Build html for route filters
    let html = '';
    
    // Filter cities based on selection
    const filteredCities = cities.filter(city => selectedCities.has(city.city));
    
    // Build route filters for each selected city
    filteredCities.forEach(city => {
        html += `
            <div style="margin-bottom: 15px;">
                <h4 style="margin: 10px 0; padding-bottom: 5px; border-bottom: 1px solid #eee;">
                    ${city.city}
                </h4>
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px;">
                    <button class="select-all-routes" data-city="${city.city}" style="
                        padding: 4px 8px;
                        background: #e9e9e9;
                        border: 1px solid #ccc;
                        border-radius: 4px;
                        font-size: 12px;
                        cursor: pointer;
                    ">Select All</button>
                    <button class="deselect-all-routes" data-city="${city.city}" style="
                        padding: 4px 8px;
                        background: #e9e9e9;
                        border: 1px solid #ccc;
                        border-radius: 4px;
                        font-size: 12px;
                        cursor: pointer;
                    ">Deselect All</button>
                </div>
                <div class="routes-list" style="margin-top: 15px;">
        `;
        
        // Add routes in this city as a list with checkboxes
        city.routes.sort((a, b) => {
            // Sort numerically if possible
            const aNum = parseInt(a.route_short_name);
            const bNum = parseInt(b.route_short_name);
            if (!isNaN(aNum) && !isNaN(bNum)) {
                return aNum - bNum;
            }
            // Otherwise sort alphabetically
            return a.route_short_name.localeCompare(b.route_short_name);
        }).forEach(route => {
            const routeColor = route.routes[0].route_color || 'FFFFFF';
            const routeTextColor = route.routes[0].route_text_color || '000000';
            const routeLongName = route.routes[0].route_long_name || '';
            
            // Check if route is selected in applied filters
            const isCitySelected = appliedFilters.cities.includes(city.city);
            const cityRoutes = appliedFilters.routes[city.city] || [];
            const isRouteSelected = cityRoutes.includes(route.route_short_name);
            
            // If no filters are applied yet, default to selected
            const isChecked = (Object.keys(appliedFilters.routes).length === 0) || 
                             (isCitySelected && isRouteSelected);
            
            html += `
                <div class="route-item" style="
                    margin-bottom: 8px;
                    padding: 8px;
                    border-radius: 4px;
                    background-color: #${routeColor}1A;
                    border-left: 4px solid #${routeColor};
                ">
                    <label style="
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        cursor: pointer;
                        width: 100%;
                    ">
                        <input type="checkbox" name="route-${city.city}" 
                               value="${route.route_short_name}" 
                               data-city="${city.city}"
                               ${isChecked ? 'checked' : ''}>
                        <div style="
                            display: flex;
                            flex-direction: column;
                            flex: 1;
                        ">
                            <div style="
                                display: flex;
                                align-items: center;
                                gap: 8px;
                                margin-bottom: 4px;
                            ">
                                <span style="
                                    background-color: #${routeColor};
                                    color: #${routeTextColor};
                                    padding: 2px 8px;
                                    border-radius: 12px;
                                    font-weight: bold;
                                    min-width: 35px;
                                    text-align: center;
                                ">${route.route_short_name}</span>
                                <span style="
                                    font-weight: bold;
                                    color: #333;
                                    flex: 1;
                                    white-space: nowrap;
                                    overflow: hidden;
                                    text-overflow: ellipsis;
                                ">${getMainDestinations(routeLongName)}</span>
                            </div>
                            <div style="
                                font-size: 12px;
                                color: #666;
                                padding-left: 5px;
                                white-space: nowrap;
                                overflow: hidden;
                                text-overflow: ellipsis;
                            ">${routeLongName}</div>
                        </div>
                    </label>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    routeFilters.innerHTML = html;
    
    // Add event listeners for select/deselect all buttons
    document.querySelectorAll('.select-all-routes').forEach(button => {
        button.addEventListener('click', () => {
            const city = button.dataset.city;
            const checkboxes = document.querySelectorAll(`input[name="route-${city}"]`);
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
            });
        });
    });
    
    document.querySelectorAll('.deselect-all-routes').forEach(button => {
        button.addEventListener('click', () => {
            const city = button.dataset.city;
            const checkboxes = document.querySelectorAll(`input[name="route-${city}"]`);
            checkboxes.forEach(checkbox => {
                checkbox.checked = false;
            });
        });
    });
}

// Save and apply the selected filters
function saveAndApplyFilters() {
    // Get selected cities
    const selectedCitiesArray = Array.from(selectedCities);
    
    // Get selected routes for each city
    const selectedRoutesByCities = {};
    selectedCitiesArray.forEach(city => {
        const cityRouteCheckboxes = document.querySelectorAll(`input[name="route-${city}"]:checked`);
        const cityRoutes = Array.from(cityRouteCheckboxes).map(checkbox => checkbox.value);
        selectedRoutesByCities[city] = cityRoutes;
    });
    
    // Update applied filters
    appliedFilters = {
        cities: selectedCitiesArray,
        routes: selectedRoutesByCities
    };
    
    // Save to localStorage
    saveFilters();
    
    // Apply filters to the map
    applyRouteFilters();
}

// Apply route filters to the map
function applyRouteFilters() {
    // If no filters are applied, show all bus markers
    if (appliedFilters.cities.length === 0) {
        // Show all markers
        Object.values(busMarkers).forEach(marker => {
            if (!map.hasLayer(marker)) {
                marker.addTo(map);
            }
        });
        return;
    }
    
    // Hide all markers first
    Object.entries(busMarkers).forEach(([id, marker]) => {
        map.removeLayer(marker);
    });
    
    // Show only markers that match the filters
    Object.entries(busMarkers).forEach(([id, marker]) => {
        const details = vehicleDetails[id] || {};
        const routeShortName = details.routeInfo?.shortName;
        const routeCity = getCityForRoute(routeShortName);
        
        // Show marker if its city is selected and route is selected
        if (routeCity && appliedFilters.cities.includes(routeCity)) {
            const cityRoutes = appliedFilters.routes[routeCity] || [];
            if (cityRoutes.includes(routeShortName)) {
                marker.addTo(map);
            }
        }
    });
}

// Helper function to determine which city a route belongs to
function getCityForRoute(routeShortName) {
    // This would ideally come from the backend, but for now we can
    // extract it from our applied filters
    for (const city of appliedFilters.cities) {
        const routes = appliedFilters.routes[city] || [];
        if (routes.includes(routeShortName)) {
            return city;
        }
    }
    return null;
}

// Helper function to extract main destinations from route long name
function getMainDestinations(routeLongName) {
    if (!routeLongName) return '';
    
    const parts = routeLongName.split(' - ');
    if (parts.length <= 1) return routeLongName;
    
    // Return first and last destinations if there are more than one
    return `${parts[0]} - ${parts[parts.length - 1]}`;
}

