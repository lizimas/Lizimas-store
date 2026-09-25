// Live word / character count under long text boxes (Ryan, Sept 2026).
// Any <textarea data-lz-count> gets a small counter below it; there is no
// cap on product descriptions - this just shows how much has been written.
(function () {
    function attach(ta) {
        if (ta.dataset.lzCountBound) return;
        ta.dataset.lzCountBound = "1";
        const out = document.createElement("div");
        out.className = "lz-text-count";
        out.setAttribute("aria-live", "polite");
        ta.insertAdjacentElement("afterend", out);
        const update = () => {
            const text = ta.value || "";
            const words = (text.trim().match(/\S+/g) || []).length;
            out.textContent = `${words.toLocaleString()} word${words === 1 ? "" : "s"} \u00b7 ${text.length.toLocaleString()} characters`;
        };
        ta.addEventListener("input", update);
        // Values set from code (edit forms) don't fire "input" - poll lightly.
        let last = null;
        setInterval(() => { if (ta.value !== last) { last = ta.value; update(); } }, 800);
        update();
    }
    function init() { document.querySelectorAll("textarea[data-lz-count]").forEach(attach); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
