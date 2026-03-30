-- ════════════════════════════════════════════════════════
-- SISLOT — Views SQL para a Conferência de Caixa v3.0
-- ════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────
-- 1. vw_fechamento_boloes_enriquecidos
--    Enriquece fechamento_boloes com campos da tabela boloes
--    para permitir cards premium na direita.
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vw_fechamento_boloes_enriquecidos AS
SELECT
    fb.id,
    fb.fechamento_id,
    fb.bolao_id,
    fb.tipo,
    fb.modalidade,
    fb.concurso,
    fb.qtd_vendida     AS cotas_vendidas,
    fb.valor_cota,
    fb.subtotal,

    -- Campos enriquecidos da tabela boloes (ajuste os nomes conforme seu schema)
    b.origem_nome,
    b.codigo_loterico,
    b.qtd_jogos,
    b.qtd_dezenas,
    b.tipo_perspectiva

FROM fechamento_boloes fb
LEFT JOIN boloes b ON b.id = fb.bolao_id;

-- ────────────────────────────────────────────────────────
-- 2. vw_clientes_fechamento
--    Agrega totais por cliente usando as tabelas novas.
--    Substitui o uso de fechamento_dividas como fonte principal.
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vw_clientes_fechamento AS
SELECT
    cfc.cliente_id,
    cfc.fechamento_id,
    cfc.cliente_nome,
    cfc.telefone,
    cfc.documento,
    cfc.observacao_cliente,
    COUNT(cfe.id)              AS qtd_lancamentos,
    COALESCE(SUM(cfe.valor_total), 0) AS total_cliente_no_fechamento
FROM cliente_fechamento_cadastro cfc
LEFT JOIN cliente_fechamento_extrato cfe
    ON  cfe.cliente_id   = cfc.cliente_id
    AND cfe.fechamento_id = cfc.fechamento_id
GROUP BY
    cfc.cliente_id,
    cfc.fechamento_id,
    cfc.cliente_nome,
    cfc.telefone,
    cfc.documento,
    cfc.observacao_cliente;

-- ────────────────────────────────────────────────────────
-- Notas de uso no front:
--
-- qBoloesDireita(fechamentoId):
--   SELECT * FROM vw_fechamento_boloes_enriquecidos
--   WHERE fechamento_id = :fechamentoId
--
-- qClientesDireita(fechamentoId):
--   SELECT * FROM vw_clientes_fechamento
--   WHERE fechamento_id = :fechamentoId
--   ORDER BY total_cliente_no_fechamento DESC
--
-- qClienteLancamentos(fechamentoId, clienteId):
--   SELECT * FROM cliente_fechamento_extrato
--   WHERE fechamento_id = :fechamentoId AND cliente_id = :clienteId
--
-- qClienteItens(extratoId):
--   SELECT * FROM cliente_fechamento_itens
--   WHERE extrato_id = :extratoId
-- ────────────────────────────────────────────────────────
