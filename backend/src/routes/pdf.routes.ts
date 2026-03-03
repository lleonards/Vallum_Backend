import { Router, Response } from 'express'
import { AuthRequest } from '../middleware/auth.middleware'
import { uploadPDF } from '../middleware/upload.middleware'
import { PDFDocument, degrees } from 'pdf-lib'
import fs from 'fs'
import { logger } from '../utils/logger'

export const pdfRoutes = Router()

// ── Rotate pages ──────────────────────────────────────────────────────────────
pdfRoutes.post('/rotate', uploadPDF.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Arquivo PDF não fornecido' })
      return
    }

    const { pageIndex = 0, angle = 90 } = req.body
    const pdfBytes = fs.readFileSync(req.file.path)
    const pdfDoc = await PDFDocument.load(pdfBytes)
    
    const pages = pdfDoc.getPages()
    const targetPage = pages[parseInt(pageIndex)]
    
    if (!targetPage) {
      res.status(400).json({ error: 'Índice de página inválido' })
      return
    }

    const currentRotation = targetPage.getRotation().angle
    targetPage.setRotation(degrees((currentRotation + parseInt(angle)) % 360))

    const modifiedPdf = await pdfDoc.save()

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="rotated.pdf"')
    res.send(Buffer.from(modifiedPdf))

    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
  } catch (err) {
    logger.error('PDF rotate error:', err)
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    res.status(500).json({ error: 'Erro ao rotacionar PDF' })
  }
})

// ── Flip orientation ──────────────────────────────────────────────────────────
pdfRoutes.post('/flip-orientation', uploadPDF.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Arquivo PDF não fornecido' })
      return
    }

    const { pageIndex, applyAll = false } = req.body
    const pdfBytes = fs.readFileSync(req.file.path)
    const pdfDoc = await PDFDocument.load(pdfBytes)
    const pages = pdfDoc.getPages()

    const flipPage = (page: any) => {
      const { width, height } = page.getSize()
      page.setSize(height, width)
    }

    if (applyAll === 'true' || applyAll === true) {
      pages.forEach(flipPage)
    } else {
      const idx = parseInt(pageIndex || '0')
      if (pages[idx]) flipPage(pages[idx])
    }

    const modifiedPdf = await pdfDoc.save()
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="flipped.pdf"')
    res.send(Buffer.from(modifiedPdf))

    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
  } catch (err) {
    logger.error('PDF flip error:', err)
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    res.status(500).json({ error: 'Erro ao alterar orientação' })
  }
})

// ── Merge PDFs ────────────────────────────────────────────────────────────────
pdfRoutes.post('/merge', uploadPDF.array('files', 10), async (req: AuthRequest, res: Response) => {
  const files = req.files as Express.Multer.File[]
  try {
    if (!files || files.length < 2) {
      res.status(400).json({ error: 'Envie pelo menos 2 arquivos PDF' })
      return
    }

    const mergedDoc = await PDFDocument.create()
    
    for (const file of files) {
      const pdfBytes = fs.readFileSync(file.path)
      const doc = await PDFDocument.load(pdfBytes)
      const pages = await mergedDoc.copyPages(doc, doc.getPageIndices())
      pages.forEach((p) => mergedDoc.addPage(p))
    }

    const mergedPdf = await mergedDoc.save()
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="merged.pdf"')
    res.send(Buffer.from(mergedPdf))
  } catch (err) {
    logger.error('PDF merge error:', err)
    res.status(500).json({ error: 'Erro ao mesclar PDFs' })
  } finally {
    files?.forEach((f) => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path) })
  }
})

// ── Split PDF ─────────────────────────────────────────────────────────────────
pdfRoutes.post('/split', uploadPDF.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Arquivo PDF não fornecido' })
      return
    }

    const { pageIndex } = req.body
    const splitAt = parseInt(pageIndex || '1')
    const pdfBytes = fs.readFileSync(req.file.path)
    const srcDoc = await PDFDocument.load(pdfBytes)
    const total = srcDoc.getPageCount()

    if (splitAt < 1 || splitAt >= total) {
      res.status(400).json({ error: `pageIndex deve estar entre 1 e ${total - 1}` })
      return
    }

    const part1 = await PDFDocument.create()
    const part2 = await PDFDocument.create()

    const pages1 = await part1.copyPages(srcDoc, Array.from({ length: splitAt }, (_, i) => i))
    pages1.forEach((p) => part1.addPage(p))

    const pages2 = await part2.copyPages(srcDoc, Array.from({ length: total - splitAt }, (_, i) => i + splitAt))
    pages2.forEach((p) => part2.addPage(p))

    res.json({
      part1: Buffer.from(await part1.save()).toString('base64'),
      part2: Buffer.from(await part2.save()).toString('base64'),
    })

    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
  } catch (err) {
    logger.error('PDF split error:', err)
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    res.status(500).json({ error: 'Erro ao dividir PDF' })
  }
})

// ── Reorder pages ─────────────────────────────────────────────────────────────
pdfRoutes.post('/reorder', uploadPDF.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Arquivo PDF não fornecido' })
      return
    }

    const { order } = req.body
    const pageOrder: number[] = JSON.parse(order)
    const pdfBytes = fs.readFileSync(req.file.path)
    const srcDoc = await PDFDocument.load(pdfBytes)
    const newDoc = await PDFDocument.create()

    const pages = await newDoc.copyPages(srcDoc, pageOrder)
    pages.forEach((p) => newDoc.addPage(p))

    const reorderedPdf = await newDoc.save()
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="reordered.pdf"')
    res.send(Buffer.from(reorderedPdf))

    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
  } catch (err) {
    logger.error('PDF reorder error:', err)
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    res.status(500).json({ error: 'Erro ao reordenar páginas' })
  }
})

// ── Delete pages ──────────────────────────────────────────────────────────────
pdfRoutes.post('/delete-pages', uploadPDF.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Arquivo PDF não fornecido' })
      return
    }

    const { pageIndices } = req.body
    const indices: number[] = JSON.parse(pageIndices)
    const pdfBytes = fs.readFileSync(req.file.path)
    const pdfDoc = await PDFDocument.load(pdfBytes)

    // Delete from end to start to preserve indices
    const sortedIndices = [...indices].sort((a, b) => b - a)
    sortedIndices.forEach((i) => {
        if (i >= 0 && i < pdfDoc.getPageCount()) {
            pdfDoc.removePage(i)
        }
    })

    const modifiedPdf = await pdfDoc.save()
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="modified.pdf"')
    res.send(Buffer.from(modifiedPdf))

    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
  } catch (err) {
    logger.error('PDF delete pages error:', err)
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    res.status(500).json({ error: 'Erro ao deletar páginas' })
  }
})

// ── Get PDF info ──────────────────────────────────────────────────────────────
pdfRoutes.post('/info', uploadPDF.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Arquivo PDF não fornecido' })
      return
    }

    const pdfBytes = fs.readFileSync(req.file.path)
    const pdfDoc = await PDFDocument.load(pdfBytes)
    const pages = pdfDoc.getPages()

    const info = {
      pageCount: pdfDoc.getPageCount(),
      title: pdfDoc.getTitle() || '',
      author: pdfDoc.getAuthor() || '',
      subject: pdfDoc.getSubject() || '',
      creator: pdfDoc.getCreator() || '',
      producer: pdfDoc.getProducer() || '',
      creationDate: pdfDoc.getCreationDate()?.toISOString() || '',
      modificationDate: pdfDoc.getModificationDate()?.toISOString() || '',
      pages: pages.map((p, i) => ({
        index: i,
        width: Math.round(p.getWidth()),
        height: Math.round(p.getHeight()),
        rotation: p.getRotation().angle,
      })),
      fileSize: req.file.size,
      fileName: req.file.originalname,
    }

    res.json(info)
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
  } catch (err) {
    logger.error('PDF info error:', err)
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    res.status(500).json({ error: 'Erro ao ler informações do PDF' })
  }
})
