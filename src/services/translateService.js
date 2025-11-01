const { TranslateClient, TranslateTextCommand } = require('@aws-sdk/client-translate');
require('dotenv').config();

const translateClient = new TranslateClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

async function translateText(text, targetLanguage) {
    try {
        const params = {
            Text: text,
            SourceLanguageCode: 'auto',
            TargetLanguageCode: targetLanguage
        };

        const command = new TranslateTextCommand(params);
        const response = await translateClient.send(command);
        
        return response.TranslatedText;
    } catch (error) {
        console.error('Error in translation:', error);
        throw error;
    }
}

module.exports = { translateText };