import { createHmac, timingSafeEqual } from 'node:crypto'

export function assinaturaValida(corpo: Buffer | undefined, assinatura: string | undefined, segredo: string): boolean {
  if (!corpo || !assinatura) return false
  const esperada = createHmac('sha256', segredo).update(corpo).digest()
  const recebida = Buffer.from(assinatura, 'hex')
  // timingSafeEqual exige o mesmo tamanho; o tamanho de um SHA-256 não é segredo
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada)
}
