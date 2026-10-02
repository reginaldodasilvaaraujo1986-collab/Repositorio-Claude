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
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(CONFIG.TITULO)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
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
  const html = HtmlService.createTemplateFromFile('Index').evaluate()
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
function getDadosPainel(forcar) {
  if (!forcar) {
    const emCache = lerCache_();
    if (emCache) return emCache;
  }
  const json = JSON.stringify(montarDados_());
  gravarCache_(json);
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
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
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
  });
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
  });
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
  });
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
  });
}

/** Atualiza a quantidade de formados de uma linha da aba "Formandos 2026". */
function atualizarFormados(req) {
  return comTrava_(ss => {
    const aba = abaOuErro_(ss, CONFIG.ABA_FORMANDOS);
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
    historico_(ss, CONFIG.ABA_FORMANDOS, req.linha, req.curso + ' / ' + req.turma, '', 'Formados', texto_(antigo) + ' → ' + n);
    return { ok: true };
  });
}

/* ---------- apoio às edições ---------- */

const NOTA_FORMULA = 'Fórmula original (painel): ';

/** Executa a gravação com trava, limpa o cache e devolve JSON. */
function comTrava_(fn) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try {
    const r = fn(SpreadsheetApp.getActiveSpreadsheet());
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

function montarDados_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
    url: ss.getUrl(),
    geradoEm: new Date().toISOString(),
    hoje: iso_(new Date()),
    statusEtapa: CONFIG.STATUS_ETAPA,
    podeEditar: true,
    turmas: turmas,
    etapas: etapas,
    formandos: lerFormandos_(ss),
    regras: lerRegras_(ss),
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
  const fixas = [CONFIG.ABA_CADASTRO, CONFIG.ABA_FORMANDOS, CONFIG.ABA_REGRAS, CONFIG.ABA_LISTAS, CONFIG.ABA_HISTORICO]
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
  const aba = ss.getSheetByName(CONFIG.ABA_FORMANDOS);
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

const CACHE_PREFIXO = 'painel_v2_';

function gravarCache_(json) {
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

function lerCache_() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(CACHE_PREFIXO + 'n'));
  if (!n) return null;
  const chaves = [];
  for (let i = 0; i < n; i++) chaves.push(CACHE_PREFIXO + i);
  const partes = cache.getAll(chaves);
  if (Object.keys(partes).length !== n) return null;
  return chaves.map(k => partes[k]).join('');
}

function limparCache() {
  const cache = CacheService.getScriptCache();
  const chaves = [CACHE_PREFIXO + 'n'];
  for (let i = 0; i < 50; i++) chaves.push(CACHE_PREFIXO + i);
  cache.removeAll(chaves);
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
