/**
 * MapComponent.js
 * Responsibility: Renders the map
 * @see https://openlayers.org/en/latest/apidoc/module-ol_Map-Map.html
 */
import Feature from 'ol/Feature.js';
import Map from 'ol/Map.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import View from 'ol/View.js';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style.js';
import { OSM, Vector as VectorSource } from 'ol/source.js';
import { Tile as TileLayer, Vector as VectorLayer } from 'ol/layer.js';
import { fromLonLat } from 'ol/proj.js';

export class MapComponent  {
    constructor(target) {
        // Create the map with a base OSM layer and the defined view
        this.map = new Map({
            layers: [
                new TileLayer({
                    source: new OSM(),
                })
            ],
            target: target,
            view: new View({
                //center: fromLonLat([0, 0]),
                zoom: 15
            })
        });

        // Try to get user's location as soon as possible, even with low accuracy, to center the map. The
        // "center" will naturally move as when geolocation tracking starts
        (async () =>{
            const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));

            // If the view center still hasn't been set, set it to the user's location
            const view = this.map.getView();
            if (!view.getCenter()) {
                view.setCenter(fromLonLat([position.coords.longitude, position.coords.latitude]));
            }
        })();         

        
        // Features for current position and path, with styles
        this.positionFeature = new Feature();
        this.positionFeature.setStyle(
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

        this.pathFeature = new Feature();
        this.pathFeature.setStyle(
            new Style({
                stroke: new Stroke({
                    color: '#ff0000',
                    width: 3,
                }),
            }),
        );
        
        // Add the vector layer to the map
        new VectorLayer({
            map: this.map,
            source: new VectorSource({
                features: [this.positionFeature, this.pathFeature],
            }),
        });        
    }

    /**
     * Plote the route, focusing on the last point as the current position
     * @param {array} route 
     */
    updateMapPositions(route) {
        const point = route && fromLonLat(route[route.length - 1]?.slice(0, 2));
        const path = route?.map(pos => fromLonLat(pos.slice(0,2)));

        this.positionFeature.setGeometry(route && new Point(point));
        this.pathFeature.setGeometry(route && new LineString(path));

        if (point) {
            this.map.getView().setCenter(point);
        }
    }    
}