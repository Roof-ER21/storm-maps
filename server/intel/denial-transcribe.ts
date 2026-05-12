/**
 * Transcribe an uploaded denial letter (PDF or image) to verbatim text using
 * Gemini 2.0 Flash's native multimodal input. No pdf-parse / multer / OCR
 * dependency — Gemini handles both formats natively.
 *
 * Body: { format: 'pdf'|'image', base64: string, mimeType: string }
 * Returns: { text: string, model: string, generated: string }
 *
 * Client flow:
 *   1. Drag-drop or pick a file in denial-analyzer.html
 *   2. FileReader.readAsDataURL → strip the `data:.*;base64,` prefix
 *   3. POST { format, base64, mimeType } here
 *   4. Pre-fill the textarea with `text`
 *   5. User reviews + edits + clicks Analyze
 */
import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
let ai: GoogleGenAI | null = null;
if (GEMINI_API_KEY) ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const MODEL = 'gemini-2.0-flash';

const TRANSCRIBE_PROMPT = `You are transcribing an insurance carrier denial letter or claim correspondence to plain text. Output the FULL letter content verbatim. Preserve:
- All paragraphs in order (use blank lines between paragraphs)
- Dates, claim numbers, policy numbers, dollar amounts
- Adjuster name + title + contact info if present
- Carrier name
- The exact denial reason language
- Signature block

Strip:
- Letterhead images / logos (skip — but keep the carrier name)
- Page numbers
- Confidentiality footers ("This message may contain confidential...")
- Boilerplate marketing footers
- Anything that isn't substantive letter content

If the input is unreadable (blurry photo, encrypted PDF, completely blank), return exactly: "UNREADABLE"

Output the text directly — no preamble, no markdown, no explanation. Just the letter.`;

interface TranscribeBody {
  format?: string;
  base64?: string;
  mimeType?: string;
}

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export async function transcribeDenial(req: Request, res: Response): Promise<void> {
  if (!ai) {
    res.status(503).json({ error: 'gemini_unavailable', detail: 'GEMINI_API_KEY not configured' });
    return;
  }

  const body = (req.body || {}) as TranscribeBody;
  const base64 = (body.base64 || '').toString();
  let mimeType = (body.mimeType || '').toString().toLowerCase();

  if (!base64 || base64.length < 100) {
    res.status(400).json({ error: 'invalid_input', detail: 'base64 payload required (min 100 chars)' });
    return;
  }
  // Allow base64 with or without the data: prefix
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');

  // Default mime from format hint
  if (!mimeType) {
    if (body.format === 'pdf') mimeType = 'application/pdf';
    else if (body.format === 'image') mimeType = 'image/jpeg';
  }
  if (!ALLOWED_MIME.has(mimeType)) {
    res.status(400).json({ error: 'invalid_mime', detail: `mimeType ${mimeType} not allowed; use PDF or image/{jpeg,png,webp,heic}` });
    return;
  }

  // Rough size cap — 20MB base64 ≈ 15MB raw
  if (cleanBase64.length > 20 * 1024 * 1024) {
    res.status(413).json({ error: 'file_too_large', detail: 'file must be under 15 MB' });
    return;
  }

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: cleanBase64 } },
            { text: TRANSCRIBE_PROMPT },
          ],
        },
      ],
      config: { temperature: 0.1 },
    });
    const text = (response.text || '').trim();
    if (!text || text === 'UNREADABLE') {
      res.status(422).json({ error: 'unreadable', detail: 'Gemini could not extract readable text from the upload' });
      return;
    }
    res.json({
      text,
      model: MODEL,
      generated: new Date().toISOString(),
      mimeType,
      sourceBytes: Math.round((cleanBase64.length * 3) / 4),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'gemini_error', detail: msg });
  }
}
