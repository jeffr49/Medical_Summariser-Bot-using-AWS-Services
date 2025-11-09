let ENDPOINT_UPLOAD = '';
let ENDPOINT_JOBID = '';

let endpointsLoadedPromise = null;

async function loadApiEndpoints() {
    try {
        const API_BASE_URL = window.location.origin + '/api';
        const response = await fetch(`${API_BASE_URL}/config`);
        const config = await response.json();
        ENDPOINT_UPLOAD = config.ENDPOINT_UPLOAD;
        ENDPOINT_JOBID = config.ENDPOINT_JOBID;
        
        if (!ENDPOINT_UPLOAD || !ENDPOINT_JOBID) {
            console.error('API endpoints not configured. Please set ENDPOINT_UPLOAD and ENDPOINT_JOBID in your .env file');
        }
    } catch (error) {
        console.error('Error loading API endpoints:', error);
    }
}

endpointsLoadedPromise = loadApiEndpoints();

let selectedFile = null;
let globalJobId = null;

function initUpload(options = {}) {
    const {
        fileInputId = 'fileInput',
        uploadBtnId = 'uploadBtn',
        fileInputTextId = 'fileInputText',
        statusId = 'status',
        progressWrapId = 'progressWrap',
        uploadProgressId = 'uploadProgress',
        progressTextId = 'progressText',
        onSuccess = null,
        onError = null,
        statusCallback = null
    } = options;

    const fileInput = document.getElementById(fileInputId);
    const uploadBtn = document.getElementById(uploadBtnId);
    const fileInputText = document.getElementById(fileInputTextId);
    const fileInputDisplay = document.querySelector('.file-input-display');
    const statusDiv = document.getElementById(statusId);
    const progressWrap = document.getElementById(progressWrapId);
    const uploadProgress = document.getElementById(uploadProgressId);
    const progressText = document.getElementById(progressTextId);

    function status(msg, type = 'info') {
        if (statusCallback) {
            statusCallback(msg, type);
            return;
        }
        
        if (!statusDiv) return;
        statusDiv.textContent = msg;
        statusDiv.className = 'status';
        statusDiv.style.display = 'flex';
        
        if (type === 'success') {
            statusDiv.style.background = '#f0fdf4';
            statusDiv.style.color = 'var(--success-color)';
            statusDiv.style.border = '1px solid #bbf7d0';
        } else if (type === 'error') {
            statusDiv.style.background = '#fef2f2';
            statusDiv.style.color = 'var(--error-color)';
            statusDiv.style.border = '1px solid #fecaca';
        } else {
            statusDiv.style.background = '#f0f9ff';
            statusDiv.style.color = 'var(--primary-color)';
            statusDiv.style.border = '1px solid #bae6fd';
        }
    }

    if (fileInput) {
        fileInput.addEventListener('change', function() {
            if (this.files && this.files[0]) {
                selectedFile = this.files[0];
                const fileName = selectedFile.name;
                if (fileInputText) fileInputText.textContent = fileName;
                if (fileInputDisplay) {
                    fileInputDisplay.style.borderColor = 'var(--success-color)';
                    fileInputDisplay.style.background = '#f0fdf4';
                }
                if (uploadBtn) uploadBtn.disabled = false;
            } else {
                selectedFile = null;
                if (fileInputText) fileInputText.textContent = 'Choose a file or drag it here';
                if (fileInputDisplay) {
                    fileInputDisplay.style.borderColor = 'var(--border-color)';
                    fileInputDisplay.style.background = '#fafafa';
                }
                if (uploadBtn) uploadBtn.disabled = true;
            }
        });

        if (fileInputDisplay) {
            fileInputDisplay.addEventListener('mouseenter', function() {
                if (!selectedFile) {
                    this.style.borderColor = 'var(--primary-color)';
                    this.style.background = '#f0f9ff';
                }
            });

            fileInputDisplay.addEventListener('mouseleave', function() {
                if (!selectedFile) {
                    this.style.borderColor = 'var(--border-color)';
                    this.style.background = '#fafafa';
                }
            });
        }
    }

    if (uploadBtn) {
        uploadBtn.addEventListener('click', async function() {
            if (!selectedFile) return;
            await startFileUploadFlow(selectedFile, {
                status,
                progressWrap,
                uploadProgress,
                progressText,
                onSuccess,
                onError,
                uploadBtn
            });
        });
    }

    if (uploadBtn && fileInput) {
        uploadBtn.disabled = !(fileInput.files && fileInput.files[0]);
    }
}

async function startFileUploadFlow(file, options = {}) {
    const {
        status,
        progressWrap,
        uploadProgress,
        progressText,
        onSuccess,
        onError,
        uploadBtn
    } = options;

    try {
        // Wait for endpoints to be loaded
        await endpointsLoadedPromise;
        
        if (!ENDPOINT_UPLOAD || !ENDPOINT_JOBID) {
            if (status) status("Error: API endpoints not configured", 'error');
            if (onError) onError(new Error("API endpoints not configured"));
            return;
        }
        
        if (uploadBtn) uploadBtn.disabled = true;
        if (status) status("Connecting to secure upload...", 'info');
        
        const presResp = await fetch(ENDPOINT_UPLOAD, { method: "POST" });
        const data = await presResp.json();
        const b = data.body ? (typeof data.body === "string" ? JSON.parse(data.body) : data.body) : data;
        const uploadUrl = b.upload_url;
        const objectKey = b.object_key;
        if (!uploadUrl || !objectKey) throw new Error("Upload URL or object key missing");

        if (progressWrap) progressWrap.style.display = 'block';
        if (status) status("📤 Uploading...", 'info');
        
        await uploadToS3(uploadUrl, file, {
            uploadProgress,
            progressText
        });
        
        if (progressWrap) progressWrap.style.display = 'none';
        if (status) status("⏳ Processing document...", 'info');

        globalJobId = await poll(ENDPOINT_JOBID + "?object_key=" + encodeURIComponent(objectKey), "job_id", 15);
        
        if (status) status("✅ Document processed successfully!", 'success');
        
        if (onSuccess) {
            onSuccess(globalJobId, objectKey);
        }
        
    } catch (e) {
        if (status) status("Error: " + e.message, 'error');
        if (onError) {
            onError(e);
        }
    } finally {
        if (uploadBtn) uploadBtn.disabled = false;
    }
}

function uploadToS3(url, file, options = {}) {
    const { uploadProgress, progressText } = options;
    
    return new Promise((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.setRequestHeader("Content-Type", file.type || "application/pdf");
        xhr.upload.onprogress = e => {
            const p = Math.round((e.loaded / e.total) * 100);
            if (uploadProgress) uploadProgress.value = p;
            if (progressText) progressText.textContent = `Uploading: ${p}%`;
        };
        xhr.onload = () => xhr.status < 300 ? res() : rej(new Error("Upload failed"));
        xhr.onerror = () => rej(new Error("Network error"));
        xhr.send(file);
    });
}

async function poll(url, key, maxAttempts) {
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
            const res = await fetch(url);
            const data = await res.json();
            const body = data.body ? (typeof data.body === "string" ? JSON.parse(data.body) : data.body) : data;
            if (body[key]) return body[key];
        } catch (e) {
            console.error('Poll error:', e);
        }
    }
    throw new Error("Timeout waiting for job ID");
}

function getGlobalJobId() {
    return globalJobId;
}

function setGlobalJobId(jobId) {
    globalJobId = jobId;
}

function getSelectedFile() {
    return selectedFile;
}

