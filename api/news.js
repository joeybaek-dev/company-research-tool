const https = require("https");
const http = require("http");
const { URL } = require("url");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "name required" });

  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(name)}&hl=ko&gl=KR&ceid=KR:ko`;

  try {
    const xml = await fetchUrl(rssUrl);
    const items = parseRSS(xml).slice(0, 5);
    res.status(200).json({ ok: true, items });
  } catch (e) {
    res.status(200).json({ ok: false, items: [], error: e.message });
  }
};

function fetchUrl(urlStr, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("Too many redirects"));
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
      timeout: 10000,
    };
    const req = lib.request(options, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return resolve(fetchUrl(r.headers.location, redirectCount + 1));
      }
      let data = "";
      r.setEncoding("utf8");
      r.on("data", (chunk) => (data += chunk));
      r.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = stripCDATA(extract(block, "title")).replace(/<[^>]+>/g, "").trim();
    const source = stripCDATA(extract(block, "source")).trim();
    const pubDate = extract(block, "pubDate").trim();
    const link = stripCDATA(extract(block, "link")).trim();
    if (title) items.push({ title, source, date: pubDate, link });
  }
  return items;
}

function extract(str, tag) {
  const m = str.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, "i"));
  return m ? m[1] : "";
}

function stripCDATA(str) {
  return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
