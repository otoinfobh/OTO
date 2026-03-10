const { sendText, sendInteractiveButtons, sendList } = require('./whatsapp');
const { getState, setState, clearState, STATE } = require('./state');
const { getClaudeResponse, scanCPRImage } = require('./claude');
const { createAppointment } = require('./calendar');
const config = require('./config');

function detectLanguage(text) {
  return /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en';
}

const GREETINGS   = ['hi', 'hello', 'hey', 'menu', 'مرحبا', 'هاي', 'السلام', 'أهلاً', 'اهلا', 'مرحباً', 'مساء', 'صباح', 'هلا'];
const RESET_WORDS = ['reset', 'cancel', 'إلغاء', 'الغاء', 'رجوع', 'مسح', 'ابدأ', 'start'];

const TIME_LABELS = {
  'time_07:00': { ar: '٧:٠٠ صباحاً',  en: '7:00 AM',  val: '07:00' },
  'time_08:00': { ar: '٨:٠٠ صباحاً',  en: '8:00 AM',  val: '08:00' },
  'time_09:00': { ar: '٩:٠٠ صباحاً',  en: '9:00 AM',  val: '09:00' },
  'time_10:00': { ar: '١٠:٠٠ صباحاً', en: '10:00 AM', val: '10:00' },
  'time_11:00': { ar: '١١:٠٠ صباحاً', en: '11:00 AM', val: '11:00' },
  'time_14:00': { ar: '٢:٠٠ مساءً',   en: '2:00 PM',  val: '14:00' },
  'time_15:00': { ar: '٣:٠٠ مساءً',   en: '3:00 PM',  val: '15:00' },
  'time_16:00': { ar: '٤:٠٠ مساءً',   en: '4:00 PM',  val: '16:00' },
  'time_17:00': { ar: '٥:٠٠ مساءً',   en: '5:00 PM',  val: '17:00' },
  'time_19:00': { ar: '٧:٠٠ مساءً',   en: '7:00 PM',  val: '19:00' },
};

// ── 30-minute inactivity timeout ─────────────────────────────────────────────
const TIMEOUT_MS = 30 * 60 * 1000;
const timeouts   = new Map();

function scheduleTimeout(from, phoneNumberId, lang) {
  if (timeouts.has(from)) clearTimeout(timeouts.get(from));
  const t = setTimeout(async () => {
    timeouts.delete(from);
    const s = getState(from);
    if (s.state !== STATE.IDLE) {
      clearState(from);
      const isAr = lang === 'ar';
      await sendText(from, phoneNumberId,
        isAr
          ? 'انتهت مدة جلستك بسبب عدم النشاط. ابدأ من جديد 😊'
          : 'Your session timed out due to inactivity. Feel free to start again 😊'
      );
      await sendMainMenu(from, phoneNumberId, lang);
    }
  }, TIMEOUT_MS);
  timeouts.set(from, t);
}

function cancelTimeout(from) {
  if (timeouts.has(from)) {
    clearTimeout(timeouts.get(from));
    timeouts.delete(from);
  }
}

// ── Date list builder ─────────────────────────────────────────────────────────
function buildDateRows(isAr) {
  const arabicDays   = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const englishDays  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const arabicMonths = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const rows = [];
  for (let i = 1; i <= 10; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dd   = String(d.getDate()).padStart(2, '0');
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const day  = d.getDay();
    rows.push({
      id:    `date_${yyyy}-${mm}-${dd}`,
      title: isAr
        ? `${arabicDays[day]} ${d.getDate()} ${arabicMonths[d.getMonth()]}`
        : `${englishDays[day]} ${dd}/${mm}`,
    });
  }
  return rows;
}

// ── Shared UI helpers ─────────────────────────────────────────────────────────
async function sendMainMenu(to, phoneNumberId, lang) {
  const isAr = lang === 'ar';
  await sendInteractiveButtons(to, phoneNumberId,
    isAr
      ? `مرحباً بك في ${config.clinic.name_ar} 👋\nكيف يمكنني مساعدتك اليوم؟`
      : `Welcome to ${config.clinic.name_en} 👋\nHow can I help you today?`,
    [
      { id: 'book',     title: isAr ? '📅 حجز موعد'   : '📅 Book Appointment' },
      { id: 'hours',    title: isAr ? '🕐 أوقات العمل' : '🕐 Hours & Location' },
      { id: 'services', title: isAr ? '💰 خدماتنا'     : '💰 Our Services'     },
    ]
  );
  await sendInteractiveButtons(to, phoneNumberId, ' ',
    [{ id: 'staff', title: isAr ? '👨‍⚕️ تحدث مع موظف' : '👨‍⚕️ Speak to Staff' }]
  );
}

async function sendRegistrationRequest(to, phoneNumberId, lang) {
  const isAr = lang === 'ar';
  await sendInteractiveButtons(to, phoneNumberId,
    isAr
      ? `لتأكيد موعدك، نحتاج بعض معلوماتك 📋\n\nيمكنك ملء البيانات يدوياً أو إرسال صورة بطاقة الهوية (CPR):`
      : `To confirm your appointment, we need a few details 📋\n\nYou can fill in your info manually or send a photo of your CPR card:`,
    [
      { id: 'reg_manual', title: isAr ? '✍️ إدخال يدوي' : '✍️ Enter Manually' },
      { id: 'reg_cpr',    title: isAr ? '📷 إرسال CPR'  : '📷 Send CPR Card'  },
    ]
  );
}

async function notifyClinic(patientInfo, bookingData, lang) {
  const isAr    = lang === 'ar';
  const phone   = config.clinic.notifyPhone || config.clinic.phone;
  const doctor  = bookingData?.doctor
    ? (isAr ? bookingData.doctor.name_ar : bookingData.doctor.name_en) : '-';
  const msg = isAr
    ? `🆕 *مريض جديد*\n\n👤 ${patientInfo.fullName || '-'}\n🪪 CPR: ${patientInfo.cpr || '-'}\n🎂 ${patientInfo.dob || '-'}\n🌍 ${patientInfo.nationality || '-'}\n👨‍⚕️ ${doctor}\n📅 ${bookingData?.dateDisplay || '-'} - 🕐 ${bookingData?.timeDisplay || bookingData?.time || '-'}\n📞 ${patientInfo.phone}`
    : `🆕 *New Patient*\n\n👤 ${patientInfo.fullName || '-'}\n🪪 CPR: ${patientInfo.cpr || '-'}\n🎂 DOB: ${patientInfo.dob || '-'}\n🌍 ${patientInfo.nationality || '-'}\n👨‍⚕️ ${doctor}\n📅 ${bookingData?.dateDisplay || '-'} - 🕐 ${bookingData?.timeDisplay || bookingData?.time || '-'}\n📞 ${patientInfo.phone}`;
  const { sendText: notify } = require('./whatsapp');
  await notify(phone, process.env.PHONE_NUMBER_ID, msg);
}

// ── Registration flow ─────────────────────────────────────────────────────────
async function handleRegistration(to, phoneNumberId, message, userState) {
  const { lang, data } = userState;
  const isAr     = lang === 'ar';
  const text     = message.type === 'text' ? message.text?.body?.trim() : null;
  const buttonId = message.interactive?.button_reply?.id;

  if (message.type === 'image' && data.awaitingCPR) {
    await sendText(to, phoneNumberId, isAr ? '⏳ جاري قراءة بطاقتك...' : '⏳ Reading your CPR card...');
    try {
      const extracted = await scanCPRImage(message.image.id);
      await notifyClinic({ ...extracted, phone: to }, data.booking, lang);
      cancelTimeout(to);
      clearState(to);
      await sendText(to, phoneNumberId,
        isAr
          ? `✅ تم تسجيلك!\n\n👤 ${extracted.fullName || '-'}\n🪪 ${extracted.cpr || '-'}\n\nنراك قريباً 😊`
          : `✅ Registered!\n\n👤 ${extracted.fullName || '-'}\n🪪 ${extracted.cpr || '-'}\n\nSee you soon! 😊`
      );
    } catch {
      await sendText(to, phoneNumberId,
        isAr ? '⚠️ ما قدرت أقرأ الصورة، حاول مجدداً أو اختر إدخال يدوي.' : '⚠️ Could not read the image. Try again or enter manually.'
      );
    }
    return;
  }

  if (buttonId === 'reg_manual') {
    setState(to, { ...userState, state: STATE.REGISTRATION, data: { ...data, regStep: 'waiting', awaitingCPR: false } });
    await sendText(to, phoneNumberId,
      isAr
        ? `أرسل بياناتك بهذا الترتيب (كل معلومة في سطر):\n\nالاسم الكامل\nالرقم الشخصي (CPR)\nتاريخ الميلاد\nالجنسية\n\n*مثال:*\nأحمد محمد علي\n880101234\n01/01/1988\nبحريني`
        : `Please send your details in this order (one per line):\n\nFull Name\nCPR Number\nDate of Birth\nNationality\n\n*Example:*\nAhmed Mohammed Ali\n880101234\n01/01/1988\nBahraini`
    );
    return;
  }

  if (buttonId === 'reg_cpr') {
    setState(to, { ...userState, state: STATE.AWAITING_CPR_IMAGE, data: { ...data, awaitingCPR: true } });
    await sendText(to, phoneNumberId,
      isAr ? '📷 أرسل صورة واضحة لبطاقة الهوية (CPR) 🪪' : '📷 Please send a clear photo of your CPR card 🪪'
    );
    return;
  }

  if (text && data.regStep === 'waiting') {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const patientInfo = {
      fullName:    lines[0] || '-',
      cpr:         lines[1] || '-',
      dob:         lines[2] || '-',
      nationality: lines[3] || '-',
      phone: to,
    };
    await notifyClinic(patientInfo, data.booking, lang);
    cancelTimeout(to);
    clearState(to);
    await sendText(to, phoneNumberId,
      isAr
        ? `✅ *تم التسجيل!*\n\n👤 ${patientInfo.fullName}\n📅 ${data.booking?.dateDisplay || ''} - 🕐 ${data.booking?.timeDisplay || data.booking?.time || ''}\n\nنراك قريباً 😊`
        : `✅ *Registration complete!*\n\n👤 ${patientInfo.fullName}\n📅 ${data.booking?.dateDisplay || ''} - 🕐 ${data.booking?.timeDisplay || data.booking?.time || ''}\n\nSee you soon! 😊`
    );
    return;
  }
}

// ── Booking flow ──────────────────────────────────────────────────────────────
async function handleBookingFlow(to, phoneNumberId, message, userState) {
  const { lang, state, data } = userState;
  const isAr     = lang === 'ar';
  const text     = message.type === 'text' ? message.text?.body?.trim() : null;
  const buttonId = message.interactive?.button_reply?.id;
  const listId   = message.interactive?.list_reply?.id;

  console.log(`📋 State: ${state} | buttonId: ${buttonId} | listId: ${listId} | text: ${text}`);

  switch (state) {

    case STATE.BOOKING_NAME: {
      if (!text) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى كتابة اسمك الكامل ✍️' : 'Please type your full name ✍️');
        return;
      }
      setState(to, { ...userState, state: STATE.BOOKING_DOCTOR, data: { ...data, name: text } });
      await sendList(to, phoneNumberId,
        isAr ? 'اختر الطبيب' : 'Choose Doctor',
        isAr ? `شكراً ${text}! اختر الطبيب المفضل:` : `Thanks ${text}! Select your preferred doctor:`,
        isAr ? 'اختر' : 'Select',
        [{ title: isAr ? 'الأطباء المتاحون' : 'Available Doctors',
           rows: config.doctors.map(d => ({ id: `doctor_${d.id}`, title: isAr ? d.name_ar : d.name_en })) }]
      );
      break;
    }

    case STATE.BOOKING_DOCTOR: {
      const sel = listId || buttonId;
      console.log(`🩺 Doctor sel: ${sel}`);
      if (!sel?.startsWith('doctor_')) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى الاختيار من القائمة 👆' : 'Please select from the list 👆');
        return;
      }
      const doctor = config.doctors.find(d => `doctor_${d.id}` === sel);
      if (!doctor) {
        console.error(`Doctor not found for sel: ${sel}`);
        await sendText(to, phoneNumberId, isAr ? 'حدث خطأ، يرجى المحاولة مجدداً' : 'An error occurred, please try again');
        return;
      }
      setState(to, { ...userState, state: STATE.BOOKING_DATE, data: { ...data, doctor } });
      await sendList(to, phoneNumberId,
        isAr ? 'اختر التاريخ' : 'Choose Date',
        isAr ? `ممتاز! اخترت ${doctor.name_ar} 👍\n\nاختر التاريخ:` : `Great! ${doctor.name_en} 👍\n\nSelect your preferred date:`,
        isAr ? 'اختر' : 'Select',
        [{ title: isAr ? 'المواعيد المتاحة' : 'Available Dates', rows: buildDateRows(isAr) }]
      );
      break;
    }

    case STATE.BOOKING_DATE: {
      console.log(`📅 Date listId: ${listId}`);
      if (!listId?.startsWith('date_')) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى الاختيار من القائمة 👆' : 'Please select from the list 👆');
        return;
      }
      const parts       = listId.replace('date_', '').split('-');
      const dateDisplay = `${parts[2]}/${parts[1]}/${parts[0]}`;
      setState(to, { ...userState, state: STATE.BOOKING_TIME, data: { ...data, date: listId.replace('date_', ''), dateDisplay } });
      await sendList(to, phoneNumberId,
        isAr ? 'اختر الوقت' : 'Choose Time',
        isAr ? 'اختر الوقت المناسب:' : 'Select your preferred time:',
        isAr ? 'اختر' : 'Select',
        [{ title: isAr ? 'الأوقات المتاحة' : 'Available Times',
           rows: Object.entries(TIME_LABELS).map(([id, t]) => ({ id, title: isAr ? t.ar : t.en })) }]
      );
      break;
    }

    case STATE.BOOKING_TIME: {
      console.log(`🕐 Time listId: ${listId}`);
      if (!listId?.startsWith('time_')) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى اختيار الوقت من القائمة 👆' : 'Please select a time from the list 👆');
        return;
      }
      const tLabel      = TIME_LABELS[listId];
      const timeDisplay = isAr ? tLabel.ar : tLabel.en;
      setState(to, { ...userState, state: STATE.BOOKING_CONFIRM, data: { ...data, time: tLabel.val, timeDisplay } });
      const doctorName  = isAr ? data.doctor.name_ar : data.doctor.name_en;
      await sendInteractiveButtons(to, phoneNumberId,
        isAr
          ? `📋 *ملخص الحجز*\n\n👤 ${data.name}\n👨‍⚕️ ${doctorName}\n📅 ${data.dateDisplay}\n🕐 ${timeDisplay}\n\nتأكيد الموعد؟`
          : `📋 *Booking Summary*\n\n👤 ${data.name}\n👨‍⚕️ ${doctorName}\n📅 ${data.dateDisplay}\n🕐 ${timeDisplay}\n\nConfirm your appointment?`,
        [
          { id: 'confirm_yes', title: isAr ? '✅ تأكيد' : '✅ Confirm' },
          { id: 'confirm_no',  title: isAr ? '❌ إلغاء' : '❌ Cancel'  },
        ]
      );
      break;
    }

    case STATE.BOOKING_CONFIRM: {
      if (buttonId === 'confirm_yes') {
        const result = await createAppointment({
          patientName:  data.name,
          patientPhone: to,
          doctorName:   isAr ? data.doctor.name_ar : data.doctor.name_en,
          date:         data.date,
          time:         data.time,
        });
        if (result.success) {
          const booking = { doctor: data.doctor, dateDisplay: data.dateDisplay, time: data.time, timeDisplay: data.timeDisplay };
          setState(to, { ...userState, state: STATE.REGISTRATION, data: { ...data, booking, regStep: null, awaitingCPR: false } });
          await sendText(to, phoneNumberId,
            isAr
              ? `✅ *تم تأكيد الموعد!*\n\n👤 ${data.name}\n👨‍⚕️ ${data.doctor.name_ar}\n📅 ${data.dateDisplay} - 🕐 ${data.timeDisplay}`
              : `✅ *Appointment Confirmed!*\n\n👤 ${data.name}\n👨‍⚕️ ${data.doctor.name_en}\n📅 ${data.dateDisplay} - 🕐 ${data.timeDisplay}`
          );
          await sendRegistrationRequest(to, phoneNumberId, lang);
        } else {
          cancelTimeout(to);
          clearState(to);
          await sendText(to, phoneNumberId,
            isAr
              ? `عذراً، حدث خطأ 😔\nيرجى الاتصال بنا: ${config.clinic.phone}`
              : `Sorry, an error occurred 😔\nPlease call us: ${config.clinic.phone}`
          );
        }
      } else {
        cancelTimeout(to);
        clearState(to);
        await sendText(to, phoneNumberId, isAr ? '👍 تم الإلغاء.' : '👍 Cancelled.');
        await sendMainMenu(to, phoneNumberId, lang);
      }
      break;
    }
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleMessage(from, message, phoneNumberId) {
  let userState = getState(from);

  if (message.type === 'text') {
    const detectedLang = detectLanguage(message.text?.body || '');
    userState = { ...userState, lang: detectedLang };
    setState(from, userState);

    const lower = message.text?.body?.trim().toLowerCase();
    if (RESET_WORDS.includes(lower)) {
      cancelTimeout(from);
      clearState(from);
      await sendMainMenu(from, phoneNumberId, detectedLang);
      return;
    }
  }

  const { lang, state } = userState;
  const isAr     = lang === 'ar';
  const text     = message.type === 'text' ? message.text?.body?.trim() : null;
  const buttonId = message.interactive?.button_reply?.id;

  // Schedule inactivity timeout whenever user is in a flow
  if (state !== STATE.IDLE) {
    scheduleTimeout(from, phoneNumberId, lang);
  }

  if (state === STATE.REGISTRATION || state === STATE.AWAITING_CPR_IMAGE) {
    await handleRegistration(from, phoneNumberId, message, userState);
    return;
  }

  if (state !== STATE.IDLE) {
    await handleBookingFlow(from, phoneNumberId, message, userState);
    return;
  }

  if (buttonId) {
    switch (buttonId) {
      case 'book':
        setState(from, { ...userState, state: STATE.BOOKING_NAME, data: {} });
        scheduleTimeout(from, phoneNumberId, lang);
        await sendText(from, phoneNumberId,
          isAr ? 'بكل سرور! 😊 يرجى كتابة اسمك الكامل:' : 'Sure! 😊 Please type your full name:'
        );
        return;

      case 'hours':
        await sendText(from, phoneNumberId,
          isAr
            ? `🕐 *أوقات العمل والموقع*\n\n📍 ${config.clinic.location_ar}\n⏰ ${config.clinic.hours_ar}\n📞 ${config.clinic.phone}`
            : `🕐 *Hours & Location*\n\n📍 ${config.clinic.location_en}\n⏰ ${config.clinic.hours_en}\n📞 ${config.clinic.phone}`
        );
        setTimeout(() => sendMainMenu(from, phoneNumberId, lang), 800);
        return;

      case 'services': {
        const list = config.services.map(s =>
          isAr ? `• ${s.name_ar}: ${s.price} د.ب` : `• ${s.name_en}: ${s.price} BD`
        ).join('\n');
        await sendText(from, phoneNumberId,
          isAr ? `💰 *خدماتنا وأسعارنا*\n\n${list}` : `💰 *Our Services & Prices*\n\n${list}`
        );
        setTimeout(() => sendMainMenu(from, phoneNumberId, lang), 800);
        return;
      }

      case 'staff':
        await sendText(from, phoneNumberId,
          isAr
            ? `👨‍⚕️ يمكنك الاتصال بنا مباشرة:\n📞 ${config.clinic.phone}\n\nأو سنتواصل معك في أقرب وقت ✅`
            : `👨‍⚕️ Call us directly:\n📞 ${config.clinic.phone}\n\nOr we'll get back to you shortly ✅`
        );
        return;
    }
  }

  if (text) {
    const lower      = text.toLowerCase();
    const words      = lower.trim().split(/\s+/);
    const isGreeting = words.length <= 3 && GREETINGS.some(g => lower.includes(g));

    if (isGreeting) {
      await sendMainMenu(from, phoneNumberId, lang);
      return;
    }

    const reply = await getClaudeResponse(text, lang);
    await sendText(from, phoneNumberId, reply);
    setTimeout(() => sendMainMenu(from, phoneNumberId, lang), 1000);
    return;
  }

  await sendMainMenu(from, phoneNumberId, lang);
}

module.exports = { handleMessage };
