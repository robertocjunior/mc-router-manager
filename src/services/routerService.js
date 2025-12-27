const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const db = require('../database/db');

class RouterService {
    constructor() {
        this.process = null;
        this.configPath = path.join(process.cwd(), 'mc-router-config.json');
    }

    // Lê do SQLite e gera o JSON
    async syncAndRestart() {
        db.all("SELECT * FROM routes", async (err, rows) => {
            if (err) {
                console.error("Erro ao ler DB:", err);
                return;
            }

            // O mc-router espera "serverAddress" como "ip:porta"
            // E "listeningPort" como inteiro
            const config = {
                routes: rows.map(r => ({
                    serverAddress: `${r.destHost}:${r.destPort}`,
                    listeningPort: parseInt(r.listeningPort)
                }))
            };

            await fs.writeJson(this.configPath, config, { spaces: 2 });
            console.log('Configuração sincronizada. Reiniciando serviço...');
            this.restart();
        });
    }

    start() {
        if (this.process) return;

        if (!fs.existsSync(this.configPath)) {
            fs.writeJsonSync(this.configPath, { routes: [] });
        }

        console.log('Iniciando mc-router...');
        this.process = spawn('mc-router', ['-mapping=' + this.configPath], {
            stdio: 'inherit'
        });

        this.process.on('close', (code) => {
            console.log(`mc-router parou (código ${code})`);
            this.process = null;
        });
    }

    stop() {
        if (this.process) {
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