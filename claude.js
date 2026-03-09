const axios = require('axios');
const config = require('./config');

async function getClaudeResponse(userMessage, lang) {
  const isAr = lang === 'ar';
  const c = config.clinic;

  const systemPrompt = isAr
    ? `أنت مساعد ذكي لـ${c.name_ar} في ${c.location_ar}.
أجب على أسئلة المرضى باللغة العربية بشكل مهني ومختصر.
أوقات العمل: ${c.hours_ar}
الخدمات: كشف عام (15 د.ب)، حشو تسوس (20 د.ب)، علاج عصب (95 د.ب)، خلع ضرس العقل (80 د.ب)
الأطباء: د. علي جواد، د. زينة الفاضل، د. مريم الخباز، د. حسن جابر
إذا احتاج المريض لمساعدة إضافية، اطلب منه التواصل على ${c.phone}
لا تتجاوز 100 كلمة في ردك.`
    : `You are a helpful assistant for ${c.name_en} in ${c.location_en}.
Answer patient questions professionally and concisely in English.
Hours: ${c.hours_en}
Services: General Consultation (15 BD), Cavity Filling (20 BD), Root Canal (95 BD), Wisdom Tooth Removal (80 BD)
Doctors: Dr. Ali Jawad, Dr. Zaina Alfadhel, Dr. Maryam Alkhabaz, Dr. Hasan Jaber
If the patient needs further help, direct them to call ${c.phone}
Keep responses under 100 words.`;

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

module.exports = { getClaudeResponse };
