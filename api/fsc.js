export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "name required" });

  const key = process.env.FSC_API_KEY;
  if (!key) return res.status(500).json({ error: "FSC_API_KEY not set" });

  try {
    const url = `https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2?serviceKey=${key}&pageNo=1&numOfRows=20&resultType=json&corpNm=${encodeURIComponent(name)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await r.json();
    const items = data?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items];

    const results = list
      .filter(c => c.corpNm)
      .map(c => ({
        id: "fsc_" + (c.crno || c.bzno || Date.now()),
        corp_code: "fsc_" + (c.crno || ""),
        name: c.corpNm,
        listed: false,
        fsc: true,
        ceo: c.enpRprFnm || "",
        region: c.enpBsadr ? c.enpBsadr.slice(0, 2) : "-",
        founded: c.enpEstbDt ? c.enpEstbDt.slice(0, 4) : "-",
        homepage: c.enpHmpgUrl || "",
        tel: c.enpTlno || "",
        industry_nm: c.sicNm || "-",
        employees: c.enpEmpeCnt ? parseInt(c.enpEmpeCnt) || null : null,
        revenue: null, profit: null, assets: null,
        bizno: c.bzno || "",
        corpno: c.crno || "",
        address: c.enpBsadr || "",
      }));

    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
