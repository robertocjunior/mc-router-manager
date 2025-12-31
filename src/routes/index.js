const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../database/db');
const instanceService = require('../services/instanceService');
const authMiddleware = require('../middleware/auth');
const fs = require('fs-extra');

const upload = multer({ dest: 'temp_uploads/' });
const ROUTER_PORT = process.env.MC_ROUTER_PORT || 25565;

router.use(authMiddleware);

// --- DASHBOARD E BÁSICOS ---

router.get('/', (req, res) => {
    db.all("SELECT * FROM instances", (err, instances) => {
        res.render('dashboard', { 
            instances: instances || [], 
            user: req.session.user,
            routerPort: ROUTER_PORT,
            query: req.query 
        });
    });
});

router.get('/server/:id', async (req, res) => {
    const id = req.params.id;
    let properties = "";
    try {
        properties = await instanceService.getProperties(id);
    } catch (e) {
        properties = "# Error reading file or file not created yet.";
    }

    db.get("SELECT * FROM instances WHERE id = ?", [id], (err, instance) => {
        if (err || !instance) return res.redirect('/');
        res.render('server', { 
            instance, 
            user: req.session.user,
            routerPort: ROUTER_PORT,
            properties,
            query: req.query 
        });
    });
});

router.get('/server/:id/logs', async (req, res) => {
    const logs = await instanceService.getLogs(req.params.id);
    res.send(logs);
});

// --- AÇÕES DO SERVIDOR ---

router.post('/instances/create', upload.single('serverJar'), async (req, res) => {
    try {
        const { name, domain, startCommand } = req.body;
        const file = req.file;
        if (!file || !name || !domain) return res.redirect('/?error=Missing fields');

        const newInstance = await instanceService.createInstance(name, domain, file, startCommand);
        await instanceService.startInstance(newInstance.id);
        res.redirect('/');
    } catch (error) {
        res.redirect('/?error=' + encodeURIComponent(error.message));
    }
});

router.post('/server/:id/start', async (req, res) => {
    try {
        await instanceService.startInstance(req.params.id);
        res.redirect('/server/' + req.params.id);
    } catch (error) {
        res.redirect('/server/' + req.params.id + '?error=' + encodeURIComponent(error));
    }
});

router.post('/server/:id/stop', async (req, res) => {
    instanceService.stopInstance(req.params.id);
    setTimeout(() => res.redirect('/server/' + req.params.id), 1000);
});

router.post('/server/:id/delete', async (req, res) => {
    try {
        await instanceService.deleteInstance(req.params.id);
        res.redirect('/');
    } catch (error) {
        res.redirect('/server/' + req.params.id + '?error=' + encodeURIComponent(error));
    }
});

router.post('/server/:id/properties', async (req, res) => {
    try {
        const { content } = req.body;
        await instanceService.saveProperties(req.params.id, content);
        await instanceService.restartInstance(req.params.id);
        res.redirect('/server/' + req.params.id + '?success=Properties saved. Server restarting...');
    } catch (error) {
        res.redirect('/server/' + req.params.id + '?error=' + encodeURIComponent(error.message));
    }
});

// --- GERENCIAMENTO DE MUNDO ---

router.get('/server/:id/world/download', async (req, res) => {
    try {
        const zipPath = await instanceService.downloadWorld(req.params.id);
        res.download(zipPath, 'world-backup.zip');
    } catch (error) {
        res.status(500).send("Error creating world dump: " + error.message);
    }
});

router.post('/server/:id/world/upload', upload.single('worldZip'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.redirect('/server/' + req.params.id + '?error=No file uploaded');
        if (file.mimetype !== 'application/zip' && !file.originalname.endsWith('.zip')) {
             return res.redirect('/server/' + req.params.id + '?error=Only .zip files are allowed');
        }

        await instanceService.restoreWorld(req.params.id, file);
        res.redirect('/server/' + req.params.id + '?success=World restored. Server restarting...');
    } catch (error) {
        res.redirect('/server/' + req.params.id + '?error=' + encodeURIComponent(error.message));
    }
});

router.post('/server/:id/world/reset', async (req, res) => {
    try {
        await instanceService.resetWorld(req.params.id);
        res.redirect('/server/' + req.params.id + '?success=World deleted. A new one is being generated...');
    } catch (error) {
        res.redirect('/server/' + req.params.id + '?error=' + encodeURIComponent(error.message));
    }
});

// --- API DO FILE MANAGER ---

router.get('/server/:id/files/list', async (req, res) => {
    try {
        const path = req.query.path || '';
        const files = await instanceService.listFiles(req.params.id, path);
        res.json({ success: true, files, path });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/server/:id/files/content', async (req, res) => {
    try {
        const content = await instanceService.getFileContent(req.params.id, req.query.path);
        res.json({ success: true, content });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/server/:id/files/save', async (req, res) => {
    try {
        await instanceService.writeFileContent(req.params.id, req.body.path, req.body.content);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/server/:id/files/mkdir', async (req, res) => {
    try {
        await instanceService.createDirectory(req.params.id, req.body.path);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/server/:id/files/delete', async (req, res) => {
    try {
        await instanceService.deleteFileOrFolder(req.params.id, req.body.path);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/server/:id/files/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) throw new Error("No file");
        await instanceService.uploadFileToFolder(req.params.id, req.body.path, req.file);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/server/:id/files/download', async (req, res) => {
    try {
        const filePath = await instanceService.getDownloadPath(req.params.id, req.query.path);
        res.download(filePath);
    } catch (e) {
        res.status(404).send("File not found");
    }
});

module.exports = router;