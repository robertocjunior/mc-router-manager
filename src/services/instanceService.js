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
        
        // Garante pasta temporária para downloads de zip
        fs.ensureDirSync(path.join(process.cwd(), 'temp_uploads'));
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

                this.stopInstance(id);

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

    stopInstance(id) {
        const child = this.activeProcesses[id];
        if (child) {
            this.retryCounters[id] = 0;
            child.kill('SIGTERM');
        }
    }

    async stopAndWait(id) {
        return new Promise((resolve) => {
            const child = this.activeProcesses[id];
            if (!child) return resolve(); 

            console.log(`Parando servidor ID ${id} e aguardando encerramento...`);
            this.retryCounters[id] = 0;
            
            child.removeAllListeners('close'); 
            child.on('close', () => {
                delete this.activeProcesses[id];
                db.run("UPDATE instances SET status = 'stopped', pid = null WHERE id = ?", [id], () => {
                    resolve();
                });
            });

            child.kill('SIGTERM');

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
        await this.stopAndWait(id);
        await this.startInstance(id);
    }

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

    async restoreWorld(id, zipFile) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE id = ?", [id], async (err, instance) => {
                if (err || !instance) return reject("Instance not found");

                await this.stopAndWait(id);

                const worldName = await this._getWorldFolderName(instance.name);
                const worldPath = path.join(this.instancesDir, instance.name, worldName);

                try {
                    await fs.emptyDir(worldPath);
                    const zip = new AdmZip(zipFile.path);
                    zip.extractAllTo(worldPath, true);
                    await this.startInstance(id);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async resetWorld(id) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE id = ?", [id], async (err, instance) => {
                if (err || !instance) return reject("Instance not found");

                await this.stopAndWait(id);

                const worldName = await this._getWorldFolderName(instance.name);
                const worldPath = path.join(this.instancesDir, instance.name, worldName);

                try {
                    if (await fs.pathExists(worldPath)) {
                        await fs.remove(worldPath);
                    }
                    await this.startInstance(id);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    // ---------------------------------------------------------
    // FILE MANAGER
    // ---------------------------------------------------------

    async _resolveSafePath(instanceId, subpath) {
        return new Promise((resolve, reject) => {
            db.get("SELECT name FROM instances WHERE id = ?", [instanceId], (err, row) => {
                if (err || !row) return reject("Server not found");
                
                const rootPath = path.resolve(this.instancesDir, row.name);
                const requestedPath = path.resolve(rootPath, subpath || '.');

                if (!requestedPath.startsWith(rootPath)) {
                    return reject("Access Denied: Path traversal detected");
                }

                resolve({ fullPath: requestedPath, rootPath, instanceName: row.name });
            });
        });
    }

    async listFiles(id, subpath) {
        try {
            const { fullPath } = await this._resolveSafePath(id, subpath);
            
            if (!await fs.pathExists(fullPath)) return [];
            
            const stats = await fs.stat(fullPath);
            if (!stats.isDirectory()) return [];

            const files = await fs.readdir(fullPath, { withFileTypes: true });
            
            // Tratamento de erro robusto dentro do map para não quebrar tudo se 1 arquivo falhar
            const result = (await Promise.all(files.map(async (file) => {
                try {
                    const filePath = path.join(fullPath, file.name);
                    const fileStat = await fs.stat(filePath);
                    return {
                        name: file.name,
                        isDirectory: file.isDirectory(),
                        size: fileStat.size,
                        mtime: fileStat.mtime
                    };
                } catch (err) {
                    return null; // Ignora arquivos com erro de permissão/leitura
                }
            }))).filter(x => x !== null);
            
            return result.sort((a, b) => {
                if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
                return a.isDirectory ? -1 : 1;
            });
        } catch (e) {
            throw new Error("Error listing files: " + e.message);
        }
    }

    async getFileContent(id, subpath) {
        try {
            const { fullPath } = await this._resolveSafePath(id, subpath);
            const content = await fs.readFile(fullPath, 'utf8');
            return content;
        } catch (e) {
            throw new Error("Error reading file");
        }
    }

    async writeFileContent(id, subpath, content) {
        try {
            const { fullPath } = await this._resolveSafePath(id, subpath);
            await fs.writeFile(fullPath, content, 'utf8');
        } catch (e) {
            throw new Error("Error writing file");
        }
    }

    async createDirectory(id, subpath) {
        try {
            const { fullPath } = await this._resolveSafePath(id, subpath);
            await fs.ensureDir(fullPath);
        } catch (e) {
            throw new Error("Error creating directory");
        }
    }

    async deleteFileOrFolder(id, subpath) {
        try {
            const { fullPath, rootPath } = await this._resolveSafePath(id, subpath);
            if (fullPath === rootPath) throw new Error("Cannot delete root folder");
            await fs.remove(fullPath);
        } catch (e) {
            throw new Error("Error deleting");
        }
    }

    // NOVO: Renomear ou Mover arquivo
    async renameFile(id, oldPath, newPath) {
        try {
            // Resolve ambos os caminhos com verificação de segurança
            const { fullPath: oldFull } = await this._resolveSafePath(id, oldPath);
            const { fullPath: newFull } = await this._resolveSafePath(id, newPath);
            
            // Garante que a pasta de destino exista
            await fs.ensureDir(path.dirname(newFull));
            
            await fs.move(oldFull, newFull, { overwrite: true });
        } catch (e) {
            throw new Error("Error moving/renaming: " + e.message);
        }
    }

    async uploadFileToFolder(id, subpath, file) {
        try {
            const { fullPath } = await this._resolveSafePath(id, subpath);
            let targetDir = fullPath;
            if (await fs.pathExists(fullPath) && (await fs.stat(fullPath)).isFile()) {
                targetDir = path.dirname(fullPath);
            }
            if (!await fs.pathExists(targetDir)) await fs.ensureDir(targetDir);
            await fs.move(file.path, path.join(targetDir, file.originalname), { overwrite: true });
        } catch (e) {
            throw new Error("Error uploading file");
        }
    }
    
    // ATUALIZADO: Suporte a Download de Pasta (via ZIP)
    async getDownloadPath(id, subpath) {
        const { fullPath, instanceName } = await this._resolveSafePath(id, subpath);
        
        if (!await fs.pathExists(fullPath)) throw new Error("Path not found");
        
        const stats = await fs.stat(fullPath);
        
        if (stats.isFile()) {
            // Arquivo normal
            return { path: fullPath, name: path.basename(fullPath), isTemp: false };
        } else if (stats.isDirectory()) {
            // Pasta -> Cria ZIP temporário
            const zip = new AdmZip();
            zip.addLocalFolder(fullPath);
            
            const zipName = `${path.basename(fullPath)}.zip`;
            const tempPath = path.join(process.cwd(), 'temp_uploads', `${instanceName}_${Date.now()}_${zipName}`);
            
            zip.writeZip(tempPath);
            return { path: tempPath, name: zipName, isTemp: true };
        }
        
        throw new Error("Invalid path type");
    }
}

module.exports = new InstanceService();