const axios  = require('axios');
const config = require('./config');

async function getClaudeResponse(userMessage, lang) {
  const isAr = lang === 'ar';
  const c    = config.clinic;

  const systemPrompt = isAr
    ? `أنتِ موظفة استقبال في ${c.name_ar}، عيادة أسنان في ${c.location_ar} بالبحرين. اسمك نور.

ردك يجب أن يكون **جملة واحدة فقط** — لا أكثر أبداً.

أمثلة على الردود الصحيحة:
- المريض يذكر ألماً محدداً (ضرس، أسنان...): "ما چوف شر، الله يشفيك 🙏"
- المريض يقول السلام عليكم ثم يذكر ألماً: "وعليكم السلام، ما چوف شر الله يشفيك 🙏"
- المريض يذكر ألماً غير محدد: "عسى ما شر، وين تحس بالألم؟"
- المريض يقول يعطيك العافية: "يعطيك العافية"
- المريض يقول تسلم: "يسلمك الله 🙏"
- المريض يقول قوة: "الله يقويك 💪"

ممنوع:
- لا تذكري أطباء أو أوقات أو خدمات
- لا تسألي عن تفاصيل إلا إذا كان الألم غير محدد
- لا تستخدمي "حبيبي" أو "حبيبتي"
- لا تكتبي أكثر من جملة واحدة
- تكلمي بلهجة بحرينية طبيعية فقط`
    : `You are a receptionist at ${c.name_en} in ${c.location_en}, Bahrain. Your name is Noor.

Your reply must be **one sentence only** — no more, ever.
- If the patient is in pain or discomfort: respond with a single short warm phrase
- If they're joking: one short light reply
- If they ask a question: answer it in one sentence

Never mention doctors, hours, or services.
Never ask for details.
Never use more than one sentence.`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-sonnet-4-20250514',
        max_tokens: 300,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }]
      },
      {
        headers: {
          'x-api-key':          process.env.CLAUDE_API_KEY,
          'anthropic-version':  '2023-06-01',
          'Content-Type':       'application/json'
        }
      }
    );
    return response.data.content[0].text;
  } catch (error) {
    console.error('Claude API error:', error.response?.data || error.message);
    return isAr
      ? `عذراً، حدث خطأ. يرجى التواصل معنا على ${config.clinic.phone}`
      : `Sorry, an error occurred. Please call us at ${config.clinic.phone}`;
  }
}

// Download a WhatsApp media file and return { base64, mimeType }
async function downloadMedia(mediaId) {
  const mediaResponse = await axios.get(
    `https://graph.facebook.com/v18.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
  );
  const url      = mediaResponse.data.url;
  const fileData = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
  });
  return {
    base64:   Buffer.from(fileData.data).toString('base64'),
    mimeType: fileData.headers['content-type'] || 'image/jpeg',
  };
}

// Build a Claude content block from a downloaded media item
function mediaToContentBlock({ base64, mimeType }) {
  const isPdf = mimeType === 'application/pdf';
  if (isPdf) {
    return {
      type:   'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 }
    };
  }
  return {
    type:   'image',
    source: { type: 'base64', media_type: mimeType, data: base64 }
  };
}

// Accepts one or two media IDs (images or PDFs), extracts CPR info from all of them
async function scanCPRMedia(mediaIds) {
  const downloads = await Promise.all(mediaIds.map(downloadMedia));
  const mediaBlocks = downloads.map(mediaToContentBlock);

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model:      'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{
        role:    'user',
        content: [
          ...mediaBlocks,
          {
            type: 'text',
            text: 'These are images or a PDF of a Bahrain CPR (Central Population Registry) national ID card — possibly showing the front and/or back. Extract the following fields and return ONLY a valid JSON object with no extra text or markdown: { "fullName": "", "cpr": "", "dob": "", "nationality": "" }. Use the English name if available. If a field is not visible, use "-".'
          }
        ]
      }]
    },
    {
      headers: {
        'x-api-key':          process.env.CLAUDE_API_KEY,
        'anthropic-version':  '2023-06-01',
        'Content-Type':       'application/json'
      }
    }
  );

  const raw   = response.data.content[0].text;
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

module.exports = { getClaudeResponse, scanCPRMedia };
