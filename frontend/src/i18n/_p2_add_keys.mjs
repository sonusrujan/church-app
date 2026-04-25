/**
 * Phase 2 i18n migration — add missing keys to hi/ta/te/kn/ml locales
 */
import { readFileSync, writeFileSync } from "fs";

const LOCALES = ["hi", "ta", "te", "kn", "ml"];

const PHASE2_KEYS = {
  auth: {
    familyWhatCanYouDo: {
      hi: "आप क्या कर सकते हैं?",
      ta: "நீங்கள் என்ன செய்யலாம்?",
      te: "మీరు ఏమి చేయగలరు?",
      kn: "ನೀವು ಏನು ಮಾಡಬಹುದು?",
      ml: "നിങ്ങൾക്ക് എന്ത് ചെയ്യാൻ കഴിയും?",
    },
    familyTipContactHead: {
      hi: "अपने परिवार के मुखिया से संपर्क करें।",
      ta: "உங்கள் குடும்பத் தலைவரைத் தொடர்பு கொள்ளுங்கள்.",
      te: "మీ కుటుంబ పెద్దను సంప్రదించండి.",
      kn: "ನಿಮ್ಮ ಕುಟುಂಬದ ಮುಖ್ಯಸ್ಥರನ್ನು ಸಂಪರ್ಕಿಸಿ.",
      ml: "നിങ്ങളുടെ കുടുംബത്തലവനെ ബന്ധപ്പെടുക.",
    },
    familyTipContactAdmin: {
      hi: "अधिक सहायता के लिए अपने चर्च प्रशासक से संपर्क करें।",
      ta: "மேலும் உதவிக்கு உங்கள் சர்ச் நிர்வாகியைத் தொடர்பு கொள்ளுங்கள்.",
      te: "మరింత సహాయం కోసం మీ చర్చి నిర్వాహకుని సంప్రదించండి.",
      kn: "ಹೆಚ್ಚಿನ ಸಹಾಯಕ್ಕಾಗಿ ನಿಮ್ಮ ಚರ್ಚ್ ನಿರ್ವಾಹಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.",
      ml: "കൂടുതൽ സഹായത്തിന് നിങ്ങളുടെ ചർച്ച് അഡ്മിനിസ്ട്രേറ്ററെ ബന്ധപ്പെടുക.",
    },
    phoneInvalid10Digits: {
      hi: "फ़ोन नंबर ठीक 10 अंकों का होना चाहिए।",
      ta: "தொலைபேசி எண் சரியாக 10 இலக்கங்களாக இருக்க வேண்டும்.",
      te: "ఫోన్ నంబర్ సరిగ్గా 10 అంకెలు ఉండాలి.",
      kn: "ಫೋನ್ ಸಂಖ್ಯೆ ನಿಖರವಾಗಿ 10 ಅಂಕೆಗಳಾಗಿರಬೇಕು.",
      ml: "ഫോൺ നമ്പർ കൃത്യമായി 10 അക്കങ്ങൾ ആയിരിക്കണം.",
    },
    resendOtp: {
      hi: "OTP पुनः भेजें",
      ta: "OTP மீண்டும் அனுப்பு",
      te: "OTP మళ్ళీ పంపండి",
      kn: "OTP ಮರುಕಳಿಸಿ",
      ml: "OTP വീണ്ടും അയയ്ക്കുക",
    },
    resendOtpIn: {
      hi: "{{seconds}}s में OTP पुनः भेजें",
      ta: "{{seconds}}s இல் OTP மீண்டும் அனுப்பு",
      te: "{{seconds}}s లో OTP మళ్ళీ పంపండి",
      kn: "{{seconds}}s ನಲ್ಲಿ OTP ಮರುಕಳಿಸಿ",
      ml: "{{seconds}}s ൽ OTP വീണ്ടും അയയ്ക്കുക",
    },
  },
  join: {
    noCodeHint: {
      hi: "कोड नहीं है? अपने चर्च प्रशासक से पूछें।",
      ta: "குறியீடு இல்லையா? உங்கள் சர்ச் நிர்வாகியிடம் கேளுங்கள்.",
      te: "కోడ్ లేదా? మీ చర్చి నిర్వాహకుడిని అడగండి.",
      kn: "ಕೋಡ್ ಇಲ್ಲವೇ? ನಿಮ್ಮ ಚರ್ಚ್ ನಿರ್ವಾಹಕರನ್ನು ಕೇಳಿ.",
      ml: "കോഡ് ഇല്ലേ? നിങ്ങളുടെ ചർച്ച് അഡ്മിനിസ്ട്രേറ്ററോട് ചോദിക്കുക.",
    },
    exploreChurches: {
      hi: "चर्चें देखें",
      ta: "தேவாலயங்களை ஆராயுங்கள்",
      te: "చర్చిలను అన్వేషించండి",
      kn: "ಚರ್ಚ್‌ಗಳನ್ನು ಅನ್ವೇಷಿಸಿ",
      ml: "പള്ളികൾ പര്യവേക്ഷണം ചെയ്യുക",
    },
  },
  dashboard: {
    requestCancellation: {
      hi: "रद्द करने का अनुरोध करें",
      ta: "ரத்து கோரிக்கை",
      te: "రద్దు అభ్యర్థన",
      kn: "ರದ್ದತಿ ವಿನಂತಿ",
      ml: "റദ്ദാക്കൽ അഭ്യർത്ഥന",
    },
    cancelWarning: {
      hi: "सबमिट करने के बाद, आपके एडमिन रद्द करने के अनुरोध की समीक्षा करेंगे। अनुमोदन तक आपकी सदस्यता सक्रिय रहेगी।",
      ta: "சமர்ப்பித்த பிறகு, உங்கள் நிர்வாகி ரத்து கோரிக்கையை மதிப்பாய்வு செய்வார். ஏற்கப்படும் வரை உங்கள் சந்தா செயலில் இருக்கும்.",
      te: "సబ్మిట్ చేసిన తర్వాత, మీ అడ్మిన్ రద్దు అభ్యర్థనను సమీక్షిస్తారు. ఆమోదం వరకు మీ చందా చురుకుగా ఉంటుంది.",
      kn: "ಸಲ್ಲಿಸಿದ ನಂತರ, ನಿಮ್ಮ ನಿರ್ವಾಹಕರು ರದ್ದತಿ ವಿನಂತಿಯನ್ನು ಪರಿಶೀಲಿಸುತ್ತಾರೆ. ಅನುಮೋದನೆಯವರೆಗೆ ನಿಮ್ಮ ಚಂದಾ ಸಕ್ರಿಯವಾಗಿರುತ್ತದೆ.",
      ml: "സമർപ്പിച്ചതിനുശേഷം, നിങ്ങളുടെ അഡ്മിൻ റദ്ദാക്കൽ അഭ്യർത്ഥന അവലോകനം ചെയ്യും. അംഗീകാരം ലഭിക്കുന്നതുവരെ നിങ്ങളുടെ സബ്സ്ക്രിപ്ഷൻ സജീവമായിരിക്കും.",
    },
    selectSubscriptionsToPay: {
      hi: "भुगतान के लिए सदस्यता चुनें।",
      ta: "செலுத்த சந்தாக்களைத் தேர்ந்தெடுக்கவும்.",
      te: "చెల్లించడానికి చందాలను ఎంచుకోండి.",
      kn: "ಪಾವತಿಸಲು ಚಂದಾಗಳನ್ನು ಆಯ್ಕೆಮಾಡಿ.",
      ml: "പണമടയ്ക്കാൻ സബ്സ്ക്രിപ്ഷനുകൾ തിരഞ്ഞെടുക്കുക.",
    },
    noDueSubscriptions: {
      hi: "कोई बकाया सदस्यता नहीं।",
      ta: "நிலுவை சந்தாக்கள் இல்லை.",
      te: "బకాయి చందాలు లేవు.",
      kn: "ಬಾಕಿ ಚಂದಾಗಳಿಲ್ಲ.",
      ml: "കുടിശ്ശിക സബ്സ്ക്രിപ്ഷനുകൾ ഇല്ല.",
    },
    statusActive: {
      hi: "सक्रिय",
      ta: "செயலில்",
      te: "చురుకు",
      kn: "ಸಕ್ರಿಯ",
      ml: "സജീവം",
    },
    statusOverdue: {
      hi: "बकाया",
      ta: "தாமதம்",
      te: "బకాయి",
      kn: "ಬಾಕಿ",
      ml: "കുടിശ്ശിക",
    },
    statusPending: {
      hi: "लंबित",
      ta: "நிலுவையில்",
      te: "పెండింగ్",
      kn: "ಬಾಕಿ ಇರುವ",
      ml: "തീർപ്പാക്കാത്ത",
    },
  },
  events: {
    addToCalendar: {
      hi: "कैलेंडर में जोड़ें",
      ta: "நாட்காட்டியில் சேர்",
      te: "క్యాలెండర్‌కి జోడించు",
      kn: "ಕ್ಯಾಲೆಂಡರ್‌ಗೆ ಸೇರಿಸಿ",
      ml: "കലണ്ടറിലേക്ക് ചേർക്കുക",
    },
    markAllRead: {
      hi: "सभी पढ़ा गया",
      ta: "அனைத்தும் படிக்கப்பட்டதாக",
      te: "అన్నీ చదివినట్టు",
      kn: "ಎಲ್ಲಾ ಓದಿದ ಎಂದು",
      ml: "എല്ലാം വായിച്ചതായി",
    },
  },
  historyPage: {
    goToDashboard: {
      hi: "डैशबोर्ड पर जाएं",
      ta: "டாஷ்போர்டுக்குச் செல்",
      te: "డాష్‌బోర్డ్‌కి వెళ్ళు",
      kn: "ಡ್ಯಾಶ್‌ಬೋರ್ಡ್‌ಗೆ ಹೋಗಿ",
      ml: "ഡാഷ്ബോർഡിലേക്ക് പോകുക",
    },
    refundHint: {
      hi: "रिफंड के लिए, कृपया अपने चर्च प्रशासक से संपर्क करें।",
      ta: "பணத்திரும்பப்பெற, உங்கள் சர்ச் நிர்வாகியைத் தொடர்பு கொள்ளுங்கள்.",
      te: "రిఫండ్ కోసం, దయచేసి మీ చర్చి నిర్వాహకుడిని సంప్రదించండి.",
      kn: "ಮರುಪಾವತಿಗಾಗಿ, ದಯವಿಟ್ಟು ನಿಮ್ಮ ಚರ್ಚ್ ನಿರ್ವಾಹಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.",
      ml: "റീഫണ്ടിനായി, ദയവായി നിങ്ങളുടെ ചർച്ച് അഡ്മിനിസ്ട്രേറ്ററെ ബന്ധപ്പെടുക.",
    },
  },
  adminTabs: {
    familyRequests: {
      memberIdLabel: {
        hi: "सदस्य आईडी:",
        ta: "உறுப்பினர் ஐடி:",
        te: "సభ్యుడి ఐడి:",
        kn: "ಸದಸ್ಯ ಐಡಿ:",
        ml: "അംഗ ഐഡി:",
      },
      familyCountLabel: {
        hi: "परिवार के सदस्य:",
        ta: "குடும்ப உறுப்பினர்கள்:",
        te: "కుటుంబ సభ్యులు:",
        kn: "ಕುಟುಂಬ ಸದಸ್ಯರು:",
        ml: "കുടുംബാംഗങ്ങൾ:",
      },
    },
  },
};

// Also rename the "Notifications" → "Announcements" keys for non-en locales
const NOTIFICATION_RENAMES = {
  notificationsToggle: {
    hi: "घोषणाएँ",
    ta: "அறிவிப்புகள்",
    te: "ప్రకటనలు",
    kn: "ಘೋಷಣೆಗಳು",
    ml: "അറിയിപ്പുകൾ",
  },
  newNotification: {
    hi: "नई घोषणा",
    ta: "புதிய அறிவிப்பு",
    te: "కొత్త ప్రకటన",
    kn: "ಹೊಸ ಘೋಷಣೆ",
    ml: "പുതിയ അറിയിപ്പ്",
  },
  editNotification: {
    hi: "घोषणा संपादित करें",
    ta: "அறிவிப்பைத் திருத்து",
    te: "ప్రకటన సవరించు",
    kn: "ಘೋಷಣೆ ಸಂಪಾದಿಸಿ",
    ml: "അറിയിപ്പ് എഡിറ്റ് ചെയ്യുക",
  },
  createNotification: {
    hi: "घोषणा बनाएं",
    ta: "அறிவிப்பு உருவாக்கு",
    te: "ప్రకటన సృష్టించు",
    kn: "ಘೋಷಣೆ ರಚಿಸಿ",
    ml: "അറിയിപ്പ് സൃഷ്ടിക്കുക",
  },
  titlePlaceholderNotification: {
    hi: "महत्वपूर्ण घोषणा",
    ta: "முக்கிய அறிவிப்பு",
    te: "ముఖ్యమైన ప్రకటన",
    kn: "ಮಹತ್ವದ ಘೋಷಣೆ",
    ml: "പ്രധാന അറിയിപ്പ്",
  },
  noNotificationsYet: {
    hi: "अभी तक कोई घोषणा नहीं।",
    ta: "இதுவரை அறிவிப்புகள் இல்லை.",
    te: "ఇంకా ప్రకటనలు లేవు.",
    kn: "ಇನ್ನೂ ಘೋಷಣೆಗಳಿಲ್ಲ.",
    ml: "ഇതുവരെ അറിയിപ്പുകളൊന്നുമില്ല.",
  },
  successNotificationCreated: {
    hi: "घोषणा बनाई गई।",
    ta: "அறிவிப்பு உருவாக்கப்பட்டது.",
    te: "ప్రకటన సృష్టించబడింది.",
    kn: "ಘೋಷಣೆ ರಚಿಸಲಾಗಿದೆ.",
    ml: "അറിയിപ്പ് സൃഷ്ടിച്ചു.",
  },
  successNotificationUpdated: {
    hi: "घोषणा अपडेट की गई।",
    ta: "அறிவிப்பு புதுப்பிக்கப்பட்டது.",
    te: "ప్రకటన నవీకరించబడింది.",
    kn: "ಘೋಷಣೆ ನವೀಕರಿಸಲಾಗಿದೆ.",
    ml: "അറിയിപ്പ് അപ്ഡേറ്റ് ചെയ്തു.",
  },
  successNotificationDeleted: {
    hi: "घोषणा हटाई गई।",
    ta: "அறிவிப்பு நீக்கப்பட்டது.",
    te: "ప్రకటన తొలగించబడింది.",
    kn: "ಘೋಷಣೆ ಅಳಿಸಲಾಗಿದೆ.",
    ml: "അറിയിപ്പ് ഇല്ലാതാക്കി.",
  },
  confirmDeleteNotification: {
    hi: "क्या आप इस घोषणा को हटाना चाहते हैं?",
    ta: "இந்த அறிவிப்பை நீக்க வேண்டுமா?",
    te: "ఈ ప్రకటనను తొలగించాలనుకుంటున్నారా?",
    kn: "ಈ ಘೋಷಣೆ ಅಳಿಸಬೇಕೇ?",
    ml: "ഈ അറിയിപ്പ് ഇല്ലാതാക്കണോ?",
  },
};

function setNested(obj, path, value) {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!cur[keys[i]]) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

for (const locale of LOCALES) {
  const filePath = new URL(`./${locale}.json`, import.meta.url).pathname;
  const json = JSON.parse(readFileSync(filePath, "utf-8"));

  // Add Phase 2 keys
  for (const [section, keys] of Object.entries(PHASE2_KEYS)) {
    for (const [key, translations] of Object.entries(keys)) {
      if (typeof translations === "object" && translations[locale] !== undefined) {
        setNested(json, `${section}.${key}`, translations[locale]);
      } else {
        // Nested (e.g. adminTabs.familyRequests.memberIdLabel)
        for (const [subKey, subTranslations] of Object.entries(translations)) {
          if (typeof subTranslations === "object" && subTranslations[locale] !== undefined) {
            setNested(json, `${section}.${key}.${subKey}`, subTranslations[locale]);
          }
        }
      }
    }
  }

  // Rename notification labels to announcement labels
  if (json.adminTabs?.events) {
    for (const [key, translations] of Object.entries(NOTIFICATION_RENAMES)) {
      if (translations[locale]) {
        json.adminTabs.events[key] = translations[locale];
      }
    }
  }

  writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n", "utf-8");
  console.log(`✓ ${locale}.json updated`);
}

console.log("Done — Phase 2 i18n keys added to all locales.");
