const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../database/db');
const routerService = require('./routerService');

class InstanceService {
    constructor() {
        this.instancesDir = path.join(process.cwd(), 'data', 'instances');
        this.activeProcesses = {}; // Armazena processos em memória: { instanceId: ChildProcess }
        
        // Recarrega processos se o app reiniciar (Feature futura)
    }

    // Cria um novo servidor
    async createInstance(name, domain, file, customCommand) {
        return new Promise((resolve, reject) => {
            // 1. Determina uma porta livre (Simples: começa em 25566 e incrementa)
            db.get("SELECT MAX(port) as maxPort FROM instances", async (err, row) => {
                if (err) return reject(err);
                
                let port = (row && row.maxPort) ? row.maxPort + 1 : 25566;
                const instanceFolder = path.join(this.instancesDir, name);
                const jarName = file.filename; // Nome salvo pelo Multer

                // 2. Cria estrutura de pastas
                try {
                    await fs.ensureDir(instanceFolder);
                    // Move o arquivo de upload (temp) para a pasta da instância
                    await fs.move(file.path, path.join(instanceFolder, jarName));
                    
                    // Cria eula.txt automaticamente
                    await fs.writeFile(path.join(instanceFolder, 'eula.txt'), 'eula=true');
                    
                    // Cria server.properties básico para fixar a porta
                    await fs.writeFile(path.join(instanceFolder, 'server.properties'), `server-port=${port}\nonline-mode=false`);

                } catch (ioErr) {
                    return reject(ioErr);
                }

                // 3. Comando de inicialização padrão ou customizado
                // Se não vier comando, usa o padrão. Substitui {jar} pelo nome do arquivo.
                let cmd = customCommand || 'java -Xmx1024M -Xms1024M -jar {jar} nogui';
                cmd = cmd.replace('{jar}', jarName);

                // 4. Salva no DB
                db.run(
                    "INSERT INTO instances (name, domain, port, jarFile, startCommand) VALUES (?, ?, ?, ?, ?)",
                    [name, domain, port, jarName, cmd],
                    function (dbErr) {
                        if (dbErr) return reject(dbErr);
                        
                        const instanceId = this.lastID;

                        // 5. Adiciona a rota automaticamente no Router Service
                        // Mapeia o domínio para localhost:porta
                        db.run("INSERT INTO routes (sourceDomain, listeningPort, destHost, destPort, description) VALUES (?, ?, ?, ?, ?)",
                            [domain, 25565, '127.0.0.1', port, `Auto-generated for ${name}`],
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

    // Inicia o processo do servidor
    startInstance(id) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE id = ?", [id], (err, instance) => {
                if (err || !instance) return reject("Instância não encontrada");
                if (this.activeProcesses[id]) return resolve("Já está rodando");

                const instanceFolder = path.join(this.instancesDir, instance.name);
                const args = instance.startCommand.split(' ');
                const command = args.shift(); // 'java'

                console.log(`Iniciando servidor ${instance.name} na porta ${instance.port}...`);

                const child = spawn(command, args, {
                    cwd: instanceFolder,
                    stdio: 'inherit' // Por enquanto joga o log no console principal
                });

                this.activeProcesses[id] = child;

                // Atualiza status
                db.run("UPDATE instances SET status = 'running', pid = ? WHERE id = ?", [child.pid, id]);

                child.on('close', (code) => {
                    console.log(`Instância ${instance.name} parou com código ${code}`);
                    delete this.activeProcesses[id];
                    db.run("UPDATE instances SET status = 'stopped', pid = null WHERE id = ?", [id]);
                });

                resolve(child.pid);
            });
        });
    }
}

module.exports = new InstanceService();