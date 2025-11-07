require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { textToSpeech } = require('./services/pollyService');
const { translateText } = require('./services/translateService');
const TranscribeService = require('./services/transcribeService');
const { signUp, confirmSignUp, signIn, respondToNewPasswordChallenge, getUser, signOut, verifyToken } = require('./services/cognitoService');

const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
    res.redirect('/login.html');
});

app.use(express.static('public'));

const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Access token required' });
        }

        const verification = await verifyToken(token);
        if (!verification.valid) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }

        req.user = verification.user;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Authentication failed' });
    }
};

const activeSessions = new Map();

// Authentication Routes

app.post('/api/auth/signup', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const attributes = {};
        if (name) {
            attributes['name'] = name;
        }

        const result = await signUp(email, password, attributes);
        
        if (result.success) {
            res.json({
                message: 'User registered successfully. Please check your email for verification code.',
                userSub: result.userSub
            });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/confirm', async (req, res) => {
    try {
        const { email, code } = req.body;
        
        if (!email || !code) {
            return res.status(400).json({ error: 'Email and verification code are required' });
        }

        const result = await confirmSignUp(email, code);
        
        if (result.success) {
            res.json({ message: 'Email verified successfully' });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const result = await signIn(email, password);
        
        if (result.success) {
            res.json({
                accessToken: result.accessToken,
                idToken: result.idToken,
                refreshToken: result.refreshToken,
                expiresIn: result.expiresIn
            });
        } else if (result.requiresNewPassword) {
            res.status(200).json({
                requiresNewPassword: true,
                session: result.session,
                challengeParameters: result.challengeParameters,
                message: 'NEW_PASSWORD_REQUIRED'
            });
        } else {
            res.status(401).json({ error: result.error });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/change-password', async (req, res) => {
    try {
        const { email, session, newPassword } = req.body;
        
        if (!email || !session || !newPassword) {
            return res.status(400).json({ error: 'Email, session, and new password are required' });
        }

        const result = await respondToNewPasswordChallenge(session, email, newPassword);
        
        if (result.success) {
            res.json({
                accessToken: result.accessToken,
                idToken: result.idToken,
                refreshToken: result.refreshToken,
                expiresIn: result.expiresIn
            });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        res.json({
            username: req.user.username,
            attributes: req.user.attributes
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/logout', authenticateToken, async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        
        const result = await signOut(token);
        
        if (result.success) {
            res.json({ message: 'Logged out successfully' });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Protected API Routes

app.post('/api/tts', authenticateToken, async (req, res) => {
    try {
        const { text, language, voice } = req.body;
        const audioContent = await textToSpeech(text, language, voice);
        res.json({ audio: audioContent });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/translate', authenticateToken, async (req, res) => {
    try {
        const { text, targetLanguage } = req.body;
        const translatedText = await translateText(text, targetLanguage);
        res.json({ translatedText });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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

    transcribeService = new TranscribeService(
        (transcript, isPartial) => {
            if (clientClosed || !transcript) return;
            
            console.log(`[${sessionId}] Transcript: ${transcript} (${isPartial ? 'partial' : 'final'})`);
            
            try {
                ws.send(JSON.stringify({ 
                    type: 'transcript', 
                    text: transcript,
                    isPartial: isPartial || false,
                    sessionId: sessionId
                }));
            } catch (err) {
                console.error('Error sending transcript:', err);
            }
        },
        () => clientClosed
    );

    activeSessions.set(sessionId, { ws, transcribeService });

    ws.send(JSON.stringify({ 
        type: 'session', 
        sessionId: sessionId 
    }));

    ws.on('message', async (message, isBinary) => {
        if (clientClosed) return;

        try {
            if (isBinary) {
                try {
                    const size = message.length || (message.byteLength || 0);
                    console.log(`WS ${sessionId} <<< binary ${size} bytes at ${new Date().toISOString()}`);

                    try {
                        if (transcribeService && !transcribeService.isActive) {
                            const language = transcribeService.pendingLanguage || 'en';
                            console.log(`Starting transcribeService on first audio chunk for session ${sessionId} with language=${language}`);
                            transcribeService.start(language).catch(err => console.error('Transcribe start failed:', err));
                        }
                    } catch (e) {}

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
                    console.log(`Language change requested: ${data.language}`);
                    if (transcribeService) {
                        transcribeService.pendingLanguage = data.language || 'en';
                        try { ws.send(JSON.stringify({ type: 'lang_ack', language: transcribeService.pendingLanguage })); } catch (e) {}
                    }
                } else if (data.type === 'stop') {
                    if (transcribeService) {
                        transcribeService.getInputStream().push(null);
                    }
                }
            }
        } catch (err) {
            console.error('Error handling message:', err);
        }
    });

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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});