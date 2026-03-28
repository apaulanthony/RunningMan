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
let lastPositionTime = null;
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
const durationTimer = el("duration-timer");
const pauseTimer = el("pause-timer");
const pauseOverlay = el("pause-overlay");

const startButton = el("start");
const stopButton = el("stop");
const pauseButton = el("pause");

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
  durationTimer.textContent = formatTime(activeTime);
  if (isPaused) {
    const pauseElapsed = Math.floor((now - lastPauseStart) / 1000);
    pauseTimer.textContent = `Pause: ${formatTime(pauseElapsed)}`;
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

function openDB() {
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

function saveRun(route, summary) {
  openDB().then(db => {
    const transaction = db.transaction(['runs'], 'readwrite');
    const store = transaction.objectStore('runs');
    store.add({ route, ...summary, date: new Date() });
  });
}

geolocation.on('change:position', function () {
  if (!isTracking || isPaused) return;
  const coordinates = geolocation.getPosition();
  if (coordinates) {
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
            if (!isPaused) {
              pauseRun();
            }
          }, 60000); // 1 minute
        }
      } else {
        if (autoPauseTimer) {
          clearTimeout(autoPauseTimer);
          autoPauseTimer = null;
        }
      }
    }
    lastPosition = [lon, lat];
    lastPositionTime = Date.now();
  }
});


startButton.addEventListener('click', function () {
  if (!isTracking) {
    startRun();
  }
});

stopButton.addEventListener('click', function () {
  stopRun();
});

pauseButton.addEventListener('click', function () {
  if (isPaused) {
    resumeRun();
  } else {
    pauseRun();
  }
});


function startRun() {
  isTracking = true;
  isPaused = false;
  startTime = Date.now();
  pausedTime = 0;
  positions = [];
  lastPosition = null;
  lastPositionTime = null;
  geolocation.setTracking(true);
  startButton.style.display = 'none';
  pauseButton.style.display = 'inline-block';
  stopButton.style.display = 'inline-block';
  pauseButton.textContent = 'PAUSE';
  timerContainer.style.display = 'block';
  pauseTimer.style.display = 'none';
  pauseOverlay.style.display = 'none';
  timerInterval = setInterval(updateTimers, 1000);
}

function pauseRun() {
  isPaused = true;
  lastPauseStart = Date.now();
  geolocation.setTracking(false);
  pauseButton.textContent = 'RESUME';
  pauseOverlay.style.display = 'block';
  pauseTimer.style.display = 'block';
  if (autoPauseTimer) {
    clearTimeout(autoPauseTimer);
    autoPauseTimer = null;
  }
}

function resumeRun() {
  isPaused = false;
  pausedTime += Date.now() - lastPauseStart;
  geolocation.setTracking(true);
  pauseButton.textContent = 'PAUSE';
  pauseOverlay.style.display = 'none';
  pauseTimer.style.display = 'none';
}

function stopRun() {
  isTracking = false;
  isPaused = false;
  geolocation.setTracking(false);
  const endTime = Date.now();
  const totalTime = endTime - startTime;
  const activeTime = totalTime - pausedTime;
  const distance = calculateTotalDistance();
  const avgSpeed = distance > 0 ? (activeTime / 1000) / (distance / 1000) : 0; // km/h
  saveRun(positions, {
    totalTime: totalTime / 1000, // seconds
    pausedTime: pausedTime / 1000,
    distance,
    avgSpeed
  });

  // Reset UI
  startButton.style.display = 'block';
  pauseButton.style.display = 'none';
  stopButton.style.display = 'none';
  timerContainer.style.display = 'none';
  pauseTimer.style.display = 'none';
  pauseOverlay.style.display = 'none';
  pathFeature.setGeometry(null);
  positionFeature.setGeometry(null);

  if (autoPauseTimer) {
    clearTimeout(autoPauseTimer);
    autoPauseTimer = null;
  }

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}