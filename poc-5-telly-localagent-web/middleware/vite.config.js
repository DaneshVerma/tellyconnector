import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        host: '0.0.0.0',
        port: 5173,
        proxy: {
            '/api': 'http://localhost:3000',
            '/command': 'http://localhost:3000',
            '/events': 'http://localhost:3000',
            '/agent': {
                target: 'ws://localhost:3000',
                ws: true
            }
        }
    }
});
