// api/dart.js

const DART_KEY = "a240d6fa018357edecf3ad8a267417628c7f29f4";
const DART_BASE = "https://opendart.fss.or.kr/api";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action, corp_code, bsns_year, keyword } = req.query;

  try {
    // ── 1. 기업 상세정보 조회 ─────────────────────────────
    if (action === "company") {
      const r = await fetch(`${DART_BASE}/company.json?crtfc_key=${DART_KEY}&corp_code=${corp_code}`);
      return res.status(200).json(await r.json());
    }

    // ── 2. 재무정보 조회 (단일 기업) ──────────────────────
    if (action === "finance") {
      const year = bsns_year || String(new Date().getFullYear() - 1);
      const r = await fetch(
        `${DART_BASE}/fnlttSinglAcnt.json?crtfc_key=${DART_KEY}` +
        `&corp_code=${corp_code}&bsns_year=${year}&reprt_code=11011`
      );
      return res.status(200).json(await r.json());
    }

    // ── 3. 상장법인 전체 목록 조회 ────────────────────────
    if (action === "list") {
      const { page = "1", induty_code = "" } = req.query;
      // DART 상장법인 목록 (페이지당 100개)
      const url = `${DART_BASE}/company.json?crtfc_key=${DART_KEY}` +
        `&corp_name=&page_no=${page}&page_count=100` +
        (induty_code ? `&induty_code=${induty_code}` : "");
      const r = await fetch(url);
      return res.status(200).json(await r.json());
    }

    // ── 4. 복수기업 재무정보 (핵심 API) ──────────────────
    if (action === "multifinance") {
      const year = bsns_year || String(new Date().getFullYear() - 1);
      // 사업보고서 기준 전체 기업 재무
      const r = await fetch(
        `${DART_BASE}/fnlttMultiAcnt.json?crtfc_key=${DART_KEY}` +
        `&bsns_year=${year}&reprt_code=11011&fs_div=OFS`
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: "action 파라미터 필요 (company/finance/list/multifinance)" });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
// ── 5. 임직원 현황 조회 ────────────────────────────────
if (action === "empstatus") {
  const year = bsns_year || String(new Date().getFullYear() - 1);
  const r = await fetch(
    `${DART_BASE}/empSttus.json?crtfc_key=${DART_KEY}` +
    `&corp_code=${corp_code}&bsns_year=${year}&reprt_code=11011`
  );
  return res.status(200).json(await r.json());
}
