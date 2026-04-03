import Feature from 'ol/Feature.js';
import Geolocation from 'ol/Geolocation.js';
import Map from 'ol/Map.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import View from 'ol/View.js';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style.js';
import { OSM, Vector as VectorSource } from 'ol/source.js';
import { Tile as TileLayer, Vector as VectorLayer } from 'ol/layer.js';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import packageJson from '../package.json';

// Initialize the map view centered at (0, 0) with a zoom level of 15
const view = new View({
	center: fromLonLat([0, 0]),
	zoom: 15,
});

// Try to get user's location immediately to center the map, but allow it to update when geolocation tracking starts
new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject)).then(position => view.setCenter(fromLonLat([position.coords.longitude, position.coords.latitude])));

// Features for current position and path, with styles
const positionFeature = new Feature();
positionFeature.setStyle(
	new Style({
		image: new CircleStyle({
			radius: 6,
			fill: new Fill({
				color: '#ff0000',
			}),
			stroke: new Stroke({
				color: '#fff',
				width: 2,
			}),
		}),
	}),
);

const pathFeature = new Feature();
pathFeature.setStyle(
	new Style({
		stroke: new Stroke({
			color: '#ff0000',
			width: 3,
		}),
	}),
);


// Create the map with a base OSM layer and the defined view
// Add the vector layer to the map
new VectorLayer({
	map: new Map({
		layers: [
			new TileLayer({
				source: new OSM(),
			})
		],
		target: 'map',
		view: view,
	}),
	source: new VectorSource({
		features: [positionFeature, pathFeature],
	}),
});


// Config
let autoPauseThreshold = 5; // metres - threshold for triggering auto-pause when movement is below this level for a certain duration
let altitudeAccuracy = 5; // metres - threshold for accepting altitude data from geolocation API

// State variables to track the run status, timing, and positions
let isTracking = false;
let isPaused = false;

let startTime = null;
let pausedElapsed = 0;
let lastPauseStart = null;
let positions = [];
let lastPosition = null;

let autoPauseTimer = null;
let timerInterval = null;

// Helper function to get element by ID
function el(id) {
	return document.getElementById(id);
}

// UI elements
const timerContainer = el("timers");
const startContainer = el("start-container");
const historyContainer = el("history-container");
const actionContainer = el("action-container");
const pauseOverlay = el("pause-overlay");


function formatTime(seconds) {
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateTimers() {
	if (!isTracking) return;

	const now = Date.now();
	const totalElapsed = Math.floor((now - startTime) / 1000);
	const activeElapsed = totalElapsed - Math.floor(pausedElapsed / 1000);

	el("duration-timer").textContent = formatTime(activeElapsed);

	if (isPaused) {
		const pauseElapsed = Math.floor((now - lastPauseStart) / 1000);
		el("pause-timer").textContent = `Paused: ${formatTime(pauseElapsed)}`;
	}
}


/**
 * Haversine formula to calculate distance between two lat/lon points https://en.wikipedia.org/wiki/Haversine_formula 
 * 
 * @param {*} lat1 
 * @param {*} lon1 
 * @param {*} lat2 
 * @param {*} lon2 
 * @returns distance in metres
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
	const R = 6371; // Radius of the Earth in km
	const dLat = (lat2 - lat1) * Math.PI / 180;
	const dLon = (lon2 - lon1) * Math.PI / 180;
	const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
		Math.sin(dLon / 2) * Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c * 1000; // in metres
}

function calculateTotalDistance() {
	let distance = 0;
	for (let i = 1; i < positions.length; i++) {
		const [lon1, lat1] = positions[i - 1];
		const [lon2, lat2] = positions[i];
		distance += haversineDistance(lat1, lon1, lat2, lon2);
	}
	return distance;
}


function cancelAutoPauseTimer() {
	if (autoPauseTimer) {
		clearTimeout(autoPauseTimer);
		autoPauseTimer = null;
	}
}

function cancelTimerInterval() {
	if (timerInterval) {
		clearInterval(timerInterval);
		timerInterval = null;
	}
}


// Geolocation with high accuracy enabled and projection set to match the map view
const geolocation = new Geolocation({
	trackingOptions: {
		enableHighAccuracy: true,
	},
	projection: view.getProjection(),
});

/**
 * Listen for position changes from the geolocation API
 */
geolocation.on('change:position', function () {
	if (!isTracking || isPaused) return;

	const coordinates = geolocation.getPosition();
	if (!coordinates) return;

	// Mobile devices may provide altitude data, but it's often inaccurate or unavailable, so we
	// should handle it gracefully if it's not provided. If it IS provided, we can check the accuracy
	// to decide whether to include it in the stored position data if it is wildly out. If  altitudeAccuracy
	// is not provided at all we counter-intuitively have to assume it IS accurate to within our threshold.
	const altitude = (((geolocation.getAltitudeAccuracy() || 0) < altitudeAccuracy) && geolocation.getAltitude()) || null;

	const [lon, lat] = toLonLat(coordinates);
	positions.push([lon, lat, altitude, new Date().getTime()]);
	positionFeature.setGeometry(new Point(coordinates));
	pathFeature.setGeometry(new LineString(positions.map(pos => fromLonLat(pos.slice(0,2)))));
	view.setCenter(coordinates);

	// Check for auto-pause
	if (lastPosition) {
		const dist = haversineDistance(lastPosition[1], lastPosition[0], lat, lon);
		if (dist >= autoPauseThreshold) { // More than autoPauseThreshold metres movement
			cancelAutoPauseTimer();
		} else if (!autoPauseTimer) {
			autoPauseTimer = setTimeout(() => {
				if (isTracking && !isPaused) {
					pauseRun();
				} else if (!isTracking) {
					cancelAutoPauseTimer();
				}
			}, 60_000); // 1 minute
		}
	}

	lastPosition = [lon, lat];
});


/**
 * Convert a sematic versioning string into an 32-bit integer.
 * 
 * Make sure the input string is compatible with the standard found
 * at semver.org. Since this only uses 10-bit per major/minor/patch version,
 * the highest possible SemVer string would be 1023.1023.1023.
 * @param  {string} version SemVer string
 * @return {number}         Numeric version
 */
function convertVersionToInt32(version) {
	// Split a given version string into three parts.
	let parts = version.split('.');

	// Check if we got exactly three parts, otherwise throw an error.
	if (parts.length !== 3) {
		throw new Error('Received invalid version string');
	}

	// Make sure that no part is larger than 1023 or else it
	// won't fit into a 32-bit integer.
	parts.forEach((part) => {
		if (part >= 1024) {
			throw new Error(`Version string invalid, ${part} is too large`);
		}
	});

	// Let's create a new number which we will return later on
	let numericVersion = 0;

	// Shift all parts either 0, 10 or 20 bits to the left.
	for (let i = 0; i < 3; i++) {
		numericVersion |= parts[i] << i * 10;
	}

	return numericVersion;
};


/**
 * Open (or create) the IndexedDB database and object store for runs
 * 
 * @returns {Promise<IDBDatabase>}
 */
async function openDB() {
	return new Promise((resolve, reject) => {
		// Read application version number from package.json and convert a sematic versioning string into an 32-bit integer.		
		const request = indexedDB.open('RunningManDB', convertVersionToInt32(packageJson.version));
		request.onerror = (event) => reject(event.target.error);

		request.onupgradeneeded = (event) => {
			const db = event.target.result;
			const transaction = event.target.transaction;

			const runsStore = db.objectStoreNames.contains('runs') ? transaction.objectStore('runs') : db.createObjectStore('runs', { keyPath: 'id', autoIncrement: true });

			if (!runsStore.indexNames.contains('date')) {
				runsStore.createIndex('date', 'date', { unique: false });
			}
		};

		request.onsuccess = (event) => resolve(event.target.result);
	});
}


/**
 * Save a run to IndexedDB, returning a promise that resolves to the ID of the saved run
 * 
 * @param {array<array<number>>} route 
 * @param {object} summary 
 * @returns 
 */
async function saveRun(route, summary) {
	const db = await openDB();

	return new Promise(async (resolve, reject) => {
		db.onerror = (event) => reject(event.target.error);

		// Store the route and summary data together, along with a default timestamp for
		// sorting if one isn't provided in the summary (the difference being startTime vs endTime,
		// but either works for sorting runs chronologically)
		const request = db.transaction(['runs'], 'readwrite')
			.objectStore('runs')
			.add({ date: new Date(), route: route, ...summary });

		request.onsuccess = (event) => resolve(event.target.result);
	});
}

/**
 * Get a run by ID from IndexedDB
 * 
 * @param {BigInteger} id 
 * @returns {Promise<Run>} 
 */
async function getRun(id) {
	const db = await openDB();

	return new Promise(async (resolve, reject) => {
		db.onerror = (event) => reject(event.target.error);

		const request = db.transaction(['runs'], 'readonly')
			.objectStore('runs')
			.get(id)

		request.onsuccess = (event) => resolve(event.target.result);
	});
}

/**
 * Delete a run by ID from IndexedDB
 * 
 * @param {BigInteger} id 
 * @returns {Promise<void>} resolves when the operation is complete
 */
async function deleteRun(id) {
	const db = await openDB();

	return new Promise((resolve, reject) => {
		db.onerror = (event) => reject(event.target.error);

		const request = db.transaction(['runs'], 'readwrite')
			.objectStore('runs')
			.delete(id);

		request.onsuccess = (event) => resolve(event.target.result);
	});
}

/**
 * Get all runs from IndexedDB, returning a promise that resolves to an array of run objects
 * 
 * @returns {Promise<array<Run>>} 
 */
async function getAllRuns() {
	const db = await openDB();

	return new Promise((resolve, reject) => {
		db.onerror = (event) => reject(event.target.error);

		const request = db.transaction(['runs'], 'readonly')
			.objectStore('runs')
			.getAll();

		request.onsuccess = (event) => resolve(event.target.result);
	});
}


/**
 * Get all runs from IndexedDB, sorted by date
 * 
 * @param {boolean} decending
 * @returns {Promise<array<Run>>}
 */
async function getAllRunsByDate(decending) {
	const db = await openDB();

	return new Promise((resolve, reject) => {
		db.onerror = (event) => reject(event.target.error);

		// Get all runs from the 'runs' object store using "date" index
		const request = db.transaction(['runs'])
			.objectStore('runs')
			.index('date')
			.getAll();

		request.onsuccess = (event) => {
			const runs = event.target.result;
			resolve(decending ? runs.reverse() : runs)
		};
	});
}


/**
 * Clear all runs from IndexedDB, returning a promise that resolves when the operation is complete
 * 
 * @returns {Promise<array<void>>} 
 */
async function deleteAllRuns() {
	const db = await openDB();

	return new Promise((resolve, reject) => {
		db.onerror = (event) => reject(event.target.error);

		const request = db.transaction(['runs'], 'readwrite')
			.objectStore('runs')
			.clear();

		request.onsuccess = (event) => resolve(event.target.result);
	});
}


function resetRun() {
	isPaused = false;
	startTime = null;
	pausedElapsed = 0;
	lastPauseStart = null;
	positions = [];
	lastPosition = null;

	cancelAutoPauseTimer();
	geolocation.setTracking(isTracking = false);
}


/**
 * Try to fade panels in and out gracefully so that the animation is seen before toggling the display to hide the element entirely.
 * @param {HTMLElement} element 
 * @param {string} display 
 * @returns 
 */
async function fadeInOut(element, display = "block") {
	const delay = 0.25; // Match the CSS transition duration
	element.style.transition = `opacity ${delay}s ease-in-out`;

	if (display === "none") {
		// Use a timeout to ensure the opacity change is applied before changing display, allowing the fade-out effect to occur
		return Promise.resolve().then(() => {
			element.style.opacity = 0;
		}).then(() => new Promise(resolve => { setTimeout(resolve, delay * 1000) }).then(() => {
			element.style.display = display;
		}));
	} else {
		// Ensure that display and opacity are applied seperately to trigger the fade-in transition
		// Return a promise that resolves after the fade-in transition is complete, allowing callers 
		// to wait for the animation to finish before proceeding
		return Promise.resolve().then(() => {
			element.style.display = display;
		}).then(() => {
			element.style.opacity = 1;

			return new Promise(resolve => { setTimeout(resolve, delay * 1000) });
		});
	}
}


async function resetUi() {
	await Promise.all([
		fadeInOut(startContainer, 'block'),
		fadeInOut(historyContainer, 'flex'),
		fadeInOut(timerContainer, 'none'),
		fadeInOut(actionContainer, 'none')
	]);

	pathFeature.setGeometry(null);
	positionFeature.setGeometry(null);

	cancelAutoPauseTimer();
	cancelTimerInterval();
}

async function startRun() {
	resetRun();

	startTime = Date.now();
	geolocation.setTracking(isTracking = true);

	await Promise.all([
		fadeInOut(startContainer, 'none'),
		fadeInOut(historyContainer, 'none'),
		fadeInOut(timerContainer, 'block'),
		fadeInOut(actionContainer, 'flex')
	]);

	timerInterval = setInterval(updateTimers, 1000);
}

async function pauseRun() {
	isPaused = true;
	lastPauseStart = Date.now();
	cancelAutoPauseTimer();
	await fadeInOut(pauseOverlay, 'block');
}

async function resumeRun() {
	isPaused = false;
	pausedElapsed += Date.now() - lastPauseStart;
	await fadeInOut(pauseOverlay, 'none');
}

/**
 * Show a confirmation dialog with the given message and return a promise that resolves to name of the button pressed: "Yes" or "No".
 * @param {string} messageHtml 
 * @returns {Promise<void>} Resolved promise when completed.
 */
async function confirmDialog(messageHtml = "<p>Are you sure?</p>") {
	return new Promise(resolve => {
		const stopDialog = document.createElement('dialog');
		stopDialog.addEventListener('close', () => { resolve(stopDialog.returnValue); stopDialog.remove() });

		const div = stopDialog.appendChild(document.createElement('div'));
		div.className = "message-content";
		div.innerHTML = messageHtml;

		const buttonGroup = stopDialog.appendChild(document.createElement('div'));
		buttonGroup.className = "dialog-controls";

		const onClick = function () {
			stopDialog.returnValue = this.textContent;
			stopDialog.close()
		}

		const confirmBtn = buttonGroup.appendChild(document.createElement('button'));
		confirmBtn.addEventListener('click', onClick);
		confirmBtn.className = "confirm-btn";
		confirmBtn.textContent = "Yes";

		const cancelBtn = buttonGroup.appendChild(document.createElement('button'));
		cancelBtn.addEventListener('click', onClick);
		cancelBtn.className = "cancel-btn";
		cancelBtn.textContent = "No";

		stopDialog.returnValue = ""; // Default to empty string if dialog is closed without clicking a button
		document.body.appendChild(stopDialog).showModal();
	});
}

/**
 * Show a message dialog with the given HTML content and an optional postProcess function to run after the
 * dialog is rendered (e.g. to add event listeners to dynamically generated content). Returns a promise
 * that resolves when the dialog is closed.
 * 
 * @param {string} messageHtml 
 * @param {function} postProcess 
 * @returns {Promise<void>} Resolved promise when completed.
 */
async function showMessageDialog(messageHtml, postProcess) {
	return new Promise((resolve) => {
		const messageDialog = document.createElement("dialog");
		messageDialog.addEventListener('close', () => { resolve(messageDialog.returnValue); messageDialog.remove() });

		if (messageHtml) {
			const div = messageDialog.appendChild(document.createElement("div"));
			div.className = "message-content";
			div.innerHTML = messageHtml;
		}

		const buttonGroup = messageDialog.appendChild(document.createElement('div'));
		buttonGroup.className = "dialog-controls";

		const onClick = function () {
			messageDialog.returnValue = this.textContent;
			messageDialog.close()
		}

		const closeBtn = buttonGroup.appendChild(document.createElement('button'));
		closeBtn.addEventListener('click', onClick);
		closeBtn.className = "close-btn";
		closeBtn.textContent = "Close";

		// Run any additional setup after the dialog is rendered, such as adding event listeners to dynamically generated content
		if (typeof postProcess === "function") {
			postProcess(messageDialog);
		}

		messageDialog.returnValue = ""; // Default to empty string if dialog is closed without clicking the button
		document.body.appendChild(messageDialog).showModal();
	});
}


/**
 * Build summary from passed in copy of state variables (startTime, pausedElapsed, route) and calculate metrics. 
 * 
 * 
 * @param {number} startTime - Timestamp of when the run started
 * @param {number} pausedElapsed - Total elapsed time spent paused during the run (in milliseconds)
 * @param {Array} route - Array of position data points
 * @returns {object} Summary of run: total time, distance, average pace/speed, and altitude stats (min/max/gain). Suitable for use by the summary dialog and/or stored in the database.
 */
function captureSummary(startTime, pausedElapsed, route = []) {
	// Times are calcuated in milliseconds, convert to seconds for display and storage
	const endTime = Date.now();
	const totalElapsed = endTime - startTime;
	const activeElapsed = totalElapsed - pausedElapsed;
	const distance = calculateTotalDistance();

	// Extract altitude data points from the positions array, filtering out any null values which represent invalid or unavailable altitude
	// readings that would otherwise skew the results.
	const altitudeDataPoints = route.map(pos => pos[2]).filter(val => val !== null);

	// Calculate altitude gain by iterating through the altitude data points and summing up all positive differences between consecutive
	// points. If there are less than 2 valid altitude points, set gain to null since it can't be calculated.
	const altitudeGain = altitudeDataPoints.length > 1 ? altitudeDataPoints.reduce((gain, alt, idx, arr) => {
			if (idx === 0) return gain;

			const diff = alt - arr[idx - 1];
			return gain + (diff > 0 ? diff : 0);
		}, 0) : null;	
	
	// Sort altitude data points to easily get min and max values, ignoring nulls since we filtered them out above
	altitudeDataPoints.sort((a, b) => a - b);

	const altitudeStats = {
		min: altitudeDataPoints[0] || null,
		max: altitudeDataPoints[altitudeDataPoints.length - 1] || null,
		gain: altitudeGain
	};

	return {
		date: new Date(startTime), // Store the start time as the date of the run
		totalElapsed: totalElapsed / 1000, // seconds
		pausedElapsed: pausedElapsed / 1000, // seconds
		activeElapsed: activeElapsed / 1000, // seconds
		distance: distance, // metres
		avgSpeed: distance > 0 ? ((distance / 1000) / (activeElapsed / 3_600_000)) : 0, // km/h
		avgPace: distance > 0 ? (activeElapsed / 60000) / (distance / 1000) : 0, // min/km
		altitudeStats: altitudeStats
	};
}

/**
 * Save run to DB and display summary
 * @returns 
 */
async function stopRun() {
	if ("Yes" !== await confirmDialog("<p>Are you sure you want to stop the run?</p>")) {
		return;
	}

	const route = positions;
	const summary = captureSummary(startTime, pausedElapsed, route);

	resetRun();
	updateTimers();
	cancelTimerInterval();

	// Save the run data and show the summary dialog in parallel, waiting for both to complete before resetting the UI
	await Promise.all([
		saveRun(route, summary),
		showMessageDialog(`<table>
<tr><th>Date</th><td>${new Date().toLocaleString()}</td></tr>
<tr><th>Total Time</th><td>${formatTime(Math.round(summary.totalElapsed))}</td></tr>
<tr><th>Paused Time</th><td>${formatTime(Math.round(summary.pausedElapsed))}</td></tr>
<tr><th>Active Time</th><td>${formatTime(Math.round(summary.activeElapsed))}</td></tr>
<tr><th>Distance (km)</th><td>${(summary.distance / 1000).toFixed(3)}</td></tr>
<tr><th>Avg pace (min/km)</th><td>${summary.avgPace ? summary.avgPace.toFixed(2) : 'N/A'}</td></tr>
<tr><th>Avg speed (km/h)</th><td>${summary.avgSpeed ? summary.avgSpeed.toFixed(2) : 'N/A'}</td></tr>
<tr><th>Altitude Stats</th><td>Min: ${typeof summary.altitudeStats?.min === 'number' ? summary.altitudeStats.min.toFixed(2) : 'N/A'}
	<br />Max: ${typeof summary.altitudeStats?.max === 'number' ? summary.altitudeStats.max.toFixed(2) : 'N/A'}
	<br />Gain: ${typeof summary.altitudeStats?.gain === 'number' ? summary.altitudeStats.gain.toFixed(2) : 'N/A'}
</td></tr>
</table>`)
	]);

	resetUi();
}


/**
 * Save passed run as a kml/kmz file to download so user can choose to open in Google Earth or whatver they want.
 * @param {Run} data 
 */
async function saveRunFile(data) {
	const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
	<name>Route ${data.date}</name>
	<Placemark>
		<LineString>
			<coordinates>
				${data.route.map(pos => `${pos[0]},${pos[1]},0`).join(' ')}
			</coordinates>
		</LineString>
	</Placemark>
</Document>
</kml>`;

	const filename = `RunningMan.${new Date(data.date).toISOString().replace(/(\/|:|,)/g, '')}`;
	const kmlBlob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' });

	// Convert to kmz (zip file containing the kml) 
	const zip = new JSZip();
	zip.file(filename + ".kml", kmlBlob);
	const kmzBlob = await zip.generateAsync({ type: 'blob' });

	saveAs(kmzBlob, filename + ".kmz");
}

/**
 * Show history of runs stored in DB display ordered by date. Optionally descending.
 * 
 * @param {boolean} descending 
 */
async function showHistory(descending) {
	// Get all runs and sort runs by date, most recent first
	const allRuns = (await getAllRunsByDate(descending));
	//allRuns.sort((a, b) => new Date(b.date) - new Date(a.date)); // Not need, index sorts it.

	// Generated HTML table of runs. 
	// The naming of totalTime/pausedTime/activeTime have been renamed to totalElapsed/pausedElapsed/activeElapsed
	// to better reflect their purpose (as measures of elapsed time as opposed to an instant), but we should support both in case of 
	// older runs that were stored with the previous naming convention.
	const messageHtml = allRuns.length > 0
		? `<table>
<thead>
	<tr>
		<th>Date</th>
		<th>Total Time</th>
		<th>Paused Time</th>
		<th>Active Time</th>
		<th>Distance (km)</th>
		<th>Avg Pace (min/km)</th>
		<th>Avg Speed (km/h)</th>
		<th>Alt min/max/gain (m)</th>
		<!-- <th>View</th> -->
		<th>Download</th>
		<th>Remove</th>
	</tr>
</thead>
<tbody>
	${allRuns.filter(run => !!run.route?.length).map(run => `
		<tr>
			<td>${new Date(run.date).toLocaleString()}</td>
			<td>${formatTime(Math.round(run.totalElapsed || run.totalTime))}</td>
			<td>${formatTime(Math.round(run.pausedElapsed || run.pausedTime))}</td>
			<td>${formatTime(Math.round(run.activeElapsed || run.activeTime))}</td>
			<td>${run.distance ? (run.distance / 1000).toFixed(2) : 'N/A'}</td>
			<td>${run.avgPace ? run.avgPace.toFixed(2) : 'N/A'}</td>
			<td>${run.avgSpeed ? run.avgSpeed.toFixed(2) : 'N/A'}</td>
			<td>${typeof run.altitudeStats?.min === 'number' ? run.altitudeStats.min.toFixed(2) : 'N/A'}, ${typeof run.altitudeStats?.max === 'number' ? run.altitudeStats.max.toFixed(2) : 'N/A'}, ${typeof run.altitudeStats?.gain === 'number' ? run.altitudeStats.gain.toFixed(2) : 'N/A'}</td>
			<!-- <td><button class="view-route" data-id='${JSON.stringify(run.id)}'>👁️</button></td> -->
			<td><button class="save-route" data-id='${JSON.stringify(run.id)}'>💾</button></td>
			<td><button class="remove-run" data-id='${JSON.stringify(run.id)}'>🗑️</button></td>
		</tr>
	`).join('')}
</tbody>
</table>`
		: "<p>No runs recorded yet.</p>";

	// Add event listeners for "View Route" buttons after the dialog is rendered
	const postProcess = (dialog) => {

		// dialog.querySelectorAll('.view-route').forEach(button => {
		// 	button.addEventListener('click', async () => {
		// 		const id = JSON.parse(button.getAttribute('data-id')),
		// 			data = await getRun(id);

		// 		//Render the route on the map and zoom to fit the route (ignore altitude and timestamp).
		// 		pathFeature.setGeometry(new LineString(data.route.map(pos => fromLonLat(pos.slice(0, 2)))));
		// 		view.fit(pathFeature.getGeometry(), { padding: [50, 50, 50, 50] });

		// 		// Close the dialog to reveal the map with the selected route
		// 		dialog.close();
		// 	});
		// });

		dialog.querySelectorAll('.save-route').forEach(button => {
			button.addEventListener('click', async () => {
				const id = JSON.parse(button.getAttribute('data-id')),
					data = await getRun(id);

				// Generate and trigger download of the run data as a kml/kmz file
				saveRunFile(data);
			});
		});

		dialog.querySelectorAll('.remove-run').forEach(button => {
			button.addEventListener('click', async () => {
				const id = JSON.parse(button.getAttribute('data-id')),
					data = await getRun(id);

				if ("Yes" !== await confirmDialog(`<p>Are you sure you want to delete the run from <strong>${new Date(data.date).toLocaleString()}</strong>?</p>`)) {
					return;
				}

				await deleteRun(id);

				// Start with the button element and traverse up the DOM tree until we find the <tr> ancestor
				// Remove it from the table to immediately reflect the deletion in the UI without needing to refresh the entire history dialog
				let tr = null;
				for (let node = button; node && !tr; node = node.parentElement) {
					if (node.tagName === "TR") {
						tr = node;
						break;
					}
				}

				if (tr) {
					tr.remove()
				}
			});
		});
	};

	showMessageDialog(messageHtml, postProcess);
};

async function clearHistory() {
	if ("Yes" !== await confirmDialog("<p>Are you sure you want to clear all run history? This action cannot be undone.</p>")) {
		return;
	}

	deleteAllRuns();
}

// Event listeners for control buttons
el("start").addEventListener('click', function () {
	if (!isTracking) {
		startRun();
	}
});


el("history").addEventListener('click', function () {
	showHistory(true);
});

el("clear-history").addEventListener('click', function () {
	clearHistory();
});


el("pause").addEventListener('click', function () {
	pauseRun();
});

el("stop").addEventListener('click', function () {
	stopRun();
});


el("resume").addEventListener('click', function () {
	resumeRun();
});


// Register service worker for offline support
if ('serviceWorker' in navigator) {
	navigator.serviceWorker.register('sw.js').then((registration) => {
		console.log('Service Worker registered:', registration);
	}).catch((error) => {
		console.log('Service Worker registration failed:', error);
	});
}

// Register the shortcut for starting a run when the app is launched with ?start=true
if (!isTracking && new URLSearchParams(location.search).get("start") === "true") {
	startRun();
}