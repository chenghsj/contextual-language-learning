import type { LearningLanguage } from "@contextual/core";
/** Fixed authored sources. No speaker labels or audio: quoted/omitted roles stay uncertain. */
const normal: Record<LearningLanguage, string[]> = {
  en: [
    "Why are you still here?",
    "I was about to leave when you called.",
    "Can you wait a minute?",
    "Sure.",
  ],
  ja: [
    "まだここにいるの？",
    "電話が来たとき、出かけるところだった。",
    "少し待ってくれる？",
    "うん。",
  ],
  ko: [
    "아직 여기 있어요?",
    "전화가 왔을 때 막 나가려던 참이었어요.",
    "잠깐 기다려 줄 수 있어요?",
    "네.",
  ],
  es: [
    "¿Por qué sigues aquí?",
    "Estaba a punto de salir cuando llamaste.",
    "¿Puedes esperar un momento?",
    "Sí.",
  ],
  fr: [
    "Pourquoi es-tu encore là ?",
    "J’allais partir quand tu as appelé.",
    "Tu peux attendre un instant ?",
    "Oui.",
  ],
  de: [
    "Warum bist du noch hier?",
    "Ich wollte gerade losgehen, als du angerufen hast.",
    "Kannst du kurz warten?",
    "Ja.",
  ],
  it: [
    "Perché sei ancora qui?",
    "Stavo per uscire quando hai chiamato.",
    "Puoi aspettare un momento?",
    "Sì.",
  ],
  pt: [
    "Por que você ainda está aqui?",
    "Eu estava prestes a sair quando você ligou.",
    "Pode esperar um momento?",
    "Sim.",
  ],
  id: [
    "Kenapa kamu masih di sini?",
    "Aku baru mau pergi waktu kamu menelepon.",
    "Bisa tunggu sebentar?",
    "Bisa.",
  ],
  th: ["ทำไมยังอยู่ที่นี่", "กำลังจะออกไปตอนที่เธอโทรมา", "รอสักครู่ได้ไหม", "ได้"],
  ms: [
    "Kenapa kamu masih di sini?",
    "Saya baru hendak keluar ketika kamu menelefon.",
    "Boleh tunggu sebentar?",
    "Boleh.",
  ],
  vi: [
    "Sao bạn vẫn còn ở đây?",
    "Tôi đang định đi thì bạn gọi.",
    "Bạn chờ một chút được không?",
    "Được.",
  ],
  "zh-TW": ["你怎麼還在這裡？", "你打來的時候，我正要出門。", "可以等一下嗎？", "可以。"],
  "zh-CN": ["你怎么还在这里？", "你打来的时候，我正要出门。", "可以等一下吗？", "可以。"],
};
const risky: Record<LearningLanguage, string[]> = {
  en: [
    "Did Maya talk about the meeting?",
    "“Please tell me the time,” she said. Anyway, have you eaten?",
    "Not yet. What does [???] mean here?",
    "The caption is unclear.",
  ],
  ja: [
    "ミオ、集まりのことを話してた？",
    "「時間を教えて」って。ところで、もう食べた？",
    "まだ。ここにある「悪いない」って何？",
    "字幕がよくわからない。",
  ],
  ko: [
    "민수가 모임 이야기를 했어요?",
    "시간을 알려 달라고 했어요. 그런데 밥은 먹었어요? [???]",
    "아직요. 여기 [???]는 무슨 뜻이에요?",
    "자막이 분명하지 않아요.",
  ],
  es: [
    "¿Maya habló de la reunión?",
    "“Dime la hora”, dijo. Por cierto, ¿ya comiste? [???]",
    "Todavía no. ¿Qué significa [???] aquí?",
    "El subtítulo no está claro.",
  ],
  fr: [
    "Maya a parlé de la réunion ?",
    "« Dis-moi l’heure », a-t-elle dit. Au fait, tu as mangé ?",
    "Pas encore. Que veut dire [???] ici ?",
    "Le sous-titre n’est pas clair.",
  ],
  de: [
    "Hat Maya über das Treffen gesprochen?",
    "„Sag mir bitte die Uhrzeit“, sagte sie. Übrigens, hast du schon gegessen?",
    "Noch nicht. Was bedeutet hier [???]?",
    "Der Untertitel ist unklar.",
  ],
  it: [
    "Maya ha parlato della riunione?",
    "“Dimmi l’ora”, ha detto. A proposito, hai già mangiato?",
    "Non ancora. Che cosa significa [???] qui?",
    "Il sottotitolo non è chiaro.",
  ],
  pt: [
    "Maya falou sobre a reunião?",
    "“Diga a hora”, ela disse. A propósito, você já comeu?",
    "Ainda não. O que significa [???] aqui?",
    "A legenda não está clara.",
  ],
  id: [
    "Maya membicarakan pertemuan itu?",
    "“Tolong beri tahu waktunya,” katanya. Ngomong-ngomong, sudah makan?",
    "Belum. Apa arti [???] di sini?",
    "Teksnya tidak jelas.",
  ],
  th: [
    "มายาพูดถึงการประชุมไหม",
    "เขาบอกว่า “ช่วยบอกเวลาด้วย” ว่าแต่กินข้าวหรือยัง [???]",
    "ยัง [???] ตรงนี้หมายความว่าอะไร",
    "คำบรรยายไม่ชัดเจน",
  ],
  ms: [
    "Maya bercakap tentang perjumpaan itu?",
    "“Tolong beritahu waktunya,” katanya. Oh ya, sudah makan?",
    "Belum. Apa maksud [???] di sini?",
    "Sari kata itu tidak jelas.",
  ],
  vi: [
    "Maya có nói về cuộc họp không?",
    "“Cho tôi biết giờ nhé”, cô ấy nói. À, bạn ăn chưa?",
    "Chưa. [???] ở đây nghĩa là gì?",
    "Phụ đề không rõ.",
  ],
  "zh-TW": [
    "ミオ有提到聚會嗎？",
    "「請告訴我時間」，是這麼說的。對了，吃飯了嗎？",
    "還沒。這裡的[???]是什麼意思？",
    "字幕不清楚。",
  ],
  "zh-CN": [
    "ミオ有提到聚会吗？",
    "“请告诉我时间”，是这么说的。对了，吃饭了吗？",
    "还没。这里的[???]是什么意思？",
    "字幕不清楚。",
  ],
};
export const qualityV7Cases = Object.keys(normal).flatMap(key => {
  const language = key as LearningLanguage,
    level = language === "ja" ? "N3" : language === "ko" ? "3" : "B1";
  return [
    { language, level, name: "normal-transfer", lines: normal[language] },
    { language, level, name: "uncertainty-quote-topic", lines: risky[language] },
  ];
});
