// api/dart.js
// Vercel 서버리스 함수 - DART API 중계 (CORS 해결)

const DART_KEY = "a240d6fa018357edecf3ad8a267417628c7f29f4";
const DART_BASE = "https://opendart.fss.or.kr/api";

export default async function handler(req, res) {
  // CORS 허용
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { endpoint, ...params } = req.query;
  if (!endpoint) return res.status(400).json({ error: "endpoint 파라미터 필요" });

  const query = new URLSearchParams({ crtfc_key: DART_KEY, ...params }).toString();
  const url = `${DART_BASE}/${endpoint}?${query}`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const text = await response.text();
    // JSON 파싱 시도, 실패시 텍스트 반환
    try {
      const data = JSON.parse(text);
      res.status(200).json(data);
    } catch {
      res.status(200).send(text);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
