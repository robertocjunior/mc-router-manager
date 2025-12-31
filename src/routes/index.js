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

router.get('/', (req, res) => {
    db.all("SELECT * FROM instances", (err, instances) => {
        res.render('dashboard', { instances: instances || [], user: req.session.user, routerPort: ROUTER_PORT, query: req.query });
    });
});

// ALTERADO: :id -> :uuid
router.get('/server/:uuid', async (req, res) => {
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
});

router.get('/server/:uuid/logs', async (req, res) => { const logs = await instanceService.getLogs(req.params.uuid); res.send(logs); });

router.post('/instances/create', upload.single('serverJar'), async (req, res) => {
    try {
        const { name, domain, startCommand } = req.body;
        const file = req.file;
        if (!file || !name || !domain) return res.redirect('/?error=Missing fields');
        const newInstance = await instanceService.createInstance(name, domain, file, startCommand);
        await instanceService.startInstance(newInstance.uuid); // Usa UUID
        res.redirect('/');
    } catch (error) { res.redirect('/?error=' + encodeURIComponent(error.message)); }
});

// Todas as rotas abaixo usam :uuid agora
router.post('/server/:uuid/start', async (req, res) => { try { await instanceService.startInstance(req.params.uuid); res.redirect('/server/' + req.params.uuid); } catch (error) { res.redirect('/server/' + req.params.uuid + '?error=' + encodeURIComponent(error)); } });
router.post('/server/:uuid/stop', async (req, res) => { instanceService.stopInstance(req.params.uuid); setTimeout(() => res.redirect('/server/' + req.params.uuid), 1000); });
router.post('/server/:uuid/delete', async (req, res) => { try { await instanceService.deleteInstance(req.params.uuid); res.redirect('/'); } catch (error) { res.redirect('/server/' + req.params.uuid + '?error=' + encodeURIComponent(error)); } });
router.post('/server/:uuid/properties', async (req, res) => { try { await instanceService.saveProperties(req.params.uuid, req.body.content); await instanceService.restartInstance(req.params.uuid); res.redirect('/server/' + req.params.uuid + '?success=Properties saved. Server restarting...'); } catch (error) { res.redirect('/server/' + req.params.uuid + '?error=' + encodeURIComponent(error.message)); } });

router.get('/server/:uuid/world/download', async (req, res) => { try { const zipPath = await instanceService.downloadWorld(req.params.uuid); res.download(zipPath, 'world-backup.zip'); } catch (error) { res.status(500).send("Error: " + error.message); } });
router.post('/server/:uuid/world/upload', upload.single('worldZip'), async (req, res) => { try { const file = req.file; if (!file) return res.redirect('/server/' + req.params.uuid + '?error=No file'); await instanceService.restoreWorld(req.params.uuid, file); res.redirect('/server/' + req.params.uuid + '?success=Restored.'); } catch (error) { res.redirect('/server/' + req.params.uuid + '?error=' + encodeURIComponent(error.message)); } });
router.post('/server/:uuid/world/reset', async (req, res) => { try { await instanceService.resetWorld(req.params.uuid); res.redirect('/server/' + req.params.uuid + '?success=Reset done.'); } catch (error) { res.redirect('/server/' + req.params.uuid + '?error=' + encodeURIComponent(error.message)); } });

router.get('/server/:uuid/files/list', async (req, res) => {
    try {
        const path = req.query.path || '';
        const files = await instanceService.listFiles(req.params.uuid, path);
        res.json({ success: true, files, path });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/server/:uuid/files/content', async (req, res) => {
    try {
        const content = await instanceService.getFileContent(req.params.uuid, req.query.path);
        res.json({ success: true, content });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/server/:uuid/files/save', async (req, res) => {
    try {
        await instanceService.writeFileContent(req.params.uuid, req.body.path, req.body.content);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/server/:uuid/files/mkdir', async (req, res) => {
    try {
        await instanceService.createDirectory(req.params.uuid, req.body.path);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/server/:uuid/files/delete', async (req, res) => {
    try {
        await instanceService.deleteFileOrFolder(req.params.uuid, req.body.path);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/server/:uuid/files/rename', async (req, res) => {
    try {
        await instanceService.renameFile(req.params.uuid, req.body.oldPath, req.body.newPath);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/server/:uuid/files/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) throw new Error("No file");
        await instanceService.uploadFileToFolder(req.params.uuid, req.body.path, req.file);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/server/:uuid/files/download', async (req, res) => {
    try {
        const { path: filePath, name, isTemp } = await instanceService.getDownloadPath(req.params.uuid, req.query.path);
        res.download(filePath, name, (err) => {
            if (isTemp) fs.unlink(filePath, () => {}); 
        });
    } catch (e) { res.status(404).send("File not found or access denied."); }
});

module.exports = router;