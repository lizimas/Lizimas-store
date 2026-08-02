import subprocess

def q(sql):
    out = subprocess.run(
        ["psql", "-d", "lizimas_store", "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, text=True, check=True).stdout
    rows = []
    for line in out.strip().split("\n"):
        if not line:
            continue
        parts = line.split("\t")
        # psql drops trailing empty fields; top-level rows have no parent
        while len(parts) < 4:
            parts.append("")
        rows.append(parts)
    return rows

rows = q("""
SELECT c.name, c.display_order,
       COALESCE(p.name, ''), COALESCE(g.name, '')
FROM categories c
LEFT JOIN categories p ON p.id = c.parent_id
LEFT JOIN categories g ON g.id = p.parent_id
ORDER BY (CASE WHEN c.parent_id IS NULL THEN 1
               WHEN p.parent_id IS NULL THEN 2
               ELSE 3 END),
         COALESCE(g.display_order, p.display_order, c.display_order),
         COALESCE(p.display_order, c.display_order), c.display_order
""")

def esc(v):
    return v.replace("'", "''")

lines = [
    "-- 010: Full category tree, matched by name so it is safe on any database.",
    "-- Generated from the local tree. Re-runnable: existing rows are left alone.",
    "",
    "BEGIN;",
    "",
]

for name, order, parent, grand in rows:
    order = order or "0"
    if not parent:
        lines.append(
            f"INSERT INTO categories (name, display_order) "
            f"SELECT '{esc(name)}', {order} "
            f"WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = '{esc(name)}' AND parent_id IS NULL);")
    elif not grand:
        lines.append(
            f"INSERT INTO categories (name, parent_id, display_order) "
            f"SELECT '{esc(name)}', p.id, {order} FROM categories p "
            f"WHERE p.name = '{esc(parent)}' AND p.parent_id IS NULL "
            f"AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = '{esc(name)}' AND c.parent_id = p.id);")
    else:
        lines.append(
            f"INSERT INTO categories (name, parent_id, display_order) "
            f"SELECT '{esc(name)}', p.id, {order} FROM categories p JOIN categories g ON g.id = p.parent_id "
            f"WHERE p.name = '{esc(parent)}' AND g.name = '{esc(grand)}' "
            f"AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = '{esc(name)}' AND c.parent_id = p.id);")

lines += ["", "COMMIT;"]

open("migrations/010_full_tree.sql", "w").write("\n".join(lines) + "\n")
print(f"{len(rows)} categories written")
