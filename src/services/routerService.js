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

            // Estrutura exigida pelo itzg/mc-router
            const config = {
                "default-server": null, // Rota padrão (Curinga *)
                "mappings": []          // Rotas normais
            };

            rows.forEach(r => {
                const domain = r.sourceDomain.toLowerCase().trim();
                const backend = `${r.destHost}:${r.destPort}`;

                // Se for * ou vazio, define como Default Server
                if (domain === '*' || domain === '') {
                    config["default-server"] = backend;
                } else {
                    // Caso contrário, adiciona na lista de mapeamentos
                    config.mappings.push({
                        serverAddress: domain,
                        backend: backend
                    });
                }
            });

            // Se não tiver mappings, garante array vazio para não quebrar o JSON
            if (!config.mappings) config.mappings = [];

            // Salva o arquivo
            await fs.writeJson(this.configPath, config, { spaces: 2 });
            
            console.log('Configuração salva. Reiniciando serviço automaticamente...');
            console.log('Conteúdo Gerado (Final):', JSON.stringify(config));

            this.restart();
        });
    }

    start() {
        if (this.process) return;

        // Cria arquivo inicial válido se não existir
        if (!fs.existsSync(this.configPath)) {
            fs.writeJsonSync(this.configPath, { "default-server": null, "mappings": [] });
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