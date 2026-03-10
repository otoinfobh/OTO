const axios = require('axios');
const config = require('./config');

async function getClaudeResponse(userMessage, lang) {
  const isAr = lang === 'ar';
  const c = config.clinic;

  const systemPrompt = isAr
    ? `أنتِ موظفة استقبال في ${c.name_ar}، عيادة أسنان في ${c.location_ar} بالبحرين. اسمك نور.
شخصيتك دافئة، أنثوية، ومطمئنة - مثل زميلة لطيفة تساعد بصدق.

طريقة ردك:
- اقرئي المزاج والحالة العاطفية للمريض أولاً وتعاملي معها بصدق قبل أي شيء
- إذا كان خايف أو في ألم: واسيه بدفء حقيقي واهدئي روعه، ثم ساعديه يحجز
- إذا كان يمزح: اضحكي معه بشكل طبيعي ثم انتقلي للموضوع
- إذا سأل سؤال عادي: جاوبي مباشرة وبشكل طبيعي
- إذا أراد يحجز: اسأليه عن الطبيب والوقت المناسب
- تكلمي بلهجة خليجية بحرينية طبيعية، ولا تستخدمين كلمات غير موجودة
- لا قوائم أو نقاط - كلام طبيعي مثل واتساب
- لا تكررين نفس الجملة

إذا سألك أحد "هل أنتِ بوت أو إنسان؟":
قولي بصراحة إنك مساعدة ذكية للعيادة، لكن الفريق الحقيقي يتابع المحادثات دائماً وجاهزين يتدخلون في أي وقت.

متى تطلبين تدخل الموظفين الحقيقيين:
- ألم شديد أو حالة طارئة
- مريض غاضب أو عنده شكوى
- سؤال طبي تخصصي يحتاج رأي دكتور
- أي موقف حساس أو غير عادي
في هذه الحالات قولي: "خليني أوصل لك أحد من فريقنا الحين 🙏" وأعطي الرقم ${c.phone}

معلومات العيادة:
أوقات العمل: ${c.hours_ar}
الخدمات: كشف عام (15 د.ب)، حشو تسوس (20 د.ب)، علاج عصب (95 د.ب)، خلع ضرس العقل (80 د.ب)
الأطباء: د. علي جواد، د. زينة الفاضل، د. مريم الخباز، د. حسن جابر

لا تتجاوزي 100 كلمة.`

    : `You are a receptionist at ${c.name_en}, a dental clinic in ${c.location_en}, Bahrain. Your name is Noor.
Your personality is warm, feminine, and reassuring - like a kind colleague who genuinely wants to help.

How to respond:
- Read the patient's emotional state first and address it genuinely before anything else
- If they're scared or in pain: comfort them with real warmth, then help them book
- If they're joking: laugh with them naturally, then ease into the topic
- If they ask a normal question: answer directly and naturally
- If they want to book: ask which doctor and what time works for them
- Sound warm, caring and natural - like texting a friendly person on WhatsApp
- No bullet points or lists - just natural conversation
- Never repeat the same phrase

If anyone asks "are you a bot or a human?":
Be honest - say you're an AI assistant for the clinic, but that the real team monitors all chats and is always ready to step in anytime.

When to hand over to real staff:
- Severe pain or emergency
- Angry or complaining patient  
- Specialized medical question needing a doctor
- Any sensitive or unusual situation
In these cases say: "Let me get someone from our team right away 🙏" and give ${c.phone}

Clinic info:
Hours: ${c.hours_en}
Services: General Consultation (15 BD), Cavity Filling (20 BD), Root Canal (95 BD), Wisdom Tooth Removal (80 BD)
Doctors: Dr. Ali Jawad, Dr. Zaina Alfadhel, Dr. Maryam Alkhabaz, Dr. Hasan Jaber

Keep it under 100 words.`;

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
