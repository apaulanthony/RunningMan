import { LocationService } from './LocationService.js';
import { StorageService } from './StorageService.js';
import { UIController } from './UIController.js';
import { TrackerEngine } from './TrackerEngine.js';

class App {
    constructor() {
        this.ui = new UIController();
        this.storage = new StorageService();
        this.tracker = new LocationService();
        this.engine = new TrackerEngine();

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
        return setInterval(() => {
            this.currentRun = this.engine.updateSession(this.currentRun);
            this.ui.updateTimerDisplays(this.currentRun)
        }, timeout)
    }

    async startNewRun() {         
        this.tracker.start();
        this.currentRun = { date: Date.now(), route: [], timer: this._startRunTimer()};
        this.currentRun = this.engine.updateSession(this.currentRun);
        this.ui.setRunningState(!!this.currentRun.timer);
    }

    updateCurrentPosition(coords) {
        // The Engine calculates, the UI displays        
        this.currentRun = this.engine.updateSession(this.currentRun, coords);
        this.ui.updateMapPositions(this.currentRun.route);
        this.ui.updateTimerDisplays(this.currentRun);
    }


    _startPauseTimer(timeout = 1000) {
        return setInterval(() => {
            this.currentRun.pausedElapsed += (timeout / 1000); // Count seconds in paused state.
            this.currentRun = this.engine.updateSession(this.currentRun);
            this.ui.updateTimerDisplays(this.currentRun)
        }, timeout)
    }

    pauseRun() {
        clearInterval(this.currentRun.timer);
        this.currentRun.pausedElapsed = this.currentRun.pausedElapsed || 0; // Ensure pausedElapsed is initialised
        this.currentRun.timer = this._startPauseTimer();    
        this.ui.setPauseState(true);
    }

    resumeRun() {
        clearInterval(this.currentRun.timer);
        this.currentRun.timer = this._startRunTimer();
        this.currentRun = this.engine.updateSession(this.currentRun);        
        this.ui.setPauseState(false);
    }

    async stopCurrentRun() {
        if ("Yes" !== await this.ui.confirmDialog("<p>Are you sure you want to stop the run?</p>")) {
            return;
        }

        this.tracker.stop();
        clearInterval(this.currentRun.timer);
        this.ui.setRunningState(!!(this.currentRun.timer = null));
        const currentRun = this.engine.updateSession(this.currentRun);
        this.currentRun = null;
        this.storage.saveRun(currentRun);
        this.ui.showRunDetailsDialog(currentRun);
    }

    async showHistory() {
        this.ui.showRunHistoryDialog(await this.storage.getAllRuns());
    }

    async clearHistory() {
        if ("Yes" !== await this.ui.confirmDialog("<p>Are you sure you want to clear all run history? This action cannot be undone.</p>")) {
            return;
        }

        this.storage.deleteAllRuns();
    }

}

const myApp = new App();
myApp.init();