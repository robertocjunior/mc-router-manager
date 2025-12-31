const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../database/db');
const routerService = require('./routerService');
const AdmZip = require('adm-zip'); // NOVA DEPENDÊNCIA

class InstanceService {
    constructor() {
        this.instancesDir = path.join(process.cwd(), 'data', 'instances');
        this.activeProcesses = {};
        this.routerPort = parseInt(process.env.MC_ROUTER_PORT || 25565);
        this.retryCounters = {};
    }

    // ... (createInstance, deleteInstance, startInstance, etc. mantêm-se iguais) ...
    // Vou colocar apenas as partes que mudaram ou são novas para não ficar gigante, 
    // mas certifique-se de manter os métodos create, start, stop, delete, getLogs, getProperties, saveProperties.

    // ---------------------------------------------------------
    // MÉTODOS EXISTENTES (Resumidos para referência - MANTENHA ELES)
    // ---------------------------------------------------------
    async createInstance(name, domain, file, customCommand) {
        // ... (seu código anterior aqui)
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
                    await fs.writeFile(path.join(instanceFolder, 'latest.log'), '');
                } catch (ioErr) {
                    return reject(ioErr);
                }

                let cmd = customCommand || 'java -Xmx1024M -Xms1024M -jar {jar} nogui';
                cmd = cmd.replace('{jar}', jarName);

                db.run("INSERT INTO instances (name, domain, port, jarFile, startCommand) VALUES (?, ?, ?, ?, ?)",
                    [name, domain, port, jarName, cmd],
                    function (dbErr) {
                        if (dbErr) return reject(dbErr);
                        const instanceId = this.lastID;
                        db.run("INSERT INTO routes (sourceDomain, listeningPort, destHost, destPort, description) VALUES (?, ?, ?, ?, ?)",
                            [domain, this.routerPort, '127.0.0.1', port, `Auto-generated for ${name}`],
                            (routeErr) => { if (!routeErr) routerService.syncAndRestart(); }
                        );
                        resolve({ id: instanceId, port, name });
                    }
                );
            });
        });
    }

    async deleteInstance(id) {
        // ... (seu código anterior aqui)
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE id = ?", [id], async (err, instance) => {
                if (err || !instance) return reject("Server not found");
                this.stopInstance(id);
                const instanceFolder = path.join(this.instancesDir, instance.name);
                try { await fs.remove(instanceFolder); } catch (e) {}
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
        // ... (seu código anterior aqui)
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE id = ?", [id], async (err, instance) => {
                if (err || !instance) return reject("Instância não encontrada");
                if (this.activeProcesses[id]) return resolve(this.activeProcesses[id].pid);

                const instanceFolder = path.join(this.instancesDir, instance.name);
                const args = instance.startCommand.split(' ');
                const command = args.shift();

                try { await fs.writeFile(path.join(instanceFolder, 'eula.txt'), 'eula=true'); } catch (e) {}
                const logFile = fs.createWriteStream(path.join(instanceFolder, 'latest.log'), { flags: 'a' });

                console.log(`Iniciando servidor ${instance.name} (ID: ${id})...`);
                const child = spawn(command, args, { cwd: instanceFolder, stdio: ['ignore', 'pipe', 'pipe'] });

                child.stdout.on('data', (data) => { logFile.write(data); process.stdout.write(`[${instance.name}] ${data}`); });
                child.stderr.on('data', (data) => { logFile.write(data); process.stderr.write(`[${instance.name} ERR] ${data}`); });

                this.activeProcesses[id] = child;
                db.run("UPDATE instances SET status = 'running', pid = ? WHERE id = ?", [child.pid, id]);

                child.on('close', (code) => {
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
            setTimeout(() => { this.startInstance(id).catch(err => console.error(err)); }, 5000);
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

    async getLogs(id) {
        return new Promise((resolve) => {
            db.get("SELECT name FROM instances WHERE id = ?", [id], async (err, row) => {
                if (err || !row) return resolve("");
                const logPath = path.join(this.instancesDir, row.name, 'latest.log');
                try {
                    if (await fs.pathExists(logPath)) {
                        const data = await fs.readFile(logPath, 'utf8');
                        resolve(data.slice(-50000));
                    } else { resolve("Log file not found yet."); }
                } catch (e) { resolve("Error reading logs."); }
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
                        const data = await fs.readFile(propPath, 'utf8');
                        resolve(data);
                    } else { resolve("# File not found yet"); }
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
        this.stopInstance(id);
        return new Promise(resolve => {
            setTimeout(async () => {
                await this.startInstance(id);
                resolve();
            }, 2000);
        });
    }

    // ---------------------------------------------------------
    // NOVOS MÉTODOS DE MUNDO (BACKUP/RESTORE)
    // ---------------------------------------------------------

    // Auxiliar: Descobre o nome da pasta do mundo lendo server.properties
    async _getWorldFolderName(instanceName) {
        const propPath = path.join(this.instancesDir, instanceName, 'server.properties');
        try {
            if (await fs.pathExists(propPath)) {
                const content = await fs.readFile(propPath, 'utf8');
                const match = content.match(/^level-name=(.*)$/m);
                if (match && match[1]) {
                    return match[1].trim();
                }
            }
        } catch (e) {}
        return 'world'; // Padrão do Minecraft
    }

    // Gerar ZIP do Mundo
    async downloadWorld(id) {
        return new Promise((resolve, reject) => {
            db.get("SELECT name FROM instances WHERE id = ?", [id], async (err, row) => {
                if (err || !row) return reject("Instance not found");
                
                const instanceName = row.name;
                const worldName = await this._getWorldFolderName(instanceName);
                const worldPath = path.join(this.instancesDir, instanceName, worldName);
                
                if (!await fs.pathExists(worldPath)) {
                    return reject("World folder not found: " + worldName);
                }

                // Cria um ZIP na memória/temp
                try {
                    const zip = new AdmZip();
                    // Adiciona o conteúdo da pasta world dentro do zip
                    zip.addLocalFolder(worldPath); 
                    
                    const zipPath = path.join(this.instancesDir, instanceName, `${worldName}_dump.zip`);
                    zip.writeZip(zipPath); // Salva no disco
                    resolve(zipPath);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    // Restaurar ZIP do Mundo
    async restoreWorld(id, zipFile) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE id = ?", [id], async (err, instance) => {
                if (err || !instance) return reject("Instance not found");

                // 1. Para o servidor se estiver rodando
                this.stopInstance(id);
                await new Promise(r => setTimeout(r, 2000)); // Espera parar

                const worldName = await this._getWorldFolderName(instance.name);
                const worldPath = path.join(this.instancesDir, instance.name, worldName);

                try {
                    // 2. Limpa a pasta do mundo atual (Backup seria ideal, mas aqui vamos substituir)
                    await fs.emptyDir(worldPath);

                    // 3. Extrai o ZIP novo
                    const zip = new AdmZip(zipFile.path);
                    zip.extractAllTo(worldPath, true); // true = overwrite

                    // 4. Inicia o servidor novamente
                    this.startInstance(id);
                    resolve();

                } catch (e) {
                    reject(e);
                }
            });
        });
    }
}

module.exports = new InstanceService();