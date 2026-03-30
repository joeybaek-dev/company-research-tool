// generate-corps.js
// 실행: node generate-corps.js
// 결과: corps.json 생성

const https = require("https");
const fs = require("fs");
const AdmZip = require("adm-zip");

const DART_KEY = "a240d6fa018357edecf3ad8a267417628c7f29f4";

function download(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("리다이렉트 너무 많음"));
    const lib = url.startsWith("https") ? require("https") : require("http");
    lib.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(download(res.headers.location, redirectCount + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function parseXml(xml) {
  const corps = [];
  const regex = /<list>([\s\S]*?)<\/list>/g;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const b = m[1];
    const get = tag => {
      const r = b.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`));
      return r ? r[1].trim() : "";
    };
    const corp_code = get("corp_code");
    const corp_name = get("corp_name");
    const stock_code = get("stock_code").replace(/\s/g, "");
    if (corp_code && corp_name) {
      corps.push({ corp_code, corp_name, stock_code });
    }
  }
  return corps;
}

async function main() {
  console.log("📥 DART 기업목록 다운로드 중...");
  const buffer = await download(
    `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${DART_KEY}`
  );
  console.log(`✅ 다운로드 완료 (${(buffer.length / 1024).toFixed(0)}KB)`);

  console.log("🗜️  ZIP 압축 해제 중...");
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  console.log(`   ZIP 내 파일: ${entries.map(e => e.entryName).join(", ")}`);

  const xmlEntry = entries.find(e => e.entryName.endsWith(".xml"));
  if (!xmlEntry) throw new Error("XML 파일을 찾을 수 없어요");

  const xml = xmlEntry.getData().toString("utf8");
  console.log("✅ 압축 해제 완료");

  console.log("🔍 기업 목록 파싱 중...");
  const corps = parseXml(xml);
  console.log(`✅ 총 ${corps.length.toLocaleString()}개 기업 파싱 완료`);

  const listed = corps.filter(c => c.stock_code);
  const unlisted = corps.filter(c => !c.stock_code);
  console.log(`   📈 상장사: ${listed.length.toLocaleString()}개`);
  console.log(`   🏢 비상장사: ${unlisted.length.toLocaleString()}개`);

  const result = corps.map(c => ({
    id: c.corp_code,
    corp_code: c.corp_code,
    name: c.corp_name,
    listed: !!c.stock_code,
    stock_code: c.stock_code || ""
  }));

  fs.writeFileSync("corps.json", JSON.stringify(result));
  const size = fs.statSync("corps.json").size;
  console.log(`\n💾 corps.json 저장 완료 (${(size / 1024).toFixed(0)}KB)`);
  console.log("🎉 완료! corps.json을 GitHub company-research-tool 루트에 업로드해주세요.");
}

main().catch(console.error);