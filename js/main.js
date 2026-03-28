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

const view = new View({
	center: fromLonLat([0, 0]),
	zoom: 15,
});

const map = new Map({
	layers: [
		new TileLayer({
			source: new OSM(),
		}),
	],
	target: 'map',
	view: view,
});

const geolocation = new Geolocation({
	trackingOptions: {
		enableHighAccuracy: true,
	},
	projection: view.getProjection(),
});

let isTracking = false;
let isPaused = false;

let startTime = null;
let pausedTime = 0;
let lastPauseStart = null;
let positions = [];
let lastPosition = null;

let autoPauseTimer = null;
let timerInterval = null;

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

const vectorSource = new VectorSource({
	features: [positionFeature, pathFeature],
});

new VectorLayer({
	map: map,
	source: vectorSource,
});

function el(id) {
	return document.getElementById(id);
}

const timerContainer = el("timers");
const startContainer = el("start-container");
const buttonContainer = el("button-container");
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

function haversineDistance(lat1, lon1, lat2, lon2) {
	const R = 6371; // Radius of the Earth in km
	const dLat = (lat2 - lat1) * Math.PI / 180;
	const dLon = (lon2 - lon1) * Math.PI / 180;
	const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
		Math.sin(dLon / 2) * Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c * 1000; // in meters
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
		if (dist < 5) { // less than 5m movement
			if (!autoPauseTimer) {
				autoPauseTimer = setTimeout(() => {
					if (isTracking && !isPaused) {
						pauseRun();
					} else if (!isTracking) {
						cancelAutoPauseTimer();
					}
				}, 60000); // 1 minute
			}
		} else {
			cancelAutoPauseTimer();
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
	buttonContainer.style.display = 'none';

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
	buttonContainer.style.display = 'flex';

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

async function confirmStop() {
	return new Promise((resolve) => {
		const stopDialog = el("stop-dialog");
		const stopConfirm = el("stop-confirm");
		const stopCancel = el("stop-cancel");

		stopDialog.showModal();

		const clean = () => {
			stopConfirm.removeEventListener('click', onConfirm);
			stopCancel.removeEventListener('click', onCancel);
		};

		const onConfirm = () => {
			clean();
			stopDialog.close();
			resolve(true);
		}

		const onCancel = () => {
			clean();
			stopDialog.close();
			resolve(false);
		}

		stopConfirm.addEventListener('click', onConfirm);
		stopCancel.addEventListener('click', onCancel);
	});
}

async function showSummary(summary) {
	return new Promise((resolve) => {
		const summaryDialog = el("summary-dialog");
		const summaryContent = el("summary-content");
		const summaryClose = el("summary-close");

		summaryContent.textContent = `Total time: ${formatTime(Math.round(summary.totalTime))} (hh:mm:ss count not exact)
			Paused time: ${formatTime(Math.round(summary.pausedTime))}
			Active time: ${formatTime(Math.round(summary.activeTime))}
			Distance: ${(summary.distance / 1000).toFixed(2)} km
			Avg speed: ${summary.avgSpeed.toFixed(2)} km/h
			Avg pace: ${summary.avgPace.toFixed(2)} min/km`;

		summaryDialog.showModal();

		const clean = () => {
			summaryClose.removeEventListener('click', onClose);
		};

		const onClose = () => {
			clean();
			summaryDialog.close();
			resolve();
		}
			
		summaryClose.addEventListener('click', onClose);		
	});
}

async function stopRun() {
	if (!await confirmStop()) {
		return;
	}

	const endTime = Date.now();
	const totalTime = endTime - startTime;
	const activeTime = totalTime - pausedTime;
	const distance = calculateTotalDistance();
	const avgSpeed = distance > 0 ? ((distance / 1000) / (activeTime / 3600000)) : 0; // km/h
	const summary = {
		totalTime: totalTime / 1000, // seconds
		pausedTime: pausedTime / 1000,
		activeTime: activeTime / 1000,
		distance: distance,
		avgSpeed: avgSpeed,
		avgPace: distance > 0 ? (activeTime / 60000) / (distance / 1000) : 0 // min/km
	};

	await Promise.all([
		saveRun(positions, summary).then(() => resetRun()),
		showSummary(summary)
	]);

	resetUi();
}


el("start").addEventListener('click', function () {
	if (!isTracking) {
		startRun();
	}
});

el("stop").addEventListener('click', function () {
	stopRun();
});

el("pause").addEventListener('click', function () {
	pauseRun();
});

el("resume").addEventListener('click', function () {
	resumeRun();
});