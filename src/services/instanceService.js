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
    }

    async createInstance(name, domain, file, customCommand) {
        return new Promise((resolve, reject) => {
            db.get("SELECT MAX(port) as maxPort FROM instances", async (err, row) => {
                if (err) return reject(err);
                
                // Lógica inteligente de portas
                let port = (row && row.maxPort) ? row.maxPort + 1 : 25566;
                
                // SEGURANÇA: Se a porta calculada for igual à porta do Router, pula uma
                if (port === this.routerPort) {
                    port++;
                }

                const instanceFolder = path.join(this.instancesDir, name);
                const jarName = file.filename;

                try {
                    await fs.ensureDir(instanceFolder);
                    await fs.move(file.path, path.join(instanceFolder, jarName));
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

                        // Usa a variável this.routerPort para salvar no banco corretamente
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
            db.get("SELECT * FROM instances WHERE id = ?", [id], (err, instance) => {
                if (err || !instance) return reject("Instância não encontrada");
                if (this.activeProcesses[id]) return resolve("Já está rodando");

                const instanceFolder = path.join(this.instancesDir, instance.name);
                const args = instance.startCommand.split(' ');
                const command = args.shift();

                console.log(`Iniciando servidor ${instance.name} na porta ${instance.port}...`);

                const child = spawn(command, args, {
                    cwd: instanceFolder,
                    stdio: 'inherit'
                });

                this.activeProcesses[id] = child;

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