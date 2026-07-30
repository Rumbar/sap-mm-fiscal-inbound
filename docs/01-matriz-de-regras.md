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
| E5 | Dígito verificador do CNPJ do emitente | Validação de dados mestres de fornecedor | Não implementado — ver limitações declaradas | — |
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
| M5a | Abrangência geográfica: o primeiro dígito do CFOP de saída deve corresponder ao primeiro dígito do CFOP de entrada do item | Determinação de CFOP — J1BTAX → CFOP Determinação MM (tabela J_1BAONV) | Operação interna escriturada como interestadual (ou vice-versa) distorce apuração e obrigações acessórias | Bloqueante |
| M5b | Natureza da operação do fornecedor deve ser compatível com a destinação do material | Cadastro do material (categoria de CFOP) e tipo de item da NF | Venda de ativo imobilizado recebida como compra para industrialização gera crédito e classificação contábil indevidos | Bloqueante |
| M6 | NCM da NF-e deve conferir com o cadastro do material | Dados mestres do material — visão Comércio Exterior / grupo de imposto | NCM errado leva a alíquota e tratamento tributário errados na cadeia | Bloqueante |
| M7 | Alíquota de ICMS deve corresponder à operação (interna MG = 18%, art. 42, I, "e" do RICMS/MG) | Tabelas de alíquota — J1BTAX / condições de imposto | Crédito de ICMS a maior ou a menor gera passivo fiscal | Bloqueante |

### Como o CFOP de entrada é determinado (regras M5a e M5b)

O CFOP de entrada **não é uma tradução mecânica** do CFOP do fornecedor. Só o primeiro dígito é derivável dele:

| Primeiro dígito na saída | Primeiro dígito na entrada | Abrangência |
|---|---|---|
| 5 | 1 | Operação interna |
| 6 | 2 | Operação interestadual |
| 7 | 3 | Importação |

Os três dígitos restantes vêm da **destinação que o comprador dá ao material** — informação que está no cadastro do material e no tipo de item da NF, não no documento do fornecedor. O mesmo CFOP 5102 pode gerar entrada 1101 (industrialização), 1102 (comercialização) ou 1556 (uso e consumo), dependendo do comprador.

O que se valida, então, é a **compatibilidade** entre a natureza da operação do fornecedor e a destinação esperada:

| Natureza na saída | Destinações compatíveis na entrada |
|---|---|
| 101 — venda de produção do estabelecimento | 101 (industrialização), 102 (comercialização) |
| 102 — venda de mercadoria adquirida de terceiros | 101, 102 |
| 551 — venda de bem do ativo imobilizado | 551 |
| 556 — venda de material de uso e consumo | 556 |

Cenário modelado: fornecedor em MG emite **5101** contra um pedido de chapa de aço destinada a industrialização, cujo CFOP de entrada esperado é **1101**. Compatível. Já um **5551** contra o mesmo pedido é rejeitado — venda de ativo não corresponde a compra de insumo.

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

**O que este modelo não cobre**: ICMS-ST e substituição tributária, DIFAL, PIS e COFINS, notas com múltiplos itens e rateio, importação (CFOP 3xxx e adições de DI), serviços (NFS-e e ISS), devoluções e notas complementares, remessa e retorno de industrialização, validação do dígito verificador de CNPJ, e a representação do documento fiscal em si (no S/4HANA a NF-e gera um documento próprio, `J_1BNFDOC`, vinculado ao documento de material — aqui a chave é gravada apenas como campo da fatura).

**Sobre os XMLs de teste**: são uma versão reduzida do leiaute 4.00, sem `protNFe`, sem assinatura digital e sem os grupos completos exigidos pela SEFAZ. Servem para exercitar as regras do processo, não para validar leiaute.

**Sobre as alíquotas usadas**: a alíquota de ICMS de 18% foi verificada contra o RICMS/MG. A alíquota de IPI de 5% aplicada nos XMLs é ilustrativa e não foi conferida contra a TIPI para a NCM específica.

**Pontos verificados em documentação pública** (SAP Community, SAP Help, SAP Learning, RICMS/MG): chaves de tolerância PP e DQ na OMR6 por empresa; mensagem M7 022 para sobreentrega em recebimento contra pedido, com tolerância herdada do registro info ou do cadastro do material; determinação de CFOP de entrada pela J1BTAX → CFOP Determinação MM (tabela `J_1BAONV`), sendo `J_1BAPNV` a equivalente de saída em SD; alíquota interna de ICMS em MG de 18% (art. 42, I, "e" do RICMS/MG), com exceções por produto e adicional do FEM em itens específicos; mecanismo de bloqueio automático de fatura e liberação pela MRBR.

**Pontos ainda não verificados contra instância**: campo exato do indicador GR-based IV no item do pedido, e comportamento do vínculo NF-e ↔ documento MM no S/4HANA Cloud Public Edition, cuja localização Brasil difere do ECC.

**O que este modelo não demonstra**: configuração real de SPRO. As regras foram modeladas segundo o comportamento esperado do S/4HANA com a localização Brasil, não parametrizadas numa instância. O objetivo é demonstrar domínio do processo e das regras fiscais, não capacidade de customizing.
