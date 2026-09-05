/**
 * 文章 frontmatter 的 faqSchema 在 content.config.ts 宣告成 z.unknown()，
 * Astro 完全不檢查結構 —— 所以渲染成 JSON-LD 之前要自己驗一次。
 *
 * 原則：全有全無。任何一題格式壞掉就整組不輸出，寧可少一組 schema，
 * 也不要送無效的 FAQPage 給 Google（無效 schema 會被判為 spam 訊號）。
 *
 * 回傳的物件是「重建」出來的，不是原樣轉發 —— 多餘欄位會被丟掉、
 * @context 一律正規化，確保輸出永遠是乾淨的 FAQPage。
 */

type FaqAnswer = { "@type": "Answer"; text: string };

type FaqQuestion = {
  "@type": "Question";
  name: string;
  acceptedAnswer: FaqAnswer;
};

export type FaqPageSchema = {
  "@context": "https://schema.org";
  "@type": "FAQPage";
  mainEntity: FaqQuestion[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeFaqSchema(input: unknown): FaqPageSchema | null {
  if (!isRecord(input)) return null;
  if (input["@type"] !== "FAQPage") return null;
  if (!Array.isArray(input.mainEntity)) return null;

  const mainEntity: FaqQuestion[] = [];

  for (const rawQuestion of input.mainEntity) {
    if (!isRecord(rawQuestion)) return null;
    if (rawQuestion["@type"] !== "Question") return null;

    const name = asNonEmptyString(rawQuestion.name);
    if (!name) return null;

    const rawAnswer = rawQuestion.acceptedAnswer;
    if (!isRecord(rawAnswer)) return null;
    if (rawAnswer["@type"] !== "Answer") return null;

    const text = asNonEmptyString(rawAnswer.text);
    if (!text) return null;

    mainEntity.push({
      "@type": "Question",
      name,
      acceptedAnswer: { "@type": "Answer", text },
    });
  }

  if (mainEntity.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity,
  };
}
