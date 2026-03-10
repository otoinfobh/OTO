const axios = require('axios');
const config = require('./config');

async function getClaudeResponse(userMessage, lang) {
  const isAr = lang === 'ar';
  const c = config.clinic;

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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      },
      {
        headers: {
          'x-api-key': process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
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

async function scanCPRImage(imageId) {
  // First fetch the image URL from WhatsApp Media API
  const mediaResponse = await axios.get(
    `https://graph.facebook.com/v18.0/${imageId}`,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
  );
  const imageUrl = mediaResponse.data.url;

  // Download the image
  const imageData = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
  });
  const base64Image = Buffer.from(imageData.data).toString('base64');
  const mimeType = imageData.headers['content-type'] || 'image/jpeg';

  // Send to Claude vision
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64Image }
          },
          {
            type: 'text',
            text: 'This is a Bahrain CPR (Central Population Registry) ID card or a national ID card. Extract the following fields and return ONLY a JSON object with no extra text: { "fullName": "", "cpr": "", "dob": "", "nationality": "" }. If a field is not visible, use "-".'
          }
        ]
      }]
    },
    {
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    }
  );

  const raw = response.data.content[0].text;
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

module.exports = { getClaudeResponse, scanCPRImage };
