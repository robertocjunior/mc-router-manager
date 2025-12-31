const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const SQLiteStore = require('connect-sqlite3')(session);

// Inicializa Banco de Dados
require('./database/db');

const app = express();
const port = process.env.PORT || 3000;

// Configuração da View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Segurança (Helmet) - Ajustado para rede local
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "'unsafe-inline'"],
        "script-src-attr": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "upgrade-insecure-requests": null, // Importante para evitar loop HTTPS local
      },
    },
    hsts: false, // Importante para evitar forçar HTTPS local
  })
);

// Arquivos Estáticos
app.use(express.static(path.join(__dirname, '../public')));

// Sessão
app.use(session({
    store: new SQLiteStore({ dir: './data', db: 'sessions.sqlite' }),
    secret: 'mc-router-secret-key-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24 * 7, 
        httpOnly: true,
        secure: false // Importante: false para funcionar sem HTTPS
    }
}));

// Variável Global de Usuário
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// ROTAS
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');

// Monta as rotas na raiz
app.use('/', indexRoutes);
app.use('/', authRoutes); // Isso garante que /setup e /login funcionem na raiz

// Inicia
app.listen(port, () => {
    console.log(`Interface rodando na porta ${port}`);
    const routerService = require('./services/routerService');
    routerService.start();
});