/**
 * App.js
 * Responsibility: Orchestrates the application flow.
 */
import { LocationService } from './LocationService.js';
import { StorageService } from './StorageService.js';
import { UIController } from './UIController.js';
import { TrackerEngine } from './TrackerEngine.js';
import { ExportService } from './ExportService.js';

class App {
    constructor() {
        this.ui = new UIController();
        this.storage = new StorageService();
        this.tracker = new LocationService();
        this.engine = new TrackerEngine();
        this.export = new ExportService();

        this.watchdogTimer = null;
        this.currentRun = null;
    }

    async init() {
        // The Mediator: Connects the service to the UI
        this.ui.onStartRun = () => this.startNewRun();
        this.ui.onStopRun = () => this.stopCurrentRun();
        this.ui.onPauseRun = () => this.pauseRun();
        this.ui.onResumeRun = () => this.resumeRun();
        this.ui.onShowHistory = () => this.showHistory();
        this.ui.onClearHistory = () => this.clearHistory();
        this.ui.exportRun = id => this.exportRun(id);
        this.ui.deleteRun = id => this.deleteRun(id);

        // The Mediator: Connects the GPS updates to the Logic and UI
        this.tracker.subscribe(this.updateCurrentPosition.bind(this));

        // Register service worker for offline support
        try {
            const registration = navigator?.serviceWorker?.register?.('sw.js');
            if (registration) {
                console.log('Service Worker registered:', registration);
            } else {
                throw new Error('Service Worker registration failed');
            }
        } catch (error) {
            console.log('Service Worker registration failed:', error);
        }

        // Register the shortcut for starting a run when the app is launched with ?start=true
        if (location?.search && new URLSearchParams(location.search).get("start") === "true") {
            this.startNewRun();
        }
    }


    _startRunTimer(timeout = 1000) {
        const app = this;

        (function render() {
            app.ui.updateTimerDisplays(app.currentRun);
            app.animationFrameId = requestAnimationFrame(render);
        })();

        return setInterval(() => {
            app.currentRun = app.engine.updateSession(app.currentRun);
        }, timeout);        
    }

    async startNewRun() {    
        // SAFETY: If a run is already in progress, stop it first to reset the tracker state
        if (this.currentRun) {
            this._trackerStop();
            this.currentRun = null;
        }

        const now = Date.now();
        this.currentRun = this.engine.updateSession({ date: now, route: [], lastMovementTimestamp: now});
        this.tracker.start();
        this.ui.setRunningState(true);

        // Start the "Stationary Watchdog" timer
        this._startStationaryWatchdog();        
    }


    /**
     * The Watchdog: Periodically checks if the current time 
     * has significantly diverged from the last movement timestamp.
     */
    _startStationaryWatchdog() {
        // Clear any existing watchdog to prevent multiple timers running
        if (this.watchdogTimer) clearInterval(this.watchdogTimer);

        this.watchdogTimer = setInterval(() => {
            if (!this.currentRun || this.currentRun.paused) return;

            const timeSinceMovement = Date.now() - this.currentRun.lastMovementTimestamp;
            
            // If no movement seen for > 60 seconds, pause the run
            if (timeSinceMovement > 60_000) {
                console.log("Stationary detected via watchdog");
                this.pauseRun();
            }
        }, 5000); // Check every 5 seconds
    }
        

    updateCurrentPosition(coords) {
        const previousDistance = this.currentRun?.distance || 0;
        this.currentRun = this.engine.updateSession(this.currentRun, coords);

        const currentDistance = this.currentRun?.distance || 0;
        const distanceMoved = currentDistance - previousDistance;

        // If movement is significant, update the timestamp
        if (distanceMoved > 0.005) {
            this.currentRun.lastMovementTimestamp = Date.now();
        }

        this.ui.updateMapPositions(this.currentRun?.route);
        this.ui.updateTimerDisplays(this.currentRun);
    }


    _startPauseTimer(timeout = 1000) {
        const app = this;

        (function render() {
            app.ui.updateTimerDisplays(app.currentRun);
            app.animationFrameId = requestAnimationFrame(render);
        })();

        let startTime = Date.now();

        return setInterval(() => {
            const now = Date.now();
            const elapsed = Math.floor((now - startTime) / 1000) // Calc actual time between interval (in seconds)
            startTime = now;

            app.currentRun.pausedElapsed += elapsed;
            app.currentRun = app.engine.updateSession(app.currentRun);            
        }, timeout);
    }

    pauseRun() {
        clearInterval(this.watchdogTimer)
        this.watchdogTimer = null;

        clearInterval(this.currentRun.timer);
        cancelAnimationFrame(this.animationFrameId);
        
        this.currentRun.pausedElapsed = this.currentRun.pausedElapsed || 0; // Ensure pausedElapsed is initialised
        this.currentRun.paused = true;
        this.currentRun.timer = this._startPauseTimer();    

        this.currentRun = this.engine.updateSession(this.currentRun); 
        this.ui.setPauseState(this.currentRun.paused);
    }

    resumeRun() {
        clearInterval(this.currentRun.timer);
        cancelAnimationFrame(this.animationFrameId);

        this.currentRun.paused = false;
        this.currentRun.timer = this._startRunTimer();
        this.currentRun = this.engine.updateSession(this.currentRun);        
        this.ui.setPauseState(this.currentRun.paused);
    }


    /**
     * Clean-up the tracker and clear all timers.
     */
    _trackerStop() {
        this.tracker.stop();
        
        clearInterval(this.watchdogTimer);
        this.watchdogTimer = null;

        clearInterval(this.currentRun.timer);  
        this.currentRun.timer = null;
        
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }

    async stopCurrentRun() {
        if ("Yes" !== await this.ui.confirmDialog("<p>Are you sure you want to stop the run?</p>")) {
            return;
        }

        this._trackerStop();

        this.currentRun.finised = new Date();
        const currentRun = this.engine.updateSession(this.currentRun);

        this.ui.setRunningState(!this.currentRun.finised);

        this.currentRun = null;
        this.storage.saveRun(currentRun);

        this.ui.showRunDetailsDialog(currentRun);
    }

    async showHistory() {
        return this.ui.showRunHistoryDialog(await this.storage.getAllRuns());
    }

    async clearHistory() {
        const response = await Promise.resolve(this.ui.confirmDialog("<p>Are you sure you want to clear all run history? This action cannot be undone.</p>"));
        if (response !== "Yes") { throw new Error("Delete all cancelled"); }
        return this.storage.deleteAllRuns();
    }

    /**
     * 
     * @param {*} id 
     * @returns 
     */
    async exportRun (id) {
        const data = await this.storage.getRun(id);
        return this.export.saveRunToFile(data);      
    }

    async deleteRun (id) {
        const data = await Promise.resolve(this.storage.getRun(id));
        const response = await this.ui.confirmDialog(`<p>Are you sure you want to delete the run from <strong>${new Date(data.date).toLocaleString()}</strong>?</p>`);
        if (response !== "Yes") { throw new Error("Delete cancelled"); }
        return this.storage.deleteRun(id);
    }
}

const runningMan = new App();
runningMan.init();