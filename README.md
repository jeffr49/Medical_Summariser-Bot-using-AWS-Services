# AI Medical Assistant

A multilingual medical report summarization and analysis tool with speech capabilities powered by AWS services.

Live Demo: [AI Medical Assistant (Elastic Beanstalk)](http://medical-summarizer-env.eba-pshbbimf.ap-southeast-2.elasticbeanstalk.com/)
To test , use credentials:
Username: jeffrey@gmail.com
Password: Myawsproject@123

To view the Architecture Diagram and Process Flow of the project : [Arch Diagram](https://app.eraser.io/workspace/XUT1Os3oGT6MKLp4WLIL?origin=share)

## Features

- **Document Processing**
  - Upload medical reports (PDF, PNG, JPG)
  - Automatic summarization
  - Critical alerts identification
  - PDF summary generation

- **Patient Portal & Authentication**
  - Secure login with email and password
  - Mandatory first-login password change flow
  - Session-based access controls

- **AI Symptom Analysis**
  - Symptom intake via text or voice
  - AI-powered triage-style guidance and next-step suggestions

- **Personalized Health Insights**
  - Tailored explanations alongside document summaries
  - Context-aware recommendations

- **Multilingual Support**
  - English
  - Hindi
  - Tamil
  - Telugu
  - Malayalam
  - Automatic translation of UI and responses

- **Speech Capabilities**
  - Text-to-Speech using AWS Polly
  - Speech-to-Text using AWS Transcribe
  - Language-specific voice support

- **Interactive Chat**
  - Context-aware medical assistant
  - Multilingual responses
  - Voice input/output options
  - Available 24/7 virtual assistance

## Prerequisites

- Node.js (v14 or higher)
- AWS Account with access to:
  - AWS Polly
  - AWS Transcribe
  - AWS Translate

## Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd medical-summarizer_02
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with your AWS credentials:
   ```
   AWS_ACCESS_KEY_ID=your_access_key_here
   AWS_SECRET_ACCESS_KEY=your_secret_key_here
   AWS_REGION=your_region_here
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000` in your browser

## Usage

1. **Language Selection**
   - Choose your preferred language from the dropdown menu
   - UI and responses will automatically update to the selected language

2. **Document Upload**
   - Click "Select Medical Report" to choose a file
   - Click "Upload & Summarize" to process the document
   - View the generated summary and alerts

3. **Chat Interface**
   - Type questions or use voice input (microphone button)
   - Toggle text-to-speech for responses
   - Download summaries as PDF

## Technical Stack

- **Frontend**
  - HTML5, CSS3, JavaScript
  - Responsive design
  - WebSpeech API integration

- **Backend**
  - Node.js
  - Express.js
  - AWS SDK v3

- **AWS Services**
  - AWS Polly (Text-to-Speech)
  - AWS Transcribe (Speech-to-Text)
  - AWS Translate (Language Translation)

## Environment Variables

- `AWS_ACCESS_KEY_ID` - Your AWS access key
- `AWS_SECRET_ACCESS_KEY` - Your AWS secret access key
- `AWS_REGION` - AWS region (e.g., us-east-1)
- `PORT` - Server port (default: 3000)

## Deployment (AWS Elastic Beanstalk)

This project can be deployed to AWS Elastic Beanstalk using the Node.js platform.

1. Prepare the build artifact:
   - Ensure all dependencies are listed in `package.json`
   - Include a start script (e.g., `"start": "node server.js"` or the appropriate entry point)
   - Zip the application source (excluding `node_modules` if EB will run `npm install`)

2. Create an Elastic Beanstalk environment:
   - Platform: Node.js (matching your runtime)
   - Application and environment names as desired
   - Upload and deploy the zip artifact

3. Configure environment variables in EB:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_REGION`
   - `PORT` (typically 8080 on EB Node.js, or configure your app to use `process.env.PORT`)

4. Health checks and scaling:
   - Ensure the application listens on `process.env.PORT`
   - Configure health check path (e.g., `/health` if available)

5. Access the public URL:
   - After a successful deploy, EB provides an endpoint like:
     `http://medical-summarizer-env.eba-pshbbimf.ap-southeast-2.elasticbeanstalk.com/`

Public Deployment: [AI Medical Assistant on Elastic Beanstalk](http://medical-summarizer-env.eba-pshbbimf.ap-southeast-2.elasticbeanstalk.com/)

## Limitations

- Speech recording limited to 30 seconds
- Supported file types: PDF, PNG, JPG
- Some Indian languages use English voice with Indian accent due to AWS Polly limitations

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details
