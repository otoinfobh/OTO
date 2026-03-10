module.exports = {
  clinic: {
    name_ar:    'عيادة د.علي جواد لطب الأسنان',
    name_en:    'Dr.Ali Jawad Dental Clinic',
    location_ar:'زنج، البحرين',
    location_en:'Zinj, Bahrain',
    hours_ar:   'السبت - الخميس: ٧ صباحاً - ١٠ مساءً',
    hours_en:   'Sat - Thu: 7:00 AM - 10:00 PM',
    phone:      '+973 3300 0000',
    workDays:   [0,1,2,3,4,6], // 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri(off),6=Sat
    startHour:  7,
    endHour:    22,
  },
  doctors: [
    { id: '1', name_ar: 'د.علي جواد',     name_en: 'Dr.Ali Jawad',       senior: true  },
    { id: '2', name_ar: 'د.زينة الفاضل',  name_en: 'Dr.Zaina Alfadhel',  senior: false },
    { id: '3', name_ar: 'د.مريم الخباز',  name_en: 'Dr.Maryam Alkhabaz', senior: false },
    { id: '4', name_ar: 'د.حسن جابر',     name_en: 'Dr.Hasan Jaber',     senior: false },
  ],
  procedures: [
    { id: 'consult',  name_ar: 'كشف عام',          name_en: 'General Consultation', price: 15,  duration: 30,  seniorOnly: false },
    { id: 'cleaning', name_ar: 'تنظيف أسنان',       name_en: 'Teeth Cleaning',       price: 20,  duration: 30,  seniorOnly: false },
    { id: 'cavity',   name_ar: 'حشو تسوس',          name_en: 'Cavity Filling',        price: 20,  duration: 60,  seniorOnly: false },
    { id: 'root',     name_ar: 'علاج عصب',           name_en: 'Root Canal',            price: 95,  duration: 60,  seniorOnly: false },
    { id: 'wisdom',   name_ar: 'خلع ضرس العقل',     name_en: 'Wisdom Tooth Removal',  price: 80,  duration: 120, seniorOnly: false },
  ],
  // Keep services for the "Our Services" menu info
  services: [
    { name_ar: 'كشف عام',        name_en: 'General Consultation', price: 15 },
    { name_ar: 'تنظيف أسنان',    name_en: 'Teeth Cleaning',       price: 20 },
    { name_ar: 'حشو تسوس',       name_en: 'Cavity Filling',        price: 20 },
    { name_ar: 'علاج عصب',        name_en: 'Root Canal',            price: 95 },
    { name_ar: 'خلع ضرس العقل',  name_en: 'Wisdom Tooth Removal',  price: 80 },
  ],
};
