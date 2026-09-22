'use strict';

const path = require('path');
const fs = require('fs');
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

/* =====================================================================
 * pptx.service.js
 *
 * Geração da apresentação final do módulo Resultado.
 *
 * Recebe os pontos confirmados (agrupados por categoria/tributo) e o
 * caminho do template .pptx, e devolve um Buffer pronto pra download.
 *
 * Como funciona: o .pptx é um zip de XMLs. As tabelas dos slides 5-8
 * (ADM) e 15-17 (FTX) não são tabelas do PowerPoint — são imagens (WMF)
 * coladas do Excel. Este serviço localiza cada imagem pelo nome da shape
 * (ex.: "TabelaPIS"), captura a posição/tamanho original, remove a
 * imagem e insere uma <a:tbl> nativa no mesmo lugar, com a mesma paleta
 * do template. Os outros 17 slides ficam byte-a-byte idênticos.
 *
 * Dependências: jszip, @xmldom/xmldom
 * ===================================================================== */

// ─── Paleta (extraída do template original SLIDE_PADRÃO_-_V6.pptx) ───────────
const COLORS = {
  TAN: 'C5AE95',         // cabeçalho / faixa "Total por Cor"
  DARK_BROWN: '4C3C2A',  // linha de TOTAL (texto branco)
  WHITE: 'FFFFFF',
  NEAR_BLACK: '2A1F14',
  VERDE: '00B050',
  AMARELO: '8A6D00',
  VERMELHO: 'E02B2B',
};

const FONT_NAME = 'Calibri';
const ROW_HEIGHT_EMU = 320000; // ~0.87 cm, compacto como no original

// Shapes-alvo em cada slide (nome da imagem → tributo → label na tabela)
const ADM_TARGETS = [
  { pictureName: 'TabelaPIS',  tax: 'PIS_COFINS', label: 'PIS/COFINS' },
  { pictureName: 'TabelaINSS', tax: 'INSS',       label: 'INSS'       },
  { pictureName: 'TabelaIRPJ', tax: 'IRPJ_CSLL',  label: 'IRPJ/CSLL' },
  { pictureName: 'TabelaIPI',  tax: 'IPI',         label: 'IPI'        },
];

const FTX_TARGETS = [
  { pictureName: 'FintaxPIS',  tax: 'PIS_COFINS', label: 'PIS E COFINS' },
  { pictureName: 'FintaxINSS', tax: 'INSS',       label: 'INSS'         },
  { pictureName: 'FintaxIRPJ', tax: 'IRPJ_CSLL',  label: 'IRPJ/CSLL'   },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatCurrency(value) {
  const v = Number(value || 0);
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Construtores de XML OOXML ────────────────────────────────────────────────

/**
 * Uma célula de tabela DrawingML.
 * opts: { fill, color, bold, align ('l'|'ctr'|'r'), colSpan, size (pt) }
 */
function buildCellXml(text, opts = {}) {
  const {
    fill    = COLORS.WHITE,
    color   = COLORS.NEAR_BLACK,
    bold    = false,
    align   = 'l',
    colSpan = 1,
    size    = 11,
  } = opts;

  const gridSpanAttr = colSpan > 1 ? ` gridSpan="${colSpan}"` : '';

  return `
      <a:tc${gridSpanAttr}>
        <a:txBody>
          <a:bodyPr anchor="ctr"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr algn="${align}"/>
            <a:r>
              <a:rPr lang="pt-BR" sz="${Math.round(size * 100)}" b="${bold ? '1' : '0'}" dirty="0">
                <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
                <a:latin typeface="${FONT_NAME}"/>
              </a:rPr>
              <a:t>${escapeXml(text)}</a:t>
            </a:r>
          </a:p>
        </a:txBody>
        <a:tcPr marL="45720" marR="45720" marT="18000" marB="18000" anchor="ctr">
          <a:lnL w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnL>
          <a:lnR w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnR>
          <a:lnT w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnT>
          <a:lnB w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnB>
          <a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>
        </a:tcPr>
      </a:tc>`;
}

/** Célula fantasma de continuação de mesclagem horizontal (gridSpan > 1). */
function buildMergeContinuationCellXml() {
  return `
      <a:tc hMerge="1">
        <a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody>
        <a:tcPr/>
      </a:tc>`;
}

/**
 * Linha da tabela. Células com colSpan > 1 geram automaticamente as
 * células-fantasma de continuação.
 */
function buildRowXml(cells) {
  const cellsXml = cells
    .map((cell) => {
      const span = cell.colSpan || 1;
      let xml = buildCellXml(cell.text, cell);
      for (let i = 1; i < span; i += 1) xml += buildMergeContinuationCellXml();
      return xml;
    })
    .join('');
  return `
    <a:tr h="${ROW_HEIGHT_EMU}">${cellsXml}
    </a:tr>`;
}

/**
 * <p:graphicFrame> completo que envolve a <a:tbl>, posicionado exatamente
 * onde estava a imagem removida.
 */
function buildGraphicFrameXml({ box, colWidthsEmu, rows, shapeId, shapeName }) {
  const gridColsXml = colWidthsEmu.map((w) => `<a:gridCol w="${Math.round(w)}"/>`).join('');
  const totalHeight = rows.length * ROW_HEIGHT_EMU;

  return `
<p:graphicFrame>
  <p:nvGraphicFramePr>
    <p:cNvPr id="${shapeId}" name="${escapeXml(shapeName)}"/>
    <p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>
    <p:nvPr/>
  </p:nvGraphicFramePr>
  <p:xfrm>
    <a:off x="${box.x}" y="${box.y}"/>
    <a:ext cx="${box.cx}" cy="${totalHeight}"/>
  </p:xfrm>
  <a:graphic>
    <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
      <a:tbl>
        <a:tblPr firstRow="0" bandRow="0"/>
        <a:tblGrid>${gridColsXml}</a:tblGrid>
        ${rows.join('')}
      </a:tbl>
    </a:graphicData>
  </a:graphic>
</p:graphicFrame>`;
}

// ─── Montagem das tabelas por tipo ────────────────────────────────────────────

/**
 * ADM (slides 5-8): 3 colunas — TRIBUTO | PONTOS | VALOR, linha de TOTAL.
 */
function buildAdmTable(points, label) {
  const colWidthFractions = [0.159, 0.637, 0.204];
  const rows = [];

  rows.push(buildRowXml([
    { text: 'TRIBUTO', fill: COLORS.TAN, bold: true, align: 'ctr' },
    { text: 'PONTOS',  fill: COLORS.TAN, bold: true, align: 'ctr' },
    { text: 'VALOR',   fill: COLORS.TAN, bold: true, align: 'ctr' },
  ]));

  let total = 0;
  if (!points.length) {
    rows.push(buildRowXml([
      { text: label },
      { text: 'Nenhum ponto confirmado' },
      { text: formatCurrency(0), align: 'r' },
    ]));
  } else {
    for (const point of points) {
      const value = Number(point.total || 0);
      total += value;
      rows.push(buildRowXml([
        { text: label },
        { text: point.name || '' },
        { text: formatCurrency(value), align: 'r' },
      ]));
    }
  }

  rows.push(buildRowXml([
    { text: 'TOTAL', fill: COLORS.DARK_BROWN, color: COLORS.WHITE, bold: true, align: 'ctr', colSpan: 2 },
    { text: formatCurrency(total), fill: COLORS.DARK_BROWN, color: COLORS.WHITE, bold: true, align: 'r' },
  ]));

  return { rows, colWidthFractions };
}

/**
 * FTX (slides 15-17): 5 colunas — TRIBUTO | PONTOS | VERDE | AMARELO | VERMELHO,
 * linhas "Total por Cor" e "TOTAL GERAL".
 * O valor de cada ponto vai só na coluna da sua risk_color.
 */
function buildFtxTable(points, label) {
  const colWidthFractions = [0.146, 0.402, 0.15, 0.15, 0.152];
  const rows = [];

  rows.push(buildRowXml([
    { text: 'TRIBUTO',  fill: COLORS.TAN, bold: true, align: 'ctr' },
    { text: 'PONTOS',   fill: COLORS.TAN, bold: true, align: 'ctr' },
    { text: 'VERDE',    fill: COLORS.TAN, bold: true, align: 'ctr', color: COLORS.VERDE },
    { text: 'AMARELO',  fill: COLORS.TAN, bold: true, align: 'ctr', color: COLORS.AMARELO },
    { text: 'VERMELHO', fill: COLORS.TAN, bold: true, align: 'ctr', color: COLORS.VERMELHO },
  ]));

  const totals = { VERDE: 0, AMARELO: 0, VERMELHO: 0 };

  if (!points.length) {
    rows.push(buildRowXml([
      { text: label },
      { text: 'Nenhum ponto confirmado' },
      { text: '' }, { text: '' }, { text: '' },
    ]));
  } else {
    for (const point of points) {
      const value = Number(point.total || 0);
      const color = (point.risk_color || '').toUpperCase();
      const cells = [{ text: label }, { text: point.name || '' }];
      for (const colColor of ['VERDE', 'AMARELO', 'VERMELHO']) {
        if (color === colColor) {
          totals[colColor] += value;
          cells.push({ text: formatCurrency(value), align: 'r' });
        } else {
          cells.push({ text: '' });
        }
      }
      rows.push(buildRowXml(cells));
    }
  }

  rows.push(buildRowXml([
    { text: 'Total por Cor', fill: COLORS.TAN, bold: true, align: 'ctr', colSpan: 2 },
    { text: formatCurrency(totals.VERDE),    fill: COLORS.TAN, bold: true, align: 'r' },
    { text: formatCurrency(totals.AMARELO),  fill: COLORS.TAN, bold: true, align: 'r' },
    { text: formatCurrency(totals.VERMELHO), fill: COLORS.TAN, bold: true, align: 'r' },
  ]));

  const totalGeral = totals.VERDE + totals.AMARELO + totals.VERMELHO;
  rows.push(buildRowXml([
    { text: 'TOTAL GERAL', fill: COLORS.DARK_BROWN, color: COLORS.WHITE, bold: true, align: 'ctr', colSpan: 2 },
    { text: formatCurrency(totalGeral), fill: COLORS.DARK_BROWN, color: COLORS.WHITE, bold: true, align: 'ctr', colSpan: 3 },
  ]));

  return { rows, colWidthFractions };
}

// ─── Editor de slides (zip + XML) ────────────────────────────────────────────

/**
 * Localiza o <p:pic> pelo atributo name da shape, extrai posição/tamanho
 * e o remove do XML do slide. Retorna { xml, box } ou null se não achar.
 */
function removePictureAndGetBox(slideXml, pictureName) {
  const doc = new DOMParser().parseFromString(slideXml, 'text/xml');
  const pics = doc.getElementsByTagName('p:pic');

  let target = null;
  for (let i = 0; i < pics.length; i += 1) {
    const pic = pics.item(i);
    const cNvPrList = pic.getElementsByTagName('p:cNvPr');
    if (cNvPrList.length && cNvPrList.item(0).getAttribute('name') === pictureName) {
      target = pic;
      break;
    }
  }
  if (!target) return null;

  const xfrmList = target.getElementsByTagName('a:xfrm');
  if (!xfrmList.length) {
    throw new Error(`Shape "${pictureName}" não tem <a:xfrm> — não é possível posicionar a tabela.`);
  }
  const xfrm = xfrmList.item(0);
  const off  = xfrm.getElementsByTagName('a:off').item(0);
  const ext  = xfrm.getElementsByTagName('a:ext').item(0);
  const box  = {
    x:  parseInt(off.getAttribute('x'),  10),
    y:  parseInt(off.getAttribute('y'),  10),
    cx: parseInt(ext.getAttribute('cx'), 10),
    cy: parseInt(ext.getAttribute('cy'), 10),
  };

  target.parentNode.removeChild(target);
  return { xml: new XMLSerializer().serializeToString(doc), box };
}

/** Injeta o <p:graphicFrame> antes do fechamento de <p:spTree>. */
function insertGraphicFrame(slideXml, graphicFrameXml) {
  if (!slideXml.includes('</p:spTree>')) {
    throw new Error('Slide XML não contém </p:spTree> — estrutura inesperada.');
  }
  return slideXml.replace('</p:spTree>', `${graphicFrameXml}</p:spTree>`);
}

/**
 * Para um slide (XML em string), tenta substituir pictureName pela tabela
 * definida em target. Retorna o novo XML ou null se a shape não existir
 * nesse slide.
 */
function replacePictureWithTable(slideXml, { pictureName, rows, colWidthFractions, shapeId }) {
  const removed = removePictureAndGetBox(slideXml, pictureName);
  if (!removed) return null;

  const { xml, box } = removed;
  const colWidthsEmu  = colWidthFractions.map((f) => box.cx * f);
  const graphicFrame  = buildGraphicFrameXml({
    box,
    colWidthsEmu,
    rows,
    shapeId,
    shapeName: `Resultado_${pictureName}`,
  });

  return insertGraphicFrame(xml, graphicFrame);
}

/**
 * Percorre todos os slides do zip procurando cada shape-alvo e substituindo.
 * Lança erro se algum alvo não for encontrado (proteção contra template
 * com nomes de shape alterados).
 */
async function applyTableReplacements(zip, targets) {
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort();

  const found      = new Set();
  let nextShapeId  = 90001;

  for (const fileName of slideFiles) {
    let xml     = await zip.file(fileName).async('string');
    let changed = false;

    for (const target of targets) {
      if (found.has(target.pictureName)) continue;
      const newXml = replacePictureWithTable(xml, { ...target, shapeId: nextShapeId });
      if (newXml !== null) {
        xml     = newXml;
        changed = true;
        found.add(target.pictureName);
        nextShapeId += 1;
      }
    }

    if (changed) zip.file(fileName, xml);
  }

  const missing = targets
    .filter((t) => !found.has(t.pictureName))
    .map((t) => t.pictureName);

  if (missing.length) {
    throw new Error(
      `Não encontrei as seguintes imagens-tabela no template: ${missing.join(', ')}. ` +
      'Verifique se o template não foi alterado (nomes de shape diferentes).'
    );
  }
}

// ─── Função pública ───────────────────────────────────────────────────────────

/**
 * Gera a apresentação final substituindo as imagens-tabela pelos pontos
 * confirmados no módulo Resultado.
 *
 * @param {object} data
 *   data.adm[tax] = [{ name: string, total: number }]
 *   data.ftx[tax] = [{ name: string, total: number, risk_color: string }]
 * @param {Buffer|string} templateBufferOrPath  buffer ou caminho do template .pptx
 * @returns {Promise<Buffer>}  buffer do .pptx final, pronto para res.send()
 */
async function generateResultadoPptx(data, templateBufferOrPath) {
  const rawData = Buffer.isBuffer(templateBufferOrPath)
    ? templateBufferOrPath
    : fs.readFileSync(templateBufferOrPath);

  const zip     = await JSZip.loadAsync(rawData);
  const targets = [];

  for (const cfg of ADM_TARGETS) {
    const points = (data.adm && data.adm[cfg.tax]) || [];
    const { rows, colWidthFractions } = buildAdmTable(points, cfg.label);
    targets.push({ pictureName: cfg.pictureName, rows, colWidthFractions });
  }

  for (const cfg of FTX_TARGETS) {
    const points = (data.ftx && data.ftx[cfg.tax]) || [];
    const { rows, colWidthFractions } = buildFtxTable(points, cfg.label);
    targets.push({ pictureName: cfg.pictureName, rows, colWidthFractions });
  }

  await applyTableReplacements(zip, targets);

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

module.exports = { generateResultadoPptx };