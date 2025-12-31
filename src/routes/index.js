const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../database/db');
const routerService = require('../services/routerService');
const instanceService = require('../services/instanceService');
const authMiddleware = require('../middleware/auth');

const upload = multer({ dest: 'temp_uploads/' });
// Pega a porta da env
const ROUTER_PORT = process.env.MC_ROUTER_PORT || 25565;

router.use(authMiddleware);

router.get('/', (req, res) => {
    db.all("SELECT * FROM routes", (err, routes) => {
        db.all("SELECT * FROM instances", (err2, instances) => {
            res.render('dashboard', { 
                routes: routes || [], 
                instances: instances || [], 
                user: req.session.user,
                // Passamos a porta para o EJS usar
                routerPort: ROUTER_PORT 
            });
        });
    });
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
        console.error(error);
        res.redirect('/?error=' + encodeURIComponent(error.message));
    }
});

router.post('/routes/add', (req, res) => {
    let { sourceDomain, destHost, destPort, description } = req.body;
    
    // Usa a variável
    const listeningPort = ROUTER_PORT;
    
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