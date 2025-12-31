const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../database/db');
const routerService = require('./routerService');

class InstanceService {
    constructor() {
        this.instancesDir = path.join(process.cwd(), 'data', 'instances');
        this.activeProcesses = {};
        this.routerPort = parseInt(process.env.MC_ROUTER_PORT || 25565);
        this.retryCounters = {};
    }

    async createInstance(name, domain, file, customCommand) {
        return new Promise((resolve, reject) => {
            db.get("SELECT MAX(port) as maxPort FROM instances", async (err, row) => {
                if (err) return reject(err);
                
                let port = (row && row.maxPort) ? row.maxPort + 1 : 25566;
                if (port === this.routerPort) port++;

                const instanceFolder = path.join(this.instancesDir, name);
                const jarName = file.filename;

                try {
                    await fs.ensureDir(instanceFolder);
                    await fs.move(file.path, path.join(instanceFolder, jarName));
                    await fs.writeFile(path.join(instanceFolder, 'eula.txt'), 'eula=true');
                    await fs.writeFile(path.join(instanceFolder, 'server.properties'), `server-port=${port}\nonline-mode=false`);
                    // Cria arquivo de log vazio
                    await fs.writeFile(path.join(instanceFolder, 'latest.log'), '');
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

    // NOVA FUNÇÃO: Deletar tudo
    async deleteInstance(id) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE id = ?", [id], async (err, instance) => {
                if (err || !instance) return reject("Server not found");

                // 1. Parar processo se estiver rodando
                this.stopInstance(id);

                // 2. Apagar pasta
                const instanceFolder = path.join(this.instancesDir, instance.name);
                try {
                    await fs.remove(instanceFolder);
                } catch (e) {
                    console.error("Erro ao apagar pasta:", e);
                }

                // 3. Apagar Rota do Banco
                db.run("DELETE FROM routes WHERE destPort = ?", [instance.port], (err) => {
                    // 4. Apagar Instância do Banco
                    db.run("DELETE FROM instances WHERE id = ?", [id], () => {
                        routerService.syncAndRestart();
                        resolve();
                    });
                });
            });
        });
    }

    startInstance(id) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE id = ?", [id], async (err, instance) => {
                if (err || !instance) return reject("Instância não encontrada");
                if (this.activeProcesses[id]) return resolve(this.activeProcesses[id].pid);

                const instanceFolder = path.join(this.instancesDir, instance.name);
                const args = instance.startCommand.split(' ');
                const command = args.shift();

                try {
                    await fs.writeFile(path.join(instanceFolder, 'eula.txt'), 'eula=true');
                } catch (e) {}

                // Configurar Logs: Escreve no arquivo e mantém no console do Docker
                const logFile = fs.createWriteStream(path.join(instanceFolder, 'latest.log'), { flags: 'a' });

                console.log(`Iniciando servidor ${instance.name} (ID: ${id})...`);

                const child = spawn(command, args, {
                    cwd: instanceFolder,
                    stdio: ['ignore', 'pipe', 'pipe'] // Pipe para capturar
                });

                // Redireciona stdout e stderr para o arquivo e para o console
                child.stdout.on('data', (data) => {
                    logFile.write(data);
                    process.stdout.write(`[${instance.name}] ${data}`);
                });

                child.stderr.on('data', (data) => {
                    logFile.write(data);
                    process.stderr.write(`[${instance.name} ERR] ${data}`);
                });

                this.activeProcesses[id] = child;
                db.run("UPDATE instances SET status = 'running', pid = ? WHERE id = ?", [child.pid, id]);

                child.on('close', (code) => {
                    console.log(`Instância ${instance.name} parou com código ${code}`);
                    logFile.end();
                    delete this.activeProcesses[id];

                    if (code === 0 || code === null) {
                        this.retryCounters[id] = 0;
                        db.run("UPDATE instances SET status = 'stopped', pid = null WHERE id = ?", [id]);
                    } else {
                        this.handleCrash(id);
                    }
                });

                resolve(child.pid);
            });
        });
    }

    handleCrash(id) {
        if (!this.retryCounters[id]) this.retryCounters[id] = 0;
        if (this.retryCounters[id] < 3) {
            this.retryCounters[id]++;
            db.run("UPDATE instances SET status = 'restarting' WHERE id = ?", [id]);
            setTimeout(() => {
                this.startInstance(id).catch(err => console.error("Falha ao reiniciar:", err));
            }, 5000);
        } else {
            this.retryCounters[id] = 0;
            db.run("UPDATE instances SET status = 'crashed', pid = null WHERE id = ?", [id]);
        }
    }

    stopInstance(id) {
        const child = this.activeProcesses[id];
        if (child) {
            this.retryCounters[id] = 0;
            child.kill('SIGTERM');
        }
    }

    // Ler Logs (últimas 100 linhas)
    async getLogs(id) {
        return new Promise((resolve, reject) => {
            db.get("SELECT name FROM instances WHERE id = ?", [id], async (err, row) => {
                if (err || !row) return resolve("");
                const logPath = path.join(this.instancesDir, row.name, 'latest.log');
                try {
                    if (await fs.pathExists(logPath)) {
                        const data = await fs.readFile(logPath, 'utf8');
                        // Pega as últimas 2000 chars para não travar a tela
                        const lines = data.slice(-50000); 
                        resolve(lines);
                    } else {
                        resolve("Log file not found yet.");
                    }
                } catch (e) {
                    resolve("Error reading logs.");
                }
            });
        });
    }
}

module.exports = new InstanceService();