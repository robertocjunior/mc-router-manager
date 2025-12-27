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

            // O mc-router espera uma lista de objetos JSON
            const config = rows.map(r => ({
                serverAddress: r.sourceDomain.toLowerCase().trim(),
                backend: `${r.destHost}:${r.destPort}`
            }));

            // Salva o arquivo
            await fs.writeJson(this.configPath, config, { spaces: 2 });
            console.log('Configuração salva. Reiniciando serviço...');
            
            // Log do que foi salvo para debug
            console.log('Conteúdo:', JSON.stringify(config));
            
            this.restart();
        });
    }

    start() {
        if (this.process) return;

        if (!fs.existsSync(this.configPath)) {
            fs.writeJsonSync(this.configPath, []);
        }

        console.log('Iniciando mc-router...');
        
        // --- CORREÇÃO AQUI ---
        // Usamos -routes-config para ele ler o ARQUIVO JSON
        // Usamos -debug para ver o que está acontecendo
        // -api-binding habilita a API (opcional, mas bom ter)
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
            this.process.kill();
            this.process = null;
        }
    }

    restart() {
        this.stop();
        setTimeout(() => this.start(), 2000); // Um pouco mais de tempo para garantir
    }
}

module.exports = new RouterService();