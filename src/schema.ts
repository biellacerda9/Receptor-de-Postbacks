import { z } from 'zod'

export const STATUS = ['pendente', 'aprovada', 'recusada', 'cancelada', 'reembolsada', 'chargeback'] as const

export const vendaSchema = z.object({
  id_transacao: z.string().trim().min(1),
  status: z.enum(STATUS),
  valor_centavos: z.number().int().nonnegative(),
  moeda: z.string().regex(/^[A-Z]{3}$/, 'código ISO 4217 em maiúsculas, ex.: BRL'),
  produto: z.string().trim().min(1),
  email_comprador: z.email().optional(),
  ocorrido_em: z.iso.datetime({ offset: true }),
})

export type Venda = z.infer<typeof vendaSchema>
