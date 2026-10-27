import postgres from 'postgres'
import { exigirEnv } from './env.js'
import type { Venda } from './schema.js'

// prepare: false porque o pooler do Supabase em modo transação não suporta prepared statements
export const sql = postgres(exigirEnv('DATABASE_URL'), { prepare: false })

// Insere a venda ou, se ela já existe, atualiza só quando o evento é mais novo que o salvo.
// Retorna false quando o evento foi ignorado (duplicado ou fora de ordem).
export async function salvarVenda(plataforma: string, venda: Venda, payload: unknown): Promise<boolean> {
  const linhas = await sql`
    INSERT INTO vendas (plataforma, id_transacao, status, valor_centavos, moeda, produto, email_comprador, ocorrido_em, payload)
    VALUES (
      ${plataforma}, ${venda.id_transacao}, ${venda.status}, ${venda.valor_centavos}, ${venda.moeda},
      ${venda.produto}, ${venda.email_comprador ?? null}, ${venda.ocorrido_em}, ${sql.json(payload as postgres.JSONValue)}
    )
    ON CONFLICT (plataforma, id_transacao) DO UPDATE SET
      status          = EXCLUDED.status,
      valor_centavos  = EXCLUDED.valor_centavos,
      moeda           = EXCLUDED.moeda,
      produto         = EXCLUDED.produto,
      email_comprador = EXCLUDED.email_comprador,
      ocorrido_em     = EXCLUDED.ocorrido_em,
      recebido_em     = now(),
      payload         = EXCLUDED.payload
    WHERE vendas.ocorrido_em < EXCLUDED.ocorrido_em
    RETURNING 1
  `
  return linhas.length > 0
}
