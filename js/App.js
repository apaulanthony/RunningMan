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

        this.movementThreadhold = 0.005; // 5m
        this.movementGracePeriod = 60_000; // 60s
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


    async startNewRun() {    
        // SAFETY: If a run is already in progress, stop it first to reset the tracker state
        if (this.currentRun) {
            this._trackerStop();
        }

        const now = Date.now();
        // Initialize with zeroed out time
        this.currentRun = this.engine.updateSession({
            date: now, 
            route: [], 
            lastMovementTimestamp: now, 
            pausedElapsed: 0,
            paused: false
        });

        this.tracker.start();
        this.ui.setRunningState(true);

        this.lastTickTime = null; // Reset tick for the new loop
        this._startUnifiedLoop();
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
            if (timeSinceMovement > this.movementGracePeriod) {
                console.log("Stationary detected via watchdog");
                this.pauseRun();
            }
        }, 5_000); // Check every 5 seconds
    }
        

    updateCurrentPosition(coords) {
        const previousDistance = this.currentRun?.distance || 0;
        this.currentRun = this.engine.updateSession(this.currentRun, coords);

        const currentDistance = this.currentRun?.distance || 0;
        const distanceMoved = currentDistance - previousDistance;

        // If movement is significant, update the timestamp
        if (distanceMoved > this.movementThreadhold) {            
            // Auto un-pause if movement is detected
            if (this.currentRun.paused) {
                console.log("Movement detected via watchdog, un-pausing run")
                this.resumeRun();
            } else {
                this.currentRun.lastMovementTimestamp = Date.now();
            }
        }

        this.ui.updateMapPositions(this.currentRun?.route);
        this.ui.updateTimerDisplays(this.currentRun);
    }


    /**
     * The ONLY loop the app uses. 
     * It handles both Running and Paused states by simply 
     * observing the passage of time.
     */
    _startUnifiedLoop() {
        const app = this;

        const loop = (currentTime) => {
            if (!app.lastTickTime) app.lastTickTime = currentTime;
            
            // Calculate delta (time since last frame)
            const deltaTime = (currentTime - app.lastTickTime) / 1000;
            app.lastTickTime = currentTime;

            // 1. Update the Logic (Only if not paused)
            if (app.currentRun && !app.currentRun.paused) {
                app.currentRun = app.engine.updateSession(app.currentRun);
            } else if (app.currentRun && app.currentRun.paused) {
                // If paused, we also need to update the "paused elapsed" part of the engine
                // by passing the deltaTime to the accumulated pause time.
                app.currentRun.pausedElapsed += deltaTime;
                app.currentRun = app.engine.updateSession(app.currentRun);
            }

            // 2. Update the UI (Always, so the clock/timer stays visible)
            app.ui.updateTimerDisplays(app.currentRun);

            // 3. Schedule next frame
            app.animationFrameId = requestAnimationFrame(loop);
        };

        app.animationFrameId = requestAnimationFrame(loop);
    }

    
    pauseRun() {
        if (!this.currentRun || this.currentRun.paused) return; 
        
        this.currentRun.paused = true;
        this.ui.setPauseState(true);
        // We don't stop the loop! The loop just starts accumulating 'pausedElapsed'
    }

    resumeRun() {
        if (!this.currentRun || !this.currentRun.paused) return;

        this.currentRun.lastMovementTimestamp = Date.now(); // Reset the last movement timestamp to allow for another grace period.
        this.currentRun.paused = false;
        this.ui.setPauseState(false);
        // The loop is already running; it just switches logic back to 'active'
    }


    /**
     * Clean-up the tracker and clear all timers.
     */
    _trackerStop() {
        this.tracker.stop();
        if (this.watchdogTimer) clearInterval(this.watchdogTimer);
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
        this.lastTickTime = null;
        this.watchdogTimer = null; // We don't need to clear it, but just in case
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