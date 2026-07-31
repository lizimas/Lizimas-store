const API_BASE = "/api";

async function apiGet(endpoint) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`);

        if (!response.ok) {
            let serverMessage = `Request failed: ${response.status}`;
            try {
                const body = await response.json();
                if (body && body.error) serverMessage = body.error;
            } catch (parseError) {
                // Non-JSON error response - fall back to the status line
            }
            throw new Error(serverMessage);
        }

        return await response.json();
    } catch (error) {
        console.error("GET API Error:", error);
        throw error;
    }
}

async function apiPost(endpoint, data) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            let serverMessage = `Request failed: ${response.status}`;
            try {
                const body = await response.json();
                if (body && body.error) serverMessage = body.error;
            } catch (parseError) {
                // Non-JSON error response - fall back to the status line
            }
            throw new Error(serverMessage);
        }

        return await response.json();
    } catch (error) {
        console.error("POST API Error:", error);
        throw error;
    }
}
async function apiGetAuth(endpoint) {
    const token = localStorage.getItem("userToken");
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            headers: token ? { "Authorization": `Bearer ${token}` } : {}
        });

        if (!response.ok) {
            let serverMessage = `Request failed: ${response.status}`;
            try {
                const body = await response.json();
                if (body && body.error) serverMessage = body.error;
            } catch (parseError) {
                // Non-JSON error response - fall back to the status line
            }
            throw new Error(serverMessage);
        }

        return await response.json();
    } catch (error) {
        console.error("GET AUTH API Error:", error);
        throw error;
    }
}

async function apiPostAuth(endpoint, data) {
    const token = localStorage.getItem("userToken");
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { "Authorization": `Bearer ${token}` } : {})
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            let serverMessage = `Request failed: ${response.status}`;
            try {
                const body = await response.json();
                if (body && body.error) serverMessage = body.error;
            } catch (parseError) {
                // Non-JSON error response - fall back to the status line
            }
            throw new Error(serverMessage);
        }

        return await response.json();
    } catch (error) {
        console.error("POST AUTH API Error:", error);
        throw error;
    }
}

window.apiGet = apiGet;
window.apiPost = apiPost;
window.apiGetAuth = apiGetAuth;
window.apiPostAuth = apiPostAuth;
