// api/dart.js - DART API 중계 + 기업목록 파싱

const DART_KEY = "a240d6fa018357edecf3ad8a267417628c7f29f4";
const DART_BASE = "https://opendart.fss.or.kr/api";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action, ...params } = req.query;

  try {
    // ── 1. 기업 목록 + 재무정보 통합 조회 ──────────────────
    if (action === "search") {
      const { keyword = "", induty_code = "", listed = "", year, page = "1", limit = "50" } = params;
      const bsns_year = year || String(new Date().getFullYear() - 1);
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      // Step 1: 상장법인 목록 조회
      const listRes = await fetch(
        `${DART_BASE}/corpCode.xml?crtfc_key=${DART_KEY}`
      );
      const zipBuffer = await listRes.arrayBuffer();

      // ZIP에서 XML 추출 (간단한 파서)
      const xmlText = await extractXmlFromZip(zipBuffer);
      const corps = parseCorpXml(xmlText);

      // Step 2: 필터링
      let filtered = corps.filter(c => {
        const matchKw = !keyword || c.corp_name.includes(keyword);
        const matchListed = !listed ||
          (listed === "Y" ? c.stock_code : !c.stock_code);
        return matchKw && matchListed;
      });

      // Step 3: 페이징
      const total = filtered.length;
      const start = (pageNum - 1) * limitNum;
      const paginated = filtered.slice(start, start + limitNum);

      // Step 4: 재무정보 병렬 조회 (최대 10개씩 배치)
      const results = [];
      const batchSize = 10;
      for (let i = 0; i < paginated.length; i += batchSize) {
        const batch = paginated.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (c) => {
            try {
              const [finRes, detailRes] = await Promise.all([
                fetch(`${DART_BASE}/fnlttSinglAcnt.json?crtfc_key=${DART_KEY}&corp_code=${c.corp_code}&bsns_year=${bsns_year}&reprt_code=11011`),
                fetch(`${DART_BASE}/company.json?crtfc_key=${DART_KEY}&corp_code=${c.corp_code}`)
              ]);
              const [finData, detail] = await Promise.all([finRes.json(), detailRes.json()]);

              const items = finData.list || [];
              const get = (nm) => {
                const item = items.find(x => x.account_nm === nm);
                return item ? Math.round(parseInt((item.thstrm_amount || "0").replace(/,/g, "")) / 100000000) : null;
              };

              // 업종 코드 필터
              if (induty_code && !(detail.induty_code || "").startsWith(induty_code)) return null;

              return {
                corp_code: c.corp_code,
                name: c.corp_name,
                stock_code: c.stock_code || "",
                listed: !!c.stock_code,
                industry_nm: detail.induty_nm || "-",
                industry_code: detail.induty_code || "",
                region: detail.adres ? detail.adres.slice(0, 2) : "-",
                founded: detail.est_dt ? detail.est_dt.slice(0, 4) : "-",
                employees: parseInt(detail.emp_no) || null,
                homepage: detail.hm_url || "",
                revenue: get("매출액"),
                profit: get("영업이익"),
                assets: get("자산총계"),
              };
            } catch { return null; }
          })
        );
        results.push(...batchResults.filter(Boolean));
      }

      return res.status(200).json({
        status: "000",
        total,
        page: pageNum,
        limit: limitNum,
        list: results,
      });
    }

    // ── 2. 일반 DART API 중계 ──────────────────────────────
    const { endpoint, ...rest } = params;
    if (!endpoint) return res.status(400).json({ error: "endpoint 또는 action 필요" });

    const query = new URLSearchParams({ crtfc_key: DART_KEY, ...rest }).toString();
    const response = await fetch(`${DART_BASE}/${endpoint}?${query}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const text = await response.text();
    try { res.status(200).json(JSON.parse(text)); }
    catch { res.status(200).send(text); }

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── ZIP에서 XML 추출 ──────────────────────────────────────
async function extractXmlFromZip(buffer) {
  // ZIP 파일에서 XML 파일 내용 추출 (간단한 구현)
  const bytes = new Uint8Array(buffer);
  // ZIP Local File Header 시그니처: PK\x03\x04
  let offset = 0;
  while (offset < bytes.length - 4) {
    if (bytes[offset]===0x50 && bytes[offset+1]===0x4B &&
        bytes[offset+2]===0x03 && bytes[offset+3]===0x04) {
      const compMethod = bytes[offset+8] | (bytes[offset+9]<<8);
      const compSize = bytes[offset+18] | (bytes[offset+19]<<8) | (bytes[offset+20]<<16) | (bytes[offset+21]<<24);
      const fnLen = bytes[offset+26] | (bytes[offset+27]<<8);
      const extraLen = bytes[offset+28] | (bytes[offset+29]<<8);
      const dataStart = offset + 30 + fnLen + extraLen;

      if (compMethod === 0) {
        // 비압축
        const xmlBytes = bytes.slice(dataStart, dataStart + compSize);
        return new TextDecoder("euc-kr").decode(xmlBytes);
      } else if (compMethod === 8) {
        // Deflate 압축
        const compressed = bytes.slice(dataStart, dataStart + compSize);
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
        const result = new Uint8Array(total);
        let pos = 0;
        for (const c of chunks) { result.set(c, pos); pos += c.length; }
        return new TextDecoder("euc-kr").decode(result);
      }
      offset = dataStart + compSize;
    } else { offset++; }
  }
  throw new Error("XML 추출 실패");
}

// ── XML 파싱 ─────────────────────────────────────────────
function parseCorpXml(xml) {
  const corps = [];
  const regex = /<list>([\s\S]*?)<\/list>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`));
      return m ? m[1].trim() : "";
    };
    const corp_code = get("corp_code");
    const corp_name = get("corp_name");
    const stock_code = get("stock_code").replace(/\s/g, "");
    if (corp_code && corp_name) corps.push({ corp_code, corp_name, stock_code });
  }
  return corps;
}
