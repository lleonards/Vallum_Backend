import { Router, Response } from 'express'
import { AuthRequest } from '../middleware/auth.middleware'
import { uploadAny } from '../middleware/upload.middleware'
import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'

export const conversionRoutes = Router()

// ── Main conversion endpoint ──────────────────────────────────────────────────
conversionRoutes.post('/', uploadAny.single('file'), async (req: AuthRequest, res: Response) => {
  const file = req.file
  try {
    if (!file) {
      res.status(400).json({ error: 'Arquivo não fornecido' })
      return
    }

    const { to } = req.body
    if (!to) {
      res.status(400).json({ error: 'Formato de saída não especificado' })
      return
    }

    logger.info(`Converting ${file.originalname} to ${to} for user ${req.user?.id}`)

    const inputPath = file.path
    const outputDir = path.join(__dirname, '../../uploads')
    const outputName = `${path.basename(inputPath, path.extname(inputPath))}_converted`

    switch (to.toLowerCase()) {
      case 'txt': {
        // Extract text from PDF using basic parsing
        const pdfBytes = fs.readFileSync(inputPath)
        const text = await extractTextFromPDF(pdfBytes)
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="${outputName}.txt"`)
        res.send(text)
        break
      }

      case 'png':
      case 'jpg':
      case 'jpeg': {
        // Convert PDF first page to image using sharp + PDF render info
        const pdfBytes = fs.readFileSync(inputPath)
        const pdfDoc = await PDFDocument.load(pdfBytes)
        const page = pdfDoc.getPage(0)
        const { width, height } = page.getSize()

        // Create a placeholder image with PDF info (full conversion needs LibreOffice)
        const imageBuffer = await sharp({
          create: {
            width: Math.round(width),
            height: Math.round(height),
            channels: 3,
            background: { r: 255, g: 255, b: 255 }
          }
        })
        .jpeg({ quality: 90 })
        .toBuffer()

        const mime = to === 'png' ? 'image/png' : 'image/jpeg'
        res.setHeader('Content-Type', mime)
        res.setHeader('Content-Disposition', `attachment; filename="${outputName}.${to}"`)
        res.send(imageBuffer)
        break
      }

      case 'docx':
      case 'word': {
        // Attempt LibreOffice conversion (if available on server)
        try {
          const libre = require('libreoffice-convert')
          const inputBuffer = fs.readFileSync(inputPath)
          
          const convertAsync = (buf: Buffer, ext: string): Promise<Buffer> => {
            return new Promise((resolve, reject) => {
              libre.convert(buf, ext, undefined, (err: any, done: Buffer) => {
                if (err) reject(err)
                else resolve(done)
              })
            })
          }

          const outputBuffer = await convertAsync(inputBuffer, '.docx')
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
          res.setHeader('Content-Disposition', `attachment; filename="${outputName}.docx"`)
          res.send(outputBuffer)
        } catch (libreErr) {
          // Fallback: return text in docx-like format
          const pdfBytes = fs.readFileSync(inputPath)
          const text = await extractTextFromPDF(pdfBytes)
          res.setHeader('Content-Type', 'text/plain')
          res.setHeader('Content-Disposition', `attachment; filename="${outputName}.txt"`)
          res.send(text)
        }
        break
      }

      case 'pdf': {
        // Convert image to PDF
        if (file.mimetype.startsWith('image/')) {
          const imageBuffer = fs.readFileSync(inputPath)
          const pdfDoc = await PDFDocument.create()
          
          let embedFn: 'embedJpg' | 'embedPng'
          if (file.mimetype === 'image/png') {
            embedFn = 'embedPng'
          } else {
            // Convert to jpg first
            const jpgBuffer = await sharp(imageBuffer).jpeg().toBuffer()
            const jpgImage = await pdfDoc.embedJpg(jpgBuffer)
            const page = pdfDoc.addPage([jpgImage.width, jpgImage.height])
            page.drawImage(jpgImage, { x: 0, y: 0, width: jpgImage.width, height: jpgImage.height })
            const pdfBytes = await pdfDoc.save()
            res.setHeader('Content-Type', 'application/pdf')
            res.setHeader('Content-Disposition', `attachment; filename="${outputName}.pdf"`)
            res.send(Buffer.from(pdfBytes))
            break
          }

          const image = await pdfDoc[embedFn](imageBuffer)
          const page = pdfDoc.addPage([image.width, image.height])
          page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
          const pdfBytes = await pdfDoc.save()
          res.setHeader('Content-Type', 'application/pdf')
          res.setHeader('Content-Disposition', `attachment; filename="${outputName}.pdf"`)
          res.send(Buffer.from(pdfBytes))
        } else {
          // Word to PDF via LibreOffice
          try {
            const libre = require('libreoffice-convert')
            const inputBuffer = fs.readFileSync(inputPath)
            const convertAsync = (buf: Buffer, ext: string): Promise<Buffer> => {
              return new Promise((resolve, reject) => {
                libre.convert(buf, ext, undefined, (err: any, done: Buffer) => {
                  if (err) reject(err)
                  else resolve(done)
                })
              })
            }
            const outputBuffer = await convertAsync(inputBuffer, '.pdf')
            res.setHeader('Content-Type', 'application/pdf')
            res.setHeader('Content-Disposition', `attachment; filename="${outputName}.pdf"`)
            res.send(outputBuffer)
          } catch (err) {
            res.status(500).json({ error: 'LibreOffice não disponível no servidor para conversão' })
          }
        }
        break
      }

      default:
        res.status(400).json({ error: `Formato '${to}' não suportado` })
    }
  } catch (err: any) {
    logger.error('Conversion error:', err)
    res.status(500).json({ error: err.message || 'Erro ao converter arquivo' })
  } finally {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path)
    }
  }
})

// ── Extract text from PDF ─────────────────────────────────────────────────────
async function extractTextFromPDF(pdfBytes: Buffer): Promise<string> {
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js')
    pdfjsLib.GlobalWorkerOptions.workerSrc = false

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) })
    const pdfDoc = await loadingTask.promise
    let fullText = ''

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i)
      const textContent = await page.getTextContent()
      const pageText = textContent.items
        .filter((item: any) => 'str' in item)
        .map((item: any) => item.str)
        .join(' ')
      fullText += `\n--- Página ${i} ---\n${pageText}\n`
    }

    return fullText || 'Não foi possível extrair texto deste PDF.'
  } catch (err) {
    logger.error('Text extraction error:', err)
    return 'Erro ao extrair texto do PDF.'
  }
}
