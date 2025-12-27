const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const db = require('../database/db');

class RouterService {
    constructor() {
        this.process = null;
        this.configPath = path.join(process.cwd(), 'mc-router-config.json');
    }

    // Lê do SQLite, gera o JSON correto e reinicia
    async syncAndRestart() {
        db.all("SELECT * FROM routes", async (err, rows) => {
            if (err) {
                console.error("Erro ao ler DB:", err);
                return;
            }

            // CORREÇÃO 1: Formato JSON simplificado (Array de objetos)
            // Também forçamos minúsculas no domínio para evitar erros de digitação
            const config = rows.map(r => ({
                serverAddress: r.sourceDomain.toLowerCase().trim(),
                backend: `${r.destHost}:${r.destPort}`
            }));

            // Salva o arquivo
            await fs.writeJson(this.configPath, config, { spaces: 2 });
            
            console.log('Configuração salva. Reiniciando serviço automaticamente...');
            console.log('Conteúdo Gerado:', JSON.stringify(config)); // Log para debug

            this.restart();
        });
    }

    start() {
        if (this.process) return;

        // Garante que o arquivo exista, mesmo que vazio (array vazio)
        if (!fs.existsSync(this.configPath)) {
            fs.writeJsonSync(this.configPath, []);
        }

        console.log('Iniciando mc-router...');
        
        // CORREÇÃO 2: Usa -routes-config para ler do arquivo e -debug para ver erros
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
        // Espera um pouco para garantir que a porta foi liberada antes de subir de novo
        setTimeout(() => this.start(), 1500);
    }
}

module.exports = new RouterService();