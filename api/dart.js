// api/dart.js - DART API 중계 (v4)

const DART_KEY = "a240d6fa018357edecf3ad8a267417628c7f29f4";
const DART_BASE = "https://opendart.fss.or.kr/api";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action, ...params } = req.query;

  try {
    if (action === "search") {
      const { keyword = "", induty_code = "", listed = "", year, page = "1" } = params;
      const bsns_year = year || String(new Date().getFullYear() - 1);
      const pageNum = parseInt(page);

      // ── Step 1: 기업 검색 (올바른 DART API) ──────────────
      // DART 기업개황 검색: corp_name으로 검색
      const searchUrl = `${DART_BASE}/company.json?crtfc_key=${DART_KEY}&corp_name=${encodeURIComponent(keyword)}`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();

      // 단일 기업 결과인 경우
      if (searchData.status === "000" && searchData.corp_code) {
        const corps = [searchData];
        const results = await fetchFinancials(corps, bsns_year, induty_code);
        return res.status(200).json({ status:"000", total:1, page:1, list:results });
      }

      // 목록 결과가 없으면 공시 검색으로 fallback
      // DART 공시검색 API로 기업 목록 조회
      const discUrl = `${DART_BASE}/list.json?crtfc_key=${DART_KEY}&corp_name=${encodeURIComponent(keyword)}&page_no=${pageNum}&page_count=20&sort=date&sort_mth=desc`;
      const discRes = await fetch(discUrl);
      const discData = await discRes.json();

      if (discData.status !== "000") {
        throw new Error(discData.message || "검색 결과 없음");
      }

      // 중복 제거 (corp_code 기준)
      const seen = new Set();
      const uniqueCorps = (discData.list || []).filter(c => {
        if (seen.has(c.corp_code)) return false;
        seen.add(c.corp_code);
        return true;
      }).map(c => ({ corp_code: c.corp_code, corp_name: c.corp_name, stock_code: c.stock_code }));

      const total = discData.total_count || uniqueCorps.length;
      const results = await fetchFinancials(uniqueCorps, bsns_year, induty_code, listed);

      return res.status(200).json({ status:"000", total, page: pageNum, list: results });
    }

    // ── 일반 DART API 중계 ─────────────────────────────────
    const { endpoint, ...rest } = params;
    if (!endpoint) return res.status(400).json({ error: "action 또는 endpoint 필요" });
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

// ── 재무정보 병렬 조회 ────────────────────────────────────
async function fetchFinancials(corps, year, induty_code, listed) {
  const results = [];
  const batchSize = 5;

  for (let i = 0; i < corps.length; i += batchSize) {
    const batch = corps.slice(i, i + batchSize);
    const batchRes = await Promise.all(
      batch.map(async (c) => {
        try {
          const [finRes, detailRes] = await Promise.all([
            fetch(`${DART_BASE}/fnlttSinglAcnt.json?crtfc_key=${DART_KEY}&corp_code=${c.corp_code}&bsns_year=${year}&reprt_code=11011`),
            fetch(`${DART_BASE}/company.json?crtfc_key=${DART_KEY}&corp_code=${c.corp_code}`)
          ]);
          const [fin, detail] = await Promise.all([finRes.json(), detailRes.json()]);

          // 업종 필터
          if (induty_code && !(detail.induty_code || "").startsWith(induty_code)) return null;
          // 상장 필터
          if (listed === "Y" && !detail.stock_code) return null;
          if (listed === "N" && detail.stock_code) return null;

          const get = (nm) => {
            const item = (fin.list || []).find(x => x.account_nm === nm);
            return item ? Math.round(parseInt((item.thstrm_amount||"0").replace(/,/g,"")) / 100000000) : null;
          };

          return {
            corp_code: c.corp_code,
            name: detail.corp_name || c.corp_name,
            stock_code: detail.stock_code || "",
            listed: !!detail.stock_code,
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
    results.push(...batchRes.filter(Boolean));
  }
  return results;
}
