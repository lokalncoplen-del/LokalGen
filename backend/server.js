const express = require('express');
const cors = require('cors');
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads/audio');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

console.log('📁 Upload directory:', uploadsDir);

// ==========================================
// TEXT-TO-SPEECH GENERATION ENDPOINT
// ==========================================
app.post('/api/generate-tts', async (req, res) => {
    try {
        const { text, voiceType = 'alloy' } = req.body;

        // Validate input
        if (!text || text.trim().length === 0) {
            return res.status(400).json({ 
                success: false,
                error: 'Text is required' 
            });
        }

        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ 
                success: false,
                error: 'OpenAI API key not configured' 
            });
        }

        console.log(`🎙️  Converting ${text.length} characters to speech with voice: ${voiceType}`);

        // Convert text to speech
        const audioBuffer = await generateTTS(text, voiceType);

        // Save audio file
        const audioFileName = `story_${Date.now()}.mp3`;
        const audioFilePath = path.join(uploadsDir, audioFileName);
        
        fs.writeFileSync(audioFilePath, audioBuffer);
        console.log(`✅ Audio saved: ${audioFileName}`);

        // Build audio URL
        const audioUrl = `${process.env.API_URL || 'http://localhost:5000'}/uploads/audio/${audioFileName}`;

        res.json({
            success: true,
            audioUrl,
            fileName: audioFileName,
            duration: Math.ceil(text.length / 150), // Rough estimate: ~150 chars per minute
            voiceUsed: voiceType
        });

    } catch (error) {
        console.error('❌ TTS Error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Failed to generate audio',
            details: error.message 
        });
    }
});

// ==========================================
// STORY + TTS GENERATION ENDPOINT (Combined)
// ==========================================
app.post('/api/generate-story-with-audio', async (req, res) => {
    try {
        const {
            title,
            season,
            episode,
            characters,
            theme,
            storyTypes,
            supernatural,
            wordCount,
            details,
            voiceType = 'alloy'
        } = req.body;

        // Validate input
        if (!title || !season || !episode || !characters) {
            return res.status(400).json({ 
                success: false,
                error: 'Missing required fields' 
            });
        }

        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ 
                success: false,
                error: 'OpenAI API key not configured' 
            });
        }

        console.log('📝 Generating story...');
        
        // Build prompt
        const prompt = buildStoryPrompt({
            title,
            season,
            episode,
            characters,
            theme,
            storyTypes,
            supernatural,
            wordCount,
            details
        });

        // Generate story with AI
        const storyResult = await generateStoryWithAI(prompt);

        console.log('🎙️  Converting story to audio...');
        
        // Convert story to audio
        const audioBuffer = await generateTTS(storyResult.content, voiceType);

        // Save audio file
        const audioFileName = `story_s${season}e${episode}_${Date.now()}.mp3`;
        const audioFilePath = path.join(uploadsDir, audioFileName);
        
        fs.writeFileSync(audioFilePath, audioBuffer);
        console.log(`✅ Audio saved: ${audioFileName}`);

        // Build audio URL
        const audioUrl = `${process.env.API_URL || 'http://localhost:5000'}/uploads/audio/${audioFileName}`;

        res.json({
            success: true,
            story: {
                title,
                season,
                episode,
                content: storyResult.content,
                audioUrl,
                audioFileName,
                voiceUsed: voiceType,
                metadata: {
                    model: storyResult.model,
                    provider: 'OpenAI',
                    textLength: storyResult.content.length,
                    estimatedDuration: Math.ceil(storyResult.content.length / 150)
                }
            }
        });

    } catch (error) {
        console.error('❌ Story Generation Error:', error.message);
        res.status(500).json({ 
            success: false,
            error: 'Failed to generate story',
            details: error.message 
        });
    }
});

// ==========================================
// TEXT-TO-SPEECH FUNCTION
// ==========================================
async function generateTTS(text, voiceType = 'alloy') {
    try {
        // OpenAI TTS voices: alloy, echo, fable, onyx, nova, shimmer
        const validVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
        const voice = validVoices.includes(voiceType) ? voiceType : 'alloy';

        const response = await axios.post(
            'https://api.openai.com/v1/audio/speech',
            {
                model: 'tts-1',
                input: text,
                voice: voice,
                speed: 1.0
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer',
                timeout: 30000
            }
        );

        console.log(`✅ TTS completed (${response.data.length} bytes)`);
        return response.data;

    } catch (error) {
        console.error('❌ OpenAI TTS Error:', error.response?.data || error.message);
        throw new Error(`TTS Generation Failed: ${error.message}`);
    }
}

// ==========================================
// STORY GENERATION FUNCTION
// ==========================================
async function generateStoryWithAI(prompt) {
    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: `You are an expert storyteller specializing in historical fiction set in Papua New Guinea. 
                        Create emotionally engaging, authentic stories based on the 1994 Rabaul eruption. 
                        All characters are fictional but grounded in real historical context. 
                        Include subtle supernatural elements that feel culturally authentic.
                        Format the story with clear paragraphs separated by blank lines for better readability.`
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 3000,
                temperature: 0.8,
                timeout: 60000
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );

        console.log(`✅ Story generated (${response.data.usage.total_tokens} tokens)`);

        return {
            content: response.data.choices[0].message.content,
            model: response.data.model,
            tokens: response.data.usage.total_tokens
        };

    } catch (error) {
        console.error('❌ OpenAI Story Error:', error.response?.data || error.message);
        throw new Error(`Story Generation Failed: ${error.message}`);
    }
}

// ==========================================
// BUILD STORY PROMPT
// ==========================================
function buildStoryPrompt({
    title,
    season,
    episode,
    characters,
    theme,
    storyTypes,
    supernatural,
    wordCount,
    details
}) {
    return `
Generate a story for the "Ashes & Spirits" series with these parameters:

**Title:** ${title}
**Season ${season}, Episode ${episode}**
**Characters:** ${characters}
**Theme:** ${theme}
**Story Types:** ${storyTypes.join(', ')}
**Supernatural Elements:** ${supernatural}
**Word Count:** ${wordCount}

**Context:**
- Setting: Rabaul, Papua New Guinea, during/after the September 19, 1994 eruption
- Genre: Historical Fiction with Supernatural Elements
- All characters are fictional but grounded in the real event
- Incorporate the supernatural element strength as specified
- Format with clear paragraph breaks for better text-to-speech pacing

${details ? `**Plot Points:** ${details}` : ''}

Write a compelling, emotionally resonant story that:
1. Stands alone as a complete narrative
2. Fits the seasonal theme and episode arc
3. Includes authentic cultural and spiritual elements
4. Develops character relationships meaningfully
5. Has natural dialogue and internal reflection
6. Creates emotional impact through authentic human experiences during crisis
7. Uses clear, natural language suitable for audio narration

Generate the story now:
    `;
}

// ==========================================
// GET AVAILABLE VOICES
// ==========================================
app.get('/api/voices', (req, res) => {
    const voices = [
        { 
            id: 'alloy', 
            name: 'Alloy', 
            gender: 'neutral', 
            description: 'Clear, balanced tone - versatile for storytelling',
            accent: 'American'
        },
        { 
            id: 'echo', 
            name: 'Echo', 
            gender: 'male', 
            description: 'Deep, resonant voice - powerful narrator',
            accent: 'American'
        },
        { 
            id: 'fable', 
            name: 'Fable', 
            gender: 'male', 
            description: 'Warm, storytelling voice - perfect for narratives',
            accent: 'British'
        },
        { 
            id: 'onyx', 
            name: 'Onyx', 
            gender: 'male', 
            description: 'Deep, professional voice - authoritative',
            accent: 'American'
        },
        { 
            id: 'nova', 
            name: 'Nova', 
            gender: 'female', 
            description: 'Bright, energetic voice - engaging',
            accent: 'American'
        },
        { 
            id: 'shimmer', 
            name: 'Shimmer', 
            gender: 'female', 
            description: 'Warm, friendly voice - approachable',
            accent: 'American'
        }
    ];
    res.json({ success: true, voices });
});

// ==========================================
// SERVE AUDIO FILES
// ==========================================
app.use('/uploads/audio', express.static(uploadsDir));

// ==========================================
// HEALTH CHECK
// ==========================================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        features: {
            storyGeneration: !!process.env.OPENAI_API_KEY,
            textToSpeech: !!process.env.OPENAI_API_KEY
        }
    });
});

// ==========================================
// 404 HANDLER
// ==========================================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found',
        path: req.path,
        availableRoutes: [
            'POST /api/generate-tts',
            'POST /api/generate-story-with-audio',
            'GET /api/voices',
            'GET /health'
        ]
    });
});

// ==========================================
// ERROR HANDLER
// ==========================================
app.use((err, req, res, next) => {
    console.error('❌ Server Error:', err);
    res.status(500).json({
        success: false,
        error: err.message || 'Internal server error'
    });
});

// ==========================================
// START SERVER
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════╗
║  🚀 LokalGen Backend - Running                ║
╠════════════════════════════════════════════════╣
║  Port: ${PORT}
║  Environment: ${process.env.NODE_ENV || 'development'}
║  📝 Story Generation: ${process.env.OPENAI_API_KEY ? '✓ Enabled' : '✗ Disabled'}
║  🎙️  Text-to-Speech: ${process.env.OPENAI_API_KEY ? '✓ Enabled' : '✗ Disabled'}
║  📁 Upload Dir: ${uploadsDir}
╚════════════════════════════════════════════════╝
    `);
});

module.exports = app;
