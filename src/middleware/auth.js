const db = require('../database/db');

module.exports = (req, res, next) => {
    // 1. Ignora verificação para assets estáticos e API de arquivos se necessário
    if (req.path.startsWith('/css') || req.path.startsWith('/js') || req.path.startsWith('/images')) {
        return next();
    }

    // 2. Se o usuário já está logado, deixa passar
    if (req.session && req.session.user) {
        // Se tentar acessar login ou setup estando logado, manda pro dashboard
        if (req.path === '/login' || req.path === '/setup') {
            return res.redirect('/');
        }
        return next();
    }

    // 3. Verifica o estado do banco de dados (se existe usuário admin)
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        if (err) {
            console.error("Erro no DB:", err);
            return next(err);
        }

        const userExists = row && row.count > 0;
        
        // --- CORREÇÃO DO LOOP AQUI ---
        const isSetupRoute = req.path === '/setup' || req.path === '/auth/setup';
        const isLoginRoute = req.path === '/login' || req.path === '/auth/login';

        // CASO 1: Nenhum usuário cadastrado (Primeiro acesso)
        if (!userExists) {
            // Se já estamos na rota de setup, PERMITE passar
            if (isSetupRoute) {
                return next();
            }
            // Caso contrário, redireciona para setup
            return res.redirect('/setup');
        }

        // CASO 2: Usuários existem, mas não está logado
        if (userExists) {
            // Se já estamos na rota de login, PERMITE passar
            if (isLoginRoute) {
                return next();
            }
            // Caso contrário, redireciona para login
            return res.redirect('/login');
        }
    });
};