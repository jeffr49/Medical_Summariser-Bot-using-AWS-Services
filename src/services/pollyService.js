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

async function textToSpeech(text, language = 'en') {
    try {
        const config = languageConfig[language] || languageConfig['en'];
        const params = {
            Text: text,
            OutputFormat: 'mp3',
            VoiceId: config.voice,
            LanguageCode: config.code
        };

        const command = new SynthesizeSpeechCommand(params);
        const response = await pollyClient.send(command);
        
        // Convert the audio stream to base64
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