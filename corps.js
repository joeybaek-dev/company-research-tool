// api/corps.js
// DART corpCode.xml 파싱해서 기업명 검색 제공

const DART_KEY = "a240d6fa018357edecf3ad8a267417628c7f29f4";

export const config = { maxDuration: 60 }; // Vercel Pro: 60초, 무료: 10초

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { keyword = "", listed = "", page = "1", limit = "20" } = req.query;
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 20;

  try {
    // ZIP 다운로드
    const zipRes = await fetch(
      `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${DART_KEY}`
    );
    if (!zipRes.ok) throw new Error(`ZIP 다운로드 실패: ${zipRes.status}`);

    const buffer = await zipRes.arrayBuffer();
    const xmlText = await unzip(buffer);
    const corps = parseXml(xmlText);

    // 필터링
    let filtered = corps.filter(c => {
      const matchKw = !keyword || c.corp_name.includes(keyword);
      const matchListed = !listed ||
        (listed === "Y" ? !!c.stock_code : !c.stock_code);
      return matchKw && matchListed;
    });

    const total = filtered.length;
    const start = (pageNum - 1) * limitNum;
    const list = filtered.slice(start, start + limitNum).map(c => ({
      corp_code: c.corp_code,
      corp_name: c.corp_name,
      stock_code: c.stock_code || "",
      listed: !!c.stock_code,
    }));

    res.status(200).json({ status: "000", total, page: pageNum, list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ZIP → XML 텍스트
async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  while (offset < bytes.length - 4) {
    if (bytes[offset]===0x50 && bytes[offset+1]===0x4B &&
        bytes[offset+2]===0x03 && bytes[offset+3]===0x04) {
      const method = bytes[offset+8] | (bytes[offset+9]<<8);
      const compSize = bytes[offset+18] | (bytes[offset+19]<<8) |
                       (bytes[offset+20]<<16) | (bytes[offset+21]<<24);
      const fnLen = bytes[offset+26] | (bytes[offset+27]<<8);
      const extraLen = bytes[offset+28] | (bytes[offset+29]<<8);
      const dataStart = offset + 30 + fnLen + extraLen;
      const compressed = bytes.slice(dataStart, dataStart + compSize);

      if (method === 0) {
        return new TextDecoder("utf-8").decode(compressed);
      } else if (method === 8) {
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        writer.write(compressed);
        writer.close();
        const reader = ds.readable.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const out = new Uint8Array(total);
        let pos = 0;
        for (const c of chunks) { out.set(c, pos); pos += c.length; }
        // EUC-KR 시도, 실패 시 UTF-8
        try { return new TextDecoder("euc-kr").decode(out); }
        catch { return new TextDecoder("utf-8").decode(out); }
      }
      offset = dataStart + compSize;
    } else { offset++; }
  }
  throw new Error("XML 추출 실패");
}

// XML → 기업 배열
function parseXml(xml) {
  const corps = [];
  const regex = /<list>([\s\S]*?)<\/list>/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const b = m[1];
    const get = tag => { const r = b.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`)); return r ? r[1].trim() : ""; };
    const corp_code = get("corp_code");
    const corp_name = get("corp_name");
    const stock_code = get("stock_code").replace(/\s/g,"");
    if (corp_code && corp_name) corps.push({ corp_code, corp_name, stock_code });
  }
  return corps;
}
