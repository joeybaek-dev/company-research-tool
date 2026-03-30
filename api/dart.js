// api/dart.js - DART API 중계 (빠른 버전)

const DART_KEY = "a240d6fa018357edecf3ad8a267417628c7f29f4";
const DART_BASE = "https://opendart.fss.or.kr/api";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action, ...params } = req.query;

  try {
    // ── 기업 검색 ──────────────────────────────────────────
    if (action === "search") {
      const { keyword = "", induty_code = "", listed = "", year, page = "1" } = params;
      const bsns_year = year || String(new Date().getFullYear() - 1);
      const pageNum = parseInt(page);

      // Step 1: 기업명 검색 (DART company 검색 API)
      const searchParams = new URLSearchParams({
        crtfc_key: DART_KEY,
        corp_name: keyword || "",
        page_no: pageNum,
        page_count: 50,
      });
      // 상장 여부 필터
      if (listed === "Y") searchParams.set("corp_cls", "Y"); // 유가증권
      if (listed === "N") searchParams.set("corp_cls", "E"); // 기타(비상장)

      const listRes = await fetch(`${DART_BASE}/corpCode.json?${searchParams}`);
      const listData = await listRes.json();

      if (!listData || listData.status !== "000") {
        // corpCode.json 실패 시 company.json으로 fallback
        const fallbackRes = await fetch(
          `${DART_BASE}/company.json?crtfc_key=${DART_KEY}&corp_name=${encodeURIComponent(keyword || "")}`
        );
        const fallbackData = await fallbackRes.json();
        if (fallbackData.status === "000") {
          return res.status(200).json({
            status: "000",
            total: 1,
            page: 1,
            list: [formatCompany(fallbackData, null)],
          });
        }
        throw new Error(listData?.message || "기업 목록 조회 실패");
      }

      const corps = listData.list || [];
      const total = listData.total_count || corps.length;

      // Step 2: 재무정보 병렬 조회 (최대 10개씩 배치)
      const results = [];
      const batchSize = 8;
      for (let i = 0; i < corps.length; i += batchSize) {
        const batch = corps.slice(i, i + batchSize);
        const batchRes = await Promise.all(
          batch.map(async (c) => {
            try {
              // 업종 필터 (상세조회 필요)
              const [finRes, detailRes] = await Promise.all([
                fetch(`${DART_BASE}/fnlttSinglAcnt.json?crtfc_key=${DART_KEY}&corp_code=${c.corp_code}&bsns_year=${bsns_year}&reprt_code=11011`),
                fetch(`${DART_BASE}/company.json?crtfc_key=${DART_KEY}&corp_code=${c.corp_code}`)
              ]);
              const [finData, detail] = await Promise.all([finRes.json(), detailRes.json()]);

              // 업종 필터 적용
              if (induty_code && !(detail.induty_code || "").startsWith(induty_code)) return null;

              return formatCompany(detail, finData, bsns_year);
            } catch { return null; }
          })
        );
        results.push(...batchRes.filter(Boolean));
      }

      return res.status(200).json({ status:"000", total, page: pageNum, list: results });
    }

    // ── 일반 DART API 중계 ─────────────────────────────────
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

// ── 기업 데이터 포맷 ───────────────────────────────────────
function formatCompany(detail, finData, year) {
  const items = finData?.list || [];
  const get = (nm) => {
    const item = items.find(x => x.account_nm === nm);
    return item ? Math.round(parseInt((item.thstrm_amount || "0").replace(/,/g, "")) / 100000000) : null;
  };
  return {
    corp_code: detail.corp_code,
    name: detail.corp_name,
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
}
