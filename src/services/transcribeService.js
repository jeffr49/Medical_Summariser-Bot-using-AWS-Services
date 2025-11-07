const { Readable } = require('stream');
const {
    TranscribeStreamingClient,
    StartStreamTranscriptionCommand
} = require('@aws-sdk/client-transcribe-streaming');
require('dotenv').config();

const config = {
    aws: {
        region: process.env.AWS_REGION || 'ap-southeast-2',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    },
    TRANSCRIBE_LANGUAGE_CODE: 'en-US',
    TRANSCRIBE_ENCODING: 'pcm',
    TRANSCRIBE_SAMPLE_RATE: 16000
};

class TranscribeService {
    constructor(onTranscribe, isClosed) {
        this.onTranscribe = onTranscribe;
        this.isClientClosed = isClosed;
        this.client = new TranscribeStreamingClient(config.aws);
        this.audioStream = new Readable({ 
            read() { }
        });
        this.isActive = false;
        this.chunksReceived = 0;
        this.bytesQueued = 0;
        this.lastChunkAt = null;
    }

    getInputStream() {
        return this.audioStream;
    }

    async start(language = 'en-US') {
        if (this.isClientClosed() || this.isActive) return;
        
        this.isActive = true;
        console.log('Starting transcription service...');

            const LANGUAGE_CODES = {
                'en': 'en-US',
                'hi': 'hi-IN'                
            };

            const languageCode = (language && LANGUAGE_CODES[language])
                ? LANGUAGE_CODES[language]
                : (language && typeof language === 'string' && language.includes('-') ? language : 'en-US');

            const command = new StartStreamTranscriptionCommand({
                LanguageCode: languageCode,
                MediaEncoding: config.TRANSCRIBE_ENCODING,
                MediaSampleRateHertz: config.TRANSCRIBE_SAMPLE_RATE,
                AudioStream: this._audioGenerator()
            });

        try {
            const response = await this.client.send(command);
            console.log('Transcription session started');

            for await (const event of response.TranscriptResultStream) {
                if (this.isClientClosed() || !this.isActive) break;

                try {
                    const raw = JSON.stringify(event, (k, v) => {
                        if (k === 'AudioChunk') return '[AUDIO_CHUNK]';
                        return v;
                    });
                    console.log('[transcribe:event]', raw);
                } catch (e) {}

                if (event.TranscriptEvent && event.TranscriptEvent.Transcript) {
                    const results = event.TranscriptEvent.Transcript.Results || [];

                    for (const result of results) {
                        const isPartial = !!result.IsPartial;
                        const alt = (result.Alternatives && result.Alternatives[0]) || null;
                        const transcriptText = alt ? (alt.Transcript || '').trim() : '';

                        if (transcriptText) {
                            if (isPartial) {
                                console.log(`[transcribe][partial] ${transcriptText}`);
                                // Send partial transcripts for real-time display
                                try { this.onTranscribe(transcriptText, true); } catch (e) { console.error('onTranscribe handler error:', e); }
                            } else {
                                console.log(`[transcribe][final] ${transcriptText}`);
                                try { this.onTranscribe(transcriptText, false); } catch (e) { console.error('onTranscribe handler error:', e); }
                            }
                        }
                    }
                }
            }
        } catch (err) {
            const isTimeout = err.name === 'BadRequestException' && 
                            err.message.includes('15 seconds');
            
            if (isTimeout && !this.isClientClosed() && this.isActive) {
                console.log('Transcription timeout - restarting...');
                setTimeout(() => this.start(language), 100);
            } else {
                console.error('Transcribe error:', { name: err.name, message: err.message, stack: err.stack });
                this.isActive = false;
                throw err;
            }
        } finally {
            this.isActive = false;
        }
    }

    stop() {
        this.isActive = false;
        if (this.audioStream) {
            this.audioStream.push(null);
        }
    }

    async * _audioGenerator() {
        const reader = Readable.toWeb(this.audioStream).getReader();
        
        try {
            while (!this.isClientClosed() && this.isActive) {
                const { done, value } = await reader.read();
                
                if (done || !this.isActive) break;
                const audioChunk = Buffer.isBuffer(value) ? value : Buffer.from(value);

                try {
                    this.chunksReceived = (this.chunksReceived || 0) + 1;
                    const size = audioChunk.length || (audioChunk.byteLength || 0);
                    this.bytesQueued = (this.bytesQueued || 0) + size;
                    this.lastChunkAt = Date.now();
                    console.log(`[transcribe][audio] yielding chunk #${this.chunksReceived} size=${size} totalQueued=${this.bytesQueued}`);
                } catch (e) {}

                yield { 
                    AudioEvent: { 
                        AudioChunk: audioChunk 
                    } 
                };
            }
        } catch (err) {
            console.error('Audio generator error:', err);
        } finally {
            try {
                reader.releaseLock();
            } catch (e) {}
        }
    }

    pushAudioChunk(buf) {
        if (!buf) return;
        try {
            const size = buf.length || (buf.byteLength || 0);
            this.chunksReceived = (this.chunksReceived || 0) + 1;
            this.bytesQueued = (this.bytesQueued || 0) + size;
            this.lastChunkAt = Date.now();
            console.log(`[transcribe][push] chunk#${this.chunksReceived} size=${size} totalQueued=${this.bytesQueued}`);
        } catch (e) {}

        try { this.audioStream.push(buf); } catch (e) { console.error('Failed to push audio chunk into stream:', e); }
    }
}

module.exports = TranscribeService;