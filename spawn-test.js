const { spawn } = require('child_process');
const child = spawn('npm run compile', { shell: true, stdio: 'inherit' });
child.on('error', (err) => console.error('ERROR', err));
child.on('exit', (code, signal) => console.log('EXIT', code, signal));
