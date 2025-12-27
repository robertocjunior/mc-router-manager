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
                console.error("Erro ao ler DB:", err);
                return;
            }

            // CORREÇÃO: O mc-router exige que o JSON tenha a chave "routes"
            // Exemplo: { "routes": [ ... ] }
            const config = {
                routes: rows.map(r => ({
                    serverAddress: r.sourceDomain.toLowerCase().trim(),
                    backend: `${r.destHost}:${r.destPort}`
                }))
            };

            await fs.writeJson(this.configPath, config, { spaces: 2 });
            
            console.log('Configuração salva. Reiniciando serviço automaticamente...');
            console.log('Conteúdo Gerado:', JSON.stringify(config));

            this.restart();
        });
    }

    start() {
        if (this.process) return;

        // Se arquivo não existe, cria com estrutura válida { routes: [] }
        if (!fs.existsSync(this.configPath)) {
            fs.writeJsonSync(this.configPath, { routes: [] });
        }

        console.log('Iniciando mc-router...');
        
        this.process = spawn('mc-router', [
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