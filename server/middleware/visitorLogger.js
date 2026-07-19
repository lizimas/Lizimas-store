const { UAParser } = require('ua-parser-js');
const pool = require('../config/database');

function isPageVisit(url) {
    const path = url.split('?')[0];
    if (path.startsWith('/api/')) return false;
    if (path.match(/\.(js|css|ico|png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|map)$/i)) return false;
    return true;
}

async function logVisitor(req, res, next) {
    if (!isPageVisit(req.originalUrl)) {
        return next();
    }

    try {
        const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        const ua = new UAParser(req.headers['user-agent']);
        const browser = `${ua.getBrowser().name || 'Unknown'} ${ua.getBrowser().version || ''}`.trim();
        const os = `${ua.getOS().name || 'Unknown'} ${ua.getOS().version || ''}`.trim();

        let country = null;
        let city = null;

        try {
            const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city`);
            const geoData = await geoRes.json();
            if (geoData.status === 'success') {
                country = geoData.country;
                city = geoData.city;
            }
        } catch (geoErr) {
            // Geolocation lookup failed, continue without it
        }

        await pool.query(
            `INSERT INTO visitor_logs (ip_address, country, city, browser, operating_system, page_visited)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [ip, country, city, browser, os, req.originalUrl]
        );
    } catch (error) {
        console.error('Visitor logging error:', error.message);
    }
    next();
}

module.exports = logVisitor;
