// api/dart.js - DART API 중계 (v6 - ZIP 없는 순수 JSON API)

const DART_KEY = "a240d6fa018357edecf3ad8a267417628c7f29f4";
const DART_BASE = "https://opendart.fss.or.kr/api";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action, keyword = "", induty_code = "", listed = "", year, page = "1" } = req.query;

  try {
    if (action !== "search") {
      // 일반 DART API 중계
      const { endpoint, ...rest } = req.query;
      if (!endpoint) return res.status(400).json({ error: "endpoint 파라미터 필요" });
      const query = new URLSearchParams({ crtfc_key: DART_KEY, ...rest }).toString();
      const response = await fetch(`${DART_BASE}/${endpoint}?${query}`);
      const text = await response.text();
      try { return res.status(200).json(JSON.parse(text)); }
      catch { return res.status(200).send(text); }
    }

    const bsns_year = year || String(new Date().getFullYear() - 1);
    const pageNum = parseInt(page) || 1;

    // ── Step 1: 공시 목록에서 기업 추출 ──────────────────────
    const listRes = await fetch(
      `${DART_BASE}/list.json?crtfc_key=${DART_KEY}` +
      `&corp_name=${encodeURIComponent(keyword)}` +
      `&bgn_de=20240101&end_de=20241231` +
      `&page_no=1&page_count=100&sort=crp&sort_mth=asc`
    );
    const listData = await listRes.json();

    if (listData.status !== "000") {
      return res.status(200).json({ status: "000", total: 0, page: pageNum, list: [] });
    }

    // 기업명에 키워드 포함된 것만 + 중복 제거
    const seen = new Set();
    const corps = (listData.list || [])
      .filter(c => {
        const match = !keyword || c.corp_name.includes(keyword);
        if (!match || seen.has(c.corp_code)) return false;
        seen.add(c.corp_code);
        return true;
      })
      .slice(0, 20); // 최대 20개

    if (corps.length === 0) {
      // 공시 없으면 단일 기업 직접 조회
      const single = await fetch(
        `${DART_BASE}/company.json?crtfc_key=${DART_KEY}&corp_name=${encodeURIComponent(keyword)}`
      );
      const singleData = await single.json();
      if (singleData.status === "000" && singleData.corp_code) {
        const fin = await fetchFin(singleData.corp_code, bsns_year);
        const result = buildCompany(singleData, fin);
        if (listed === "Y" && !result.listed) return res.status(200).json({ status:"000", total:0, page:1, list:[] });
        if (listed === "N" && result.listed) return res.status(200).json({ status:"000", total:0, page:1, list:[] });
        return res.status(200).json({ status:"000", total:1, page:1, list:[result] });
      }
      return res.status(200).json({ status:"000", total:0, page:pageNum, list:[] });
    }

    // ── Step 2: 재무 + 상세 병렬 조회 (5개씩 배치) ───────────
    const results = [];
    for (let i = 0; i < corps.length; i += 5) {
      const batch = corps.slice(i, i + 5);
      const batchRes = await Promise.all(batch.map(async c => {
        try {
          const [fin, detail] = await Promise.all([
            fetchFin(c.corp_code, bsns_year),
            fetchDetail(c.corp_code),
          ]);
          if (induty_code && !(detail.induty_code || "").startsWith(induty_code)) return null;
          if (listed === "Y" && !detail.stock_code) return null;
          if (listed === "N" && detail.stock_code) return null;
          return buildCompany(detail, fin);
        } catch { return null; }
      }));
      results.push(...batchRes.filter(Boolean));
    }

    return res.status(200).json({
      status: "000",
      total: results.length,
      page: pageNum,
      list: results,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── 재무정보 조회 ─────────────────────────────────────────
async function fetchFin(corp_code, year) {
  const res = await fetch(
    `${DART_BASE}/fnlttSinglAcnt.json?crtfc_key=${DART_KEY}` +
    `&corp_code=${corp_code}&bsns_year=${year}&reprt_code=11011`
  );
  return res.json();
}

// ── 기업 상세정보 조회 ────────────────────────────────────
async function fetchDetail(corp_code) {
  const res = await fetch(
    `${DART_BASE}/company.json?crtfc_key=${DART_KEY}&corp_code=${corp_code}`
  );
  return res.json();
}

// ── 기업 데이터 포맷팅 ────────────────────────────────────
function buildCompany(detail, fin) {
  const get = (nm) => {
    const item = (fin?.list || []).find(x => x.account_nm === nm);
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
