/**
 * ExportService.js
 * Responsibility: Handles exporting data to a file.
 */
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export class ExportService {
    async saveRunToFile(data) {
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

        const filename = `RunningMan.${new Date(data.date).toISOString().replace(/(\/|:|,)/g, '')}`;
        const kmlBlob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' });

        // Convert to kmz (zip file containing the kml) 
        const zip = new JSZip();
        zip.file(filename + ".kml", kmlBlob);
        const kmzBlob = await zip.generateAsync({ type: 'blob' });

        saveAs(kmzBlob, filename + ".kmz");
    }
}