const Service = require('node-windows').Service;
const path = require('path');
const fs = require('fs');

const scriptPath = path.join(__dirname, 'agent.js');
const logDir = path.join(__dirname, 'agent-logs');
const logFile = path.join(logDir, 'agent.log');

if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const svc = new Service({
    name: 'TallyLocalAgent',
    description: 'TallyPrime local bridge agent for the demo middleware',
    script: scriptPath,
    env: [
        { name: 'STATUS_PORT', value: '5001' },
        { name: 'MIDDLEWARE_HTTP', value: 'http://localhost:3000' },
        { name: 'SERVER_WS', value: 'ws://localhost:3000/agent' },
        { name: 'TALLY_URL', value: 'http://localhost:9000' }
    ],
    workingDirectory: __dirname,
    nodeOptions: ['--trace-warnings'],
    logpath: logFile,
    logmode: 'rotate',
    logOnAs: null,
    allowServiceLogon: true
});

svc.on('install', () => {
    console.log('Service installed successfully.');
    console.log(`Log file: ${logFile}`);
    svc.start();
});

svc.on('error', (err) => {
    console.error('Service install error:', err.message);
});

svc.on('alreadyinstalled', () => {
    console.log('Service already installed.');
});

svc.on('start', () => {
    console.log('Service started successfully.');
});

svc.install();
