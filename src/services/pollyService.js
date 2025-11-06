const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
require('dotenv').config();

const pollyClient = new PollyClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const languageConfig = {
    'en': { voice: 'Joanna', code: 'en-US' },     
    'hi': { voice: 'Aditi', code: 'hi-IN' }  
};

const englishVoices = {
    'Joanna': 'en-US',
    'Matthew': 'en-US',
    'Amy': 'en-GB',
    'Brian': 'en-GB',
    'Emma': 'en-GB'
};

async function textToSpeech(text, language = 'en', voiceId = null) {
    try {
        let config;
        let selectedVoice = voiceId;
        
        if (language === 'en' && voiceId && englishVoices[voiceId]) {
            selectedVoice = voiceId;
            const languageCode = englishVoices[voiceId];
            config = { voice: selectedVoice, code: languageCode };
        } else {
            config = languageConfig[language] || languageConfig['en'];
            selectedVoice = config.voice;
        }
        
        const params = {
            Text: text,
            OutputFormat: 'mp3',
            VoiceId: selectedVoice,
            LanguageCode: config.code
        };

        const command = new SynthesizeSpeechCommand(params);
        const response = await pollyClient.send(command);
        
        return new Promise((resolve, reject) => {
            const chunks = [];
            response.AudioStream.on('data', (chunk) => chunks.push(chunk));
            response.AudioStream.on('end', () => {
                const audioBuffer = Buffer.concat(chunks);
                resolve(audioBuffer.toString('base64'));
            });
            response.AudioStream.on('error', reject);
        });
    } catch (error) {
        console.error('Error in text-to-speech conversion:', error);
        throw error;
    }
}

module.exports = { textToSpeech };