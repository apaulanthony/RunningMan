import { defineConfig } from 'vite'
import pkg from './package.json';

export default defineConfig({
  	define: {
		// Define a global variable for the app version for .js to bake in
  		__APP_VERSION__: JSON.stringify(pkg.version),
  	},

	// The default "/" (without the "." current path) would put the base path at https://apaulanthony.github.io/ 
	// removing the /RunningMan/dist/ part. Using a relative path "./" instead will work with any location, nested
	// or otherwise, including vite's local previews e.g. http://localhost:4173 
	base: "./",

	build: {
		rolldownOptions: {
			input: ['index.html', 'js/sw.js'],
			output: {
				// Explicitly define the sw.js output file name. It is a special case that needs to keep its name and location fixed
				entryFileNames: (chunkInfo) => {
					if (chunkInfo.name === 'sw') {
						return 'sw.js';
					}
					// Default pattern for other files
					return 'assets/[name]-[hash].js';
				}
			}
		}
	}
});