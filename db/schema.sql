CREATE TABLE vendas (
  plataforma      TEXT        NOT NULL,
  id_transacao    TEXT        NOT NULL,
  status          TEXT        NOT NULL CHECK (status IN ('pendente', 'aprovada', 'recusada', 'cancelada', 'reembolsada', 'chargeback')),
  valor_centavos  INTEGER     NOT NULL CHECK (valor_centavos >= 0),
  moeda           CHAR(3)     NOT NULL,
  produto         TEXT        NOT NULL,
  email_comprador TEXT,
  ocorrido_em     TIMESTAMPTZ NOT NULL,
  recebido_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload         JSONB       NOT NULL,
  PRIMARY KEY (plataforma, id_transacao)
);

CREATE INDEX vendas_ocorrido_em_idx ON vendas (ocorrido_em);

-- Bloqueia a API REST pública do Supabase; a aplicação conecta direto no Postgres
ALTER TABLE vendas ENABLE ROW LEVEL SECURITY;
