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

// Initialize the map view centered at (0, 0) with a zoom level of 15
const view = new View({
	center: fromLonLat([0, 0]),
	zoom: 15,
});

// Try to get user's location immediately to center the map, but allow it to update when geolocation tracking starts
navigator?.geolocation?.getCurrentPosition?.((position) => {
	view.setCenter(fromLonLat([position.coords.longitude, position.coords.latitude]));
});

// Create the map with a base OSM layer and the defined view
const map = new Map({
	layers: [
		new TileLayer({
			source: new OSM(),
		})
	],
	target: 'map',
	view: view,
});

// Geolocation with high accuracy enabled and projection set to match the map view
const geolocation = new Geolocation({
	trackingOptions: {
		enableHighAccuracy: true,
	},
	projection: view.getProjection(),
});

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

// Vector source and layer to hold the position and path features
const vectorSource = new VectorSource({
	features: [positionFeature, pathFeature],
});

// Add the vector layer to the map
new VectorLayer({
	map: map,
	source: vectorSource,
});

// State variables to track the run status, timing, and positions
let isTracking = false;
let isPaused = false;

let startTime = null;
let pausedTime = 0;
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
	const activeTime = totalElapsed - Math.floor(pausedTime / 1000);

	el("duration-timer").textContent = formatTime(activeTime);

	if (isPaused) {
		const pauseElapsed = Math.floor((now - lastPauseStart) / 1000);
		el("pause-timer").textContent = `Paused: ${formatTime(pauseElapsed)}`;
	}
}

// Haversine formula to calculate distance between two lat/lon points in metres https://en.wikipedia.org/wiki/Haversine_formula
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

async function openDB() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('RunningManDB', 1);
		request.onupgradeneeded = (event) => {
			const db = event.target.result;
			if (!db.objectStoreNames.contains('runs')) {
				db.createObjectStore('runs', { keyPath: 'id', autoIncrement: true });
			}
		};
		request.onsuccess = (event) => resolve(event.target.result);
		request.onerror = (event) => reject(event.target.error);
	});
}

async function saveRun(route, summary) {
	return openDB().then(db => {
		const transaction = db.transaction(['runs'], 'readwrite');
		const store = transaction.objectStore('runs');
		store.add({ route, ...summary, date: new Date() });
	});
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

// Listen for position changes from the geolocation API
geolocation.on('change:position', function () {
	if (!isTracking || isPaused) return;

	const coordinates = geolocation.getPosition();
	if (!coordinates) return;

	const [lon, lat] = toLonLat(coordinates);
	positions.push([lon, lat]);
	positionFeature.setGeometry(new Point(coordinates));
	pathFeature.setGeometry(new LineString(positions.map(pos => fromLonLat(pos))));
	view.setCenter(coordinates);

	// Check for auto-pause
	if (lastPosition) {
		const dist = haversineDistance(lastPosition[1], lastPosition[0], lat, lon);
		if (dist >= 5) { // More than 5m movement
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


function resetRun() {
	isPaused = false;
	startTime = null;
	pausedTime = 0;
	lastPauseStart = null;
	positions = [];
	lastPosition = null;

	cancelAutoPauseTimer();
	geolocation.setTracking(isTracking = false);
}

function resetUi() {
	startContainer.style.display = 'block';
	timerContainer.style.display = 'none';
	actionContainer.style.display = 'none';

	pathFeature.setGeometry(null);
	positionFeature.setGeometry(null);

	cancelAutoPauseTimer();
	cancelTimerInterval();
}

function startRun() {
	resetRun();

	startTime = Date.now();
	geolocation.setTracking(isTracking = true);

	startContainer.style.display = 'none';
	timerContainer.style.display = 'block';
	actionContainer.style.display = 'flex';

	timerInterval = setInterval(updateTimers, 1000);
}

function pauseRun() {
	isPaused = true;
	lastPauseStart = Date.now();
	pauseOverlay.style.display = 'block';
	cancelAutoPauseTimer();
}

function resumeRun() {
	isPaused = false;
	pausedTime += Date.now() - lastPauseStart;
	pauseOverlay.style.display = 'none';
}

// Show a confirmation dialog with the given message and return a promise that resolves to name of the button pressed: "Yes" or "No".
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

// Show a message dialog with the given HTML content and an optional postProcess function to run after the dialog is rendered (e.g. to add event listeners to dynamically generated content). Returns a promise that resolves when the dialog is closed.
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

async function stopRun() {
	if ("Yes" !== await confirmDialog("<p>Are you sure you want to stop the run?</p>")) {
		return;
	}

	// Times are calcuated in milliseconds, convert to seconds for display and storage
	const endTime = Date.now();
	const totalTime = endTime - startTime;
	const activeTime = totalTime - pausedTime;
	const distance = calculateTotalDistance();
	const route = positions;

	resetRun()

	const summary = {
		totalTime: totalTime / 1000, // seconds
		pausedTime: pausedTime / 1000, // seconds
		activeTime: activeTime / 1000, // seconds
		distance: distance, // metres
		avgSpeed: distance > 0 ? ((distance / 1000) / (activeTime / 3_600_000)) : 0, // km/h
		avgPace: distance > 0 ? (activeTime / 60000) / (distance / 1000) : 0 // min/km
	};

	await Promise.all([
		saveRun(route, summary),
		showMessageDialog(`<table>
	<tr><th>Date</th><td>${new Date().toLocaleString()}</td></tr>
	<tr><th>Total Time</th><td>${formatTime(Math.round(summary.totalTime))}</td></tr>
	<tr><th>Paused Time</th><td>${formatTime(Math.round(summary.pausedTime))}</td></tr>
	<tr><th>Active Time</th><td>${formatTime(Math.round(summary.activeTime))}</td></tr>
	<tr><th>Distance (km)</th><td>${(summary.distance / 1000).toFixed(3)}</td></tr>
	<tr><th>Avg pace (min/km)</th><td>${summary.avgPace ? summary.avgPace.toFixed(2) : 'N/A'}</td></tr>
	<tr><th>Avg speed (km/h)</th><td>${summary.avgSpeed ? summary.avgSpeed.toFixed(2) : 'N/A'}</td></tr>
</table>`)
	]);

	resetUi();
}



async function getAllRuns() {
	return openDB().then(db => {
		const transaction = db.transaction(['runs'], 'readonly');
		return transaction.objectStore('runs');
	}).then(store => new Promise((resolve, reject) => {
		const request = store.getAll();
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	}));
}

// Save passed run as a kml/kmz file to download so user can choose to open in Google Earth or whatver they want.
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

	const filename = `RunningMan.${data.date.replace(/(\/|:|,)/g, '')}`;
	const kmlBlob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' });

	// Convert to kmz (zip file containing the kml) 
	const zip = new JSZip();
	zip.file(filename + ".kml", kmlBlob);
	const kmzBlob = await zip.generateAsync({ type: 'blob' });

	saveAs(kmzBlob, filename + ".kmz");	
}

async function showHistory() {
	// Get all runs and sort runs by date, most recent first
	const allRuns = (await getAllRuns()).filter(run => !!run.route?.length);
	allRuns.sort((a, b) => new Date(b.date) - new Date(a.date));

	// Generated HTML table of runs
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
			<th>Download</th>
		</tr>
	</thead>
	<tbody>
		${allRuns.map(run => `
			<tr>
				<td>${new Date(run.date).toLocaleString()}</td>
				<td>${formatTime(Math.round(run.totalTime))}</td>
				<td>${formatTime(Math.round(run.pausedTime))}</td>
				<td>${formatTime(Math.round(run.activeTime))}</td>
				<td>${run.distance ? (run.distance / 1000).toFixed(2) : 'N/A'}</td>
				<td>${run.avgPace ? run.avgPace.toFixed(2) : 'N/A'}</td>
				<td>${run.avgSpeed ? run.avgSpeed.toFixed(2) : 'N/A'}</td>
				<td><button class="view-route" data-route='${JSON.stringify({ route: run.route, date: run.date })}'>💾</button></td>
			</tr>
		`).join('')}
	</tbody>
</table>`
		: "<p>No runs recorded yet.</p>";

	// Add event listeners for "View Route" buttons after the dialog is rendered
	const postProcess = (dialog) => {
		dialog.querySelectorAll('.view-route').forEach(button => {
			button.addEventListener('click', () => {
				const data = JSON.parse(button.getAttribute('data-route'));

				// Nice to plot the route but can't see under the dialog to the map
				// pathFeature.setGeometry(new LineString(route.map(pos => fromLonLat(pos))));
				// view.fit(pathFeature.getGeometry(), { padding: [50, 50, 50, 50] });

				// Instead, generate a kml/kmz file to download so user can choose to open in Google Earth or whatver they want.
				saveRunFile(data);
			});
		});
	};

	showMessageDialog(messageHtml, postProcess);
};


async function clearAllRuns() {
	return openDB().then(db => {
		const transaction = db.transaction(['runs'], 'readwrite');
		return transaction.objectStore('runs');
	}).then(store => new Promise((resolve, reject) => {
		const request = store.clear();
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	}));
}

async function clearHistory() {
	if ("Yes" !== await confirmDialog("<p>Are you sure you want to clear all run history? This action cannot be undone.</p>")) {
		return;
	}

	await clearAllRuns();
}

// Event listeners for control buttons
el("start").addEventListener('click', function () {
	if (!isTracking) {
		startRun();
	}
});


el("history").addEventListener('click', function () {
	showHistory();
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