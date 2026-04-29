"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSourceText = parseSourceText;
exports.splitIntoChunks = splitIntoChunks;
const promises_1 = __importDefault(require("node:fs/promises"));
const mammoth_1 = __importDefault(require("mammoth"));
const officeparser_1 = require("officeparser");
const pdf_parse_1 = require("pdf-parse");
async function parseSourceText(filePath, type) {
    if (type === "markdown" || type === "text" || type === "cpp" || type === "header") {
        return promises_1.default.readFile(filePath, "utf8");
    }
    if (type === "docx") {
        const result = await mammoth_1.default.extractRawText({ path: filePath });
        return result.value;
    }
    if (type === "pptx") {
        const ast = await officeparser_1.OfficeParser.parseOffice(filePath, {
            ocr: false,
            extractAttachments: false,
            outputErrorToConsole: false
        });
        return ast.toText();
    }
    if (type === "pdf") {
        const buffer = await promises_1.default.readFile(filePath);
        const parser = new pdf_parse_1.PDFParse({ data: buffer });
        try {
            const result = await parser.getText();
            return result.text;
        }
        finally {
            await parser.destroy();
        }
    }
    throw new Error(`Unsupported source type: ${type}`);
}
function splitIntoChunks(text, chunkSize = 3500) {
    const normalized = text.replace(/\r\n/g, "\n").trim();
    if (!normalized)
        return [""];
    const chunks = [];
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
