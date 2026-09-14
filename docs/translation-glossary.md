# Translation glossary

Fixed terms. The point of a glossary is not elegance, it is that "budget" is the
same word on the budget screen, in the settings list, and in the warning that
says you have gone over one. A user who meets three synonyms for their own money
stops trusting the app.

Anyone adding a language edits this file first, then the JSON.

## Rules that apply to every language

1. **Placeholders are code.** `{{amount}}`, `{{keep}}`, `{{folder}}` must survive
   exactly — same spelling, same braces. Move them anywhere in the sentence the
   grammar needs, but never translate or reformat them.
2. **Emoji stay.** They are the icon, not decoration.
3. **Product and format names stay in Latin script**, because that is how people
   say them and how they appear on the screens being described: Google Drive,
   Android, Wi-Fi, ZIP, JSON, CSV, SQLite, PDF, SHA-1, OAuth, UPI, GST.
4. **Currency codes stay** as INR, AED, PKR — never transliterate.
5. **Tone: plain and direct.** This app talks to a person about their own money.
   No officialese, no "kindly", no corporate register. Where English says "Your
   data, in your hands", the translation should sound like a person wrote it.
6. **Digits are 0-9** in every language. Decided deliberately — see the note in
   `src/domain/money.ts`.

## Core terms

| English | العربية | اردو |
|---|---|---|
| expense | مصروف | خرچ |
| expenses | المصروفات | اخراجات |
| income | الدخل | آمدنی |
| budget | الميزانية | بجٹ |
| category | الفئة | زمرہ |
| categories | الفئات | زمرہ جات |
| account | الحساب | اکاؤنٹ |
| transaction | المعاملة | لین دین |
| merchant / shop | المتجر | دکان |
| receipt (bill photo) | الإيصال | رسید |
| amount | المبلغ | رقم |
| balance | الرصيد | بیلنس |
| spent | المصروف | خرچ ہوا |
| remaining | المتبقي | باقی |
| recurring | متكرر | بار بار آنے والا |
| transfer | تحويل | منتقلی |
| note | ملاحظة | نوٹ |
| date | التاريخ | تاریخ |
| currency | العملة | کرنسی |
| report | التقرير | رپورٹ |
| backup (noun) | نسخة احتياطية | بیک اپ |
| back up (verb) | نسخ احتياطي | بیک اپ لینا |
| restore | استعادة | بحالی |
| export | تصدير | برآمد |
| import | استيراد | درآمد |
| settings | الإعدادات | ترتیبات |
| scan (a bill) | مسح | اسکین |
| save | حفظ | محفوظ کریں |
| delete | حذف | حذف کریں |
| cancel | إلغاء | منسوخ |
| folder | مجلد | فولڈر |
| snapshot | لقطة | اسنیپ شاٹ |

## Notes per language

**Arabic** — Modern Standard, Gulf-neutral. Avoid dialect. Use المتجر for a shop
rather than التاجر, which means the trader as a person.

**Urdu** — must read naturally to both Pakistani and Indian Urdu speakers, so
prefer common words over heavily Persianised or heavily Sanskritised registers.
Everyday loanwords people actually say (بیک اپ, اکاؤنٹ, بجٹ) are correct here;
inventing pure-Urdu equivalents nobody uses would be worse.

## Still to be reviewed

These files were produced by a machine translator working from this glossary.
The terminology is consistent and the grammar is sound, but **a native speaker
should read them before the app is published in that language** — particularly
the money and backup screens, where a misread sentence costs someone data or an
incorrect entry. Every string is in one JSON file per language, so a reviewer
needs no tooling and no access to the code.
