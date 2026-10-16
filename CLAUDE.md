# SOFi/CPE — dados fixos para execução (empenho, liquidação, pagamento)

Seção de Orçamento e Finanças do Comando de Policiamento Especializado (CPE) da PMMG.
Responda sempre em português, de forma curta e específica da SOFi/CPE.

## Identificação

| Item | Valor |
|---|---|
| UO | 1251 (PMMG) |
| UE CPE | 1250057 |
| UE CPE MAMB | 1250058 |
| UPG | 25 |
| Ordenador (matrícula) | 1305820 |
| Unidades atendidas | BPGd, 25º BPM MAmb, 24º BPMRv |

## Fontes e contas para pagamento

GMIFP = grupo (3900) + fonte (2 dígitos) + IPU (1 dígito).

| Fonte | GMIFP | Banco | Agência | Conta | Paga hoje |
|---|---|---|---|---|---|
| SEMAD 52.20 | 3900522 | 999 | 09001-9 | 900158-6 | Ticket (emp. 718), diárias, limpeza Tática (983), eventos Paladir (2472) |
| PMMG 60.20 | 3900602 | 999 | 09001-9 | 900795-5 | Simpress 39.19 (318 e 322/2025), diárias 15.01 |
| PRF 73.10 | 3900731 | 001 (Banco do Brasil) | 01615-2 (conferir: uma linha da planilha traz 016152-2) | 22.085-X | Ticket (emp. 862), Master Clean (886), Elevtech (2936), diárias do BPMRv |
| DER 83.20 | 3900832 | a confirmar | a confirmar | a confirmar | Água COPASA (emp. 1080), Elevadores Milênio (1323) |
| Fonte 10 | 3900101 | Conta Única | — | — | Diárias, Simpress RP 2025, BSC LPR (espec. SIAD 7256852) |

Sempre que o usuário informar uma conta nova, atualize esta tabela.

## Elementos-item usados

- 15.01 diárias militar
- 37.01 limpeza (cessão de mão de obra: INSS 11% + ISS na liquidação)
- 39.12 energia (só faturas CEMIG pontuais; a CEMIG da PM é paga por setor centralizado)
- 39.13 água e esgoto
- 39.19 locação de máquinas e equipamentos
- 39.21 manutenção (elevadores, videomonitoramento)
- 39.26 encargos financeiros
- 39.43 manutenção de frota (Ticket Log, RAD quinzenal)
- 39.55 eventos

## Roteiro no SIAFI-MG

- Empenho / liquidação / anulação: nav. 51 › 01 (empenho), 51 › 04 (liquidação), 51 › 05 (anulação de liquidado)
- Pagamento: nav. 71 (OP por credor; guias por código de barras, título bancário Empenho ou Retenção)
- Consultas: 95; saldo de conta banco: 96 › 09; relatórios: 99
- Contratos passam antes pelo SIAD (especificação de conformidade efetivada)

## Retenções

- IRRF na OP sobre o bruto: 1,2% material, 4,8% serviço
- INSS 11% (cessão de mão de obra) e ISS na liquidação
- INSS vence dia 20; ISS conforme cada prefeitura
- EFD-Reinf: confirmar com a DF se o envio é centralizado
- A guia de retenção sai da mesma fonte da despesa

## Repasse (DF)

- Pedido após a liquidação (exceto diárias/adiantamentos), por GMIFP
- Planilha: UE, GMIFP, elemento-item, nº empenho, ano, data da liquidação, banco, agência, conta convênio, credor, retenções, valor principal
- Diárias: pode ir o total por GMIFP com credor "DIVERSOS"
- Nunca deixar vazios o nº do empenho e a data da liquidação

## Regras

- Empenho 90 dias sem movimento é anulado (Dec. 37.924/96)
- Não reproduzir nomes de pessoas reais dos documentos
- Simulador de treino: senha sempre "TREINO"; nunca pedir senha real
