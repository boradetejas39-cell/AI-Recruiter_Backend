const fs = require('fs');
const path = require('path');

/**
 * Production-ready Logger Utility
 * Provides structured logging with levels, timestamps, and file output.
 * Replaces scattered console.log calls with a unified logging interface.
 */

const LOG_LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };

// Resolve current level from env (default: DEBUG in dev, INFO in prod)
const currentLevel =
    LOG_LEVELS[String(process.env.LOG_LEVEL || '').toUpperCase()] ??
    (process.env.NODE_ENV === 'production' ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG);

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// Write stream for persistent log file (append mode)
const logStream = fs.createWriteStream(path.join(logsDir, 'app.log'), { flags: 'a' });

/**
 * Format a log entry as JSON for structured logging
 */
function formatEntry(level, message, meta = {}) {
    return JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...meta,
        pid: process.pid
    });
}

/**
 * Core log function — writes to both console and file
 */
function log(level, levelNum, message, meta) {
    if (levelNum > currentLevel) return;

    const entry = formatEntry(level, message, meta);

    // Console output with colour hints
    switch (level) {
        case 'ERROR': console.error(`❌ [${level}]`, message, meta || ''); break;
        case 'WARN': console.warn(`⚠️  [${level}]`, message, meta || ''); break;
        case 'INFO': console.info(`ℹ️  [${level}]`, message, meta || ''); break;
        case 'DEBUG': console.debug(`🐛 [${level}]`, message, meta || ''); break;
    }

    // Persist to file
    logStream.write(entry + '\n');
}

const logger = {
    error: (msg, meta) => log('ERROR', LOG_LEVELS.ERROR, msg, meta),
    warn: (msg, meta) => log('WARN', LOG_LEVELS.WARN, msg, meta),
    info: (msg, meta) => log('INFO', LOG_LEVELS.INFO, msg, meta),
    debug: (msg, meta) => log('DEBUG', LOG_LEVELS.DEBUG, msg, meta),

    /**
     * Express-compatible request logger middleware
     * Logs method, URL, status code, and response time
     */
    requestLogger: (req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            const meta = {
                method: req.method,
                url: req.originalUrl,
                status: res.statusCode,
                duration: `${duration}ms`,
                ip: req.ip
            };
            if (res.statusCode >= 400) {
                log('WARN', LOG_LEVELS.WARN, `${req.method} ${req.originalUrl} ${res.statusCode}`, meta);
            } else {
                log('INFO', LOG_LEVELS.INFO, `${req.method} ${req.originalUrl} ${res.statusCode}`, meta);
            }
        });
        next();
    }
};

module.exports = logger;
