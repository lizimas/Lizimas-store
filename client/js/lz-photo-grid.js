// Product photo grid for the Add / Edit Product forms (admin and vendor).
//
// Rules (Ryan, Sept 2026):
//  * Admin / Lizimas Store: up to 20 photos (2 rows x 10 on a computer).
//    Vendors: up to 8 - only 8 slots are shown, with a note.
//  * The first photo picked is the Main photo (slot 1). The uploader can
//    change the order at any time without uploading again: drag a photo to
//    another slot (long-press then drag on a phone), or tap the star on a
//    photo to make it the Main photo.
//
// The form owns the list; this file only draws it and reports what the
// person did:
//
//   LzPhotoGrid.render(hostEl, {
//       items: [{ key, url, isNew }],   // in display order, [0] = Main
//       max: 20,
//       note: "Vendors can upload up to 8 photos.",   // optional
//       status: "Removing...",                        // optional line
//       busy: false,                                  // disables actions
//       onMove(from, to),      // move the photo at index `from` to `to`
//       onRemove(key),
//       onAdd(),               // open the file picker
//       onDropFiles(files)     // files dropped on the grid
//   });
(function () {
    "use strict";

    const STYLE_ID = "lzpg-style";
    const CSS = `
.lzpg { container-type: inline-size; width: 100%; margin: 4px 0 10px; }
.lzpg-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.lzpg-title { font-size: 13px; font-weight: 700; color: #1a1a2e; }
.lzpg-count { font-size: 12px; color: #6b7280; }
.lzpg-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.lzpg-grid.lzpg-dropping { outline: 2px dashed #f4b400; outline-offset: 4px; border-radius: 8px; }
.lzpg-slot { position: relative; aspect-ratio: 1 / 1; border-radius: 8px; box-sizing: border-box; min-width: 0; }
.lzpg-slot.lzpg-main { grid-column: span 2; grid-row: span 2; }
.lzpg-empty { border: 1.5px dashed #cbd0d8; background: #fafbfc; color: #9ca3af; display: flex; flex-direction: column;
    align-items: center; justify-content: center; font-size: 12px; cursor: pointer; padding: 0; font-family: inherit; }
.lzpg-empty:hover, .lzpg-empty:focus-visible { border-color: #1a1a2e; color: #1a1a2e; outline: none; }
.lzpg-empty .lzpg-plus { font-size: 22px; line-height: 1; }
.lzpg-empty.lzpg-main .lzpg-plus { font-size: 30px; }
.lzpg-empty[disabled] { cursor: default; opacity: .6; }
.lzpg-photo { border: 1px solid #e5e7eb; background: #fff; overflow: hidden; cursor: grab; touch-action: pan-y;
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.lzpg-photo:focus-visible { outline: 2px solid #1a1a2e; outline-offset: 2px; }
.lzpg-photo.lzpg-main { border: 2px solid #f4b400; }
.lzpg-photo img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.lzpg-num { position: absolute; left: 4px; bottom: 4px; min-width: 18px; padding: 1px 5px; border-radius: 9px;
    background: rgba(26,26,46,.75); color: #fff; font-size: 10.5px; font-weight: 700; text-align: center; }
.lzpg-badge { position: absolute; left: 6px; top: 6px; padding: 2px 8px; border-radius: 4px; background: #f4b400;
    color: #1a1a2e; font-size: 11px; font-weight: 800; letter-spacing: .04em; }
.lzpg-new { position: absolute; right: 4px; bottom: 4px; padding: 1px 5px; border-radius: 3px; background: #fff;
    color: #b45309; font-size: 9.5px; font-weight: 800; letter-spacing: .05em; }
.lzpg-btn { position: absolute; top: 4px; width: 24px; height: 24px; padding: 0; border-radius: 50%; border: 1px solid #e5e7eb;
    background: rgba(255,255,255,.95); cursor: pointer; font-size: 13px; line-height: 22px; text-align: center; }
.lzpg-del { right: 4px; color: #c0392b; }
.lzpg-star { right: 32px; color: #a86b00; }
.lzpg-btn:hover { border-color: #1a1a2e; }
.lzpg-btn[disabled] { opacity: .4; cursor: default; }
.lzpg-slot.lzpg-over { box-shadow: 0 0 0 3px #1a1a2e; }
.lzpg-slot.lzpg-lifted { opacity: .35; }
.lzpg-ghost { position: fixed; z-index: 99999; pointer-events: none; border-radius: 8px; overflow: hidden;
    box-shadow: 0 10px 28px rgba(0,0,0,.28); transform: scale(1.06); opacity: .92; }
.lzpg-ghost img { width: 100%; height: 100%; object-fit: cover; display: block; }
.lzpg-help { margin-top: 8px; font-size: 12px; color: #6b7280; line-height: 1.45; }
.lzpg-note { margin-top: 6px; font-size: 12px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a;
    border-radius: 6px; padding: 6px 10px; }
.lzpg-status { margin-top: 6px; font-size: 12px; color: #374151; }
@container (min-width: 560px) {
    .lzpg-grid { grid-template-columns: repeat(10, minmax(0, 1fr)); }
    .lzpg-slot.lzpg-main { grid-column: auto; grid-row: auto; }
    .lzpg-star { right: auto; left: 4px; top: auto; bottom: 4px; }
    .lzpg-photo .lzpg-num { display: none; }
    .lzpg-badge { left: 4px; top: 4px; padding: 1px 5px; font-size: 9.5px; }
    .lzpg-btn { width: 22px; height: 22px; line-height: 20px; font-size: 12px; }
}`;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const s = document.createElement("style");
        s.id = STYLE_ID;
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    function esc(v) {
        return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function slotHtml(item, i, opts) {
        const main = i === 0 ? " lzpg-main" : "";
        if (!item) {
            const firstEmpty = i === opts.items.length;
            return '<button type="button" class="lzpg-slot lzpg-empty' + main + '" data-empty="1"' +
                (opts.busy ? " disabled" : "") + ' aria-label="Add photos">' +
                '<span class="lzpg-plus">+</span>' +
                (i === 0 ? "<span>Main photo</span>" : (firstEmpty ? "<span>Add</span>" : "")) +
                "</button>";
        }
        const dis = opts.busy ? " disabled" : "";
        return '<div class="lzpg-slot lzpg-photo' + main + '" data-i="' + i + '" tabindex="0" role="listitem" ' +
            'aria-label="Photo ' + (i + 1) + (i === 0 ? ", main photo" : "") + '. Use the arrow keys to move it.">' +
            '<img src="' + esc(item.url) + '" alt="" draggable="false">' +
            (i === 0 ? '<span class="lzpg-badge">MAIN</span>' : '<span class="lzpg-num">' + (i + 1) + "</span>") +
            (item.isNew ? '<span class="lzpg-new">NEW</span>' : "") +
            (i === 0 ? "" : '<button type="button" class="lzpg-btn lzpg-star" data-act="main" title="Set as main photo"' + dis + '>&#9733;</button>') +
            '<button type="button" class="lzpg-btn lzpg-del" data-act="del" title="Remove photo"' + dis + '>&#10005;</button>' +
            "</div>";
    }

    function render(host, opts) {
        if (!host) return;
        ensureStyle();
        opts = Object.assign({ items: [], max: 20 }, opts || {});
        const items = opts.items.slice(0, opts.max);
        opts.items = items;
        host._lzpg = opts;

        let slots = "";
        for (let i = 0; i < opts.max; i++) slots += slotHtml(items[i], i, opts);

        host.innerHTML =
            '<div class="lzpg">' +
                '<div class="lzpg-head"><span class="lzpg-title">Photos</span>' +
                '<span class="lzpg-count">' + items.length + " of " + opts.max + "</span></div>" +
                '<div class="lzpg-grid" role="list">' + slots + "</div>" +
                '<div class="lzpg-help">The first photo is the <strong>Main</strong> photo. Drag a photo to change the order ' +
                "(on a phone: press and hold, then drag), or tap &#9733; to make it the Main photo. " +
                "The order is saved when you save the product.</div>" +
                (opts.note ? '<div class="lzpg-note">' + esc(opts.note) + "</div>" : "") +
                (opts.status ? '<div class="lzpg-status">' + esc(opts.status) + "</div>" : "") +
            "</div>";

        wire(host);
    }

    function wire(host) {
        const grid = host.querySelector(".lzpg-grid");
        const o = () => host._lzpg;

        grid.addEventListener("click", (e) => {
            if (o().busy) return;
            const btn = e.target.closest("[data-act]");
            if (btn) {
                const slot = btn.closest(".lzpg-photo");
                const i = Number(slot.dataset.i);
                e.stopPropagation();
                if (btn.dataset.act === "del" && o().onRemove) o().onRemove(o().items[i].key);
                if (btn.dataset.act === "main" && o().onMove) o().onMove(i, 0);
                return;
            }
            if (e.target.closest("[data-empty]") && o().onAdd) o().onAdd();
        });

        // Keyboard: arrow keys move the focused photo one place.
        grid.addEventListener("keydown", (e) => {
            const slot = e.target.closest(".lzpg-photo");
            if (!slot || o().busy) return;
            const i = Number(slot.dataset.i);
            const d = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1
                : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
            if (!d) return;
            const to = i + d;
            if (to < 0 || to >= o().items.length) return;
            e.preventDefault();
            o().onMove(i, to);
            const again = host.querySelector('.lzpg-photo[data-i="' + to + '"]');
            if (again) again.focus();
        });

        // Files dragged in from the computer.
        grid.addEventListener("dragover", (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
            e.preventDefault();
            grid.classList.add("lzpg-dropping");
        });
        grid.addEventListener("dragleave", (e) => {
            if (!grid.contains(e.relatedTarget)) grid.classList.remove("lzpg-dropping");
        });
        grid.addEventListener("drop", (e) => {
            if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
            e.preventDefault();
            grid.classList.remove("lzpg-dropping");
            if (!o().busy && o().onDropFiles) o().onDropFiles(e.dataTransfer.files);
        });

        grid.addEventListener("pointerdown", (e) => startDrag(e, host, grid));
    }

    // Reordering by dragging. Mouse: starts after a small move. Touch: starts
    // after a press-and-hold, so an ordinary swipe still scrolls the page.
    function startDrag(e, host, grid) {
        const o = host._lzpg;
        const slot = e.target.closest(".lzpg-photo");
        if (!slot || o.busy || e.target.closest("[data-act]")) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;

        const from = Number(slot.dataset.i);
        const startX = e.clientX, startY = e.clientY;
        const isTouch = e.pointerType !== "mouse";
        let dragging = false, ghost = null, over = null, holdTimer = null, done = false;

        // While dragging on a phone, stop the page scrolling and follow the
        // finger from the touch events too (some browsers stop sending
        // pointer events once they think a scroll has started).
        const blockScroll = (ev) => {
            if (!dragging) return;
            ev.preventDefault();
            const t = ev.touches && ev.touches[0];
            if (t) place(t.clientX, t.clientY);
        };
        const cancel = () => { if (!dragging) cleanup(); };

        const begin = (x, y) => {
            dragging = true;
            const r = slot.getBoundingClientRect();
            ghost = document.createElement("div");
            ghost.className = "lzpg-ghost";
            ghost.style.width = r.width + "px";
            ghost.style.height = r.height + "px";
            ghost.innerHTML = '<img src="' + esc(o.items[from].url) + '" alt="">';
            document.body.appendChild(ghost);
            slot.classList.add("lzpg-lifted");
            place(x, y);
            if (isTouch && navigator.vibrate) { try { navigator.vibrate(15); } catch (err) { /* ignore */ } }
        };

        const place = (x, y) => {
            if (!ghost) return;
            ghost.style.left = (x - ghost.offsetWidth / 2) + "px";
            ghost.style.top = (y - ghost.offsetHeight / 2) + "px";
            const el = document.elementFromPoint(x, y);
            const target = el && el.closest ? el.closest(".lzpg-slot") : null;
            const next = target && grid.contains(target) ? target : null;
            if (over && over !== next) over.classList.remove("lzpg-over");
            over = next;
            if (over && over !== slot) over.classList.add("lzpg-over");
        };

        const move = (ev) => {
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            if (!dragging) {
                if (isTouch) {
                    // Moving before the hold completes means the person is scrolling.
                    if (Math.hypot(dx, dy) > 10) cleanup();
                    return;
                }
                if (Math.hypot(dx, dy) < 6) return;
                begin(ev.clientX, ev.clientY);
            }
            ev.preventDefault();
            place(ev.clientX, ev.clientY);
        };

        const end = () => {
            if (done) return;
            let to = null;
            if (dragging && over) {
                to = over.dataset.i !== undefined ? Number(over.dataset.i) : o.items.length - 1;
            }
            cleanup();
            if (to !== null && to !== from && o.onMove) o.onMove(from, Math.min(to, o.items.length - 1));
        };

        const cleanup = () => {
            done = true;
            clearTimeout(holdTimer);
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", end);
            document.removeEventListener("pointercancel", cancel);
            document.removeEventListener("touchmove", blockScroll);
            document.removeEventListener("touchend", end);
            document.removeEventListener("touchcancel", cleanup);
            if (ghost) ghost.remove();
            if (over) over.classList.remove("lzpg-over");
            slot.classList.remove("lzpg-lifted");
            dragging = false;
        };

        document.addEventListener("pointermove", move, { passive: false });
        document.addEventListener("pointerup", end);
        document.addEventListener("pointercancel", cancel);
        document.addEventListener("touchmove", blockScroll, { passive: false });
        document.addEventListener("touchend", end);
        document.addEventListener("touchcancel", cleanup);
        if (isTouch) {
            holdTimer = setTimeout(() => begin(startX, startY), 350);
        }
    }

    // Move one entry of an array to a new index (the form's list helper).
    function moveItem(list, from, to) {
        if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
        const copy = list.slice();
        const [it] = copy.splice(from, 1);
        copy.splice(to, 0, it);
        return copy;
    }

    const api = { render, moveItem, MAX_STORE: 20, MAX_VENDOR: 8 };
    if (typeof module === "object" && module.exports) module.exports = api;
    if (typeof window !== "undefined") window.LzPhotoGrid = api;
})();
