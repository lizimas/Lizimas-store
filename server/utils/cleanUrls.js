// Clean page addresses: /vendor-login serves client/vendor-login.html
// (express.static's `extensions` option in app.js), and a request for the
// old /vendor-login.html gets a 301 to /vendor-login with the same ?query.
// Browsers carry a #hash across a redirect by themselves.
//
// Only GET/HEAD, and only for a page that really exists, so POST callbacks
// (payment providers) and API routes are never touched. index.html goes to
// its folder ("/index.html" -> "/"). Partials such as
// admin-support-control-center.partial.html are left alone.
const fs = require("fs");
const path = require("path");

const PAGE = /^((?:\/[A-Za-z0-9_-]+)*\/)([A-Za-z0-9_-]+)\.html$/;

function cleanPath(p) {
    const m = PAGE.exec(p);
    if (!m) return null;
    return m[2] === "index" ? m[1] : m[1] + m[2];
}

function redirectHtml(clientDir) {
    const root = path.resolve(clientDir);
    return function (req, res, next) {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const clean = cleanPath(req.path);
        if (!clean || req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
        const file = path.resolve(root, "." + req.path);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return next();
        const query = req.originalUrl.slice(req.originalUrl.indexOf(req.path) + req.path.length);
        return res.redirect(301, clean + query);
    };
}

module.exports = { redirectHtml, cleanPath };
