import { z } from 'zod'
import { sql } from './db.js'
import { STATUS } from './schema.js'

export const filtrosSchema = z.object({
  inicio: z.iso.date().optional(),
  fim: z.iso.date().optional(),
  plataforma: z.string().trim().toLowerCase().min(1).optional(),
})

type Filtros = z.infer<typeof filtrosSchema>

const PAGAS = ['aprovada', 'reembolsada', 'chargeback']
const DEVOLVIDAS = ['reembolsada', 'chargeback']

// Datas do filtro são dias no horário de Brasília; `fim` é inclusivo
export async function gerarRelatorio(filtros: Filtros) {
  const linhas = await sql<{ moeda: string; status: string; quantidade: number; total: string }[]>`
    SELECT moeda, status, count(*)::int AS quantidade, sum(valor_centavos)::int8 AS total
    FROM vendas
    WHERE true
      ${filtros.inicio ? sql`AND ocorrido_em >= ${filtros.inicio}::date::timestamp AT TIME ZONE 'America/Sao_Paulo'` : sql``}
      ${filtros.fim ? sql`AND ocorrido_em < (${filtros.fim}::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'` : sql``}
      ${filtros.plataforma ? sql`AND plataforma = ${filtros.plataforma}` : sql``}
    GROUP BY moeda, status
    ORDER BY moeda
  `

  const moedas = Map.groupBy(linhas, (l) => l.moeda)
  const por_moeda = [...moedas].map(([moeda, grupo]) => {
    // int8 chega como texto para não estourar o Number do JS; os totais cabem com folga
    const somar = (status: string[]) => grupo.filter((l) => status.includes(l.status)).reduce((s, l) => s + Number(l.total), 0)
    const bruta = somar(PAGAS)
    const reembolsos = somar(DEVOLVIDAS)
    const liquida = somar(['aprovada'])
    const formatar = (centavos: number) =>
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda }).format(centavos / 100)

    return {
      moeda,
      vendas_aprovadas: grupo.find((l) => l.status === 'aprovada')?.quantidade ?? 0,
      receita_bruta_centavos: bruta,
      receita_bruta_formatada: formatar(bruta),
      reembolsos_centavos: reembolsos,
      reembolsos_formatada: formatar(reembolsos),
      receita_liquida_centavos: liquida,
      receita_liquida_formatada: formatar(liquida),
      quantidade_por_status: Object.fromEntries(STATUS.map((s) => [s, grupo.find((l) => l.status === s)?.quantidade ?? 0])),
    }
  })

  return { filtros, por_moeda }
}
