const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const db = require('../database/db');

class RouterService {
    constructor() {
        this.process = null;
        this.configPath = path.join(process.cwd(), 'mc-router-config.json');
        // Pega a porta da variável de ambiente ou usa 25565 como fallback
        this.port = process.env.MC_ROUTER_PORT || 25565;
    }

    async syncAndRestart() {
        db.all("SELECT * FROM routes", async (err, rows) => {
            if (err) {
                console.error("Erro ao ler DB:", err);
                return;
            }

            const config = {
                "default-server": null,
                "mappings": {} 
            };

            rows.forEach(r => {
                const domain = r.sourceDomain.toLowerCase().trim();
                const backend = `${r.destHost}:${r.destPort}`;

                if (domain === '*' || domain === '') {
                    config["default-server"] = backend;
                } else {
                    config.mappings[domain] = backend;
                }
            });

            if (!config["default-server"]) delete config["default-server"];

            await fs.writeJson(this.configPath, config, { spaces: 2 });
            this.restart();
        });
    }

    start() {
        if (this.process) return;

        if (!fs.existsSync(this.configPath)) {
            fs.writeJsonSync(this.configPath, { "mappings": {} });
        }

        console.log(`Iniciando mc-router na porta ${this.port}...`);
        
        // Passamos o flag -port para o binário
        this.process = spawn('mc-router', [
            '-port=' + this.port,
            '-routes-config=' + this.configPath, 
            '-debug'
        ], {
            stdio: 'inherit'
        });

        this.process.on('close', (code) => {
            console.log(`mc-router parou (código ${code})`);
            this.process = null;
        });
    }

    stop() {
        if (this.process) {
            console.log('Parando processo mc-router atual...');
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