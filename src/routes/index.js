const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../database/db');
const instanceService = require('../services/instanceService');
const authMiddleware = require('../middleware/auth');

const upload = multer({ dest: 'temp_uploads/' });
const ROUTER_PORT = process.env.MC_ROUTER_PORT || 25565;

router.use(authMiddleware);

router.get('/', (req, res) => {
    db.all("SELECT * FROM instances", (err, instances) => {
        res.render('dashboard', { 
            instances: instances || [], 
            user: req.session.user,
            routerPort: ROUTER_PORT 
        });
    });
});

// Detalhes do Servidor (AGORA CARREGA AS PROPRIEDADES)
router.get('/server/:id', async (req, res) => {
    const id = req.params.id;
    
    // Busca propriedades
    let properties = "";
    try {
        properties = await instanceService.getProperties(id);
    } catch (e) {
        console.error("Erro ao ler properties", e);
    }

    db.get("SELECT * FROM instances WHERE id = ?", [id], (err, instance) => {
        if (err || !instance) return res.redirect('/');
        res.render('server', { 
            instance, 
            user: req.session.user,
            routerPort: ROUTER_PORT,
            properties // Envia para o frontend
        });
    });
});

router.get('/server/:id/logs', async (req, res) => {
    const logs = await instanceService.getLogs(req.params.id);
    res.send(logs);
});

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
    await instanceService.startInstance(req.params.id);
    res.redirect('/server/' + req.params.id);
});

router.post('/server/:id/stop', async (req, res) => {
    instanceService.stopInstance(req.params.id);
    setTimeout(() => res.redirect('/server/' + req.params.id), 1000);
});

router.post('/server/:id/delete', async (req, res) => {
    await instanceService.deleteInstance(req.params.id);
    res.redirect('/');
});

// NOVA ROTA: SALVAR PROPRIEDADES E REINICIAR
router.post('/server/:id/properties', async (req, res) => {
    try {
        const { content } = req.body;
        await instanceService.saveProperties(req.params.id, content);
        
        // Se estiver rodando, reinicia
        await instanceService.restartInstance(req.params.id);
        
        res.redirect('/server/' + req.params.id + '?success=Saved and Restarting');
    } catch (error) {
        console.error(error);
        res.redirect('/server/' + req.params.id + '?error=Failed to save');
    }
});

module.exports = router;