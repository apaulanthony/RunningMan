/**
 * TrackerEngine.js
 * Responsibility: Pure mathematical calculations and data transformations.
 * This module is "Pure": No side effects, no DOM, no Browser APIs.
 */

export class TrackerEngine {

    _deg2rad(deg) {
        return deg * (Math.PI / 180);
    }

    /**
     * Calculates distance between two points using the Haversine formula.
     * @param {number} lat1 
     * @param {number} lon1 
     * @param {number} lat2 
     * @param {number} lon2 
     * @returns {number} Distance in kilometers
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radius of the earth in km
        const dLat = this._deg2rad(lat2 - lat1);
        const dLon = this._deg2rad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this._deg2rad(lat1)) * Math.cos(this._deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Processes a new coordinate update against the existing session data.
     * @param {Object} currentSession - The existing session state
     * @param {Object} newCoord - Optional. The new longitude/latitude/altitude/timestamp/speed/heading
     * @returns {Object} The updated session state
     */
    updateSession(currentSession, newCoord) {
        if (!currentSession) return null;

        const { longitude, latitude, altitude, timestamp = Date.now(), speed, heading} = newCoord || {};
        
        // If this is the first point, just initialize the session
        if (!currentSession.route || currentSession.route.length === 0) {
            return {
                // Default values
                date: timestamp,
                pauseElapsed: 0,
                distance: 0,
                totalElapsed: 0,
                activeElapsed: 0,
                avgSpeed: null, // km/h
                avgPace: null, // min/km
                altitudeStats: { min: null, max: null, gain: null },
                ...currentSession, 
                route: newCoord ? [[longitude, latitude, altitude, timestamp, speed, heading]] : []
            };
        }

        const lastPoint = currentSession.route?.[currentSession.route.length - 1];

        // Append current point to the session's route
        const route = [...(currentSession.route || [])];
        if (newCoord){
            route.push([longitude, latitude, altitude, timestamp, speed, heading]);
        }

        const distMoved = ((lastPoint && newCoord) || 0) && this.calculateDistance(
            lastPoint[1], lastPoint[0], 
            latitude, longitude,
        );
        
        const distance = currentSession.distance + (distMoved || 0);
        
        const totalElapsed = (timestamp - currentSession.date) / 1000;
        const activeElapsed = totalElapsed - (currentSession.pausedElapsed || 0);
        
        const elevGain = ((lastPoint && newCoord) || 0) && altitude > lastPoint[2] //altitude 
            ? altitude - lastPoint[2]
            : 0;
        
        const altitudeGain = (currentSession.altitudeStats?.gain || 0) + (elevGain + 0);
        const altitudeList = route.map(p => p.altitude).filter(a => !!a);
        altitudeList.sort((a,b)=>a-b);

        // Return updated state
        return {
            ...currentSession,
            route: route,
            distance:  distance, // km
            totalElapsed: totalElapsed, // seconds
            activeElapsed: activeElapsed, //seconds
            avgSpeed: distance > 0 ? ((distance / 1000) / (activeElapsed / 3_600_000)) : 0, // km/h
            avgPace: distance > 0 ? (activeElapsed / 60_000) / (distance / 1000) : 0, // min/km                    
            altitudeStats: { 
                min: altitudeList[0] || null, 
                max: altitudeList[altitudeList.length - 1] || null, 
                gain: altitudeGain || null
            }
        };
    }
}