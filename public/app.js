let ENDPOINT_UPLOAD = '';
let ENDPOINT_JOBID = '';
let ENDPOINT_SUMMARY = '';
let ENDPOINT_QA = '';
const API_BASE_URL = window.location.origin + '/api';

let endpointsLoadedPromise = null;

async function loadApiEndpoints() {
    try {
        const response = await fetch(`${API_BASE_URL}/config`);
        const config = await response.json();
        ENDPOINT_UPLOAD = config.ENDPOINT_UPLOAD;
        ENDPOINT_JOBID = config.ENDPOINT_JOBID;
        ENDPOINT_SUMMARY = config.ENDPOINT_SUMMARY;
        ENDPOINT_QA = config.ENDPOINT_QA;
        
        if (!ENDPOINT_UPLOAD || !ENDPOINT_JOBID || !ENDPOINT_SUMMARY || !ENDPOINT_QA) {
            console.error('API endpoints not configured. Please set ENDPOINT_UPLOAD, ENDPOINT_JOBID, ENDPOINT_SUMMARY, and ENDPOINT_QA in your .env file');
        }
    } catch (error) {
        console.error('Error loading API endpoints:', error);
    }
}

endpointsLoadedPromise = loadApiEndpoints();

let selectedFile;
let globalJobId = null;
let currentLanguage = 'en';
let isRecording = false;
let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let processorNode = null;
let ws = null;
let activeSessionId = null;

const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const statusDiv = document.getElementById("status");
const progressWrap = document.getElementById("progressWrap");
const uploadProgress = document.getElementById("uploadProgress");
const progressText = document.getElementById("progressText");
const summaryArea = document.getElementById("summaryArea");
const summaryJson = document.getElementById("summaryJson");
const downloadLink = document.getElementById("downloadLink");
const resultsWrapper = document.getElementById("resultsWrapper");
const alertsWrapper = document.getElementById("alertsWrapper");
const alertsList = document.getElementById("alertsList");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const chatWindow = document.getElementById("chatWindow");
const languageSelect = document.getElementById("languageSelect");
const ttsToggle = document.getElementById("ttsToggle");
const micBtn = document.getElementById("micBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userInfo = document.getElementById("userInfo");

window.addEventListener('DOMContentLoaded', async () => {
    if (!isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    if (userInfo) {
        try {
            const userResult = await getCurrentUser();
            if (userResult.success && userResult.user) {
                const email = userResult.user.attributes.email || userResult.user.username;
                const name = userResult.user.attributes.name || email.split('@')[0];
                userInfo.textContent = name;
            }
        } catch (error) {
            console.error('Error loading user info:', error);
        }
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            logout();
        });
    }

    if (uploadBtn && fileInput) {
        uploadBtn.disabled = !(fileInput.files && fileInput.files[0]);
    }
});

if (!window.initUpload) {
    if (fileInput) {
        fileInput.addEventListener("change", e => {
            selectedFile = e.target.files[0];
            if (uploadBtn) uploadBtn.disabled = !selectedFile;
            if (selectedFile) status("✅ Selected: " + selectedFile.name);
        });

        fileInput.addEventListener("input", e => {
            selectedFile = e.target.files && e.target.files[0];
            if (uploadBtn) uploadBtn.disabled = !selectedFile;
            if (selectedFile) status("✅ Selected: " + selectedFile.name);
        });
    }

    if (uploadBtn) {
        uploadBtn.addEventListener("click", () => {
            console.log('[uploadBtn] clicked', { hasFile: !!selectedFile, name: selectedFile && selectedFile.name });
            if (!selectedFile) {
                status("Please select a file first");
                try { if (fileInput) fileInput.focus(); } catch (_) {}
                return;
            }
            startFlow(selectedFile);
        });
    }
}

if (sendBtn) sendBtn.addEventListener("click", sendQuestion);
if (chatInput) chatInput.addEventListener("keypress", e => { if (e.key === "Enter") sendQuestion(); });
if (languageSelect) languageSelect.addEventListener("change", handleLanguageChange);
if (micBtn) micBtn.addEventListener("click", toggleRecording);

function status(msg) { 
    if (statusDiv) {
        statusDiv.textContent = msg;
        statusDiv.style.display = 'flex';
    }
    console.log('[Status]', msg);
}
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function handleLanguageChange(event) {
    currentLanguage = event.target.value;
    await translateUI();
}

async function translateUI() {
    try {
        const elements = document.querySelectorAll('.translate');
        for (const element of elements) {
            const originalText = element.getAttribute('data-original-text') || element.textContent;
            element.setAttribute('data-original-text', originalText);
            const response = await authenticatedFetch(`${API_BASE_URL}/translate`, {
                method: 'POST',
                body: JSON.stringify({
                    text: originalText,
                    targetLanguage: currentLanguage
                })
            });
            const data = await response.json();
            element.textContent = data.translatedText;
        }
    } catch (error) {
        console.error('Translation error:', error);
    }
}

async function speakText(text) {
    if (!ttsToggle.checked) return;
    try {
        const response = await authenticatedFetch(`${API_BASE_URL}/tts`, {
            method: 'POST',
            body: JSON.stringify({
                text,
                language: currentLanguage
            })
        });
        const data = await response.json();
        const audio = new Audio(`data:audio/mp3;base64,${data.audio}`);
        await audio.play();
    } catch (error) {
        console.error('TTS error:', error);
    }
}

// WebSocket Lifecycle Management

async function openWebSocket() {
    return new Promise((resolve, reject) => {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${proto}://${window.location.host}/stt`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket connected');
            ws.send(JSON.stringify({ type: 'lang', language: currentLanguage }));
            resolve();
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            reject(error);
        };

        ws.onclose = () => {
            console.log('WebSocket closed');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'session') {
                    activeSessionId = data.sessionId;
                    console.log('Session ID:', activeSessionId);
                } else if (data.type === 'transcript') {
                    chatInput.value = data.text;
                }
            } catch (err) {
                console.error('Error parsing WebSocket message:', err);
            }
        };
    });
}

function closeWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log('Closing WebSocket...');
        ws.close(1000, 'Session ended');
        ws = null;
    }
}

// Recording Toggle

async function toggleRecording() {
    if (!isRecording) {
        try {
            await openWebSocket();
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true }
            });

            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            mediaStream = stream;
            sourceNode = audioContext.createMediaStreamSource(stream);
            processorNode = audioContext.createScriptProcessor(4096, 1, 1);
            sourceNode.connect(processorNode);
            processorNode.connect(audioContext.destination);

            processorNode.onaudioprocess = (e) => {
                if (!isRecording || !ws || ws.readyState !== WebSocket.OPEN) return;
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmData = downsampleAndConvertTo16BitPCM(inputData, audioContext.sampleRate || 48000, 16000);
                ws.send(pcmData.buffer);
            };

            isRecording = true;
            micBtn.classList.add('recording');
            micBtn.textContent = '⏹️ Stop Recording';
            chatInput.placeholder = "Speak now...";

        } catch (error) {
            console.error('Error starting recording:', error);
            status('🎙️ Microphone access denied or WebSocket error');
            closeWebSocket();
        }
    } else {
        isRecording = false;
        micBtn.classList.remove('recording');
        micBtn.textContent = '🎤 Start Recording';
        chatInput.placeholder = "Ask something...";

        if (processorNode) processorNode.disconnect();
        if (sourceNode) sourceNode.disconnect();
        if (audioContext) await audioContext.close().catch(() => {});
        if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'stop' }));
        }

        closeWebSocket();
    }
}

// Audio Processing

function floatTo16BitPCM(input) {
    const l = input.length;
    const result = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        let s = Math.max(-1, Math.min(1, input[i]));
        result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return result;
}

function downsampleAndConvertTo16BitPCM(buffer, fromSampleRate, toSampleRate) {
    if (!buffer || buffer.length === 0) return new Int16Array(0);
    if (toSampleRate === fromSampleRate) return floatTo16BitPCM(buffer);
    const sampleRateRatio = fromSampleRate / toSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Int16Array(newLength);
    let offsetResult = 0, offsetBuffer = 0;
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i]; count++;
        }
        const v = count ? accum / count : 0;
        let s = Math.max(-1, Math.min(1, v));
        result[offsetResult] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        offsetResult++; offsetBuffer = nextOffsetBuffer;
    }
    return result;
}

async function startFlow(file) {
    try {
        // Wait for endpoints to be loaded
        await endpointsLoadedPromise;
        
        if (!ENDPOINT_UPLOAD || !ENDPOINT_JOBID || !ENDPOINT_SUMMARY) {
            status("Error: API endpoints not configured");
            return;
        }
        
        status("Connecting to secure upload...");
        const presResp = await fetch(ENDPOINT_UPLOAD, { method: "POST" });
        const data = await presResp.json();
        const b = data.body ? (typeof data.body === "string" ? JSON.parse(data.body) : data.body) : data;
        const uploadUrl = b.upload_url;
        const objectKey = b.object_key;
        if (!uploadUrl || !objectKey) throw new Error("Upload URL or object key missing");

        if (progressWrap) progressWrap.classList.remove("hidden");
        status("📤 Uploading...");
        await uploadToS3(uploadUrl, file);
        if (progressWrap) progressWrap.classList.add("hidden");
        status("⏳ Extracting & analyzing...");

        globalJobId = await poll(ENDPOINT_JOBID + "?object_key=" + encodeURIComponent(objectKey), "job_id", 15);
        status("📄 Fetching summary...");
        const summaryUrl = await poll(ENDPOINT_SUMMARY + "?job_id=" + encodeURIComponent(globalJobId), "presigned_get_url", 50);
        const summary = await (await fetch(summaryUrl)).json();

        if (summaryArea) summaryArea.classList.remove("hidden");
        renderSummary(summary);
        createPdfFromSummary(summary);

        if (alertsWrapper) {
            alertsWrapper.classList.remove("hidden");
            if (alertsList) {
                if (summary.alerts && summary.alerts.length > 0) {
                    alertsList.innerHTML = summary.alerts.map(a => `<li>⚠️ ${a}</li>`).join("");
                } else {
                    alertsList.innerHTML = "<li>No critical alerts</li>";
                }
            }
        }

        if (resultsWrapper) resultsWrapper.classList.remove("hidden");
        status("✅ Summary Ready! Ask your assistant a question →");
        
        if (chatWindow) {
            const welcomeMsg = chatWindow.querySelector('.msg.bot');
            if (welcomeMsg) {
                welcomeMsg.innerHTML = '<strong>Assistant:</strong> I\'ve analyzed the uploaded medical report. How can I help you understand it better?';
            } else {
                addChat("Assistant", "I've analyzed the uploaded medical report. How can I help you understand it better?");
            }
        }

    } catch (e) {
        status("Error: " + e.message);
    }
}

function uploadToS3(url, file) {
    return new Promise((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.setRequestHeader("Content-Type", file.type || "application/pdf");
        xhr.upload.onprogress = e => {
            const p = Math.round((e.loaded / e.total) * 100);
            if (uploadProgress) {
                uploadProgress.value = p;
            }
            if (progressText) {
                progressText.textContent = `Uploading: ${p}%`;
            }
        };
        xhr.onload = () => xhr.status < 300 ? res() : rej(new Error("Upload failed"));
        xhr.onerror = () => rej(new Error("Network error"));
        xhr.send(file);
    });
}

async function poll(url, field, tries) {
    for (let i = 0; i < tries; i++) {
        const r = await fetch(url);
        const j = await r.json();
        if (r.ok && (j[field] || (j.body && JSON.parse(j.body)[field])))
            return j[field] || JSON.parse(j.body)[field];
        await sleep(4000);
    }
    throw new Error(`${field} timeout`);
}

async function sendQuestion() {
    const q = chatInput.value.trim();
    if (!q) return;
    
    // Wait for endpoints to be loaded
    await endpointsLoadedPromise;
    
    if (!ENDPOINT_QA) {
        replaceLastBotMessage("⚠️ API endpoint not configured");
        return;
    }
    
    const currentJobId = globalJobId || sessionStorage.getItem('globalJobId');
    if (!currentJobId) {
        addChat("System", "Please upload a document from the dashboard first");
        return;
    }
    globalJobId = currentJobId;
    addChat("You", q);
    chatInput.value = "";
    addChat("Assistant", "⏳ Thinking...");

    try {
        let questionToAsk = q;
        if (currentLanguage !== 'en') {
            const translationResponse = await authenticatedFetch(`${API_BASE_URL}/translate`, {
                method: 'POST',
                body: JSON.stringify({ text: q, targetLanguage: 'en' })
            });
            const translationData = await translationResponse.json();
            questionToAsk = translationData.translatedText;
        }

        const res = await fetch(ENDPOINT_QA, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ job_id: globalJobId, question: questionToAsk })
        });

        const js = await res.json();
        let answer = js.answer || js.result || JSON.stringify(js);

        if (currentLanguage !== 'en') {
            const translationResponse = await authenticatedFetch(`${API_BASE_URL}/translate`, {
                method: 'POST',
                body: JSON.stringify({ text: answer, targetLanguage: currentLanguage })
            });
            const translationData = await translationResponse.json();
            answer = translationData.translatedText;
        }

        replaceLastBotMessage(answer);
        if (ttsToggle.checked) await speakText(answer);
    } catch {
        replaceLastBotMessage("⚠️ Failed to process answer.");
    }
}

function addChat(sender, msg) {
    if (!chatWindow) return;
    const div = document.createElement("div");
    div.className = sender === "You" ? "msg user" : "msg bot";
    div.innerHTML = `<strong>${sender}:</strong> ${msg}`;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

function replaceLastBotMessage(newText) {
    if (!chatWindow) return;
    const msgs = chatWindow.querySelectorAll(".msg.bot");
    if (msgs.length > 0) msgs[msgs.length - 1].innerHTML = `<strong>Assistant:</strong> ${newText}`;
}

function renderSummary(summary) {
    const s = summary.summary || {};
    const p = s.patient_details || {};
    const personalFields = Object.entries(p)
        .filter(([_, v]) => v && ((Array.isArray(v) && v.length) || (typeof v === 'string' && v.trim() !== '')))
        .map(([k, v]) => {
            const label = k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            if (Array.isArray(v)) return `<li><strong>${label}:</strong> ${v.join(', ')}</li>`;
            return `<li><strong>${label}:</strong> ${v}</li>`;
        }).join("");

    function listSection(title, items) {
        if (!items || !items.length) return "";
        return `<div class="summary-section translate"><h4>${title}</h4><ul>${items.map(i => `<li>${i}</li>`).join("")}</ul></div>`;
    }

    if (summaryJson) {
        summaryJson.innerHTML = `
            <div class="summary-section translate">
                <h4>Patient Details</h4>
                <ul>${personalFields || "<li>No personal details detected</li>"}</ul>
            </div>
            ${listSection("Conditions", s.conditions)}
            ${listSection("Medications", s.medications)}
            ${listSection("Tests", s.tests)}
            ${listSection("Treatment Plan", s.treatment_plan)}
        `;
    }
}

function createPdfFromSummary(summary) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const s = summary.summary || {};
    const p = s.patient_details || {};
    let y = 10;

    doc.setFontSize(16);
    doc.text("Medical Report Summary", 10, y);
    y += 10;

    const personalEntries = Object.entries(p)
        .filter(([_, v]) => v && ((Array.isArray(v) && v.length) || (typeof v === 'string' && v.trim() !== '')));

    if (personalEntries.length > 0) {
        doc.setFontSize(12);
        doc.text("Patient Details:", 10, y);
        y += 8;
        doc.setFontSize(11);
        personalEntries.forEach(([k, v]) => {
            const label = k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            if (Array.isArray(v)) v = v.join(', ');
            doc.text(`${label}: ${v}`, 14, y);
            y += 6;
        });
        y += 6;
    }

    const sections = [
        { title: "Conditions", list: s.conditions || [] },
        { title: "Medications", list: s.medications || [] },
        { title: "Tests", list: s.tests || [] },
        { title: "Treatment Plan", list: s.treatment_plan || [] },
        { title: "Alerts", list: summary.alerts || [] }
    ];

    doc.setFontSize(11);
    sections.forEach(section => {
        if (!section.list.length) return;
        doc.setFont(undefined, "bold");
        doc.text(section.title + ":", 10, y);
        y += 6;
        doc.setFont(undefined, "normal");
        section.list.forEach(item => {
            const splitText = doc.splitTextToSize(`• ${item}`, 180);
            doc.text(splitText, 14, y);
            y += splitText.length * 6;
        });
        y += 4;
    });

    const pdfBlob = doc.output("blob");
    const pdfUrl = URL.createObjectURL(pdfBlob);
    if (downloadLink) {
        downloadLink.href = pdfUrl;
        downloadLink.download = "Medical_Summary.pdf";
        if (downloadLink.querySelector('i')) {
            downloadLink.innerHTML = '<i class="fas fa-download"></i> Download PDF Report';
        } else {
            downloadLink.textContent = "⬇ Download PDF";
        }
    }
}
