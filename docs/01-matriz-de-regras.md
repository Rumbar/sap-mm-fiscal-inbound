# Matriz de Regras de Validação — Recebimento Fiscal (MM Inbound)

Documento funcional. Cada regra abaixo descreve **o que o sistema deve verificar** no recebimento de uma NF-e de fornecedor, **onde essa regra vive no SAP** e **o que acontece quando ela falha**.

Convenção de criticidade:
- **Bloqueante**: impede o lançamento (nota vai para a fila de pendências fiscais)
- **Bloqueio de fatura**: permite a entrada de mercadoria, mas trava o pagamento

---

## Bloco 1 — Validação estrutural do documento fiscal

Executada antes de qualquer consulta ao pedido. É o papel do monitor de NF-e (GRC NF-e / cockpit J1B*).

| # | Regra | Onde vive no SAP | Motivo de negócio | Se falhar |
|---|---|---|---|---|
| E1 | Chave de acesso deve ter 44 dígitos e DV válido (módulo 11, pesos 2–9) | Validação do inbound de NF-e / GRC NF-e | Chave inválida indica XML corrompido ou adulterado; a chave é o identificador único do documento perante a SEFAZ | Bloqueante |
| E2 | CFOP informado deve ser de saída do emitente (5xxx, 6xxx ou 7xxx) | Determinação de CFOP — J1BTAX → CFOP Determinação MM (tabela J_1BAONV) | O fornecedor emite com CFOP de saída; se vier 1xxx algo está invertido no documento | Bloqueante |
| E3 | ICMS destacado deve ser igual a base × alíquota (tolerância R$ 0,02) | Cálculo de imposto — J1BTAX | Destaque inconsistente gera crédito indevido e risco em fiscalização | Bloqueante |
| E4 | NF-e não pode ter sido lançada anteriormente (chave já existente) | Verificação de duplicidade no docto fiscal | Evita duplicidade de crédito de ICMS/IPI e duplicidade de pagamento ao fornecedor | Bloqueante |

---

## Bloco 2 — Confronto NF-e × Pedido de Compra (three-way match)

Executada após buscar o pedido no S/4 (`API_PURCHASE_ORDER_SRV`).

| # | Regra | Onde vive no SAP | Motivo de negócio | Se falhar |
|---|---|---|---|---|
| M1 | Pedido informado na NF-e (`xPed`) deve existir e estar liberado | ME23N / estratégia de liberação ME29N | Recebimento sem pedido liberado quebra o controle orçamentário e a segregação de funções | Bloqueante |
| M2 | CNPJ do emitente deve ser o CNPJ do fornecedor do pedido | Dados mestres do fornecedor — campo STCD1 (BP) | Nota de terceiro contra pedido próprio indica erro de emissão ou tentativa de fraude | Bloqueante |
| M3 | Quantidade da NF-e não pode exceder a quantidade em aberto do item | Tolerância de sobreentrega no item do pedido, herdada do registro info de compras ou do cadastro do material | Recebimento acima do contratado gera estoque e obrigação de pagamento não autorizados | Bloqueante (msg M7 022) |
| M4 | Preço unitário da NF-e deve bater com o preço líquido do item (tolerância 1%) | Chaves de tolerância — OMR6 (PP = variação de preço; DQ = variação de quantidade), por empresa | Divergência de preço é a causa mais comum de pagamento indevido a fornecedor | Bloqueio automático da fatura para pagamento; liberação por MRBR |
| M5 | CFOP de entrada derivado deve ser o esperado para o item | Determinação de CFOP — J1BTAX → CFOP Determinação MM (tabela J_1BAONV), por categoria do material, tipo de item da NF e destinação | O CFOP define o direito a crédito e a natureza da operação na escrituração | Bloqueante |
| M6 | NCM da NF-e deve conferir com o cadastro do material | Dados mestres do material — visão Comércio Exterior / grupo de imposto | NCM errado leva a alíquota e tratamento tributário errados na cadeia | Bloqueante |
| M7 | Alíquota de ICMS deve corresponder à operação (interna MG = 18%, art. 42, I, "e" do RICMS/MG) | Tabelas de alíquota — J1BTAX / condições de imposto | Crédito de ICMS a maior ou a menor gera passivo fiscal | Bloqueante |

### Derivação de CFOP aplicada (regra M5)

| CFOP de saída do fornecedor | CFOP de entrada correspondente | Natureza |
|---|---|---|
| 5xxx (dentro do estado) | 1xxx | Operação interna |
| 6xxx (fora do estado) | 2xxx | Operação interestadual |
| 7xxx (exterior) | 3xxx | Importação |

Exemplo do cenário modelado: fornecedor em MG emite **5102** (venda de mercadoria adquirida de terceiros) → entrada esperada **1102** (compra para comercialização).

---

## Bloco 3 — Regras do lado do sistema de registro

Estas regras são validadas **novamente** pelo próprio "SAP" no momento do lançamento, independentemente do que o orquestrador tenha verificado. É o comportamento correto: o sistema de registro nunca confia cegamente no integrador.

| # | Regra | Transação equivalente | Comportamento |
|---|---|---|---|
| S1 | Entrada de mercadoria exige pedido liberado | MIGO — mov. 101 | Rejeita o lançamento |
| S2 | Quantidade não pode exceder a quantidade em aberto | MIGO | Rejeita (msg M7 022) |
| S3 | Fatura exige entrada de mercadoria prévia (GR-based IV) | MIRO | Rejeita o lançamento |
| S4 | Valor da fatura deve bater com (qtde recebida × preço) + IPI, tolerância 1% | MIRO | Bloqueio automático para pagamento (liberação por MRBR) |
| S5 | Chave de NF-e não pode estar lançada em outra fatura | MIRO / docto fiscal | Rejeita por duplicidade |
| S6 | Fatura bloqueada só é paga após liberação manual | MRBR | Fatura permanece bloqueada até análise |

> **Nota sobre o bloqueio de fatura**: no S/4HANA, quando uma variação excede a tolerância da OMR6, o bloqueio automático grava `MRM_ZLSPR = 'A'` na tabela `RBKP_BLOCKED`, e o motivo do bloqueio fica no item (campo `DRSEG-SPGRP`). O documento FI recebe a chave de bloqueio de pagamento no campo `ZLSPR`. A liberação é feita pela transação **MRBR**. Neste modelo, a fatura é rejeitada em vez de lançada bloqueada — simplificação assumida, já que não há fluxo de liberação implementado.

> **Nota sobre GR-based IV**: a exigência de entrada de mercadoria antes da fatura vem do indicador *Recebimento fatura baseado em entrada de mercadoria* no item do pedido, herdado dos dados de compras do fornecedor. Neste modelo ele está ativo em todos os itens.

---

## Bloco 4 — Tratamento de exceção

Quando qualquer regra bloqueante falha, o documento **não é lançado** e segue para a fila de pendências fiscais com:

- Chave de acesso e número da NF-e
- Fornecedor emitente
- Lista completa das divergências encontradas (não apenas a primeira)
- Pedido de compra relacionado

A lista completa é intencional: o analista fiscal precisa ver todos os problemas de uma vez para acionar o fornecedor uma única vez, em vez de descobrir um erro por rodada.

---

## Escopo e limitações declaradas

**O que este modelo cobre**: fluxo de compra de material para estoque, operação nacional, NF-e modelo 55 com item único, tributação ICMS/IPI.

**O que este modelo não cobre**: ICMS-ST e substituição tributária, DIFAL, notas com múltiplos itens e rateio, importação (CFOP 3xxx e adições de DI), serviços (NFS-e e ISS), devoluções e notas complementares, remessa e retorno de industrialização.

**Pontos verificados em documentação pública** (SAP Community, SAP Help, SAP Learning, RICMS/MG): chaves de tolerância PP e DQ na OMR6 por empresa; mensagem M7 022 para sobreentrega em recebimento contra pedido, com tolerância herdada do registro info ou do cadastro do material; determinação de CFOP de entrada pela J1BTAX → CFOP Determinação MM (tabela `J_1BAONV`), sendo `J_1BAPNV` a equivalente de saída em SD; alíquota interna de ICMS em MG de 18% (art. 42, I, "e" do RICMS/MG), com exceções por produto e adicional do FEM em itens específicos; mecanismo de bloqueio automático de fatura e liberação pela MRBR.

**Pontos ainda não verificados contra instância**: campo exato do indicador GR-based IV no item do pedido, e comportamento do vínculo NF-e ↔ documento MM no S/4HANA Cloud Public Edition, cuja localização Brasil difere do ECC.

**O que este modelo não demonstra**: configuração real de SPRO. As regras foram modeladas segundo o comportamento esperado do S/4HANA com a localização Brasil, não parametrizadas numa instância. O objetivo é demonstrar domínio do processo e das regras fiscais, não capacidade de customizing.
