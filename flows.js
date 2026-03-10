const { sendText, sendInteractiveButtons, sendList } = require('./whatsapp');
const { getState, setState, clearState, STATE } = require('./state');
const { getClaudeResponse, scanCPRImage } = require('./claude');
const { createAppointment, getAvailableSlots, getAvailableDates, findSoonestSlot, findBestDoctor, formatTime, formatTimeDisplay } = require('./calendar');
const config = require('./config');

function detectLanguage(text) {
  return /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en';
}

const GREETINGS   = ['hi', 'hello', 'hey', 'menu', 'مرحبا', 'هاي', 'السلام', 'أهلاً', 'اهلا', 'مرحباً', 'مساء', 'صباح', 'هلا'];
const RESET_WORDS = ['reset', 'cancel', 'إلغاء', 'الغاء', 'رجوع', 'مسح', 'ابدأ', 'start'];

// ── 30-min inactivity timeout ─────────────────────────────────────────────────
const TIMEOUT_MS = 30 * 60 * 1000;
const timeouts   = new Map();

function scheduleTimeout(from, phoneNumberId, lang) {
  if (timeouts.has(from)) clearTimeout(timeouts.get(from));
  const t = setTimeout(async () => {
    timeouts.delete(from);
    if (getState(from).state !== STATE.IDLE) {
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
  if (timeouts.has(from)) { clearTimeout(timeouts.get(from)); timeouts.delete(from); }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
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
  const isAr   = lang === 'ar';
  const phone  = config.clinic.notifyPhone || config.clinic.phone;
  const doctor = bookingData?.doctor
    ? (isAr ? bookingData.doctor.name_ar : bookingData.doctor.name_en) : '-';
  const proc   = bookingData?.procedure
    ? (isAr ? bookingData.procedure.name_ar : bookingData.procedure.name_en) : '-';
  const msg = isAr
    ? `🆕 *مريض جديد*\n\n👤 ${patientInfo.fullName || '-'}\n🪪 CPR: ${patientInfo.cpr || '-'}\n🎂 ${patientInfo.dob || '-'}\n🌍 ${patientInfo.nationality || '-'}\n👨‍⚕️ ${doctor}\n🦷 ${proc}\n📅 ${bookingData?.dateDisplay || '-'} - 🕐 ${bookingData?.timeDisplay || '-'}\n📞 ${patientInfo.phone}`
    : `🆕 *New Patient*\n\n👤 ${patientInfo.fullName || '-'}\n🪪 CPR: ${patientInfo.cpr || '-'}\n🎂 DOB: ${patientInfo.dob || '-'}\n🌍 ${patientInfo.nationality || '-'}\n👨‍⚕️ ${doctor}\n🦷 ${proc}\n📅 ${bookingData?.dateDisplay || '-'} - 🕐 ${bookingData?.timeDisplay || '-'}\n📞 ${patientInfo.phone}`;
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
      cancelTimeout(to); clearState(to);
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
      fullName: lines[0] || '-', cpr: lines[1] || '-',
      dob: lines[2] || '-', nationality: lines[3] || '-', phone: to,
    };
    await notifyClinic(patientInfo, data.booking, lang);
    cancelTimeout(to); clearState(to);
    await sendText(to, phoneNumberId,
      isAr
        ? `✅ *تم التسجيل!*\n\n👤 ${patientInfo.fullName}\n📅 ${data.booking?.dateDisplay || ''} - 🕐 ${data.booking?.timeDisplay || ''}\n\nنراك قريباً 😊`
        : `✅ *Registration complete!*\n\n👤 ${patientInfo.fullName}\n📅 ${data.booking?.dateDisplay || ''} - 🕐 ${data.booking?.timeDisplay || ''}\n\nSee you soon! 😊`
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

  console.log(`📋 State:${state} btn:${buttonId} list:${listId} txt:${text}`);

  switch (state) {

    // ── Name ──────────────────────────────────────────────────────────────────
    case STATE.BOOKING_NAME: {
      if (!text) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى كتابة اسمك الكامل ✍️' : 'Please type your full name ✍️');
        return;
      }
      setState(to, { ...userState, state: STATE.BOOKING_PROCEDURE, data: { ...data, name: text } });
      await sendList(to, phoneNumberId,
        isAr ? 'اختر الإجراء' : 'Choose Procedure',
        isAr ? `شكراً ${text}! ما هو سبب زيارتك؟` : `Thanks ${text}! What brings you in today?`,
        isAr ? 'اختر' : 'Select',
        [{ title: isAr ? 'الإجراءات المتاحة' : 'Available Procedures',
           rows: config.procedures.map(p => ({
             id:          `proc_${p.id}`,
             title:       isAr ? p.name_ar : p.name_en,
             description: `${p.price} BD - ${p.duration} min`,
           }))
        }]
      );
      break;
    }

    // ── Procedure ─────────────────────────────────────────────────────────────
    case STATE.BOOKING_PROCEDURE: {
      const sel = listId || buttonId;
      if (!sel?.startsWith('proc_')) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى الاختيار من القائمة 👆' : 'Please select from the list 👆');
        return;
      }
      const procedure = config.procedures.find(p => `proc_${p.id}` === sel);
      if (!procedure) return;

      setState(to, { ...userState, state: STATE.BOOKING_DOCTOR, data: { ...data, procedure } });

      // Filter doctors: hide senior for non-senior procedures (cleaning counts as non-senior)
      // Dr. Ali Jawad (senior) is hidden for cleaning & consultation
      const hideSeniorFor = ['cleaning', 'consult'];
      const availableDocs = hideSeniorFor.includes(procedure.id)
        ? config.doctors.filter(d => !d.senior)
        : config.doctors;

      const rows = [
        { id: 'doctor_any', title: isAr ? '👨‍⚕️ أي دكتور متاح' : '👨‍⚕️ Any available doctor' },
        ...availableDocs.map(d => ({ id: `doctor_${d.id}`, title: isAr ? d.name_ar : d.name_en })),
      ];

      await sendList(to, phoneNumberId,
        isAr ? 'اختر الطبيب' : 'Choose Doctor',
        isAr ? `ممتاز! اخترت ${procedure.name_ar}.\n\nمع أي طبيب تفضل؟` : `Got it! ${procedure.name_en}.\n\nWhich doctor do you prefer?`,
        isAr ? 'اختر' : 'Select',
        [{ title: isAr ? 'الأطباء المتاحون' : 'Available Doctors', rows }]
      );
      break;
    }

    // ── Doctor ────────────────────────────────────────────────────────────────
    case STATE.BOOKING_DOCTOR: {
      const sel = listId || buttonId;
      if (!sel?.startsWith('doctor_')) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى الاختيار من القائمة 👆' : 'Please select from the list 👆');
        return;
      }

      const procedure = data.procedure;
      await sendText(to, phoneNumberId, isAr ? '⏳ جاري التحقق من المواعيد المتاحة...' : '⏳ Checking available appointments...');

      // Handle "any doctor"
      if (sel === 'doctor_any') {
        const result = await findBestDoctor(procedure.duration);
        if (!result) {
          await sendText(to, phoneNumberId,
            isAr ? `عذراً، لا توجد مواعيد متاحة خلال الـ 30 يوم القادمة 😔\nتواصل معنا: ${config.clinic.phone}` : `Sorry, no available slots in the next 30 days 😔\nCall us: ${config.clinic.phone}`
          );
          clearState(to); return;
        }
        // Auto-assign doctor silently, jump straight to date
        const dd = result.date.split('-');
        const dateDisplay = `${dd[2]}/${dd[1]}/${dd[0]}`;
        setState(to, { ...userState, state: STATE.BOOKING_DATE, data: { ...data, doctor: result.doctor, anyDoctor: true } });
        // Now show available dates for this doctor
        const dates = await getAvailableDates(result.doctor.id, procedure.duration);
        await sendDateList(to, phoneNumberId, isAr, dates);
        return;
      }

      const doctor = config.doctors.find(d => `doctor_${d.id}` === sel);
      if (!doctor) return;

      const dates = await getAvailableDates(doctor.id, procedure.duration);
      if (dates.length === 0) {
        await sendText(to, phoneNumberId,
          isAr ? `عذراً، لا توجد مواعيد متاحة مع ${doctor.name_ar} خلال الـ 30 يوم القادمة 😔\nتواصل معنا: ${config.clinic.phone}` : `Sorry, no available slots with ${doctor.name_en} in the next 30 days 😔\nCall us: ${config.clinic.phone}`
        );
        clearState(to); return;
      }

      setState(to, { ...userState, state: STATE.BOOKING_DATE, data: { ...data, doctor } });
      await sendDateList(to, phoneNumberId, isAr, dates);
      break;
    }

    // ── Date ──────────────────────────────────────────────────────────────────
    case STATE.BOOKING_DATE: {
      const sel = listId;
      if (!sel?.startsWith('date_')) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى الاختيار من القائمة 👆' : 'Please select from the list 👆');
        return;
      }

      const dateVal     = sel.replace('date_', '');
      const parts       = dateVal.split('-');
      const dateDisplay = `${parts[2]}/${parts[1]}/${parts[0]}`;

      await sendText(to, phoneNumberId, isAr ? '⏳ جاري التحقق من الأوقات المتاحة...' : '⏳ Checking available times...');

      const slots = await getAvailableSlots(data.doctor.id, dateVal, data.procedure.duration);
      if (slots.length === 0) {
        await sendText(to, phoneNumberId, isAr ? '⚠️ لا توجد أوقات متاحة في هذا اليوم، اختر يوماً آخر.' : '⚠️ No available times on this date, please choose another.');
        // Re-send date list
        const dates = await getAvailableDates(data.doctor.id, data.procedure.duration);
        await sendDateList(to, phoneNumberId, isAr, dates);
        return;
      }

      setState(to, { ...userState, state: STATE.BOOKING_TIME, data: { ...data, date: dateVal, dateDisplay } });
      const timeRows = slots.map(s => ({
        id:    `slot_${formatTime(s)}`,
        title: formatTimeDisplay(s, isAr),
      }));
      await sendList(to, phoneNumberId,
        isAr ? 'اختر الوقت' : 'Choose Time',
        isAr ? `${dateDisplay} — اختر الوقت:` : `${dateDisplay} — Select a time:`,
        isAr ? 'اختر' : 'Select',
        [{ title: isAr ? 'الأوقات المتاحة' : 'Available Times', rows: timeRows.slice(0, 10) }]
      );
      break;
    }

    // ── Time ──────────────────────────────────────────────────────────────────
    case STATE.BOOKING_TIME: {
      const sel = listId;
      if (!sel?.startsWith('slot_')) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى اختيار الوقت من القائمة 👆' : 'Please select a time from the list 👆');
        return;
      }
      const timeVal     = sel.replace('slot_', '');
      const [hh, mm]    = timeVal.split(':').map(Number);
      const slotDate    = new Date(2000, 0, 1, hh, mm);
      const timeDisplay = formatTimeDisplay(slotDate, isAr);
      const doctorName  = isAr ? data.doctor.name_ar : data.doctor.name_en;
      const procName    = isAr ? data.procedure.name_ar : data.procedure.name_en;

      setState(to, { ...userState, state: STATE.BOOKING_CONFIRM, data: { ...data, time: timeVal, timeDisplay } });
      await sendInteractiveButtons(to, phoneNumberId,
        isAr
          ? `📋 *ملخص الحجز*\n\n👤 ${data.name}\n🦷 ${procName}\n👨‍⚕️ ${doctorName}\n📅 ${data.dateDisplay}\n🕐 ${timeDisplay}\n\nتأكيد الموعد؟`
          : `📋 *Booking Summary*\n\n👤 ${data.name}\n🦷 ${procName}\n👨‍⚕️ ${doctorName}\n📅 ${data.dateDisplay}\n🕐 ${timeDisplay}\n\nConfirm your appointment?`,
        [
          { id: 'confirm_yes', title: isAr ? '✅ تأكيد' : '✅ Confirm' },
          { id: 'confirm_no',  title: isAr ? '❌ إلغاء' : '❌ Cancel'  },
        ]
      );
      break;
    }

    // ── Confirm ───────────────────────────────────────────────────────────────
    case STATE.BOOKING_CONFIRM: {
      if (buttonId === 'confirm_yes') {
        const result = await createAppointment({
          patientName:  data.name,
          patientPhone: to,
          doctorName:   isAr ? data.doctor.name_ar : data.doctor.name_en,
          date:         data.date,
          time:         data.time,
          procedure:    data.procedure,
        });
        if (result.success) {
          const booking = {
            doctor:      data.doctor,
            procedure:   data.procedure,
            dateDisplay: data.dateDisplay,
            time:        data.time,
            timeDisplay: data.timeDisplay,
          };
          setState(to, { ...userState, state: STATE.REGISTRATION, data: { ...data, booking, regStep: null, awaitingCPR: false } });
          const doctorLine = data.anyDoctor
            ? ''
            : (isAr ? `\n👨‍⚕️ ${data.doctor.name_ar}` : `\n👨‍⚕️ ${data.doctor.name_en}`);
          await sendText(to, phoneNumberId,
            isAr
              ? `✅ *تم تأكيد الموعد!*\n\n👤 ${data.name}${doctorLine}\n🦷 ${data.procedure.name_ar}\n📅 ${data.dateDisplay} - 🕐 ${data.timeDisplay}`
              : `✅ *Appointment Confirmed!*\n\n👤 ${data.name}${doctorLine}\n🦷 ${data.procedure.name_en}\n📅 ${data.dateDisplay} - 🕐 ${data.timeDisplay}`
          );
          await sendRegistrationRequest(to, phoneNumberId, lang);
        } else {
          cancelTimeout(to); clearState(to);
          await sendText(to, phoneNumberId,
            isAr ? `عذراً، حدث خطأ 😔\nيرجى الاتصال بنا: ${config.clinic.phone}` : `Sorry, an error occurred 😔\nPlease call us: ${config.clinic.phone}`
          );
        }
      } else {
        cancelTimeout(to); clearState(to);
        await sendText(to, phoneNumberId, isAr ? '👍 تم الإلغاء.' : '👍 Cancelled.');
        await sendMainMenu(to, phoneNumberId, lang);
      }
      break;
    }
  }
}

async function sendDateList(to, phoneNumberId, isAr, dates) {
  const arabicDays   = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const englishDays  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const arabicMonths = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

  const rows = dates.map(dateStr => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt  = new Date(y, m - 1, d);
    const day = dt.getDay();
    return {
      id:    `date_${dateStr}`,
      title: isAr
        ? `${arabicDays[day]} ${d} ${arabicMonths[m - 1]}`
        : `${englishDays[day]} ${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}`,
    };
  });

  await sendList(to, phoneNumberId,
    isAr ? 'اختر التاريخ' : 'Choose Date',
    isAr ? 'اختر التاريخ المناسب:' : 'Select your preferred date:',
    isAr ? 'اختر' : 'Select',
    [{ title: isAr ? 'المواعيد المتاحة' : 'Available Dates', rows }]
  );
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
      cancelTimeout(from); clearState(from);
      await sendMainMenu(from, phoneNumberId, detectedLang);
      return;
    }
  }

  const { lang, state } = userState;
  const isAr     = lang === 'ar';
  const text     = message.type === 'text' ? message.text?.body?.trim() : null;
  const buttonId = message.interactive?.button_reply?.id;

  if (state !== STATE.IDLE) scheduleTimeout(from, phoneNumberId, lang);

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
