#!/usr/bin/env python3
"""
dedupe_css.py - consolidate duplicate top-level selector blocks in a stylesheet.

Safety model: this does NOT do string matching. It parses brace depth, collects
every top-level block for a selector, computes the final cascaded value of each
property, then rewrites the file so that a single merged block produces the
*identical* computed result. It re-parses the output and aborts if any computed
value differs. Blocks inside @media / @supports are never touched.

Usage:
    python3 dedupe_css.py client/css/style.css .product-card
    python3 dedupe_css.py client/css/style.css .product-card .cart-row --apply

Default is dry-run. --apply writes a timestamped .bak first.
"""

import sys, re, shutil, datetime, argparse


# ----------------------------------------------------------------- parsing

def strip_comments(css):
    """Blank out comments but preserve length + newlines so offsets stay valid."""
    out = list(css)
    i, n = 0, len(css)
    while i < n - 1:
        if css[i] == '/' and css[i + 1] == '*':
            j = css.find('*/', i + 2)
            j = n if j == -1 else j + 2
            for k in range(i, j):
                if out[k] != '\n':
                    out[k] = ' '
            i = j
        else:
            i += 1
    return ''.join(out)


def top_level_blocks(css):
    """Yield (selector, sel_start, body_start, body_end, block_end) at depth 0."""
    clean = strip_comments(css)
    depth = 0
    i = 0
    sel_start = 0
    n = len(clean)
    while i < n:
        c = clean[i]
        if c == '{':
            if depth == 0:
                # take the selector from the comment-stripped copy, otherwise a
                # comment sitting above a rule becomes part of its selector
                selector = clean[sel_start:i].strip()
                sel_start += len(clean[sel_start:i]) - len(clean[sel_start:i].lstrip())
                body_start = i + 1
                d = 1
                j = i + 1
                while j < n and d:
                    if clean[j] == '{':
                        d += 1
                    elif clean[j] == '}':
                        d -= 1
                    j += 1
                if not selector.startswith('@'):
                    yield selector, sel_start, body_start, j - 1, j
                i = j
                sel_start = j
                continue
            depth += 1
        elif c == '}':
            if depth:
                depth -= 1
            else:
                sel_start = i + 1
        i += 1


def declarations(body):
    """Parse a block body into an ordered list of (prop, value) pairs."""
    decls = []
    depth = 0
    buf = ''
    for ch in strip_comments(body):
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ';' and depth == 0:
            if ':' in buf:
                p, v = buf.split(':', 1)
                decls.append((p.strip().lower(), ' '.join(v.split())))
            buf = ''
        else:
            buf += ch
    if ':' in buf:
        p, v = buf.split(':', 1)
        decls.append((p.strip().lower(), ' '.join(v.split())))
    return decls


def computed(css, selector):
    """Final cascaded property map for a selector, top-level blocks only."""
    result = {}
    for sel, _, bs, be, _ in top_level_blocks(css):
        if sel == selector:
            for p, v in declarations(css[bs:be]):
                result[p] = v
    return result


def line_of(css, offset):
    return css.count('\n', 0, offset) + 1


# --------------------------------------------------------------- rewriting

def consolidate(css, selector):
    """Return (new_css, report) merging all top-level blocks for `selector`."""
    blocks = [b for b in top_level_blocks(css) if b[0] == selector]
    if len(blocks) < 2:
        return css, f"{selector}: {len(blocks)} block(s), nothing to merge"

    merged = {}
    origin = {}
    for sel, ss, bs, be, end in blocks:
        for p, v in declarations(css[bs:be]):
            merged[p] = v
            origin[p] = line_of(css, ss)

    indent = '  '
    body = '\n'.join(f"{indent}{p}: {v};" for p, v in merged.items())
    keep = blocks[-1]                      # last position keeps the cascade
    new_block = f"{selector} {{\n{body}\n}}"

    pieces = []
    cursor = 0
    for sel, ss, bs, be, end in blocks:
        pieces.append(css[cursor:ss])
        if (ss, end) == (keep[1], keep[4]):
            pieces.append(new_block)
        else:
            # drop the block; swallow one trailing newline to avoid blank gaps
            if end < len(css) and css[end] == '\n':
                end += 1
        cursor = end
    pieces.append(css[cursor:])

    dead = []
    for sel, ss, bs, be, end in blocks[:-1]:
        ln = line_of(css, ss)
        if not any(origin[p] == ln for p in merged):
            dead.append(ln)

    report = (f"{selector}: {len(blocks)} blocks -> 1 "
              f"(kept at line {line_of(css, keep[1])}, "
              f"{len(merged)} properties)")
    if dead:
        report += f"\n    fully-overridden blocks removed: lines {dead}"
    return ''.join(pieces), report


# -------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('path')
    ap.add_argument('selectors', nargs='+')
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    original = open(args.path, encoding='utf-8').read()
    css = original
    reports = []

    for sel in args.selectors:
        before = computed(css, sel)
        css, rep = consolidate(css, sel)
        after = computed(css, sel)
        if before != after:
            diff = {k: (before.get(k), after.get(k))
                    for k in set(before) | set(after)
                    if before.get(k) != after.get(k)}
            sys.exit(f"ABORT: computed values changed for {sel}: {diff}")
        reports.append(rep)

    # global guard: nothing outside the target selectors may shift
    for sel, _, _, _, _ in top_level_blocks(original):
        if sel not in args.selectors:
            if computed(original, sel) != computed(css, sel):
                sys.exit(f"ABORT: side effect on unrelated selector {sel}")

    print('\n'.join(reports))
    print(f"\nlines: {original.count(chr(10)) + 1} -> {css.count(chr(10)) + 1}")
    print(f"bytes: {len(original)} -> {len(css)}")

    if not args.apply:
        print("\nDRY RUN - no changes written. Re-run with --apply.")
        return

    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    bak = f"{args.path}.{stamp}.bak"
    shutil.copy2(args.path, bak)
    open(args.path, 'w', encoding='utf-8').write(css)
    print(f"\nbackup: {bak}\nwritten: {args.path}")


if __name__ == '__main__':
    main()
