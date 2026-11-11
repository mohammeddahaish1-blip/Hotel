import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Reads a photographed shop invoice (sales report, purchase invoice or expense receipt, Arabic or English)
 * and returns its total in baisa. Uses Claude vision with a JSON schema so the answer is always parseable.
 * Without an Anthropic API key nothing is read and the cashier types the amount instead.
 */
const MODEL = "claude-opus-5-5";

export const receiptReaderEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export type ReceiptReading = { total: number | null; vendor: string | null; date: string | null; kind: "sales" | "purchase" | "expense" | null };

const SCHEMA = {
  type: "object",
  properties: {
    total_omr: { type: ["number", "null"], description: "The document's grand total in Omani rials (3 decimals). null if it cannot be read." },
    vendor: { type: ["string", "null"], description: "Shop or supplier name printed on the document, if any." },
    date: { type: ["string", "null"], description: "Document date as YYYY-MM-DD, if printed." },
    kind: { type: ["string", "null"], enum: ["sales", "purchase", "expense", null], description: "sales = the shop's own sales report / till Z-report; purchase = an invoice from a supplier for goods; expense = any other bill (electricity, rent, repairs)." },
  },
  required: ["total_omr", "vendor", "date", "kind"],
  additionalProperties: false,
};

const PROMPT =
  "This is a photo of a document from a small shop in Oman (Arabic and/or English, digits may be Arabic-Indic). " +
  "Read the grand total (after tax, the final amount paid or due), the vendor name, the date and what kind of document it is. " +
  "Amounts are in Omani rials (OMR / ر.ع) with up to 3 decimals; convert Arabic-Indic digits and the Arabic decimal mark. " +
  "If the photo is not a receipt or invoice, or the total is unreadable, return null for total_omr.";

export async function readReceipt(data: Buffer, mediaType: string): Promise<ReceiptReading | null> {
  if (!receiptReaderEnabled()) return null;
  const isPdf = mediaType === "application/pdf";
  const imageType = (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mediaType) ? mediaType : "image/jpeg") as
    "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          isPdf
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") } }
            : { type: "image", source: { type: "base64", media_type: imageType, data: data.toString("base64") } },
          { type: "text", text: PROMPT },
        ],
      }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return null;
    const out = JSON.parse(text.text) as { total_omr: number | null; vendor: string | null; date: string | null; kind: ReceiptReading["kind"] };
    const total = typeof out.total_omr === "number" && Number.isFinite(out.total_omr) && out.total_omr >= 0 ? Math.round(out.total_omr * 1000) : null;
    return {
      total,
      vendor: out.vendor?.slice(0, 120) ?? null,
      date: out.date && /^\d{4}-\d{2}-\d{2}$/.test(out.date) ? out.date : null,
      kind: out.kind ?? null,
    };
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.error("receipt reader:", err.status, err.message);
    else console.error("receipt reader:", err);
    return null;
  }
}
