import fs from "node:fs/promises";

import mammoth from "mammoth";
import { OfficeParser } from "officeparser";
import { PDFParse } from "pdf-parse";

import type { SourceType } from "../shared/types.js";

export async function parseSourceText(filePath: string, type: SourceType): Promise<string> {
  if (type === "markdown" || type === "text" || type === "cpp" || type === "header") {
    return fs.readFile(filePath, "utf8");
  }

  if (type === "docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (type === "pptx") {
    const ast = await OfficeParser.parseOffice(filePath, {
      ocr: false,
      extractAttachments: false,
      outputErrorToConsole: false
    });
    return ast.toText();
  }

  if (type === "pdf") {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  throw new Error(`Unsupported source type: ${type}`);
}

export function splitIntoChunks(text: string, chunkSize = 3500): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [""];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    const nextBreak = normalized.lastIndexOf("\n\n", end);
    if (nextBreak > start + 800) {
      end = nextBreak;
    }
    chunks.push(normalized.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(Boolean);
}
