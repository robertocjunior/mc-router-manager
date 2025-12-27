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

// Security Config
app.use(helmet({
    // IMPORTANT: Disable HSTS to prevent browser from forcing HTTPS
    hsts: false, 
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "rsms.me"],
            fontSrc: ["'self'", "rsms.me"],
            // Added ui-avatars.com for profile icons
            imgSrc: ["'self'", "data:", "cdn.jsdelivr.net", "ui-avatars.com"] 
        }
    }
}));

// Views Config
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Session
app.use(session({
    // Ensure session file is stored in persistent data folder
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: '/app/data' }), 
    secret: 'mc-router-secret-key-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // IMPORTANT: false to run on HTTP
        maxAge: 7 * 24 * 60 * 60 * 1000 // 1 week
    }
}));

// Routes
app.use('/', authRoutes);
app.use('/', indexRoutes);

// Initialization
app.listen(PORT, () => {
    console.log(`Interface running on port ${PORT}`);
    // Sync DB with JSON file and start service
    routerService.syncAndRestart();
});

// Graceful Shutdown
process.on('SIGTERM', () => {
    routerService.stop();
    process.exit(0);
});