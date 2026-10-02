// Product description / Highlights rich text: only the allow-list survives.
const test = require("node:test");
const assert = require("node:assert");
const { sanitizeRichText, toPlainText } = require("../server/utils/richText");
const clean = (s) => sanitizeRichText(s).html;

test("ordinary editor output is kept", () => {
    const html = '<h2>Welcome</h2><p class="lzr-in1">A <strong>bold</strong> and <em>italic</em> <a href="https://lizimasstore.com/x?a=1&amp;b=2">link</a>.</p>'
        + '<ul><li>One</li><li>Two</li></ul><blockquote><p>Quote</p></blockquote>'
        + '<figure class="lzr-img lzr-center"><img src="https://res.cloudinary.com/x/a.jpg" alt="Wide screen view"><figcaption>Front</figcaption></figure>'
        + '<table><tbody><tr><th colspan="2">Spec</th></tr><tr><td>RAM</td><td>12GB</td></tr></tbody></table>'
        + '<figure class="lzr-media"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe></figure>';
    const out = clean(html);
    for (const part of ["<h2>Welcome</h2>", '<p class="lzr-in1">', "<strong>bold</strong>", 'href="https://lizimasstore.com/x?a=1&amp;b=2"', 'rel="noopener nofollow"',
        "<ul><li>One</li><li>Two</li></ul>", "<blockquote><p>Quote</p></blockquote>", 'class="lzr-img lzr-center"', 'alt="Wide screen view"', "<figcaption>Front</figcaption>",
        '<th colspan="2">Spec</th>', 'src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"']) assert.ok(out.includes(part), part + "\n" + out);
});

test("scripts, handlers and bad links never survive", () => {
    const attacks = [
        '<script>alert(1)</script><p>ok</p>', '<img src="https://a.b/c.jpg" onerror="alert(1)">', '<img src=x onerror=alert(1)>',
        '<a href="javascript:alert(1)">x</a>', '<a href="JaVaScRiPt:alert(1)">x</a>', '<a href="&#106;avascript:alert(1)">x</a>', '<a href=" javascript:alert(1)">x</a>',
        '<iframe src="https://evil.example/embed/abcdefgh"></iframe>', '<iframe src="https://www.youtube.com/embed/abcdefgh?autoplay=1" onload="x()"></iframe>',
        '<p style="background:url(javascript:alert(1))">x</p>', '<svg onload=alert(1)><circle/></svg>', '<p class="evil lzr-in1" id="x">t</p>',
        '<img src="https://a.b/c.jpg" alt=\'"><script>alert(1)</script>\'>', '<<script>alert(1)//<</script>', '<p>a<b onclick="x()">b</b></p>',
        '<math><mtext><script>alert(1)</script></mtext></math>', '<object data="x"></object><embed src="x">', '<a href="data:text/html,<script>alert(1)</script>">x</a>',
        '<img src="data:image/svg+xml,<svg onload=alert(1)>">', '<form action="https://evil"><input name=q></form>', '<p>unclosed <strong>tag'
    ];
    for (const a of attacks) {
        const out = clean(a);
        assert.ok(!/<script|onerror|onload|onclick|javascript:|data:|<svg|<math|<object|<embed|<form|<input|style=|evil\.example| id=/i.test(out), a + " -> " + out);
    }
    assert.strictEqual(clean('<p class="evil lzr-in1" id="x">t</p>'), '<p class="lzr-in1">t</p>');
    assert.strictEqual(clean("<p>unclosed <strong>tag"), "<p>unclosed <strong>tag</strong></p>");
    assert.strictEqual(clean('<iframe src="https://www.youtube.com/embed/abcdefgh?autoplay=1"></iframe>'), "");
    assert.strictEqual(clean("<p><br></p><p> &nbsp; </p>"), "");
    assert.strictEqual(clean("5 < 6 & 7 > 2"), "5  2");          // a stray "<...>" is dropped, never passed through
    assert.strictEqual(clean("Tom &amp; Jerry &lt;3"), "Tom &amp; Jerry &lt;3");
});

test("plain text for search and the feed", () => {
    const html = clean("<h2>Samsung</h2><p>Great &amp; fast.</p><ul><li>12GB RAM</li><li>5000mAh battery</li></ul>");
    assert.strictEqual(toPlainText(html), "Samsung\nGreat & fast.\n\n- 12GB RAM\n- 5000mAh battery");
});

test("photo cards keep their structure and classes", () => {
    const src = '<ul class="lzr-cards lzr-show evil" contenteditable="false"><li><h4>Fast</h4><p>Charges quickly.</p><figure class="lzr-img"><img src="https://a.b/c.jpg" alt="Fast"><figcaption>45 minutes</figcaption></figure></li></ul>';
    assert.strictEqual(clean(src), '<ul class="lzr-cards lzr-show"><li><h4>Fast</h4><p>Charges quickly.</p><figure class="lzr-img"><img src="https://a.b/c.jpg" alt="Fast" loading="lazy"><figcaption>45 minutes</figcaption></figure></li></ul>');
});
