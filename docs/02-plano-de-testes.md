# Plano de Testes — Recebimento Fiscal (MM Inbound)

Documento de evidência. Cada caso abaixo foi executado e o resultado obtido está transcrito da saída real do sistema.

**Ambiente**: mock S/4HANA (CAP/OData v4) + orquestração n8n
**Dados mestres de teste**:

| Objeto | Valor |
|---|---|
| Fornecedor | FORN1000 — Metalúrgica Horizonte Ltda — CNPJ 12.345.678/0001-95 |
| Destinatário | Indústria Compradora SA — CNPJ 11.222.333/0001-81 — Contagem/MG |
| Pedido | 4500000101, item 00010, liberado |
| Material | MAT-CHAPA-AC01, chapa de aço 1020 3 mm — NCM 72085300 |
| Destinação | Industrialização — CFOP de entrada esperado 1101 |
| Quantidade / preço | 100 PC × R$ 250,00 |
| Fornecedor 2 | FORN2000 — CNPJ 98.765.432/0001-98 — pedido 4500000102, 500 L × R$ 18,50 |

Ambos os estabelecimentos ficam em Minas Gerais, o que caracteriza operação interna e alíquota de ICMS de 18%.

> Cada caso foi executado contra uma instância limpa do mock, para que uma execução anterior não contamine o resultado da seguinte. Por isso cada cenário produz exatamente uma divergência.

---

## Bloco A — Cenários de negócio ponta a ponta

### CT-01 — Recebimento sem divergência

| | |
|---|---|
| **Regras exercitadas** | E1–E3, M1–M7, S1–S5 |
| **Pré-condição** | Pedido 4500000101 liberado, quantidade totalmente em aberto |
| **Entrada** | `nfe_01_ok.xml` — CFOP 5101, 100 PC × R$ 250,00, ICMS 18%, IPI 5% |
| **Resultado esperado** | Nota aprovada; entrada de mercadoria e fatura lançadas com vínculo da chave |
| **Resultado obtido** | `STATUS: LANÇADO \| MIGO 5000000001 \| MIRO 5105600001` |
| **Status** | ✅ Aprovado |

---

### CT-02 — Divergência de preço unitário

| | |
|---|---|
| **Regras exercitadas** | M4 (variação de preço — chave PP / OMR6) |
| **Entrada** | `nfe_02_preco_divergente.xml` — R$ 275,00 contra R$ 250,00 do pedido (+10%) |
| **Resultado esperado** | Bloqueio; divergência acima da tolerância de 1% |
| **Resultado obtido** | `STATUS: BLOQUEADO` — *Preço NF (275) diverge do pedido (250)* |
| **Status** | ✅ Aprovado |

---

### CT-03 — Natureza da operação incompatível com a destinação

| | |
|---|---|
| **Regras exercitadas** | M5b |
| **Entrada** | `nfe_03_cfop_incompativel.xml` — CFOP 5551, venda de bem do ativo imobilizado |
| **Resultado esperado** | Bloqueio; venda de ativo não corresponde a compra de insumo para industrialização (1101) |
| **Resultado obtido** | `STATUS: BLOQUEADO` — *CFOP 5551 incompatível com a destinação do material (CFOP de entrada 1101)* |
| **Status** | ✅ Aprovado |
| **Observação funcional** | Aceitar essa nota classificaria um bem do imobilizado como insumo, com crédito de ICMS e tratamento contábil indevidos. |

---

### CT-04 — Emitente não corresponde ao fornecedor do pedido

| | |
|---|---|
| **Regras exercitadas** | M2 |
| **Entrada** | `nfe_04_cnpj_divergente.xml` — emitente CNPJ 99.888.777/0001-00 |
| **Resultado esperado** | Bloqueio; CNPJ do emitente não é o do fornecedor do pedido |
| **Resultado obtido** | `STATUS: BLOQUEADO` — *CNPJ emitente 99888777000100 diverge do fornecedor do pedido (12345678000195)* |
| **Status** | ✅ Aprovado |

---

### CT-05 — Destaque de ICMS inconsistente com a alíquota informada

| | |
|---|---|
| **Regras exercitadas** | E3 |
| **Entrada** | `nfe_05_destaque_inconsistente.xml` — base R$ 25.000,00, alíquota informada 18%, valor destacado R$ 3.000,00 |
| **Resultado esperado** | Bloqueio; o destaque não corresponde a base × alíquota (esperado R$ 4.500,00) |
| **Resultado obtido** | `STATUS: BLOQUEADO` — *vICMS destacado (3000) inconsistente com base x alíquota (4500.00)* |
| **Status** | ✅ Aprovado |
| **Observação funcional** | Crédito a menor de R$ 1.500,00. Erro de destaque exige carta de correção ou cancelamento e reemissão pelo fornecedor, não se ajusta no lançamento. |

---

### CT-06 — Alíquota incorreta para a operação

| | |
|---|---|
| **Regras exercitadas** | M7 |
| **Entrada** | `nfe_06_aliquota_errada.xml` — alíquota de 12% com destaque internamente coerente |
| **Resultado esperado** | Bloqueio; operação interna em MG tem alíquota geral de 18% |
| **Resultado obtido** | `STATUS: BLOQUEADO` — *Alíquota ICMS 12% diverge dos 18% esperados p/ operação interna MG* |
| **Status** | ✅ Aprovado |
| **Observação funcional** | Caso clássico de fornecedor aplicando alíquota interestadual em operação interna. O destaque fecha com a própria alíquota informada, então só a regra da operação pega o erro. |

---

### CT-07 — NCM divergente do cadastro do material

| | |
|---|---|
| **Regras exercitadas** | M6 |
| **Entrada** | `nfe_07_ncm_divergente.xml` — NCM 72085100, espessura superior a 10 mm |
| **Resultado esperado** | Bloqueio; o material cadastrado é chapa de 3 mm, NCM 72085300 |
| **Resultado obtido** | `STATUS: BLOQUEADO` — *NCM 72085100 diverge do cadastro 72085300* |
| **Status** | ✅ Aprovado |
| **Observação funcional** | NCM errado leva a alíquota e tratamento tributário incorretos em toda a cadeia, além de inconsistência na escrituração. |

---

## Bloco B — Regras do sistema de registro

Estes casos foram executados por chamada direta às APIs, **contornando o orquestrador**, para provar que o sistema de registro valida por conta própria e não depende do integrador.

### CT-08 — Entrada acima da quantidade em aberto

| | |
|---|---|
| **Regras exercitadas** | M3, S2 |
| **Ação** | POST em `MaterialDocuments` com 600 L contra pedido de 500 L |
| **Resultado esperado** | Rejeição por sobreentrega fora da tolerância |
| **Resultado obtido** | `HTTP 409` — *Qtde 600 excede qtde aberta 500 do item (msg M7 022)* |
| **Status** | ✅ Aprovado |

---

### CT-09 — Fatura sem entrada de mercadoria prévia

| | |
|---|---|
| **Regras exercitadas** | S3 |
| **Ação** | POST em `SupplierInvoices` para o pedido 4500000102, sem MIGO prévia |
| **Resultado esperado** | Rejeição; o item exige recebimento de fatura baseado em entrada de mercadoria |
| **Resultado obtido** | `HTTP 409` — *Sem entrada de mercadoria (MIGO) para o pedido 4500000102 - GR-based IV* |
| **Status** | ✅ Aprovado |

---

### CT-10 — Bloqueio automático de fatura por divergência de valor

| | |
|---|---|
| **Regras exercitadas** | S4 |
| **Pré-condição** | MIGO de 500 L lançada no pedido 4500000102 (500 × R$ 18,50 = R$ 9.250,00) |
| **Ação** | POST em `SupplierInvoices` com valor bruto de R$ 11.000,00 |
| **Resultado esperado** | Bloqueio; divergência de R$ 1.750,00 excede a tolerância de 1% |
| **Resultado obtido** | `HTTP 409` — *Fatura bloqueada para pagamento - variação de preço (chave PP), liberação via MRBR: valor 11000 diverge do esperado 9250.00 (tolerância 1%)* |
| **Status** | ✅ Aprovado |
| **Observação funcional** | No S/4HANA a fatura seria lançada e bloqueada para pagamento, ficando pendente de liberação na MRBR. Neste modelo ela é rejeitada, simplificação assumida por não haver fluxo de liberação. |

---

### CT-11 — Duplicidade de NF-e

| | |
|---|---|
| **Regras exercitadas** | E4, S5 |
| **Pré-condição** | Entrada e fatura já lançadas com a chave terminada em `...123407` |
| **Ação** | POST direto em `SupplierInvoices` com a mesma chave de acesso |
| **Resultado esperado** | Rejeição por duplicidade, com indicação da fatura original |
| **Resultado obtido** | `HTTP 409` — *NF-e 31260712345678000195550010000012341000123407 já lançada (fatura 5105600001) - duplicidade* |
| **Status** | ✅ Aprovado |

---

## Resumo

| Bloco | Casos | Aprovados | Reprovados |
|---|---|---|---|
| A — Cenários ponta a ponta | 7 | 7 | 0 |
| B — Regras do sistema de registro | 4 | 4 | 0 |
| **Total** | **11** | **11** | **0** |

Regras cobertas: E1 a E4, M1 a M7 (incluindo M5a e M5b) e S1 a S5.

**Regras sem cobertura de teste**: E5 (dígito verificador de CNPJ) não está implementada, e S6 (liberação de fatura bloqueada via MRBR) não é testada por não haver fluxo de liberação no modelo. Ambas estão declaradas como limitação na matriz de regras.

---

## Cenários fora do escopo desta rodada

Não testados por estarem fora do escopo do modelo (ver limitações na matriz de regras): ICMS-ST e DIFAL, PIS e COFINS, notas com múltiplos itens e rateio, importação com DI, serviços e ISS, devoluções, remessa e retorno de industrialização, e sub-entrega dentro da tolerância com encerramento manual do item.

---

## Como reproduzir

```bash
# 1. Subir o mock (terminal 1)
cd cap-mock && npm install && npm start

# 2. Executar um caso (terminal 2)
node scripts/simula_workflow.js test-data/nfe_01_ok.xml
```

Reinicie o mock entre os casos: o banco é em memória e reiniciar restaura os dados mestres ao estado inicial. Para rodar vários casos em sequência sem reiniciar, suba instâncias em portas distintas e aponte o script com a variável `S4_URL`.
