const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/database");

const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret_in_env_file";
const TOKEN_EXPIRY = "7d";

async function registerUser(req, res) {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: "Name, email, and password are required." });
    }

    try {
        const existingUser = await pool.query(
            "SELECT id FROM users WHERE email = $1",
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: "An account with this email already exists." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            "INSERT INTO users (name, email, password, phone) VALUES ($1, $2, $3, $4) RETURNING id, name, email, phone, role",
            [name, email, hashedPassword, phone || null]
        );

        const newUser = result.rows[0];

        const token = jwt.sign(
            { userId: newUser.id, email: newUser.email, role: newUser.role },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );

        res.status(201).json({
            message: "Account created successfully.",
            token,
            user: { id: newUser.id, name: newUser.name, email: newUser.email, phone: newUser.phone, role: newUser.role }
        });

    } catch (error) {
        console.error("Register error:", error);
        res.status(500).json({ error: "Something went wrong while creating your account." });
    }
}

async function loginUser(req, res) {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    try {
        const result = await pool.query(
            "SELECT id, name, email, password, phone, role FROM users WHERE email = $1",
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const user = result.rows[0];
        const passwordMatches = await bcrypt.compare(password, user.password);

        if (!passwordMatches) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );

        res.json({
            message: "Login successful.",
            token,
            user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role }
        });

    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Something went wrong while logging in." });
    }
}

async function getCurrentUser(req, res) {
    try {
        const result = await pool.query(
            "SELECT id, name, email, phone, role FROM users WHERE id = $1",
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        res.json({ user: result.rows[0] });

    } catch (error) {
        console.error("Get current user error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
}

module.exports = { registerUser, loginUser, getCurrentUser };
