const API_BASE = "/api";

async function apiGet(endpoint) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`);

        if (!response.ok) {
            throw new Error(`Request failed: ${response.status}`);
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
            throw new Error(`Request failed: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error("POST API Error:", error);
        throw error;
    }
}
window.apiGet = apiGet;
window.apiPost = apiPost;
