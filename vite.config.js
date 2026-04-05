import { defineConfig } from 'vite'
import pkg from './package.json';

export default defineConfig({
  	define: {
  		__APP_VERSION__: JSON.stringify(pkg.version),
  	},	
	base: "./",
	build: {
		rolldownOptions: {
			input: ['index.html', 'js/sw.js'],
			output: {
				entryFileNames: (chunkInfo) => {
					// Explicitly define output file names. sw.js is a special case that needs to keep its name and location fixed
					if (chunkInfo.name === 'sw') {
						return 'sw.js';
					}
					// Default pattern for other files
					return 'assets/[name]-[hash].js';
				},
				chunkFileNames: 'assets/[name]-[hash].js',
				assetFileNames: 'assets/[name]-[hash][extname]'
			}
		}
	}
});