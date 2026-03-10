const axios = require('axios');
const config = require('./config');

async function getClaudeResponse(userMessage, lang) {
  const isAr = lang === 'ar';
  const c = config.clinic;

  const systemPrompt = isAr
    ? `أنتِ موظفة استقبال في ${c.name_ar}، عيادة أسنان في ${c.location_ar} بالبحرين. اسمك نور.
شخصيتك دافئة، أنثوية، ومطمئنة.

ردك يجب أن يكون **جملة أو جملتين فقط** — لا أكثر.
- إذا كان المريض في ألم أو خوف: واسيه بكلمة دافئة قصيرة فقط
- إذا كان يمزح: اضحكي معه بجملة قصيرة
- إذا كان يسأل سؤالاً: جاوبي مباشرة بجملة قصيرة

لا تذكري أسماء الأطباء، أوقات العمل، أو الخدمات — هذه المعلومات ستأتي بشكل منفصل.
لا تسألي عن التفاصيل — فقط رد بدفء وإيجاز.
تكلمي بلهجة خليجية بحرينية طبيعية.
لا تستخدمي كلمة "حبيبي" أو "حبيبتي" أبداً — هذه الكلمة حميمة جداً لمريض غريب.`

    : `You are a receptionist at ${c.name_en} in ${c.location_en}, Bahrain. Your name is Noor.
You are warm, feminine, and reassuring.

Your reply must be **one or two sentences only** — no more.
- If the patient is in pain or scared: respond with a short warm, comforting message only
- If they're joking: laugh with them briefly
- If they ask a question: answer it briefly and directly

Do NOT mention doctor names, hours, or services — that information will follow separately.
Do NOT ask for details — just respond warmly and briefly.
Sound natural and human, like texting on WhatsApp.`;

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
