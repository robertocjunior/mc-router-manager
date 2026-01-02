const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const db = require('../database/db');

class FileService {
    constructor() {
        this.instancesDir = path.join(process.cwd(), 'data', 'instances');
        fs.ensureDirSync(path.join(process.cwd(), 'temp_uploads'));
    }

    async _resolveSafePath(instanceUuid, subpath) {
        return new Promise((resolve, reject) => {
            db.get("SELECT name FROM instances WHERE uuid = ?", [instanceUuid], (err, row) => {
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

    async listFiles(uuid, subpath) {
        try {
            const { fullPath } = await this._resolveSafePath(uuid, subpath);
            if (!await fs.pathExists(fullPath)) return [];
            const stats = await fs.stat(fullPath);
            if (!stats.isDirectory()) return [];
            const files = await fs.readdir(fullPath, { withFileTypes: true });
            
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
                } catch (err) { return null; }
            }))).filter(x => x !== null);

            return result.sort((a, b) => {
                if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
                return a.isDirectory ? -1 : 1;
            });
        } catch (e) { throw new Error("Error listing files: " + e.message); }
    }

    async getFileContent(uuid, subpath) {
        try { 
            const { fullPath } = await this._resolveSafePath(uuid, subpath); 
            return await fs.readFile(fullPath, 'utf8'); 
        } catch (e) { throw new Error("Error reading file"); }
    }

    async writeFileContent(uuid, subpath, content) {
        try { 
            const { fullPath } = await this._resolveSafePath(uuid, subpath); 
            await fs.writeFile(fullPath, content, 'utf8'); 
        } catch (e) { throw new Error("Error writing file"); }
    }

    async createDirectory(uuid, subpath) {
        try { 
            const { fullPath } = await this._resolveSafePath(uuid, subpath); 
            await fs.ensureDir(fullPath); 
        } catch (e) { throw new Error("Error creating directory"); }
    }

    async deleteFileOrFolder(uuid, subpath) {
        try { 
            const { fullPath, rootPath } = await this._resolveSafePath(uuid, subpath); 
            if (fullPath === rootPath) throw new Error("Cannot delete root folder"); 
            await fs.remove(fullPath); 
        } catch (e) { throw new Error("Error deleting"); }
    }

    async renameFile(uuid, oldPath, newPath) {
        try {
            const { fullPath: oldFull } = await this._resolveSafePath(uuid, oldPath);
            const { fullPath: newFull } = await this._resolveSafePath(uuid, newPath);
            await fs.ensureDir(path.dirname(newFull));
            await fs.move(oldFull, newFull, { overwrite: true });
        } catch (e) { throw new Error("Error moving/renaming: " + e.message); }
    }

    async uploadFileToFolder(uuid, subpath, file) {
        try {
            const { fullPath } = await this._resolveSafePath(uuid, subpath);
            let targetDir = fullPath;
            if (await fs.pathExists(fullPath) && (await fs.stat(fullPath)).isFile()) {
                targetDir = path.dirname(fullPath);
            }
            if (!await fs.pathExists(targetDir)) await fs.ensureDir(targetDir);
            await fs.move(file.path, path.join(targetDir, file.originalname), { overwrite: true });
        } catch (e) { throw new Error("Error uploading file"); }
    }

    async getDownloadPath(uuid, subpath) {
        const { fullPath, instanceName } = await this._resolveSafePath(uuid, subpath);
        if (!await fs.pathExists(fullPath)) throw new Error("Path not found");
        const stats = await fs.stat(fullPath);
        
        if (stats.isFile()) {
            return { path: fullPath, name: path.basename(fullPath), isTemp: false };
        } else if (stats.isDirectory()) {
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

module.exports = new FileService();