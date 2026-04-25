#!/usr/bin/env python3
"""Fill missing i18n keys in all language files using English as fallback."""
import json
import os

I18N_DIR = os.path.join(os.path.dirname(__file__), "src", "i18n")

def flatten(d, prefix=""):
    keys = {}
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            keys.update(flatten(v, key))
        else:
            keys[key] = v
    return keys

def set_nested(d, key_path, value):
    parts = key_path.split(".")
    for p in parts[:-1]:
        d = d.setdefault(p, {})
    d[parts[-1]] = value

en_path = os.path.join(I18N_DIR, "en.json")
en = json.load(open(en_path, encoding="utf-8"))
en_flat = flatten(en)

translations = {
    "hi": {
        "settings.deleteAccount": "मेरा खाता हटाएं",
        "settings.deleteAccountHint": "अपने खाते और डेटा को स्थायी रूप से हटाने का अनुरोध करें।",
        "settings.deleteRequestSent": "खाता हटाने का अनुरोध आपके चर्च एडमिन को भेजा गया।",
        "settings.deleteRequestFailed": "हटाने का अनुरोध विफल रहा। कृपया पुनः प्रयास करें।",
        "settings.deleteWarningTitle": "चेतावनी: इस कार्रवाई के गंभीर परिणाम हैं",
        "settings.deleteWarning1": "आपकी सभी सदस्यता रिकॉर्ड, भुगतान इतिहास और सदस्यता हटा दी जाएगी।",
        "settings.deleteWarning2": "सक्रिय सदस्यता तुरंत रद्द कर दी जाएगी।",
        "settings.deleteWarning3": "आपके खाते से जुड़े परिवार के सदस्य अनलिंक हो जाएंगे।",
        "settings.deleteWarning4": "एडमिन द्वारा स्वीकृत होने के बाद यह कार्रवाई पूर्ववत नहीं की जा सकती।",
        "settings.deleteAdminNote": "आपका अनुरोध आपके चर्च प्रशासक को समीक्षा के लिए भेजा जाएगा।",
        "settings.deleteReasonLabel": "हटाने का कारण (वैकल्पिक)",
        "settings.deleteReasonPlaceholder": "आप अपना खाता क्यों हटाना चाहते हैं?",
        "settings.confirmDeleteRequest": "हटाने का अनुरोध भेजें",
        "cookie.message": "यह ऐप प्रमाणीकरण और सत्र प्रबंधन के लिए आवश्यक कुकीज़ का उपयोग करता है।",
        "cookie.learnMore": "और जानें",
        "cookie.accept": "समझ गया",
        "admin.accountDeletionRequests": "खाता हटाना",
    },
    "te": {
        "settings.deleteAccount": "నా ఖాతాను తొలగించు",
        "settings.deleteAccountHint": "మీ ఖాతా మరియు డేటాను శాశ్వతంగా తొలగించమని అభ్యర్థించండి.",
        "settings.deleteRequestSent": "ఖాతా తొలగింపు అభ్యర్థన మీ చర్చి అడ్మిన్‌కు పంపబడింది.",
        "settings.deleteRequestFailed": "తొలగింపు అభ్యర్థన విఫలమైంది. దయచేసి మళ్ళీ ప్రయత్నించండి.",
        "settings.deleteWarningTitle": "హెచ్చరిక: ఈ చర్యకు తీవ్రమైన పరిణామాలు ఉన్నాయి",
        "settings.deleteWarning1": "మీ సభ్యత్వ రికార్డులు, చెల్లింపు చరిత్ర మరియు సబ్‌స్క్రిప్షన్‌లు శాశ్వతంగా తొలగించబడతాయి.",
        "settings.deleteWarning2": "సక్రియ సబ్‌స్క్రిప్షన్‌లు వెంటనే రద్దు చేయబడతాయి.",
        "settings.deleteWarning3": "మీ ఖాతాకు లింక్ చేయబడిన కుటుంబ సభ్యులు అన్‌లింక్ చేయబడతారు.",
        "settings.deleteWarning4": "అడ్మిన్ ఆమోదించిన తర్వాత ఈ చర్యను రద్దు చేయడం సాధ్యం కాదు.",
        "settings.deleteAdminNote": "మీ అభ్యర్థన సమీక్ష కోసం మీ చర్చి నిర్వాహకులకు పంపబడుతుంది.",
        "settings.deleteReasonLabel": "తొలగింపు కారణం (ఐచ్ఛికం)",
        "settings.deleteReasonPlaceholder": "మీరు మీ ఖాతాను ఎందుకు తొలగించాలనుకుంటున్నారు?",
        "settings.confirmDeleteRequest": "తొలగింపు అభ్యర్థన సమర్పించండి",
        "cookie.message": "ఈ యాప్ ప్రమాణీకరణ మరియు సెషన్ నిర్వహణ కోసం అవసరమైన కుకీలను ఉపయోగిస్తుంది.",
        "cookie.learnMore": "మరింత తెలుసుకోండి",
        "cookie.accept": "అర్థమైంది",
        "admin.accountDeletionRequests": "ఖాతా తొలగింపు",
    },
    "kn": {
        "settings.deleteAccount": "ನನ್ನ ಖಾತೆಯನ್ನು ಅಳಿಸಿ",
        "settings.deleteAccountHint": "ನಿಮ್ಮ ಖಾತೆ ಮತ್ತು ಡೇಟಾವನ್ನು ಶಾಶ್ವತವಾಗಿ ಅಳಿಸಲು ವಿನಂತಿಸಿ.",
        "settings.deleteRequestSent": "ಖಾತೆ ಅಳಿಸುವ ವಿನಂತಿಯನ್ನು ನಿಮ್ಮ ಚರ್ಚ್ ನಿರ್ವಾಹಕರಿಗೆ ಕಳುಹಿಸಲಾಗಿದೆ.",
        "settings.deleteRequestFailed": "ಅಳಿಸುವ ವಿನಂತಿ ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
        "settings.deleteWarningTitle": "ಎಚ್ಚರಿಕೆ: ಈ ಕ್ರಿಯೆಯ ಗಂಭೀರ ಪರಿಣಾಮಗಳಿವೆ",
        "settings.deleteWarning1": "ನಿಮ್ಮ ಎಲ್ಲಾ ಸದಸ್ಯತ್ವ ದಾಖಲೆಗಳು, ಪಾವತಿ ಇತಿಹಾಸ ಮತ್ತು ಚಂದಾದಾರಿಕೆಗಳು ಶಾಶ್ವತವಾಗಿ ತೆಗೆದುಹಾಕಲಾಗುತ್ತದೆ.",
        "settings.deleteWarning2": "ಸಕ್ರಿಯ ಚಂದಾದಾರಿಕೆಗಳನ್ನು ತಕ್ಷಣ ರದ್ದುಗೊಳಿಸಲಾಗುತ್ತದೆ.",
        "settings.deleteWarning3": "ನಿಮ್ಮ ಖಾತೆಗೆ ಲಿಂಕ್ ಮಾಡಲಾದ ಕುಟುಂಬ ಸದಸ್ಯರನ್ನು ಅನ್‌ಲಿಂಕ್ ಮಾಡಲಾಗುತ್ತದೆ.",
        "settings.deleteWarning4": "ನಿರ್ವಾಹಕರು ಅನುಮೋದಿಸಿದ ನಂತರ ಈ ಕ್ರಿಯೆಯನ್ನು ರದ್ದುಗೊಳಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.",
        "settings.deleteAdminNote": "ನಿಮ್ಮ ವಿನಂತಿಯನ್ನು ಪರಿಶೀಲನೆಗಾಗಿ ನಿಮ್ಮ ಚರ್ಚ್ ನಿರ್ವಾಹಕರಿಗೆ ಕಳುಹಿಸಲಾಗುತ್ತದೆ.",
        "settings.deleteReasonLabel": "ಅಳಿಸುವ ಕಾರಣ (ಐಚ್ಛಿಕ)",
        "settings.deleteReasonPlaceholder": "ನಿಮ್ಮ ಖಾತೆಯನ್ನು ಏಕೆ ಅಳಿಸಲು ಬಯಸುತ್ತೀರಿ?",
        "settings.confirmDeleteRequest": "ಅಳಿಸುವ ವಿನಂತಿಯನ್ನು ಸಲ್ಲಿಸಿ",
        "cookie.message": "ಈ ಅಪ್ಲಿಕೇಶನ್ ದೃಢೀಕರಣ ಮತ್ತು ಸೆಶನ್ ನಿರ್ವಹಣೆಗಾಗಿ ಅಗತ್ಯ ಕುಕೀಗಳನ್ನು ಬಳಸುತ್ತದೆ.",
        "cookie.learnMore": "ಹೆಚ್ಚು ತಿಳಿಯಿರಿ",
        "cookie.accept": "ಅರ್ಥವಾಯಿತು",
        "admin.accountDeletionRequests": "ಖಾತೆ ಅಳಿಸುವಿಕೆ",
    },
    "ml": {
        "settings.deleteAccount": "എന്റെ അക്കൗണ്ട് ഇല്ലാതാക്കുക",
        "settings.deleteAccountHint": "നിങ്ങളുടെ അക്കൗണ്ടും ഡാറ്റയും ശാശ്വതമായി ഇല്ലാതാക്കാൻ അഭ്യർത്ഥിക്കുക.",
        "settings.deleteRequestSent": "അക്കൗണ്ട് ഇല്ലാതാക്കൽ അഭ്യർത്ഥന നിങ്ങളുടെ ചർച്ച് അഡ്മിനിലേക്ക് അയച്ചു.",
        "settings.deleteRequestFailed": "ഇല്ലാതാക്കൽ അഭ്യർത്ഥന പരാജയപ്പെട്ടു. വീണ്ടും ശ്രമിക്കുക.",
        "settings.deleteWarningTitle": "മുന്നറിയിപ്പ്: ഈ പ്രവർത്തനത്തിന് ഗുരുതരമായ പ്രത്യാഘാതങ്ങളുണ്ട്",
        "settings.deleteWarning1": "നിങ്ങളുടെ എല്ലാ അംഗത്വ രേഖകളും, പേയ്‌മെന്റ് ചരിത്രവും, സബ്‌സ്‌ക്രിപ്‌ഷനുകളും ശാശ്വതമായി നീക്കം ചെയ്യപ്പെടും.",
        "settings.deleteWarning2": "സജീവ സബ്‌സ്‌ക്രിപ്‌ഷനുകൾ ഉടൻ റദ്ദാക്കപ്പെടും.",
        "settings.deleteWarning3": "നിങ്ങളുടെ അക്കൗണ്ടിലേക്ക് ലിങ്ക് ചെയ്ത കുടുംബാംഗങ്ങൾ അൺലിങ്ക് ചെയ്യപ്പെടും.",
        "settings.deleteWarning4": "അഡ്‌മിൻ അംഗീകരിച്ചാൽ ഈ പ്രവർത്തനം പഴയപടിയാക്കാൻ കഴിയില്ല.",
        "settings.deleteAdminNote": "അവലോകനത്തിനായി നിങ്ങളുടെ അഭ്യർത്ഥന ചർച്ച് അഡ്‌മിനിലേക്ക് അയയ്‌ക്കും.",
        "settings.deleteReasonLabel": "ഇല്ലാതാക്കാനുള്ള കാരണം (ഐച്ഛികം)",
        "settings.deleteReasonPlaceholder": "നിങ്ങളുടെ അക്കൗണ്ട് എന്തുകൊണ്ട് ഇല്ലാതാക്കണം?",
        "settings.confirmDeleteRequest": "ഇല്ലാതാക്കൽ അഭ്യർത്ഥന സമർപ്പിക്കുക",
        "cookie.message": "ഈ ആപ്പ് ആധികാരികതയ്ക്കും സെഷൻ മാനേജ്‌മെന്റിനും അത്യാവശ്യ കുക്കികൾ ഉപയോഗിക്കുന്നു.",
        "cookie.learnMore": "കൂടുതൽ അറിയുക",
        "cookie.accept": "മനസ്സിലായി",
        "admin.accountDeletionRequests": "അക്കൗണ്ട് ഇല്ലാതാക്കൽ",
    },
    "ta": {
        "settings.deleteAccount": "என் கணக்கை நீக்கு",
        "settings.deleteAccountHint": "உங்கள் கணக்கு மற்றும் தரவை நிரந்தரமாக நீக்க கோரிக்கை.",
        "settings.deleteRequestSent": "கணக்கு நீக்க கோரிக்கை உங்கள் தேவாலய நிர்வாகிக்கு அனுப்பப்பட்டது.",
        "settings.deleteRequestFailed": "நீக்க கோரிக்கை தோல்வியடைந்தது. மீண்டும் முயற்சிக்கவும்.",
        "settings.deleteWarningTitle": "எச்சரிக்கை: இந்த செயலுக்கு தீவிர விளைவுகள் உள்ளன",
        "settings.deleteWarning1": "உங்கள் அனைத்து உறுப்பினர் பதிவுகள், கட்டண வரலாறு மற்றும் சந்தாக்கள் நிரந்தரமாக நீக்கப்படும்.",
        "settings.deleteWarning2": "செயலில் உள்ள சந்தாக்கள் உடனடியாக ரத்து செய்யப்படும்.",
        "settings.deleteWarning3": "உங்கள் கணக்குடன் இணைக்கப்பட்ட குடும்ப உறுப்பினர்கள் இணைப்பு நீக்கப்படுவர்.",
        "settings.deleteWarning4": "நிர்வாகி அங்கீகரித்த பிறகு இந்த செயலை மாற்றியமைக்க முடியாது.",
        "settings.deleteAdminNote": "உங்கள் கோரிக்கை மதிப்பாய்வுக்காக உங்கள் தேவாலய நிர்வாகிக்கு அனுப்பப்படும்.",
        "settings.deleteReasonLabel": "நீக்குவதற்கான காரணம் (விருப்பத்திற்கு)",
        "settings.deleteReasonPlaceholder": "உங்கள் கணக்கை ஏன் நீக்க விரும்புகிறீர்கள்?",
        "settings.confirmDeleteRequest": "நீக்க கோரிக்கையை சமர்ப்பிக்கவும்",
        "cookie.message": "இந்த செயலி அங்கீகாரம் மற்றும் அமர்வு மேலாண்மைக்கு அத்தியாவசிய குக்கீகளைப் பயன்படுத்துகிறது.",
        "cookie.learnMore": "மேலும் அறிய",
        "cookie.accept": "புரிந்தது",
        "admin.accountDeletionRequests": "கணக்கு நீக்கம்",
    },
}

for lang in ["hi", "te", "kn", "ml", "ta"]:
    lang_path = os.path.join(I18N_DIR, f"{lang}.json")
    lang_data = json.load(open(lang_path, encoding="utf-8"))
    lang_flat = flatten(lang_data)
    missing = set(en_flat.keys()) - set(lang_flat.keys())

    native = translations.get(lang, {})
    added = 0
    for key in sorted(missing):
        val = native.get(key, en_flat[key])
        set_nested(lang_data, key, val)
        added += 1

    with open(lang_path, "w", encoding="utf-8") as f:
        json.dump(lang_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"{lang}: added {added} keys ({len([k for k in missing if k in native])} native)")

print("Done!")
