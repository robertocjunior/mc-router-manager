const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../database/db');
const routerService = require('../services/routerService');
const instanceService = require('../services/instanceService');
const authMiddleware = require('../middleware/auth');

// Configuração de Upload (Arquivos temporários)
const upload = multer({ dest: 'temp_uploads/' });

router.use(authMiddleware);

// Rota do Dashboard (GET /)
router.get('/', (req, res) => {
    // Busca Rotas Proxy
    db.all("SELECT * FROM routes", (err, routes) => {
        // Busca Servidores Locais (Instâncias)
        db.all("SELECT * FROM instances", (err2, instances) => {
            res.render('dashboard', { 
                routes: routes || [], 
                instances: instances || [], // Envia as instâncias para o frontend
                user: req.session.user 
            });
        });
    });
});

// --- Rota para criar NOVO SERVIDOR (Instância) ---
router.post('/instances/create', upload.single('serverJar'), async (req, res) => {
    try {
        const { name, domain, startCommand } = req.body;
        const file = req.file;

        if (!file || !name || !domain) {
            return res.redirect('/?error=Missing fields');
        }

        // 1. Cria a instância
        const newInstance = await instanceService.createInstance(name, domain, file, startCommand);
        
        // 2. Tenta iniciar
        await instanceService.startInstance(newInstance.id);

        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.redirect('/?error=' + encodeURIComponent(error.message));
    }
});

// --- Rotas Antigas de Proxy ---
router.post('/routes/add', (req, res) => {
    let { sourceDomain, destHost, destPort, description } = req.body;
    const listeningPort = 25565;
    
    if (!destHost || !destPort) return res.redirect('/?error=Missing required fields');

    if (sourceDomain) {
        sourceDomain = sourceDomain.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
    }

    db.run(
        "INSERT INTO routes (sourceDomain, listeningPort, destHost, destPort, description) VALUES (?, ?, ?, ?, ?)",
        [sourceDomain, listeningPort, destHost, destPort, description],
        (err) => {
            if (!err) routerService.syncAndRestart();
            res.redirect('/');
        }
    );
});

router.post('/routes/delete/:id', (req, res) => {
    db.run("DELETE FROM routes WHERE id = ?", [req.params.id], (err) => {
        if (!err) routerService.syncAndRestart();
        res.redirect('/');
    });
});

module.exports = router;