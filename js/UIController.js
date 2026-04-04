
/**
 * UIController.js
 * Responsibility: DOM Manipulation and User Input capture.
 * This module does NOT know about GPS or Databases. It only knows about HTML.
 */
import { MapComponent } from './MapComponent.js';

export class UIController {
    constructor() {
        // Helper function to get element by ID
        function el(id) {
            return document.getElementById(id);
        }

        // Cache all DOM elements once during initialization
        this.elements = {
            timerContainer: el("timers"),
            durationTimer: el("duration-timer"),
            pauseTimer: el("pause-timer"),
    
            startContainer: el("start-container"),
            historyContainer: el("history-container"),
            actionContainer: el("action-container"),
            pauseOverlay: el("pause-overlay"),

            startBtn: el("start"),
            stopBtn: el("stop"),            
            pauseBtn: el("pause"),
            resumeBtn: el("resume"),
            historyBtn: el("history"),
            clearHistoryBtn: el("clear-history"),

            map: new MapComponent('map')
        };

        // Callbacks (to be provided by the App Mediator)
        this.onStartRun = null;
        this.onStopRun = null;
        this.onPauseRun = null;
        this.onResumeRun = null;
        this.onShowHistory = null;
        this.onClearHistory = null;

        this.exportRun = null;
        this.deleteRun = null;

        this._setupEventListeners();
    }

    /**
     * Private: Attach listeners to DOM elements
     */
    _setupEventListeners() {
        this.elements.startBtn?.addEventListener('click', () => {
            if (typeof this.onStartRun === "function") this.onStartRun();
        });

        this.elements.stopBtn?.addEventListener('click', () => {
            if (typeof this.onStopRun === "function") this.onStopRun();
        });

        this.elements.pauseBtn?.addEventListener('click', () => {
            if (typeof this.onPauseRun === "function") this.onPauseRun();
        });

        this.elements.resumeBtn?.addEventListener('click', () => {
            if (typeof this.onResumeRun === "function") this.onResumeRun();
        });

        this.elements.historyBtn?.addEventListener('click', () => {
            if (typeof this.onShowHistory === "function") this.onShowHistory();
        });

        this.elements.clearHistoryBtn?.addEventListener('click', async () => {
            if (typeof this.onClearHistory === "function") this.onClearHistory();
        });
    }

    /**
     * Try to fade panels in and out gracefully so that the animation is seen before toggling the display to hide the element entirely.
     * @param {HTMLElement} element 
     * @param {string} display 
     * @returns 
     */
    async fadeInOut(element, display = "block") {
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

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Update the live dashboard during a run.
     * @param {Object} stats - Object containing distance, pace, time, etc.
     */
    updateTimerDisplays(stats) {
        this.elements.durationTimer.textContent = this.formatTime(stats.totalElapsed);
        this.elements.pauseTimer.textContent = `Paused: ${this.formatTime(stats.pausedElapsed || 0)}`;
    }

    /**
     * Plote the route, focusing on the last point as the current position
     * @param {array} route 
     */
    updateMapPositions(route) {
        this.elements.map.updateMapPositions(route);
    }

    /**
     * Update the visual state of the UI (e.g., active/inactive)
     * @param {boolean} isRunning 
     */
    async setRunningState(isRunning) {
        return Promise.all([
            this.fadeInOut(this.elements.startContainer, isRunning ?'none':'block'),
            this.fadeInOut(this.elements.historyContainer, isRunning ?'none':'flex'),
            this.fadeInOut(this.elements.timerContainer, isRunning ?'block':'none'),
            this.fadeInOut(this.elements.actionContainer, isRunning ?'flex':'none')
        ]);        
    }

    async setPauseState(isPaused) {
        return this.fadeInOut(this.elements.pauseOverlay, isPaused ? 'block':'none');
    }

    /**
     * Show a confirmation dialog with the given message and return a promise that resolves to name of the button pressed: "Yes" or "No".
     * @param {string} messageHtml 
     * @returns {Promise<void>} Resolved promise when completed.
     */
    async confirmDialog(messageHtml = "<p>Are you sure?</p>") {
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
    async showMessageDialog(messageHtml, postProcess) { 
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
        })
    }

    async showRunDetailsDialog(summary) {
        return this.showMessageDialog(`<table>
<tr><th>Date</th><td>${new Date(summary.date).toLocaleString()}</td></tr>
<tr><th>Total Time</th><td>${this.formatTime(Math.round(summary.totalElapsed))}</td></tr>
<tr><th>Paused Time</th><td>${this.formatTime(Math.round(summary.pausedElapsed || 0))}</td></tr>
<tr><th>Active Time</th><td>${this.formatTime(Math.round(summary.activeElapsed))}</td></tr>
<tr><th>Distance (km)</th><td>${(summary.distance / 1000).toFixed(3)}</td></tr>
<tr><th>Avg pace (min/km)</th><td>${summary.avgPace ? summary.avgPace.toFixed(2) : 'N/A'}</td></tr>
<tr><th>Avg speed (km/h)</th><td>${summary.avgSpeed ? summary.avgSpeed.toFixed(2) : 'N/A'}</td></tr>
<tr><th>Altitude Stats</th><td>Min: ${typeof summary.altitudeStats?.min === 'number' ? summary.altitudeStats.min.toFixed(2) : 'N/A'}
    <br />Max: ${typeof summary.altitudeStats?.max === 'number' ? summary.altitudeStats.max.toFixed(2) : 'N/A'}
    <br />Gain: ${typeof summary.altitudeStats?.gain === 'number' ? summary.altitudeStats.gain.toFixed(2) : 'N/A'}
</td></tr>
</table>`);         
    }

    /**
     * Render the history list from an array of runs
     * @param {Array} runs 
     */
    async showRunHistoryDialog(allRuns) {
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
                <td>${this.formatTime(Math.round(run.totalElapsed || run.totalTime))}</td>
                <td>${this.formatTime(Math.round(run.pausedElapsed || run.pausedTime || 0))}</td>
                <td>${this.formatTime(Math.round(run.activeElapsed || run.activeTime))}</td>
                <td>${run.distance ? (run.distance / 1000).toFixed(3) : 'N/A'}</td>
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
                button.addEventListener('click', () => {
                    if (typeof this.exportRun === "function") this.exportRun(JSON.parse(button.getAttribute('data-id')));
                });
            });

            dialog.querySelectorAll('.remove-run').forEach(button => {
                button.addEventListener('click', async () => {                                            
                    try {
                        if (typeof this.deleteRun !== "function") {
                            return;
                        }
                    
                        await this.deleteRun(JSON.parse(button.getAttribute('data-id')));

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
                            tr.remove();
                        }                        
                    } catch (error) {
                        // NOT deleted
                    }
                });
            });
        };

        return this.showMessageDialog(messageHtml, postProcess);
    }

    /**
     * Show error messages to the user
     * @param {string} message 
     */
    showError(message) {
        // Logic for a toast or alert
        alert(message); 
    }
}