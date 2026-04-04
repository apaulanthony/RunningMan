/**
 * LocationService.js
 * Responsibility: Interfacing with the Web Geolocation API.
 * This module handles the lifecycle of GPS tracking and notifies subscribers of updates.
 */
export class LocationService {
    constructor() {
        this.watchId = null;
        this.subscribers = [];
        this.errorSubscribers = [];
        
        // Configuration for high accuracy
        this.geoOptions = {
            enableHighAccuracy: true,
            timeout: 10_000,
            maximumAge: 0
        };
    }

    /**
     * Subscribe to position updates.
     * @param {Function} callback - Function to call when a new position is available.
     * @returns {Function} An unsubscribe function.
     */
    subscribe(callback) {
        this.subscribers.push(callback);
        return () => {
            this.subscribers = this.subscribers.filter(sub => sub !== callback);
        };
    }

    /**
     * Subscribe to error updates (e.g., GPS signal lost, permission denied).
     * @param {Function} callback 
     * @returns {Function} An unsubscribe function.
     */
    subscribeError(callback) {
        this.errorSubomalized = this.errorSubscribers.push(callback);
        return () => {
            this.errorSubscribers = this.errorSubscribers.filter(sub => sub !== callback);
        };
    }

    /**
     * Starts the Geolocation watching process.
     */
    async start() {
        if (!navigator.geolocation) {
            this._notifyError("Geolocation is not supported by your browser.");
            return;
        }

        if (this.watchId !== null) {
            console.warn("Location tracking is already running.");
            return;
        }

        // // Get an immediate high-precision lock on location https://developer.mozilla.org/docs/Web/API/Geolocation/getCurrentPosition
        // new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, this.geoOptions)).then(
        //     (position) => this._handleSuccess(position),
        //     (error) => this._handleError(error)            
        // );
        
        //Then set up a watch https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition
        this.watchId = navigator.geolocation.watchPosition(
            (position) => this._handleSuccess(position),
            (error) => this._handleError(error),
            this.geoOptions
        );
    }

    /**
     * Stops the Geolocation watching process.
     */
    stop() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchrotationId);
            this.watchId = null;
        }
    }

    /**
     * Internal: Handles successful position updates.
     * @param {GeolocationPosition} position 
     */
    _handleSuccess(position) {
        const { longitude, latitude, altitude, timestamp = new Date(), speed, heading } = position.coords;
        
        // We map the native object to a plain POJO (Plain Old JavaScript Object)
        // This ensures the subscribers don't have a dependency on the complex GeolocationPosition object
        const update = {
            longitude,
            latitude,
            altitude,
            timestamp,
            speed,
            heading
        };

        this._notifySubscribers(update);
    }

    /**
     * Internal: Handles GPS errors.
     * @param {GeolocationPositionError} error 
     */
    _handleError(error) {
        let message = "An unknown error occurred while tracking location.";
        
        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = "User denied the request for Geolocation.";
                break;
            case error.POSITION_UNAVAILABLE:
                message = "Location information is unavailable.";
                break;
            case error.TIMEOUT:
                message = "The request to get user location timed out.";
                break;
        }

        this._notifyError(message);
    }

    _notifySubscribers(data) {
        this.subscribers.forEach(callback => callback(data));
    }

    _notifyError(message) {
        this.errorSubscribers.forEach(callback => callback(message));
    }
}