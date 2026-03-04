const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const authMiddleware = require('../middleware/auth');

// Multer: armazenamento em memória (não salva em disco)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não suportado. Use PDF ou DOCX.'));
    }
  },
});

router.use(authMiddleware);

// ─── POST /api/convert/pdf ──────────────────────────────────────────────────
// Recebe PDF e extrai texto paginado para o editor
router.post('/pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const data = await pdfParse(req.file.buffer);

    // Dividir texto em páginas usando quebras de página
    const rawPages = data.text.split(/\f/).filter(p => p.trim().length > 0);
    const numPages = Math.max(data.numpages, rawPages.length, 1);

    const pages = [];
    for (let i = 0; i < numPages; i++) {
      const pageText = rawPages[i] || '';
      const lines = pageText
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

      // Criar elementos de texto para o Fabric.js
      const elements = [];
      let y = 60;
      for (const line of lines) {
        elements.push({
          type: 'i-text',
          text: line,
          left: 60,
          top: y,
          fontSize: 14,
          fontFamily: 'Arial',
          fill: '#111111',
          selectable: true,
          editable: true,
        });
        y += 24;
        if (y > 1050) break; // Limite da página A4
      }

      pages.push({
        pageNumber: i + 1,
        width: 794,
        height: 1123,
        backgroundColor: 'white',
        elements,
      });
    }

    res.json({
      success: true,
      fileName: req.file.originalname,
      totalPages: pages.length,
      pages,
    });
  } catch (err) {
    console.error('PDF convert error:', err);
    res.status(500).json({ error: 'Erro ao processar o PDF: ' + err.message });
  }
});

// ─── Error handler para multer ───────────────────────────────────────────────
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Arquivo muito grande. Limite de 20MB.' });
    }
  }
  res.status(400).json({ error: err.message });
});

module.exports = router;
