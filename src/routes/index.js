const express = require('express');
const router = express.Router();
const db = require('../database/db');
const routerService = require('../services/routerService');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', (req, res) => {
    db.all("SELECT * FROM routes", (err, rows) => {
        res.render('dashboard', { 
            routes: rows, 
            user: req.session.user 
        });
    });
});

router.post('/routes/add', (req, res) => {
    let { sourceDomain, listeningPort, destHost, destPort, description } = req.body;
    
    if (!listeningPort || !destHost || !destPort) {
        // TRADUZIDO
        return res.redirect('/?error=Missing required fields');
    }

    // Remove http://, https:// e barras finais do domínio
    if (sourceDomain) {
        sourceDomain = sourceDomain
            .replace(/^https?:\/\//, '') // Remove protocolo
            .replace(/\/$/, '')          // Remove barra final
            .toLowerCase();              // Garante minúsculo
    }

    db.run(
        "INSERT INTO routes (sourceDomain, listeningPort, destHost, destPort, description) VALUES (?, ?, ?, ?, ?)",
        [sourceDomain, listeningPort, destHost, destPort, description],
        (err) => {
            if (err) {
                console.error(err);
            } else {
                routerService.syncAndRestart();
            }
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