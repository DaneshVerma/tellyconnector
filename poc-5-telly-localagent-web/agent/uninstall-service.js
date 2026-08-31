const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
    name: 'TallyLocalAgent',
    script: path.join(__dirname, 'agent.js')
});

svc.on('uninstall', () => {
    console.log('Service removed successfully.');
});

svc.on('error', (err) => {
    console.error('Uninstall error:', err.message);
});

svc.uninstall();
