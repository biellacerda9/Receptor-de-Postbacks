import { createHmac, randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import app from '../src/app.js'
import { sql } from '../src/db.js'

// Cada execução usa uma plataforma própria para não misturar com dados reais
const plataforma = `teste-${randomUUID()}`

function enviar(corpo: object, assinatura?: string) {
  const texto = JSON.stringify(corpo)
  return request(app)
    .post(`/webhooks/${plataforma}`)
    .set('Content-Type', 'application/json')
    .set('X-Assinatura', assinatura ?? createHmac('sha256', process.env.WEBHOOK_SECRET!).update(texto).digest('hex'))
    .send(texto)
}

function relatorio() {
  return request(app)
    .get('/relatorio')
    .query({ plataforma })
    .set('Authorization', `Bearer ${process.env.RELATORIO_TOKEN}`)
}

const venda = (id: string, status: string, ocorrido_em: string, valor_centavos = 10000) => ({
  id_transacao: id, status, valor_centavos, moeda: 'BRL', produto: 'Curso', ocorrido_em,
})

afterAll(async () => {
  await sql`DELETE FROM vendas WHERE plataforma = ${plataforma}`
  await sql.end()
})

describe('POST /webhooks/:plataforma', () => {
  it('rejeita assinatura inválida', async () => {
    const res = await enviar(venda('A', 'aprovada', '2026-10-25T10:00:00-03:00'), 'ab'.repeat(32))
    expect(res.status).toBe(401)
  })

  it('rejeita payload inválido dizendo o campo', async () => {
    const res = await enviar(venda('A', 'aprovada', '2026-10-25T10:00:00-03:00', 197.5))
    expect(res.status).toBe(400)
    expect(res.body.detalhes[0].campo).toBe('valor_centavos')
  })

  it('ignora a mesma venda enviada duas vezes', async () => {
    const corpo = venda('DUP', 'aprovada', '2026-10-25T10:00:00-03:00')
    expect((await enviar(corpo)).body.resultado).toBe('aplicada')
    expect((await enviar(corpo)).body.resultado).toBe('ignorada')
  })

  it('aplica o reembolso e ignora a aprovação que chega atrasada', async () => {
    expect((await enviar(venda('REE', 'aprovada', '2026-10-25T14:00:00-03:00'))).body.resultado).toBe('aplicada')
    expect((await enviar(venda('REE', 'reembolsada', '2026-10-25T16:00:00-03:00'))).body.resultado).toBe('aplicada')
    expect((await enviar(venda('REE', 'aprovada', '2026-10-25T14:00:00-03:00'))).body.resultado).toBe('ignorada')
  })
})

describe('GET /relatorio', () => {
  it('exige token', async () => {
    const res = await request(app).get('/relatorio')
    expect(res.status).toBe(401)
  })

  it('soma bruta, reembolsos e líquida a partir do estado final', async () => {
    // Estado vindo dos testes anteriores: DUP aprovada (100,00) e REE reembolsada (100,00)
    const res = await relatorio()
    expect(res.status).toBe(200)
    expect(res.body.por_moeda).toHaveLength(1)
    expect(res.body.por_moeda[0]).toMatchObject({
      moeda: 'BRL',
      vendas_aprovadas: 1,
      receita_bruta_centavos: 20000,
      reembolsos_centavos: 10000,
      receita_liquida_centavos: 10000,
      quantidade_por_status: { aprovada: 1, reembolsada: 1 },
    })
  })

  it('filtra por período no horário de Brasília', async () => {
    // 23:30 de 26/10 em Brasília já é 27/10 em UTC, mas deve contar no dia 26
    await enviar(venda('NOITE', 'aprovada', '2026-10-26T23:30:00-03:00'))
    const res = await relatorio().query({ plataforma, inicio: '2026-10-26', fim: '2026-10-26' })
    expect(res.body.por_moeda[0].vendas_aprovadas).toBe(1)
    expect(res.body.por_moeda[0].receita_bruta_centavos).toBe(10000)
  })
})
