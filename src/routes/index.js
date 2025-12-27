const express = require('express');
const router = express.Router();
const db = require('../database/db');
const routerService = require('../services/routerService');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// Dashboard: Lista rotas
router.get('/', (req, res) => {
    db.all("SELECT * FROM routes", (err, rows) => {
        res.render('dashboard', { 
            routes: rows, 
            user: req.session.username 
        });
    });
});

// Adicionar Rota
router.post('/routes/add', (req, res) => {
    const { serverAddress, listeningPort, description } = req.body;
    db.run(
        "INSERT INTO routes (serverAddress, listeningPort, description) VALUES (?, ?, ?)",
        [serverAddress, listeningPort, description],
        (err) => {
            if (!err) routerService.syncAndRestart();
            res.redirect('/');
        }
    );
});

// Deletar Rota
router.post('/routes/delete/:id', (req, res) => {
    db.run("DELETE FROM routes WHERE id = ?", [req.params.id], (err) => {
        if (!err) routerService.syncAndRestart();
        res.redirect('/');
    });
});

module.exports = router;