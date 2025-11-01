const express = require('express');
const cors = require('cors');
const { textToSpeech } = require('./services/pollyService');
const { translateText } = require('./services/translateService');
const TranscribeService = require('./services/transcribeService');

const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Store active WebSocket sessions
const activeSessions = new Map();

// Text to Speech endpoint
app.post('/api/tts', async (req, res) => {
    try {
        const { text, language } = req.body;
        const audioContent = await textToSpeech(text, language);
        res.json({ audio: audioContent });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Translation endpoint
app.post('/api/translate', async (req, res) => {
    try {
        const { text, targetLanguage } = req.body;
        const translatedText = await translateText(text, targetLanguage);
        res.json({ translatedText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create HTTP server and attach WebSocket server
const server = http.createServer(app);

const wss = new WebSocket.Server({ 
    server, 
    path: '/stt',
    perMessageDeflate: false
});

wss.on('connection', (ws, req) => {
    const sessionId = uuidv4();
    console.log(`WebSocket connected: ${sessionId}`);
    
    let clientClosed = false;
    let transcribeService = null;

    // Initialize transcription service
    transcribeService = new TranscribeService(
        // onTranscribe callback
        (transcript) => {
            if (clientClosed || !transcript) return;
            
            console.log(`[${sessionId}] Transcript: ${transcript}`);
            
            // Send transcript to client
            try {
                ws.send(JSON.stringify({ 
                    type: 'transcript', 
                    text: transcript,
                    sessionId: sessionId
                }));
            } catch (err) {
                console.error('Error sending transcript:', err);
            }
        },
        // isClosed check
        () => clientClosed
    );

    // Store session
    activeSessions.set(sessionId, { ws, transcribeService });

    // Send session ID to client
    ws.send(JSON.stringify({ 
        type: 'session', 
        sessionId: sessionId 
    }));

    // Handle incoming messages
    ws.on('message', async (message, isBinary) => {
        if (clientClosed) return;

        try {
            if (isBinary) {
                // Binary audio data - push to transcribe service
                try {
                    const size = message.length || (message.byteLength || 0);
                    console.log(`WS ${sessionId} <<< binary ${size} bytes at ${new Date().toISOString()}`);

                    // If transcription hasn't started yet, start it now using pending language (if provided)
                    try {
                        if (transcribeService && !transcribeService.isActive && transcribeService.pendingLanguage) {
                            console.log(`Starting transcribeService on first audio chunk for session ${sessionId} with language=${transcribeService.pendingLanguage}`);
                            transcribeService.start(transcribeService.pendingLanguage).catch(err => console.error('Transcribe start failed:', err));
                        }
                    } catch (e) { /* ignore start errors */ }

                    if (transcribeService && typeof transcribeService.pushAudioChunk === 'function') {
                        transcribeService.pushAudioChunk(message);
                    } else if (transcribeService && transcribeService.getInputStream) {
                        transcribeService.getInputStream().push(message);
                    } else {
                        console.warn(`No transcribeService available to accept audio for session ${sessionId}`);
                    }
                } catch (e) {
                    console.error('Error pushing binary audio to transcribeService:', e);
                }
            } else {
                // Text message - could be control messages
                // Defensive parsing: sometimes message can be undefined/empty
                let data = null;
                try {
                    const text = (typeof message === 'string') ? message : (message && message.toString ? message.toString() : null);
                    if (!text) {
                        console.warn(`WS ${sessionId} <<< empty text frame (ignored)`);
                        return;
                    }
                    data = JSON.parse(text);
                } catch (e) {
                    console.warn(`WS ${sessionId} <<< invalid JSON text frame, ignoring; raw=`, message);
                    return;
                }

                if (data.type === 'lang') {
                    // Handle language change - start transcription with new language
                    console.log(`Language change requested: ${data.language}`);
                    // Store pending language and defer starting until we receive the first audio chunk
                    if (transcribeService) {
                        transcribeService.pendingLanguage = data.language || 'en';
                        // send ack
                        try { ws.send(JSON.stringify({ type: 'lang_ack', language: transcribeService.pendingLanguage })); } catch (e) {}
                    }
                } else if (data.type === 'stop') {
                    // Stop transcription
                    if (transcribeService) {
                        transcribeService.getInputStream().push(null);
                    }
                }
            }
        } catch (err) {
            console.error('Error handling message:', err);
        }
    });

    // Handle client disconnect
    ws.on('close', () => {
        console.log(`WebSocket disconnected: ${sessionId}`);
        clientClosed = true;
        
        if (transcribeService && transcribeService.getInputStream) {
            transcribeService.getInputStream().push(null);
        }
        
        activeSessions.delete(sessionId);
    });

    ws.on('error', (err) => {
        console.error(`WebSocket error [${sessionId}]:`, err);
        clientClosed = true;
        activeSessions.delete(sessionId);
    });

    // Note: transcription will be started when the client sends a { type: 'lang', language } message
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});