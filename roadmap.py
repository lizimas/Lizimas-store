#!/usr/bin/env python3
"""Lizimas roadmap tracker. Usage: python3 roadmap.py <command>"""
import json, os, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "roadmap.json")

PHASES = {
    "P0": "Urgent - data at risk",
    "P1": "Identity & structure",
    "P2": "Scale to 15,000 products",
    "P3": "Premium storefront & media",
    "P4": "Ratings, reviews, promotions",
    "P5": "Marketplace & commission",
    "P6": "Payments & go-live",
}

SEED = """
L01|P0|1|Safety|Full pg_dump backup before ANY schema change
L02|P0|1|Orders|Add snapshot columns to order_items
L03|P0|1|Orders|Populate snapshots on order creation
L04|P0|2|Ops|Clean Postgres stop/start scripts
L05|P1|1|Identity|Add products.product_code (LM#######)
L06|P1|1|Identity|Server-side product_code generator
L07|P1|1|Identity|Add product_variants.sku
L08|P1|1|Identity|Add products.slug + /products/<slug> routing
L09|P1|2|Identity|Swap on-page Item ID to show product_code
L10|P1|2|Lifecycle|Replace publish boolean with status enum
L11|P1|2|Schema|Retire duplicate attribute columns on products
L12|P1|3|Schema|Generic options / option_values / variant_option_values
L13|P2|1|Scale|Server-side pagination on /api/products
L14|P2|1|Scale|Server-side filtering and sorting
L15|P2|1|Scale|Database indexes
L16|P2|2|Scale|Postgres full-text search (tsvector)
L17|P2|2|Scale|Infinite scroll / lazy loading
L18|P2|2|Ops|Automated cache-busting for static assets
L19|P2|3|Scale|gzip compression + cache headers
L20|P3|1|Media|Cloudinary responsive transformations
L21|P3|1|Media|srcset + sizes on product images
L22|P3|2|Media|Pinch-zoom / high-res gallery view
L23|P3|2|Media|Skeleton loaders + blur-up placeholders
L24|P3|1|Homepage|Homepage redesign - hero, curated rows, trust
L25|P3|2|Homepage|Collections table (separate from categories)
L26|P3|3|Homepage|Recently viewed + related products
L27|P4|1|Reviews|Denormalise rating_avg + rating_count on products
L28|P4|2|Reviews|Photo upload on reviews
L29|P4|2|Reviews|Helpful voting + review sorting
L30|P4|3|Reviews|Link review to purchased variant
L31|P4|1|Promotions|Discounts table (percent/fixed, date window)
L32|P4|1|Promotions|Free delivery rules (threshold + zone)
L33|P4|2|Promotions|Coupon codes + redemption tracking
L34|P4|2|Promotions|Scheduled launch (publish_at) + countdown
L35|P5|1|Vendors|vendors table + KYC fields
L36|P5|1|Vendors|products.vendor_id + query scoping
L37|P5|2|Vendors|Vendor portal - register, upload, own orders
L38|P5|1|Vendors|Product approval workflow
L39|P5|1|Commission|commission_rules table
L40|P5|1|Commission|Snapshot commission on order_items
L41|P5|1|Commission|Vendor payout ledger
L42|P5|2|Commission|Payout run + MoMo disbursement
L43|P5|3|Vendors|Vendor performance metrics
L44|P6|1|Payments|Card acquirer integration (Flutterwave/Paystack)
L45|P6|1|Payments|Enable 3-D Secure on card transactions
L46|P6|2|Payments|Display-currency conversion (charge UGX)
L47|P6|1|Deploy|Push completed work to GitHub + Render
L48|P6|1|Deploy|Run migrations on Render production database
L49|P6|2|Deploy|Migration runner with version tracking
L50|P6|2|Ops|Error logging + uptime monitoring
"""

C = {"g": "\033[92m", "y": "\033[93m", "r": "\033[91m", "b": "\033[1m", "d": "\033[90m", "x": "\033[0m"}
MARK = {"done": "[x]", "wip": "[~]", "todo": "[ ]", "blocked": "[!]"}
COLOR = {"done": C["g"], "wip": C["y"], "todo": C["d"], "blocked": C["r"]}


def load():
    if not os.path.exists(DB):
        tasks = []
        for line in SEED.strip().splitlines():
            tid, ph, pri, area, title = line.split("|")
            tasks.append({"id": tid, "phase": ph, "pri": int(pri), "area": area,
                          "title": title, "status": "todo", "marker": "",
                          "date": "", "note": ""})
        save({"tasks": tasks})
        print("Created roadmap.json with %d tasks." % len(tasks))
    with open(DB) as f:
        return json.load(f)


def save(data):
    with open(DB, "w") as f:
        json.dump(data, f, indent=2)


def find(data, tid):
    for t in data["tasks"]:
        if t["id"].upper() == tid.upper():
            return t
    return None


def today():
    return datetime.date.today().isoformat()

def line(t, show_marker=False):
    c = COLOR[t["status"]]
    s = "%s%s %s  %s  %-11s %s%s" % (c, MARK[t["status"]], t["id"], t["phase"],
                                     t["area"], t["title"], C["x"])
    if t["status"] == "done" and t["date"]:
        s += C["d"] + "  (" + t["date"] + ")" + C["x"]
    if show_marker and t["marker"]:
        s += "\n      " + C["d"] + "verify: " + t["marker"] + C["x"]
    return s


def cmd_status(data, args):
    ts = data["tasks"]
    done = [t for t in ts if t["status"] == "done"]
    wip = [t for t in ts if t["status"] == "wip"]
    blk = [t for t in ts if t["status"] == "blocked"]
    pct = (len(done) * 100.0 / len(ts)) if ts else 0
    print("")
    print(C["b"] + "LIZIMAS ROADMAP" + C["x"] + "   %d/%d done  (%.0f%%)" % (len(done), len(ts), pct))
    bar = int(pct / 5)
    print("  [" + C["g"] + "#" * bar + C["x"] + "." * (20 - bar) + "]")
    print("")
    for ph in sorted(PHASES):
        p = [t for t in ts if t["phase"] == ph]
        if not p:
            continue
        d = len([t for t in p if t["status"] == "done"])
        flag = C["g"] + " COMPLETE" + C["x"] if d == len(p) else ""
        print("  %s  %-30s %d/%d%s" % (ph, PHASES[ph], d, len(p), flag))
    if wip:
        print("\n" + C["y"] + "IN PROGRESS" + C["x"])
        for t in wip:
            print("  " + line(t))
    if blk:
        print("\n" + C["r"] + "BLOCKED" + C["x"])
        for t in blk:
            print("  " + line(t) + ("  <- " + t["note"] if t["note"] else ""))
    print("")


def cmd_next(data, args):
    n = int(args[0]) if args else 5
    open_t = [t for t in data["tasks"] if t["status"] in ("todo", "wip")]
    open_t.sort(key=lambda t: (t["phase"], t["pri"], t["id"]))
    print("\n" + C["b"] + "NEXT UP" + C["x"])
    for t in open_t[:n]:
        print("  " + line(t))
    print("")


def cmd_list(data, args):
    ts = data["tasks"]
    if args:
        f = args[0].upper()
        ts = [t for t in ts if t["phase"] == f or t["status"] == args[0].lower()]
    print("")
    cur = None
    for t in sorted(ts, key=lambda t: (t["phase"], t["pri"], t["id"])):
        if t["phase"] != cur:
            cur = t["phase"]
            print(C["b"] + "\n%s - %s" % (cur, PHASES.get(cur, "")) + C["x"])
        print("  " + line(t))
    print("")


def cmd_show(data, args):
    if not args:
        return print("Usage: roadmap.py show <ID>")
    t = find(data, args[0])
    if not t:
        return print("No task " + args[0])
    print("")
    print(C["b"] + t["id"] + "  " + t["title"] + C["x"])
    print("  phase   %s - %s" % (t["phase"], PHASES.get(t["phase"], "")))
    print("  area    %s   priority %d" % (t["area"], t["pri"]))
    print("  status  %s%s%s %s" % (COLOR[t["status"]], t["status"], C["x"], t["date"]))
    if t["marker"]:
        print("  verify  " + t["marker"])
    if t["note"]:
        print("  note    " + t["note"])
    print("")


def cmd_done(data, args):
    if not args:
        return print('Usage: roadmap.py done <ID> "verify command"')
    t = find(data, args[0])
    if not t:
        return print("No task " + args[0])
    t["status"] = "done"
    t["date"] = today()
    if len(args) > 1:
        t["marker"] = " ".join(args[1:])
    save(data)
    print("\n" + C["g"] + "DONE" + C["x"] + "  " + t["id"] + "  " + t["title"])
    if not t["marker"]:
        print(C["y"] + "  No verify command recorded." + C["x"])
        print('  Add one:  python3 roadmap.py marker %s "your command"' % t["id"])
    print("")
    cmd_next(data, ["3"])


def cmd_start(data, args):
    if not args:
        return print("Usage: roadmap.py start <ID>")
    t = find(data, args[0])
    if not t:
        return print("No task " + args[0])
    t["status"] = "wip"
    save(data)
    print("Started " + t["id"] + ": " + t["title"])


def cmd_block(data, args):
    if not args:
        return print('Usage: roadmap.py block <ID> "reason"')
    t = find(data, args[0])
    if not t:
        return print("No task " + args[0])
    t["status"] = "blocked"
    t["note"] = " ".join(args[1:])
    save(data)
    print("Blocked " + t["id"] + ": " + t["note"])


def cmd_reset(data, args):
    if not args:
        return print("Usage: roadmap.py reset <ID>")
    t = find(data, args[0])
    if not t:
        return print("No task " + args[0])
    t["status"] = "todo"
    t["date"] = ""
    t["note"] = ""
    save(data)
    print("Reset " + t["id"])


def cmd_marker(data, args):
    if len(args) < 2:
        return print('Usage: roadmap.py marker <ID> "command"')
    t = find(data, args[0])
    if not t:
        return print("No task " + args[0])
    t["marker"] = " ".join(args[1:])
    save(data)
    print("Marker set on " + t["id"] + ": " + t["marker"])


def cmd_add(data, args):
    if len(args) < 3:
        return print('Usage: roadmap.py add <PHASE> <AREA> "title"')
    ids = [int(t["id"][1:]) for t in data["tasks"] if t["id"][1:].isdigit()]
    nid = "L%02d" % (max(ids) + 1 if ids else 1)
    data["tasks"].append({"id": nid, "phase": args[0].upper(), "pri": 2,
                          "area": args[1], "title": " ".join(args[2:]),
                          "status": "todo", "marker": "", "date": "", "note": ""})
    save(data)
    print("Added " + nid + ": " + " ".join(args[2:]))


def cmd_log(data, args):
    d = [t for t in data["tasks"] if t["status"] == "done"]
    d.sort(key=lambda t: t["date"])
    print("\n" + C["b"] + "COMPLETED (%d)" % len(d) + C["x"])
    for t in d:
        print("  " + line(t, show_marker=True))
    print("")


def cmd_export(data, args):
    import csv
    out = os.path.join(HERE, "roadmap_progress.csv")
    ts = sorted(data["tasks"], key=lambda t: (t["phase"], t["pri"], t["id"]))
    done = len([t for t in ts if t["status"] == "done"])
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Lizimas Store - Roadmap Progress"])
        w.writerow(["Exported", today(), "%d of %d done" % (done, len(ts)),
                    "%.0f%%" % (done * 100.0 / len(ts) if ts else 0)])
        w.writerow([])
        w.writerow(["ID", "Phase", "Phase name", "Pri", "Area", "Task",
                    "Status", "Date done", "Verify command", "Note"])
        for t in ts:
            w.writerow([t["id"], t["phase"], PHASES.get(t["phase"], ""), t["pri"],
                        t["area"], t["title"], t["status"], t["date"],
                        t["marker"], t["note"]])
        w.writerow([])
        w.writerow(["SUMMARY BY PHASE"])
        w.writerow(["Phase", "Name", "Done", "Total"])
        for ph in sorted(PHASES):
            g = [t for t in ts if t["phase"] == ph]
            if g:
                w.writerow([ph, PHASES[ph],
                            len([t for t in g if t["status"] == "done"]), len(g)])
    print("\nWrote " + out)
    print("  %d of %d tasks done" % (done, len(ts)))
    print("  Open it in Excel, or share it straight into a Claude chat.\n")


def cmd_help(data, args):
    print("""
Lizimas roadmap tracker

  status               progress overview by phase
  next [n]             the n highest-priority open tasks (default 5)
  list [P0|done|todo]  list tasks, optionally filtered
  show <ID>            full detail for one task
  log                  everything completed, with verify commands
  export               write roadmap_progress.csv for Excel

  start <ID>                  mark in progress
  done <ID> "verify cmd"      mark done and record how to verify it
  marker <ID> "verify cmd"    set/replace the verify command
  block <ID> "reason"         mark blocked
  reset <ID>                  back to todo
  add <PHASE> <AREA> "title"  new task

Paste the output of `status` at the start of a Claude session to resume instantly.
""")


CMDS = {"status": cmd_status, "next": cmd_next, "list": cmd_list, "show": cmd_show,
        "done": cmd_done, "start": cmd_start, "block": cmd_block, "reset": cmd_reset,
        "marker": cmd_marker, "add": cmd_add, "log": cmd_log, "help": cmd_help,
        "export": cmd_export}

if __name__ == "__main__":
    data = load()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    fn = CMDS.get(cmd)
    if not fn:
        print("Unknown command: " + cmd)
        cmd_help(data, [])
        sys.exit(1)
    fn(data, sys.argv[2:])
