import { Router, Request, Response } from 'express'
import { uploadAny } from '../middleware/upload.middleware'
import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'

export const conversionRoutes = Router()

conversionRoutes.post(
  '/',
  uploadAny.single('file'),
  async (req: Request, res: Response) => {
    const file = req.file as any

    try {
      if (!file) {
        res.status(400).json({ error: 'Arquivo não fornecido' })
        return
      }

      const { to } = req.body as any

      if (!to) {
        res.status(400).json({ error: 'Formato de saída não especificado' })
        return
      }

      logger.info(
        `Converting ${file.originalname} to ${to} for user ${req.user?.id}`
      )

      const inputPath = file.path
      const outputName = `${path.basename(
        inputPath,
        path.extname(inputPath)
      )}_converted`

      switch (to.toLowerCase()) {
        case 'txt': {
          const pdfBytes = fs.readFileSync(inputPath)
          const text = await extractTextFromPDF(pdfBytes)

          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${outputName}.txt"`
          )
          res.send(text)
          break
        }

        case 'png':
        case 'jpg':
        case 'jpeg': {
          const pdfBytes = fs.readFileSync(inputPath)
          const pdfDoc = await PDFDocument.load(pdfBytes)
          const page = pdfDoc.getPage(0)
          const { width, height } = page.getSize()

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
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${outputName}.${to}"`
          )
          res.send(imageBuffer)
          break
        }

        case 'pdf': {
          if (file.mimetype.startsWith('image/')) {
            const imageBuffer = fs.readFileSync(inputPath)
            const pdfDoc = await PDFDocument.create()

            const jpgBuffer = await sharp(imageBuffer).jpeg().toBuffer()
            const jpgImage = await pdfDoc.embedJpg(jpgBuffer)

            const page = pdfDoc.addPage([
              jpgImage.width,
              jpgImage.height
            ])

            page.drawImage(jpgImage, {
              x: 0,
              y: 0,
              width: jpgImage.width,
              height: jpgImage.height
            })

            const pdfBytes = await pdfDoc.save()

            res.setHeader('Content-Type', 'application/pdf')
            res.setHeader(
              'Content-Disposition',
              `attachment; filename="${outputName}.pdf"`
            )
            res.send(Buffer.from(pdfBytes))
          } else {
            res.status(400).json({
              error: 'Conversão para PDF suportada apenas para imagens'
            })
          }
          break
        }

        default:
          res
            .status(400)
            .json({ error: `Formato '${to}' não suportado` })
      }
    } catch (err: any) {
      logger.error('Conversion error:', err)
      res
        .status(500)
        .json({ error: err.message || 'Erro ao converter arquivo' })
    } finally {
      if (file && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path)
      }
    }
  }
)

// ── Extract text from PDF ───────────────────────────────

async function extractTextFromPDF(
  pdfBytes: Buffer
): Promise<string> {
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js')
    pdfjsLib.GlobalWorkerOptions.workerSrc = false

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBytes)
    })

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

    return (
      fullText ||
      'Não foi possível extrair texto deste PDF.'
    )
  } catch (err) {
    logger.error('Text extraction error:', err)
    return 'Erro ao extrair texto do PDF.'
  }
}
