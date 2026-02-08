import { minify } from 'terser';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import CleanCSS from 'clean-css';

const distDir = 'dist/moci';

async function buildJS() {
	console.log('Minifying JavaScript...');

	const files = [
		'moci/js/core.js',
		'moci/js/modules/dashboard.js',
		'moci/js/modules/network.js',
		'moci/js/modules/system.js',
		'moci/js/modules/vpn.js',
		'moci/js/modules/services.js'
	];

	await mkdir(join(distDir, 'js/modules'), { recursive: true });

	for (const file of files) {
		const code = await readFile(file, 'utf8');
		const result = await minify(code, {
			module: true,
			compress: {
				dead_code: true,
				drop_console: false,
				drop_debugger: true,
				pure_funcs: ['console.log']
			},
			mangle: {
				toplevel: true
			}
		});

		const outPath = file.replace('moci/', distDir + '/');
		await writeFile(outPath, result.code);
		console.log(`  ${file} -> ${outPath} (${((1 - result.code.length / code.length) * 100).toFixed(1)}% smaller)`);
	}
}

async function buildCSS() {
	console.log('Minifying CSS...');

	const css = await readFile('moci/app.css', 'utf8');
	const result = new CleanCSS({
		level: 2
	}).minify(css);

	await writeFile(join(distDir, 'app.css'), result.styles);
	console.log(
		`  moci/app.css -> ${distDir}/app.css (${((1 - result.styles.length / css.length) * 100).toFixed(1)}% smaller)`
	);
}

async function copyHTML() {
	console.log('Copying HTML...');
	const html = await readFile('moci/index.html', 'utf8');
	await writeFile(join(distDir, 'index.html'), html);
}

async function build() {
	console.log('Building production bundle...\n');
	await buildJS();
	await buildCSS();
	await copyHTML();
	console.log('\nBuild complete! Output in dist/');
}

build().catch(console.error);
