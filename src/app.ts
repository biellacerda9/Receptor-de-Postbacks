import express, { type ErrorRequestHandler } from 'express'
import { assinaturaValida } from './assinatura.js'
import { salvarVenda } from './db.js'
import { exigirEnv } from './env.js'
import { vendaSchema } from './schema.js'

declare module 'node:http' {
  interface IncomingMessage {
    corpoBruto?: Buffer
  }
}

const app = express()

// Guarda os bytes originais: a assinatura é conferida sobre eles, não sobre o JSON já convertido
app.use(express.json({ verify: (req, _res, buf) => { req.corpoBruto = buf } }))

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/webhooks/:plataforma', async (req, res) => {
  if (!assinaturaValida(req.corpoBruto, req.header('X-Assinatura'), exigirEnv('WEBHOOK_SECRET'))) {
    res.status(401).json({ erro: 'assinatura inválida' })
    return
  }

  const resultado = vendaSchema.safeParse(req.body)
  if (!resultado.success) {
    res.status(400).json({
      erro: 'payload inválido',
      detalhes: resultado.error.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
    })
    return
  }

  // Minúsculas para que /webhooks/Hotmart e /webhooks/hotmart sejam a mesma plataforma
  const plataforma = req.params.plataforma.toLowerCase()
  const aplicada = await salvarVenda(plataforma, resultado.data, req.body)
  res.json({ resultado: aplicada ? 'aplicada' : 'ignorada' })
})

const tratarErro: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ erro: 'JSON malformado' })
    return
  }
  console.error(err)
  res.status(500).json({ erro: 'erro interno' })
}
app.use(tratarErro)

export default app
