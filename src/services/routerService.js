const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

class RouterService {
    constructor() {
        this.process = null;
        this.configPath = path.join(process.cwd(), 'mc-router-config.json');
    }

    async getConfig() {
        if (!await fs.pathExists(this.configPath)) {
            // Cria config padrão se não existir
            await fs.writeJson(this.configPath, { routes: [] });
        }
        return await fs.readJson(this.configPath);
    }

    async saveConfig(config) {
        await fs.writeJson(this.configPath, config, { spaces: 2 });
        this.restart();
    }

    start() {
        if (this.process) return;

        console.log('Iniciando mc-router...');
        // Assume que o binário está no PATH (feito pelo Dockerfile)
        this.process = spawn('mc-router', ['-mapping=' + this.configPath], {
            stdio: 'inherit' // Logs do mc-router aparecem no console principal
        });

        this.process.on('close', (code) => {
            console.log(`mc-router parou com código ${code}`);
            this.process = null;
        });
    }

    stop() {
        if (this.process) {
            console.log('Parando mc-router...');
            this.process.kill();
            this.process = null;
        }
    }

    restart() {
        this.stop();
        setTimeout(() => this.start(), 1000);
    }
}

module.exports = new RouterService();