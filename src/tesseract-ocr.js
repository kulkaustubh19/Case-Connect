import { createWorker } from "tesseract.js";

async function imageCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}

async function preparedOcrCanvas(file) {
  const source = await imageCanvas(file);
  const scale = 3;
  // Keep a colour copy for speaker detection. The OCR copy is deliberately
  // grayscale, so sampling it would make every turn look like a candidate.
  const colourCanvas = document.createElement("canvas");
  colourCanvas.width = source.width * scale;
  colourCanvas.height = source.height * scale;
  colourCanvas.getContext("2d", { willReadFrequently: true }).drawImage(source, 0, 0, colourCanvas.width, colourCanvas.height);
  const canvas = document.createElement("canvas");
  canvas.width = source.width * scale;
  canvas.height = source.height * scale;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.filter = "grayscale(1) contrast(1.75)";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  context.filter = "none";
  return { ocrCanvas: canvas, colourCanvas };
}

function speakerForLine(canvas, box) {
  if (!canvas || !box) return "candidate";
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const { x0, y0, x1, y1 } = box;
  const points = [[.15,.25],[.5,.25],[.85,.25],[.15,.75],[.5,.75],[.85,.75]];
  let coloured = 0;
  for (const [xRatio,yRatio] of points) {
    const x = Math.max(0, Math.min(canvas.width - 1, Math.round(x0 + (x1 - x0) * xRatio)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.round(y0 + (y1 - y0) * yRatio)));
    const [red, green, blue] = context.getImageData(x, y, 1, 1).data;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) > 55 && Math.max(red, green, blue) > 90) coloured += 1;
  }
  return coloured >= 2 ? "interviewer" : "candidate";
}

function transcriptFromData(data, page, canvas, turns) {
  const lines = data.lines?.filter(line => line.text?.trim()) ?? [];
  if (!lines.length && data.text?.trim()) turns.push({ speaker: "candidate", text: data.text.trim(), page, order: turns.length + 1 });
  for (const line of lines) {
    const speaker = speakerForLine(canvas, line.bbox);
    const previous = turns.at(-1);
    if (previous && previous.page === page && previous.speaker === speaker) previous.text += ` ${line.text.trim()}`;
    else turns.push({ speaker, text: line.text.trim(), page, order: turns.length + 1 });
  }
}

export function extractCaseMetadata(rawText) {
  const lines = rawText.split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const usefulLines = lines.filter(line => {
    const letters = (line.match(/[a-z]/gi) || []).length;
    return letters >= 6 && letters / line.length > .55 && !/%20|\.pdf|ask copilot|iim bangalore|placement|case book|[©@]/i.test(line);
  });
  const title = usefulLines.find(line => line.length > 8 && !/your client|case statement|challeng|beginner|intermediate|advanced|\|/i.test(line)) || "Untitled case";
  const header = [...usefulLines, ...lines].find(line => /challeng|beginner|intermediate|advanced|\|/i.test(line)) || "";
  const difficulty = /challeng|advanced/i.test(header) ? "Advanced" : /beginner/i.test(header) ? "Beginner" : /intermediate/i.test(header) ? "Intermediate" : "Intermediate";
  const companyMatch = header.match(/\|\s*(.+)$/);
  const companySource = companyMatch?.[1] || header;
  const company = /bain/i.test(companySource) ? "Bain & Company" : /mckinsey/i.test(companySource) ? "McKinsey & Company" : /bcg/i.test(companySource) ? "BCG" : /deloitte/i.test(companySource) ? "Deloitte" : /kearney/i.test(companySource) ? "Kearney" : companySource.replace(/challeng|beginner|intermediate|advanced/ig, "").replace(/[|–-]+/g, "").trim() || "Independent";
  const statementStart = usefulLines.findIndex(line => /your client|client is|case statement/i.test(line));
  const description = statementStart >= 0 ? usefulLines.slice(statementStart, Math.min(usefulLines.length, statementStart + 3)).join(" ") : usefulLines.slice(1, 4).join(" ") || "Case statement extracted from the uploaded conversation.";
  const lower = `${title} ${description}`.toLowerCase();
  const industry = /health|hospital|pharma|medic/i.test(lower) ? "Healthcare" : /retail|e-?commerce|consumer|food/i.test(lower) ? "Consumer Goods" : /bank|insurance|fintech/i.test(lower) ? "Financial Services" : /travel|airport|hotel|airline/i.test(lower) ? "Travel" : /software|saas|app|technology/i.test(lower) ? "Technology" : /call center|telecom/i.test(lower) ? "Business Services" : "General";
  return { title, difficulty, company, industry, description };
}

// OCR runs in the administrator's browser. Images are never sent to an OCR
// service; only the resulting transcript and derived metadata are saved.
export async function extractConversationWithTesseract(files, onProgress) {
  if (!files.length) return { turns: [], rawText: "" };
  const worker = await createWorker("eng", 1, { logger: event => { if (event.status === "recognizing text") onProgress?.(event.progress); } });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1" });
    const turns = [], pages = [];
    for (let index = 0; index < files.length; index += 1) {
      onProgress?.(index / files.length);
      const { ocrCanvas, colourCanvas } = await preparedOcrCanvas(files[index]);
      const result = await worker.recognize(ocrCanvas);
      pages.push(result.data.text.replace(/\r/g, "").trim());
      transcriptFromData(result.data, index + 1, colourCanvas, turns);
    }
    onProgress?.(1);
    return { turns, rawText: pages.join("\n") };
  } finally { await worker.terminate(); }
}
