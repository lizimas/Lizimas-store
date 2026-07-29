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
