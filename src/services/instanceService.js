const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../database/db');
const routerService = require('./routerService');

class InstanceService {
    constructor() {
        this.instancesDir = path.join(process.cwd(), 'data', 'instances');
        this.activeProcesses = {};
        // Pega a porta configurada
        this.routerPort = parseInt(process.env.MC_ROUTER_PORT || 25565);
        // Armazena contagem de tentativas de reinício: { instanceId: 0 a 3 }
        this.retryCounters = {};
    }

    async createInstance(name, domain, file, customCommand) {
        return new Promise((resolve, reject) => {
            db.get("SELECT MAX(port) as maxPort FROM instances", async (err, row) => {
                if (err) return reject(err);
                
                let port = (row && row.maxPort) ? row.maxPort + 1 : 25566;
                
                // Pula a porta do router para evitar conflito
                if (port === this.routerPort) port++;

                const instanceFolder = path.join(this.instancesDir, name);
                const jarName = file.filename;

                try {
                    await fs.ensureDir(instanceFolder);
                    await fs.move(file.path, path.join(instanceFolder, jarName));
                    
                    // Cria eula.txt e server.properties iniciais
                    await fs.writeFile(path.join(instanceFolder, 'eula.txt'), 'eula=true');
                    await fs.writeFile(path.join(instanceFolder, 'server.properties'), `server-port=${port}\nonline-mode=false`);
                } catch (ioErr) {
                    return reject(ioErr);
                }

                let cmd = customCommand || 'java -Xmx1024M -Xms1024M -jar {jar} nogui';
                cmd = cmd.replace('{jar}', jarName);

                db.run(
                    "INSERT INTO instances (name, domain, port, jarFile, startCommand) VALUES (?, ?, ?, ?, ?)",
                    [name, domain, port, jarName, cmd],
                    function (dbErr) {
                        if (dbErr) return reject(dbErr);
                        const instanceId = this.lastID;

                        db.run("INSERT INTO routes (sourceDomain, listeningPort, destHost, destPort, description) VALUES (?, ?, ?, ?, ?)",
                            [domain, this.routerPort, '127.0.0.1', port, `Auto-generated for ${name}`],
                            (routeErr) => {
                                if (!routeErr) routerService.syncAndRestart();
                            }
                        );

                        resolve({ id: instanceId, port, name });
                    }
                );
            });
        });
    }

    startInstance(id) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE id = ?", [id], async (err, instance) => {
                if (err || !instance) return reject("Instância não encontrada");
                
                if (this.activeProcesses[id]) {
                    // Se já estiver rodando, só resolve
                    return resolve(this.activeProcesses[id].pid);
                }

                const instanceFolder = path.join(this.instancesDir, instance.name);
                const args = instance.startCommand.split(' ');
                const command = args.shift();

                // --- GARANTIA DE EULA ---
                try {
                    const eulaPath = path.join(instanceFolder, 'eula.txt');
                    // Força a escrita do EULA true antes de cada boot
                    await fs.writeFile(eulaPath, 'eula=true');
                } catch (e) {
                    console.error(`Erro ao garantir EULA para ${instance.name}:`, e);
                }

                console.log(`Iniciando servidor ${instance.name} (ID: ${id}) na porta ${instance.port}...`);

                const child = spawn(command, args, {
                    cwd: instanceFolder,
                    stdio: 'inherit'
                });

                this.activeProcesses[id] = child;
                db.run("UPDATE instances SET status = 'running', pid = ? WHERE id = ?", [child.pid, id]);

                // Escuta o fechamento do processo
                child.on('close', (code) => {
                    console.log(`Instância ${instance.name} parou com código ${code}`);
                    delete this.activeProcesses[id];

                    // Código 0 ou null (SIGTERM) geralmente é parada manual
                    if (code === 0 || code === null) {
                        this.retryCounters[id] = 0; // Reseta contador
                        db.run("UPDATE instances SET status = 'stopped', pid = null WHERE id = ?", [id]);
                    } else {
                        // Se caiu com erro (ex: crash), tenta reiniciar
                        this.handleCrash(id);
                    }
                });

                resolve(child.pid);
            });
        });
    }

    // Lógica de Reinício Automático
    handleCrash(id) {
        // Inicializa contador se não existir
        if (!this.retryCounters[id]) this.retryCounters[id] = 0;

        if (this.retryCounters[id] < 3) {
            this.retryCounters[id]++;
            console.log(`⚠️ Servidor ID ${id} crashou. Tentativa de reinício ${this.retryCounters[id]}/3 em 5 segundos...`);
            
            // Atualiza status para 'restarting'
            db.run("UPDATE instances SET status = 'restarting' WHERE id = ?", [id]);

            setTimeout(() => {
                this.startInstance(id).catch(err => console.error("Falha ao reiniciar:", err));
            }, 5000); // Espera 5 segundos antes de tentar de novo
        } else {
            console.error(`❌ Servidor ID ${id} falhou 3 vezes consecutivas. Desistindo.`);
            this.retryCounters[id] = 0;
            db.run("UPDATE instances SET status = 'crashed', pid = null WHERE id = ?", [id]);
        }
    }

    stopInstance(id) {
        const child = this.activeProcesses[id];
        if (child) {
            // Zera o contador para não tentar reiniciar quando paramos manualmente
            this.retryCounters[id] = 0; 
            child.kill('SIGTERM'); 
            // Em alguns casos Minecraft precisa de SIGINT, mas SIGTERM costuma funcionar para salvar
        }
    }
}

module.exports = new InstanceService();