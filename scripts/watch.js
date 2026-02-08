import { execSync } from 'child_process';
import chokidar from 'chokidar';

const args = process.argv.slice(2);

let target = args[0] || 'qemu';

if (args[0] === '--ip' && args[1]) {
	target = args[1];
} else if (args[0] && args[0].startsWith('--')) {
	console.error('Error: Invalid argument. Usage:');
	console.error('  pnpm dev                          # Deploy to QEMU VM');
	console.error('  pnpm dev:physical 192.168.1.XXX    # Deploy to physical router');
	process.exit(1);
}

let SSH;
let targetName;

if (target === 'qemu') {
	SSH = 'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 root@localhost';
	targetName = 'QEMU VM (localhost:2222)';
} else {
	const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
	if (!ipPattern.test(target)) {
		console.error(`Error: Invalid IP address: ${target}`);
		console.error('Usage: pnpm dev:physical 192.168.1.XXX');
		process.exit(1);
	}
	SSH = `ssh -i ~/.ssh/router root@${target}`;
	targetName = `Physical router (${target})`;
}

console.log(`Watching for changes in moci/...`);
console.log(`Target: ${targetName}\n`);

const watcher = chokidar.watch('moci', {
	persistent: true,
	ignoreInitial: true,
	awaitWriteFinish: {
		stabilityThreshold: 300,
		pollInterval: 100
	}
});

const aclWatcher = chokidar.watch('rpcd-acl.json', {
	persistent: true,
	ignoreInitial: true,
	awaitWriteFinish: {
		stabilityThreshold: 300,
		pollInterval: 100
	}
});

watcher.on('all', (event, path) => {
	console.log(`[${event}] ${path}`);
	if (event === 'change' || event === 'add') {
		deploy();
	}
});

aclWatcher.on('all', (event, path) => {
	console.log(`[${event}] ${path}`);
	if (event === 'change' || event === 'add') {
		deployACL();
	}
});

function deploy() {
	try {
		console.log(`Deploying to ${targetName}...`);

		execSync(`${SSH} "mkdir -p /www/moci/js/modules"`, { stdio: 'pipe' });

		execSync(`cat moci/index.html | ${SSH} "cat > /www/moci/index.html"`, { stdio: 'pipe' });
		execSync(`cat moci/app.css | ${SSH} "cat > /www/moci/app.css"`, { stdio: 'pipe' });

		execSync(`cat moci/js/core.js | ${SSH} "cat > /www/moci/js/core.js"`, { stdio: 'pipe' });
		execSync(`cat moci/js/modules/dashboard.js | ${SSH} "cat > /www/moci/js/modules/dashboard.js"`, {
			stdio: 'pipe'
		});
		execSync(`cat moci/js/modules/network.js | ${SSH} "cat > /www/moci/js/modules/network.js"`, {
			stdio: 'pipe'
		});
		execSync(`cat moci/js/modules/system.js | ${SSH} "cat > /www/moci/js/modules/system.js"`, {
			stdio: 'pipe'
		});
		execSync(`cat moci/js/modules/vpn.js | ${SSH} "cat > /www/moci/js/modules/vpn.js"`, { stdio: 'pipe' });
		execSync(`cat moci/js/modules/services.js | ${SSH} "cat > /www/moci/js/modules/services.js"`, {
			stdio: 'pipe'
		});

		console.log('Deployed successfully\n');
	} catch (err) {
		console.error('Deploy failed:', err.message);
	}
}

function deployACL() {
	try {
		console.log(`Deploying ACL to ${targetName}...`);

		execSync(`cat rpcd-acl.json | ${SSH} "cat > /usr/share/rpcd/acl.d/moci.json"`, { stdio: 'pipe' });
		execSync(`${SSH} "/etc/init.d/rpcd restart"`, { stdio: 'pipe' });

		console.log('ACL deployed and rpcd restarted\n');
	} catch (err) {
		console.error('ACL deploy failed:', err.message);
	}
}

console.log('Ready. Save files in moci/ or rpcd-acl.json to trigger deploy.');
