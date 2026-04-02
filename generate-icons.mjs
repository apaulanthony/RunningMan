import sharp from 'sharp';
import fs from 'fs';

const emoji = '🏃';
const sizes = [96, 192, 512];
const publicDir = './public';

async function generateIcons() {
	// Create SVG with emoji
	const createSvg = (size) => `
		<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
			<rect width="${size}" height="${size}" fill="#6ec522"/>
			<text
				x="50%" 
				y="50%" 
				text-anchor="middle" 
				dy=".3em" 
				font-size="${Math.round(size * 0.6)}" 
				dominant-baseline="middle"
			>
				${emoji}
			</text>
		</svg>
	`;

	for (const size of sizes) {
		const svgString = createSvg(size);

		// Regular icon
		await sharp(Buffer.from(svgString))
			.png()
			.toFile(`${publicDir}/icon-${size}.png`);
		console.log(`✓ Generated icon-${size}.png`);

		// Maskable icon (solid background)
		const maskableSvg = `
			<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
				<rect width="${size}" height="${size}" fill="#22c55e"/>
				<circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="#22c55e"/>
				<text 
					x="50%" 
					y="50%" 
					text-anchor="middle" 
					dy=".3em" 
					font-size="${Math.round(size * 0.6)}" 
					dominant-baseline="middle"
				>
					${emoji}
				</text>
			</svg>
		`;

		await sharp(Buffer.from(maskableSvg))
			.png()
			.toFile(`${publicDir}/icon-maskable-${size}.png`);

		console.log(`✓ Generated icon-maskable-${size}.png`);
	}

	console.log('\n✅ All icons generated successfully!');
}

generateIcons().catch(err => {
	console.error('Error generating icons:', err);
	process.exit(1);
});
