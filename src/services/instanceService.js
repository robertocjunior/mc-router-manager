const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../database/db');
const routerService = require('./routerService');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const mcUtil = require('minecraft-server-util');

class InstanceService {
    constructor() {
        this.instancesDir = path.join(process.cwd(), 'data', 'instances');
        this.activeProcesses = {};
        this.routerPort = parseInt(process.env.MC_ROUTER_PORT || 25565);
        this.retryCounters = {};
        fs.ensureDirSync(this.instancesDir);
    }

    async createInstance(name, domain, file, customCommand) {
        return new Promise((resolve, reject) => {
            db.get("SELECT MAX(port) as maxPort FROM instances", async (err, row) => {
                if (err) return reject(err);
                
                let port = (row && row.maxPort) ? row.maxPort + 1 : 25566;
                if (port === this.routerPort) port++;
                
                const uuid = crypto.randomBytes(4).toString('hex');
                const instanceFolder = path.join(this.instancesDir, name);
                const jarName = file.filename;
                
                try {
                    await fs.ensureDir(instanceFolder);
                    await fs.move(file.path, path.join(instanceFolder, jarName));
                    await fs.writeFile(path.join(instanceFolder, 'eula.txt'), 'eula=true');
                    
                    const props = `server-port=${port}\nonline-mode=false\nenable-query=true\nquery.port=${port}`;
                    await fs.writeFile(path.join(instanceFolder, 'server.properties'), props);
                    await fs.writeFile(path.join(instanceFolder, 'latest.log'), '');
                } catch (ioErr) { return reject(ioErr); }
                
                let cmd = customCommand || 'java -Xmx1024M -Xms1024M -jar {jar} nogui';
                cmd = cmd.replace('{jar}', jarName);
                
                db.run("INSERT INTO instances (uuid, name, domain, port, jarFile, startCommand) VALUES (?, ?, ?, ?, ?, ?)", 
                    [uuid, name, domain, port, jarName, cmd], 
                    function (dbErr) {
                        if (dbErr) return reject(dbErr);
                        db.run("INSERT INTO routes (sourceDomain, listeningPort, destHost, destPort, description) VALUES (?, ?, ?, ?, ?)", 
                            [domain, this.routerPort, '127.0.0.1', port, `Auto-generated for ${name}`], 
                            (routeErr) => { if (!routeErr) routerService.syncAndRestart(); });
                        resolve({ uuid, port, name });
                    });
            });
        });
    }

    async deleteInstance(uuid) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE uuid = ?", [uuid], async (err, instance) => {
                if (err || !instance) return reject("Server not found");
                this.stopInstance(uuid);
                const instanceFolder = path.join(this.instancesDir, instance.name);
                try { await fs.remove(instanceFolder); } catch (e) {}
                db.run("DELETE FROM routes WHERE destPort = ?", [instance.port], (err) => {
                    db.run("DELETE FROM instances WHERE uuid = ?", [uuid], () => { routerService.syncAndRestart(); resolve(); });
                });
            });
        });
    }

    startInstance(uuid) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE uuid = ?", [uuid], async (err, instance) => {
                if (err || !instance) return reject("Instância não encontrada");
                if (this.activeProcesses[uuid]) return resolve(this.activeProcesses[uuid].pid);
                
                const instanceFolder = path.join(this.instancesDir, instance.name);
                const args = instance.startCommand.split(' ');
                const command = args.shift();
                
                try { await fs.writeFile(path.join(instanceFolder, 'eula.txt'), 'eula=true'); } catch (e) {}
                
                const logFile = fs.createWriteStream(path.join(instanceFolder, 'latest.log'), { flags: 'a' });
                console.log(`Iniciando servidor ${instance.name} (UUID: ${uuid})...`);
                
                const child = spawn(command, args, { cwd: instanceFolder, stdio: ['ignore', 'pipe', 'pipe'] });
                
                child.stdout.on('data', (data) => { logFile.write(data); process.stdout.write(`[${instance.name}] ${data}`); });
                child.stderr.on('data', (data) => { logFile.write(data); process.stderr.write(`[${instance.name} ERR] ${data}`); });
                
                this.activeProcesses[uuid] = child;
                db.run("UPDATE instances SET status = 'running', pid = ? WHERE uuid = ?", [child.pid, uuid]);
                
                child.on('close', (code) => {
                    logFile.end(); 
                    delete this.activeProcesses[uuid];
                    if (code === 0 || code === null || code === 143 || code === 130) {
                        this.retryCounters[uuid] = 0; 
                        db.run("UPDATE instances SET status = 'stopped', pid = null WHERE uuid = ?", [uuid]);
                    } else { 
                        this.handleCrash(uuid); 
                    }
                });
                resolve(child.pid);
            });
        });
    }

    handleCrash(uuid) {
        if (!this.retryCounters[uuid]) this.retryCounters[uuid] = 0;
        if (this.retryCounters[uuid] < 3) {
            this.retryCounters[uuid]++;
            db.run("UPDATE instances SET status = 'restarting' WHERE uuid = ?", [uuid]);
            setTimeout(() => { this.startInstance(uuid).catch(err => console.error(err)); }, 5000);
        } else {
            this.retryCounters[uuid] = 0; 
            db.run("UPDATE instances SET status = 'crashed', pid = null WHERE uuid = ?", [uuid]);
        }
    }

    stopInstance(uuid) {
        const child = this.activeProcesses[uuid];
        if (child) { this.retryCounters[uuid] = 0; child.kill('SIGTERM'); }
    }

    async stopAndWait(uuid) {
        return new Promise((resolve) => {
            const child = this.activeProcesses[uuid];
            if (!child) return resolve();
            this.retryCounters[uuid] = 0;
            child.removeAllListeners('close');
            child.on('close', () => {
                delete this.activeProcesses[uuid];
                db.run("UPDATE instances SET status = 'stopped', pid = null WHERE uuid = ?", [uuid], () => { resolve(); });
            });
            child.kill('SIGTERM');
            setTimeout(() => { if (this.activeProcesses[uuid]) { child.kill('SIGKILL'); delete this.activeProcesses[uuid]; resolve(); } }, 10000);
        });
    }

    async getLogs(uuid) {
        return new Promise((resolve) => {
            db.get("SELECT name FROM instances WHERE uuid = ?", [uuid], async (err, row) => {
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

    async getProperties(uuid) {
        return new Promise((resolve, reject) => {
            db.get("SELECT name FROM instances WHERE uuid = ?", [uuid], async (err, row) => {
                if (err || !row) return reject("Instance not found");
                const propPath = path.join(this.instancesDir, row.name, 'server.properties');
                try { if (await fs.pathExists(propPath)) { resolve(await fs.readFile(propPath, 'utf8')); } else { resolve("# File not found yet"); } } catch (e) { reject(e); }
            });
        });
    }

    async saveProperties(uuid, content) {
        return new Promise((resolve, reject) => {
            db.get("SELECT name, port FROM instances WHERE uuid = ?", [uuid], async (err, row) => {
                if (err || !row) return reject("Instance not found");
                const propPath = path.join(this.instancesDir, row.name, 'server.properties');
                
                let safeContent = content;
                const portRegex = /^server-port=.*/m;
                if (portRegex.test(safeContent)) safeContent = safeContent.replace(portRegex, `server-port=${row.port}`);
                else safeContent += `\nserver-port=${row.port}`;

                const queryRegex = /^enable-query=.*/m;
                if (queryRegex.test(safeContent)) safeContent = safeContent.replace(queryRegex, `enable-query=true`);
                else safeContent += `\nenable-query=true`;

                const queryPortRegex = /^query\.port=.*/m;
                if (queryPortRegex.test(safeContent)) safeContent = safeContent.replace(queryPortRegex, `query.port=${row.port}`);
                else safeContent += `\nquery.port=${row.port}`;

                try { await fs.writeFile(propPath, safeContent); resolve(); } catch (e) { reject(e); }
            });
        });
    }

    async getServerStatus(uuid) {
        return new Promise((resolve, reject) => {
            db.get("SELECT port, status FROM instances WHERE uuid = ?", [uuid], async (err, row) => {
                if (err || !row) return reject("Server not found");
                if (row.status !== 'running') return resolve({ online: false, players: 0, max: 0 });

                try {
                    const status = await mcUtil.status('127.0.0.1', row.port, { timeout: 1000 });
                    resolve({ online: true, players: status.players.online, max: status.players.max, version: status.version.name });
                } catch (e) { resolve({ online: false, players: 0, max: 0 }); }
            });
        });
    }

    async restartInstance(uuid) { await this.stopAndWait(uuid); await this.startInstance(uuid); }

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

    async downloadWorld(uuid) {
        return new Promise((resolve, reject) => {
            db.get("SELECT name FROM instances WHERE uuid = ?", [uuid], async (err, row) => {
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

    async restoreWorld(uuid, zipFile) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE uuid = ?", [uuid], async (err, instance) => {
                if (err || !instance) return reject("Instance not found");
                await this.stopAndWait(uuid);
                const worldName = await this._getWorldFolderName(instance.name);
                const worldPath = path.join(this.instancesDir, instance.name, worldName);
                try {
                    await fs.emptyDir(worldPath);
                    const zip = new AdmZip(zipFile.path);
                    zip.extractAllTo(worldPath, true);
                    await this.startInstance(uuid);
                    resolve();
                } catch (e) { reject(e); }
            });
        });
    }

    async resetWorld(uuid) {
        return new Promise((resolve, reject) => {
            db.get("SELECT * FROM instances WHERE uuid = ?", [uuid], async (err, instance) => {
                if (err || !instance) return reject("Instance not found");
                await this.stopAndWait(uuid);
                const worldName = await this._getWorldFolderName(instance.name);
                const worldPath = path.join(this.instancesDir, instance.name, worldName);
                try {
                    if (await fs.pathExists(worldPath)) { await fs.remove(worldPath); }
                    await this.startInstance(uuid);
                    resolve();
                } catch (e) { reject(e); }
            });
        });
    }

    async updateSettings(uuid, { domain, startCommand }) {
        return new Promise((resolve, reject) => {
            db.get("SELECT port FROM instances WHERE uuid = ?", [uuid], (err, row) => {
                if (err || !row) return reject("Server not found");
                db.run("UPDATE instances SET domain = ?, startCommand = ? WHERE uuid = ?", [domain, startCommand, uuid], (err) => {
                    if (err) return reject(err);
                    db.run("UPDATE routes SET sourceDomain = ? WHERE destPort = ?", [domain, row.port], (err) => {
                        if (err) return reject(err);
                        routerService.syncAndRestart();
                        resolve();
                    });
                });
            });
        });
    }

    async sendCommand(uuid, command) {
        return new Promise((resolve, reject) => {
            const process = this.activeProcesses[uuid];
            if (!process) return reject("Server is not running. Start it to manage players.");
            try {
                process.stdin.write(command + "\n");
                resolve();
            } catch (error) { reject("Failed to send command: " + error.message); }
        });
    }
}

module.exports = new InstanceService();