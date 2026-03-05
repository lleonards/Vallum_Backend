const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const authMiddleware = require('../middleware/authMiddleware');

// ─── Multer Configuration ─────────────────────────────────────────────────────
const ACCEPTED_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
  'text/html',
  'text/csv',
  'text/markdown',
  'application/rtf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',
  'application/zip',
  'application/x-zip-compressed',
  'application/json',
  'application/xml',
  'text/xml'
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/temp');
    fs.ensureDirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.UPLOAD_MAX_SIZE) || 52428800 },
  fileFilter: (req, file, cb) => {
    if (ACCEPTED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not supported`), false);
    }
  }
});

// ─── Conversion Helpers ───────────────────────────────────────────────────────
const convertFile = async (inputPath, outputFormat, originalName) => {
  const ext = path.extname(inputPath).toLowerCase();
  const baseName = path.basename(originalName, path.extname(originalName));
  const outputDir = path.join(__dirname, '../uploads/converted');
  await fs.ensureDir(outputDir);
  const outputPath = path.join(outputDir, `${uuidv4()}.${outputFormat}`);

  // PDF → Text/HTML extraction
  if (ext === '.pdf' && ['txt', 'html', 'json'].includes(outputFormat)) {
    const pdfParse = require('pdf-parse');
    const dataBuffer = await fs.readFile(inputPath);
    const pdfData = await pdfParse(dataBuffer);

    if (outputFormat === 'txt') {
      await fs.writeFile(outputPath, pdfData.text, 'utf8');
    } else if (outputFormat === 'html') {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${baseName}</title>
<style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:20px;line-height:1.6;}</style>
</head><body><pre style="white-space:pre-wrap;">${pdfData.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></body></html>`;
      await fs.writeFile(outputPath, html, 'utf8');
    } else if (outputFormat === 'json') {
      const json = JSON.stringify({
        title: baseName,
        pages: pdfData.numpages,
        text: pdfData.text,
        info: pdfData.info
      }, null, 2);
      await fs.writeFile(outputPath, json, 'utf8');
    }

    return { outputPath, baseName, outputFormat };
  }

  // DOCX → Text
  if (ext === '.docx' && outputFormat === 'txt') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: inputPath });
    await fs.writeFile(outputPath, result.value, 'utf8');
    return { outputPath, baseName, outputFormat };
  }

  // DOCX → HTML
  if (ext === '.docx' && outputFormat === 'html') {
    const mammoth = require('mammoth');
    const result = await mammoth.convertToHtml({ path: inputPath });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${baseName}</title>
<style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:20px;line-height:1.6;}</style>
</head><body>${result.value}</body></html>`;
    await fs.writeFile(outputPath, html, 'utf8');
    return { outputPath, baseName, outputFormat };
  }

  // TXT → HTML
  if (ext === '.txt' && outputFormat === 'html') {
    const text = await fs.readFile(inputPath, 'utf8');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${baseName}</title>
<style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:20px;line-height:1.6;}</style>
</head><body><pre style="white-space:pre-wrap;">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></body></html>`;
    await fs.writeFile(outputPath, html, 'utf8');
    return { outputPath, baseName, outputFormat };
  }

  // TXT → DOCX
  if (ext === '.txt' && outputFormat === 'docx') {
    const { Document, Packer, Paragraph, TextRun } = require('docx');
    const text = await fs.readFile(inputPath, 'utf8');
    const paragraphs = text.split('\n').map(line =>
      new Paragraph({ children: [new TextRun(line)] })
    );
    const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(outputPath, buffer);
    return { outputPath, baseName, outputFormat };
  }

  // HTML → TXT
  if (ext === '.html' && outputFormat === 'txt') {
    const { htmlToText } = require('html-to-text');
    const html = await fs.readFile(inputPath, 'utf8');
    const text = htmlToText(html);
    await fs.writeFile(outputPath, text, 'utf8');
    return { outputPath, baseName, outputFormat };
  }

  // Image format conversion using sharp
  const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'];
  const imageOutputFormats = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff'];
  if (imageExts.includes(ext) && imageOutputFormats.includes(outputFormat)) {
    const sharp = require('sharp');
    await sharp(inputPath).toFormat(outputFormat === 'jpg' ? 'jpeg' : outputFormat).toFile(outputPath);
    return { outputPath, baseName, outputFormat };
  }

  // Fallback: copy file as-is
  await fs.copy(inputPath, outputPath);
  return { outputPath, baseName, outputFormat };
};

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/conversion/upload - Upload and convert file
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  let inputPath = null;
  let outputPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    inputPath = req.file.path;
    const { outputFormat } = req.body;
    const originalName = req.file.originalname;
    const inputExt = path.extname(originalName).toLowerCase().replace('.', '');

    // If no conversion needed, just return content info
    if (!outputFormat || outputFormat === inputExt) {
      const stats = await fs.stat(inputPath);

      // For PDF: extract text for editor
      if (inputExt === 'pdf') {
        const pdfParse = require('pdf-parse');
        const dataBuffer = await fs.readFile(inputPath);
        const pdfData = await pdfParse(dataBuffer);

        // Clean up
        await fs.remove(inputPath);

        return res.json({
          message: 'PDF uploaded and parsed successfully',
          originalName,
          type: 'pdf',
          pages: pdfData.numpages,
          text: pdfData.text,
          wordCount: pdfData.text.split(/\s+/).filter(w => w).length,
          info: pdfData.info
        });
      }

      // For DOCX: extract content
      if (['docx', 'doc'].includes(inputExt)) {
        const mammoth = require('mammoth');
        const result = await mammoth.convertToHtml({ path: inputPath });
        const textResult = await mammoth.extractRawText({ path: inputPath });
        await fs.remove(inputPath);

        return res.json({
          message: 'Document uploaded and parsed successfully',
          originalName,
          type: 'docx',
          html: result.value,
          text: textResult.value,
          wordCount: textResult.value.split(/\s+/).filter(w => w).length
        });
      }

      await fs.remove(inputPath);
      return res.json({ message: 'File processed', originalName, type: inputExt });
    }

    // Convert file
    const result = await convertFile(inputPath, outputFormat, originalName);
    outputPath = result.outputPath;

    const outputFileName = `${result.baseName}.${outputFormat}`;
    const outputMime = mime.lookup(outputFileName) || 'application/octet-stream';
    const stats = await fs.stat(outputPath);

    res.setHeader('Content-Disposition', `attachment; filename="${outputFileName}"`);
    res.setHeader('Content-Type', outputMime);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('X-Original-Name', originalName);
    res.setHeader('X-Output-Format', outputFormat);

    const readStream = fs.createReadStream(outputPath);
    readStream.pipe(res);

    readStream.on('end', async () => {
      try {
        await fs.remove(inputPath);
        await fs.remove(outputPath);
      } catch (e) {}
    });

  } catch (err) {
    console.error('Conversion error:', err);
    try {
      if (inputPath) await fs.remove(inputPath);
      if (outputPath) await fs.remove(outputPath);
    } catch (e) {}
    res.status(500).json({ error: err.message || 'Conversion failed' });
  }
});

// POST /api/conversion/download - Download document as specific format
router.post('/download', authMiddleware, async (req, res) => {
  let outputPath = null;
  try {
    const { content, format, title, canvasData, htmlContent } = req.body;

    if (!format) {
      return res.status(400).json({ error: 'Output format required' });
    }

    const baseName = title || 'document';
    const outputDir = path.join(__dirname, '../uploads/converted');
    await fs.ensureDir(outputDir);
    outputPath = path.join(outputDir, `${uuidv4()}.${format}`);

    if (format === 'txt') {
      const text = content || '';
      await fs.writeFile(outputPath, text, 'utf8');

    } else if (format === 'html') {
      const html = htmlContent || `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${baseName}</title>
<style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:20px;line-height:1.6;}</style>
</head><body>${content || ''}</body></html>`;
      await fs.writeFile(outputPath, html, 'utf8');

    } else if (format === 'docx') {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
      const text = content || '';
      const lines = text.split('\n');
      const children = lines.map(line => {
        if (!line.trim()) return new Paragraph({ children: [] });
        return new Paragraph({ children: [new TextRun({ text: line, size: 24 })] });
      });

      const doc = new Document({
        creator: 'Vellum',
        title: baseName,
        sections: [{ properties: {}, children }]
      });

      const buffer = await Packer.toBuffer(doc);
      await fs.writeFile(outputPath, buffer);

    } else if (format === 'json') {
      const json = JSON.stringify({
        title: baseName,
        content,
        canvasData,
        exportedAt: new Date().toISOString(),
        version: '1.0'
      }, null, 2);
      await fs.writeFile(outputPath, json, 'utf8');

    } else if (format === 'md') {
      const md = content || '';
      await fs.writeFile(outputPath, md, 'utf8');

    } else if (format === 'rtf') {
      const rtfContent = `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}}
\\f0\\fs24
${(content || '').replace(/\n/g, '\\par\n').replace(/[\\{}]/g, '\\$&')}
}`;
      await fs.writeFile(outputPath, rtfContent, 'utf8');

    } else if (format === 'csv') {
      await fs.writeFile(outputPath, content || '', 'utf8');

    } else {
      await fs.writeFile(outputPath, content || '', 'utf8');
    }

    const outputFileName = `${baseName}.${format}`;
    const outputMime = mime.lookup(outputFileName) || 'application/octet-stream';
    const stats = await fs.stat(outputPath);

    res.setHeader('Content-Disposition', `attachment; filename="${outputFileName}"`);
    res.setHeader('Content-Type', outputMime);
    res.setHeader('Content-Length', stats.size);

    const readStream = fs.createReadStream(outputPath);
    readStream.pipe(res);

    readStream.on('end', async () => {
      try { await fs.remove(outputPath); } catch (e) {}
    });

  } catch (err) {
    console.error('Download error:', err);
    try { if (outputPath) await fs.remove(outputPath); } catch (e) {}
    res.status(500).json({ error: err.message || 'Download failed' });
  }
});

// GET /api/conversion/formats - Get supported formats
router.get('/formats', (req, res) => {
  res.json({
    upload: [
      { ext: 'pdf', name: 'PDF', mime: 'application/pdf' },
      { ext: 'docx', name: 'Word Document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { ext: 'doc', name: 'Word 97-2003', mime: 'application/msword' },
      { ext: 'pptx', name: 'PowerPoint', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
      { ext: 'xlsx', name: 'Excel', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { ext: 'txt', name: 'Plain Text', mime: 'text/plain' },
      { ext: 'html', name: 'HTML', mime: 'text/html' },
      { ext: 'csv', name: 'CSV', mime: 'text/csv' },
      { ext: 'md', name: 'Markdown', mime: 'text/markdown' },
      { ext: 'rtf', name: 'Rich Text', mime: 'application/rtf' },
      { ext: 'jpg', name: 'JPEG Image', mime: 'image/jpeg' },
      { ext: 'png', name: 'PNG Image', mime: 'image/png' },
      { ext: 'webp', name: 'WebP Image', mime: 'image/webp' },
      { ext: 'gif', name: 'GIF Image', mime: 'image/gif' },
      { ext: 'svg', name: 'SVG Vector', mime: 'image/svg+xml' },
      { ext: 'json', name: 'JSON', mime: 'application/json' }
    ],
    download: ['pdf', 'docx', 'txt', 'html', 'md', 'rtf', 'json', 'csv'],
    conversions: {
      pdf: ['txt', 'html', 'json'],
      docx: ['txt', 'html'],
      txt: ['html', 'docx'],
      html: ['txt'],
      jpg: ['png', 'webp', 'bmp'],
      png: ['jpg', 'webp', 'bmp'],
      webp: ['jpg', 'png']
    }
  });
});

module.exports = router;
