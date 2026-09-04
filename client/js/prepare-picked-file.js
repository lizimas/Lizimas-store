// Shared image-preparation helper. Loaded by admin and staff product pages.
// Edit here only - do not copy into page scripts.

// Single preparation path for every image source (gallery, files, camera, drop).
// Forces the provider to deliver real bytes now rather than at upload time.
async function preparePickedFile(file, attempt) {
    attempt = attempt || 1;
    try {
        const buf = await file.arrayBuffer();

        // Guard 1: short read. Cheap, but the provider reports both numbers,
        // so a consistently wrong provider can still pass this.
        if (buf.byteLength !== file.size) throw new Error("size mismatch");
        const bytes = new Uint8Array(buf);
        if (bytes.length < 12) throw new Error("file too small");

        // Guard 2: trailing marker. This is what actually catches truncation.
        const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
        const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
        if (isJpeg) {
            // FFD9 need not be the final bytes: EXIF, thumbnails and padding
            // legitimately follow it. Scan backwards for the marker instead.
            let hasEoi = false;
            const scanFrom = Math.max(0, bytes.length - 4096);
            for (let i = bytes.length - 2; i >= scanFrom; i--) {
                if (bytes[i] === 0xFF && bytes[i + 1] === 0xD9) { hasEoi = true; break; }
            }
            if (!hasEoi) throw new Error("truncated JPEG");
        } else if (isPng) {
            const iend = [0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82];
            for (let i = 0; i < 8; i++) {
                if (bytes[bytes.length - 8 + i] !== iend[i]) throw new Error("truncated PNG");
            }
        }
        // Other formats (webp, heic) skip the marker check and rely on decode.

        // Guard 3: decode. Proves the bytes are a parseable image.
        const blob = new Blob([buf], { type: file.type || "image/jpeg" });
        const bmp = await createImageBitmap(blob);
        const w = bmp.width, h = bmp.height;
        bmp.close();
        if (!w || !h) throw new Error("decode produced no dimensions");

        return {
            ok: true,
            file: new File([blob], file.name, { type: blob.type, lastModified: file.lastModified })
        };
    } catch (err) {
        if (attempt === 1) {
            // Delay before retry: an immediate retry hits the same cold cache.
            await new Promise(r => setTimeout(r, 300));
            return preparePickedFile(file, 2);
        }
        return { ok: false, name: file.name, reason: err.message };
    }
}

// Video counterpart. Same first guard as above -- read the bytes now so a
// cloud-gallery provider cannot hand back a lazy stub that fails at upload
// time -- but the image decode is replaced by a metadata load, which also
// gives us the duration without a second pass over the file.
const PICKED_VIDEO_MAX_SECONDS = 30;

async function preparePickedVideo(file, attempt) {
    attempt = attempt || 1;
    let url = null;
    try {
        const buf = await file.arrayBuffer();
        if (buf.byteLength !== file.size) throw new Error("size mismatch");
        const bytes = new Uint8Array(buf);
        if (bytes.length < 32) throw new Error("file too small");

        // mp4 and mov both carry an "ftyp" box near the start. A file that
        // lacks it is either truncated or not the container it claims to be.
        // webm uses a different magic number, so it skips this check.
        const isWebm = bytes[0] === 0x1A && bytes[1] === 0x45
            && bytes[2] === 0xDF && bytes[3] === 0xA3;
        if (!isWebm) {
            const ftyp = bytes[4] === 0x66 && bytes[5] === 0x74
                && bytes[6] === 0x79 && bytes[7] === 0x70;
            if (!ftyp) throw new Error("not a readable mp4 or mov");
        }

        const blob = new Blob([buf], { type: file.type || "video/mp4" });
        url = URL.createObjectURL(blob);

        const duration = await new Promise((resolve, reject) => {
            const probe = document.createElement("video");
            probe.preload = "metadata";
            // A file the browser cannot decode never fires either event, so
            // the wait is bounded rather than left hanging on the form.
            const bail = setTimeout(() => reject(new Error("could not read video")), 15000);
            probe.onloadedmetadata = () => {
                clearTimeout(bail);
                resolve(probe.duration);
            };
            probe.onerror = () => {
                clearTimeout(bail);
                reject(new Error("could not decode video"));
            };
            probe.src = url;
        });

        if (!duration || !isFinite(duration)) throw new Error("no duration");
        if (duration > PICKED_VIDEO_MAX_SECONDS + 0.5) {
            // Not retried: a long clip is not a read failure, and a second
            // attempt would give the same answer.
            URL.revokeObjectURL(url);
            return {
                ok: false,
                name: file.name,
                fatal: true,
                reason: `${Math.round(duration)}s long, limit is ${PICKED_VIDEO_MAX_SECONDS}s`
            };
        }

        URL.revokeObjectURL(url);
        return {
            ok: true,
            duration: duration,
            file: new File([blob], file.name,
                { type: blob.type, lastModified: file.lastModified })
        };
    } catch (err) {
        if (url) URL.revokeObjectURL(url);
        if (attempt === 1) {
            await new Promise(r => setTimeout(r, 300));
            return preparePickedVideo(file, 2);
        }
        return { ok: false, name: file.name, reason: err.message };
    }
}
