/**
 * Painel de Cursos AET/CPE — Web App (Google Apps Script)
 *
 * Fonte dos dados (planilha "Controle de Cursos 2026"):
 *  - "Cadastro de Turmas": turmas, área, matriz de decisão e situação.
 *  - Abas operacionais (IVD, Rodoviarios, Pilotagem, ...): resumo das
 *    turmas no topo (linha "Turma | Início | Término ...") e, abaixo,
 *    um bloco de etapas por turma (cabeçalho "Fase | ... | Etapa | Status").
 *    O N-ésimo bloco pertence à N-ésima turma do resumo, como nas
 *    fórmulas COUNTA do próprio resumo.
 *  - "Formandos 2026", "Regras e Prazos" e "Listas".
 *
 * Novas abas operacionais que sigam o mesmo modelo são detectadas
 * automaticamente — não é preciso alterar o código.
 */

const CONFIG = {
  TITULO: 'Controle de Cursos AET/CPE',
  ABA_CADASTRO: 'Cadastro de Turmas',
  ABA_FORMANDOS: 'Formandos 2026',
  ABA_REGRAS: 'Regras e Prazos',
  ABA_LISTAS: 'Listas',
  ABA_CALENDARIO: 'Calendario', // calendário oficial (Período | Treinamento | Qtd vagas | Local/Obs)
  ABA_HISTORICO: 'Histórico Painel',

  // Abas que nunca são tratadas como operacionais.
  ABAS_IGNORADAS: ['Painel Geral'],

  // Status aceitos nas etapas (iguais à aba "Listas").
  STATUS_ETAPA: ['Pendente', 'Em execução', 'Feito', 'Não se aplica'],

  // Ao alterar status pelo painel, grava uma linha na aba de histórico.
  REGISTRAR_HISTORICO: true,

  CACHE_SEGUNDOS: 300
};

/* ================================================================== */
/* Entradas                                                            */
/* ================================================================== */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.TITULO)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Painel')
    .addItem('Abrir painel', 'abrirPainel')
    .addItem('Diagnóstico da leitura', 'diagnosticarUi')
    .addSeparator()
    .addItem('Limpar cache', 'limparCache')
    .addToUi();
}

/** Qualquer edição manual invalida o cache para o painel refletir a planilha. */
function onEdit() {
  limparCache();
}

function abrirPainel() {
  const html = HtmlService.createHtmlOutputFromFile('Index')
    .setWidth(1500).setHeight(920);
  SpreadsheetApp.getUi().showModelessDialog(html, CONFIG.TITULO);
}

/* ================================================================== */
/* API chamada pelo front-end (google.script.run)                      */
/* ================================================================== */

/**
 * Retorna todos os dados do painel como string JSON
 * (google.script.run não transporta objetos Date).
 */
function getDadosPainel(forcar, ano) {
  const ss = planilha_(ano);
  const anoPlan = anoDaPlanilha_(ss);
  if (!forcar) {
    const emCache = lerCache_(anoPlan);
    if (emCache) return emCache;
  }
  const json = JSON.stringify(montarDados_(ss));
  gravarCache_(json, anoPlan);
  return json;
}

/**
 * Altera o status de uma etapa direto na aba operacional.
 * Confere se a linha ainda contém a mesma etapa antes de gravar,
 * para não escrever no lugar errado caso a planilha tenha mudado.
 */
function atualizarStatusEtapa(req) {
  if (CONFIG.STATUS_ETAPA.indexOf(req.status) < 0) {
    throw new Error('Status inválido: ' + req.status);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = planilha_(req.ano);
    const aba = ss.getSheetByName(req.aba);
    if (!aba) throw new Error('Aba não encontrada: ' + req.aba);

    const etapaAtual = String(aba.getRange(req.linha, req.colEtapa).getValue()).trim();
    if (etapaAtual !== String(req.etapa).trim()) {
      throw new Error('A planilha mudou desde o último carregamento. Atualize o painel e tente de novo.');
    }

    const celStatus = aba.getRange(req.linha, req.colStatus);
    const anterior = String(celStatus.getValue());
    celStatus.setValue(req.status);

    let conclusao = null;
    if (req.colConclusao) {
      const celData = aba.getRange(req.linha, req.colConclusao);
      if (req.status === 'Feito' && !celData.getValue()) {
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        celData.setValue(hoje);
      }
      conclusao = iso_(data_(celData.getValue()));
    }

    if (CONFIG.REGISTRAR_HISTORICO) {
      registrarHistorico_(ss, [new Date(), usuario_(), req.aba, req.linha, req.turma || '', req.etapa, anterior, req.status]);
    }
    SpreadsheetApp.flush();
    limparCache();
    return JSON.stringify({ ok: true, status: req.status, conclusao: conclusao, anterior: anterior });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Edita campos livres de uma etapa: responsável, observações,
 * documento/comprovação e data de conclusão. Nunca grava sobre fórmula.
 */
function atualizarEtapa(req) {
  return comTrava_(ss => {
    const aba = abaOuErro_(ss, req.aba);
    const cab = cabecalhoDoBloco_(aba, req.linha);
    const col = cab.col;
    conferir_(aba.getRange(req.linha, col['etapa'] + 1).getValue(), req.etapa);

    const mapa = { responsavel: 'responsavel', observacoes: 'observacoes', documento: 'documento/comprovacao', conclusao: 'data conclusao' };
    const mudou = [];
    Object.keys(mapa).forEach(campo => {
      if (!(campo in req.campos) || col[mapa[campo]] === undefined) return;
      const cel = aba.getRange(req.linha, col[mapa[campo]] + 1);
      const novo = campo === 'conclusao' ? (req.campos[campo] ? dataIso_(req.campos[campo]) : '') : String(req.campos[campo] || '').trim();
      const antigo = cel.getValue();
      if (texto_(antigo) === texto_(novo)) return;
      gravar_(cel, novo);
      mudou.push(campo + ': "' + texto_(antigo) + '" → "' + texto_(novo) + '"');
    });
    if (mudou.length) historico_(ss, req.aba, req.linha, req.turma, req.etapa, 'Edição da etapa', mudou.join('; '));
    return { ok: true, alteracoes: mudou.length };
  }, req.ano);
}

/**
 * Edita a turma: datas e local vão para a linha da turma no resumo da aba
 * do curso (o Cadastro e os prazos das etapas acompanham pelas fórmulas);
 * observações vão para o Cadastro de Turmas.
 */
function atualizarTurma(req) {
  return comTrava_(ss => {
    const mudou = [];
    const ini = req.inicio ? dataIso_(req.inicio) : null;
    const fim = req.fim ? dataIso_(req.fim) : null;
    if (ini && fim && fim < ini) throw new Error('O término não pode ser antes do início.');

    if (req.aba && req.linhaResumo) {
      const aba = abaOuErro_(ss, req.aba);
      const v = aba.getRange(1, 1, Math.min(aba.getLastRow(), 8), aba.getLastColumn()).getValues();
      const h = acharCabecalho_(v, ['turma', 'inicio', 'termino'], 8);
      if (h < 0) throw new Error('Resumo de turmas não encontrado na aba ' + req.aba + '.');
      const c = indice_(v[h]);
      conferir_(aba.getRange(req.linhaResumo, c['turma'] + 1).getValue(), req.turma);

      [['inicio', ini, 'início'], ['termino', fim, 'término']].forEach(([k, val, nome]) => {
        if (!val || c[k] === undefined) return;
        const cel = aba.getRange(req.linhaResumo, c[k] + 1);
        if (texto_(cel.getValue()) === texto_(val)) return;
        mudou.push(nome + ': ' + texto_(cel.getValue()) + ' → ' + texto_(val));
        gravar_(cel, val);
      });
      if ('local' in req && c['local/unidade'] !== undefined) {
        const cel = aba.getRange(req.linhaResumo, c['local/unidade'] + 1);
        const novo = String(req.local || '').trim();
        if (texto_(cel.getValue()) !== novo) {
          mudou.push('local: ' + texto_(cel.getValue()) + ' → ' + novo);
          gravar_(cel, novo);
        }
      }
      // Mantém o título do bloco ("... | Período: dd/mm/aaaa a dd/mm/aaaa") coerente.
      if (req.tituloLinha && (ini || fim)) {
        const celT = aba.getRange(req.tituloLinha, 1);
        const t = String(celT.getValue());
        const re = /Per[ií]odo:\s*\d{2}\/\d{2}\/\d{4}(\s*a\s*\d{2}\/\d{2}\/\d{4})?/;
        if (!celT.getFormula() && re.test(t)) {
          const i2 = ini || aba.getRange(req.linhaResumo, c['inicio'] + 1).getValue();
          const f2 = fim || aba.getRange(req.linhaResumo, c['termino'] + 1).getValue();
          celT.setValue(t.replace(re, 'Período: ' + texto_(i2) + ' a ' + texto_(f2)));
        }
      }
    }

    if ('observacoes' in req && req.linhaCadastro) {
      const cad = cadastro_(ss);
      conferir_(cad.aba.getRange(req.linhaCadastro, cad.col['turma'] + 1).getValue(), req.turma);
      const cel = cad.aba.getRange(req.linhaCadastro, cad.col['observacoes'] + 1);
      const novo = String(req.observacoes || '').trim();
      if (texto_(cel.getValue()) !== novo) {
        mudou.push('observações atualizadas');
        gravar_(cel, novo);
      }
    }
    if (mudou.length) historico_(ss, req.aba || CONFIG.ABA_CADASTRO, req.linhaResumo || req.linhaCadastro, req.turma, '', 'Edição da turma', mudou.join('; '));
    return { ok: true, alteracoes: mudou.length };
  }, req.ano);
}

/**
 * Cancela a turma: grava "Cancelado" na Situação temporal do Cadastro
 * (a fórmula original fica guardada na nota da célula para poder reativar)
 * e acrescenta o motivo às Observações.
 */
function cancelarTurma(req) {
  return comTrava_(ss => {
    const cad = cadastro_(ss);
    conferir_(cad.aba.getRange(req.linhaCadastro, cad.col['turma'] + 1).getValue(), req.turma);
    const cel = cad.aba.getRange(req.linhaCadastro, cad.col['situacao temporal'] + 1);
    const formula = cel.getFormula();
    if (formula) cel.setNote(NOTA_FORMULA + formula);
    cel.setValue('Cancelado');

    const hoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
    const motivo = String(req.motivo || '').trim();
    const obs = cad.aba.getRange(req.linhaCadastro, cad.col['observacoes'] + 1);
    if (!obs.getFormula()) {
      const atual = String(obs.getValue() || '').trim();
      obs.setValue((atual ? atual + '\n' : '') + 'Cancelado em ' + hoje + (motivo ? ': ' + motivo : '') + '.');
    }
    historico_(ss, CONFIG.ABA_CADASTRO, req.linhaCadastro, req.turma, '', 'Turma cancelada', motivo);
    return { ok: true };
  }, req.ano);
}

/** Desfaz o cancelamento: devolve a fórmula da Situação temporal. */
function reativarTurma(req) {
  return comTrava_(ss => {
    const cad = cadastro_(ss);
    conferir_(cad.aba.getRange(req.linhaCadastro, cad.col['turma'] + 1).getValue(), req.turma);
    const cel = cad.aba.getRange(req.linhaCadastro, cad.col['situacao temporal'] + 1);
    const nota = cel.getNote();
    let formula = nota.indexOf(NOTA_FORMULA) === 0 ? nota.substring(NOTA_FORMULA.length).trim() : '';
    if (!formula) {
      const l = req.linhaCadastro;
      const fI = letra_(cad.col['inicio'] + 1) + l, fT = letra_(cad.col['termino'] + 1) + l;
      formula = '=IF(TODAY()<' + fI + ',"Planejamento",IF(TODAY()<=' + fT + ',"Em execução","Encerrado"))';
    }
    cel.setFormula(formula);
    if (nota.indexOf(NOTA_FORMULA) === 0) cel.clearNote();
    historico_(ss, CONFIG.ABA_CADASTRO, req.linhaCadastro, req.turma, '', 'Turma reativada', '');
    return { ok: true };
  }, req.ano);
}

/** Atualiza a quantidade de formados de uma linha da aba "Formandos 2026". */
function atualizarFormados(req) {
  return comTrava_(ss => {
    const aba = abaFormandos_(ss);
    if (!aba) throw new Error('Aba de formandos não encontrada.');
    const v = aba.getRange(1, 1, Math.min(aba.getLastRow(), 5), aba.getLastColumn()).getValues();
    const h = acharCabecalho_(v, ['curso', 'turma', 'formados'], 5);
    const c = indice_(v[h]);
    conferir_(aba.getRange(req.linha, c['curso'] + 1).getValue(), req.curso);
    conferir_(aba.getRange(req.linha, c['turma'] + 1).getValue(), req.turma);
    const n = Number(req.formados);
    if (!(n >= 0) || Math.floor(n) !== n) throw new Error('Informe um número inteiro de formados (0 ou mais).');
    const cel = aba.getRange(req.linha, c['formados'] + 1);
    const antigo = cel.getValue();
    gravar_(cel, n);
    historico_(ss, aba.getName(), req.linha, req.curso + ' / ' + req.turma, '', 'Formados', texto_(antigo) + ' → ' + n);
    return { ok: true };
  }, req.ano);
}

/* ---------- apoio às edições ---------- */

const NOTA_FORMULA = 'Fórmula original (painel): ';

/** Executa a gravação com trava, limpa o cache e devolve JSON. */
function comTrava_(fn, ano) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const r = fn(planilha_(ano));
    SpreadsheetApp.flush();
    limparCache();
    return JSON.stringify(r);
  } finally {
    lock.releaseLock();
  }
}

/** Grava um valor, recusando células com fórmula (para não apagar cálculos). */
function gravar_(cel, valor) {
  if (cel.getFormula()) {
    throw new Error('A célula ' + cel.getSheet().getName() + '!' + cel.getA1Notation() +
      ' é calculada por fórmula. Altere na planilha ou na célula de origem.');
  }
  cel.setValue(valor);
}

/** Confere se a linha ainda é a mesma (evita gravar no lugar errado). */
function conferir_(atual, esperado) {
  if (chave_(texto_(atual)) !== chave_(texto_(esperado))) {
    throw new Error('A planilha mudou desde o último carregamento ("' + texto_(atual) + '"). Atualize o painel e tente de novo.');
  }
}

function abaOuErro_(ss, nome) {
  const aba = ss.getSheetByName(nome);
  if (!aba) throw new Error('Aba não encontrada: ' + nome);
  return aba;
}

function cadastro_(ss) {
  const aba = abaOuErro_(ss, CONFIG.ABA_CADASTRO);
  const v = aba.getRange(1, 1, Math.min(aba.getLastRow(), 6), aba.getLastColumn()).getValues();
  const h = acharCabecalho_(v, ['id', 'curso', 'turma'], 6);
  if (h < 0) throw new Error('Cabeçalho do Cadastro de Turmas não encontrado.');
  return { aba: aba, col: indice_(v[h]) };
}

/** Acha, acima da linha da etapa, o cabeçalho "Fase | ... | Etapa | Status" do bloco. */
function cabecalhoDoBloco_(aba, linha) {
  const colA = aba.getRange(1, 1, linha, 1).getValues();
  for (let i = linha - 1; i >= 0; i--) {
    if (semAcento_(colA[i][0]) === 'fase') {
      const cab = aba.getRange(i + 1, 1, 1, aba.getLastColumn()).getValues()[0];
      return { linha: i + 1, col: indice_(cab) };
    }
  }
  throw new Error('Bloco de etapas não encontrado acima da linha ' + linha + '.');
}

/** "2026-10-05" → Date (meia-noite no fuso do script). */
function dataIso_(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Data inválida: ' + s);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function letra_(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function historico_(ss, aba, linha, turma, etapa, acao, detalhe) {
  if (!CONFIG.REGISTRAR_HISTORICO) return;
  registrarHistorico_(ss, [new Date(), usuario_(), aba, linha, turma || '', etapa || '', acao, detalhe || '']);
}

/* ================================================================== */
/* Montagem dos dados                                                  */
/* ================================================================== */

function montarDados_(ss) {
  ss = ss || planilha_();
  const avisos = [];

  const cadastro = lerCadastro_(ss, avisos);
  const operacionais = lerAbasOperacionais_(ss, avisos);

  // Junta cadastro + resumo operacional pelo nome da turma.
  const porNome = {};
  cadastro.forEach(t => { porNome[chave_(t.turma)] = t; });

  const turmas = [];
  const etapas = [];
  operacionais.forEach(op => {
    op.turmas.forEach(resumo => {
      let t = porNome[chave_(resumo.turma)];
      if (!t) {
        avisos.push('Turma "' + resumo.turma + '" (aba ' + op.aba + ') não está no Cadastro de Turmas.');
        t = { id: 'x' + turmas.length, area: '', curso: op.aba, turma: resumo.turma, situacao: '' };
      }
      t.aba = op.aba;
      t.gid = op.gid;
      t.linhaResumo = resumo.linha;
      t.tituloLinha = resumo.tituloLinha || null;
      t.local = t.local || resumo.local;
      t.inicio = t.inicio || resumo.inicio;
      t.fim = t.fim || resumo.fim;
      t.prazoPlanejamento = resumo.prazoPlanejamento;
      t.prazoFinalizacao = resumo.prazoFinalizacao;
      if (t.formados == null) t.formados = resumo.formados;
      t.etapas = resumo.etapas.length;
      t._vinculada = true;
      turmas.push(t);

      resumo.etapas.forEach(e => {
        e.id = t.id + '-' + e.linha;
        e.turmaId = t.id;
        e.turma = t.turma;
        e.curso = t.curso;
        e.area = t.area;
        etapas.push(e);
      });
    });
  });

  // Turmas cadastradas sem aba operacional continuam no painel (sem etapas).
  cadastro.filter(t => !t._vinculada).forEach(t => {
    t.etapas = 0;
    turmas.push(t);
  });
  turmas.forEach(t => { delete t._vinculada; });
  turmas.sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));

  return {
    titulo: CONFIG.TITULO,
    planilha: ss.getName(),
    ano: anoDaPlanilha_(ss),
    anos: anosDisponiveis_(),
    url: ss.getUrl(),
    geradoEm: new Date().toISOString(),
    hoje: iso_(new Date()),
    statusEtapa: CONFIG.STATUS_ETAPA,
    podeEditar: true,
    turmas: turmas,
    etapas: etapas,
    formandos: lerFormandos_(ss),
    regras: lerRegras_(ss),
    calendario: lerCalendario_(ss, avisos),
    responsaveis: lerResponsaveis_(ss),
    avisos: avisos
  };
}

/** "Cadastro de Turmas": cabeçalho localizado pela linha que tem ID + Curso + Turma. */
function lerCadastro_(ss, avisos) {
  const aba = ss.getSheetByName(CONFIG.ABA_CADASTRO);
  if (!aba) { avisos.push('Aba "' + CONFIG.ABA_CADASTRO + '" não encontrada.'); return []; }
  const v = aba.getDataRange().getValues();
  const h = acharCabecalho_(v, ['id', 'curso', 'turma'], 6);
  if (h < 0) { avisos.push('Cabeçalho do Cadastro de Turmas não encontrado.'); return []; }
  const c = indice_(v[h]);

  const turmas = [];
  for (let i = h + 1; i < v.length; i++) {
    const r = v[i];
    const turma = texto_(r[c['turma']]);
    if (!turma) continue;
    turmas.push({
      id: 't' + (texto_(r[c['id']]) || i).replace(/\.0$/, ''),
      linhaCadastro: i + 1,
      area: texto_(r[c['area']]),
      curso: texto_(r[c['curso']]),
      turma: turma,
      local: texto_(r[c['local/unidade']]),
      inicio: iso_(data_(r[c['inicio']])),
      fim: iso_(data_(r[c['termino']])),
      duracao: numero_(r[c['duracao (dias)']]),
      licitacao: texto_(r[c['licitacao?']]),
      docenteExterno: texto_(r[c['docente externo?']]),
      avaliacao: texto_(r[c['avaliacao?']]),
      diaria: texto_(r[c['diaria?']]),
      mais8dias: texto_(r[c['curso > 8 dias?']]),
      autorizacaoDiaria: texto_(r[c['autorizacao previa de diaria?']]),
      situacao: texto_(r[c['situacao temporal']]),
      observacoes: texto_(r[c['observacoes']]),
      formados: numero_(r[c['formados']])
    });
  }
  return turmas;
}

/**
 * Detecta abas operacionais: precisam ter um resumo com cabeçalho
 * "Turma | Início | Término" e ao menos um bloco "Fase ... Etapa ... Status".
 */
function lerAbasOperacionais_(ss, avisos) {
  const af = abaFormandos_(ss);
  const fixas = [CONFIG.ABA_CADASTRO, af ? af.getName() : CONFIG.ABA_FORMANDOS, CONFIG.ABA_REGRAS, CONFIG.ABA_LISTAS, CONFIG.ABA_HISTORICO, CONFIG.ABA_CALENDARIO]
    .concat(CONFIG.ABAS_IGNORADAS);
  const saida = [];

  ss.getSheets().forEach(aba => {
    const nome = aba.getName();
    if (fixas.indexOf(nome) >= 0) return;
    const v = aba.getDataRange().getValues();

    const hResumo = acharCabecalho_(v, ['turma', 'inicio', 'termino'], 8);
    if (hResumo < 0) return;
    const cr = indice_(v[hResumo]);

    const resumo = [];
    for (let i = hResumo + 1; i < v.length; i++) {
      const t = texto_(v[i][0]);
      if (!t) break;
      resumo.push({
        linha: i + 1,
        turma: t,
        inicio: iso_(data_(v[i][cr['inicio']])),
        fim: iso_(data_(v[i][cr['termino']])),
        prazoPlanejamento: iso_(data_(v[i][cr['prazo planejamento']])),
        prazoFinalizacao: iso_(data_(v[i][cr['prazo finalizacao']])),
        local: texto_(v[i][cr['local/unidade']]),
        formados: numero_(v[i][cr['formados']]),
        etapas: []
      });
    }

    const blocos = [];
    for (let i = hResumo + 1; i < v.length; i++) {
      const linha = v[i].map(x => semAcento_(x));
      if (linha[0] === 'fase' && linha.indexOf('etapa') >= 0 && linha.indexOf('status') >= 0) {
        blocos.push({ linhaCab: i, titulo: i > 0 ? texto_(v[i - 1][0]) : '', col: indice_(v[i]) });
      }
    }
    if (!blocos.length) return;
    if (blocos.length !== resumo.length) {
      avisos.push('Aba "' + nome + '": ' + resumo.length + ' turma(s) no resumo, mas ' + blocos.length + ' bloco(s) de etapas.');
    }

    blocos.forEach((b, k) => {
      const dono = resumo[k];
      if (!dono) return;
      dono.tituloLinha = b.linhaCab; // linha (1-based) do título "Turma | Período: ..."
      const col = b.col;
      const fim = k + 1 < blocos.length ? blocos[k + 1].linhaCab - 1 : v.length;
      for (let i = b.linhaCab + 1; i < fim; i++) {
        const r = v[i];
        const etapa = texto_(r[col['etapa']]);
        if (!etapa) continue;
        let prazo = data_(r[col['prazo sugerido']]);
        if (prazo && prazo.getFullYear() < 1950) {
          avisos.push('Aba "' + nome + '", linha ' + (i + 1) + ' ("' + etapa + '"): prazo inválido (' +
            texto_(prazo) + ') — a fórmula provavelmente aponta para uma célula vazia.');
          prazo = null;
        }
        dono.etapas.push({
          aba: nome,
          linha: i + 1,
          colEtapa: col['etapa'] + 1,
          colStatus: col['status'] + 1,
          colConclusao: col['data conclusao'] !== undefined ? col['data conclusao'] + 1 : null,
          fase: texto_(r[col['fase']]).toUpperCase(),
          prazo: iso_(prazo),
          etapa: etapa,
          status: texto_(r[col['status']]) || 'Pendente',
          responsavel: texto_(r[col['responsavel']]),
          observacoes: texto_(r[col['observacoes']]),
          documento: texto_(r[col['documento/comprovacao']]),
          conclusao: iso_(data_(r[col['data conclusao']]))
        });
      }
    });

    saida.push({ aba: nome, gid: aba.getSheetId(), turmas: resumo });
  });
  return saida;
}

/** "Formandos 2026": primeira tabela (Curso | Turma | Local | Formados). */
function lerFormandos_(ss) {
  const aba = abaFormandos_(ss);
  if (!aba) return [];
  const v = aba.getDataRange().getValues();
  const h = acharCabecalho_(v, ['curso', 'turma', 'formados'], 5);
  if (h < 0) return [];
  const c = indice_(v[h]);
  const out = [];
  for (let i = h + 1; i < v.length; i++) {
    const curso = texto_(v[i][c['curso']]);
    if (!curso) continue;
    out.push({
      linha: i + 1,
      curso: curso,
      turma: texto_(v[i][c['turma']]),
      local: texto_(v[i][c['local']]),
      formados: numero_(v[i][c['formados']]) || 0
    });
  }
  return out;
}

/**
 * Aba "Calendario" (modelo oficial): uma linha com o nome do mês, o cabeçalho
 * "Período | Treinamento | Qtd vagas | Local/Obs" e as linhas de treinamento.
 * O período pode vir como "17 a 18/09", "31/08 a 25/09" ou "15/10".
 */
function lerCalendario_(ss, avisos) {
  let aba = ss.getSheetByName(CONFIG.ABA_CALENDARIO);
  if (!aba) aba = ss.getSheets().find(s => semAcento_(s.getName()).indexOf('calendario') >= 0) || null;
  if (!aba) return [];
  const v = aba.getDataRange().getDisplayValues();
  const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  let ano = new Date().getFullYear();
  for (let i = 0; i < Math.min(10, v.length); i++) {
    const m = v[i].join(' ').match(/\b(20\d{2})\b/);
    if (m) { ano = Number(m[1]); break; }
  }

  const out = [];
  let mes = -1, col = null;
  for (let i = 0; i < v.length; i++) {
    const r = v[i].map(x => String(x).trim());
    const cheias = r.filter(Boolean);
    if (!cheias.length) continue;
    const primeira = semAcento_(cheias[0]);
    if (cheias.length <= 2 && MESES.indexOf(primeira) >= 0) { mes = MESES.indexOf(primeira); continue; }
    const norm = r.map(x => semAcento_(x));
    if (norm.indexOf('periodo') >= 0 && norm.some(x => x.indexOf('treinamento') >= 0)) {
      col = {
        periodo: norm.indexOf('periodo'),
        treinamento: norm.findIndex(x => x.indexOf('treinamento') >= 0),
        vagas: norm.findIndex(x => x.indexOf('vagas') >= 0),
        local: norm.findIndex(x => x.indexOf('local') >= 0 || x.indexOf('obs') >= 0)
      };
      continue;
    }
    if (mes < 0 || !col) continue;
    const periodo = r[col.periodo], treinamento = r[col.treinamento];
    if (!periodo || !treinamento) continue;
    const datas = periodoParaDatas_(periodo, mes, ano);
    if (!datas) { avisos.push('Aba "' + aba.getName() + '", linha ' + (i + 1) + ': período "' + periodo + '" não reconhecido.'); }
    out.push({
      linha: i + 1,
      ano: ano,
      mes: mes,
      periodo: periodo,
      treinamento: treinamento,
      vagas: col.vagas >= 0 ? r[col.vagas] : '',
      local: col.local >= 0 ? r[col.local] : '',
      inicio: datas ? iso_(datas[0]) : null,
      fim: datas ? iso_(datas[1]) : null
    });
  }
  return out;
}

/** "17 a 18/09" | "31/08 a 25/09" | "15/10" | "05 a 28/10/2026" → [Date, Date] */
function periodoParaDatas_(txt, mes, ano) {
  const m = String(txt).replace(/\s+/g, ' ').match(/^(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?(?:\s*(?:a|à|ate|até|-|–)\s*(\d{1,2})(?:\/(\d{1,2}))?(?:\/(\d{2,4}))?)?/i);
  if (!m) return null;
  const anoDe = x => x ? (x.length === 2 ? 2000 + Number(x) : Number(x)) : ano;
  const mesFim = m[5] ? Number(m[5]) - 1 : m[2] ? Number(m[2]) - 1 : mes;
  const mesIni = m[2] ? Number(m[2]) - 1 : mesFim;
  const fimAno = anoDe(m[6] || m[3]);
  const ini = new Date(anoDe(m[3] || m[6]), mesIni, Number(m[1]));
  const fim = m[4] ? new Date(fimAno, mesFim, Number(m[4])) : new Date(ini);
  return [ini, fim];
}

function lerRegras_(ss) {
  const aba = ss.getSheetByName(CONFIG.ABA_REGRAS);
  if (!aba) return [];
  const v = aba.getDataRange().getValues();
  const h = acharCabecalho_(v, ['codigo', 'prazo'], 5);
  if (h < 0) return [];
  const c = indice_(v[h]);
  const out = [];
  for (let i = h + 1; i < v.length; i++) {
    const cod = texto_(v[i][c['codigo']]);
    if (!/^R\d+/i.test(cod)) continue; // ignora as "notas de utilização"
    out.push({
      codigo: cod,
      etapa: texto_(v[i][c['etapa / regra']]),
      natureza: texto_(v[i][c['natureza']]),
      prazo: texto_(v[i][c['prazo']]),
      contagem: texto_(v[i][c['tipo de contagem']]),
      marco: texto_(v[i][c['marco de referencia']]),
      aplicabilidade: texto_(v[i][c['aplicabilidade']]),
      observacoes: texto_(v[i][c['observacoes']])
    });
  }
  return out;
}

function lerResponsaveis_(ss) {
  const aba = ss.getSheetByName(CONFIG.ABA_LISTAS);
  if (!aba) return [];
  const v = aba.getDataRange().getValues();
  const c = indice_(v[0])['responsaveis aet'];
  if (c === undefined) return [];
  return v.slice(1).map(r => texto_(r[c])).filter(Boolean);
}

function registrarHistorico_(ss, linha) {
  let aba = ss.getSheetByName(CONFIG.ABA_HISTORICO);
  if (!aba) {
    aba = ss.insertSheet(CONFIG.ABA_HISTORICO);
    aba.appendRow(['Data/hora', 'Usuário', 'Aba', 'Linha', 'Turma', 'Etapa', 'Antes / ação', 'Depois / detalhe']);
    aba.setFrozenRows(1);
    aba.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
  aba.appendRow(linha);
}

/* ================================================================== */
/* Cache em blocos (CacheService aceita até 100 KB por chave)          */
/* ================================================================== */

const CACHE_PREFIXO_BASE = 'painel_v3_';

function gravarCache_(json, ano) {
  const CACHE_PREFIXO = prefixoCache_(ano);
  const cache = CacheService.getScriptCache();
  const tamanho = 90000;
  const partes = {};
  let n = 0;
  for (let i = 0; i < json.length; i += tamanho) {
    partes[CACHE_PREFIXO + n] = json.substring(i, i + tamanho);
    n++;
  }
  if (n > 50) return; // grande demais para valer a pena
  partes[CACHE_PREFIXO + 'n'] = String(n);
  cache.putAll(partes, CONFIG.CACHE_SEGUNDOS);
}

function lerCache_(ano) {
  const CACHE_PREFIXO = prefixoCache_(ano);
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(CACHE_PREFIXO + 'n'));
  if (!n) return null;
  const chaves = [];
  for (let i = 0; i < n; i++) chaves.push(CACHE_PREFIXO + i);
  const partes = cache.getAll(chaves);
  if (Object.keys(partes).length !== n) return null;
  return chaves.map(k => partes[k]).join('');
}

/** Limpa o cache de todos os anos (chamado após qualquer gravação). */
function limparCache() {
  const cache = CacheService.getScriptCache();
  const chaves = [];
  anosDisponiveis_().forEach(a => {
    const p = prefixoCache_(a);
    chaves.push(p + 'n');
    for (let i = 0; i < 50; i++) chaves.push(p + i);
  });
  cache.removeAll(chaves);
}

function prefixoCache_(ano) {
  return CACHE_PREFIXO_BASE + (ano || '') + '_';
}

/* ================================================================== */
/* Vários anos: uma planilha por ano, todas no mesmo painel            */
/* ================================================================== */

/** { "2027": "idDaPlanilha", ... } guardado nas propriedades do script. */
function anosRegistrados_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('ANOS') || '{}'); }
  catch (e) { return {}; }
}

function registrarAno_(ano, id) {
  const m = anosRegistrados_();
  m[ano] = id;
  PropertiesService.getScriptProperties().setProperty('ANOS', JSON.stringify(m));
}

/** O ano de uma planilha vem do nome do arquivo ("Controle de Cursos 2026"). */
function anoDaPlanilha_(ss) {
  const m = String(ss.getName()).match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : new Date().getFullYear();
}

/** Planilha do ano pedido (sem ano: a planilha onde o script está). */
function planilha_(ano) {
  const base = SpreadsheetApp.getActiveSpreadsheet();
  if (!ano || (base && anoDaPlanilha_(base) === Number(ano))) {
    if (!base) throw new Error('Script sem planilha vinculada.');
    return base;
  }
  const id = anosRegistrados_()[ano];
  if (!id) throw new Error('Não há planilha cadastrada para ' + ano + '.');
  return SpreadsheetApp.openById(id);
}

function anosDisponiveis_() {
  const anos = Object.keys(anosRegistrados_()).map(Number);
  const base = SpreadsheetApp.getActiveSpreadsheet();
  if (base) anos.push(anoDaPlanilha_(base));
  return Array.from(new Set(anos)).sort();
}

/** Aba de formandos: "Formandos 2026", "Formandos 2027"... */
function abaFormandos_(ss) {
  return ss.getSheetByName(CONFIG.ABA_FORMANDOS) ||
    ss.getSheets().find(s => /^formandos\b/.test(semAcento_(s.getName()))) || null;
}

/* ================================================================== */
/* Incluir turma nova (copia o checklist de uma turma modelo)          */
/* ================================================================== */

/**
 * Cria uma turma nova numa aba de curso, copiando o checklist da turma modelo:
 *  - linha no resumo da aba (as fórmulas de contagem apontam para o novo bloco);
 *  - bloco de etapas com prazos recalculados pelas datas novas;
 *  - linha no Cadastro de Turmas, no Painel Geral, em Formandos e no Calendario.
 */
function criarTurma(req) {
  return comTrava_(ss => {
    const nome = String(req.nome || '').trim();
    const local = String(req.local || '').trim();
    if (!nome) throw new Error('Informe o nome da turma.');
    if (!req.inicio || !req.fim) throw new Error('Informe início e término.');
    const ini = dataIso_(req.inicio), fim = dataIso_(req.fim);
    if (fim < ini) throw new Error('O término não pode ser antes do início.');

    const aba = abaOuErro_(ss, req.aba);
    const nomeAba = aba.getName();
    let v = aba.getDataRange().getValues();
    const h = acharCabecalho_(v, ['turma', 'inicio', 'termino'], 8);
    if (h < 0) throw new Error('Resumo de turmas não encontrado na aba ' + nomeAba + '.');
    const cr = indice_(v[h]);
    const larguraResumo = larguraCabecalho_(v[h]);
    const resumo = [];
    for (let i = h + 1; i < v.length && texto_(v[i][0]); i++) resumo.push(i + 1);
    if (resumo.some(l => chave_(texto_(v[l - 1][0])) === chave_(nome))) throw new Error('Já existe uma turma "' + nome + '" nesta aba.');
    const k = resumo.findIndex(l => chave_(texto_(v[l - 1][0])) === chave_(req.modelo));
    if (k < 0) throw new Error('Turma modelo "' + req.modelo + '" não encontrada na aba ' + nomeAba + '.');
    const tplRow = resumo[k];
    const ultimoResumo = resumo[resumo.length - 1];

    // 1) Linha nova no resumo (as fórmulas da planilha se ajustam sozinhas à inserção).
    aba.insertRowAfter(ultimoResumo);
    const R = ultimoResumo + 1;

    // 2) Bloco de etapas da turma modelo (posições relidas após a inserção).
    v = aba.getDataRange().getValues();
    const blocos = [];
    for (let i = R; i < v.length; i++) {
      const l = v[i].map(x => semAcento_(x));
      if (l[0] === 'fase' && l.indexOf('etapa') >= 0 && l.indexOf('status') >= 0) blocos.push(i + 1);
    }
    const cab = blocos[k];
    if (!cab) throw new Error('Bloco de etapas da turma modelo não encontrado.');
    const srcIni = cab - 1;
    const limite = k + 1 < blocos.length ? blocos[k + 1] - 2 : v.length;
    let srcFim = cab;
    for (let i = cab + 1; i <= limite; i++) if (v[i - 1].some(x => x !== '' && x !== null)) srcFim = i;
    const nLin = srcFim - srcIni + 1;
    const nCol = larguraCabecalho_(v[cab - 1]);
    const col = indice_(v[cab - 1]);

    const destIni = ultimaLinhaComDados_(v) + 3;
    const D = destIni - srcIni;
    if (aba.getMaxRows() < destIni + nLin) aba.insertRowsAfter(aba.getMaxRows(), destIni + nLin - aba.getMaxRows());
    const src = aba.getRange(srcIni, 1, nLin, nCol), dst = aba.getRange(destIni, 1, nLin, nCol);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);

    const regras = [{ aba: null, de: tplRow, ate: tplRow, para: R }, { aba: null, de: srcIni, ate: srcFim, desloc: D }];
    const sv = src.getValues(), sf = src.getFormulas();
    const bloco = sv.map((row, i) => row.map((x, j) => {
      if (sf[i][j]) return reescreverFormula_(sf[i][j], nomeAba, regras);
      if (i > 1 && texto_(row[col['etapa']])) {
        if (j === col['status']) return x === 'Não se aplica' ? x : 'Pendente';
        if (j === col['data conclusao'] || j === col['observacoes']) return '';
      }
      return x;
    }));
    if (!sf[0][0]) bloco[0][0] = ' ' + nome + '  |  Período: ' + texto_(ini) + ' a ' + texto_(fim) + (local ? '  |  Local/Unidade: ' + local : '');
    dst.setValues(bloco);

    // 3) Linha do resumo: mesmas fórmulas da modelo, apontando para o novo bloco.
    const tpl = aba.getRange(tplRow, 1, 1, larguraResumo);
    tpl.copyTo(aba.getRange(R, 1, 1, larguraResumo), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    const tv = tpl.getValues()[0], tf = tpl.getFormulas()[0];
    const linha = tv.map((x, j) => tf[j] ? reescreverFormula_(tf[j], nomeAba, regras) : x);
    linha[cr['turma']] = nome;
    if (!tf[cr['inicio']]) linha[cr['inicio']] = ini;
    if (!tf[cr['termino']]) linha[cr['termino']] = fim;
    if (cr['local/unidade'] !== undefined && !tf[cr['local/unidade']]) linha[cr['local/unidade']] = local;
    if (cr['formados'] !== undefined && !tf[cr['formados']]) linha[cr['formados']] = '';
    aba.getRange(R, 1, 1, larguraResumo).setValues([linha]);

    // 4) Cadastro de Turmas, Painel Geral, Formandos e Calendario.
    const cad = incluirNoCadastro_(ss, nomeAba, tplRow, R, req);
    incluirNoPainelGeral_(ss, nomeAba, tplRow, R, cad);
    incluirEmFormandos_(ss, req.curso || nomeAba, nome, local);
    incluirNoCalendario_(ss, ini, fim, req.treinamento || nome, req.vagas, local);

    historico_(ss, nomeAba, R, nome, '', 'Turma incluída', texto_(ini) + ' a ' + texto_(fim) + ' · modelo: ' + req.modelo);
    return { ok: true, linha: R };
  }, req.ano);
}

function incluirNoCadastro_(ss, nomeAba, tplRow, R, req) {
  const c = cadastro_(ss);
  const v = c.aba.getDataRange().getValues();
  const h = acharCabecalho_(v, ['id', 'curso', 'turma'], 6);
  const largura = larguraCabecalho_(v[h]);
  let tpl = -1, ultimo = h + 1, maxId = 0;
  for (let i = h + 1; i < v.length; i++) {
    if (!texto_(v[i][c.col['turma']]) && !texto_(v[i][c.col['id']])) continue;
    ultimo = i + 1;
    maxId = Math.max(maxId, numero_(v[i][c.col['id']]) || 0);
    if (chave_(texto_(v[i][c.col['turma']])) === chave_(req.modelo)) tpl = i + 1;
  }
  if (tpl < 0) return null; // modelo fora do cadastro: segue sem esta linha
  c.aba.insertRowAfter(ultimo);
  const nova = ultimo + 1;
  const src = c.aba.getRange(tpl, 1, 1, largura);
  src.copyTo(c.aba.getRange(nova, 1, 1, largura), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  src.copyTo(c.aba.getRange(nova, 1, 1, largura), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  const regras = [{ aba: null, de: tpl, ate: tpl, para: nova }, { aba: nomeAba, de: tplRow, ate: tplRow, para: R }];
  const sv = src.getValues()[0], sf = src.getFormulas()[0];
  const linha = sv.map((x, j) => sf[j] ? reescreverFormula_(sf[j], c.aba.getName(), regras) : x);
  const col = c.col;
  linha[col['id']] = maxId + 1;
  if (!sf[col['turma']]) linha[col['turma']] = req.nome;
  if (col['local/unidade'] !== undefined && !sf[col['local/unidade']]) linha[col['local/unidade']] = req.local || '';
  if (col['inicio'] !== undefined && !sf[col['inicio']]) linha[col['inicio']] = dataIso_(req.inicio);
  if (col['termino'] !== undefined && !sf[col['termino']]) linha[col['termino']] = dataIso_(req.fim);
  if (col['observacoes'] !== undefined) linha[col['observacoes']] = '';
  if (col['situacao temporal'] !== undefined && !sf[col['situacao temporal']]) {
    const fI = letra_(col['inicio'] + 1) + nova, fT = letra_(col['termino'] + 1) + nova;
    linha[col['situacao temporal']] = '=IF(TODAY()<' + fI + ',"Planejamento",IF(TODAY()<=' + fT + ',"Em execução","Encerrado"))';
  }
  c.aba.getRange(nova, 1, 1, largura).setValues([linha]);
  return { tpl: tpl, nova: nova, aba: c.aba.getName() };
}

function incluirNoPainelGeral_(ss, nomeAba, tplRow, R, cad) {
  const aba = ss.getSheets().find(s => CONFIG.ABAS_IGNORADAS.indexOf(s.getName()) >= 0);
  if (!aba) return;
  const v = aba.getDataRange().getValues(), f = aba.getDataRange().getFormulas();
  const h = acharCabecalho_(v, ['curso', 'turma', 'inicio'], 6);
  if (h < 0) return;
  const largura = larguraCabecalho_(v[h]);
  const alvo = new RegExp("(^|[^A-Za-z0-9_])'?" + nomeAba.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'?!\\$?[A-Z]{1,3}\\$?" + tplRow + '(?!\\d)');
  let tpl = -1, ultimo = h + 1;
  for (let i = h + 1; i < v.length; i++) {
    if (!v[i].some(x => x !== '' && x !== null) && !f[i].some(Boolean)) continue;
    ultimo = i + 1;
    if (f[i].some(x => alvo.test(x))) tpl = i + 1;
  }
  if (tpl < 0) return;
  aba.insertRowAfter(ultimo);
  const nova = ultimo + 1;
  const src = aba.getRange(tpl, 1, 1, largura);
  src.copyTo(aba.getRange(nova, 1, 1, largura), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  const regras = [{ aba: null, de: tpl, ate: tpl, para: nova }, { aba: nomeAba, de: tplRow, ate: tplRow, para: R }];
  if (cad) regras.push({ aba: cad.aba, de: cad.tpl, ate: cad.tpl, para: cad.nova });
  const sv = src.getValues()[0], sf = src.getFormulas()[0];
  aba.getRange(nova, 1, 1, largura).setValues([sv.map((x, j) => sf[j] ? reescreverFormula_(sf[j], aba.getName(), regras) : x)]);
}

function incluirEmFormandos_(ss, curso, turma, local) {
  const aba = abaFormandos_(ss);
  if (!aba) return;
  const v = aba.getDataRange().getValues();
  const h = acharCabecalho_(v, ['curso', 'turma', 'formados'], 5);
  if (h < 0) return;
  const c = indice_(v[h]);
  let ultimo = -1;
  for (let i = h + 1; i < v.length; i++) if (texto_(v[i][c['curso']])) ultimo = i + 1;
  if (ultimo < 0) return;
  // Insere ANTES da última linha para que os intervalos dos totais (SUMIF) se expandam.
  aba.insertRowBefore(ultimo);
  const largura = c['formados'] + 1;
  aba.getRange(ultimo + 1, 1, 1, largura).copyTo(aba.getRange(ultimo, 1, 1, largura), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  const linha = new Array(largura).fill('');
  linha[c['curso']] = curso; linha[c['turma']] = turma;
  if (c['local'] !== undefined) linha[c['local']] = local;
  linha[c['formados']] = 0;
  aba.getRange(ultimo, 1, 1, largura).setValues([linha]);
}

function incluirNoCalendario_(ss, ini, fim, treinamento, vagas, local) {
  const aba = ss.getSheetByName(CONFIG.ABA_CALENDARIO) || ss.getSheets().find(s => semAcento_(s.getName()).indexOf('calendario') >= 0);
  if (!aba) return;
  const v = aba.getDataRange().getDisplayValues();
  const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const mes = ini.getMonth();
  const mesmoMes = ini.getMonth() === fim.getMonth();
  const dd = d => ('0' + d.getDate()).slice(-2), mm = d => ('0' + (d.getMonth() + 1)).slice(-2);
  const periodo = ini.getTime() === fim.getTime() ? dd(ini) + '/' + mm(ini)
    : mesmoMes ? dd(ini) + ' a ' + dd(fim) + '/' + mm(fim) : dd(ini) + '/' + mm(ini) + ' a ' + dd(fim) + '/' + mm(fim);

  // Blocos do calendário: { mes, titulo, cab, ultimo, col }.
  const blocos = [];
  for (let i = 0; i < v.length; i++) {
    const r = v[i].map(x => String(x).trim()), cheias = r.filter(Boolean);
    if (!cheias.length) continue;
    const m = MESES.indexOf(semAcento_(cheias[0]));
    if (cheias.length <= 2 && m >= 0) { blocos.push({ mes: m, titulo: i + 1, cab: -1, ultimo: -1, col: null }); continue; }
    const b = blocos[blocos.length - 1];
    if (!b) continue;
    const n = r.map(x => semAcento_(x));
    if (b.cab < 0 && n.indexOf('periodo') >= 0) { b.cab = i + 1; b.col = n; continue; }
    if (b.cab > 0) b.ultimo = i + 1;
  }
  const colunas = n => ({ periodo: n.indexOf('periodo'), treinamento: n.findIndex(x => x.indexOf('treinamento') >= 0), vagas: n.findIndex(x => x.indexOf('vagas') >= 0), local: n.findIndex(x => x.indexOf('local') >= 0 || x.indexOf('obs') >= 0) });
  const largura = aba.getLastColumn();
  const montar = c => { const l = new Array(largura).fill(''); l[c.periodo] = periodo; l[c.treinamento] = treinamento; if (c.vagas >= 0) l[c.vagas] = vagas ? String(vagas) : '-'; if (c.local >= 0) l[c.local] = local; return l; };

  const doMes = blocos.find(b => b.mes === mes && b.cab > 0);
  if (doMes) {
    const depois = doMes.ultimo > 0 ? doMes.ultimo : doMes.cab;
    aba.insertRowAfter(depois);
    if (doMes.ultimo > 0) aba.getRange(doMes.ultimo, 1, 1, largura).copyTo(aba.getRange(depois + 1, 1, 1, largura), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    aba.getRange(depois + 1, 1, 1, largura).setValues([montar(colunas(doMes.col))]);
    return;
  }
  // Mês ainda sem bloco: cria no fim, copiando a formatação do primeiro mês.
  const modelo = blocos.find(b => b.cab > 0);
  if (!modelo) return;
  const base = ultimaLinhaComDados_(v) + 2;
  aba.getRange(modelo.titulo, 1, 3, largura).copyTo(aba.getRange(base, 1, 3, largura), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  const cabecalho = v[modelo.cab - 1].slice(0, largura);
  const titulo = new Array(largura).fill(''); titulo[0] = MESES_TITULO_[mes];
  aba.getRange(base, 1, 3, largura).setValues([titulo, cabecalho, montar(colunas(cabecalho.map(x => semAcento_(x))))]);
}

const MESES_TITULO_ = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

/* ================================================================== */
/* Criar o ano seguinte: cópia "espelho" da planilha                   */
/* ================================================================== */

/**
 * Copia a planilha do ano de origem para o ano seguinte, mantendo cursos,
 * turmas, locais, vagas e checklists. Avança as datas, zera status
 * (exceto "Não se aplica"), datas de conclusão, observações das etapas,
 * formados e histórico. A planilha de origem não é alterada.
 *  req.modoDatas: 'semana' (mesmo dia da semana, +364 dias) | 'data' (mesmo dia e mês)
 *  req.canceladas: 'manter' | 'reativar'
 */
function criarAnoSeguinte(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const origem = planilha_(req.ano);
    const anoOrigem = anoDaPlanilha_(origem), novoAno = anoOrigem + 1;
    if (anosRegistrados_()[novoAno]) throw new Error('A planilha de ' + novoAno + ' já existe.');
    const avancar = d => {
      const n = new Date(d.getTime());
      if (req.modoDatas === 'data') n.setFullYear(n.getFullYear() + 1);
      else n.setDate(n.getDate() + 364);
      return n;
    };

    const arquivo = DriveApp.getFileById(origem.getId());
    const pastas = arquivo.getParents();
    const nome = /\b20\d{2}\b/.test(origem.getName()) ? origem.getName().replace(/\b20\d{2}\b/, String(novoAno)) : origem.getName() + ' ' + novoAno;
    const copia = pastas.hasNext() ? arquivo.makeCopy(nome, pastas.next()) : arquivo.makeCopy(nome);
    const ss = SpreadsheetApp.openById(copia.getId());

    const af = abaFormandos_(ss);
    const fixas = [CONFIG.ABA_CADASTRO, af ? af.getName() : '', CONFIG.ABA_REGRAS, CONFIG.ABA_LISTAS, CONFIG.ABA_HISTORICO, CONFIG.ABA_CALENDARIO].concat(CONFIG.ABAS_IGNORADAS);

    ss.getSheets().forEach(aba => {
      const nomeAba = aba.getName();
      // Títulos com o ano ("... AET/CPE 2026") nas primeiras linhas.
      trocarAnoNosTitulos_(aba, anoOrigem, novoAno);
      if (fixas.indexOf(nomeAba) >= 0) return;

      const v = aba.getDataRange().getValues();
      const h = acharCabecalho_(v, ['turma', 'inicio', 'termino'], 8);
      if (h < 0) return;

      // Etapas: status, conclusão e observações por coluna de cada bloco.
      const cabs = [];
      for (let i = h + 1; i < v.length; i++) {
        const l = v[i].map(x => semAcento_(x));
        if (l[0] === 'fase' && l.indexOf('etapa') >= 0 && l.indexOf('status') >= 0) cabs.push(i);
      }
      cabs.forEach((i, idx) => {
        const col = indice_(v[i]);
        const fim = idx + 1 < cabs.length ? cabs[idx + 1] - 1 : v.length; // exclusivo: para antes do título do próximo bloco
        const n = fim - (i + 1);
        if (n <= 0) return;
        const colStatus = v.slice(i + 1, fim).map(r => [texto_(r[col['etapa']]) ? (r[col['status']] === 'Não se aplica' ? 'Não se aplica' : 'Pendente') : r[col['status']]]);
        escreverColuna_(aba, i + 2, col['status'] + 1, colStatus);
        if (col['data conclusao'] !== undefined) escreverColuna_(aba, i + 2, col['data conclusao'] + 1, colStatus.map(() => ['']));
        if (col['observacoes'] !== undefined) escreverColuna_(aba, i + 2, col['observacoes'] + 1, colStatus.map(() => ['']));
      });

      // Datas digitadas (sem fórmula): resumo, linhas avulsas e quadros auxiliares.
      const v2 = aba.getDataRange().getValues(), f2 = aba.getDataRange().getFormulas();
      for (let i = 0; i < v2.length; i++) {
        for (let j = 0; j < v2[i].length; j++) {
          if (v2[i][j] instanceof Date && !f2[i][j] && v2[i][j].getFullYear() > 1950) aba.getRange(i + 1, j + 1).setValue(avancar(v2[i][j]));
        }
      }

      // Formados do resumo e títulos "Período: dd/mm/aaaa a dd/mm/aaaa" dos blocos.
      const v3 = aba.getDataRange().getValues();
      const cr = indice_(v3[h]);
      const resumo = [];
      for (let i = h + 1; i < v3.length && texto_(v3[i][0]); i++) resumo.push(i);
      if (cr['formados'] !== undefined) resumo.forEach(i => { const c = aba.getRange(i + 1, cr['formados'] + 1); if (!c.getFormula()) c.setValue(''); });
      let k = 0;
      for (let i = h + 1; i < v3.length; i++) {
        const l = v3[i].map(x => semAcento_(x));
        if (!(l[0] === 'fase' && l.indexOf('etapa') >= 0)) continue;
        const r = resumo[k++];
        if (r === undefined || i < 1) continue;
        const celT = aba.getRange(i, 1);
        const t = String(celT.getValue()), re = /Per[ií]odo:\s*\d{2}\/\d{2}\/\d{4}(\s*a\s*\d{2}\/\d{2}\/\d{4})?/;
        if (!celT.getFormula() && re.test(t)) celT.setValue(t.replace(re, 'Período: ' + texto_(v3[r][cr['inicio']]) + ' a ' + texto_(v3[r][cr['termino']])));
      }
    });

    // Cadastro: canceladas (manter ou reativar) e observações limpas.
    const cad = cadastro_(ss);
    const cv = cad.aba.getDataRange().getValues();
    const hc = acharCabecalho_(cv, ['id', 'curso', 'turma'], 6);
    for (let i = hc + 1; i < cv.length; i++) {
      if (!texto_(cv[i][cad.col['turma']])) continue;
      const cel = cad.aba.getRange(i + 1, cad.col['situacao temporal'] + 1);
      const cancelada = !cel.getFormula() && /cancel/i.test(String(cel.getValue()));
      if (cancelada && req.canceladas === 'reativar') {
        const nota = cel.getNote();
        const fI = letra_(cad.col['inicio'] + 1) + (i + 1), fT = letra_(cad.col['termino'] + 1) + (i + 1);
        cel.setFormula(nota.indexOf(NOTA_FORMULA) === 0 ? nota.substring(NOTA_FORMULA.length).trim()
          : '=IF(TODAY()<' + fI + ',"Planejamento",IF(TODAY()<=' + fT + ',"Em execução","Encerrado"))');
        cel.clearNote();
      }
      const obs = cad.aba.getRange(i + 1, cad.col['observacoes'] + 1);
      if (!obs.getFormula() && !(cancelada && req.canceladas !== 'reativar')) obs.setValue('');
    }

    // Formandos: nome da aba e quantidades zeradas.
    if (af) {
      if (/\b20\d{2}\b/.test(af.getName())) af.setName(af.getName().replace(/\b20\d{2}\b/, String(novoAno)));
      const fv = af.getDataRange().getValues();
      const hf = acharCabecalho_(fv, ['curso', 'turma', 'formados'], 5);
      if (hf >= 0) {
        const c = indice_(fv[hf]);
        for (let i = hf + 1; i < fv.length; i++) {
          if (!texto_(fv[i][c['curso']])) continue;
          const cel = af.getRange(i + 1, c['formados'] + 1);
          if (!cel.getFormula()) cel.setValue(0);
        }
      }
    }

    avancarCalendario_(ss, avancar, novoAno);

    // Histórico do painel começa vazio no ano novo.
    const hist = ss.getSheetByName(CONFIG.ABA_HISTORICO);
    if (hist && hist.getLastRow() > 1) hist.deleteRows(2, hist.getLastRow() - 1);

    registrarAno_(novoAno, ss.getId());
    SpreadsheetApp.flush();
    limparCache();
    historico_(origem, CONFIG.ABA_CADASTRO, '', '', '', 'Ano ' + novoAno + ' criado', ss.getUrl());
    return JSON.stringify({ ok: true, ano: novoAno, url: ss.getUrl(), nome: ss.getName() });
  } finally {
    lock.releaseLock();
  }
}

/** Calendario: avança os períodos ("17 a 18/09") e o ano do título. */
function avancarCalendario_(ss, avancar, novoAno) {
  const aba = ss.getSheetByName(CONFIG.ABA_CALENDARIO) || ss.getSheets().find(s => semAcento_(s.getName()).indexOf('calendario') >= 0);
  if (!aba) return;
  const v = aba.getDataRange().getDisplayValues(), f = aba.getDataRange().getFormulas();
  const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const dd = d => ('0' + d.getDate()).slice(-2), mm = d => ('0' + (d.getMonth() + 1)).slice(-2);
  let mes = -1, cp = -1;
  for (let i = 0; i < v.length; i++) {
    const r = v[i].map(x => String(x).trim()), cheias = r.filter(Boolean);
    if (!cheias.length) continue;
    const m = MESES.indexOf(semAcento_(cheias[0]));
    if (cheias.length <= 2 && m >= 0) { mes = m; continue; }
    const n = r.map(x => semAcento_(x));
    if (n.indexOf('periodo') >= 0) { cp = n.indexOf('periodo'); continue; }
    if (mes < 0 || cp < 0 || !r[cp] || f[i][cp]) continue;
    const datas = periodoParaDatas_(r[cp], mes, novoAno - 1);
    if (!datas) continue;
    const a = avancar(datas[0]), b = avancar(datas[1]);
    const txt = a.getTime() === b.getTime() ? dd(a) + '/' + mm(a)
      : a.getMonth() === b.getMonth() ? dd(a) + ' a ' + dd(b) + '/' + mm(b) : dd(a) + '/' + mm(a) + ' a ' + dd(b) + '/' + mm(b);
    aba.getRange(i + 1, cp + 1).setValue(txt);
  }
}

function trocarAnoNosTitulos_(aba, de, para) {
  const n = Math.min(aba.getLastRow(), 10), c = aba.getLastColumn();
  if (n < 1 || c < 1) return;
  const r = aba.getRange(1, 1, n, c), v = r.getValues(), f = r.getFormulas();
  for (let i = 0; i < n; i++) for (let j = 0; j < c; j++) {
    if (!f[i][j] && typeof v[i][j] === 'string' && v[i][j].indexOf(String(de)) >= 0 && /[A-Za-zÀ-ú]/.test(v[i][j])) {
      aba.getRange(i + 1, j + 1).setValue(v[i][j].split(String(de)).join(String(para)));
    }
  }
}

/* ---------- utilitários das inclusões ---------- */

/** Escreve uma coluna de valores, sem tocar nas células que têm fórmula. */
function escreverColuna_(aba, linha, coluna, valores) {
  const r = aba.getRange(linha, coluna, valores.length, 1);
  const f = r.getFormulas();
  if (f.every(x => !x[0])) { r.setValues(valores); return; }
  valores.forEach((x, i) => { if (!f[i][0]) aba.getRange(linha + i, coluna).setValue(x[0]); });
}

/** Quantas colunas tem um cabeçalho (até a primeira célula vazia depois da coluna A). */
function larguraCabecalho_(linha) {
  let n = 0;
  for (let j = 0; j < linha.length; j++) { if (texto_(linha[j])) n = j + 1; else if (j > 0) break; }
  return Math.max(n, 1);
}

function ultimaLinhaComDados_(v) {
  for (let i = v.length - 1; i >= 0; i--) if (v[i].some(x => x !== '' && x !== null)) return i + 1;
  return 0;
}

/**
 * Reescreve referências de linha (A1) numa fórmula.
 * Cada regra: { aba: null (a própria aba) | 'Nome', de, ate, para | desloc }.
 * Textos entre aspas não são alterados.
 */
function reescreverFormula_(formula, abaAtual, regras) {
  const partes = String(formula).split('"');
  const limpa = n => String(n || '').replace(/^'|'$/g, '');
  for (let p = 0; p < partes.length; p += 2) { // índices pares = fora de aspas
    partes[p] = partes[p].replace(/((?:'[^']+'|[A-Za-zÀ-ú0-9_]+)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, aba, d1, c, d2, lin, pos, str) => {
      const antes = pos > 0 ? str[pos - 1] : '';
      if (!aba && /[A-Za-z0-9_.$]/.test(antes)) return m;
      const nomeRef = aba ? limpa(aba.slice(0, -1)) : null;
      const mesma = !nomeRef || nomeRef === abaAtual;
      const n = Number(lin);
      for (const r of regras) {
        const casa = r.aba === null ? mesma : nomeRef === r.aba || (mesma && r.aba === abaAtual);
        if (casa && n >= r.de && n <= r.ate) {
          const novo = r.para !== undefined ? r.para : n + r.desloc;
          return (aba || '') + d1 + c + d2 + novo;
        }
      }
      return m;
    });
  }
  return partes.join('"');
}

/* ================================================================== */
/* Utilitários                                                         */
/* ================================================================== */

/** Procura, nas primeiras `max` linhas, a que contém todos os rótulos. */
function acharCabecalho_(v, rotulos, max) {
  for (let i = 0; i < Math.min(max, v.length); i++) {
    const linha = v[i].map(x => semAcento_(x));
    if (rotulos.every(r => linha.indexOf(r) >= 0)) return i;
  }
  return -1;
}

/** { 'rotulo sem acento': índiceDaColuna } — primeira ocorrência vence. */
function indice_(linha) {
  const m = {};
  linha.forEach((h, i) => {
    const k = semAcento_(h);
    if (k && m[k] === undefined) m[k] = i;
  });
  return m;
}

function semAcento_(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Chave de comparação de nomes de turma (ignora acento, travessão, espaços). */
function chave_(s) {
  return semAcento_(s).replace(/[–—]/g, '-').replace(/\s*-\s*/g, '-');
}

function texto_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return String(v).trim();
}

function numero_(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return isNaN(n) ? null : n;
}

function data_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return new Date(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}

/** Data → "yyyy-MM-dd" no fuso do script (evita perder um dia). */
function iso_(d) {
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : null;
}

function usuario_() {
  try { return Session.getActiveUser().getEmail() || 'desconhecido'; } catch (e) { return 'desconhecido'; }
}

/* ================================================================== */
/* Diagnóstico                                                         */
/* ================================================================== */

/** Rode pelo editor (ou pelo menu) para conferir o que foi lido. */
function diagnosticar() {
  const d = montarDados_();
  const porAba = {};
  d.etapas.forEach(e => { porAba[e.aba] = (porAba[e.aba] || 0) + 1; });
  const linhas = [
    'Turmas: ' + d.turmas.length,
    'Etapas: ' + d.etapas.length,
    ...Object.keys(porAba).map(a => '  • ' + a + ': ' + porAba[a] + ' etapas'),
    'Formandos (linhas): ' + d.formandos.length,
    'Regras: ' + d.regras.length,
    'Responsáveis: ' + d.responsaveis.join(', ')
  ];
  if (d.avisos.length) linhas.push('', 'Avisos:', ...d.avisos.map(a => '  ⚠ ' + a));
  const txt = linhas.join('\n');
  Logger.log(txt);
  return txt;
}

function diagnosticarUi() {
  SpreadsheetApp.getUi().alert('Diagnóstico da leitura', diagnosticar(), SpreadsheetApp.getUi().ButtonSet.OK);
}
