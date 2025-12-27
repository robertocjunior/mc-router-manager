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

            // CORREÇÃO: 'mappings' deve ser um Objeto {}, não Array []
            const config = {
                "default-server": null,
                "mappings": {} 
            };

            rows.forEach(r => {
                const domain = r.sourceDomain.toLowerCase().trim();
                const backend = `${r.destHost}:${r.destPort}`;

                // Se for * ou vazio, é o default-server
                if (domain === '*' || domain === '') {
                    config["default-server"] = backend;
                } else {
                    // Mapeamento Chave(Domínio) = Valor(Backend)
                    config.mappings[domain] = backend;
                }
            });

            // Se o default-server for null, o mc-router pode reclamar se não tiver mappings
            // Mas vamos manter a estrutura padrão
            if (!config["default-server"]) delete config["default-server"];

            // Salva o arquivo
            await fs.writeJson(this.configPath, config, { spaces: 2 });
            
            console.log('Configuração salva. Reiniciando serviço automaticamente...');
            console.log('Conteúdo Gerado (JSON):', JSON.stringify(config));

            this.restart();
        });
    }

    start() {
        if (this.process) return;

        // Cria arquivo inicial válido (objeto vazio para mappings)
        if (!fs.existsSync(this.configPath)) {
            fs.writeJsonSync(this.configPath, { "mappings": {} });
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