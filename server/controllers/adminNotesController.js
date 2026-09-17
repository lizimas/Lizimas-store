const pool = require("../config/database");
const { logActivity } = require("../utils/activityLog");

// Admin-only reference notes ("Samsung Notes"-style scratchpad). Every
// export here sits behind requireAuth + requireAdmin in
// server/routes/admin.js (router.use(requireAuth, requireAdmin) above the
// /notes routes) - there is no staff- or vendor-facing path to any of this,
// matching Ryan's explicit "okay lets build it only for the admin".

const MAX_TITLE = 200;
const ALLOWED_COLORS = new Set([
    "default", "yellow", "green", "blue", "pink", "purple", "gray"
]);

function normalizeColor(value) {
    const v = String(value || "default").trim().toLowerCase();
    return ALLOWED_COLORS.has(v) ? v : "default";
}

function serializeNote(row) {
    return {
        id: row.id,
        title: row.title,
        body: row.body,
        color: row.color,
        pinned: row.pinned,
        reaction: row.reaction || null,
        createdBy: row.created_by,
        createdByName: row.created_by_name || null,
        updatedBy: row.updated_by,
        updatedByName: row.updated_by_name || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

// GET /api/admin/notes - list all notes, pinned first then most recently
// updated. Optional ?q= does a simple title/body search.
exports.listNotes = async (req, res) => {
    try {
        const q = String(req.query.q || "").trim();
        const params = [];
        let where = "";
        if (q) {
            params.push(`%${q}%`);
            where = `WHERE n.title ILIKE $${params.length} OR n.body ILIKE $${params.length}`;
        }

        const result = await pool.query(
            `SELECT n.*,
                    cu.name AS created_by_name,
                    uu.name AS updated_by_name
             FROM public.admin_notes n
             LEFT JOIN public.users cu ON cu.id = n.created_by
             LEFT JOIN public.users uu ON uu.id = n.updated_by
             ${where}
             ORDER BY n.pinned DESC, n.updated_at DESC`,
            params
        );

        res.json({ notes: result.rows.map(serializeNote) });
    } catch (error) {
        console.error("listNotes error:", error);
        res.status(500).json({ error: "Failed to load notes." });
    }
};

// POST /api/admin/notes
exports.createNote = async (req, res) => {
    try {
        const title = String(req.body.title || "").trim().slice(0, MAX_TITLE);
        const body = String(req.body.body || "");
        const color = normalizeColor(req.body.color);
        const pinned = Boolean(req.body.pinned);

        if (!title && !body) {
            return res.status(400).json({ error: "A note needs a title or some text." });
        }

        const result = await pool.query(
            `INSERT INTO public.admin_notes (title, body, color, pinned, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $5)
             RETURNING *`,
            [title, body, color, pinned, req.user.id]
        );

        await logActivity(req.user.id, "create_admin_note", "admin_note",
            result.rows[0].id, `Created note "${title || "(untitled)"}"`);

        res.status(201).json({ note: serializeNote(result.rows[0]) });
    } catch (error) {
        console.error("createNote error:", error);
        res.status(500).json({ error: "Failed to create note." });
    }
};

// PUT /api/admin/notes/:id
exports.updateNote = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await pool.query(
            `SELECT id FROM public.admin_notes WHERE id = $1`,
            [id]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: "Note not found." });
        }

        const title = String(req.body.title || "").trim().slice(0, MAX_TITLE);
        const body = String(req.body.body || "");
        const color = normalizeColor(req.body.color);
        const pinned = Boolean(req.body.pinned);

        if (!title && !body) {
            return res.status(400).json({ error: "A note needs a title or some text." });
        }

        const result = await pool.query(
            `UPDATE public.admin_notes
             SET title = $1, body = $2, color = $3, pinned = $4,
                 updated_by = $5, updated_at = now()
             WHERE id = $6
             RETURNING *`,
            [title, body, color, pinned, req.user.id, id]
        );

        await logActivity(req.user.id, "update_admin_note", "admin_note", id, "Updated note");

        res.json({ note: serializeNote(result.rows[0]) });
    } catch (error) {
        console.error("updateNote error:", error);
        res.status(500).json({ error: "Failed to update note." });
    }
};

// PATCH /api/admin/notes/:id/pin - quick pin/unpin toggle, kept separate
// from the full update so a one-click pin doesn't need the whole editor form.
exports.setNotePinned = async (req, res) => {
    try {
        const { id } = req.params;
        const pinned = Boolean(req.body.pinned);

        const result = await pool.query(
            `UPDATE public.admin_notes
             SET pinned = $1, updated_by = $2, updated_at = now()
             WHERE id = $3
             RETURNING *`,
            [pinned, req.user.id, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Note not found." });
        }

        res.json({ note: serializeNote(result.rows[0]) });
    } catch (error) {
        console.error("setNotePinned error:", error);
        res.status(500).json({ error: "Failed to update note." });
    }
};

// A small fixed set, mirroring WhatsApp's quick-reaction bar rather than
// a full emoji keyboard - this is a "sticker" on a note, not free text.
const ALLOWED_REACTIONS = new Set([
    "\ud83d\udc4d", "\u2764\ufe0f", "\ud83d\ude02", "\ud83d\ude2e",
    "\ud83d\ude22", "\ud83d\ude4f", "\ud83c\udf89", "\u2b50"
]);

// PATCH /api/admin/notes/:id/reaction - set or clear the note's single emoji
// sticker. { reaction: "\ud83d\udc4d" } sets it, { reaction: null } (or
// omitted) clears it. Kept separate from the full update so tapping a
// reaction doesn't need the whole editor form, same idea as setNotePinned.
exports.setNoteReaction = async (req, res) => {
    try {
        const { id } = req.params;
        const raw = req.body.reaction;
        const reaction = raw && ALLOWED_REACTIONS.has(raw) ? raw : null;

        if (raw && !reaction) {
            return res.status(400).json({ error: "Unsupported reaction." });
        }

        const result = await pool.query(
            `UPDATE public.admin_notes
             SET reaction = $1, updated_at = now()
             WHERE id = $2
             RETURNING *`,
            [reaction, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Note not found." });
        }

        res.json({ note: serializeNote(result.rows[0]) });
    } catch (error) {
        console.error("setNoteReaction error:", error);
        res.status(500).json({ error: "Failed to update reaction." });
    }
};

// DELETE /api/admin/notes/:id
exports.deleteNote = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `DELETE FROM public.admin_notes WHERE id = $1 RETURNING id, title`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Note not found." });
        }

        await logActivity(req.user.id, "delete_admin_note", "admin_note", id,
            `Deleted note "${result.rows[0].title || "(untitled)"}"`);

        res.json({ success: true });
    } catch (error) {
        console.error("deleteNote error:", error);
        res.status(500).json({ error: "Failed to delete note." });
    }
};
