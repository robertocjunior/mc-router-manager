const db = require('../database/db');
const instanceService = require('../services/instanceService');
const fileService = require('../services/fileService');
const fs = require('fs-extra');

const ROUTER_PORT = process.env.MC_ROUTER_PORT || 25565;

exports.dashboard = (req, res) => {
    db.all("SELECT * FROM instances", (err, instances) => {
        res.render('dashboard', { instances: instances || [], user: req.session.user, routerPort: ROUTER_PORT, query: req.query });
    });
};

exports.getServer = async (req, res) => {
    const uuid = req.params.uuid;
    let properties = "";
    try {
        properties = await instanceService.getProperties(uuid);
    } catch (e) {
        properties = "# Error reading file or file not created yet.";
    }

    db.get("SELECT * FROM instances WHERE uuid = ?", [uuid], (err, instance) => {
        if (err || !instance) return res.redirect('/');
        res.render('server', { instance, user: req.session.user, routerPort: ROUTER_PORT, properties, query: req.query });
    });
};

exports.getLogs = async (req, res) => {
    const logs = await instanceService.getLogs(req.params.uuid);
    res.send(logs);
};

exports.getStatus = async (req, res) => {
    try {
        const status = await instanceService.getServerStatus(req.params.uuid);
        res.json({ success: true, ...status });
    } catch (e) {
        res.json({ success: false, online: false });
    }
};

exports.createInstance = async (req, res) => {
    try {
        const { name, domain, startCommand } = req.body;
        const file = req.file;
        if (!file || !name || !domain) return res.redirect('/?error=Missing fields');
        const newInstance = await instanceService.createInstance(name, domain, file, startCommand);
        await instanceService.startInstance(newInstance.uuid);
        res.redirect('/');
    } catch (error) { res.redirect('/?error=' + encodeURIComponent(error.message)); }
};

exports.startInstance = async (req, res) => {
    try {
        await instanceService.startInstance(req.params.uuid);
        res.redirect('/server/' + req.params.uuid);
    } catch (error) {
        res.redirect('/server/' + req.params.uuid + '?error=' + encodeURIComponent(error));
    }
};

exports.stopInstance = async (req, res) => {
    instanceService.stopInstance(req.params.uuid);
    setTimeout(() => res.redirect('/server/' + req.params.uuid), 1000);
};

exports.deleteInstance = async (req, res) => {
    try {
        await instanceService.deleteInstance(req.params.uuid);
        res.redirect('/');
    } catch (error) {
        res.redirect('/server/' + req.params.uuid + '?error=' + encodeURIComponent(error));
    }
};

exports.saveProperties = async (req, res) => {
    try {
        await instanceService.saveProperties(req.params.uuid, req.body.content);
        await instanceService.restartInstance(req.params.uuid);
        res.redirect('/server/' + req.params.uuid + '?success=Properties saved. Server restarting...');
    } catch (error) {
        res.redirect('/server/' + req.params.uuid + '?error=' + encodeURIComponent(error.message));
    }
};

exports.updateSettings = async (req, res) => {
    try {
        await instanceService.updateSettings(req.params.uuid, req.body);
        res.redirect('/server/' + req.params.uuid + '?success=Settings updated.');
    } catch (error) {
        res.redirect('/server/' + req.params.uuid + '?error=' + encodeURIComponent(error.message));
    }
};

exports.sendCommand = async (req, res) => {
    try {
        await instanceService.sendCommand(req.params.uuid, req.body.command);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// --- World Manager ---
exports.downloadWorld = async (req, res) => {
    try {
        const zipPath = await instanceService.downloadWorld(req.params.uuid);
        res.download(zipPath, 'world-backup.zip');
    } catch (error) {
        res.status(500).send("Error: " + error.message);
    }
};

exports.uploadWorld = async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.redirect('/server/' + req.params.uuid + '?error=No file');
        await instanceService.restoreWorld(req.params.uuid, file);
        res.redirect('/server/' + req.params.uuid + '?success=Restored.');
    } catch (error) {
        res.redirect('/server/' + req.params.uuid + '?error=' + encodeURIComponent(error.message));
    }
};

exports.resetWorld = async (req, res) => {
    try {
        await instanceService.resetWorld(req.params.uuid);
        res.redirect('/server/' + req.params.uuid + '?success=Reset done.');
    } catch (error) {
        res.redirect('/server/' + req.params.uuid + '?error=' + encodeURIComponent(error.message));
    }
};

// --- File Manager (Using FileService) ---
exports.listFiles = async (req, res) => {
    try {
        const path = req.query.path || '';
        const files = await fileService.listFiles(req.params.uuid, path);
        res.json({ success: true, files, path });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.getFileContent = async (req, res) => {
    try {
        const content = await fileService.getFileContent(req.params.uuid, req.query.path);
        res.json({ success: true, content });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.saveFileContent = async (req, res) => {
    try {
        await fileService.writeFileContent(req.params.uuid, req.body.path, req.body.content);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.mkdir = async (req, res) => {
    try {
        await fileService.createDirectory(req.params.uuid, req.body.path);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.deleteFile = async (req, res) => {
    try {
        await fileService.deleteFileOrFolder(req.params.uuid, req.body.path);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.renameFile = async (req, res) => {
    try {
        await fileService.renameFile(req.params.uuid, req.body.oldPath, req.body.newPath);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.uploadFile = async (req, res) => {
    try {
        if (!req.file) throw new Error("No file");
        await fileService.uploadFileToFolder(req.params.uuid, req.body.path, req.file);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
};

exports.downloadFile = async (req, res) => {
    try {
        const { path: filePath, name, isTemp } = await fileService.getDownloadPath(req.params.uuid, req.query.path);
        res.download(filePath, name, (err) => {
            if (isTemp) fs.unlink(filePath, () => {});
        });
    } catch (e) { res.status(404).send("File not found or access denied."); }
};