const express = require('express');
const path = require('path');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const routerService = require('./services/routerService');

const authRoutes = require('./routes/auth');
const indexRoutes = require('./routes/index');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração de Segurança
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "rsms.me"],
            fontSrc: ["'self'", "rsms.me"],
            imgSrc: ["'self'", "data:", "cdn.jsdelivr.net"]
        }
    }
}));

// Configuração de Views
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Sessão
app.use(session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: '.' }),
    secret: 'mc-router-secret-key-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 1 semana
}));

// Rotas
app.use('/', authRoutes);
app.use('/', indexRoutes);

// Inicialização
app.listen(PORT, () => {
    console.log(`Interface rodando na porta ${PORT}`);
    // Sincroniza DB com arquivo JSON e inicia serviço
    routerService.syncAndRestart();
});

process.on('SIGTERM', () => {
    routerService.stop();
    process.exit(0);
});