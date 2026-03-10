const { sendText, sendInteractiveButtons, sendList } = require('./whatsapp');
const { getState, setState, clearState, STATE } = require('./state');
const { getClaudeResponse } = require('./claude');
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
      setState(to, { ...userState, state: STATE.BOOKING_DATE, data: { ...data, doctor } });
      await sendText(to, phoneNumberId,
        isAr
          ? `ممتاز! اخترت ${doctor.name_ar} 👍\n\nيرجى كتابة التاريخ المفضل:\n*DD/MM/YYYY*\nمثال: 20/03/2026`
          : `Great choice! ${doctor.name_en} 👍\n\nPlease type your preferred date:\n*DD/MM/YYYY*\nExample: 20/03/2026`
      );
      break;
    }

    case STATE.BOOKING_DATE: {
      if (!text) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى كتابة التاريخ' : 'Please type the date');
        return;
      }
      const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!match) {
        await sendText(to, phoneNumberId,
          isAr ? '⚠️ صيغة غير صحيحة. يرجى الكتابة هكذا: DD/MM/YYYY' : '⚠️ Invalid format. Please use: DD/MM/YYYY'
        );
        return;
      }
      const formattedDate = `${match[3]}-${match[2]}-${match[1]}`;
      setState(to, { ...userState, state: STATE.BOOKING_TIME, data: { ...data, date: formattedDate, dateDisplay: text } });
      await sendList(to, phoneNumberId,
        isAr ? 'اختر الوقت' : 'Choose Time',
        isAr ? 'يرجى اختيار الوقت المناسب:' : 'Please select your preferred time:',
        isAr ? 'اختر الوقت' : 'Select Time',
        [{
          title: isAr ? 'الأوقات المتاحة' : 'Available Times',
          rows: [
            { id: 'time_07:00', title: '7:00 AM'  },
            { id: 'time_08:00', title: '8:00 AM'  },
            { id: 'time_09:00', title: '9:00 AM'  },
            { id: 'time_10:00', title: '10:00 AM' },
            { id: 'time_11:00', title: '11:00 AM' },
            { id: 'time_14:00', title: '2:00 PM'  },
            { id: 'time_15:00', title: '3:00 PM'  },
            { id: 'time_16:00', title: '4:00 PM'  },
            { id: 'time_17:00', title: '5:00 PM'  },
            { id: 'time_19:00', title: '7:00 PM'  },
          ]
        }]
      );
      break;
    }

    case STATE.BOOKING_TIME: {
      const timeSel = listId;
      if (!timeSel?.startsWith('time_')) {
        await sendText(to, phoneNumberId, isAr ? 'يرجى اختيار الوقت من القائمة 👆' : 'Please select a time from the list 👆');
        return;
      }
      const time = timeSel.replace('time_', '');
      setState(to, { ...userState, state: STATE.BOOKING_CONFIRM, data: { ...data, time } });
      const doctorName = isAr ? data.doctor.name_ar : data.doctor.name_en;
      await sendInteractiveButtons(to, phoneNumberId,
        isAr
          ? `📋 *ملخص الحجز*\n\n👤 الاسم: ${data.name}\n👨‍⚕️ الطبيب: ${doctorName}\n📅 التاريخ: ${data.dateDisplay}\n🕐 الوقت: ${time}\n\nهل تريد تأكيد الموعد؟`
          : `📋 *Booking Summary*\n\n👤 Name: ${data.name}\n👨‍⚕️ Doctor: ${doctorName}\n📅 Date: ${data.dateDisplay}\n🕐 Time: ${time}\n\nConfirm your appointment?`,
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
        clearState(to);
        if (result.success) {
          await sendText(to, phoneNumberId,
            isAr
              ? `✅ *تم تأكيد موعدك!*\n\n👤 ${data.name}\n👨‍⚕️ ${data.doctor.name_ar}\n📅 ${data.dateDisplay} - 🕐 ${data.time}\n\nسنرسل لك تذكيراً قبل الموعد. نراك قريباً 😊`
              : `✅ *Appointment Confirmed!*\n\n👤 ${data.name}\n👨‍⚕️ ${data.doctor.name_en}\n📅 ${data.dateDisplay} - 🕐 ${data.time}\n\nWe'll remind you before your appointment. See you soon! 😊`
          );
        } else {
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

  // Always update language from incoming text
  if (message.type === 'text') {
    const detectedLang = detectLanguage(message.text?.body || '');
    userState = { ...userState, lang: detectedLang };
    setState(from, userState);
  }

  const { lang, state } = userState;
  const isAr = lang === 'ar';
  const text = message.type === 'text' ? message.text?.body?.trim() : null;
  const buttonId = message.interactive?.button_reply?.id;

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
    const isGreeting = GREETINGS.some(g => lower.includes(g));

    if (isGreeting) {
      await sendMainMenu(from, phoneNumberId, lang);
      return;
    }

    // Send to Claude for intelligent response
    const reply = await getClaudeResponse(text, lang);
    await sendText(from, phoneNumberId, reply);
    return;
  }

  // Fallback for any other message type
  await sendMainMenu(from, phoneNumberId, lang);
}

module.exports = { handleMessage };
