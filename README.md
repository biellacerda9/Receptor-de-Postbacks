# Receptor de Postbacks

Aplicação em TypeScript que recebe por webhook as vendas notificadas por plataformas de checkout e devolve um relatório consolidado.

**URL pública:** https://receptor-de-postbacks-7xgc.vercel.app

Stack: Node + TypeScript, Express 5, Zod, Postgres (Supabase), Vitest. Deploy na Vercel.

Os valores de `WEBHOOK_SECRET` e `RELATORIO_TOKEN` da aplicação publicada foram enviados no e-mail da entrega, e não ficam no repositório público.

## Como chamar

### POST: receber uma venda

```
POST /webhooks/:plataforma
Content-Type: application/json
X-Assinatura: <HMAC-SHA256 do corpo, em hexadecimal, com o segredo WEBHOOK_SECRET>
```

```bash
CORPO='{"id_transacao":"HP-123456","status":"aprovada","valor_centavos":19700,"moeda":"BRL","produto":"Curso de Excel","email_comprador":"joao@email.com","ocorrido_em":"2026-10-25T14:30:00-03:00"}'
ASSINATURA=$(printf '%s' "$CORPO" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

curl -X POST https://receptor-de-postbacks-7xgc.vercel.app/webhooks/hotmart \
  -H "Content-Type: application/json" \
  -H "X-Assinatura: $ASSINATURA" \
  -d "$CORPO"
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `id_transacao` | sim | texto não vazio; junto com a plataforma, identifica a venda |
| `status` | sim | `pendente`, `aprovada`, `recusada`, `cancelada`, `reembolsada` ou `chargeback` |
| `valor_centavos` | sim | inteiro ≥ 0 (19700 = R$ 197,00) |
| `moeda` | sim | código ISO 4217 em maiúsculas (`BRL`, `USD`) |
| `produto` | sim | texto não vazio |
| `email_comprador` | não | e-mail válido |
| `ocorrido_em` | sim | data ISO 8601 com fuso (`-03:00` ou `Z`) |

Respostas:

| Status | Quando |
|---|---|
| `200 {"resultado":"aplicada"}` | Venda nova ou atualização de status mais recente |
| `200 {"resultado":"ignorada"}` | Notificação repetida ou mais antiga que a já registrada |
| `400` | JSON malformado ou campo inválido (a resposta diz qual) |
| `401` | Assinatura ausente ou inválida |
| `500` | Erro interno (ex.: banco indisponível); a plataforma deve reenviar |

### GET: relatório

```bash
curl "https://receptor-de-postbacks-7xgc.vercel.app/relatorio?inicio=2026-10-01&fim=2026-10-31&plataforma=hotmart" \
  -H "Authorization: Bearer $RELATORIO_TOKEN"
```

Filtros opcionais: `inicio` e `fim` (`AAAA-MM-DD`, dias no horário de Brasília, `fim` inclusivo) e `plataforma`.

```json
{
  "filtros": { "inicio": "2026-10-01", "fim": "2026-10-31", "plataforma": "hotmart" },
  "por_moeda": [
    {
      "moeda": "BRL",
      "vendas_aprovadas": 1,
      "receita_bruta_centavos": 39400,
      "receita_bruta_formatada": "R$ 394,00",
      "reembolsos_centavos": 19700,
      "reembolsos_formatada": "R$ 197,00",
      "receita_liquida_centavos": 19700,
      "receita_liquida_formatada": "R$ 197,00",
      "quantidade_por_status": { "pendente": 0, "aprovada": 1, "recusada": 0, "cancelada": 0, "reembolsada": 1, "chargeback": 0 }
    }
  ]
}
```

- **receita bruta:** vendas pagas em algum momento (`aprovada` + `reembolsada` + `chargeback`)
- **reembolsos:** `reembolsada` + `chargeback`
- **receita líquida:** `aprovada`

`GET /health` responde `{"ok":true}` sem autenticação.

## Premissas e decisões

### O que pode acontecer com webhooks reais, e como foi tratado

- **A mesma notificação chega mais de uma vez.** Plataformas reenviam quando não recebem resposta a tempo. A chave primária `(plataforma, id_transacao)` com `INSERT ... ON CONFLICT` torna o endpoint idempotente: o reenvio não cria outra venda e recebe 200, para a plataforma parar de tentar.
- **A venda muda de status** (aprovada → reembolsada). A tabela guarda uma linha por venda com o estado mais recente.
- **Notificações chegam fora de ordem.** O upsert só atualiza se o `ocorrido_em` recebido for mais recente que o salvo. Uma aprovação atrasada não sobrescreve um reembolso.
- **Duas notificações iguais ao mesmo tempo.** O upsert é um único comando atômico no Postgres. Fazer `SELECT` e depois `INSERT` abriria uma race condition entre os dois comandos.
- **Requisições falsas.** A URL é pública. Cada POST precisa da assinatura HMAC-SHA256 do corpo com um segredo compartilhado; diferente de um token fixo, o segredo nunca trafega, e a assinatura também detecta corpo alterado. A assinatura é conferida sobre os **bytes originais** (reconverter o JSON mudaria espaços e formatação) e comparada com `timingSafeEqual`, para não vazar informação pelo tempo de resposta. Uma requisição legítima capturada e reenviada (replay) não tem efeito, por causa da idempotência.
- **Payload inválido.** Validado com Zod; erro 400 indicando o campo. Campos extras são aceitos e ignorados, porque plataformas adicionam campos sem aviso, e o JSON original é guardado em `payload` para auditoria.
- **Banco fora do ar.** Responde 500, sem detalhes internos; a plataforma reenvia mais tarde. Responder 200 perderia a venda.

### Dados

- **Dinheiro em centavos inteiros.** Float erra contas decimais (`0.1 + 0.2 ≠ 0.3`). Valor não inteiro é **rejeitado, não arredondado**: meio centavo indica erro na origem (ex.: reais enviados como centavos), e arredondar esconderia o erro.
- **Moeda obrigatória; relatório separado por moeda, sem conversão.** Converter exigiria uma API de cotação externa, uma decisão sobre qual data usar e ainda não bateria com o valor repassado pela plataforma.
- **Data com fuso obrigatória.** `ocorrido_em` é quando a venda aconteceu, não quando a notificação chegou; sem fuso, a venda poderia cair no dia errado. Os filtros do relatório usam o horário de Brasília.
- **Valores no relatório em centavos e formatados.** Os centavos servem a sistemas (sem float); o texto formatado, a pessoas.
- **Status desconhecido é rejeitado**, pois o relatório não saberia classificá-lo.
- **Plataforma na URL** (`/webhooks/hotmart`), normalizada em minúsculas.
- **Formato genérico próprio.** O desafio não define a plataforma. Suportar Hotmart, Kiwify etc. seria um adaptador por plataforma convertendo para este formato.

### Infraestrutura

- **Postgres gerenciado (Supabase) em vez de banco local ou SQLite.** A aplicação precisa estar pública e sempre no ar; em serverless não há disco permanente, e um SQLite seria perdido.
- **Conexão pelo pooler em modo transação**, adequado a funções serverless que abrem muitas conexões curtas.
- **RLS ligado sem regras na tabela**, fechando a API REST automática do Supabase; a aplicação conecta direto no Postgres.
- **`CHECK` no banco repetindo as regras do Zod** (status e valor ≥ 0), como defesa em profundidade.
- **Relatório protegido por token Bearer**, porque expõe faturamento. Um token basta: quem consulta é uma pessoa ou sistema de confiança, via HTTPS.
- **SQL puro, sem ORM**, para o upsert e as agregações ficarem explícitos.

### O que decidi não fazer (e como evoluiria)

- **Histórico de eventos.** Cada venda guarda só o estado atual, então o filtro de período usa a data da última movimentação: uma venda de setembro reembolsada em outubro aparece em outubro. Uma tabela de eventos resolveria isso, ao custo de mais complexidade.
- **Fila (SQS, Redis).** Para o volume esperado, gravar direto é rápido o bastante. Com volume alto, o POST só enfileiraria e responderia 200, e um worker processaria depois.
- **Formatos reais de plataformas e um segredo por plataforma.**
- **Timestamp na assinatura** para rejeitar mensagens antigas; hoje o replay já é neutralizado pela idempotência.
- **Conversão de moedas, autenticação de usuários e dashboard visual.**
- **Rate limiting**, que ficaria a cargo da infraestrutura (ex.: firewall da Vercel).

## Rodando localmente

```bash
npm install
cp .env.example .env   # preencha DATABASE_URL, WEBHOOK_SECRET e RELATORIO_TOKEN
# crie a tabela executando db/schema.sql no banco
npm run dev            # http://localhost:3000
npm test               # testes de integração contra o banco do .env
```

Os testes usam uma plataforma com nome aleatório e apagam os próprios dados ao final.
