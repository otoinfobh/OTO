const { sendText, sendInteractiveButtons, sendList } = require('./whatsapp');
const { getState, setState, clearState, STATE } = require('./state');
const { getClaudeResponse, scanCPRMedia } = require('./claude');
const { createAppointment, getAvailableSlots, getAvailableDates, findSoonestSlot, findBestDoctor, findNextAppointment, formatTime, formatTimeDisplay } = require('./calendar');
const { deleteEvent } = require('./reminders');
const config = require('./config');

function detectLanguage(text) {
  return /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en';
}

// Format HH:MM string directly to 12h display — no Date object, no timezone issues
function formatTimeDisplay12(h, m, isAr) {
  const h12 = h % 12 || 12;
  const pad  = String(m).padStart(2, '0');
  if (isAr) {
    const toAr   = n => String(n).split('').map(c => '٠١٢٣٤٥٦٧٨٩'[c] ?? c).join('');
    const period = h < 12 ? 'صباحاً' : 'مساءً';
    return `${toAr(h12)}:${toAr(pad)} ${period}`;
  }
  return `${h12}:${pad} ${h < 12 ? 'AM' : 'PM'}`;
}

const GREETINGS   = ['hi', 'hello', 'hey', 'menu', 'مرحبا', 'هاي', 'السلام', 'أهلاً', 'اهلا', 'مرحباً', 'مساء', 'صباح', 'هلا'];
const RESET_WORDS = [
  'reset', 'cancel', 'start', 'menu',
  'إلغاء', 'الغاء', 'رجوع', 'مسح', 'ابدأ',
  'العود', 'ارجع', 'رجع', 'بالبداية', 'من البداية',
  'لا ابي', 'ما ابي', 'مالي رجعني', 'مالي', 'خلاص',
  'وقفت', 'اوقف', 'قف', 'بطل', 'بطلت', 'بغيت موعد',
];

// ── 30-min inactivity timeout ─────────────────────────────────────────────────
const TIMEOUT_MS = 30 * 60 * 1000;
const timeouts   = new Map();
const cprTimers  = new Map();

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

async function notifyStaff(patientPhone, phoneNumberId, lastMessage, reason, isAr) {
  const clinicPhone = config.clinic.notifyPhone || config.clinic.phone;
  const msg = `⚠️ *تصعيد إلى الموظفين*

📞 رقم المريض: +${patientPhone}
❓ السبب: ${reason}
💬 آخر رسالة: "${lastMessage.slice(0, 200)}"`;
  const { sendText: notify } = require('./whatsapp');
  await notify(clinicPhone, phoneNumberId, msg);
}

async function processCPRMedia(to, phoneNumberId, userState, mediaIds) {
  const { lang, data } = userState;
  const isAr = lang === 'ar';
  // Lock so no further images trigger processing
  setState(to, { ...userState, data: { ...data, awaitingCPR: false, cprMediaIds: [] } });
  try {
    const extracted = await scanCPRMedia(mediaIds);
    // Re-check slot is still free before booking (race condition guard)
    const reCheckSlots = await getAvailableSlots(data.booking?.doctor?.id, data.booking?.date, data.booking?.procedure?.duration);
    const stillFree = reCheckSlots.some(s => formatTime(s) === data.booking?.time);
    if (!stillFree) {
      clearState(to);
      await sendText(to, phoneNumberId,
        isAr
          ? `⚠️ عذراً، تم حجز هذا الموعد للتو من شخص آخر 😔
يرجى بدء حجز جديد واختيار وقت آخر.`
          : `⚠️ Sorry, this slot was just taken by someone else 😔
Please start a new booking and choose a different time.`
      );
      return;
    }
    const calResultCpr = await createAppointment({
      patientName:  extracted.fullName || 'Patient',
      patientPhone: to,
      doctorId:     data.booking?.doctor?.id,
      doctorName:   isAr ? data.booking?.doctor?.name_ar : data.booking?.doctor?.name_en,
      date:         data.booking?.date,
      time:         data.booking?.time,
      procedure:    data.booking?.procedure,
      patientInfo:  { ...extracted, phone: to },
    });
    await notifyClinic({ ...extracted, phone: to }, data.booking, lang);
    cancelTimeout(to); clearState(to);
    if (!calResultCpr.success) {
      await sendText(to, phoneNumberId,
        isAr
          ? '⚠️ تم تسجيل بياناتك لكن حدث خطأ في الحجز، سنتواصل معك لتأكيد الموعد.'
          : '⚠️ Info saved but a calendar error occurred, we\'ll contact you to confirm.'
      );
      return;
    }
    await sendText(to, phoneNumberId,
      isAr
        ? `✅ *تم تأكيد موعدك وتسجيلك!*

👤 ${extracted.fullName || '-'}
🦷 ${data.booking?.procedure?.name_ar || ''}
📅 ${data.booking?.dateDisplay || ''} - 🕐 ${data.booking?.timeDisplay || ''}

نراك قريباً 😊`
        : `✅ *Appointment confirmed and registration complete!*

👤 ${extracted.fullName || '-'}
🦷 ${data.booking?.procedure?.name_en || ''}
📅 ${data.booking?.dateDisplay || ''} - 🕐 ${data.booking?.timeDisplay || ''}

See you soon! 😊`
    );
  } catch (err) {
    console.error('CPR scan error:', err.message);
    await sendText(to, phoneNumberId,
      isAr
        ? '⚠️ ما قدرت أقرأ البطاقة، حاول مجدداً أو اختر إدخال يدوي.'
        : '⚠️ Could not read the card. Try again or enter manually.'
    );
  }
}

async function handleRegistration(to, phoneNumberId, message, userState) {
  const { lang, data } = userState;
  const isAr     = lang === 'ar';
  const text     = message.type === 'text' ? message.text?.body?.trim() : null;
  const buttonId = message.interactive?.button_reply?.id;

  // Handle image or PDF when awaiting CPR
  const isMediaMessage = (message.type === 'image' || message.type === 'document') && data.awaitingCPR;
  if (isMediaMessage) {
    const mediaId = message.type === 'image' ? message.image?.id : message.document?.id;
    if (!mediaId) return;

    const existingMedia = data.cprMediaIds || [];

    if (existingMedia.length === 0) {
      // First media — store it, wait 10 seconds for a second one
      setState(to, { ...userState, data: { ...data, cprMediaIds: [mediaId] } });
      await sendText(to, phoneNumberId,
        isAr ? '⏳ جاري قراءة بطاقتك...' : '⏳ Reading your CPR card...'
      );
      const t = setTimeout(async () => {
        cprTimers.delete(to);
        const freshState = getState(to);
        if (freshState.data?.cprMediaIds?.length > 0 && freshState.data?.awaitingCPR) {
          await processCPRMedia(to, phoneNumberId, freshState, freshState.data.cprMediaIds);
        }
      }, 10000);
      cprTimers.set(to, t);
    } else {
      // Second media arrived — cancel timer, process both immediately
      if (cprTimers.has(to)) { clearTimeout(cprTimers.get(to)); cprTimers.delete(to); }
      setState(to, { ...userState, data: { ...data, cprMediaIds: [...existingMedia, mediaId] } });
      const freshState = getState(to);
      await processCPRMedia(to, phoneNumberId, freshState, freshState.data.cprMediaIds);
    }
    return;
  }

  if (buttonId === 'reg_manual') {
    setState(to, { ...userState, state: STATE.REGISTRATION, data: { ...data, regStep: 'waiting', awaitingCPR: false } });
    await sendText(to, phoneNumberId,
      isAr
        ? `أرسل بياناتك بهذا الترتيب (كل معلومة في سطر):\n\nالاسم الكامل\nالرقم الشخصي (CPR)\nتاريخ الميلاد\nالجنسية`
        : `Please send your details in this order (one per line):\n\nFull Name\nCPR Number\nDate of Birth\nNationality`
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
    // Re-check slot is still free before booking (race condition guard)
    const reCheckSlotsM = await getAvailableSlots(data.booking?.doctor?.id, data.booking?.date, data.booking?.procedure?.duration);
    const stillFreeM = reCheckSlotsM.some(s => formatTime(s) === data.booking?.time);
    if (!stillFreeM) {
      clearState(to);
      await sendText(to, phoneNumberId,
        isAr
          ? `⚠️ عذراً، تم حجز هذا الموعد للتو من شخص آخر 😔
يرجى بدء حجز جديد واختيار وقت آخر.`
          : `⚠️ Sorry, this slot was just taken by someone else 😔
Please start a new booking and choose a different time.`
      );
      return;
    }
    const calResult = await createAppointment({
      patientName:  patientInfo.fullName,
      patientPhone: to,
      doctorId:     data.booking?.doctor?.id,
      doctorName:   isAr ? data.booking?.doctor?.name_ar : data.booking?.doctor?.name_en,
      date:         data.booking?.date,
      time:         data.booking?.time,
      procedure:    data.booking?.procedure,
      patientInfo,
    });
    await notifyClinic(patientInfo, data.booking, lang);
    cancelTimeout(to); clearState(to);
    if (!calResult.success) {
      await sendText(to, phoneNumberId,
        isAr ? `⚠️ تم تسجيل بياناتك لكن حدث خطأ في الحجز، سنتواصل معك لتأكيد الموعد.` : `⚠️ Info saved but a calendar error occurred, we will contact you to confirm.`
      );
      return;
    }
    await sendText(to, phoneNumberId,
      isAr
        ? `✅ *تم تأكيد موعدك وتسجيلك!*\n\n👤 ${patientInfo.fullName}\n🦷 ${data.booking?.procedure?.name_ar || ''}\n📅 ${data.booking?.dateDisplay || ''} - 🕐 ${data.booking?.timeDisplay || ''}\n\nنراك قريباً 😊`
        : `✅ *Appointment confirmed and registration complete!*\n\n👤 ${patientInfo.fullName}\n🦷 ${data.booking?.procedure?.name_en || ''}\n📅 ${data.booking?.dateDisplay || ''} - 🕐 ${data.booking?.timeDisplay || ''}\n\nSee you soon! 😊`
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
        const stuckCount = (data.stuckCount || 0) + 1;
        setState(to, { ...userState, data: { ...data, stuckCount } });
        if (stuckCount >= 2) {
          setState(to, { ...userState, data: { ...data, stuckCount: 0 } });
          await sendInteractiveButtons(to, phoneNumberId,
            isAr ? 'يبدو إنك تريد الخروج من الحجز. ماذا تريد؟' : 'Looks like you want to exit. What would you like to do?',
            [
              { id: 'stuck_exit',     title: isAr ? '❌ إلغاء الحجز'   : '❌ Cancel Booking' },
              { id: 'stuck_continue', title: isAr ? '↩️ متابعة الحجز' : '↩️ Continue'       },
            ]
          );
        } else {
          await sendText(to, phoneNumberId, isAr ? 'يرجى اختيار الوقت من القائمة 👆' : 'Please select a time from the list 👆');
        }
        return;
      }
      const timeVal     = sel.replace('slot_', '');
      const [hh, mm]    = timeVal.split(':').map(Number);
      const timeDisplay = formatTimeDisplay12(hh, mm, isAr);
      const doctorName  = isAr ? data.doctor.name_ar : data.doctor.name_en;
      const procName    = isAr ? data.procedure.name_ar : data.procedure.name_en;

      setState(to, { ...userState, state: STATE.BOOKING_CONFIRM, data: { ...data, time: timeVal, timeDisplay } });
      await sendInteractiveButtons(to, phoneNumberId,
        isAr
          ? `📋 *ملخص الحجز*\n\n🦷 ${procName}\n👨‍⚕️ ${doctorName}\n📅 ${data.dateDisplay}\n🕐 ${timeDisplay}`
          : `📋 *Booking Summary*\n\n🦷 ${procName}\n👨‍⚕️ ${doctorName}\n📅 ${data.dateDisplay}\n🕐 ${timeDisplay}`,
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
        const booking = {
          doctor:      data.doctor,
          procedure:   data.procedure,
          dateDisplay: data.dateDisplay,
          date:        data.date,
          time:        data.time,
          timeDisplay: data.timeDisplay,
        };

        // If rescheduling — skip registration, use stored patient info
        if (data.isReschedule && data.patientInfo) {
          const patientInfo = data.patientInfo;
          const reCheckR = await getAvailableSlots(data.doctor.id, data.date, data.procedure?.duration);
          const stillFreeR = reCheckR.some(s => formatTime(s) === data.time);
          if (!stillFreeR) {
            clearState(to);
            await sendText(to, phoneNumberId,
              isAr
                ? '⚠️ عذراً، تم حجز هذا الموعد للتو. يرجى بدء حجز جديد.'
                : '⚠️ Sorry, this slot was just taken. Please start a new booking.'
            );
            return;
          }
          const calR = await createAppointment({
            patientName:  patientInfo.fullName,
            patientPhone: to,
            doctorId:     data.doctor.id,
            doctorName:   isAr ? data.doctor.name_ar : data.doctor.name_en,
            date:         data.date,
            time:         data.time,
            procedure:    data.procedure,
            patientInfo,
          });
          await notifyClinic(patientInfo, { ...booking, doctor: data.doctor }, lang);
          cancelTimeout(to); clearState(to);
          await sendText(to, phoneNumberId,
            isAr
              ? `✅ *تم تأكيد موعدك الجديد!*

👤 ${patientInfo.fullName}
📅 ${data.dateDisplay} - 🕐 ${data.timeDisplay}

نراك قريباً 😊`
              : `✅ *New appointment confirmed!*

👤 ${patientInfo.fullName}
📅 ${data.dateDisplay} - 🕐 ${data.timeDisplay}

See you soon! 😊`
          );
          return;
        }

        setState(to, { ...userState, state: STATE.REGISTRATION, data: { ...data, booking, regStep: null, awaitingCPR: false } });
        await sendRegistrationRequest(to, phoneNumberId, lang);
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
    if (RESET_WORDS.some(w => lower.includes(w))) {
      cancelTimeout(from); clearState(from);
      await sendMainMenu(from, phoneNumberId, detectedLang);
      return;
    }
  }

  const { lang, state } = userState;
  const isAr     = lang === 'ar';
  const text     = message.type === 'text' ? message.text?.body?.trim() : null;
  const buttonId = message.interactive?.button_reply?.id;

  // ── Reminder response handling ──────────────────────────────────────────────
  const reminder = userState.reminderPending;
  if (reminder) {
    // Patient types cancel
    if (text) {
      const lower = text.toLowerCase().trim();
      if (['cancel', 'إلغاء', 'الغاء', 'يلغي', 'الغي', 'كنسل'].includes(lower)) {
        await deleteEvent(reminder.calendarId, reminder.eventId);
        setState(from, { ...userState, reminderPending: null });
        // Notify clinic
        const { sendText: notify } = require('./whatsapp');
        await notify(config.clinic.notifyPhone || config.clinic.phone, phoneNumberId,
          `❌ *تم إلغاء موعد*

${reminder.summary}
📅 ${reminder.dateDisplay} - 🕐 ${reminder.timeDisplay}
📞 ${from}`
        );
        await sendText(from, phoneNumberId,
          isAr
            ? '✅ تم إلغاء موعدك. نأمل أن نراك قريباً 😊'
            : '✅ Your appointment has been cancelled. Hope to see you soon 😊'
        );
        await sendMainMenu(from, phoneNumberId, lang);
        return;
      }
    }

    // Confirm button
    if (buttonId === 'reminder_confirm') {
      setState(from, { ...userState, reminderPending: null });
      await sendText(from, phoneNumberId,
        isAr ? 'ممتاز! نراك غداً 😊🦷' : 'Great! See you tomorrow 😊🦷'
      );
      return;
    }

    // Reschedule button — delete old appointment, restart booking from doctor selection
    if (buttonId === 'reminder_reschedule') {
      await deleteEvent(reminder.calendarId, reminder.eventId);
      // Notify clinic of cancellation
      const { sendText: notify } = require('./whatsapp');
      await notify(config.clinic.notifyPhone || config.clinic.phone, phoneNumberId,
        `🔄 *طلب تغيير موعد*

${reminder.summary}
📅 ${reminder.dateDisplay} - 🕐 ${reminder.timeDisplay}
📞 ${from}`
      );
      // Find procedure from old event summary or use a blank procedure
      // Match procedure from stored name back to config
      const matchedProcedure = config.procedures.find(p =>
        p.name_en === reminder.procedureName || p.name_ar === reminder.procedureName
      ) || config.procedures[0];

      setState(from, {
        ...userState,
        reminderPending: null,
        state: STATE.BOOKING_DOCTOR,
        data: {
          isReschedule: true,
          patientInfo:  reminder.patientInfo,
          procedure:    matchedProcedure,
        }
      });
      await sendText(from, phoneNumberId,
        isAr ? '🔄 تم إلغاء موعدك القديم. اختر الطبيب للموعد الجديد:' : '🔄 Old appointment cancelled. Choose a doctor for your new appointment:'
      );
      // Show doctor list
      const rows = [
        { id: 'doctor_any', title: isAr ? '👨‍⚕️ أي دكتور متاح' : '👨‍⚕️ Any available doctor' },
        ...config.doctors.map(d => ({ id: `doctor_${d.id}`, title: isAr ? d.name_ar : d.name_en })),
      ];
      const { sendList } = require('./whatsapp');
      await sendList(from, phoneNumberId,
        isAr ? 'اختر الطبيب' : 'Choose Doctor',
        isAr ? 'مع أي طبيب تفضل؟' : 'Which doctor do you prefer?',
        isAr ? 'اختر' : 'Select',
        [{ title: isAr ? 'الأطباء المتاحون' : 'Available Doctors', rows }]
      );
      return;
    }
  }


  // ── Stuck booking escape buttons ─────────────────────────────────────────────
  if (buttonId === 'stuck_exit') {
    cancelTimeout(from); clearState(from);
    await sendText(from, phoneNumberId, isAr ? '👍 تم إلغاء الحجز.' : '👍 Booking cancelled.');
    await sendMainMenu(from, phoneNumberId, lang);
    return;
  }
  if (buttonId === 'stuck_continue') {
    await sendText(from, phoneNumberId, isAr ? '↩️ يرجى الاختيار من القائمة 👆' : '↩️ Please select from the list above 👆');
    return;
  }

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
        setState(from, { ...userState, state: STATE.BOOKING_PROCEDURE, data: {} });
        scheduleTimeout(from, phoneNumberId, lang);
        await sendList(from, phoneNumberId,
          isAr ? 'اختر الإجراء' : 'Choose Procedure',
          isAr ? 'ما هو سبب زيارتك؟' : 'What brings you in today?',
          isAr ? 'اختر' : 'Select',
          [{ title: isAr ? 'الإجراءات المتاحة' : 'Available Procedures',
             rows: config.procedures.map(p => ({
               id:          `proc_${p.id}`,
               title:       isAr ? p.name_ar : p.name_en,
               description: `${p.price} BD - ${p.duration} min`,
             }))
          }]
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
            : `👨‍⚕️ Call us directly:\n📞 ${config.clinic.phone}\n\nOr we will get back to you shortly ✅`
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

    // Gibberish detection — if message has no recognisable words (all symbols/numbers/random)
    const hasWords = /[a-zA-Z؀-ۿ]{2,}/.test(text);
    if (!hasWords) {
      const gibberishCount = (userState.gibberishCount || 0) + 1;
      setState(from, { ...userState, gibberishCount });
      if (gibberishCount >= 2) {
        setState(from, { ...userState, gibberishCount: 0 });
        await notifyStaff(from, phoneNumberId, text, isAr ? 'رسائل غير مفهومة' : 'Gibberish messages', isAr);
        await sendText(from, phoneNumberId,
          isAr
            ? 'عذراً، ما فهمت رسالتك. سيتواصل معك أحد من فريقنا قريباً 😊'
            : 'Sorry, I could not understand your message. Someone from our team will contact you shortly 😊'
        );
        return;
      }
      await sendText(from, phoneNumberId,
        isAr ? 'عذراً، ما فهمت. ممكن توضح أكثر؟' : 'Sorry, I did not understand. Could you clarify?'
      );
      return;
    }

    // Long message — escalate to staff
    if (text.length > 1000) {
      await notifyStaff(from, phoneNumberId, text, isAr ? 'رسالة طويلة' : 'Long message', isAr);
      await sendText(from, phoneNumberId,
        isAr
          ? 'شكراً على رسالتك! سيتواصل معك أحد من فريقنا قريباً لمساعدتك 😊'
          : 'Thank you for your message! Someone from our team will contact you shortly 😊'
      );
      return;
    }

    // Track free text exchange count — escalate after 20
    const freeTextCount = (userState.freeTextCount || 0) + 1;
    setState(from, { ...userState, freeTextCount });
    if (freeTextCount >= 20) {
      setState(from, { ...userState, freeTextCount: 0 });
      await notifyStaff(from, phoneNumberId, text, isAr ? 'محادثة طويلة بدون حجز' : 'Long conversation without booking', isAr);
      await sendText(from, phoneNumberId,
        isAr
          ? 'يبدو إنك تحتاج مساعدة أكثر 😊 سيتواصل معك أحد من فريقنا قريباً.'
          : 'It seems you need more assistance 😊 Someone from our team will contact you shortly.'
      );
      return;
    }

    // Get Claude response
    const reply = await getClaudeResponse(text, lang);

    // Handle intents returned by Claude
    if (reply.includes('INTENT:CANCEL')) {
      // Check if patient has a reminder pending or just guide them
      setState(from, { ...userState, freeTextCount: 0 });
      await sendText(from, phoneNumberId,
        isAr
          ? 'لإلغاء موعدك، اكتب "إلغاء" وسنقوم بإلغاء أقرب موعد لك. أو تواصل معنا على ' + config.clinic.phone
          : 'To cancel your appointment, type "cancel" and we will cancel your next appointment. Or call us at ' + config.clinic.phone
      );
      return;
    }

    if (reply.includes('INTENT:RESCHEDULE')) {
      setState(from, { ...userState, freeTextCount: 0 });
      await sendText(from, phoneNumberId,
        isAr
          ? 'لتغيير موعدك، ستصلك رسالة تذكير قبل يوم من موعدك تتضمن خيار التغيير. أو تواصل معنا على ' + config.clinic.phone
          : 'To reschedule, you will receive a reminder the day before your appointment with a reschedule option. Or call us at ' + config.clinic.phone
      );
      return;
    }

    if (reply.includes('INTENT:NEXT_APPOINTMENT')) {
      setState(from, { ...userState, freeTextCount: 0 });
      await sendText(from, phoneNumberId, isAr ? '⏳ جاري البحث عن موعدك...' : '⏳ Looking up your appointment...');
      const result = await findNextAppointment(from);
      if (!result) {
        await sendText(from, phoneNumberId,
          isAr ? 'ما لقيت أي موعد قادم لك. هل تريد حجز موعد؟' : 'I could not find any upcoming appointment for you. Would you like to book one?'
        );
        await sendMainMenu(from, phoneNumberId, lang);
        return;
      }
      const { event, doctor } = result;
      const bh          = new Date(new Date(event.start.dateTime).getTime() + 3 * 60 * 60 * 1000);
      const dd          = String(bh.getUTCDate()).padStart(2, '0');
      const mm          = String(bh.getUTCMonth() + 1).padStart(2, '0');
      const yyyy        = bh.getUTCFullYear();
      const h           = bh.getUTCHours();
      const min         = String(bh.getUTCMinutes()).padStart(2, '0');
      const h12         = h % 12 || 12;
      const period      = isAr ? (h < 12 ? 'صباحاً' : 'مساءً') : (h < 12 ? 'AM' : 'PM');
      const timeDisplay = isAr
        ? `${String(h12).split('').map(c=>'٠١٢٣٤٥٦٧٨٩'[c]??c).join('')}:${String(min).split('').map(c=>'٠١٢٣٤٥٦٧٨٩'[c]??c).join('')} ${period}`
        : `${h12}:${min} ${period}`;
      const dateDisplay = `${dd}/${mm}/${yyyy}`;
      const doctorName  = isAr ? doctor.name_ar : doctor.name_en;
      await sendText(from, phoneNumberId,
        isAr
          ? `📅 *موعدك القادم:*

👨‍⚕️ ${doctorName}
📅 ${dateDisplay}
🕐 ${timeDisplay}`
          : `📅 *Your next appointment:*

👨‍⚕️ ${doctorName}
📅 ${dateDisplay}
🕐 ${timeDisplay}`
      );
      setTimeout(() => sendMainMenu(from, phoneNumberId, lang), 800);
      return;
    }

    // Normal Claude reply
    await sendText(from, phoneNumberId, reply);
    setTimeout(() => sendMainMenu(from, phoneNumberId, lang), 1000);
    return;
  }

  await sendMainMenu(from, phoneNumberId, lang);
}

module.exports = { handleMessage };
