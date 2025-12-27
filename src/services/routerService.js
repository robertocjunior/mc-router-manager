const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const db = require('../database/db');

class RouterService {
    constructor() {
        this.process = null;
        this.configPath = path.join(process.cwd(), 'mc-router-config.json');
    }

    async syncAndRestart() {
        db.all("SELECT * FROM routes", async (err, rows) => {
            if (err) {
                console.error("Error reading DB:", err);
                return;
            }

            // CORRECTION: 'mappings' must be an Object {}, not an Array []
            const config = {
                "default-server": null,
                "mappings": {} 
            };

            rows.forEach(r => {
                const domain = r.sourceDomain.toLowerCase().trim();
                const backend = `${r.destHost}:${r.destPort}`;

                // If * or empty, it's the default-server
                if (domain === '*' || domain === '') {
                    config["default-server"] = backend;
                } else {
                    // Mapping Key(Domain) = Value(Backend)
                    config.mappings[domain] = backend;
                }
            });

            // If default-server is null, remove it to avoid issues
            if (!config["default-server"]) delete config["default-server"];

            // Save file
            await fs.writeJson(this.configPath, config, { spaces: 2 });
            
            console.log('Configuration saved. Restarting service automatically...');
            console.log('Generated Content (JSON):', JSON.stringify(config));

            this.restart();
        });
    }

    start() {
        if (this.process) return;

        // Create valid initial file if not exists
        if (!fs.existsSync(this.configPath)) {
            fs.writeJsonSync(this.configPath, { "mappings": {} });
        }

        console.log('Starting mc-router...');
        
        this.process = spawn('mc-router', [
            '-routes-config=' + this.configPath, 
            '-debug'
        ], {
            stdio: 'inherit'
        });

        this.process.on('close', (code) => {
            console.log(`mc-router stopped (code ${code})`);
            this.process = null;
        });
    }

    stop() {
        if (this.process) {
            console.log('Stopping current mc-router process...');
            this.process.kill();
            this.process = null;
        }
    }

    restart() {
        this.stop();
        setTimeout(() => this.start(), 1500);
    }
}

module.exports = new RouterService();