// Shared profile photo upload + crop tool.
// Works on both the admin dashboard (getToken/authorizedFetch) and staff
// dashboards (getStaffToken/staffAuthorizedFetch) by detecting which helpers exist.

function getAuthToken() {
    if (typeof getStaffToken === "function") return getStaffToken();
    if (typeof getToken === "function") return getToken();
    return null;
}

let originalPhotoFile = null;

let cropState = { scale: 1, offsetX: 0, offsetY: 0 };
let cropDragging = false;
let cropDragStartX = 0;
let cropDragStartY = 0;
let cropPinchStartDist = 0;
let cropPinchStartScale = 1;

function triggerPhotoUpload() {
    document.getElementById("profile-photo-file-input").click();
}

function handlePhotoFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    originalPhotoFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
        openCropModal(e.target.result);
    };
    reader.readAsDataURL(file);
}

function openCropModal(imageSrc) {
    const img = document.getElementById("crop-image");
    img.onload = () => {
        cropState.scale = 1;
        cropState.offsetX = 0;
        cropState.offsetY = 0;
        updateCropTransform();
    };
    img.src = imageSrc;
    document.getElementById("crop-modal-overlay").classList.add("open");
}

function closeCropModal() {
    document.getElementById("crop-modal-overlay").classList.remove("open");
    document.getElementById("profile-photo-file-input").value = "";
}

function updateCropTransform() {
    const img = document.getElementById("crop-image");
    img.style.transform = `translate(-50%, -50%) translate(${cropState.offsetX}px, ${cropState.offsetY}px) scale(${cropState.scale})`;
}

function setupCropGestures() {
    const viewport = document.getElementById("crop-viewport");
    if (!viewport || viewport.dataset.wired) return;
    viewport.dataset.wired = "true";

    viewport.addEventListener("touchstart", (e) => {
        if (e.touches.length === 1) {
            cropDragging = true;
            cropDragStartX = e.touches[0].clientX - cropState.offsetX;
            cropDragStartY = e.touches[0].clientY - cropState.offsetY;
        } else if (e.touches.length === 2) {
            cropDragging = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            cropPinchStartDist = Math.sqrt(dx * dx + dy * dy);
            cropPinchStartScale = cropState.scale;
        }
    });

    viewport.addEventListener("touchmove", (e) => {
        e.preventDefault();
        if (e.touches.length === 1 && cropDragging) {
            cropState.offsetX = e.touches[0].clientX - cropDragStartX;
            cropState.offsetY = e.touches[0].clientY - cropDragStartY;
            updateCropTransform();
        } else if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            cropState.scale = Math.max(0.5, Math.min(4, cropPinchStartScale * (dist / cropPinchStartDist)));
            updateCropTransform();
        }
    }, { passive: false });

    viewport.addEventListener("touchend", () => {
        cropDragging = false;
    });

    viewport.addEventListener("mousedown", (e) => {
        cropDragging = true;
        cropDragStartX = e.clientX - cropState.offsetX;
        cropDragStartY = e.clientY - cropState.offsetY;
    });

    window.addEventListener("mousemove", (e) => {
        if (!cropDragging) return;
        cropState.offsetX = e.clientX - cropDragStartX;
        cropState.offsetY = e.clientY - cropDragStartY;
        updateCropTransform();
    });

    window.addEventListener("mouseup", () => {
        cropDragging = false;
    });

    viewport.addEventListener("wheel", (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        cropState.scale = Math.max(0.5, Math.min(4, cropState.scale + delta));
        updateCropTransform();
    }, { passive: false });
}

document.addEventListener("DOMContentLoaded", setupCropGestures);

async function confirmCrop() {
    const img = document.getElementById("crop-image");
    const viewport = document.getElementById("crop-viewport");
    const outputSize = 600;

    const viewportRect = viewport.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();

    const scaleFactorX = img.naturalWidth / imgRect.width;
    const scaleFactorY = img.naturalHeight / imgRect.height;

    const sx = (viewportRect.left - imgRect.left) * scaleFactorX;
    const sy = (viewportRect.top - imgRect.top) * scaleFactorY;
    const sWidth = viewportRect.width * scaleFactorX;
    const sHeight = viewportRect.height * scaleFactorY;

    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, outputSize, outputSize);

    canvas.toBlob(async (blob) => {
        await uploadCroppedPhoto(blob);
    }, "image/jpeg", 0.9);
}

async function uploadCroppedPhoto(blob) {
    const statusEl = document.getElementById("profile-save-status");
    if (statusEl) statusEl.textContent = "Uploading photo...";

    const formData = new FormData();
    formData.append("photo", blob, "profile.jpg");
    if (originalPhotoFile) {
        formData.append("original_photo", originalPhotoFile, originalPhotoFile.name || "original.jpg");
    }

    try {
        const token = getAuthToken();
        const response = await fetch(`${API_URL}/api/auth/profile/photo`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` },
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            if (statusEl) statusEl.textContent = data.error || "Could not upload photo.";
            return;
        }

        const photoImg = document.getElementById("profile-photo-img");
        const placeholder = document.getElementById("profile-photo-placeholder");
        photoImg.src = data.profile_photo_url;
        photoImg.classList.remove("hidden");
        placeholder.classList.add("hidden");

        closeCropModal();
        if (statusEl) statusEl.textContent = "Photo updated!";

    } catch (error) {
        console.error("Upload photo error:", error);
        if (statusEl) statusEl.textContent = "Something went wrong while uploading.";
    }
}

async function removeProfilePhotoAction() {
    if (!confirm("Remove your profile photo?")) return;

    try {
        const token = getAuthToken();
        await fetch(`${API_URL}/api/auth/profile/photo`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });

        document.getElementById("profile-photo-img").classList.add("hidden");
        document.getElementById("profile-photo-placeholder").classList.remove("hidden");

    } catch (error) {
        console.error("Remove photo error:", error);
    }
}
