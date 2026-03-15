const axios  = require('axios');
const config = require('./config');

// Build full clinic context for Claude
function buildSystemPrompt(lang, extraContext = '') {
  const isAr = lang === 'ar';
  const c    = config.clinic;

  const procedureList = config.procedures.map(p =>
    isAr
      ? `- ${p.name_ar}: ${p.price} د.ب، مدة ${p.duration} دقيقة`
      : `- ${p.name_en}: ${p.price} BD, duration ${p.duration} min`
  ).join('\n');

  const doctorList = config.doctors.map(d =>
    isAr ? `- ${d.name_ar}` : `- ${d.name_en}`
  ).join('\n');

  if (isAr) {
    return `أنتِ موظفة استقبال ذكية في ${c.name_ar}، عيادة أسنان في ${c.location_ar} بالبحرين. اسمك نور.
تتكلمين بلهجة بحرينية طبيعية دافئة.

معلومات العيادة:
- الموقع: ${c.location_ar}
- أوقات العمل: ${c.hours_ar}
- رقم الهاتف: ${c.phone}
- أيام العمل: السبت إلى الخميس (الجمعة إجازة)

الأطباء:
${doctorList}

الإجراءات والأسعار:
${procedureList}

تعليمات مهمة:
- ردك يجب أن يكون قصيراً وواضحاً — جملة أو جملتين في الغالب
- إذا سأل عن حجز موعد: قل له اضغط على زر "حجز موعد" في القائمة
- إذا سأل عن إلغاء أو تغيير موعد: أجب بـ INTENT:CANCEL أو INTENT:RESCHEDULE
- إذا سأل عن موعده القادم: أجب بـ INTENT:NEXT_APPOINTMENT
- إذا سأل عن الموقع أو العنوان: أعطه العنوان مباشرة
- إذا سأل عن الأسعار أو الخدمات: أعطه المعلومات من القائمة أعلاه
- إذا سأل عن أفضل دكتور: قل "كل أطبائنا ممتازين 😊 اختر من القائمة وما تندم"
- إذا كان المريض خايف أو قلقان: طمنه بجملة واحدة دافئة
- إذا كان المريض زعلان أو يشكو: تعاطف معه وأخبره أن أحد سيتواصل معه
- إذا سأل عن الأشعة أو الصور: ${config.features?.xraySharing ? 'قل له يراجع موظفي العيادة' : 'اعتذر منه وأخبره أن الأشعة تُعطى بشكل ورقي فقط عند العيادة'}
- إذا سأل عن شيء ما تعرفينه: قل "ما عندي هذي المعلومة، تواصل معنا على ${c.phone}"
- لا تذكري اسم دكتور بعينه كأفضل دكتور
- لا تستخدمي "حبيبي" أو "حبيبتي"
- تكلمي بلهجة بحرينية فقط
${extraContext}`
  } else {
    return `You are an intelligent receptionist at ${c.name_en}, a dental clinic in ${c.location_en}, Bahrain. Your name is Noor.
You speak in a warm, professional tone.

Clinic info:
- Location: ${c.location_en}
- Hours: ${c.hours_en}
- Phone: ${c.phone}
- Working days: Saturday to Thursday (Friday closed)

Doctors:
${doctorList}

Procedures & Prices:
${procedureList}

Important instructions:
- Keep replies short and clear — usually one or two sentences
- If they want to book: tell them to tap the "Book Appointment" button in the menu
- If they want to cancel or reschedule: reply with INTENT:CANCEL or INTENT:RESCHEDULE
- If they ask about their next appointment: reply with INTENT:NEXT_APPOINTMENT
- If they ask about location/address: give the address directly
- If they ask about prices or services: answer from the list above
- If they ask who is the best doctor: say "All our doctors are excellent 😊 choose from the list and you won't regret it"
- If the patient is scared or anxious: reassure them warmly in one sentence
- If the patient is angry or complaining: empathize and let them know someone will follow up
- If they ask about X-rays or images: ${config.features?.xraySharing ? 'refer them to clinic staff' : 'apologize and explain that X-rays are only provided as hard copies at the clinic'}
- If you don't know something: say "I don't have that information, please call us at ${c.phone}"
- Never name a specific doctor as the best
- Never use more than two sentences
${extraContext}`
  }
}

async function getClaudeResponse(userMessage, lang) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-sonnet-4-20250514',
        max_tokens: 300,
        system:     buildSystemPrompt(lang),
        messages:   [{ role: 'user', content: userMessage }]
      },
      {
        headers: {
          'x-api-key':         process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type':      'application/json'
        }
      }
    );
    return response.data.content[0].text;
  } catch (error) {
    console.error('Claude API error:', error.response?.data || error.message);
    const isAr = lang === 'ar';
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

function mediaToContentBlock({ base64, mimeType }) {
  const isPdf = mimeType === 'application/pdf';
  if (isPdf) {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  }
  return { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } };
}

async function scanCPRMedia(mediaIds) {
  const downloads   = await Promise.all(mediaIds.map(downloadMedia));
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
        'x-api-key':         process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json'
      }
    }
  );

  const raw   = response.data.content[0].text;
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

module.exports = { getClaudeResponse, scanCPRMedia, buildSystemPrompt };
