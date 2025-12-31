const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../database/db');
const routerService = require('./routerService');
const AdmZip = require('adm-zip');

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
                if (port === this.routerPort) port++; // Pula a porta do router

                const instanceFolder = path.join(this.instancesDir, name);
                const jarName = file.filename;

                try {
                    await fs.ensureDir(instanceFolder);
                    await fs.move(file.path, path.join(instanceFolder, jarName));
                    await fs.writeFile(path.join(instanceFolder, 'eula.txt'), 'eula=true');
                    await fs.writeFile(path.join(instanceFolder, 'server.properties'), `server-port=${port}\nonline-mode=false`);
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

    async deleteInstance(id) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE id = ?", [id], async (err, instance) => {
                if (err || !instance) return reject("Server not found");

                this.stopInstance(id); // Para o processo

                const instanceFolder = path.join(this.instancesDir, instance.name);
                try {
                    await fs.remove(instanceFolder);
                } catch (e) {
                    console.error("Erro ao apagar pasta:", e);
                }

                db.run("DELETE FROM routes WHERE destPort = ?", [instance.port], (err) => {
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
                
                // Se já existe um processo ativo, retorna o PID dele
                if (this.activeProcesses[id]) {
                    return resolve(this.activeProcesses[id].pid);
                }

                const instanceFolder = path.join(this.instancesDir, instance.name);
                const args = instance.startCommand.split(' ');
                const command = args.shift();

                try {
                    await fs.writeFile(path.join(instanceFolder, 'eula.txt'), 'eula=true');
                } catch (e) {}

                const logFile = fs.createWriteStream(path.join(instanceFolder, 'latest.log'), { flags: 'a' });

                console.log(`Iniciando servidor ${instance.name} (ID: ${id})...`);

                const child = spawn(command, args, {
                    cwd: instanceFolder,
                    stdio: ['ignore', 'pipe', 'pipe']
                });

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

                    if (code === 0 || code === null || code === 143 || code === 130) {
                        // 0=Normal, null=Signal, 143=SIGTERM, 130=SIGINT
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
            console.log(`⚠️ Servidor ID ${id} crashou. Tentativa ${this.retryCounters[id]}/3.`);
            
            db.run("UPDATE instances SET status = 'restarting' WHERE id = ?", [id]);

            setTimeout(() => {
                this.startInstance(id).catch(err => console.error("Falha ao reiniciar:", err));
            }, 5000);
        } else {
            console.error(`❌ Servidor ID ${id} desistiu após 3 falhas.`);
            this.retryCounters[id] = 0;
            db.run("UPDATE instances SET status = 'crashed', pid = null WHERE id = ?", [id]);
        }
    }

    // Para o servidor (síncrono/imediato)
    stopInstance(id) {
        const child = this.activeProcesses[id];
        if (child) {
            this.retryCounters[id] = 0; // Impede retry automático
            child.kill('SIGTERM');
        }
    }

    // NOVA FUNÇÃO: Para o servidor e ESPERA ele morrer (Promise)
    async stopAndWait(id) {
        return new Promise((resolve) => {
            const child = this.activeProcesses[id];
            if (!child) return resolve(); // Já está parado

            console.log(`Parando servidor ID ${id} e aguardando encerramento...`);
            this.retryCounters[id] = 0;
            
            // Escuta o evento de fechamento deste processo específico
            child.removeAllListeners('close'); // Remove listener padrão para não acionar crash handler
            child.on('close', () => {
                delete this.activeProcesses[id];
                db.run("UPDATE instances SET status = 'stopped', pid = null WHERE id = ?", [id], () => {
                    resolve();
                });
            });

            child.kill('SIGTERM');

            // Timeout de segurança: se não fechar em 10s, resolve mesmo assim
            setTimeout(() => {
                if (this.activeProcesses[id]) {
                    console.log("Forçando morte do processo...");
                    child.kill('SIGKILL');
                    delete this.activeProcesses[id];
                    resolve();
                }
            }, 10000);
        });
    }

    async getLogs(id) {
        return new Promise((resolve) => {
            db.get("SELECT name FROM instances WHERE id = ?", [id], async (err, row) => {
                if (err || !row) return resolve("");
                const logPath = path.join(this.instancesDir, row.name, 'latest.log');
                try {
                    if (await fs.pathExists(logPath)) {
                        const data = await fs.readFile(logPath, 'utf8');
                        resolve(data.slice(-50000));
                    } else {
                        resolve("Log file not found yet.");
                    }
                } catch (e) {
                    resolve("Error reading logs.");
                }
            });
        });
    }

    async getProperties(id) {
        return new Promise((resolve, reject) => {
            db.get("SELECT name FROM instances WHERE id = ?", [id], async (err, row) => {
                if (err || !row) return reject("Instance not found");
                const propPath = path.join(this.instancesDir, row.name, 'server.properties');
                try {
                    if (await fs.pathExists(propPath)) {
                        resolve(await fs.readFile(propPath, 'utf8'));
                    } else {
                        resolve("# File not found yet");
                    }
                } catch (e) { reject(e); }
            });
        });
    }

    async saveProperties(id, content) {
        return new Promise((resolve, reject) => {
            db.get("SELECT name, port FROM instances WHERE id = ?", [id], async (err, row) => {
                if (err || !row) return reject("Instance not found");
                const propPath = path.join(this.instancesDir, row.name, 'server.properties');
                
                let safeContent = content;
                // Garante que a porta não seja alterada
                const portRegex = /^server-port=.*/m;
                if (portRegex.test(safeContent)) {
                    safeContent = safeContent.replace(portRegex, `server-port=${row.port}`);
                } else {
                    safeContent += `\nserver-port=${row.port}`;
                }

                try {
                    await fs.writeFile(propPath, safeContent);
                    resolve();
                } catch (e) { reject(e); }
            });
        });
    }

    async restartInstance(id) {
        // Usa o novo método seguro
        await this.stopAndWait(id);
        await this.startInstance(id);
    }

    // --- MÉTODOS DE MUNDO ---

    async _getWorldFolderName(instanceName) {
        const propPath = path.join(this.instancesDir, instanceName, 'server.properties');
        try {
            if (await fs.pathExists(propPath)) {
                const content = await fs.readFile(propPath, 'utf8');
                const match = content.match(/^level-name=(.*)$/m);
                if (match && match[1]) return match[1].trim();
            }
        } catch (e) {}
        return 'world';
    }

    async downloadWorld(id) {
        return new Promise((resolve, reject) => {
            db.get("SELECT name FROM instances WHERE id = ?", [id], async (err, row) => {
                if (err || !row) return reject("Instance not found");
                
                const instanceName = row.name;
                const worldName = await this._getWorldFolderName(instanceName);
                const worldPath = path.join(this.instancesDir, instanceName, worldName);
                
                if (!await fs.pathExists(worldPath)) return reject("World folder not found");

                try {
                    const zip = new AdmZip();
                    zip.addLocalFolder(worldPath);
                    const zipPath = path.join(this.instancesDir, instanceName, `${worldName}_dump.zip`);
                    zip.writeZip(zipPath);
                    resolve(zipPath);
                } catch (e) { reject(e); }
            });
        });
    }

    // ATUALIZADO: Agora usa stopAndWait para garantir o restart
    async restoreWorld(id, zipFile) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE id = ?", [id], async (err, instance) => {
                if (err || !instance) return reject("Instance not found");

                // 1. Para o servidor e ESPERA ele fechar completamente
                await this.stopAndWait(id);

                const worldName = await this._getWorldFolderName(instance.name);
                const worldPath = path.join(this.instancesDir, instance.name, worldName);

                try {
                    // 2. Limpa e extrai
                    await fs.emptyDir(worldPath);
                    const zip = new AdmZip(zipFile.path);
                    zip.extractAllTo(worldPath, true);

                    // 3. Inicia novamente
                    await this.startInstance(id);
                    resolve();

                } catch (e) {
                    reject(e);
                }
            });
        });
    }
}

module.exports = new InstanceService();