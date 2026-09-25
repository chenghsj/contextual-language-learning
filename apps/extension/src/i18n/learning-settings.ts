import type { UiLocale } from "./messages";
import type { LearningProfile } from "@immersive/core";

export type LearningSettingKey = "targetLanguage" | "level" | "instructionLanguage" |
  "teachingMode" | "vocabLimit" | "exerciseCount";
export type SettingOptionInfo = { label: string; description: string };
export type LearningSettingsCopy = {
  infoLabel: string;
  fieldHints: Record<LearningSettingKey, string>;
  targetDescriptions: Record<LearningProfile["targetLanguage"], string>;
  instructionDescriptions: Record<LearningProfile["instructionLanguage"], string>;
  levels: Record<LearningProfile["targetLanguage"], Record<string, SettingOptionInfo>>;
  modes: Record<LearningProfile["mode"], SettingOptionInfo>;
};

/** All option labels and descriptions are localized, but persisted values stay unchanged. */
export const learningSettingsCopy: Record<UiLocale, LearningSettingsCopy> = {
  "en": {
    "infoLabel": "Information about",
    "fieldHints": {
      "targetLanguage": "Choose the language you want to learn. The subtitle phrases and example sentences stay in that language.",
      "level": "Choose a comfortable starting point. English uses CEFR (A1–C2), Japanese uses JLPT (N5–N1), and Korean uses TOPIK (1–6). This adjusts the requested lesson difficulty; it is not a proficiency test.",
      "instructionLanguage": "Choose the language used to explain meanings, grammar and answers. Original subtitle lines stay in the learning language.",
      "teachingMode": "Choose how the AI explains and practices the subtitle dialogue. The language of explanations remains your selected explanation language.",
      "vocabLimit": "Maximum new words or phrases highlighted in each section (1–30). Fewer items give you more time to review. The AI may choose fewer if the dialogue has little useful vocabulary.",
      "exerciseCount": "Maximum practice questions per section (0–12). Enter 0 to skip exercises. The AI may generate fewer when the dialogue does not support more."
    },
    "targetDescriptions": {
      "en": "Learn from English subtitle lines.",
      "ja": "Learn from Japanese subtitle lines.",
      "ko": "Learn from Korean subtitle lines."
    },
    "instructionDescriptions": {
      "en": "Explain meanings and grammar in English.",
      "zh-TW": "Explain meanings and grammar in Traditional Chinese.",
      "zh-CN": "Explain meanings and grammar in Simplified Chinese.",
      "ja": "Explain meanings and grammar in Japanese.",
      "ko": "Explain meanings and grammar in Korean."
    },
    "levels": {
      "en": {
        "A1": {
          "label": "Beginner",
          "description": "Very common words and simple everyday phrases."
        },
        "A2": {
          "label": "Elementary",
          "description": "Short exchanges about familiar daily activities."
        },
        "B1": {
          "label": "Intermediate",
          "description": "Main ideas, common situations and personal opinions."
        },
        "B2": {
          "label": "Upper-intermediate",
          "description": "Longer dialogue, more complex vocabulary and arguments."
        },
        "C1": {
          "label": "Advanced",
          "description": "Nuance, implied meaning and demanding topics."
        },
        "C2": {
          "label": "Proficient",
          "description": "Subtle meaning and complex or idiomatic expression."
        }
      },
      "ja": {
        "N5": {
          "label": "Beginner",
          "description": "Basic greetings, short sentences and essential words."
        },
        "N4": {
          "label": "Elementary",
          "description": "Common daily phrases and simple conversations."
        },
        "N3": {
          "label": "Intermediate",
          "description": "Everyday conversations at a more natural pace."
        },
        "N2": {
          "label": "Upper-intermediate",
          "description": "Longer discussions, news-like topics and nuance."
        },
        "N1": {
          "label": "Advanced",
          "description": "Complex expressions and subtle, abstract meaning."
        }
      },
      "ko": {
        "1": {
          "label": "Beginner",
          "description": "Basic greetings and very simple daily phrases."
        },
        "2": {
          "label": "Elementary",
          "description": "Familiar situations and short everyday conversations."
        },
        "3": {
          "label": "Intermediate",
          "description": "Routine social topics and longer conversations."
        },
        "4": {
          "label": "Upper-intermediate",
          "description": "Detailed explanations and less familiar subjects."
        },
        "5": {
          "label": "Advanced",
          "description": "Complex topics and more subtle expression."
        },
        "6": {
          "label": "Proficient",
          "description": "Nuanced meaning across demanding contexts."
        }
      }
    },
    "modes": {
      "adaptive": {
        "label": "Balanced for my level",
        "description": "Balance explanations and practice based on the level you selected."
      },
      "guided": {
        "label": "Explain more in my chosen language",
        "description": "Give more explanations and clarification in your explanation language while keeping the original expressions."
      },
      "immersive": {
        "label": "Practice more in the learning language",
        "description": "Use more examples and exercises in the learning language; explanations still use your selected explanation language."
      }
    }
  },
  "zh-TW": {
    "infoLabel": "設定說明：",
    "fieldHints": {
      "targetLanguage": "選擇你要學的語言。字幕原句和學習例句會保留該語言。",
      "level": "選擇目前適合的難度。英文使用 CEFR（A1～C2）、日文使用 JLPT（N5～N1）、韓文使用 TOPIK（1～6）。這是教材難度設定，不是能力測驗結果。",
      "instructionLanguage": "選擇單字意思、文法與答案解說使用的語言；字幕原句仍保留學習語言。",
      "teachingMode": "選擇 AI 如何解說及安排字幕練習。解說文字仍使用你選的解說語言。",
      "vocabLimit": "每章最多挑選 1～30 個新單字或片語。數量少一點比較容易複習；字幕內容不夠時，AI 可能挑得更少。",
      "exerciseCount": "每章最多產生 0～12 題練習。設為 0 就不出練習題；若對話素材不足，AI 可能產生較少題。"
    },
    "targetDescriptions": {
      "en": "從英文字幕學英文。",
      "ja": "從日文字幕學日文。",
      "ko": "從韓文字幕學韓文。"
    },
    "instructionDescriptions": {
      "en": "以英文解說單字與文法。",
      "zh-TW": "以繁體中文解說單字與文法。",
      "zh-CN": "以簡體中文解說單字與文法。",
      "ja": "以日文解說單字與文法。",
      "ko": "以韓文解說單字與文法。"
    },
    "levels": {
      "en": {
        "A1": {
          "label": "入門",
          "description": "理解常見單字、簡單句子和日常用語。"
        },
        "A2": {
          "label": "初級",
          "description": "理解熟悉生活情境的短對話。"
        },
        "B1": {
          "label": "中級",
          "description": "掌握常見話題、主要意思與個人想法。"
        },
        "B2": {
          "label": "中高級",
          "description": "理解較長對話、複雜詞彙和論點。"
        },
        "C1": {
          "label": "進階",
          "description": "理解言外之意、語氣和較難的主題。"
        },
        "C2": {
          "label": "精通",
          "description": "理解細微語意、慣用表達及複雜內容。"
        }
      },
      "ja": {
        "N5": {
          "label": "入門",
          "description": "基本招呼、簡單短句與基礎單字。"
        },
        "N4": {
          "label": "初級",
          "description": "常見生活用語與簡單會話。"
        },
        "N3": {
          "label": "中級",
          "description": "理解較自然速度的日常對話。"
        },
        "N2": {
          "label": "中高級",
          "description": "較長討論、新聞式主題與語意差異。"
        },
        "N1": {
          "label": "進階",
          "description": "複雜表達、抽象內容與細微語意。"
        }
      },
      "ko": {
        "1": {
          "label": "入門",
          "description": "基本招呼和非常簡單的日常用語。"
        },
        "2": {
          "label": "初級",
          "description": "熟悉情境與簡短日常會話。"
        },
        "3": {
          "label": "中級",
          "description": "一般社交話題與較長對話。"
        },
        "4": {
          "label": "中高級",
          "description": "較詳細的說明與不熟悉的主題。"
        },
        "5": {
          "label": "進階",
          "description": "複雜主題與較細膩的表達。"
        },
        "6": {
          "label": "精通",
          "description": "理解高難度內容與細微語意。"
        }
      }
    },
    "modes": {
      "adaptive": {
        "label": "依我的程度平衡解說與練習",
        "description": "依照所選程度，安排解說深度和練習量。"
      },
      "guided": {
        "label": "多用解說語言講解",
        "description": "增加你選的解說語言中的說明與釐清，保留原文例句。"
      },
      "immersive": {
        "label": "多用學習語言練習",
        "description": "增加學習語言的例句與練習，解說仍使用你選的解說語言。"
      }
    }
  },
  "zh-CN": {
    "infoLabel": "设置说明：",
    "fieldHints": {
      "targetLanguage": "选择你要学习的语言。字幕原句和学习例句会保留该语言。",
      "level": "选择适合自己的难度。英语使用 CEFR（A1～C2）、日语使用 JLPT（N5～N1）、韩语使用 TOPIK（1～6）。这是教材难度设置，不是能力测试结果。",
      "instructionLanguage": "选择词义、语法和答案讲解使用的语言；字幕原句仍保留学习语言。",
      "teachingMode": "选择 AI 如何讲解及安排字幕练习。讲解文字仍使用你选的讲解语言。",
      "vocabLimit": "每章最多挑选 1～30 个新词或短语。数量少一些更方便复习；素材不足时 AI 可能挑选更少。",
      "exerciseCount": "每章最多生成 0～12 道练习题。设为 0 则跳过练习；如果对话素材不足，AI 可能生成更少。"
    },
    "targetDescriptions": {
      "en": "通过英语字幕学习英语。",
      "ja": "通过日语字幕学习日语。",
      "ko": "通过韩语字幕学习韩语。"
    },
    "instructionDescriptions": {
      "en": "使用英语讲解词义和语法。",
      "zh-TW": "使用繁体中文讲解词义和语法。",
      "zh-CN": "使用简体中文讲解词义和语法。",
      "ja": "使用日语讲解词义和语法。",
      "ko": "使用韩语讲解词义和语法。"
    },
    "levels": {
      "en": {
        "A1": {
          "label": "入门",
          "description": "理解常见单词、简单句子与日常用语。"
        },
        "A2": {
          "label": "初级",
          "description": "理解熟悉生活场景中的简短对话。"
        },
        "B1": {
          "label": "中级",
          "description": "理解常见话题、主要意思与个人观点。"
        },
        "B2": {
          "label": "中高级",
          "description": "理解较长对话、复杂词汇和论点。"
        },
        "C1": {
          "label": "高级",
          "description": "理解言外之意、语气和较难的主题。"
        },
        "C2": {
          "label": "精通",
          "description": "理解细微语义、习惯表达及复杂内容。"
        }
      },
      "ja": {
        "N5": {
          "label": "入门",
          "description": "基本问候、简单短句和基础词汇。"
        },
        "N4": {
          "label": "初级",
          "description": "常见生活用语与简单会话。"
        },
        "N3": {
          "label": "中级",
          "description": "理解较自然语速的日常对话。"
        },
        "N2": {
          "label": "中高级",
          "description": "较长讨论、新闻类话题与语义差异。"
        },
        "N1": {
          "label": "高级",
          "description": "复杂表达、抽象内容与细微语义。"
        }
      },
      "ko": {
        "1": {
          "label": "入门",
          "description": "基本问候和非常简单的日常用语。"
        },
        "2": {
          "label": "初级",
          "description": "熟悉场景与简短日常会话。"
        },
        "3": {
          "label": "中级",
          "description": "一般社交话题与较长对话。"
        },
        "4": {
          "label": "中高级",
          "description": "较详细的说明与不熟悉的话题。"
        },
        "5": {
          "label": "高级",
          "description": "复杂话题与较细腻的表达。"
        },
        "6": {
          "label": "精通",
          "description": "理解高难度内容与细微语义。"
        }
      }
    },
    "modes": {
      "adaptive": {
        "label": "按我的水平平衡讲解与练习",
        "description": "根据所选水平调整讲解深度与练习量。"
      },
      "guided": {
        "label": "多用讲解语言解释",
        "description": "增加所选讲解语言中的说明和解释，保留原文例句。"
      },
      "immersive": {
        "label": "多用学习语言练习",
        "description": "增加学习语言的例句与练习，讲解仍使用所选讲解语言。"
      }
    }
  },
  "ja": {
    "infoLabel": "設定の説明：",
    "fieldHints": {
      "targetLanguage": "学習したい言語を選びます。字幕の原文や例文はその言語のままです。",
      "level": "教材の難しさを選びます。英語は CEFR（A1～C2）、日本語は JLPT（N5～N1）、韓国語は TOPIK（1～6）が目安です。能力試験の結果ではありません。",
      "instructionLanguage": "語彙の意味、文法、解答の説明に使う言語を選びます。字幕の原文は学習言語のままです。",
      "teachingMode": "AI にどのくらい説明や練習を入れてもらうかを選びます。解説の言語は指定したままです。",
      "vocabLimit": "各章で取り上げる新しい単語・表現の上限は 1～30 個です。素材によっては指定数より少なくなります。",
      "exerciseCount": "各章の練習問題の上限は 0～12 問です。0 にすると練習を省きます。素材により問題数が少なくなることがあります。"
    },
    "targetDescriptions": {
      "en": "英語の字幕から英語を学びます。",
      "ja": "日本語の字幕から日本語を学びます。",
      "ko": "韓国語の字幕から韓国語を学びます。"
    },
    "instructionDescriptions": {
      "en": "英語で意味と文法を説明します。",
      "zh-TW": "繁体字中国語で意味と文法を説明します。",
      "zh-CN": "簡体字中国語で意味と文法を説明します。",
      "ja": "日本語で意味と文法を説明します。",
      "ko": "韓国語で意味と文法を説明します。"
    },
    "levels": {
      "en": {
        "A1": {
          "label": "入門",
          "description": "よく使う単語と簡単な日常表現。"
        },
        "A2": {
          "label": "初級",
          "description": "身近な場面での短い会話。"
        },
        "B1": {
          "label": "中級",
          "description": "よくある話題の要点や意見。"
        },
        "B2": {
          "label": "中上級",
          "description": "長めの会話、複雑な語彙や議論。"
        },
        "C1": {
          "label": "上級",
          "description": "含意、ニュアンスや難しい話題。"
        },
        "C2": {
          "label": "熟達",
          "description": "微妙な意味や複雑な慣用表現。"
        }
      },
      "ja": {
        "N5": {
          "label": "入門",
          "description": "挨拶、短い文、基本的な語彙。"
        },
        "N4": {
          "label": "初級",
          "description": "よく使う日常表現と簡単な会話。"
        },
        "N3": {
          "label": "中級",
          "description": "自然に近い速さの日常会話。"
        },
        "N2": {
          "label": "中上級",
          "description": "長めの議論やニュース、細かな意味。"
        },
        "N1": {
          "label": "上級",
          "description": "複雑な表現、抽象的な話題や含意。"
        }
      },
      "ko": {
        "1": {
          "label": "入門",
          "description": "基本的な挨拶と簡単な日常表現。"
        },
        "2": {
          "label": "初級",
          "description": "身近な場面での短い会話。"
        },
        "3": {
          "label": "中級",
          "description": "日常の社会的話題や長めの会話。"
        },
        "4": {
          "label": "中上級",
          "description": "詳しい説明や慣れない話題。"
        },
        "5": {
          "label": "上級",
          "description": "複雑な話題と細かな表現。"
        },
        "6": {
          "label": "熟達",
          "description": "難しい内容や微妙な意味。"
        }
      }
    },
    "modes": {
      "adaptive": {
        "label": "レベルに合わせて説明と練習を調整",
        "description": "設定したレベルに合わせて説明の深さと練習量を調整します。"
      },
      "guided": {
        "label": "解説する言語で詳しく説明",
        "description": "選んだ解説言語で説明を増やし、元の例文は学習言語のままにします。"
      },
      "immersive": {
        "label": "学習する言語で練習を増やす",
        "description": "学習言語の例文や練習を増やし、解説は指定言語で行います。"
      }
    }
  },
  "ko": {
    "infoLabel": "설정 설명:",
    "fieldHints": {
      "targetLanguage": "학습할 언어를 선택합니다. 자막 원문과 예문은 해당 언어로 유지됩니다.",
      "level": "교재의 난이도를 선택합니다. 영어는 CEFR(A1~C2), 일본어는 JLPT(N5~N1), 한국어는 TOPIK(1~6)을 사용합니다. 실제 능력을 판정하는 시험은 아닙니다.",
      "instructionLanguage": "어휘 의미, 문법 및 정답 설명에 사용할 언어를 선택합니다. 자막 원문은 학습 언어 그대로 유지됩니다.",
      "teachingMode": "AI가 자막 대화를 설명하고 연습을 구성하는 방식을 선택합니다. 설명 언어는 지정한 언어를 유지합니다.",
      "vocabLimit": "각 장에서 다룰 새 단어나 표현의 최대 개수입니다(1~30개). 소재에 따라 더 적게 선택할 수 있습니다.",
      "exerciseCount": "각 장의 연습 문제 최대 개수입니다(0~12개). 0이면 연습을 생략합니다. 소재가 부족하면 문제 수가 줄어들 수 있습니다."
    },
    "targetDescriptions": {
      "en": "영어 자막으로 영어를 학습합니다.",
      "ja": "일본어 자막으로 일본어를 학습합니다.",
      "ko": "한국어 자막으로 한국어를 학습합니다."
    },
    "instructionDescriptions": {
      "en": "영어로 어휘와 문법을 설명합니다.",
      "zh-TW": "번체 중국어로 어휘와 문법을 설명합니다.",
      "zh-CN": "간체 중국어로 어휘와 문법을 설명합니다.",
      "ja": "일본어로 어휘와 문법을 설명합니다.",
      "ko": "한국어로 어휘와 문법을 설명합니다."
    },
    "levels": {
      "en": {
        "A1": {
          "label": "입문",
          "description": "자주 쓰는 단어와 간단한 일상 표현."
        },
        "A2": {
          "label": "초급",
          "description": "익숙한 상황에서의 짧은 대화."
        },
        "B1": {
          "label": "중급",
          "description": "일반적인 주제의 요점과 의견."
        },
        "B2": {
          "label": "중상급",
          "description": "긴 대화, 복잡한 어휘와 논의."
        },
        "C1": {
          "label": "고급",
          "description": "함축적 의미, 뉘앙스와 어려운 주제."
        },
        "C2": {
          "label": "숙련",
          "description": "미묘한 의미와 복잡한 관용 표현."
        }
      },
      "ja": {
        "N5": {
          "label": "입문",
          "description": "기본 인사, 짧은 문장과 기초 어휘."
        },
        "N4": {
          "label": "초급",
          "description": "흔한 일상 표현과 간단한 대화."
        },
        "N3": {
          "label": "중급",
          "description": "자연스러운 속도의 일상 대화."
        },
        "N2": {
          "label": "중상급",
          "description": "긴 논의, 뉴스와 세부적인 의미."
        },
        "N1": {
          "label": "고급",
          "description": "복잡한 표현, 추상적 주제와 함축적 의미."
        }
      },
      "ko": {
        "1": {
          "label": "입문",
          "description": "기본 인사와 아주 간단한 일상 표현."
        },
        "2": {
          "label": "초급",
          "description": "익숙한 상황에서의 짧은 대화."
        },
        "3": {
          "label": "중급",
          "description": "일반적인 사회 주제와 긴 대화."
        },
        "4": {
          "label": "중상급",
          "description": "상세한 설명과 낯선 주제."
        },
        "5": {
          "label": "고급",
          "description": "복잡한 주제와 세밀한 표현."
        },
        "6": {
          "label": "숙련",
          "description": "난도 높은 내용과 미묘한 의미."
        }
      }
    },
    "modes": {
      "adaptive": {
        "label": "내 수준에 맞춰 설명과 연습 조정",
        "description": "선택한 수준에 맞게 설명의 깊이와 연습량을 조정합니다."
      },
      "guided": {
        "label": "선택한 설명 언어로 더 자세히 설명",
        "description": "선택한 설명 언어로 풀이를 늘리고 원문 예문은 유지합니다."
      },
      "immersive": {
        "label": "학습 언어로 연습 더 많이 하기",
        "description": "학습 언어의 예문과 연습을 늘리고 설명은 선택한 언어로 제공합니다."
      }
    }
  }
};
