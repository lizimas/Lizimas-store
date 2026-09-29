// Download a product photo from a link a vendor put in an import file
// (Sept 2026). Links come from outside, so this is careful about where it
// connects and how much it reads:
//  - http/https only, no user:password@ in the link, standard ports only;
//  - the host must resolve to a public address - never localhost, private
//    ranges (10.x, 192.168.x, 172.16-31.x), link-local/cloud metadata
//    (169.254.x), carrier NAT, or their IPv6 equivalents - checked again on
//    every redirect (at most 3);
//  - at most maxBytes (default 5MB) is read, then the download is dropped;
//  - it must actually be a JPEG, PNG or WebP (checked from the bytes).
const dns = require("dns").promises;
const net = require("net");
const { readImageSize } = require("./imageChecks");

class RemoteImageError extends Error {}

function isPrivateAddress(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split(".").map(Number);
        return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 192 && b === 0)
            || (a === 198 && (b === 18 || b === 19));
    }
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}

async function checkUrl(raw, lookup) {
    let u;
    try { u = new URL(String(raw).trim()); } catch (e) { throw new RemoteImageError("not a valid link"); }
    if (!["http:", "https:"].includes(u.protocol)) throw new RemoteImageError("link must start with http:// or https://");
    if (u.username || u.password) throw new RemoteImageError("link must not contain a username or password");
    if (u.port && !["80", "443"].includes(u.port)) throw new RemoteImageError("link uses an unusual port");
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (/^localhost$/i.test(host) || /\.(local|internal|localhost)$/i.test(host)) throw new RemoteImageError("link points to a private address");
    const addresses = net.isIP(host) ? [{ address: host }] : await (lookup || dns.lookup)(host, { all: true }).catch(() => { throw new RemoteImageError("the website in the link could not be found"); });
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new RemoteImageError("link points to a private address");
    return u;
}

// -> { buffer, size, name, url }   (throws RemoteImageError with a plain reason)
async function fetchRemoteImage(raw, opts) {
    opts = opts || {};
    const maxBytes = opts.maxBytes || 5 * 1024 * 1024;
    const doFetch = opts.fetch || fetch;
    let url = await checkUrl(raw, opts.lookup);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 12000);
    try {
        let res;
        for (let hop = 0; ; hop++) {
            res = await doFetch(url.toString(), { redirect: "manual", signal: ctl.signal, headers: { "User-Agent": "LizimasStore-ImageImport/1.0", Accept: "image/*" } });
            if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
                if (hop >= 3) throw new RemoteImageError("too many redirects");
                url = await checkUrl(new URL(res.headers.get("location"), url).toString(), opts.lookup);
                continue;
            }
            break;
        }
        if (!res.ok) throw new RemoteImageError(`the website answered ${res.status}`);
        const declared = Number(res.headers.get("content-length") || 0);
        if (declared > maxBytes) throw new RemoteImageError(`photo is larger than ${Math.round(maxBytes / 1048576)}MB`);
        const chunks = [];
        let total = 0;
        const reader = res.body && res.body.getReader ? res.body.getReader() : null;
        if (reader) {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.length;
                if (total > maxBytes) { ctl.abort(); throw new RemoteImageError(`photo is larger than ${Math.round(maxBytes / 1048576)}MB`); }
                chunks.push(Buffer.from(value));
            }
        } else {
            const b = Buffer.from(await res.arrayBuffer());
            if (b.length > maxBytes) throw new RemoteImageError(`photo is larger than ${Math.round(maxBytes / 1048576)}MB`);
            chunks.push(b); total = b.length;
        }
        const buffer = Buffer.concat(chunks, total);
        if (!readImageSize(buffer)) throw new RemoteImageError("link is not a JPEG, PNG or WebP photo");
        const name = decodeURIComponent(url.pathname.split("/").pop() || "photo").slice(0, 80) || "photo";
        return { buffer, size: buffer.length, name, url: url.toString() };
    } catch (e) {
        if (e instanceof RemoteImageError) throw e;
        if (e && e.name === "AbortError") throw new RemoteImageError("the website took too long to send the photo");
        throw new RemoteImageError("the photo could not be downloaded");
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { fetchRemoteImage, isPrivateAddress, checkUrl, RemoteImageError };
