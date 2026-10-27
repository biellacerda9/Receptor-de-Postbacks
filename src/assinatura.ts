import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

// Compara os hashes para ter sempre o mesmo tamanho e não vazar nem o comprimento do token
export function tokenValido(recebido: string | undefined, esperado: string): boolean {
  if (!recebido) return false
  const hash = (texto: string) => createHash('sha256').update(texto).digest()
  return timingSafeEqual(hash(recebido), hash(esperado))
}

export function assinaturaValida(corpo: Buffer | undefined, assinatura: string | undefined, segredo: string): boolean {
  if (!corpo || !assinatura) return false
  const esperada = createHmac('sha256', segredo).update(corpo).digest()
  const recebida = Buffer.from(assinatura, 'hex')
  // timingSafeEqual exige o mesmo tamanho; o tamanho de um SHA-256 não é segredo
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada)
}
