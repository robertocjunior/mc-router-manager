const express = require('express');
const router = express.Router();
const routerService = require('../services/routerService');

router.get('/', async (req, res) => {
    const config = await routerService.getConfig();
    res.render('index', { config });
});

router.post('/save', async (req, res) => {
    try {
        // Exemplo simples: recebe JSON do formulário
        // Em produção, adicione validação (ex: Joi ou Zod)
        const newConfig = JSON.parse(req.body.configJson);
        await routerService.saveConfig(newConfig);
        res.redirect('/?status=success');
    } catch (error) {
        console.error(error);
        res.redirect('/?status=error');
    }
});

router.post('/restart', (req, res) => {
    routerService.restart();
    res.redirect('/');
});

module.exports = router;