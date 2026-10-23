# Pagamento Ticket — passo a passo (exemplo: NF 48777033, 25º BPM MAmb)

> Valores do caso da 1ª quinzena de outubro/2026. Nas próximas quinzenas, troque os números pelos da página 2 da nota.
> Os campos marcados com **(confirmar na tela)** ainda não foram vistos em print das telas 51 › 04 e 71.

## A. Conferência (antes de entrar no SIAFI)

1. Abrir o processo SEI **1250.01.0026253/2026-74**.
2. Na **nota fiscal, página 2**, anotar:

   | Campo | Valor |
   |---|---|
   | BASE | 25A BPMAMB → empenho **718** |
   | VALOR A SER LIQUIDADO | **80.252,89** |
   | ISSQN | **237,80** |
   | IRRF serviço (cód. 6190) | **336,09** |
   | IRRF peça (cód. 6147) | **248,11** |

3. Na **página 1**, anotar:

   | Campo | Valor |
   |---|---|
   | Nº da nota | **48777033** |
   | Emissão | **16/10/2026** |
   | Duplicata | **79.430,89** |
   | Vencimento | **16/11/2026** |

4. Conferir a conta:
   - 80.252,89 − 237,80 − 336,09 − 248,11 = **79.430,89** ✔
5. Conferir se a **declaração da CPARM** está assinada.
6. Conferir se a **especificação SIAD 7275035** (feita pelo almoxarifado) está **efetivada**.
7. Na planilha RAD (coluna "Responsável ISSQN" = TOMADOR), separar o ISS por prefeitura:

   | Prefeitura | ISS |
   |---|---|
   | Teófilo Otoni | **137,55** |
   | Belo Horizonte | **100,25** |

## B. Saldo do empenho e dinheiro

8. SIAFI: Navegação **95** → Opção **02** → Ação **1** → Ano **2026** → Empenho **718** → Enter.
   - O **saldo do empenho** precisa ser ≥ 80.252,89.
9. **PF9** → Navegação **96** → Opção **09** → Ação **1** → Enter.
   - Preencher: Banco **999** · Agência **09001** dígito **9** · Conta **900158** dígito **6** · **X** em Conta Corrente → Enter.
   - O saldo precisa ser ≥ 80.252,89.

## C. Liquidação — Navegação 51 › 04

10. **PF9** → Navegação **51** → Opção **04** → Enter.
11. Ano / empenho: **2026 / 718**.
12. Documento: Nota fiscal **48777033**, emissão **16/10/2026** **(confirmar na tela)**.
13. Valor da liquidação: **80.252,89**.
14. Retenções **(confirmar na tela)**:

    | Retenção | Valor |
    |---|---|
    | ISS Teófilo Otoni | 137,55 |
    | ISS Belo Horizonte | 100,25 |
    | IRRF (serviço + peça) | 584,20 (336,09 + 248,11) |

15. Conferir: o líquido mostrado deve ser **79.430,89**.
16. Confirmar e gravar. **Anotar o nº da liquidação.**

## D. Pagamento — Navegação 71

17. **PF9** → Navegação **71**.
18. **OP para a Ticket**:
    - credor CNPJ **08.273.364/0001-57**;
    - empenho **2026/718**, liquidação do passo 16;
    - título bancário **Empenho**;
    - valor **79.430,89** → gravar e anotar o nº da OP.
19. **Guia do IRRF**:
    - título bancário **Retenção**;
    - credor Estado de MG **18.715.615/0001-60**;
    - valor **584,20** (ou 336,09 + 248,11, se o sistema separar por código) → gravar.
20. **Guias de ISS** (por código de barras ou conforme cada prefeitura), título bancário **Retenção**:
    - Teófilo Otoni **137,55**;
    - Belo Horizonte **100,25**.
21. **Prazo:** tudo até **16/11/2026**.

## E. Fechamento

22. Juntar ao SEI a **liquidação** e as **OPs/guias**.
23. Conferir na consulta de saldo (web) que o valor saiu da **6.2.2.1.3.03** (liquidado a pagar) e foi para a **6.2.2.1.3.04** (pago).
24. Conferir que a conta **2.1.3.1.1.01** da Ticket baixou 79.430,89.

## Observação para o BPMRv (empenho 862, PRF)

São os mesmos passos, com estas diferenças:
- **2 liquidações**: 125.377,19 + 100.000,00, porque há 7 prefeituras de ISS e o sistema aceita no máximo 5 por liquidação.
- Conta do dinheiro: BB **001 / 01615-2 / 22085-X**.
- Antes de pagar, **pedir repasse à DF**, porque falta dinheiro na fonte 73.
