const { sendText, sendInteractiveButtons, sendList } = require('./whatsapp');
const { getState, setState, clearState, STATE } = require('./state');
const { getClaudeResponse, scanCPRImage } = require('./claude');
const { createAppointment } = require('./calendar');
const config = require('./config');

function detectLanguage(text) {
  return /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en';
}

const GREETINGS = ['hi', 'hello', 'hey', 'start', 'menu', 'مرحبا', 'هاي', 'السلام', 'أهلاً', 'اهلا', 'مرحباً', 'مساء', 'صباح', 'هلا', 'ابدأ'];

async function sendMainMenu(to, phoneNumberId, lang) {
  const isAr = lang === 'ar';
  await sendInteractiveButtons(to, phoneNumberId,
    isAr
      ? `مرحباً بك في ${config.clinic.name_ar} 👋\nكيف يمكنني مساعدتك اليوم؟`
      : `Welcome to ${config.clinic.name_en} 👋\nHow can I help you today?`,
    [
      { id: 'book',     title: isAr ? '📅 حجز موعد'     : '📅 Book Appointment' },
      { id: 'hours',    title: isAr ? '🕐 أوقات العمل'   : '🕐 Hours & Location' },
      { id: 'services', title: isAr ? '💰 خدماتنا'       : '💰 Our Services' },
    ]
  );
  await sendInteractiveButtons(to, phoneNumberId,
    isAr ? ' ' : ' ',
    [{ id: 'staff', title: isAr ? '👨‍⚕️ تحدث مع موظف' : '👨‍⚕️ Speak to Staff' }]
  );
}

async function sendRegistrationRequest(to, phoneNumberId, lang) {
  const isAr = lang === 'ar';
  await sendInteractiveButtons(to, phoneNumberId,
    isAr
      ? `لتأكيد موعدك، نحتاج بعض معلوماتك 📋\n\nيمكنك إما ملء البيانات يدوياً أو إرسال صورة بطاقة هويتك (CPR):`
      : `To confirm your appointment, we need a few details 📋\n\nYou can either fill in the info manually or send a photo of your CPR card:`,
    [
      { id: 'reg_manual', title: isAr ? '✍️ إدخال يدوي' : '✍️ Enter Manually' },
      { id: 'reg_cpr',    title: isAr ? '📷 إرسال CPR'  : '📷 Send CPR Card'  },
    ]
  );
}

async function notifyClinic(patientInfo, bookingData, lang) {
  const isAr = lang === 'ar';
  const clinicPhone = config.clinic.notifyPhone || config.clinic.phone;
  const doctorName = bookingData?.doctor
    ? (isAr ? bookingData.doctor.name_ar : bookingData.doctor.name_en)
    : '-';

  const message = isAr
    ? `🆕 *مريض جديد - تسجيل موعد*\n\n👤 الاسم: ${patientInfo.fullName || '-'}\n🪪 الرقم الشخصي (CPR): ${patientInfo.cpr || '-'}\n🎂 تاريخ الميلاد: ${patientInfo.dob || '-'}\n🌍 الجنسية: ${patientInfo.nationality || '-'}\n👨‍⚕️ الطبيب: ${doctorName}\n📅 التاريخ: ${bookingData?.dateDisplay || '-'}\n🕐 الوقت: ${bookingData?.time || '-'}\n📞 رقم المريض: ${patientInfo.phone}`
    : `🆕 *New Patient - Appointment Registration*\n\n👤 Name: ${patientInfo.fullName || '-'}\n🪪 CPR: ${patientInfo.cpr || '-'}\n🎂 DOB: ${patientInfo.dob || '-'}\n🌍 Nationality: ${patientInfo.nationality || '-'}\n👨‍⚕️ Doctor: ${doctorName}\n📅 Date: ${bookingData?.dateDisplay || '-'}\n🕐 Time: ${bookingData?.time || '-'}\n📞 Patient Phone: ${patientInfo.phone}`;

  const { sendText: sendNotification } = require('./whatsapp');
  await sendNotification(clinicPhone, process.env.PHONE_NUMBER_ID, message);
}

async function handleRegistration(to, phoneNumberId, message, userState) {
  const { lang, data } = userState;
  const isAr = lang === 'ar';
  const text = message.type === 'text' ? message.text?.body?.trim() : null;
  const buttonId = message.interactive?.button_reply?.id;

  // CPR image received
  if (message.type === 'image' && data.awaitingCPR) {
    await sendText(to, phoneNumberId, isAr ? '⏳ جاري قراءة بطاقتك...' : '⏳ Reading your CPR card...');
    try {
      const imageId = message.image.id;
      const extracted = await scanCPRImage(imageId);
      const booking = data.booking || {};

      await sendText(to, phoneNumberId,
        isAr
          ? `✅ *تم استخراج بياناتك:*\n\n👤 الاسم: ${extracted.fullName || '-'}\n🪪 CPR: ${extracted.cpr || '-'}\n🎂 تاريخ الميلاد: ${extracted.dob || '-'}\n🌍 الجنسية: ${extracted.nationality || '-'}\n\nشكراً! تم تسجيل موعدك ✅`
          : `✅ *Extracted from your CPR card:*\n\n👤 Name: ${extracted.fullName || '-'}\n🪪 CPR: ${extracted.cpr || '-'}\n🎂 DOB: ${extracted.dob || '-'}\n🌍 Nationality: ${extracted.nationality || '-'}\n\nThank you! Your appointment is confirmed ✅`
      );

      await notifyClinic({ ...extracted, phone: to }, booking, lang);
      clearState(to);
    } catch (e) {
      await sendText(to, phoneNumberId,
        isAr
          ? '⚠️ ما قدرت أقرأ الصورة. يرجى إرسالها بشكل أوضح أو اختر إدخال يدوي.'
          : '⚠️ Could not read the image clearly. Please try a clearer photo or enter details manually.'
      );
    }
    return;
  }

  // Manual entry selected
  if (buttonId === 'reg_manual') {
    setState(to, { ...userState, state: STATE.REGISTRATION, data: { ...data, regStep: 'waiting', awaitingCPR: false } });
    await sendText(to, phoneNumberId,
      isAr
        ? `يرجى إرسال بياناتك بهذا الترتيب (كل معلومة في سطر):\n\nالاسم الكامل\nالرقم الشخصي (CPR)\nتاريخ الميلاد\nالجنسية\n\n*مثال:*\nأحمد محمد علي\n880101234\n01/01/1988\nبحريني`
        : `Please send your details in this order (one per line):\n\nFull Name\nCPR Number\nDate of Birth\nNationality\n\n*Example:*\nAhmed Mohammed Ali\n880101234\n01/01/1988\nBahraini`
    );
    return;
  }

  // CPR photo option selected
  if (buttonId === 'reg_cpr') {
    setState(to, { ...userState, state: STATE.AWAITING_CPR_IMAGE, data: { ...data, awaitingCPR: true } });
    await sendText(to, phoneNumberId,
      isAr ? '📷 يرجى إرسال صورة واضحة لبطاقة الهوية (CPR) 🪪' : '📷 Please send a clear photo of your CPR card 🪪'
    );
    return;
  }

  // Manual text received - parse all lines at once
  if (text && data.regStep === 'waiting') {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const patientInfo = {
      fullName:    lines[0] || '-',
      cpr:         lines[1] || '-',
      dob:         lines[2] || '-',
      nationality: lines[3] || '-',
      phone: to,
    };
    const booking = data.booking || {};
    await notifyClinic(patientInfo, booking, lang);
    clearState(to);
    await sendText(to, phoneNumberId,
      isAr
        ? `✅ *تم التسجيل بنجاح!*\n\n👤 ${patientInfo.fullName}\n📅 ${booking.dateDisplay || ''} ${booking.time ? '- 🕐 ' + booking.time : ''}\n\nنراك قريباً 😊`
        : `✅ *Registration complete!*\n\n👤 ${patientInfo.fullName}\n📅 ${booking.dateDisplay || ''} ${booking.time ? '- 🕐 ' + booking.time : ''}\n\nSee you soon! 😊`
    );
    return;
  }
}

async function handleBookingFlow(to, phoneNumberId, message, userState) {
  const { lang, state, data } = userState;
  const isAr = lang === 'ar';
  const text = message.type === 'text' ? message.text?.body?.trim() : null;
  const buttonId = message.interactive?.button_reply?.id;
  const listId = message.interactive?.list_reply?.id;

  switch (state) {

    case STATE.BOOKING_NAME:
      if (!text) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى كتابة اسمك الكامل ✍️' : 'Please type your full name ✍️');
        return;
      }
      setState(to, { ...userState, state: STATE.BOOKING_DOCTOR, data: { ...data, name: text } });
      await sendList(to, phoneNumberId,
        isAr ? 'اختر الطبيب' : 'Choose Doctor',
        isAr ? `شكراً ${text}! يرجى اختيار الطبيب المفضل:` : `Thanks ${text}! Please select your preferred doctor:`,
        isAr ? 'اختر' : 'Select',
        [{
          title: isAr ? 'الأطباء المتاحون' : 'Available Doctors',
          rows: config.doctors.map(d => ({
            id: `doctor_${d.id}`,
            title: isAr ? d.name_ar : d.name_en,
          }))
        }]
      );
      break;

    case STATE.BOOKING_DOCTOR: {
      const sel = listId || buttonId;
      if (!sel?.startsWith('doctor_')) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى الاختيار من القائمة 👆' : 'Please select from the list 👆');
        return;
      }
      const doctor = config.doctors.find(d => d.id === sel.replace('doctor_', ''));

      // Build next 14 days list
      const dateRows = [];
      const arabicDays = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
      const englishDays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const arabicMonths = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
      for (let i = 1; i <= 14; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        const dayIdx = d.getDay();
        const id = `date_${yyyy}-${mm}-${dd}`;
        const display = `${dd}/${mm}/${yyyy}`;
        const titleAr = `${arabicDays[dayIdx]} ${d.getDate()} ${arabicMonths[d.getMonth()]}`;
        const titleEn = `${englishDays[dayIdx]} ${dd}/${mm}`;
        dateRows.push({ id, title: isAr ? titleAr : titleEn, display });
      }

      await sendList(to, phoneNumberId,
        isAr ? 'اختر التاريخ' : 'Choose Date',
        isAr ? `ممتاز! اخترت ${doctor.name_ar} 👍\n\nاختر التاريخ المناسب:` : `Great choice! ${doctor.name_en} 👍\n\nSelect your preferred date:`,
        isAr ? 'اختر' : 'Select',
        [{ title: isAr ? 'المواعيد المتاحة' : 'Available Dates', rows: dateRows.slice(0, 10) }]
      );
      setState(to, { ...userState, state: STATE.BOOKING_DATE, data: { ...data, doctor, dateRows } });
      break;
    }

    case STATE.BOOKING_DATE: {
      const dateSel = listId;
      if (!dateSel?.startsWith('date_')) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى الاختيار من القائمة 👆' : 'Please select from the list 👆');
        return;
      }
      const formattedDate = dateSel.replace('date_', '');
      const parts = formattedDate.split('-');
      const dateDisplay = `${parts[2]}/${parts[1]}/${parts[0]}`;
      setState(to, { ...userState, state: STATE.BOOKING_TIME, data: { ...data, date: formattedDate, dateDisplay } });

      const timeSlots = [
        { id: 'time_07:00', ar: '٧:٠٠ صباحاً',  en: '7:00 AM',  label: '07:00' },
        { id: 'time_08:00', ar: '٨:٠٠ صباحاً',  en: '8:00 AM',  label: '08:00' },
        { id: 'time_09:00', ar: '٩:٠٠ صباحاً',  en: '9:00 AM',  label: '09:00' },
        { id: 'time_10:00', ar: '١٠:٠٠ صباحاً', en: '10:00 AM', label: '10:00' },
        { id: 'time_11:00', ar: '١١:٠٠ صباحاً', en: '11:00 AM', label: '11:00' },
        { id: 'time_14:00', ar: '٢:٠٠ مساءً',   en: '2:00 PM',  label: '14:00' },
        { id: 'time_15:00', ar: '٣:٠٠ مساءً',   en: '3:00 PM',  label: '15:00' },
        { id: 'time_16:00', ar: '٤:٠٠ مساءً',   en: '4:00 PM',  label: '16:00' },
        { id: 'time_17:00', ar: '٥:٠٠ مساءً',   en: '5:00 PM',  label: '17:00' },
        { id: 'time_19:00', ar: '٧:٠٠ مساءً',   en: '7:00 PM',  label: '19:00' },
      ];
      await sendList(to, phoneNumberId,
        isAr ? 'اختر الوقت' : 'Choose Time',
        isAr ? 'يرجى اختيار الوقت المناسب:' : 'Please select your preferred time:',
        isAr ? 'اختر الوقت' : 'Select Time',
        [{ title: isAr ? 'الأوقات المتاحة' : 'Available Times',
           rows: timeSlots.map(t => ({ id: t.id, title: isAr ? t.ar : t.en })) }]
      );
      break;
    }

    case STATE.BOOKING_TIME: {
      const timeSel = listId;
      if (!timeSel?.startsWith('time_')) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى اختيار الوقت من القائمة 👆' : 'Please select a time from the list 👆');
        return;
      }
      const timeLabels = {
        'time_07:00': { ar: '٧:٠٠ صباحاً',  en: '7:00 AM'  },
        'time_08:00': { ar: '٨:٠٠ صباحاً',  en: '8:00 AM'  },
        'time_09:00': { ar: '٩:٠٠ صباحاً',  en: '9:00 AM'  },
        'time_10:00': { ar: '١٠:٠٠ صباحاً', en: '10:00 AM' },
        'time_11:00': { ar: '١١:٠٠ صباحاً', en: '11:00 AM' },
        'time_14:00': { ar: '٢:٠٠ مساءً',   en: '2:00 PM'  },
        'time_15:00': { ar: '٣:٠٠ مساءً',   en: '3:00 PM'  },
        'time_16:00': { ar: '٤:٠٠ مساءً',   en: '4:00 PM'  },
        'time_17:00': { ar: '٥:٠٠ مساءً',   en: '5:00 PM'  },
        'time_19:00': { ar: '٧:٠٠ مساءً',   en: '7:00 PM'  },
      };
      const time = timeSel.replace('time_', '');
      const timeDisplay = isAr ? timeLabels[timeSel]?.ar : timeLabels[timeSel]?.en;
      setState(to, { ...userState, state: STATE.BOOKING_CONFIRM, data: { ...data, time, timeDisplay } });
      const doctorName = isAr ? data.doctor.name_ar : data.doctor.name_en;
      await sendInteractiveButtons(to, phoneNumberId,
        isAr
          ? `📋 *ملخص الحجز*\n\n👤 الاسم: ${data.name}\n👨‍⚕️ الطبيب: ${doctorName}\n📅 التاريخ: ${data.dateDisplay}\n🕐 الوقت: ${timeDisplay}\n\nهل تريد تأكيد الموعد؟`
          : `📋 *Booking Summary*\n\n👤 Name: ${data.name}\n👨‍⚕️ Doctor: ${doctorName}\n📅 Date: ${data.dateDisplay}\n🕐 Time: ${timeDisplay}\n\nConfirm your appointment?`,
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
          patientName: data.name,
          patientPhone: to,
          doctorName: isAr ? data.doctor.name_ar : data.doctor.name_en,
          date: data.date,
          time: data.time,
        });

        if (result.success) {
          // Move to registration step
          setState(to, { ...userState, state: STATE.REGISTRATION, data: { ...data, booking: { doctor: data.doctor, dateDisplay: data.dateDisplay, time: data.time, timeDisplay: data.timeDisplay }, regStep: null, awaitingCPR: false } });
          await sendText(to, phoneNumberId,
            isAr
              ? `✅ *تم تأكيد الموعد!*\n\n👤 ${data.name}\n👨‍⚕️ ${data.doctor.name_ar}\n📅 ${data.dateDisplay} - 🕐 ${data.timeDisplay || data.time}`
              : `✅ *Appointment Confirmed!*\n\n👤 ${data.name}\n👨‍⚕️ ${data.doctor.name_en}\n📅 ${data.dateDisplay} - 🕐 ${data.timeDisplay || data.time}`
          );
          await sendRegistrationRequest(to, phoneNumberId, lang);
        } else {
          clearState(to);
          await sendText(to, phoneNumberId,
            isAr
              ? `عذراً، حدث خطأ في الحجز 😔\nيرجى الاتصال بنا: ${config.clinic.phone}`
              : `Sorry, a booking error occurred 😔\nPlease call us: ${config.clinic.phone}`
          );
        }
      } else {
        clearState(to);
        await sendText(to, phoneNumberId, isAr ? '👍 تم الإلغاء. كيف يمكنني مساعدتك؟' : '👍 Cancelled. How can I help you?');
        await sendMainMenu(to, phoneNumberId, lang);
      }
      break;
    }
  }
}

async function handleMessage(from, message, phoneNumberId) {
  let userState = getState(from);

  // Only update language from free text, not button/list taps
  if (message.type === 'text') {
    const detectedLang = detectLanguage(message.text?.body || '');
    userState = { ...userState, lang: detectedLang };
    setState(from, userState);

    // Reset command — clears stuck state at any point
    const lower = message.text?.body?.trim().toLowerCase();
    if (['reset', 'cancel', 'إلغاء', 'الغاء', 'رجوع', 'مسح', 'ابدأ', 'start'].includes(lower)) {
      clearState(from);
      await sendMainMenu(from, phoneNumberId, detectedLang);
      return;
    }
  }

  const { lang, state } = userState;
  const isAr = lang === 'ar';
  const text = message.type === 'text' ? message.text?.body?.trim() : null;
  const buttonId = message.interactive?.button_reply?.id;

  // Registration flow
  if (state === STATE.REGISTRATION || state === STATE.AWAITING_CPR_IMAGE) {
    await handleRegistration(from, phoneNumberId, message, userState);
    return;
  }

  // If user is mid-booking, continue the flow
  if (state !== STATE.IDLE) {
    await handleBookingFlow(from, phoneNumberId, message, userState);
    return;
  }

  // Main menu button responses
  if (buttonId) {
    switch (buttonId) {
      case 'book':
        setState(from, { ...userState, state: STATE.BOOKING_NAME, data: {} });
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
            ? `👨‍⚕️ *التحدث مع موظف*\n\nيمكنك الاتصال بنا مباشرة:\n📞 ${config.clinic.phone}\n\nأو سنتواصل معك في أقرب وقت ✅`
            : `👨‍⚕️ *Speak to Staff*\n\nCall us directly:\n📞 ${config.clinic.phone}\n\nOr we'll get back to you shortly ✅`
        );
        return;
    }
  }

  // Text message handling
  if (text) {
    const lower = text.toLowerCase();
    const words = lower.trim().split(/\s+/);
    // Only treat as pure greeting if the message is short (1-3 words) and matches a greeting
    const isGreeting = words.length <= 3 && GREETINGS.some(g => lower.includes(g));

    if (isGreeting) {
      await sendMainMenu(from, phoneNumberId, lang);
      return;
    }

    // Send to Claude for intelligent response
    const reply = await getClaudeResponse(text, lang);
    await sendText(from, phoneNumberId, reply);
    setTimeout(() => sendMainMenu(from, phoneNumberId, lang), 1000);
    return;
  }

  // Fallback
  await sendMainMenu(from, phoneNumberId, lang);
}

module.exports = { handleMessage };
