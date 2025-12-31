const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../database/db');
const instanceService = require('../services/instanceService');
const authMiddleware = require('../middleware/auth');

const upload = multer({ dest: 'temp_uploads/' });
const ROUTER_PORT = process.env.MC_ROUTER_PORT || 25565;

router.use(authMiddleware);

// Dashboard Principal
router.get('/', (req, res) => {
    // Só buscamos instâncias agora, as rotas manuais ficam ocultas ou gerenciadas internamente
    db.all("SELECT * FROM instances", (err, instances) => {
        res.render('dashboard', { 
            instances: instances || [], 
            user: req.session.user,
            routerPort: ROUTER_PORT 
        });
    });
});

// Página de Detalhes do Servidor
router.get('/server/:id', (req, res) => {
    const id = req.params.id;
    db.get("SELECT * FROM instances WHERE id = ?", [id], (err, instance) => {
        if (err || !instance) return res.redirect('/');
        res.render('server', { 
            instance, 
            user: req.session.user,
            routerPort: ROUTER_PORT
        });
    });
});

// API para Logs (HTMX ou Polling pode usar isso)
router.get('/server/:id/logs', async (req, res) => {
    const logs = await instanceService.getLogs(req.params.id);
    res.send(logs);
});

// Criar Servidor
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

// Ações do Servidor
router.post('/server/:id/start', async (req, res) => {
    await instanceService.startInstance(req.params.id);
    res.redirect('/server/' + req.params.id);
});

router.post('/server/:id/stop', async (req, res) => {
    instanceService.stopInstance(req.params.id);
    // Espera um pouco para atualizar status no DB
    setTimeout(() => res.redirect('/server/' + req.params.id), 1000);
});

router.post('/server/:id/delete', async (req, res) => {
    await instanceService.deleteInstance(req.params.id);
    res.redirect('/');
});

module.exports = router;