// Phase 4 - Vendor Billing Cycles controller.
//
// Weekly cycles (Mon-Sun) pay every vendor on a fixed schedule, matching
// Jumia's Vendor Center. Instead of on-demand payout requests, admin (or
// later, cron) closes each week to generate vendor_statements.
// The current OPEN cycle accumulates earnings; admin closes it (manually here,
// via cron in Phase 4B) to generate one vendor_statements row per vendor with
// non-zero activity or a carried-forward balance.
//
// The numbers MUST agree with what the wallet shows the vendor in real time.
// We reuse the same classification logic (classifyOrderItemForWallet) so a
// delivered order looks identical in both places.

const pool = require("../config/database");
const { MIN_PAYOUT_UGX, classifyOrderItemForWallet } = require("../utils/vendorWallet");
const { logActivity } = require("../utils/activityLog");
const { createVendorNotification } = require("./vendorController");
const crypto = require("crypto");
const { generateStatementPdf } = require("../utils/statementPdf");
const { generateStatementCsv } = require("../utils/statementCsv");
const { statementNumber } = require("../utils/statementNumber");
const { getUsdToUgxRate, convertUgxToUsd, normalizeAmount, round2 } = require("../utils/fxRate");
const { sendStatementReadyEmail, sendStatementPaidEmail } = require("../utils/mailer");

// --- Helpers ------------------------------------------------------------

// First day of a bi-weekly period. Given a date, returns the start of the
// cycle that date falls into: 1st-15th or 16th-end-of-month.
// Weekly cycle: Monday through Sunday, matching Jumia's Vendor Center.
// Given any date, returns the ISO date strings for the Monday and Sunday
// of the week it falls into.
function cycleBoundsForDate(d) {
    const dt = new Date(d);
    const dayOfWeek = dt.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    // Days to subtract to reach Monday. Sunday (0) goes back 6 days.
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const monday = new Date(dt);
    monday.setUTCDate(dt.getUTCDate() - daysFromMonday);
    monday.setUTCHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    const pad = (n) => String(n).padStart(2, "0");
    const ymd = (x) => `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;

    return { start: ymd(monday), end: ymd(sunday) };
}

// When a cycle ends, the cron runs at 06:00 UTC the following day.
function closesAtForPeriodEnd(periodEnd) {
    const d = new Date(periodEnd + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(6, 0, 0, 0);
    return d.toISOString();
}

// --- Endpoint: getCurrentCycle -----------------------------------------
// Returns the currently OPEN cycle, or null. Also returns days remaining.
exports.getCurrentCycle = async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id,
                    period_start::text AS period_start,
                    period_end::text AS period_end,
                    closes_at, status, is_test, created_at
             FROM vendor_billing_cycles
             WHERE status = 'open'
             ORDER BY period_start DESC LIMIT 1`
        );
        const cycle = rows[0] || null;
        if (!cycle) return res.json({ cycle: null });
        const ms = new Date(cycle.closes_at) - new Date();
        const daysRemaining = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
        res.json({ cycle, daysRemaining });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Endpoint: ensureCurrentCycle --------------------------------------
// Idempotent: creates the cycle for "today" if none is open. Used by the
// cron in Phase 4B and by admin bootstrap here.
exports.ensureCurrentCycle = async (req, res) => {
    try {
        const { rows: existing } = await pool.query(
            `SELECT id, period_start, period_end, closes_at, status, is_test
             FROM vendor_billing_cycles WHERE status = 'open' LIMIT 1`
        );
        if (existing.length > 0) return res.json({ cycle: existing[0], created: false });

        const { start, end } = cycleBoundsForDate(new Date());
        const closesAt = closesAtForPeriodEnd(end);
        const isTest = req.body && req.body.is_test === true;

        const { rows } = await pool.query(
            `INSERT INTO vendor_billing_cycles (period_start, period_end, closes_at, status, is_test)
             VALUES ($1, $2, $3, 'open', $4)
             RETURNING id,
                    period_start::text AS period_start,
                    period_end::text AS period_end,
                    closes_at, status, is_test`,
            [start, end, closesAt, isTest]
        );
        logActivity(req.user.userId, "billing_cycle_opened", "billing_cycle", rows[0].id,
            `Cycle ${start} to ${end}${isTest ? " (TEST)" : ""}`);
        res.status(201).json({ cycle: rows[0], created: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Endpoint: listCyclesAdmin -----------------------------------------
exports.listCyclesAdmin = async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT c.id,
                    c.period_start::text AS period_start,
                    c.period_end::text AS period_end,
                    c.closes_at, c.status, c.is_test,
                    c.statements_generated_at, c.created_at,
                    COUNT(s.id)::int AS statement_count,
                    -- Phase 4 Beat 3: a cycle can contain both UGX and USD
                    -- statements, so this MUST sum a common unit (UGX
                    -- equivalent) rather than raw amount_due, which would
                    -- otherwise silently add USD numbers onto a UGX total.
                    COALESCE(SUM(
                        CASE WHEN s.currency = 'USD' AND s.fx_rate_used IS NOT NULL
                             THEN s.amount_due * s.fx_rate_used
                             ELSE s.amount_due END
                    ), 0)::numeric AS total_due,
                    COUNT(s.id) FILTER (WHERE s.status = 'paid')::int AS paid_count,
                    COUNT(s.id) FILTER (WHERE s.status = 'pending')::int AS pending_count
             FROM vendor_billing_cycles c
             LEFT JOIN vendor_statements s ON s.cycle_id = c.id
             GROUP BY c.id
             ORDER BY c.period_start DESC`
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Fire-and-forget: send "your statement is ready" emails to each vendor
// whose statement was just generated. Loads vendor email + PDF, sends in
// background, never blocks the response or throws.
async function emailStatementReady(statementId, vendorId) {
    try {
        const data = await loadStatementExport(statementId);
        if (!data) return;

        const { rows } = await pool.query(
            "SELECT u.email, u.name FROM vendors v JOIN users u ON u.id = v.user_id WHERE v.id = $1",
            [vendorId]
        );
        if (rows.length === 0 || !rows[0].email) return;

        const pdf = await generateStatementPdf(data);
        const stmtNo = statementNumber({
            vendorId: data.vendor.id,
            periodEnd: data.cycle.period_end
        });
        const filename = "Lizimas-Statement-" + stmtNo + ".pdf";

        // Populate statement_number on the data object for the email template
        data.statement.statement_number = stmtNo;

        await sendStatementReadyEmail(
            rows[0].email,
            rows[0].name || data.vendor.business_name,
            data.statement,
            data.cycle,
            pdf,
            filename
        );
    } catch (err) {
        console.error("emailStatementReady failed for statement", statementId, err.message);
    }
}

// Fire-and-forget: send "payout sent" email after markStatementPaid.
async function emailStatementPaid(statementId, vendorId) {
    try {
        const data = await loadStatementExport(statementId);
        if (!data) return;

        const { rows } = await pool.query(
            "SELECT u.email, u.name FROM vendors v JOIN users u ON u.id = v.user_id WHERE v.id = $1",
            [vendorId]
        );
        if (rows.length === 0 || !rows[0].email) return;

        const pdf = await generateStatementPdf(data);
        const stmtNo = statementNumber({
            vendorId: data.vendor.id,
            periodEnd: data.cycle.period_end
        });
        const filename = "Lizimas-Statement-" + stmtNo + ".pdf";
        data.statement.statement_number = stmtNo;

        await sendStatementPaidEmail(
            rows[0].email,
            rows[0].name || data.vendor.business_name,
            data.statement,
            data.cycle,
            pdf,
            filename
        );
    } catch (err) {
        console.error("emailStatementPaid failed for statement", statementId, err.message);
    }
}

// --- Endpoint: closeCycleAndGenerateStatements -------------------------
// Core algorithm. Reads all earnings, deductions, adjustments for the
// cycle window, computes each vendor's amount due, writes statements and
// itemized lines. Rolls forward anything below MIN_PAYOUT_UGX.
exports.closeCycleAndGenerateStatements = async (req, res) => {
    const client = await pool.connect();
    try {
        const cycleId = req.params.id;

        const { rows: cycleRows } = await client.query(
            `SELECT id, period_start, period_end, status, is_test
             FROM vendor_billing_cycles WHERE id = $1 FOR UPDATE`,
            [cycleId]
        );
        if (cycleRows.length === 0) return res.status(404).json({ error: "Cycle not found." });
        const cycle = cycleRows[0];
        if (cycle.status !== "open") {
            return res.status(409).json({ error: `Cycle is already ${cycle.status}.` });
        }

        await client.query("BEGIN");

        // Mark processing so a concurrent call can't double-generate.
        await client.query(
            `UPDATE vendor_billing_cycles SET status = 'processing' WHERE id = $1`,
            [cycleId]
        );

        // 1. Opening balance: sum of any ROLLED_FORWARD statements from prior
        //    cycles, one per vendor. Rolled-forward statements are from the
        //    previous closed cycle, so we take the most recent one per vendor.
        const { rows: rolledRows } = await client.query(
            `SELECT DISTINCT ON (vendor_id) vendor_id, amount_due
             FROM vendor_statements
             WHERE status = 'rolled_forward'
             ORDER BY vendor_id, cycle_id DESC`
        );
        const rolledByVendor = new Map(rolledRows.map(r => [r.vendor_id, Number(r.amount_due)]));

        // 2. All vendors with any activity during the cycle, plus anyone
        //    with a rolled-forward balance.
        const { rows: vendorRows } = await client.query(
            `SELECT DISTINCT v.id AS vendor_id, v.business_name, v.preferred_currency
             FROM vendors v
             LEFT JOIN products p ON p.vendor_id = v.id
             LEFT JOIN order_items oi ON oi.product_id = p.id
             LEFT JOIN orders o ON o.id = oi.order_id
             WHERE v.status = 'approved'
               AND (
                 (o.status = 'delivered' AND oi.delivered_at >= $1 AND oi.delivered_at < $2::date + INTERVAL '1 day')
                 OR v.id = ANY($3::int[])
               )`,
            [cycle.period_start, cycle.period_end, Array.from(rolledByVendor.keys()).length ? Array.from(rolledByVendor.keys()) : [0]]
        );

        // Phase 4 Beat 3: lock ONE USD exchange rate for this entire cycle
        // close (not per-vendor) - every USD-denominated statement out of
        // this close should share the same rate, and this fails the whole
        // close loudly (before any statement is written) rather than ever
        // silently guessing a rate for a real payout.
        let fxRateForThisClose = null;
        if (vendorRows.some((v) => v.preferred_currency === "USD")) {
            fxRateForThisClose = (await getUsdToUgxRate()).rate;
        }

        let created = 0;
        let totalDue = 0;

        for (const vendor of vendorRows) {
            const vendorId = vendor.vendor_id;
            const openingBalance = rolledByVendor.get(vendorId) || 0;

            // 3. Earnings + charges from delivered items in this cycle
            const { rows: itemRows } = await client.query(
                `SELECT oi.id AS order_item_id, oi.price, oi.quantity,
                        COALESCE(oi.commission_rate_applied, p.commission_rate_applied) AS rate,
                        COALESCE(oi.fixed_fee_applied, p.fixed_fee_applied) AS fixed_fee,
                        o.status AS order_status, oi.handover_status
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 WHERE p.vendor_id = $1
                   AND o.status = 'delivered'
                   AND oi.delivered_at >= $2
                   AND oi.delivered_at < $3::date + INTERVAL '1 day'`,
                [vendorId, cycle.period_start, cycle.period_end]
            );

            let earnings = 0;
            let commissions = 0;
            let refunds = 0;
            const lines = [];

            for (const item of itemRows) {
                const saleAmount = Number(item.price) * Number(item.quantity);
                const chargeAmount = item.rate !== null
                    ? saleAmount * Number(item.rate) + Number(item.fixed_fee || 0) * Number(item.quantity)
                    : 0;
                const classification = classifyOrderItemForWallet({
                    orderStatus: item.order_status,
                    handoverStatus: item.handover_status
                });

                if (classification === "available") {
                    earnings += saleAmount;
                    commissions += chargeAmount;
                    lines.push({
                        line_type: "order_earning",
                        reference_id: item.order_item_id,
                        description: `Order item #${item.order_item_id}`,
                        amount: saleAmount
                    });
                    if (chargeAmount > 0) {
                        lines.push({
                            line_type: "commission",
                            reference_id: item.order_item_id,
                            description: `Marketplace charge on item #${item.order_item_id}`,
                            amount: -chargeAmount
                        });
                    }
                } else if (classification === "refunded") {
                    refunds += saleAmount;
                    lines.push({
                        line_type: "refund",
                        reference_id: item.order_item_id,
                        description: `Refund clawback on item #${item.order_item_id}`,
                        amount: -saleAmount
                    });
                }
            }

            // 4. Admin ledger adjustments created during the cycle
            const { rows: adjRows } = await client.query(
                `SELECT id, amount, reason FROM vendor_ledger_adjustments
                 WHERE vendor_id = $1 AND created_at >= $2 AND created_at < $3::date + INTERVAL '1 day'`,
                [vendorId, cycle.period_start, cycle.period_end]
            );
            let adjustments = 0;
            for (const adj of adjRows) {
                const amt = Number(adj.amount);
                adjustments += amt;
                lines.push({
                    line_type: "adjustment",
                    reference_id: adj.id,
                    description: adj.reason,
                    amount: amt
                });
            }

            // 5. Compute amount due
            const amountDue = openingBalance + earnings - commissions - refunds + adjustments;

            // 6. Roll forward if below minimum OR negative
            // NOTE: the MIN_PAYOUT_UGX threshold and the rolled-forward
            // carry-forward logic both stay in raw UGX terms deliberately -
            // MIN_PAYOUT_UGX is a UGX constant, and rolledByVendor (step 1)
            // reads back amount_due assuming UGX for anyone not yet on USD.
            const status = amountDue < MIN_PAYOUT_UGX ? "rolled_forward" : "pending";

            // Phase 4 Beat 3: statement currency. Everything computed above
            // stays real UGX ledger math - only the STATEMENT's own summary
            // (and, below, its itemized lines) get converted into the
            // vendor's preferred_currency using the one rate locked for this
            // close. currency/fx_rate_used are what statementPdf.js and
            // statementCsv.js already read to label amounts - see
            // migrations/100_statement_currency_columns.sql.
            const vendorCurrency = vendor.preferred_currency === "USD" ? "USD" : "UGX";
            const fxRateUsed = vendorCurrency === "USD" ? fxRateForThisClose : null;
            const displayOpeningBalance = vendorCurrency === "USD" ? convertUgxToUsd(openingBalance, fxRateUsed) : openingBalance;
            const displayEarnings = vendorCurrency === "USD" ? convertUgxToUsd(earnings, fxRateUsed) : earnings;
            const displayCommissions = vendorCurrency === "USD" ? convertUgxToUsd(commissions, fxRateUsed) : commissions;
            const displayRefunds = vendorCurrency === "USD" ? convertUgxToUsd(refunds, fxRateUsed) : refunds;
            const displayAdjustments = vendorCurrency === "USD" ? convertUgxToUsd(adjustments, fxRateUsed) : adjustments;
            const displayAmountDue = vendorCurrency === "USD" ? convertUgxToUsd(amountDue, fxRateUsed) : amountDue;

            // 7. Insert statement
            const { rows: stmtRows } = await client.query(
                `INSERT INTO vendor_statements
                 (cycle_id, vendor_id, opening_balance, earnings, commissions,
                  refund_deductions, adjustments, amount_due, status, currency, fx_rate_used)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 RETURNING id`,
                [cycleId, vendorId, displayOpeningBalance, displayEarnings, displayCommissions,
                 displayRefunds, displayAdjustments, displayAmountDue, status, vendorCurrency, fxRateUsed]
            );
            const statementId = stmtRows[0].id;

            // 8. Insert itemized lines
            if (openingBalance !== 0) {
                lines.unshift({
                    line_type: "opening_balance",
                    reference_id: null,
                    description: "Balance carried from prior cycle",
                    amount: openingBalance
                });
            }
            lines.push({
                line_type: "closing_balance",
                reference_id: null,
                description: "Total due this cycle",
                amount: amountDue
            });

            // Convert every line into the same currency as the statement itself
            // (including the synthetic opening/closing lines just added above)
            // so the PDF/CSV/UI, which format every line with the statement's
            // one `currency` field, never show a UGX number mislabeled as USD.
            const linesToInsert = vendorCurrency === "USD"
                ? lines.map((l) => ({ ...l, amount: convertUgxToUsd(l.amount, fxRateUsed) }))
                : lines;

            for (const line of linesToInsert) {
                await client.query(
                    `INSERT INTO vendor_statement_lines (statement_id, line_type, reference_id, description, amount)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [statementId, line.line_type, line.reference_id, line.description, line.amount]
                );
            }

            if (status !== "rolled_forward") {
                created += 1;
                totalDue += amountDue;
            }
        }

        await client.query(
            `UPDATE vendor_billing_cycles
             SET status = 'statements_generated',
                 statements_generated_at = now(),
                 statements_generated_by = $1
             WHERE id = $2`,
            [req.user.userId, cycleId]
        );

        await client.query("COMMIT");

        logActivity(req.user.userId, "billing_cycle_closed", "billing_cycle", cycleId,
            `${created} statement(s) generated, total UGX ${totalDue.toLocaleString()}${cycle.is_test ? " (TEST)" : ""}`);

        // Fire statement-ready emails in the background (best-effort, one
        // per vendor with a real statement). Never blocks the response.
        if (!cycle.is_test) {
            pool.query(
                `SELECT id, vendor_id FROM vendor_statements
                 WHERE cycle_id = $1 AND status != 'rolled_forward'`,
                [cycleId]
            ).then(({ rows }) => {
                for (const s of rows) {
                    emailStatementReady(s.id, s.vendor_id).catch(() => {});
                }
            }).catch((err) => {
                console.error("Failed to queue statement-ready emails:", err.message);
            });
        }

        res.json({
            cycleId,
            statements_created: created,
            total_due: totalDue,
            is_test: cycle.is_test
        });
    } catch (error) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        // If we already marked processing, revert to open so admin can retry.
        try {
            await pool.query(
                `UPDATE vendor_billing_cycles SET status = 'open' WHERE id = $1 AND status = 'processing'`,
                [req.params.id]
            );
        } catch (_) {}
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

// --- Endpoint: listStatementsAdmin -------------------------------------
exports.listStatementsAdmin = async (req, res) => {
    try {
        const { cycle_id, status } = req.query;
        const params = [];
        const conds = [];
        if (cycle_id) { params.push(cycle_id); conds.push(`s.cycle_id = $${params.length}`); }
        if (status) { params.push(status); conds.push(`s.status = $${params.length}`); }
        const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

        const { rows } = await pool.query(
            `SELECT s.id, s.cycle_id, s.vendor_id, s.opening_balance, s.earnings,
                    s.commissions, s.refund_deductions, s.adjustments, s.amount_due,
                    s.status, s.approved_at, s.paid_at, s.failure_reason, s.created_at,
                    s.currency, s.fx_rate_used,
                    (CASE WHEN s.currency = 'USD' AND s.fx_rate_used IS NOT NULL
                          THEN s.amount_due * s.fx_rate_used
                          ELSE s.amount_due END) AS ugx_equivalent,
                    v.business_name, v.phone,
                    COALESCE(k.kyc_status, 'not_started') AS kyc_status
             FROM vendor_statements s
             JOIN vendors v ON v.id = s.vendor_id
             LEFT JOIN vendor_kyc k ON k.vendor_id = v.id
             ${where}
             ORDER BY s.amount_due DESC, v.business_name`,
            params
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Endpoint: getStatementDetail --------------------------------------
exports.getStatementDetail = async (req, res) => {
    try {
        const { rows: stmtRows } = await pool.query(
            `SELECT s.*, v.business_name, v.phone, v.momo_number
             FROM vendor_statements s
             JOIN vendors v ON v.id = s.vendor_id
             WHERE s.id = $1`,
            [req.params.id]
        );
        if (stmtRows.length === 0) return res.status(404).json({ error: "Statement not found." });
        const { rows: lines } = await pool.query(
            `SELECT id, line_type, reference_id, description, amount, created_at
             FROM vendor_statement_lines WHERE statement_id = $1 ORDER BY id`,
            [req.params.id]
        );
        res.json({ statement: stmtRows[0], lines });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Endpoint: batchApproveStatements ----------------------------------
exports.batchApproveStatements = async (req, res) => {
    try {
        const { cycle_id } = req.body;
        if (!cycle_id) return res.status(400).json({ error: "cycle_id is required." });

        const { rowCount } = await pool.query(
            `UPDATE vendor_statements
             SET status = 'approved', approved_at = now(), approved_by = $1
             WHERE cycle_id = $2 AND status = 'pending'`,
            [req.user.userId, cycle_id]
        );
        logActivity(req.user.userId, "billing_statements_batch_approved", "billing_cycle", cycle_id,
            `${rowCount} statement(s) approved`);

        // Notify each vendor their statement is approved.
        const { rows: approved } = await pool.query(
            `SELECT id, vendor_id, amount_due FROM vendor_statements
             WHERE cycle_id = $1 AND status = 'approved'`,
            [cycle_id]
        );
        for (const s of approved) {
            await createVendorNotification(s.vendor_id, "payout_update", {
                status: "approved",
                amount: s.amount_due
            }).catch(() => {});
        }

        res.json({ approved: rowCount });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Endpoint: markStatementPaid ---------------------------------------
// Creates a vendor_payouts row linked to the statement, marks both paid.
// In test mode, skips the vendor_payouts row entirely.
exports.markStatementPaid = async (req, res) => {
    const client = await pool.connect();
    try {
        const statementId = req.params.id;
        const { reference, notes } = req.body;

        const { rows: stmtRows } = await client.query(
            `SELECT s.id, s.vendor_id, s.amount_due, s.status, s.cycle_id,
                    c.is_test, v.momo_number, v.business_name
             FROM vendor_statements s
             JOIN vendor_billing_cycles c ON c.id = s.cycle_id
             JOIN vendors v ON v.id = s.vendor_id
             WHERE s.id = $1 FOR UPDATE`,
            [statementId]
        );
        if (stmtRows.length === 0) return res.status(404).json({ error: "Statement not found." });
        const s = stmtRows[0];
        if (s.status !== "approved") {
            return res.status(409).json({ error: `Statement is ${s.status}, must be 'approved' first.` });
        }
        if (!s.momo_number) {
            return res.status(400).json({ error: "Vendor has no MoMo number on file." });
        }

        // Phase 5: payment instrument approval. The check above only ever
        // confirmed a MoMo number EXISTS, never that it was reviewed or
        // belongs to this vendor under their own verified legal name - a
        // fully KYC-verified vendor could still have quietly changed
        // vendors.momo_number to someone else's account. Once a vendor has
        // engaged with the reviewed-instrument system at all (has at least
        // one row here), their PREFERRED instrument must be approved
        // before any payout goes out. Vendors who haven't yet submitted
        // any instrument fall through to the legacy momo_number check
        // above unchanged, so existing payouts aren't blocked store-wide
        // the moment this ships - only once someone's the actual audit
        // trail for a mismatch review, e.g. the account was flagged for
        // review, this gate takes over.
        const anyInstrument = await client.query(
            "SELECT 1 FROM vendor_payment_instruments WHERE vendor_id = $1 LIMIT 1",
            [s.vendor_id]
        );
        if (anyInstrument.rows.length > 0) {
            const preferredRow = await client.query(
                `SELECT vpi.status FROM vendors v
                 LEFT JOIN vendor_payment_instruments vpi ON vpi.id = v.preferred_instrument_id
                 WHERE v.id = $1`,
                [s.vendor_id]
            );
            const preferredStatus = preferredRow.rows[0] ? preferredRow.rows[0].status : null;
            if (preferredStatus !== "approved") {
                return res.status(409).json({
                    error: "no_approved_payment_instrument",
                    message: "This vendor's preferred payment instrument isn't approved yet. Review and approve a payment instrument (Payment Instruments queue) before paying this statement."
                });
            }
        }

        await client.query("BEGIN");

        let payoutId = null;
        if (!s.is_test) {
            const { rows: payoutRows } = await client.query(
                `INSERT INTO vendor_payouts (vendor_id, amount, method, momo_number, status, reference, notes, statement_id)
                 VALUES ($1, $2, 'momo', $3, 'paid', $4, $5, $6)
                 RETURNING id`,
                [s.vendor_id, s.amount_due, s.momo_number, reference || null, notes || null, statementId]
            );
            payoutId = payoutRows[0].id;
        }

        await client.query(
            `UPDATE vendor_statements
             SET status = 'paid', paid_at = now(), payout_id = $1
             WHERE id = $2`,
            [payoutId, statementId]
        );

        await client.query("COMMIT");

        logActivity(req.user.userId, "billing_statement_paid", "vendor_statement", statementId,
            `UGX ${Number(s.amount_due).toLocaleString()} paid to ${s.business_name}${s.is_test ? " (TEST - no payout row)" : ""}`);

        await createVendorNotification(s.vendor_id, "payout_update", {
            status: "paid",
            amount: s.amount_due
        }).catch(() => {});

        // Fire the "payout sent" email with PDF attachment (best-effort).
        if (!s.is_test) {
            emailStatementPaid(statementId, s.vendor_id).catch(() => {});
        }

        res.json({ message: "Statement marked paid.", payoutId, test: s.is_test });
    } catch (error) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

// --- Endpoint: rejectStatement -----------------------------------------
exports.rejectStatement = async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason || !reason.trim()) return res.status(400).json({ error: "reason required." });

        const { rowCount } = await pool.query(
            `UPDATE vendor_statements
             SET status = 'rejected', failure_reason = $1
             WHERE id = $2 AND status IN ('pending','approved')`,
            [reason, req.params.id]
        );
        if (rowCount === 0) return res.status(409).json({ error: "Statement not in a rejectable state." });

        logActivity(req.user.userId, "billing_statement_rejected", "vendor_statement", req.params.id, reason);
        res.json({ message: "Statement rejected." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


// --- Statement export helpers ------------------------------------------

// Loads everything the PDF/CSV generators need for one statement.
async function loadStatementExport(statementId) {
    const { rows: sRows } = await pool.query(
        `SELECT s.*, c.period_start::text AS cycle_period_start,
                c.period_end::text AS cycle_period_end, c.is_test AS cycle_is_test,
                v.id AS vendor_row_id, v.business_name, v.phone, v.momo_number,
                v.account_type, v.preferred_currency,
                u.name AS owner_name,
                COALESCE(k.kyc_status, 'not_started') AS kyc_status
         FROM vendor_statements s
         JOIN vendor_billing_cycles c ON c.id = s.cycle_id
         JOIN vendors v ON v.id = s.vendor_id
         LEFT JOIN users u ON u.id = v.user_id
         LEFT JOIN vendor_kyc k ON k.vendor_id = v.id
         WHERE s.id = $1`,
        [statementId]
    );
    if (sRows.length === 0) return null;
    const row = sRows[0];

    const { rows: lines } = await pool.query(
        `SELECT line_type, reference_id, description, amount
         FROM vendor_statement_lines
         WHERE statement_id = $1
         ORDER BY id`,
        [statementId]
    );

    return {
        statement: row,
        lines,
        vendor: {
            id: row.vendor_row_id,
            business_name: row.business_name,
            owner_name: row.owner_name,
            phone: row.phone,
            momo_number: row.momo_number,
            account_type: row.account_type,
            kyc_status: row.kyc_status
        },
        cycle: {
            period_start: row.cycle_period_start,
            period_end: row.cycle_period_end
        }
    };
}

// --- Endpoint: download PDF (admin) -----------------------------------
exports.downloadStatementPdfAdmin = async (req, res) => {
    try {
        const data = await loadStatementExport(req.params.id);
        if (!data) return res.status(404).json({ error: "Statement not found." });
        const pdf = await generateStatementPdf(data);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="statement-${req.params.id}.pdf"`);
        res.send(pdf);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Endpoint: download CSV (admin) -----------------------------------
exports.downloadStatementCsvAdmin = async (req, res) => {
    try {
        const data = await loadStatementExport(req.params.id);
        if (!data) return res.status(404).json({ error: "Statement not found." });
        const csv = generateStatementCsv(data);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="statement-${req.params.id}.csv"`);
        res.send(csv);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Endpoint: download PDF (vendor's own) ----------------------------
exports.downloadStatementPdfVendor = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile." });

        const ownerCheck = await pool.query(
            "SELECT vendor_id FROM vendor_statements WHERE id = $1",
            [req.params.id]
        );
        if (ownerCheck.rows.length === 0) return res.status(404).json({ error: "Statement not found." });
        if (Number(ownerCheck.rows[0].vendor_id) !== Number(vendorId)) {
            return res.status(403).json({ error: "This statement does not belong to you." });
        }

        const data = await loadStatementExport(req.params.id);
        const pdf = await generateStatementPdf(data);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="statement-${req.params.id}.pdf"`);
        res.send(pdf);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Endpoint: download CSV (vendor's own) ----------------------------
exports.downloadStatementCsvVendor = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile." });

        const ownerCheck = await pool.query(
            "SELECT vendor_id FROM vendor_statements WHERE id = $1",
            [req.params.id]
        );
        if (ownerCheck.rows.length === 0) return res.status(404).json({ error: "Statement not found." });
        if (Number(ownerCheck.rows[0].vendor_id) !== Number(vendorId)) {
            return res.status(403).json({ error: "This statement does not belong to you." });
        }

        const data = await loadStatementExport(req.params.id);
        const csv = generateStatementCsv(data);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="statement-${req.params.id}.csv"`);
        res.send(csv);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Transactions Exports (vendor) --------------------------------------
// migrations/129_vendor_transaction_exports.sql. The list under Account
// Statements; each row can be downloaded again (files are rebuilt on demand).
const EXPORT_KINDS = ["statement_pdf", "statement_csv", "all_transactions"];

async function vendorStatementLabel(statementId, vendorId) {
    const { rows } = await pool.query(
        `SELECT s.id, s.vendor_id, c.period_start::text AS period_start, c.period_end::text AS period_end, s.created_at
         FROM vendor_statements s LEFT JOIN vendor_billing_cycles c ON c.id = s.cycle_id
         WHERE s.id = $1`,
        [statementId]
    );
    if (!rows.length) return { error: "Statement not found.", code: 404 };
    if (Number(rows[0].vendor_id) !== Number(vendorId)) return { error: "This statement does not belong to you.", code: 403 };
    const r = rows[0];
    const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "");
    const number = statementNumber({ vendorId, periodEnd: r.period_end || r.created_at });
    return { label: `${number}${r.period_start ? ` (${fmt(r.period_start)} - ${fmt(r.period_end)})` : ""}` };
}

exports.listTransactionExportsVendor = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile." });
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 5));
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const [rows, total] = await Promise.all([
            pool.query(
                `SELECT id, kind, statement_id, requested, status, created_at
                 FROM vendor_transaction_exports WHERE vendor_id = $1
                 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
                [vendorId, limit, (page - 1) * limit]
            ),
            pool.query("SELECT COUNT(*)::int AS n FROM vendor_transaction_exports WHERE vendor_id = $1", [vendorId])
        ]);
        res.json({ exports: rows.rows, total: total.rows[0].n, page, limit });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.recordTransactionExportVendor = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile." });
        const kind = String((req.body || {}).kind || "");
        if (!EXPORT_KINDS.includes(kind)) return res.status(400).json({ error: "Unknown export type." });
        let statementId = null;
        let requested = "All statements";
        if (kind !== "all_transactions") {
            statementId = Number((req.body || {}).statement_id);
            if (!Number.isInteger(statementId) || statementId <= 0) return res.status(400).json({ error: "Choose a statement to export." });
            const found = await vendorStatementLabel(statementId, vendorId);
            if (found.error) return res.status(found.code).json({ error: found.error });
            requested = found.label;
        }
        const { rows } = await pool.query(
            `INSERT INTO vendor_transaction_exports (vendor_id, kind, statement_id, requested, status, created_by)
             VALUES ($1, $2, $3, $4, 'ready', $5)
             RETURNING id, kind, statement_id, requested, status, created_at`,
            [vendorId, kind, statementId, requested, req.user && (req.user.userId || req.user.id) || null]
        );
        res.status(201).json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Every statement's transactions in one CSV (newest first), one section per
// statement - the same content as each statement's own CSV.
exports.downloadAllTransactionsCsvVendor = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile." });
        const { rows } = await pool.query(
            `SELECT s.id FROM vendor_statements s LEFT JOIN vendor_billing_cycles c ON c.id = s.cycle_id
             WHERE s.vendor_id = $1 ORDER BY c.period_start DESC NULLS LAST, s.id DESC`,
            [vendorId]
        );
        if (!rows.length) return res.status(404).json({ error: "You have no statements to export yet." });
        let csv = "";
        for (const r of rows) {
            const data = await loadStatementExport(r.id);
            csv += generateStatementCsv(data) + "\r\n\r\n";
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="all-transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.send(csv);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Endpoint: mint a share link (vendor) -----------------------------
// 30-day default expiry. Returns a URL like /api/statements/share/<token>.
exports.shareStatementVendor = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile." });

        const ownerCheck = await pool.query(
            "SELECT vendor_id FROM vendor_statements WHERE id = $1",
            [req.params.id]
        );
        if (ownerCheck.rows.length === 0) return res.status(404).json({ error: "Statement not found." });
        if (Number(ownerCheck.rows[0].vendor_id) !== Number(vendorId)) {
            return res.status(403).json({ error: "This statement does not belong to you." });
        }

        const token = crypto.randomBytes(32).toString("hex");
        const { rows } = await pool.query(
            `INSERT INTO statement_share_tokens (statement_id, token, created_by, expires_at)
             VALUES ($1, $2, $3, now() + INTERVAL '30 days')
             RETURNING token, expires_at`,
            [req.params.id, token, req.user.userId]
        );

        res.json({
            share_url: "/api/statements/share/" + rows[0].token,
            full_url: (process.env.PUBLIC_BASE_URL || "") + "/api/statements/share/" + rows[0].token,
            expires_at: rows[0].expires_at
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Endpoint: public statement viewer (no auth) ----------------------
// Serves the PDF if the token is valid, not revoked, and not expired.
exports.serveSharedStatement = async (req, res) => {
    try {
        const { token } = req.params;
        if (!token || token.length !== 64) return res.status(404).send("Not found");

        const { rows } = await pool.query(
            `SELECT id, statement_id, expires_at, revoked_at
             FROM statement_share_tokens WHERE token = $1`,
            [token]
        );
        if (rows.length === 0) return res.status(404).send("Not found");
        const t = rows[0];
        if (t.revoked_at) return res.status(410).send("This link has been revoked");
        if (new Date(t.expires_at) < new Date()) return res.status(410).send("This link has expired");

        // Record access for audit.
        await pool.query(
            `UPDATE statement_share_tokens
             SET last_accessed_at = now(), access_count = access_count + 1
             WHERE id = $1`,
            [t.id]
        );

        const data = await loadStatementExport(t.statement_id);
        if (!data) return res.status(404).send("Not found");

        const pdf = await generateStatementPdf(data);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline");
        res.send(pdf);
    } catch (error) {
        res.status(500).send("Server error");
    }
};


// --- Endpoint: listVendorStatements (vendor's own) --------------------
// Powers the vendor's Account Statements page. Returns:
//   - currentCycle: the OPEN cycle right now (or null), with days remaining
//   - statements:   ALL of this vendor's statements, newest first
//   - metrics:      the 3 Jumia-style summary cards
//     * due_and_unpaid         = sum of UNPAID statements (pending + approved + failed + rolled)
//     * open_statement_estimated = current cycle's running total (not yet closed)
//     * paid_last_3_months     = sum of paid statements in the last 90 days
exports.listVendorStatements = async (req, res) => {
    try {
        const vendorId = req.vendorId;
        if (!vendorId) return res.status(404).json({ error: "No vendor profile." });
        const vendorCurrencyRow = await pool.query("SELECT preferred_currency, shop_id FROM vendors WHERE id = $1", [vendorId]);
        const currency = vendorCurrencyRow.rows[0]?.preferred_currency || "UGX";
        // Seller ID shown in the Account Statements breadcrumb.
        const sellerId = vendorCurrencyRow.rows[0]?.shop_id || null;

        // --- Current open cycle ---
        const { rows: cycleRows } = await pool.query(
            `SELECT id, period_start::text AS period_start, period_end::text AS period_end,
                    closes_at, status, is_test
             FROM vendor_billing_cycles
             WHERE status = 'open'
             ORDER BY period_start DESC LIMIT 1`
        );
        let currentCycle = null;
        if (cycleRows.length > 0) {
            const c = cycleRows[0];
            const ms = new Date(c.closes_at) - new Date();
            const daysRemaining = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));

            // Running estimate for this cycle: earnings delivered during the
            // window, minus commissions, minus refunds, plus adjustments.
            const { rows: estRows } = await pool.query(
                `SELECT
                    COALESCE(SUM(oi.price * oi.quantity), 0) AS earnings,
                    COALESCE(SUM(
                      CASE WHEN oi.commission_rate_applied IS NOT NULL
                           THEN oi.price * oi.quantity * oi.commission_rate_applied
                                + COALESCE(oi.fixed_fee_applied, 0) * oi.quantity
                           ELSE 0 END
                    ), 0) AS commissions
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 JOIN products p ON p.id = oi.product_id
                 WHERE p.vendor_id = $1
                   AND o.status = 'delivered'
                   AND oi.delivered_at >= $2
                   AND oi.delivered_at < $3::date + INTERVAL '1 day'`,
                [vendorId, c.period_start, c.period_end]
            );
            const earningsUgx = Number(estRows[0].earnings) || 0;
            const commissionsUgx = Number(estRows[0].commissions) || 0;
            const estimatedAmountUgx = earningsUgx - commissionsUgx;

            // Phase 4 Beat 3: this cycle is still OPEN - nothing is locked
            // yet, so this is a live-rate estimate purely for display. The
            // real fx_rate_used gets locked once, for real, at cycle close
            // (closeCycleAndGenerateStatements) - that's what determines the
            // actual payout amount, not this preview.
            let estimatedAmount = estimatedAmountUgx;
            let estCurrency = currency;
            if (currency === "USD") {
                try {
                    const { rate } = await getUsdToUgxRate();
                    estimatedAmount = convertUgxToUsd(estimatedAmountUgx, rate);
                } catch (fxError) {
                    // Live rate unavailable right now - fall back to the
                    // real UGX number rather than mislabeling it as USD.
                    console.error("listVendorStatements: fx conversion failed for open-cycle estimate:", fxError.message);
                    estCurrency = "UGX";
                }
            }

            currentCycle = {
                id: c.id,
                period_start: c.period_start,
                period_end: c.period_end,
                closes_at: c.closes_at,
                daysRemaining,
                estimatedAmount,
                currency: estCurrency
            };
        }

        // --- All statements (newest first) ---
        const { rows: statements } = await pool.query(
            `SELECT s.id, s.cycle_id, s.opening_balance, s.earnings, s.commissions,
                    s.refund_deductions, s.adjustments, s.amount_due, s.status,
                    s.paid_at, s.created_at, s.currency, s.fx_rate_used,
                    c.period_start::text AS period_start,
                    c.period_end::text AS period_end
             FROM vendor_statements s
             JOIN vendor_billing_cycles c ON c.id = s.cycle_id
             WHERE s.vendor_id = $1
             ORDER BY c.period_end DESC, s.id DESC`,
            [vendorId]
        );

        // Add display_status and statement_number per row
        const statementsOut = statements.map(s => {
            let display;
            if (s.status === "paid") display = "PAID";
            else if (s.status === "rejected") display = "REJECTED";
            else display = "UNPAID"; // pending, approved, failed, rolled_forward
            return {
                id: s.id,
                cycle_id: s.cycle_id,
                period_start: s.period_start,
                period_end: s.period_end,
                statement_number: statementNumber({ vendorId, periodEnd: s.period_end }),
                opening_balance: Number(s.opening_balance),
                earnings: Number(s.earnings),
                commissions: Number(s.commissions),
                refund_deductions: Number(s.refund_deductions),
                adjustments: Number(s.adjustments),
                amount_due: Number(s.amount_due),
                status: s.status,
                display_status: display,
                paid_at: s.paid_at,
                created_at: s.created_at,
                currency: s.currency || currency,
                fx_rate_used: s.fx_rate_used !== null && s.fx_rate_used !== undefined ? Number(s.fx_rate_used) : null
            };
        });

        // --- Metrics ---
        let dueAndUnpaid = 0;
        let paidLast3Months = 0;
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setUTCDate(threeMonthsAgo.getUTCDate() - 90);

        for (const s of statements) {
            const amount = Number(s.amount_due);
            // Phase 4 Beat 3: normalize into the vendor's CURRENT preferred
            // currency before summing - a vendor who switched currency
            // between cycles otherwise gets USD and UGX statement amounts
            // added together as if they were the same unit.
            let normalized = amount;
            if ((s.currency || "UGX") !== currency) {
                try {
                    normalized = normalizeAmount(amount, s.currency || "UGX", s.fx_rate_used, currency);
                } catch (normError) {
                    console.error("listVendorStatements: could not normalize statement", s.id, "for metrics:", normError.message);
                }
            }
            if (s.status === "paid") {
                if (s.paid_at && new Date(s.paid_at) >= threeMonthsAgo) {
                    paidLast3Months += normalized;
                }
            } else if (s.status !== "rejected") {
                // pending, approved, failed, rolled_forward all count as "unpaid"
                dueAndUnpaid += normalized;
            }
        }

        const openStatementEstimated = currentCycle ? currentCycle.estimatedAmount : 0;

        res.json({
            currentCycle,
            statements: statementsOut,
            metrics: {
                due_and_unpaid: dueAndUnpaid,
                open_statement_estimated: openStatementEstimated,
                paid_last_3_months: paidLast3Months
            },
            currency,
            seller_id: sellerId
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Endpoint: updateMyPreferredCurrency (Phase 4 Beat 3) --------------
// A vendor's own statement-display currency preference. Only affects
// statements generated AFTER this change - already-generated statements
// keep whatever currency was locked in at their own cycle close, exactly
// like changing your bank's statement currency doesn't rewrite last
// month's PDF.
exports.updateMyPreferredCurrency = async (req, res) => {
    try {
        const { preferred_currency } = req.body;
        if (!["UGX", "USD"].includes(preferred_currency)) {
            return res.status(400).json({ error: "preferred_currency must be UGX or USD." });
        }

        const vendorId = req.vendorId;
        if (!vendorId) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendorRow = await pool.query("SELECT id, preferred_currency FROM vendors WHERE id = $1", [vendorId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendor = vendorRow.rows[0];

        if (vendor.preferred_currency === preferred_currency) {
            return res.json({ message: "Already set.", preferred_currency });
        }

        await pool.query(
            "UPDATE vendors SET preferred_currency = $1 WHERE id = $2",
            [preferred_currency, vendor.id]
        );

        logActivity(req.user.userId, "vendor_currency_changed", "vendor", vendor.id,
            `${vendor.preferred_currency} -> ${preferred_currency}`);

        res.json({ message: "Preferred currency updated.", preferred_currency });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = exports;
module.exports.cycleBoundsForDate = cycleBoundsForDate;
module.exports.closesAtForPeriodEnd = closesAtForPeriodEnd;
