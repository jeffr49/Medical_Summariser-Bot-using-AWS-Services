const ENDPOINT_UPLOAD = "https://6ubjdo1kbd.execute-api.ap-southeast-2.amazonaws.com/dev/upload";
const ENDPOINT_JOBID = "https://r5goxolgt8.execute-api.ap-southeast-2.amazonaws.com/prod/job";
const ENDPOINT_SUMMARY = "https://mai2yr3hmd.execute-api.ap-southeast-2.amazonaws.com/dev/get-summary";
const ENDPOINT_QA = "https://lxssie8nzc.execute-api.ap-southeast-2.amazonaws.com/prod/ask";
const API_BASE_URL = 'http://localhost:3000/api';

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

// DOM Elements
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

// Event Listeners
fileInput.addEventListener("change", e => {
    selectedFile = e.target.files[0];
    uploadBtn.disabled = !selectedFile;
    status("✅ Selected: " + selectedFile.name);
});

uploadBtn.addEventListener("click", () => selectedFile && startFlow(selectedFile));
sendBtn.addEventListener("click", sendQuestion);
chatInput.addEventListener("keypress", e => { if (e.key === "Enter") sendQuestion(); });
languageSelect.addEventListener("change", handleLanguageChange);
micBtn.addEventListener("click", toggleRecording);

function status(msg) { statusDiv.textContent = msg; }
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
            
            const response = await fetch(`${API_BASE_URL}/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
        const response = await fetch(`${API_BASE_URL}/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

// WebSocket connection for real-time transcription
function connectWebSocket() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${window.location.host}/stt`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected for transcription');
        // Inform server which language we want for this session
        try {
            ws.send(JSON.stringify({ type: 'lang', language: currentLanguage }));
        } catch (e) { console.warn('Failed to send lang on WS open', e); }
        micBtn.disabled = false;
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'session') {
                activeSessionId = data.sessionId;
                console.log('Session ID:', activeSessionId);
            } else if (data.type === 'transcript') {
                // Update chat input with transcribed text
                chatInput.value = data.text;
                console.log('Transcribed:', data.text);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        micBtn.disabled = true;
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        micBtn.disabled = true;
        // Attempt reconnect after delay
        setTimeout(connectWebSocket, 3000);
    };
}

// Initialize WebSocket connection when page loads
window.addEventListener('load', connectWebSocket);

async function toggleRecording() {
    if (!isRecording) {
        // Start recording
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
                // Log capture details for debugging
                try {
                    const tracks = stream.getAudioTracks();
                    console.log('[client][audio] got stream, tracks=', tracks.map(t=>({id:t.id, label:t.label, enabled:t.enabled}))); 
                    const settings = tracks[0] && tracks[0].getSettings ? tracks[0].getSettings() : null;
                    console.log('[client][audio] track settings:', settings, 'audioContext.sampleRate(not yet created)');
                } catch (e) { console.warn('Failed to log track settings', e); }
            
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ 
                sampleRate: 16000 
            });
            mediaStream = stream;
            
            sourceNode = audioContext.createMediaStreamSource(stream);

            // Create script processor for audio processing
            processorNode = audioContext.createScriptProcessor(4096, 1, 1);

            sourceNode.connect(processorNode);
            processorNode.connect(audioContext.destination);

            // per-session counters for debugging
            let sendChunkCount = 0;

            processorNode.onaudioprocess = (e) => {
                if (!isRecording || !ws || ws.readyState !== WebSocket.OPEN) return;

                const inputData = e.inputBuffer.getChannelData(0);
                // Downsample to 16k if needed and convert to Int16Array
                const pcmData = downsampleAndConvertTo16BitPCM(inputData, audioContext.sampleRate || 48000, 16000);

                // Log chunk sizes and sample rates
                try {
                    sendChunkCount++;
                    const floatLen = inputData.length;
                    let pcmLen = 0;
                    let bytes = 0;
                    if (pcmData instanceof Int16Array) {
                        pcmLen = pcmData.length;
                        bytes = pcmData.byteLength;
                    } else if (pcmData && pcmData.byteLength) {
                        bytes = pcmData.byteLength;
                        pcmLen = bytes / Int16Array.BYTES_PER_ELEMENT;
                    }
                    console.log(`[client][audio] chunk#${sendChunkCount} float=${floatLen} pcm=${pcmLen} bytes=${bytes} audioContext.sampleRate=${audioContext.sampleRate}`);
                } catch (e) { console.warn('Failed to log audio chunk info', e); }

                // Send binary audio data via WebSocket (send underlying buffer)
                try {
                    // Convert Int16Array to ArrayBuffer for WS
                    ws.send(pcmData.buffer);
                } catch (e) {
                    console.error('Failed to send audio chunk over WS, falling back to POST', e);
                    // fallback: send base64 via POST
                    try {
                        const base64 = arrayBufferToBase64(pcmData.buffer);
                        fetch(`${API_BASE_URL}/stt/audio/${activeSessionId}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ audio: base64 })
                        }).catch(err => console.error('fallback POST failed', err));
                    } catch (e2) { console.error('fallback base64 conversion failed', e2); }
                }
            };
            
            isRecording = true;
            micBtn.classList.add('recording');
            micBtn.textContent = '⏹️ Stop Recording';
            chatInput.placeholder = "Speak now...";
            
            // Auto-stop after 30 seconds
            setTimeout(() => {
                if (isRecording) toggleRecording();
            }, 30000);
            
        } catch (error) {
            console.error('Error starting recording:', error);
            status('Microphone access denied');
        }
    } else {
        // Stop recording
        isRecording = false;
        micBtn.classList.remove('recording');
        micBtn.textContent = '🎤 Start Recording';
        chatInput.placeholder = "Ask something...";
        
        // Clean up audio resources
        if (processorNode) {
            processorNode.disconnect();
            processorNode = null;
        }
        if (sourceNode) {
            sourceNode.disconnect();
            sourceNode = null;
        }
        if (audioContext) {
            audioContext.close().catch(console.error);
            audioContext = null;
        }
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
        
        // Send stop signal to server
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'stop' }));
        }
    }
}

// Convert Float32 to 16-bit PCM
function floatTo16BitPCM(input) {
    const l = input.length;
    const result = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        let s = Math.max(-1, Math.min(1, input[i]));
        result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return result;
}

// Downsample Float32Array buffer from fromSampleRate to toSampleRate and return Int16Array
function downsampleAndConvertTo16BitPCM(buffer, fromSampleRate, toSampleRate) {
    if (!buffer || buffer.length === 0) return new Int16Array(0);
    if (toSampleRate === fromSampleRate) return floatTo16BitPCM(buffer);

    const sampleRateRatio = fromSampleRate / toSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Int16Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        const v = count ? accum / count : 0;
        let s = Math.max(-1, Math.min(1, v));
        result[offsetResult] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }

    return result;
}

// Rest of your existing functions remain the same...
async function startFlow(file) {
    try {
        status("Connecting to secure upload...");
        const presResp = await fetch(ENDPOINT_UPLOAD, { method: "POST" });
        const data = await presResp.json();
        const b = data.body ? (typeof data.body === "string" ? JSON.parse(data.body) : data.body) : data;

        const uploadUrl = b.upload_url;
        const objectKey = b.object_key;
        if (!uploadUrl || !objectKey) throw new Error("Upload URL or object key missing");

        progressWrap.classList.remove("hidden");
        status("📤 Uploading...");
        await uploadToS3(uploadUrl, file);
        progressWrap.classList.add("hidden");
        status("⏳ Extracting & analyzing...");

        globalJobId = await poll(ENDPOINT_JOBID + "?object_key=" + encodeURIComponent(objectKey), "job_id", 15);

        status("📄 Fetching summary...");
        const summaryUrl = await poll(ENDPOINT_SUMMARY + "?job_id=" + encodeURIComponent(globalJobId), "presigned_get_url", 25);
        const summary = await (await fetch(summaryUrl)).json();

        summaryArea.classList.remove("hidden");
        renderSummary(summary);
        createPdfFromSummary(summary);

        alertsWrapper.classList.remove("hidden");
        if (summary.alerts && summary.alerts.length > 0)
            alertsList.innerHTML = summary.alerts.map(a => `<li>⚠️ ${a}</li>`).join("");
        else alertsList.innerHTML = "<li>No alerts</li>";

        resultsWrapper.classList.remove("hidden");
        status("✅ Summary Ready! Ask your assistant a question →");

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
            uploadProgress.value = p;
            progressText.textContent = `${p}%`;
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
    if (!globalJobId) {
        addChat("System", "Upload a report first");
        return;
    }
    addChat("You", q);
    chatInput.value = "";
    addChat("Assistant", "⏳ Thinking...");

    try {
        let questionToAsk = q;
        if (currentLanguage !== 'en') {
            const translationResponse = await fetch(`${API_BASE_URL}/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: q,
                    targetLanguage: 'en'
                })
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
            const translationResponse = await fetch(`${API_BASE_URL}/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: answer,
                    targetLanguage: currentLanguage
                })
            });
            const translationData = await translationResponse.json();
            answer = translationData.translatedText;
        }

        replaceLastBotMessage(answer);
        if (ttsToggle.checked) {
            await speakText(answer);
        }
    } catch (e) {
        replaceLastBotMessage("⚠️ Failed to process answer.");
    }
}

function addChat(sender, msg) {
    const div = document.createElement("div");
    div.className = sender === "You" ? "msg user" : "msg bot";
    div.innerHTML = `<strong>${sender}:</strong> ${msg}`;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

function replaceLastBotMessage(newText) {
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
            if (Array.isArray(v)) {
                return `<li><strong>${label}:</strong> ${v.join(', ')}</li>`;
            }
            return `<li><strong>${label}:</strong> ${v}</li>`;
        }).join("");

    function listSection(title, items) {
        if (!items || !items.length) return "";
        return `
            <div class="summary-section translate">
                <h4>${title}</h4>
                <ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>
            </div>
        `;
    }

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
    downloadLink.href = pdfUrl;
    downloadLink.download = "Medical_Summary.pdf";
    downloadLink.textContent = "⬇ Download PDF";
}
