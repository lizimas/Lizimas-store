/*!
 * lz-image.js — Cloudinary delivery-URL normaliser for Lizimas Store
 *
 * Mirrors LuLu's approach: every image is cropped and sized at the CDN via
 * URL params, not at upload time. Ratios below match the ones measured on
 * gcc.luluhypermarket.com (hero 1920x1168 = 1.644:1, tile 1920x1388 = 1.383:1).
 *
 * Works in Node (require) and in the browser (window.LZImage). No deps.
 *
 * Usage (browser):
 *   LZImage.url(cat.image_url, 'tile')
 *   LZImage.tile({ name: 'Electronics', slug: 'electronics', image_url: '...' })
 *
 * Usage (Node):
 *   const LZImage = require('./lz-image');
 *   res.json(rows.map(r => ({ ...r, image_tile: LZImage.url(r.image_url, 'tile') })));
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LZImage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- presets */

  // c_fill  = crop to fill the box (banners, category art — subject can be cropped)
  // c_pad   = letterbox inside the box on white (product shots — never crop stock)
  // g_auto  = Cloudinary picks the focal point; better than LuLu's plain cropCenter
  var PRESETS = {
    hero:     'c_fill,g_auto,w_1600,h_974',   // 1.644:1 — desktop hero banner
    heroSm:   'c_fill,g_auto,w_800,h_487',    // 1.644:1 — mobile hero
    banner:   'c_fill,g_auto,w_1200,h_400',   // 3:1     — inline promo strip
    tile:     'e_trim:10/c_fit,w_520,h_520/c_pad,w_600,h_600,b_white', // 1:1 category tile
    tileSm:   'e_trim:10/c_fit,w_260,h_260/c_pad,w_300,h_300,b_white', // 1:1 mobile tile
    circle:   'c_fill,g_auto,w_240,h_240,r_max', // round shortcut icon
    product:  'e_trim:10/c_fit,w_720,h_720/c_pad,w_800,h_800,b_white', // detail page
    card:     'e_trim:10/c_fit,w_350,h_350/c_pad,w_400,h_400,b_white', // grid card
    thumb:    'c_pad,b_white,w_120,h_120',    // cart line, gallery strip

    // Plain variants — no trim. Use when the source has a busy or
    // photographic background, where e_trim has nothing uniform to cut.
    tileFlat: 'c_pad,b_white,w_600,h_600',
    // No crop, no pad - only a dimension cap. For tiles where CSS
    // object-fit: cover does the framing and a CDN crop would fight it.
    tileRaw:  'c_limit,w_600,h_600',
    cardFlat: 'c_pad,b_white,w_400,h_400'
  };

  // f_auto -> WebP/AVIF where supported; q_auto -> per-image quality
  var BASE = 'f_auto,q_auto';

  // Brand colours for the fallback tile. Adjust if your navy/gold differ.
  var NAVY = '#0b2545';
  var GOLD = '#f0b323';

  /* ------------------------------------------------------------ url rewrite */

  var MARKER = '/image/upload/';

  // Known Cloudinary transformation parameter prefixes. Used to detect (and
  // strip) an existing transform segment so presets never stack on re-render.
  var PARAM = /^(a|ac|af|ar|b|bo|br|c|co|cs|d|dl|dn|dpr|du|e|eo|f|fl|fn|g|h|if|l|o|p|pg|q|r|so|t|u|vc|vs|w|x|y|z)_/;

  function isTransformSegment(seg) {
    if (!seg || /^v\d+$/.test(seg)) return false; // version segment, keep it
    var toks = seg.split(',');
    for (var i = 0; i < toks.length; i++) {
      if (!PARAM.test(toks[i])) return false;
    }
    return true;
  }

  /**
   * Rewrite a Cloudinary URL to a named preset (or a raw transform string).
   * Non-Cloudinary URLs and falsy values are returned untouched, so this is
   * safe to sprinkle over legacy rows that still hold local /uploads/ paths.
   */
  function url(src, preset) {
    if (!src || typeof src !== 'string') return src;
    var at = src.indexOf(MARKER);
    if (at === -1) return src;

    var t = PRESETS[preset] || preset || PRESETS.card;
    var head = src.slice(0, at + MARKER.length);
    var segs = src.slice(at + MARKER.length).split('/');

    while (segs.length > 1 && isTransformSegment(segs[0])) segs.shift();

    return head + BASE + ',' + t + '/' + segs.join('/');
  }

  /** Double the w_/h_ of a preset for a 2x srcset entry. */
  function retina(preset) {
    var t = PRESETS[preset] || preset;
    return t.replace(/\b([wh])_(\d+)/g, function (_, k, n) {
      return k + '_' + Math.min(parseInt(n, 10) * 2, 2000);
    });
  }

  function srcset(src, preset) {
    if (!src || src.indexOf(MARKER) === -1) return '';
    return url(src, preset) + ' 1x, ' + url(src, retina(preset)) + ' 2x';
  }

  /** Intrinsic width/height for a preset — set these to stop layout shift. */
  function dims(preset) {
    var t = PRESETS[preset] || preset || '';
    // Read the LAST w_/h_ in the chain — that is the final output size.
    var last = t.split('/').pop();
    var w = /\bw_(\d+)/.exec(last);
    var h = /\bh_(\d+)/.exec(last);
    return { w: w ? +w[1] : null, h: h ? +h[1] : null };
  }

  /* -------------------------------------------------------------- fallback */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Initial-letter placeholder as a data URI. A category with no artwork
   * renders as a branded tile instead of a broken image — which is what the
   * blank tiles on production need until the level-1 uploads land.
   */
  function placeholder(name, ratio) {
    var w = 600, h = ratio === 'square' ? 600 : 434;
    var initial = esc(String(name || '?').trim().charAt(0).toUpperCase());
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<rect width="' + w + '" height="' + h + '" fill="' + NAVY + '"/>' +
      '<text x="50%" y="50%" dy="0.35em" text-anchor="middle" fill="' + GOLD + '" ' +
      'font-family="Georgia,serif" font-size="' + Math.round(h * 0.42) + '" font-weight="700">' +
      initial + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ------------------------------------------------------------ tile markup */

  /**
   * Render a category tile. The name appears twice on purpose — once as the
   * img alt, once as the visible caption — so the tile stays navigable and
   * indexable even when the image 404s. That is exactly what LuLu does.
   *
   * cat  : { name, slug, image_url }
   * opts : { preset, href, className, eager }
   */
  function tile(cat, opts) {
    cat = cat || {};
    opts = opts || {};

    var name = cat.name || cat.title || '';
    var preset = opts.preset || 'tile';
    var d = dims(preset);
    var href = opts.href || ('/category.html?slug=' + encodeURIComponent(cat.slug || ''));
    var cls = opts.className || 'cat-tile';
    var src = cat.image_url || cat.image || '';
    var ph = placeholder(name, preset === 'circle' ? 'square' : 'wide');

    var imgAttrs = src
      ? 'src="' + esc(url(src, preset)) + '" srcset="' + esc(srcset(src, preset)) + '"'
      : 'src="' + ph + '"';

    return '<a class="' + esc(cls) + '" href="' + esc(href) + '">' +
      '<img class="' + esc(cls) + '__img" ' + imgAttrs +
        ' alt="' + esc(name) + '"' +
        (d.w ? ' width="' + d.w + '" height="' + d.h + '"' : '') +
        ' loading="' + (opts.eager ? 'eager' : 'lazy') + '" decoding="async"' +
        ' onerror="this.onerror=null;this.removeAttribute(\'srcset\');this.src=\'' + ph + '\'">' +
      '<span class="' + esc(cls) + '__label">' + esc(name) + '</span>' +
      '</a>';
  }

  /* ------------------------------------------------------------------ api */

  return {
    url: url,
    srcset: srcset,
    dims: dims,
    retina: retina,
    tile: tile,
    placeholder: placeholder,
    esc: esc,
    PRESETS: PRESETS
  };
});
