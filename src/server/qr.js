import QRCode from 'qrcode';

// QR code as an SVG of filled blocks, one unit per module. qrcode's own SVG draws every row as a
// 1-unit stroke, which leaves thin seams between rows on scaled displays (125 %, 150 %,
// projectors). Filled blocks share exact edges; the host page also sizes the SVG so each module
// is a whole number of screen pixels.
export function qrSvg(text, margin = 1) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = modules.size;
  const total = size + margin * 2;
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!modules.get(y, x)) continue;
      let run = 1; // merge horizontal runs into one block
      while (x + run < size && modules.get(y, x + run)) run++;
      path += `M${x + margin} ${y + margin}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/><path fill="#000" d="${path}"/></svg>`
  );
}
